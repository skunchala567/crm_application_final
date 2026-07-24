// =====================================================
// WhatsApp Template Service
// Handles template management, validation, and API sync
// =====================================================

export class WhatsAppTemplateService {
  constructor(pool, logger = console) {
    this.pool = pool;
    this.logger = logger;
  }

  // ============= Template Creation & Management =============

  async createTemplate(organizationId, integrationId, templateData) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const {
        template_name,
        category,
        language,
        template_type,
        header_type,
        header_content,
        body,
        footer,
        buttons,
        sample_values,
        variables
      } = templateData;

      // Validate template name uniqueness
      const existing = await conn.query(
        'SELECT id FROM whatsapp_templates WHERE integration_id = ? AND template_name = ? AND deleted_at IS NULL',
        [integrationId, template_name]
      );
      if (existing.length > 0) {
        throw new Error(`Template name "${template_name}" already exists`);
      }

      // Insert template
      const [result] = await conn.query(
        `INSERT INTO whatsapp_templates (
          integration_id, organization_id, template_name, category, language,
          template_type, header_type, header_content, body, footer,
          buttons_json, sample_values_json, variables_list, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
        [
          integrationId, organizationId, template_name, category, language,
          template_type, header_type, header_content, body, footer,
          JSON.stringify(buttons || []),
          JSON.stringify(sample_values || {}),
          JSON.stringify(variables || []),
          organizationId
        ]
      );

      const templateId = result.insertId;

      // Insert buttons if any
      if (buttons && buttons.length > 0) {
        for (let i = 0; i < buttons.length; i++) {
          const btn = buttons[i];
          await conn.query(
            `INSERT INTO whatsapp_template_buttons (
              template_id, button_type, cta_type, button_text, button_value, sequence_order
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              templateId,
              btn.type === 'QUICK_REPLY' ? 'QUICK_REPLY' : 'CALL_TO_ACTION',
              btn.cta_type || null,
              btn.button_text,
              btn.button_value,
              i
            ]
          );
        }
      }

      await conn.commit();

      this.logger.info('Template created', { templateId, integrationId });
      return await this.getTemplate(organizationId, integrationId, templateId);
    } catch (error) {
      await conn.rollback();
      this.logger.error('Failed to create template', { error: error.message });
      throw error;
    } finally {
      conn.release();
    }
  }

  async updateTemplate(organizationId, integrationId, templateId, updates) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const template = await this.getTemplate(organizationId, integrationId, templateId);
      if (!template) throw new Error('Template not found');
      if (template.status !== 'DRAFT') throw new Error('Only draft templates can be edited');

      const {
        template_name,
        category,
        language,
        template_type,
        header_type,
        header_content,
        body,
        footer,
        buttons,
        sample_values,
        variables
      } = updates;

      // Check name uniqueness if changing
      if (template_name && template_name !== template.template_name) {
        const existing = await conn.query(
          'SELECT id FROM whatsapp_templates WHERE integration_id = ? AND template_name = ? AND id != ? AND deleted_at IS NULL',
          [integrationId, template_name, templateId]
        );
        if (existing.length > 0) throw new Error(`Template name "${template_name}" already exists`);
      }

      await conn.query(
        `UPDATE whatsapp_templates SET
          template_name = ?, category = ?, language = ?,
          template_type = ?, header_type = ?, header_content = ?,
          body = ?, footer = ?,
          buttons_json = ?, sample_values_json = ?, variables_list = ?,
          updated_by = ?, updated_at = NOW()
        WHERE id = ?`,
        [
          template_name || template.template_name,
          category || template.category,
          language || template.language,
          template_type || template.template_type,
          header_type || template.header_type,
          header_content !== undefined ? header_content : template.header_content,
          body || template.body,
          footer !== undefined ? footer : template.footer,
          JSON.stringify(buttons || JSON.parse(template.buttons_json || '[]')),
          JSON.stringify(sample_values || JSON.parse(template.sample_values_json || '{}')),
          JSON.stringify(variables || JSON.parse(template.variables_list || '[]')),
          organizationId,
          templateId
        ]
      );

      // Delete existing buttons and recreate
      await conn.query('DELETE FROM whatsapp_template_buttons WHERE template_id = ?', [templateId]);
      if (buttons && buttons.length > 0) {
        for (let i = 0; i < buttons.length; i++) {
          const btn = buttons[i];
          await conn.query(
            `INSERT INTO whatsapp_template_buttons (
              template_id, button_type, cta_type, button_text, button_value, sequence_order
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              templateId,
              btn.type === 'QUICK_REPLY' ? 'QUICK_REPLY' : 'CALL_TO_ACTION',
              btn.cta_type || null,
              btn.button_text,
              btn.button_value,
              i
            ]
          );
        }
      }

      await conn.commit();
      return await this.getTemplate(organizationId, integrationId, templateId);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async deleteTemplate(organizationId, integrationId, templateId) {
    const template = await this.getTemplate(organizationId, integrationId, templateId);
    if (!template) throw new Error('Template not found');
    if (template.status !== 'DRAFT') throw new Error('Only draft templates can be deleted');

    await this.pool.query(
      'UPDATE whatsapp_templates SET deleted_at = NOW() WHERE id = ?',
      [templateId]
    );

    this.logger.info('Template deleted', { templateId });
  }

  async getTemplate(organizationId, integrationId, templateId) {
    const rows = await this.pool.query(
      `SELECT * FROM whatsapp_templates
       WHERE id = ? AND organization_id = ? AND integration_id = ? AND deleted_at IS NULL`,
      [templateId, organizationId, integrationId]
    );

    if (rows.length === 0) return null;

    const template = rows[0];
    template.buttons_json = JSON.parse(template.buttons_json || '[]');
    template.sample_values_json = JSON.parse(template.sample_values_json || '{}');
    template.variables_list = JSON.parse(template.variables_list || '[]');

    // Get buttons from button table
    const buttons = await this.pool.query(
      'SELECT * FROM whatsapp_template_buttons WHERE template_id = ? ORDER BY sequence_order',
      [templateId]
    );
    template.buttons = buttons;

    return template;
  }

  async listTemplates(organizationId, integrationId, filters = {}) {
    let query = `
      SELECT * FROM whatsapp_templates
      WHERE organization_id = ? AND integration_id = ? AND deleted_at IS NULL
    `;
    const params = [organizationId, integrationId];

    if (filters.status) {
      query += ` AND status = ?`;
      params.push(filters.status);
    }

    if (filters.category) {
      query += ` AND category = ?`;
      params.push(filters.category);
    }

    if (filters.language) {
      query += ` AND language = ?`;
      params.push(filters.language);
    }

    if (filters.search) {
      query += ` AND template_name LIKE ?`;
      params.push(`%${filters.search}%`);
    }

    if (filters.type) {
      query += ` AND template_type = ?`;
      params.push(filters.type);
    }

    query += ` ORDER BY created_at DESC`;

    if (filters.limit) {
      query += ` LIMIT ? OFFSET ?`;
      params.push(filters.limit, filters.offset || 0);
    }

    const templates = await this.pool.query(query, params);

    return templates.map(t => ({
      ...t,
      buttons_json: JSON.parse(t.buttons_json || '[]'),
      sample_values_json: JSON.parse(t.sample_values_json || '{}'),
      variables_list: JSON.parse(t.variables_list || '[]')
    }));
  }

  async countTemplates(organizationId, integrationId, filters = {}) {
    let query = `
      SELECT COUNT(*) as count FROM whatsapp_templates
      WHERE organization_id = ? AND integration_id = ? AND deleted_at IS NULL
    `;
    const params = [organizationId, integrationId];

    if (filters.status) {
      query += ` AND status = ?`;
      params.push(filters.status);
    }

    if (filters.category) {
      query += ` AND category = ?`;
      params.push(filters.category);
    }

    if (filters.language) {
      query += ` AND language = ?`;
      params.push(filters.language);
    }

    if (filters.search) {
      query += ` AND template_name LIKE ?`;
      params.push(`%${filters.search}%`);
    }

    const result = await this.pool.query(query, params);
    return result[0]?.count || 0;
  }

  // ============= Template Submission =============

  async submitTemplate(organizationId, integrationId, templateId) {
    const template = await this.getTemplate(organizationId, integrationId, templateId);
    if (!template) throw new Error('Template not found');
    if (template.status !== 'DRAFT') throw new Error('Only draft templates can be submitted');

    const validation = this.validateTemplate(template);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    await this.pool.query(
      'UPDATE whatsapp_templates SET status = ?, updated_at = NOW() WHERE id = ?',
      ['PENDING', templateId]
    );

    await this.logSync(templateId, 'CREATE', 'PENDING', null, 'Template submitted for approval');

    this.logger.info('Template submitted', { templateId });
    return await this.getTemplate(organizationId, integrationId, templateId);
  }

  async cloneTemplate(organizationId, integrationId, templateId, newName) {
    const template = await this.getTemplate(organizationId, integrationId, templateId);
    if (!template) throw new Error('Template not found');

    return this.createTemplate(organizationId, integrationId, {
      template_name: newName,
      category: template.category,
      language: template.language,
      template_type: template.template_type,
      header_type: template.header_type,
      header_content: template.header_content,
      body: template.body,
      footer: template.footer,
      buttons: template.buttons_json,
      sample_values: template.sample_values_json,
      variables: template.variables_list
    });
  }

  async archiveTemplate(organizationId, integrationId, templateId) {
    const template = await this.getTemplate(organizationId, integrationId, templateId);
    if (!template) throw new Error('Template not found');

    await this.pool.query(
      'UPDATE whatsapp_templates SET is_archived = TRUE, updated_at = NOW() WHERE id = ?',
      [templateId]
    );

    this.logger.info('Template archived', { templateId });
  }

  // ============= Validation =============

  validateTemplate(template) {
    const errors = [];

    // Template name validation
    if (!template.template_name || !/^[a-z0-9_]+$/.test(template.template_name)) {
      errors.push('Template name must be lowercase letters, numbers, and underscores only');
    }

    // Body validation
    if (!template.body || template.body.trim().length === 0) {
      errors.push('Template body is required');
    } else if (template.body.length > 1024) {
      errors.push('Template body must not exceed 1024 characters');
    }

    // Variables validation
    const variables = template.variables_list || [];
    const bodyVars = this.extractVariables(template.body);

    // Check sequential variables
    if (bodyVars.length > 0) {
      for (let i = 0; i < bodyVars.length; i++) {
        if (bodyVars[i] !== i + 1) {
          errors.push('Variables must be sequential ({{1}}, {{2}}, etc.)');
          break;
        }
      }

      // Check sample values exist
      const sampleValues = template.sample_values_json || {};
      for (let i = 1; i <= bodyVars.length; i++) {
        if (!sampleValues[`{{${i}}}`] || sampleValues[`{{${i}}}`].trim() === '') {
          errors.push(`Sample value for {{${i}}} is required`);
        }
      }
    }

    // Buttons validation
    if (template.buttons_json && template.buttons_json.length > 0) {
      template.buttons_json.forEach((btn, idx) => {
        if (!btn.button_text || btn.button_text.trim().length === 0) {
          errors.push(`Button ${idx + 1}: Text is required`);
        } else if (btn.button_text.length > 25) {
          errors.push(`Button ${idx + 1}: Text must not exceed 25 characters`);
        }

        if (btn.type === 'CALL_TO_ACTION') {
          if (!btn.button_value) {
            errors.push(`Button ${idx + 1}: Value is required`);
          } else if (btn.cta_type === 'VISIT_WEBSITE' && !/^https:\/\//i.test(btn.button_value)) {
            errors.push(`Button ${idx + 1}: URL must start with https://`);
          } else if (btn.cta_type === 'CALL_PHONE' && !/^\+?[0-9]{7,15}$/.test(btn.button_value.replace(/[-\s]/g, ''))) {
            errors.push(`Button ${idx + 1}: Invalid phone number format`);
          }
        }
      });

      if (template.buttons_json.length > 3) {
        errors.push('Maximum 3 buttons allowed');
      }
    }

    // Quick replies validation
    const quickReplies = template.buttons_json?.filter(b => b.type === 'QUICK_REPLY') || [];
    if (quickReplies.length > 3) {
      errors.push('Maximum 3 quick replies allowed');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  extractVariables(text) {
    const matches = text.match(/\{\{(\d+)\}\}/g) || [];
    const numbers = [...new Set(matches.map(m => parseInt(m.replace(/\{\{|\}\}/g, ''))))];
    return numbers.sort((a, b) => a - b);
  }

  // ============= Sync & Logging =============

  async logSync(templateId, syncType, status, responseCode, message) {
    await this.pool.query(
      `INSERT INTO whatsapp_template_sync_logs (
        template_id, sync_type, status, response_code, response_message
      ) VALUES (?, ?, ?, ?, ?)`,
      [templateId, syncType, status, responseCode, message]
    );
  }

  async getSyncLogs(templateId, limit = 10) {
    return this.pool.query(
      'SELECT * FROM whatsapp_template_sync_logs WHERE template_id = ? ORDER BY synced_at DESC LIMIT ?',
      [templateId, limit]
    );
  }

  async updateTemplateStatus(templateId, status, rejectionReason = null, apiResponse = null) {
    await this.pool.query(
      `UPDATE whatsapp_templates SET
        status = ?, rejection_reason = ?, api_response = ?, updated_at = NOW()
      WHERE id = ?`,
      [status, rejectionReason, JSON.stringify(apiResponse), templateId]
    );
  }
}
