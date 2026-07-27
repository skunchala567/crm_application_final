// =====================================================
// Smartping (AiSensy) Provider for Integration Hub
// Handles WhatsApp messaging via Smartping API
// =====================================================

import axios from 'axios';
import crypto from 'node:crypto';
import { BaseIntegrationProvider, AuthenticationError, ValidationError } from '../base-provider.js';

export class SmartpingProvider extends BaseIntegrationProvider {
  constructor(config, logger = console) {
    super(config, logger);
    this.name = 'SmartpingProvider';
    this.campaignBaseUrl = config.baseUrl || 'https://backend.aisensy.com';
    this.projectApiBaseUrl = config.projectApiBaseUrl || process.env.AISENSY_PROJECT_API_BASE_URL || 'https://api.aisensy.io/v1';
    this.legacyProjectApiBaseUrl = config.legacyProjectApiBaseUrl
      || process.env.AISENSY_LEGACY_PROJECT_API_BASE_URL
      || 'https://apis.aisensy.com/project-apis/v1/project';
    this.projectId = config.projectId
      || process.env.AISENSY_PROJECT_ID;
    this.apiKey = config.apiKey
      || null;
    this.projectApiPassword = config.projectApiPassword
      || process.env[`AISENSY_PROJECT_API_PASSWORD${integrationSuffix}`]
      || process.env.AISENSY_PROJECT_API_PASSWORD;
    this.maxRetries = Number(config.maxRetries ?? process.env.AISENSY_MAX_RETRIES ?? 3);
    // Preserve compatibility with the existing template-management methods.
    this.apiBaseUrl = this.legacyProjectApiBaseUrl;
    this.config.projectId = this.projectId;
    this.config.projectApiPassword = this.projectApiPassword;
  }

  // ============= Core Methods =============

  async testConnection() {
    try {
      if (!this.config.projectId || !this.config.projectApiPassword) {
        throw new Error('Smartping Project ID and API Password are required');
      }

      this.log('info', 'Testing Smartping connection', {
        projectId: this.config.projectId
      });

      const url = `${this.legacyProjectApiBaseUrl}/${this.config.projectId}/messages`;

      try {
        const response = await axios.post(
          url,
          {
            to: '919000000000',
            type: 'text',
            recipient_type: 'individual',
            text: {
              body: 'Smartping connection test'
            }
          },
          {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'X-AiSensy-Project-API-Pwd': this.config.projectApiPassword
            },
            timeout: 5000
          }
        );

        // Success - API responded
        return {
          connected: true,
          message: 'Connected to Smartping API',
          provider: 'Smartping',
          projectId: this.config.projectId
        };
      } catch (apiError) {
        // Safe error handling - check status codes directly
        const status = apiError?.response?.status;
        const data = apiError?.response?.data;

        if (status === 401 || status === 403) {
          throw new Error('Invalid Project ID or API Password');
        }

        if (status && status !== 200) {
          // Any response from API means it's reachable
          return {
            connected: true,
            message: 'Connected to Smartping API (credentials accepted)',
            provider: 'Smartping',
            projectId: this.config.projectId
          };
        }

        // Network/connection error
        const errorMsg = apiError?.message || 'Unable to reach Smartping API';
        throw new Error(errorMsg);
      }
    } catch (error) {
      const errorMsg = error?.message || 'Unknown error';
      this.log('error', 'Connection test failed', {
        message: errorMsg,
        type: error?.constructor?.name
      });
      throw new ValidationError(errorMsg);
    }
  }

  // ============= Message Sending =============

  async sendMessage(phoneNumber, message, options = {}) {
    try {
      if (!phoneNumber || !message) {
        throw new Error('Phone number and message are required');
      }

      const formattedPhone = this.formatDestination(phoneNumber);

      this.log('info', 'Sending WhatsApp message via Smartping', {
        to: formattedPhone,
        projectId: this.projectId,
        type: options.templateName ? 'template' : 'text'
      });

      const response = options.templateName
        ? await this.sendTemplate(formattedPhone, options.templateName, {
            ...options,
            message
          })
        : await this.sendText(formattedPhone, message, options);
      if (response.data?.success === false) {
        const apiError = new ValidationError(response.data?.message || 'AiSensy rejected the message');
        apiError.response = { status: response.status, data: response.data };
        apiError.retryCount = response.retryCount || 0;
        throw apiError;
      }

      const result = {
        success: response.data?.success !== false,
        messageId: response.data?.messageId
          || response.data?.message_id
          || response.data?.messages?.[0]?.id
          || response.data?.id
          || `pending_${options.clientRequestId || Date.now()}`,
        to: formattedPhone,
        timestamp: new Date().toISOString(),
        status: response.data?.status || (response.data?.success === false ? 'FAILED' : 'QUEUED'),
        response: response.data,
        httpStatus: response.status,
        retryCount: response.retryCount || 0,
        responseTimeMs: response.responseTimeMs
      };

      this.log('info', 'Message sent successfully via Smartping', {
        messageId: result.messageId,
        to: formattedPhone
      });

      return result;
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message || 'Unknown error';
      const statusCode = error.response?.status;

      this.log('error', 'Failed to send message', {
        message: errorMsg,
        statusCode: statusCode,
        to: phoneNumber
      });

      if (error instanceof ValidationError || error instanceof AuthenticationError) {
        throw error;
      }
      const wrappedError = new ValidationError(`Failed to send WhatsApp message: ${errorMsg}`);
      wrappedError.response = error.response;
      wrappedError.retryCount = error.retryCount || 0;
      throw wrappedError;
    }
  }

  formatDestination(phoneNumber) {
    const digits = String(phoneNumber || '').replace(/\D/g, '');
    if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
    if (digits.length >= 11 && digits.length <= 15) return digits;
    throw new ValidationError('Invalid WhatsApp destination number');
  }

  async requestWithRetry(requestFactory, context = {}) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await requestFactory();
        return { ...response, retryCount: attempt, responseTimeMs: Date.now() - startedAt };
      } catch (error) {
        lastError = error;
        error.retryCount = attempt;
        error.responseTimeMs = Date.now() - startedAt;
        const status = error.response?.status;
        const retryable = !status || status === 408 || status === 429 || status >= 500;
        this.log('error', 'AiSensy API request failed', {
          operation: context.operation,
          status,
          retryCount: attempt,
          responseTimeMs: Date.now() - startedAt,
          message: error.response?.data?.message || error.message
        });
        if (!retryable || attempt >= this.maxRetries) break;
        await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
      }
    }
    throw lastError;
  }

  async sendTemplate(destination, templateName, options = {}) {
    if (!this.projectId || !this.projectApiPassword) {
      throw new AuthenticationError('AiSensy Project API credentials are not configured');
    }
    if (!templateName) throw new ValidationError('AiSensy template name is required');
    const components = [];
    if (options.media?.url) {
      const filename = String(options.media.filename || '').toLowerCase();
      const mediaType = options.media.type
        || (/\.(mp4|mov|webm)$/.test(filename) ? 'video'
          : /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)$/.test(filename) ? 'document'
            : 'image');
      components.push({
        type: 'header',
        parameters: [{
          type: mediaType,
          [mediaType]: {
            link: options.media.url,
            ...(mediaType === 'document' && options.media.filename
              ? { filename: options.media.filename }
              : {})
          }
        }]
      });
    }
    if (Array.isArray(options.templateParams) && options.templateParams.length) {
      components.push({
        type: 'body',
        parameters: options.templateParams.map(value => ({
          type: 'text',
          text: String(value)
        }))
      });
    }
    if (Array.isArray(options.buttons) && options.buttons.length) {
      components.push(...options.buttons.filter(button => button?.type === 'button'));
    }
    const payload = {
      to: destination,
      type: 'template',
      recipient_type: 'individual',
      template: {
        name: templateName,
        language: { code: this.normalizeLanguageCode(options.language) },
        ...(components.length ? { components } : {})
      },
      ...(options.source ? { source: options.source } : {}),
      ...(Array.isArray(options.tags) && options.tags.length ? { tags: options.tags } : {}),
      ...(options.attributes && Object.keys(options.attributes).length ? { attributes: options.attributes } : {})
    };
    const clientRequestId = options.clientRequestId || crypto.randomUUID();
    return this.requestWithRetry(
      () => axios.post(`${this.legacyProjectApiBaseUrl}/${this.projectId}/messages`, payload, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-AiSensy-Project-API-Pwd': this.projectApiPassword,
          'X-Client-Request-Id': clientRequestId
        },
        timeout: Number(this.config.timeoutMs || 15000)
      }),
      { operation: 'sendTemplate' }
    );
  }

  normalizeLanguageCode(language) {
    const value = String(language || 'en').trim();
    const knownLanguages = {
      english: 'en',
      hindi: 'hi',
      telugu: 'te',
      tamil: 'ta',
      kannada: 'kn',
      malayalam: 'ml',
      marathi: 'mr',
      bengali: 'bn',
      gujarati: 'gu'
    };
    return knownLanguages[value.toLowerCase()] || value.replace('-', '_');
  }

  async sendText(destination, message, options = {}) {
    if (!this.projectId || !this.projectApiPassword) {
      throw new AuthenticationError('AiSensy Project API credentials are not configured');
    }
    const payload = {
      to: destination,
      type: 'text',
      recipient_type: 'individual',
      text: { body: message }
    };
    return this.requestWithRetry(
      () => axios.post(`${this.legacyProjectApiBaseUrl}/${this.projectId}/messages`, payload, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-AiSensy-Project-API-Pwd': this.projectApiPassword,
          'X-Client-Request-Id': options.clientRequestId || crypto.randomUUID()
        },
        timeout: Number(this.config.timeoutMs || 15000)
      }),
      { operation: 'sendText' }
    );
  }

  async sendImage(destination, url, caption = '', options = {}) {
    return this.sendTemplate(destination, options.templateName, {
      ...options,
      media: { url, filename: options.filename || 'image' },
      message: caption
    });
  }

  async sendDocument(destination, url, filename, options = {}) {
    return this.sendTemplate(destination, options.templateName, {
      ...options,
      media: { url, filename }
    });
  }

  async sendVideo(destination, url, caption = '', options = {}) {
    return this.sendTemplate(destination, options.templateName, {
      ...options,
      media: { url, filename: options.filename || 'video' },
      message: caption
    });
  }

  async getMessageDetails(messageId) {
    if (!messageId) throw new ValidationError('Message ID is required');
    if (!this.projectId || !this.projectApiPassword) {
      throw new AuthenticationError('AiSensy Project API credentials are not configured');
    }
    return this.requestWithRetry(
      () => axios.get(`${this.legacyProjectApiBaseUrl}/${this.projectId}/messages/${encodeURIComponent(messageId)}`, {
        headers: {
          Accept: 'application/json',
          'X-AiSensy-Project-API-Pwd': this.projectApiPassword
        },
        timeout: Number(this.config.timeoutMs || 15000)
      }),
      { operation: 'getMessageDetails' }
    );
  }

  async sendBulkMessages(phoneNumbers, message, options = {}) {
    try {
      const results = {
        sent: 0,
        failed: 0,
        errors: []
      };

      if (!Array.isArray(phoneNumbers)) {
        throw new Error('phoneNumbers must be an array');
      }

      for (const phoneNumber of phoneNumbers) {
        try {
          if (!phoneNumber) {
            results.failed++;
            results.errors.push({
              phone: phoneNumber,
              error: 'Invalid phone number'
            });
            continue;
          }

          await this.sendMessage(phoneNumber, message, options);
          results.sent++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            phone: phoneNumber,
            error: error.message
          });
        }
      }

      this.log('info', 'Bulk message sending completed', results);
      return results;
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Bulk messaging failed', { message: errorMsg });

      throw new ValidationError('Failed to send bulk messages: ' + errorMsg);
    }
  }

  // ============= Template Management =============

  async createTemplate(templateData) {
    try {
      if (!this.config.projectId || !this.config.projectApiPassword) {
        throw new Error('Smartping credentials not configured');
      }

      const required = ['label', 'category', 'type', 'language', 'name', 'text', 'sample_text'];
      const missing = required.filter(field => !templateData[field]);
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(', ')}`);
      }

      this.log('info', 'Creating WhatsApp template on Smartping', {
        name: templateData.name,
        category: templateData.category,
        type: templateData.type
      });

      const url = `${this.apiBaseUrl}/${this.config.projectId}/wa_template`;

      const response = await axios.post(url, templateData, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-AiSensy-Project-API-Pwd': this.config.projectApiPassword
        }
      });

      const template = {
        id: response.data.id,
        name: response.data.name,
        label: response.data.label,
        status: response.data.status,
        language: response.data.language,
        text: response.data.text,
        category: response.data.category,
        type: response.data.type,
        createdAt: response.data.created_at,
        updatedAt: response.data.updated_at
      };

      this.log('info', 'Template created successfully', {
        templateId: template.id,
        status: template.status
      });

      return template;
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message || 'Unknown error';
      const statusCode = error.response?.status;

      this.log('error', 'Failed to create template', {
        message: errorMsg,
        statusCode: statusCode
      });

      throw new ValidationError(`Failed to create template: ${errorMsg}`);
    }
  }

  async getTemplates() {
    try {
      if (!this.config.projectId || !this.config.projectApiPassword) {
        throw new Error('Smartping credentials not configured');
      }

      this.log('info', 'Fetching WhatsApp templates from Smartping', {
        projectId: this.config.projectId
      });

      const url = `${this.apiBaseUrl}/${this.config.projectId}/wa_template`;

      try {
        const response = await axios.get(url, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-AiSensy-Project-API-Pwd': this.config.projectApiPassword
          }
        });

        const templates = (response.data.templates || response.data || []).map(template => ({
          id: template.id,
          name: template.name,
          label: template.label,
          status: template.status,
          language: template.language,
          text: template.text,
          sampleText: template.sample_text,
          category: template.category,
          type: template.type,
          totalParameters: template.total_parameters || 0
        }));

        this.log('info', 'Retrieved message templates', { count: templates.length });
        return templates;
      } catch (error) {
        if (error.response?.status === 404) {
          this.log('info', 'No templates found', {});
          return [];
        }
        throw error;
      }
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message || 'Unknown error';
      this.log('error', 'Failed to get templates', { message: errorMsg });

      return [];
    }
  }

  async getTemplate(templateId) {
    try {
      if (!this.config.projectId || !this.config.projectApiPassword) {
        throw new Error('Smartping credentials not configured');
      }

      this.log('info', 'Fetching template details', { templateId });

      const url = `${this.apiBaseUrl}/${this.config.projectId}/wa_template/${templateId}`;

      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-AiSensy-Project-API-Pwd': this.config.projectApiPassword
        }
      });

      return {
        id: response.data.id,
        name: response.data.name,
        label: response.data.label,
        status: response.data.status,
        language: response.data.language,
        text: response.data.text,
        sampleText: response.data.sample_text,
        category: response.data.category,
        type: response.data.type,
        totalParameters: response.data.total_parameters || 0,
        callToAction: response.data.call_to_action || [],
        quickReplies: response.data.quick_replies || [],
        rejectedReason: response.data.rejected_reason
      };
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message || 'Unknown error';
      this.log('error', 'Failed to get template', { message: errorMsg });
      throw new ValidationError(`Failed to get template: ${errorMsg}`);
    }
  }

  // ============= Webhook Handling =============

  async handleWebhook(payload, signature) {
    try {
      this.log('info', 'Processing Smartping webhook', {
        type: payload.type
      });

      if (payload.type === 'message') {
        this.log('info', 'Message received', {
          messageId: payload.messageId,
          phone: payload.phone_number,
          sender: payload.sender
        });
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Webhook processing failed', { message: errorMsg });

      throw new ValidationError('Failed to process webhook: ' + errorMsg);
    }
  }

  // ============= Auth Methods =============

  async authenticate() {
    // Smartping uses API password authentication
    if (!this.config.projectApiPassword || !this.config.projectId) {
      throw new AuthenticationError('Smartping Project ID and API Password are required');
    }
    return { authenticated: true };
  }

  async fetchData(options = {}) {
    throw new Error('fetchData() not implemented for Smartping provider');
  }

  async sendData(payload) {
    throw new Error('sendData() not implemented for Smartping provider');
  }
}
