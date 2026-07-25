// =====================================================
// AiSensyTemplateClient
// Official WhatsApp Business API wrapper for AiSensy
// Handles all communication with AiSensy template APIs
// =====================================================

import axios from 'axios';

export class AiSensyTemplateClient {
  constructor(logger = console) {
    this.logger = logger;
    this.baseUrl = 'https://apis.aisensy.com/project-apis/v1';
    this.timeout = 30000; // 30 seconds
  }

  /**
   * Create axios instance with AiSensy headers
   * @param {string} projectId - AiSensy Project ID
   * @param {string} projectApiPassword - AiSensy API Password
   * @returns {object} Configured axios instance
   */
  _createClient(projectId, projectApiPassword) {
    if (!projectId || !projectApiPassword) {
      throw new Error('Project ID and API Password are required');
    }

    return axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-AiSensy-Project-API-Pwd': projectApiPassword
      }
    });
  }

  /**
   * List all WhatsApp templates for a project
   * @param {string} projectId - AiSensy Project ID
   * @param {string} projectApiPassword - AiSensy API Password
   * @returns {Promise<Array>} Array of template objects
   * @throws {Error} If API call fails
   *
   * API Endpoint: GET /project/{projectId}/wa_template
   * Response: Array of templates
   */
  async listTemplates(projectId, projectApiPassword) {
    try {
      const client = this._createClient(projectId, projectApiPassword);

      this.logger.info('[AiSensy] Fetching templates', { projectId });

      // ✅ FIXED: Fetch all templates with pagination (AiSensy returns 10 per page by default)
      let allTemplates = [];
      let offset = 0;
      let hasMore = true;
      const limit = 100; // Request 100 per page to minimize requests

      while (hasMore) {
        try {
          const response = await client.get(`/project/${projectId}/wa_template?limit=${limit}&offset=${offset}`);

          // Handle AiSensy pagination format
          let templates = [];
          if (Array.isArray(response.data)) {
            templates = response.data;
          } else if (response.data?.template && Array.isArray(response.data.template)) {
            templates = response.data.template;
          } else {
            this.logger.warn('[AiSensy] Unexpected response format', { data: response.data });
            hasMore = false;
            break;
          }

          if (templates.length === 0) {
            hasMore = false;
          } else {
            allTemplates.push(...templates);
            offset += limit;

            // Check if we got all templates
            if (templates.length < limit) {
              hasMore = false;
            }
          }
        } catch (pageError) {
          // If pagination fails, try without it (older API versions)
          if (offset === 0) {
            this.logger.warn('[AiSensy] Pagination failed, retrying without pagination', { error: pageError.message });
            const response = await client.get(`/project/${projectId}/wa_template`);

            if (Array.isArray(response.data)) {
              allTemplates = response.data;
            } else if (response.data?.template && Array.isArray(response.data.template)) {
              allTemplates = response.data.template;
            }
          }
          hasMore = false;
        }
      }

      this.logger.info('[AiSensy] All templates fetched', {
        projectId,
        totalCount: allTemplates.length
      });

      return allTemplates;
    } catch (error) {
      this._handleError('listTemplates', error, { projectId });
    }
  }

  /**
   * Get a single template by ID
   * @param {string} projectId - AiSensy Project ID
   * @param {string} templateId - AiSensy Template ID
   * @param {string} projectApiPassword - AiSensy API Password
   * @returns {Promise<object>} Template object
   * @throws {Error} If API call fails or template not found
   *
   * API Endpoint: GET /project/{projectId}/wa_template/{templateId}
   */
  async getTemplate(projectId, templateId, projectApiPassword) {
    try {
      const client = this._createClient(projectId, projectApiPassword);

      this.logger.info('[AiSensy] Fetching template', { projectId, templateId });

      const response = await client.get(`/project/${projectId}/wa_template/${templateId}`);

      this.logger.info('[AiSensy] Template fetched', {
        projectId,
        templateId,
        status: response.data?.status
      });

      return response.data;
    } catch (error) {
      this._handleError('getTemplate', error, { projectId, templateId });
    }
  }

  /**
   * Submit a new WhatsApp template for approval
   * @param {string} projectId - AiSensy Project ID
   * @param {object} templatePayload - Template data matching AiSensy schema
   * @param {string} projectApiPassword - AiSensy API Password
   * @returns {Promise<object>} Created template object with ID
   * @throws {Error} If validation fails or API call fails
   *
   * API Endpoint: POST /project/{projectId}/wa_template
   *
   * Required fields in payload:
   * - name (lowercase_with_underscores)
   * - label (display name)
   * - category (MARKETING, TRANSACTIONAL, OTP)
   * - type (TEXT, IMAGE, VIDEO, FILE, LOCATION, CAROUSEL, ORDER_DETAILS)
   * - language (English, Spanish, etc)
   * - text (message body with {{n}} parameters)
   * - sample_text (required only if text contains {{n}} variables)
   *
   * Optional fields:
   * - header_type (NONE, TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION)
   * - header (header content or media URL)
   * - footer (footer text, max 60 chars)
   * - message_action_type (NONE, QuickReplies, CTA)
   * - quick_replies (array of reply strings, max 3)
   * - call_to_action (array of button objects, max 2)
   */
  async submitTemplate(projectId, templatePayload, projectApiPassword) {
    try {
      // Validate required fields
      this._validateTemplatePayload(templatePayload);

      const client = this._createClient(projectId, projectApiPassword);

      this.logger.info('[AiSensy] Submitting template', {
        projectId,
        templateName: templatePayload.name,
        category: templatePayload.category
      });

      const response = await client.post(`/project/${projectId}/wa_template`, templatePayload);

      this.logger.info('[AiSensy] Template submitted', {
        projectId,
        templateId: response.data?.id,
        status: response.data?.status
      });

      return response.data;
    } catch (error) {
      this._handleError('submitTemplate', error, {
        projectId,
        templateName: templatePayload?.name
      });
    }
  }

  /**
   * Delete a WhatsApp template
   * @param {string} templateId - AiSensy Template ID (not project ID)
   * @param {string} projectApiPassword - AiSensy API Password
   * @returns {Promise<object>} Response with status
   * @throws {Error} If API call fails
   *
   * API Endpoint: DELETE /wa_template/{templateId}
   * Note: This endpoint doesn't require project_id
   */
  async deleteTemplate(templateId, projectApiPassword) {
    try {
      if (!templateId) {
        throw new Error('Template ID is required');
      }

      const client = axios.create({
        baseURL: this.baseUrl,
        timeout: this.timeout,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-AiSensy-Project-API-Pwd': projectApiPassword
        }
      });

      this.logger.info('[AiSensy] Deleting template', { templateId });

      const response = await client.delete(`/wa_template/${templateId}`);

      this.logger.info('[AiSensy] Template deleted', { templateId });

      return response.data;
    } catch (error) {
      this._handleError('deleteTemplate', error, { templateId });
    }
  }

  /**
   * Sync templates - fetch all templates from AiSensy and process
   * @param {string} projectId - AiSensy Project ID
   * @param {string} projectApiPassword - AiSensy API Password
   * @returns {Promise<object>} Sync result with statistics
   */
  async syncTemplates(projectId, projectApiPassword) {
    try {
      const templates = await this.listTemplates(projectId, projectApiPassword);

      return {
        success: true,
        count: templates.length,
        templates: templates,
        syncedAt: new Date().toISOString()
      };
    } catch (error) {
      this._handleError('syncTemplates', error, { projectId });
    }
  }

  /**
   * Validate template payload against AiSensy requirements
   * @param {object} payload - Template data to validate
   * @throws {Error} If validation fails
   */
  _validateTemplatePayload(payload) {
    const errors = [];

    // Required fields
    if (!payload.name) errors.push('name is required');
    if (!payload.label) errors.push('label is required');
    if (!payload.category) errors.push('category is required');
    if (!payload.type) errors.push('type is required');
    if (!payload.language) errors.push('language is required');
    if (!payload.text) errors.push('text (message body) is required');

    // ✅ FIXED: sample_text only required if variables exist
    const hasVariables = /\{\{(\d+)\}\}/.test(payload.text);
    if (hasVariables && !payload.sample_text) {
      errors.push('sample_text is required when template contains variables');
    }

    // Template name validation
    if (payload.name) {
      if (!/^[a-z0-9_]+$/.test(payload.name)) {
        errors.push('name must be lowercase with underscores only (no spaces)');
      }
      if (payload.name.length < 3 || payload.name.length > 50) {
        errors.push('name must be 3-50 characters');
      }
    }

    // ✅ FIXED: Updated category enum to match API
    if (payload.category && !['MARKETING', 'TRANSACTIONAL', 'OTP'].includes(payload.category)) {
      errors.push('category must be MARKETING, TRANSACTIONAL, or OTP');
    }

    // ✅ FIXED: Updated type enum to match API
    if (payload.type && !['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'LOCATION', 'CAROUSEL', 'ORDER_DETAILS'].includes(payload.type)) {
      errors.push('type must be TEXT, IMAGE, VIDEO, FILE, LOCATION, CAROUSEL, or ORDER_DETAILS');
    }

    // ✅ FIXED: Updated header type enum to match API
    if (payload.header_type && !['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'].includes(payload.header_type)) {
      errors.push('header_type must be NONE, TEXT, IMAGE, VIDEO, DOCUMENT, or LOCATION');
    }

    // ✅ FIXED: Added NONE to message action type validation
    if (payload.message_action_type && !['NONE', 'QuickReplies', 'CTA'].includes(payload.message_action_type)) {
      errors.push('message_action_type must be NONE, QuickReplies, or CTA');
    }

    // Body length validation
    if (payload.text && payload.text.length > 1024) {
      errors.push('message body must be max 1024 characters');
    }

    // Footer length validation
    if (payload.footer && payload.footer.length > 60) {
      errors.push('footer must be max 60 characters');
    }

    // Quick replies validation
    if (payload.quick_replies && Array.isArray(payload.quick_replies)) {
      if (payload.quick_replies.length > 3) {
        errors.push('quick_replies must not exceed 3 items');
      }
      payload.quick_replies.forEach((reply, idx) => {
        if (!reply || reply.length === 0) {
          errors.push(`quick_replies[${idx}] cannot be empty`);
        }
        if (reply.length > 30) {
          errors.push(`quick_replies[${idx}] must be max 30 characters`);
        }
      });
    }

    // CTA buttons validation
    if (payload.call_to_action && Array.isArray(payload.call_to_action)) {
      if (payload.call_to_action.length > 2) {
        errors.push('call_to_action must not exceed 2 buttons');
      }
      payload.call_to_action.forEach((btn, idx) => {
        if (!btn.button_title || btn.button_title.length === 0) {
          errors.push(`call_to_action[${idx}].button_title is required`);
        }
        if (btn.button_title && btn.button_title.length > 30) {
          errors.push(`call_to_action[${idx}].button_title must be max 30 characters`);
        }
        if (!btn.button_value || btn.button_value.length === 0) {
          errors.push(`call_to_action[${idx}].button_value is required`);
        }
        if (!btn.type || !['URL', 'Phone Number', 'View Details'].includes(btn.type)) {
          errors.push(`call_to_action[${idx}].type must be URL, Phone Number, or View Details`);
        }
        // URL validation
        if (btn.type === 'URL' && btn.button_value) {
          try {
            new URL(btn.button_value);
          } catch {
            errors.push(`call_to_action[${idx}].button_value must be a valid URL`);
          }
        }
      });
    }

    if (errors.length > 0) {
      const errorMsg = errors.join('; ');
      throw new Error(`Template validation failed: ${errorMsg}`);
    }
  }

  /**
   * Handle API errors with logging and translation
   * @param {string} methodName - Name of the method that failed
   * @param {Error} error - The error object
   * @param {object} context - Additional context for logging
   * @throws {Error} Re-throws with better error message
   */
  _handleError(methodName, error, context = {}) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const message = error?.message;

    // Log the error
    this.logger.error(`[AiSensy] ${methodName} failed`, {
      status,
      message,
      context,
      response: data
    });

    // Create user-friendly error message based on status
    let errorMsg = message || 'Unknown error';

    switch (status) {
      case 400:
        errorMsg = data?.message || 'Invalid request format';
        break;
      case 401:
      case 403:
        errorMsg = 'Invalid Project ID or API Password';
        break;
      case 404:
        errorMsg = 'Template or project not found';
        break;
      case 409:
        errorMsg = 'Template with this name already exists';
        break;
      case 422:
        errorMsg = data?.message || 'Template validation failed';
        break;
      case 500:
        errorMsg = data?.message || data?.error || 'AiSensy API error - please try again later';
        break;
      case undefined:
        if (message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT')) {
          errorMsg = 'Cannot connect to AiSensy API - check network connection';
        }
        break;
    }

    throw new Error(`[${methodName}] ${errorMsg}`);
  }
}

export default AiSensyTemplateClient;
