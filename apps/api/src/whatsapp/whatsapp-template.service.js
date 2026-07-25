// =====================================================
// WhatsApp Template Service - API-First Architecture
// AiSensy is source of truth, local DB is metadata cache
// =====================================================

import { AiSensyTemplateClient } from './aisensy-template-client.js';
import { TemplateValidator } from './template-validator.js';

export class WhatsAppTemplateService {
  constructor(pool, logger = console) {
    this.pool = pool;
    this.logger = logger;
    this.aisensy = new AiSensyTemplateClient(logger);
    this.validator = TemplateValidator;
  }

  // ============= Template Listing (From AiSensy) =============

  /**
   * List all templates from AiSensy
   * This is the source of truth
   * @param {number} organizationId
   * @param {number} integrationId
   * @param {object} filters - Optional filters (status, category, search, etc)
   * @returns {Promise<Array>} Templates with all metadata from local database
   */
  async listTemplates(organizationId, integrationId, filters = {}) {
    try {
      // Get integration configuration
      const integration = await this._getIntegration(organizationId, integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      // Try to call AiSensy API to sync latest data
      try {
        this.logger.info('[Service] Listing templates from AiSensy', {
          integrationId,
          projectId: integration.project_id
        });

        const aisensy_templates = await this.aisensy.listTemplates(
          integration.project_id,
          integration.project_api_password
        );

        // Update local cache with AiSensy data (this preserves template_type, created_at, etc)
        await this._syncTemplatesLocally(organizationId, integrationId, aisensy_templates);
      } catch (apiError) {
        // If AiSensy call fails, we'll use local cache below
        this.logger.warn('[Service] AiSensy API failed, using local cache', {
          error: apiError.message,
          integrationId
        });
      }

      // ✅ FIX: Always return from local database to get all metadata fields
      // (template_type, created_at, updated_at, header_type, etc.)
      const [templates] = await this.pool.query(
        'SELECT * FROM whatsapp_templates WHERE integration_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
        [integrationId]
      );

      // Apply local filters if specified
      let filtered = templates || [];
      if (filters.status) {
        filtered = filtered.filter(t => t.status === filters.status);
      }
      if (filters.category) {
        filtered = filtered.filter(t => t.category === filters.category);
      }
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        filtered = filtered.filter(t => {
          const name = t.template_name || t.name || '';
          const label = t.label || '';
          return name.toLowerCase().includes(searchLower) ||
                 label.toLowerCase().includes(searchLower);
        });
      }

      this.logger.info('[Service] Returned templates from local database', {
        count: filtered.length,
        integrationId
      });

      return filtered;
    } catch (error) {
      this.logger.error('[Service] Failed to list templates', {
        error: error.message,
        integrationId
      });
      throw error;
    }
  }

  /**
   * Get single template by ID
   * @param {number} organizationId
   * @param {number} integrationId
   * @param {string} aisensy_template_id - AiSensy template ID
   * @returns {Promise<object>} Template with all metadata from local database
   */
  async getTemplate(organizationId, integrationId, aisensy_template_id) {
    try {
      // Get integration
      const integration = await this._getIntegration(organizationId, integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      // Try to fetch from AiSensy to get latest data
      try {
        this.logger.info('[Service] Getting template from AiSensy', {
          integrationId,
          templateId: aisensy_template_id
        });

        const aisensy_template = await this.aisensy.getTemplate(
          integration.project_id,
          aisensy_template_id,
          integration.project_api_password
        );

        // Update local cache
        if (aisensy_template?.id) {
          await this._syncTemplatesLocally(organizationId, integrationId, [aisensy_template]);
        }
      } catch (apiError) {
        // If AiSensy call fails, we'll use local cache below
        this.logger.warn('[Service] AiSensy API failed, using local cache', {
          error: apiError.message,
          integrationId
        });
      }

      // ✅ FIX: Always return from local database to get all metadata fields
      // (template_type, created_at, updated_at, header_type, etc.)
      const [templates] = await this.pool.query(
        'SELECT * FROM whatsapp_templates WHERE integration_id = ? AND aisensy_template_id = ? AND deleted_at IS NULL LIMIT 1',
        [integrationId, aisensy_template_id]
      );

      if (templates.length === 0) {
        throw new Error('Template not found');
      }

      return templates[0];
    } catch (error) {
      this.logger.error('[Service] Failed to get template', {
        error: error.message,
        integrationId,
        templateId: aisensy_template_id
      });
      throw error;
    }
  }

  // ============= Template Creation (Submit to AiSensy) =============

  /**
   * Create and submit new template to AiSensy
   * @param {number} organizationId
   * @param {number} integrationId
   * @param {object} templateData - Template data from form
   * @returns {Promise<object>} Template from AiSensy
   */
  async createTemplate(organizationId, integrationId, templateData) {
    const conn = await this.pool.getConnection();
    try {
      // Map form field names to validator field names
      const templateForValidation = {
        name: templateData.template_name,
        label: templateData.label,
        category: templateData.category,
        language: templateData.language,
        type: templateData.template_type,
        header_type: templateData.header_type,
        text: templateData.body,
        footer: templateData.footer,
        sample_text: templateData.sample_text,
        quick_replies: templateData.quick_replies,
        call_to_action: templateData.call_to_action
      };

      // Validate template data
      const validation = this.validator.validate(templateForValidation, 'create');
      if (!validation.valid) {
        const error = new Error('Template validation failed');
        error.statusCode = 400;
        error.validationErrors = validation.errors;
        throw error;
      }

      this.logger.info('[Service] Creating template', {
        integrationId,
        templateName: templateData.template_name
      });

      // Get integration
      const integration = await this._getIntegration(organizationId, integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      // Map form data to AiSensy API format
      const aisensy_payload = this._mapFormToAiSensy(templateData);

      // Submit to AiSensy
      const aisensy_response = await this.aisensy.submitTemplate(
        integration.project_id,
        aisensy_payload,
        integration.project_api_password
      );

      this.logger.info('[Service] Template submitted to AiSensy', {
        integrationId,
        aisensy_template_id: aisensy_response.id,
        status: aisensy_response.status
      });

      // Store in local database for reference
      await conn.beginTransaction();

      // Extract media URLs for storage (if template type includes media)
      const templateType = (templateData.template_type || 'TEXT').toUpperCase();
      let mediaUrl = null;
      let videoUrl = null;
      let documentUrl = null;

      if (templateType === 'IMAGE' && templateData.header_content) {
        mediaUrl = templateData.header_content;
      }
      if (templateType === 'VIDEO' && templateData.header_content) {
        videoUrl = templateData.header_content;
      }
      if ((templateType === 'FILE' || templateType === 'DOCUMENT') && templateData.header_content) {
        documentUrl = templateData.header_content;
      }

      const [result] = await conn.query(
        `INSERT INTO whatsapp_templates (
          integration_id, organization_id, template_name, category, language,
          template_type, header_content, body, footer,
          buttons_json, sample_values_json, status, aisensy_template_id, created_by,
          media_url, video_url, document_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          integrationId,
          organizationId,
          templateData.template_name,
          templateData.category,
          templateData.language,
          templateData.template_type,
          templateData.header_content,
          templateData.body,
          templateData.footer,
          JSON.stringify(templateData.buttons || []),
          JSON.stringify(templateData.sample_values || {}),
          aisensy_response.status || 'PENDING',
          aisensy_response.id,
          organizationId,
          mediaUrl,
          videoUrl,
          documentUrl
        ]
      );

      const templateId = result.insertId;

      // Log in audit trail
      await conn.query(
        `INSERT INTO whatsapp_template_logs (
          template_id, integration_id, aisensy_template_id, action, status,
          api_request, api_response, created_at
        ) VALUES (?, ?, ?, 'CREATED', ?, ?, ?, NOW())`,
        [
          templateId,
          integrationId,
          aisensy_response.id,
          aisensy_response.status || 'PENDING',
          JSON.stringify(aisensy_payload),
          JSON.stringify(aisensy_response)
        ]
      );

      await conn.commit();

      return {
        id: templateId,
        aisensy_template_id: aisensy_response.id,
        template_name: templateData.template_name,
        status: aisensy_response.status || 'PENDING',
        ...aisensy_response
      };
    } catch (error) {
      await conn.rollback();
      this.logger.error('[Service] Failed to create template', {
        error: error.message,
        integrationId
      });
      throw error;
    } finally {
      conn.release();
    }
  }

  // ============= Template Deletion (Delete from AiSensy) =============

  /**
   * Delete template from AiSensy
   * @param {number} organizationId
   * @param {number} integrationId
   * @param {string} aisensy_template_id - AiSensy template ID
   * @returns {Promise<void>}
   */
  async deleteTemplate(organizationId, integrationId, aisensy_template_id) {
    const conn = await this.pool.getConnection();
    try {
      // Get integration
      const integration = await this._getIntegration(organizationId, integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      this.logger.info('[Service] Deleting template', {
        integrationId,
        templateId: aisensy_template_id
      });

      // ✅ FIX: Only delete from AiSensy if template has a valid aisensy_template_id
      // Templates created but not yet synced/submitted to AiSensy won't have this ID
      if (aisensy_template_id) {
        try {
          await this.aisensy.deleteTemplate(
            aisensy_template_id,
            integration.project_api_password
          );
          this.logger.info('[Service] Template deleted from AiSensy', { aisensy_template_id });
        } catch (aisensy_error) {
          // Log AiSensy error but continue with local deletion
          this.logger.warn('[Service] Failed to delete from AiSensy, continuing with local deletion', {
            error: aisensy_error.message,
            templateId: aisensy_template_id
          });
          // Don't throw - allow local deletion to proceed even if AiSensy delete fails
        }
      } else {
        this.logger.info('[Service] Template has no aisensy_template_id, skipping AiSensy deletion');
      }

      // Get template ID before soft deleting
      const [templates] = await conn.query(
        'SELECT id FROM whatsapp_templates WHERE aisensy_template_id = ? AND deleted_at IS NULL',
        [aisensy_template_id]
      );

      const templateId = templates.length > 0 ? templates[0].id : null;

      // Soft delete locally
      await conn.query(
        'UPDATE whatsapp_templates SET deleted_at = NOW() WHERE aisensy_template_id = ?',
        [aisensy_template_id]
      );

      // ✅ FIX: Log deletion only if we found a template to delete
      if (templateId) {
        await conn.query(
          `INSERT INTO whatsapp_template_logs (
            template_id, integration_id, aisensy_template_id, action, status, created_at
          ) VALUES (?, ?, ?, 'DELETED', 'DELETED', NOW())`,
          [templateId, integrationId, aisensy_template_id]
        );
      }

      this.logger.info('[Service] Template marked as deleted locally', {
        templateId,
        aisensy_template_id
      });
    } catch (error) {
      this.logger.error('[Service] Failed to delete template', {
        error: error.message,
        templateId: aisensy_template_id
      });
      throw error;
    } finally {
      conn.release();
    }
  }

  // ============= Sync Operations =============

  /**
   * Sync all templates from AiSensy to local database
   * @param {number} organizationId
   * @param {number} integrationId
   * @returns {Promise<object>} Sync result
   */
  async syncTemplates(organizationId, integrationId) {
    const conn = await this.pool.getConnection();
    try {
      this.logger.info('[Service] Starting template sync', { integrationId });

      // Get integration
      const integration = await this._getIntegration(organizationId, integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      // Fetch from AiSensy
      const result = await this.aisensy.syncTemplates(
        integration.project_id,
        integration.project_api_password
      );

      // Sync locally
      const syncResult = await this._syncTemplatesLocally(organizationId, integrationId, result.templates);

      // Update last sync timestamp
      await conn.query(
        'UPDATE integrations SET last_template_sync_at = NOW() WHERE id = ?',
        [integrationId]
      );

      this.logger.info('[Service] Sync complete', {
        integrationId,
        templateCount: result.templates.length,
        synced: syncResult.synced,
        updated: syncResult.updated
      });

      return {
        success: true,
        count: result.templates.length,
        synced: syncResult.synced,
        updated: syncResult.updated,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('[Service] Sync failed', {
        error: error.message,
        integrationId
      });
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Get template status counts
   * @param {number} organizationId
   * @param {number} integrationId
   * @returns {Promise<object>} Status counts
   */
  async getStatusCounts(organizationId, integrationId) {
    try {
      const [counts] = await this.pool.query(
        `SELECT
          status,
          COUNT(*) as count
        FROM whatsapp_templates
        WHERE integration_id = ? AND deleted_at IS NULL
        GROUP BY status`,
        [integrationId]
      );

      const result = {
        DRAFT: 0,
        PENDING: 0,
        APPROVED: 0,
        REJECTED: 0,
        ARCHIVED: 0
      };

      counts.forEach(row => {
        if (result.hasOwnProperty(row.status)) {
          result[row.status] = row.count;
        }
      });

      return result;
    } catch (error) {
      this.logger.error('[Service] Failed to get status counts', { error: error.message });
      throw error;
    }
  }

  // ============= Helper Methods =============

  /**
   * Get integration with decrypted credentials
   * @private
   */
  async _getIntegration(organizationId, integrationId) {
    const [integrations] = await this.pool.query(
      `SELECT id, organization_id, name, type, project_id, project_api_password, status
       FROM integrations
       WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [integrationId, organizationId]
    );

    if (integrations.length === 0) {
      return null;
    }

    const integration = integrations[0];

    // Validate required fields for AiSensy
    if (!integration.project_id || !integration.project_api_password) {
      throw new Error('Integration not configured with AiSensy credentials');
    }

    return integration;
  }

  /**
   * Sync AiSensy templates to local database (metadata only)
   * @private
   */
  async _syncTemplatesLocally(organizationId, integrationId, templates) {
    const conn = await this.pool.getConnection();
    let synced = 0;
    let updated = 0;

    try {
      for (const template of templates) {
        // Extract media URLs from template (from AiSensy response)
        const mediaUrl = template.header && template.header_type === 'IMAGE' ? template.header : null;
        const videoUrl = template.type === 'VIDEO' ? template.headerUrl || template.media_url : null;
        const documentUrl = (template.type === 'FILE' || template.type === 'DOCUMENT') ? template.headerUrl || template.media_url : null;

        // Check if exists
        const [existing] = await conn.query(
          'SELECT id FROM whatsapp_templates WHERE aisensy_template_id = ?',
          [template.id]
        );

        if (existing.length > 0) {
          // Update existing - also update media URLs if present
          await conn.query(
            `UPDATE whatsapp_templates
             SET status = ?, rejection_reason = ?, media_url = ?, video_url = ?, document_url = ?, last_synced_at = NOW()
             WHERE aisensy_template_id = ?`,
            [
              template.status,
              template.rejection_reason || null,
              mediaUrl,
              videoUrl,
              documentUrl,
              template.id
            ]
          );
          updated++;
        } else {
          // Insert new template with media URLs
          await conn.query(
            `INSERT INTO whatsapp_templates (
              integration_id, organization_id, aisensy_template_id, template_name,
              category, language, template_type, body, status, media_url, video_url, document_url,
              last_synced_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              integrationId,
              organizationId,
              template.id,
              template.name,
              template.category || 'MARKETING',
              template.language || 'English',
              template.type || 'TEXT',
              template.text || '', // body
              template.status || 'PENDING',
              mediaUrl,
              videoUrl,
              documentUrl
            ]
          );
          synced++;
        }
      }
    } finally {
      conn.release();
    }

    return { synced, updated };
  }

  /**
   * Map form data to AiSensy API format
   * @private
   */
  _mapFormToAiSensy(formData) {
    const payload = {
      name: formData.template_name.toLowerCase().trim(),
      label: formData.label || formData.template_name,
      category: formData.category.toUpperCase(),
      type: formData.template_type.toUpperCase(),
      language: formData.language,
      text: formData.body
    };

    // ✅ FIXED: sample_text is ALWAYS required by AiSensy
    // - If no variables: use the body text as-is
    // - If variables: use provided sample_text (already has values filled in)
    const hasVariables = /\{\{(\d+)\}\}/.test(formData.body);
    if (hasVariables) {
      // With variables, sample_text must have example values
      payload.sample_text = formData.sample_text || formData.body;
    } else {
      // Without variables, sample_text should be the same as body
      payload.sample_text = formData.body;
    }

    // Add optional fields
    if (formData.header_content) {
      payload.header = formData.header_content;
    }

    if (formData.footer) {
      payload.footer = formData.footer;
    }

    // ✅ FIXED: Only set message_action_type if there are actual replies/buttons
    if (formData.quick_replies && formData.quick_replies.length > 0) {
      payload.quick_replies = formData.quick_replies;
      payload.message_action_type = 'QuickReplies';
    } else if (formData.call_to_action && formData.call_to_action.length > 0) {
      payload.call_to_action = formData.call_to_action;
      payload.message_action_type = 'CTA';
    } else {
      payload.message_action_type = 'NONE';
    }

    return payload;
  }
}

export default WhatsAppTemplateService;
