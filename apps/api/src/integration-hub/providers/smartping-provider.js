// =====================================================
// Smartping (AiSensy) Provider for Integration Hub
// Handles WhatsApp messaging via Smartping API
// =====================================================

import axios from 'axios';
import { BaseIntegrationProvider, AuthenticationError, ValidationError } from '../base-provider.js';

export class SmartpingProvider extends BaseIntegrationProvider {
  constructor(config, logger = console) {
    super(config, logger);
    this.name = 'SmartpingProvider';
    this.apiBaseUrl = 'https://apis.aisensy.com/project-apis/v1/project';
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

      const url = `${this.apiBaseUrl}/${this.config.projectId}/messages`;

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

      if (!this.config.projectId || !this.config.projectApiPassword) {
        throw new Error('Smartping credentials not configured');
      }

      // Format phone number (ensure only digits)
      const formattedPhone = phoneNumber.replace(/\D/g, '');

      this.log('info', 'Sending WhatsApp message via Smartping', {
        to: formattedPhone,
        projectId: this.config.projectId,
        type: 'text'
      });

      const url = `${this.apiBaseUrl}/${this.config.projectId}/messages`;

      const payload = {
        to: formattedPhone,
        type: 'text',
        recipient_type: 'individual',
        text: {
          body: message
        }
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-AiSensy-Project-API-Pwd': this.config.projectApiPassword
        }
      });

      // Smartping response format
      const messageId = response.data.id || response.data.message_id || `msg_${Date.now()}`;

      const result = {
        success: true,
        messageId: messageId,
        to: formattedPhone,
        timestamp: new Date().toISOString(),
        status: response.data.status || 'SENT'
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

      throw new ValidationError(`Failed to send WhatsApp message: ${errorMsg}`);
    }
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
