// =====================================================
// WhatsApp Provider for Integration Hub
// Handles WhatsApp Business API messaging integration
// =====================================================

import axios from 'axios';
import { BaseIntegrationProvider, AuthenticationError, ValidationError } from '../base-provider.js';

export class WhatsAppProvider extends BaseIntegrationProvider {
  constructor(config, logger = console) {
    super(config, logger);
    this.name = 'WhatsAppProvider';

    // WhatsApp Business API v18.0
    this.apiBaseUrl = 'https://graph.instagram.com/v18.0';
  }

  // ============= Core Methods =============

  async testConnection() {
    try {
      if (!this.config.phoneNumberId || !this.config.accessToken) {
        throw new Error('WhatsApp Phone Number ID and access token are required');
      }

      this.log('info', 'Testing WhatsApp Business API connection', {
        phoneNumberId: this.config.phoneNumberId
      });

      // Test by fetching phone number details from Meta API
      const url = `${this.apiBaseUrl}/${this.config.phoneNumberId}`;

      try {
        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`
          },
          params: {
            fields: 'display_phone_number,verified_name,quality_rating,platform_type'
          }
        });

        const phoneData = response.data;

        this.log('info', 'Connection test successful', {
          phoneNumberId: this.config.phoneNumberId,
          displayPhoneNumber: phoneData.display_phone_number,
          verifiedName: phoneData.verified_name
        });

        return {
          connected: true,
          message: 'Connected to WhatsApp Business API',
          provider: 'WhatsApp Business',
          phoneNumberId: this.config.phoneNumberId,
          displayPhoneNumber: phoneData.display_phone_number,
          verifiedName: phoneData.verified_name,
          qualityRating: phoneData.quality_rating
        };
      } catch (error) {
        const errorMsg = error.response?.data?.error?.message || error.message;
        throw new Error(errorMsg);
      }
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Connection test failed', { message: errorMsg });

      throw new ValidationError(`Failed to connect to WhatsApp: ${errorMsg}`);
    }
  }

  async sendMessage(phoneNumber, message, options = {}) {
    try {
      if (!phoneNumber || !message) {
        throw new Error('Phone number and message are required');
      }

      if (!this.config.phoneNumberId || !this.config.accessToken) {
        throw new Error('WhatsApp credentials not configured');
      }

      // Format phone number (ensure only digits)
      const formattedPhone = phoneNumber.replace(/\D/g, '');

      this.log('info', 'Sending WhatsApp message via Meta API', {
        to: formattedPhone,
        phoneNumberId: this.config.phoneNumberId,
        messageType: options.templateId ? 'template' : 'text'
      });

      // Call Meta WhatsApp Business API
      const url = `${this.apiBaseUrl}/${this.config.phoneNumberId}/messages`;

      // Trim token in case of whitespace
      const trimmedToken = this.config.accessToken.trim();

      const payload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'text',
        text: { body: message }
      };

      this.log('info', 'Calling Meta API', {
        url: url,
        tokenLength: trimmedToken.length,
        tokenPrefix: trimmedToken.substring(0, 20),
        tokenSuffix: trimmedToken.substring(trimmedToken.length - 10),
        phone: formattedPhone
      });

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${trimmedToken}`,
          'Content-Type': 'application/json'
        }
      });

      // Meta returns: { messages: [{ id: "wamid.xxx" }], contacts: [...] }
      const messageId = response.data.messages?.[0]?.id || `msg_${Date.now()}`;

      const result = {
        success: true,
        messageId: messageId,
        to: formattedPhone,
        timestamp: new Date().toISOString()
      };

      this.log('info', 'Message sent successfully via Meta API', {
        messageId: result.messageId,
        to: formattedPhone
      });

      return result;
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message || 'Unknown error';
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

  async getTemplates() {
    try {
      if (!this.config.phoneNumberId || !this.config.accessToken) {
        throw new Error('WhatsApp credentials not configured');
      }

      this.log('info', 'Fetching WhatsApp message templates from Meta API', {
        phoneNumberId: this.config.phoneNumberId
      });

      // Fetch templates from Meta API
      const url = `${this.apiBaseUrl}/${this.config.phoneNumberId}/message_templates`;

      try {
        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`
          }
        });

        const templates = (response.data.data || []).map(template => ({
          id: template.id,
          name: template.name,
          content: template.components?.[0]?.text || '',
          language: template.language || 'en',
          status: template.status
        }));

        this.log('info', 'Retrieved message templates', { count: templates.length });
        return templates;
      } catch (error) {
        // If template fetch fails, return empty array (templates are optional)
        if (error.response?.status === 400) {
          this.log('info', 'No templates configured yet', {});
          return [];
        }
        throw error;
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message || 'Unknown error';
      this.log('error', 'Failed to get templates', { message: errorMsg });

      // Return empty array instead of throwing, since templates are optional
      return [];
    }
  }

  // ============= OAuth & Auth Methods =============

  async authenticate() {
    // WhatsApp uses token-based auth via Integration Hub
    throw new Error('WhatsApp auth handled by Integration Hub');
  }

  async handleWebhook(payload, signature) {
    try {
      // Verify webhook signature
      // In production, verify the signature against WhatsApp's key

      this.log('info', 'Processing WhatsApp webhook', {
        type: payload.object
      });

      if (payload.object === 'whatsapp_business_account') {
        const changes = payload.entry?.[0]?.changes || [];

        for (const change of changes) {
          if (change.field === 'messages') {
            const messages = change.value?.messages || [];
            for (const msg of messages) {
              this.log('info', 'Received incoming message', {
                from: msg.from,
                type: msg.type
              });
            }
          }
        }
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.log('error', 'Webhook processing failed', { message: errorMsg });

      throw new ValidationError('Failed to process webhook: ' + errorMsg);
    }
  }
}
