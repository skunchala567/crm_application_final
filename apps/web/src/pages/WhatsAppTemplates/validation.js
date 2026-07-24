// WhatsApp Template Validation Utilities

export const templateNameRegex = /^[a-z0-9_]+$/;
export const phoneRegex = /^\+?[0-9]{7,15}$/;
export const urlRegex = /^https:\/\/[^\s]+$/;
export const variableRegex = /\{\{(\d+)\}\}/g;

export function validateTemplateName(name) {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'Template name is required' };
  }

  if (!/^[a-z0-9_]+$/.test(name)) {
    return {
      valid: false,
      error: 'Template name must contain only lowercase letters, numbers, and underscores'
    };
  }

  if (name.length > 255) {
    return { valid: false, error: 'Template name must not exceed 255 characters' };
  }

  return { valid: true };
}

export function validateBody(body) {
  if (!body || body.trim().length === 0) {
    return { valid: false, error: 'Message body is required' };
  }

  if (body.length > 1024) {
    return { valid: false, error: 'Message body must not exceed 1024 characters' };
  }

  return { valid: true };
}

export function validateFooter(footer) {
  if (footer && footer.length > 60) {
    return { valid: false, error: 'Footer must not exceed 60 characters' };
  }

  return { valid: true };
}

export function extractVariables(text) {
  const matches = text.match(variableRegex) || [];
  const unique = [...new Set(matches)];
  return unique.sort((a, b) => {
    const numA = parseInt(a.replace(/\{\{|\}\}/g, ''));
    const numB = parseInt(b.replace(/\{\{|\}\}/g, ''));
    return numA - numB;
  });
}

export function validateVariables(text) {
  const variables = extractVariables(text);
  const errors = [];

  // Check sequential
  if (variables.length > 0) {
    for (let i = 0; i < variables.length; i++) {
      const expected = `{{${i + 1}}}`;
      if (variables[i] !== expected) {
        errors.push(
          `Variables must be sequential. Expected {{${i + 1}}}, but found ${variables[i]}`
        );
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    variables
  };
}

export function validateSampleValues(variables, sampleValues) {
  const errors = [];

  variables.forEach(varName => {
    if (!sampleValues[varName] || sampleValues[varName].trim() === '') {
      errors.push(`Sample value for ${varName} is required`);
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateButton(button, index) {
  const errors = [];

  if (!button.button_text || button.button_text.trim().length === 0) {
    errors.push(`Button ${index + 1}: Text is required`);
  } else if (button.button_text.length > 25) {
    errors.push(`Button ${index + 1}: Text must not exceed 25 characters`);
  }

  if (button.type === 'CALL_TO_ACTION') {
    if (!button.button_value) {
      errors.push(`Button ${index + 1}: Value is required`);
    } else if (button.cta_type === 'VISIT_WEBSITE') {
      if (!urlRegex.test(button.button_value)) {
        errors.push(`Button ${index + 1}: URL must start with https://`);
      }
    } else if (button.cta_type === 'CALL_PHONE') {
      const cleanPhone = button.button_value.replace(/[-\s]/g, '');
      if (!phoneRegex.test(cleanPhone)) {
        errors.push(`Button ${index + 1}: Invalid phone number format`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateButtons(buttons) {
  const errors = [];

  if (!buttons || buttons.length === 0) {
    return { valid: true, errors };
  }

  if (buttons.length > 3) {
    errors.push('Maximum 3 buttons allowed');
  }

  const quickReplies = buttons.filter(b => b.type === 'QUICK_REPLY');
  if (quickReplies.length > 3) {
    errors.push('Maximum 3 quick replies allowed');
  }

  buttons.forEach((btn, idx) => {
    const buttonValidation = validateButton(btn, idx);
    errors.push(...buttonValidation.errors);
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateCompleteTemplate(template) {
  const errors = [];

  // Name validation
  const nameValidation = validateTemplateName(template.template_name);
  if (!nameValidation.valid) errors.push(nameValidation.error);

  // Body validation
  const bodyValidation = validateBody(template.body);
  if (!bodyValidation.valid) errors.push(bodyValidation.error);

  // Footer validation
  const footerValidation = validateFooter(template.footer);
  if (!footerValidation.valid) errors.push(footerValidation.error);

  // Variables validation
  const variablesValidation = validateVariables(template.body);
  if (!variablesValidation.valid) {
    errors.push(...variablesValidation.errors);
  }

  // Sample values validation
  if (variablesValidation.variables.length > 0) {
    const sampleValidation = validateSampleValues(
      variablesValidation.variables,
      template.sample_values || {}
    );
    if (!sampleValidation.valid) {
      errors.push(...sampleValidation.errors);
    }
  }

  // Buttons validation
  const buttonsValidation = validateButtons(template.buttons);
  if (!buttonsValidation.valid) {
    errors.push(...buttonsValidation.errors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function validateRealtime(template, field) {
  const result = { valid: true, error: null };

  switch (field) {
    case 'template_name':
      return validateTemplateName(template.template_name);

    case 'body':
      const bodyVal = validateBody(template.body);
      if (!bodyVal.valid) return bodyVal;

      const varVal = validateVariables(template.body);
      if (!varVal.valid) return { valid: false, error: varVal.errors[0] };

      if (varVal.variables.length > 0) {
        const sampleVal = validateSampleValues(varVal.variables, template.sample_values);
        if (!sampleVal.valid) return { valid: false, error: sampleVal.errors[0] };
      }

      return { valid: true };

    case 'footer':
      return validateFooter(template.footer);

    case 'buttons':
      return validateButtons(template.buttons);

    default:
      return { valid: true };
  }
}
