// =====================================================
// TemplateValidator
// Validates templates against AiSensy API schema
// =====================================================

export class TemplateValidator {
  /**
   * Validate a template object against AiSensy requirements
   * @param {object} template - Template data to validate
   * @param {string} mode - 'create' or 'update'
   * @returns {object} { valid: boolean, errors: string[] }
   */
  static validate(template, mode = 'create') {
    const errors = [];

    // Step 1: Required fields for submission
    this._validateRequiredFields(template, errors);

    // Step 2: Field format validation
    this._validateFieldFormats(template, errors);

    // Step 3: Field value validation
    this._validateFieldValues(template, errors);

    // Step 4: Template-specific logic
    this._validateTemplateLogic(template, errors);

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Validate that all required fields are present
   */
  static _validateRequiredFields(template, errors) {
    // ✅ FIXED: sample_text only required if variables exist
    const required = ['name', 'label', 'category', 'type', 'language', 'text'];

    required.forEach(field => {
      if (!template[field] || (typeof template[field] === 'string' && template[field].trim() === '')) {
        errors.push(`${field}: This field is required`);
      }
    });

    // ✅ FIXED: sample_text conditional on variables
    const hasVariables = /\{\{(\d+)\}\}/.test(template.text);
    if (hasVariables && (!template.sample_text || (typeof template.sample_text === 'string' && template.sample_text.trim() === ''))) {
      errors.push(`sample_text: This field is required when template contains variables`);
    }
  }

  /**
   * Validate field formats
   */
  static _validateFieldFormats(template, errors) {
    // Template name format
    if (template.name) {
      if (!/^[a-z0-9_]+$/.test(template.name)) {
        errors.push('name: Must contain only lowercase letters, numbers, and underscores (no spaces)');
      }
    }

    // Template name length
    if (template.name && (template.name.length < 3 || template.name.length > 50)) {
      errors.push('name: Must be between 3 and 50 characters');
    }

    // Message body length
    if (template.text && template.text.length > 1024) {
      errors.push('text: Message body must not exceed 1024 characters');
    }

    // Footer length
    if (template.footer && template.footer.length > 60) {
      errors.push('footer: Footer must not exceed 60 characters');
    }

    // Label length
    if (template.label && template.label.length > 100) {
      errors.push('label: Label must not exceed 100 characters');
    }
  }

  /**
   * Validate field values against allowed enums
   */
  static _validateFieldValues(template, errors) {
    // ✅ FIXED: Updated category enum to match API
    const validCategories = ['MARKETING', 'TRANSACTIONAL', 'OTP'];
    if (template.category && !validCategories.includes(template.category.toUpperCase())) {
      errors.push(`category: Must be one of ${validCategories.join(', ')}`);
    }

    // ✅ FIXED: Updated type enum to match API
    const validTypes = ['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'LOCATION', 'CAROUSEL', 'ORDER_DETAILS'];
    if (template.type && !validTypes.includes(template.type.toUpperCase())) {
      errors.push(`type: Must be one of ${validTypes.join(', ')}`);
    }

    // ✅ FIXED: Added NONE to message action types
    if (template.message_action_type) {
      const validActionTypes = ['NONE', 'QuickReplies', 'CTA'];
      if (!validActionTypes.includes(template.message_action_type)) {
        errors.push(`message_action_type: Must be one of ${validActionTypes.join(', ')}`);
      }
    }

    // Language validation
    if (template.language) {
      const validLanguages = [
        'English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian',
        'Russian', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Hindi',
        'Bengali', 'Dutch', 'Swedish', 'Polish', 'Turkish', 'Greek'
      ];
      if (!validLanguages.includes(template.language)) {
        errors.push(`language: "${template.language}" is not a supported language`);
      }
    }
  }

  /**
   * Validate template-specific logic
   */
  static _validateTemplateLogic(template, errors) {
    // Parameter validation
    const bodyParams = this._extractParameters(template.text);
    const sampleParams = this._extractParameters(template.sample_text);

    // Check if sample has all parameters
    bodyParams.forEach(param => {
      if (!sampleParams.includes(param)) {
        errors.push(`sample_text: Missing parameter ${param} - all {{n}} from message body must have values in sample text`);
      }
    });

    // Check for mismatched parameter counts
    if (bodyParams.length !== sampleParams.length) {
      errors.push(`Parameter count mismatch: body has ${bodyParams.length}, sample_text has ${sampleParams.length}`);
    }

    // Store parameter count for reference
    template.total_parameters = bodyParams.length;

    // Header content validation (optional)
    // For TEXT header content, validate length if provided
    if (template.header_content && template.header_content.length > 60) {
      errors.push('header_content: Header text must not exceed 60 characters');
    }

    // Media URL validation if provided
    const headerUrl = template.header_content || template.media_url || template.video_url || template.document_url;
    if (headerUrl && !this._isValidUrl(headerUrl)) {
      errors.push('header_content: Media URL must be a valid HTTPS URL');
    }

    // Quick replies validation
    if (template.quick_replies && Array.isArray(template.quick_replies)) {
      if (template.quick_replies.length > 3) {
        errors.push('quick_replies: Maximum 3 quick replies allowed');
      }

      template.quick_replies.forEach((reply, idx) => {
        if (!reply || (typeof reply === 'string' && reply.trim() === '')) {
          errors.push(`quick_replies[${idx}]: Reply text cannot be empty`);
        }
        if (typeof reply === 'string' && reply.length > 30) {
          errors.push(`quick_replies[${idx}]: Reply text must not exceed 30 characters`);
        }
      });

      if (template.quick_replies.length > 0) {
        template.message_action_type = 'QuickReplies';
      }
    }

    // CTA buttons validation
    if (template.call_to_action && Array.isArray(template.call_to_action)) {
      if (template.call_to_action.length > 2) {
        errors.push('call_to_action: Maximum 2 call-to-action buttons allowed');
      }

      template.call_to_action.forEach((btn, idx) => {
        // Button title validation
        if (!btn.button_title || btn.button_title.trim() === '') {
          errors.push(`call_to_action[${idx}].button_title: Button title is required`);
        } else if (btn.button_title.length > 30) {
          errors.push(`call_to_action[${idx}].button_title: Button title must not exceed 30 characters`);
        }

        // Button value validation
        if (!btn.button_value || btn.button_value.trim() === '') {
          errors.push(`call_to_action[${idx}].button_value: Button value is required`);
        }

        // Button type validation
        const validBtnTypes = ['URL', 'Phone Number', 'View Details'];
        if (!btn.type || !validBtnTypes.includes(btn.type)) {
          errors.push(`call_to_action[${idx}].type: Must be one of ${validBtnTypes.join(', ')}`);
        }

        // URL validation
        if (btn.type === 'URL') {
          if (!this._isValidUrl(btn.button_value)) {
            errors.push(`call_to_action[${idx}].button_value: Must be a valid HTTPS URL`);
          }
        }

        // Phone number validation
        if (btn.type === 'Phone Number') {
          if (!this._isValidPhoneNumber(btn.button_value)) {
            errors.push(`call_to_action[${idx}].button_value: Must be a valid phone number (E.164 format: +1234567890)`);
          }
        }
      });

      if (template.call_to_action.length > 0) {
        template.message_action_type = 'CTA';
      }
    }

    // Validate that button content matches message_action_type
    if (template.message_action_type === 'QuickReplies' && !template.quick_replies?.length) {
      errors.push('message_action_type: QuickReplies selected but no quick replies provided');
    }

    if (template.message_action_type === 'CTA' && !template.call_to_action?.length) {
      errors.push('message_action_type: CTA selected but no call-to-action buttons provided');
    }
  }

  /**
   * Extract parameter numbers from text
   * Finds all {{n}} patterns and returns sorted array
   */
  static _extractParameters(text) {
    if (!text) return [];

    const regex = /\{\{(\d+)\}\}/g;
    const params = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
      params.add(parseInt(match[1]));
    }

    return Array.from(params).sort((a, b) => a - b);
  }

  /**
   * Validate URL format
   */
  static _isValidUrl(urlString) {
    try {
      const url = new URL(urlString);
      return url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Validate E.164 phone number format
   * Examples: +1234567890, +919999999999
   */
  static _isValidPhoneNumber(phoneString) {
    if (!phoneString) return false;
    // E.164 format: + followed by 1-15 digits
    return /^\+[1-9]\d{1,14}$/.test(phoneString);
  }

  /**
   * Get validation errors for a specific field
   */
  static getFieldErrors(template, fieldName, mode = 'create') {
    const result = this.validate(template, mode);
    return result.errors.filter(err => err.startsWith(`${fieldName}:`));
  }

  /**
   * Normalize template data for AiSensy submission
   * Converts internal format to AiSensy API format
   */
  static normalizeForSubmission(template) {
    const normalized = {
      name: template.name.toLowerCase().trim(),
      label: template.label.trim(),
      category: template.category.toUpperCase(),
      type: template.type.toUpperCase(),
      language: template.language.trim(),
      text: template.text,
      sample_text: template.sample_text
    };

    // Add optional fields if present
    if (template.header_content) {
      normalized.header = template.header_content;
    }

    if (template.footer) {
      normalized.footer = template.footer;
    }

    if (template.message_action_type) {
      normalized.message_action_type = template.message_action_type;
    }

    if (template.quick_replies && template.quick_replies.length > 0) {
      normalized.quick_replies = template.quick_replies;
    }

    if (template.call_to_action && template.call_to_action.length > 0) {
      normalized.call_to_action = template.call_to_action;
    }

    return normalized;
  }
}

export default TemplateValidator;
