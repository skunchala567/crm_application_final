// =====================================================
// Google Sheets Sync Service
// Handles import/export of leads from Google Sheets
// =====================================================

import { GoogleSheetsProvider } from './google-sheets-provider.js';
import { transformRow, transformCrmData, extractFieldMappings } from '../data-transformer.js';
import { decryptToken, getMasterKey } from '../crypto-utils.js';
import crypto from 'node:crypto';

export class GoogleSheetsSyncService {
  constructor(pool, logger = console) {
    this.pool = pool;
    this.logger = logger;
  }

  /**
   * Import leads from Google Sheets
   */
  async importLeads(integrationConfig, oauthToken, syncOptions = {}) {
    try {
      const startTime = Date.now();
      const result = {
        imported: 0,
        skipped: 0,
        updated: 0,
        reEnquired: 0,
        failed: 0,
        errors: [],
        duplicates: [],
        startTime,
        rows: []
      };

      // Decrypt OAuth token
      const masterKey = getMasterKey();
      let decryptedToken;
      try {
        decryptedToken = decryptToken(oauthToken.access_token, masterKey);
      } catch (error) {
        decryptedToken = oauthToken.access_token; // Fallback for unencrypted
      }

      // Initialize provider
      const providerConfig = {
        ...integrationConfig.config,
        spreadsheetId: syncOptions.spreadsheetId || integrationConfig.config.spreadsheetId
      };
      const provider = new GoogleSheetsProvider(providerConfig, decryptedToken, this.logger);

      // Fetch data from Google Sheets
      this.logger.info('Fetching data from Google Sheets', {
        spreadsheetId: providerConfig.spreadsheetId
      });

      const sheetData = await provider.fetchData({
        worksheetName: syncOptions.worksheetName || 'Sheet1'
      });

      if (!sheetData.data || sheetData.data.length === 0) {
        return { ...result, message: 'No data in worksheet' };
      }

      // Extract headers and data rows
      const headers = sheetData.data[0] || [];
      const dataRows = sheetData.data.slice(1) || [];

      if (dataRows.length === 0) {
        return { ...result, message: 'No data rows found' };
      }

      // Get field mappings
      const fieldMappings = syncOptions.fieldMappings || await this.getFieldMappings(integrationConfig.id);
      if (!fieldMappings || Object.keys(fieldMappings).length === 0) {
        return { ...result, message: 'No field mappings configured' };
      }

      // Process each row
      for (let i = 0; i < dataRows.length; i++) {
        try {
          const rowData = this.buildRowObject(headers, dataRows[i]);

          // Transform data
          const transformed = transformRow(rowData, fieldMappings);

          if (!transformed.isValid) {
            result.failed++;
            result.errors.push({
              rowNumber: i + 2,
              errors: transformed.errors
            });
            continue;
          }

          const normalizedPhone = String(transformed.data.phone || '').replace(/\D/g, '');
          const [[existingInBranch]] = await this.pool.execute(
            `SELECT id, lead_number FROM crm_leads
             WHERE branch_id=? AND normalized_phone=? AND deleted_at_utc IS NULL LIMIT 1`,
            [Number(syncOptions.branchId), normalizedPhone]
          );
          if (existingInBranch) {
            const [[sameSource]] = await this.pool.execute(
              'SELECT id FROM crm_lead_source_history WHERE lead_id=? AND source_id=? LIMIT 1',
              [existingInBranch.id, Number(transformed.data.source_id)]
            );
            if (sameSource) {
              const duplicate = { id: existingInBranch.id, leadNumber: existingInBranch.lead_number, matchType: 'mobile number in the same branch and source' };
              const reason = `Duplicate ${duplicate.matchType}; already exists as ${duplicate.leadNumber}`;
              result.duplicates.push({ rowNumber: i + 2, newData: transformed.data, existingId: duplicate.id, existingLeadNumber: duplicate.leadNumber, matchType: duplicate.matchType, reason });
              await this.recordSkippedLead(integrationConfig.id, syncOptions, i + 2, transformed.data, duplicate, reason);
              result.skipped++;
              continue;
            }
            await this.appendSecondarySource(existingInBranch.id, transformed.data, integrationConfig.organization_id, syncOptions.branchId);
            result.updated++;
            result.reEnquired++;
            continue;
          }

          // Create lead in CRM
          const leadId = await this.createLead(
            integrationConfig.organization_id,
            transformed.data,
            integrationConfig.id,
            syncOptions.branchId
          );

          result.imported++;
          result.rows.push({
            rowNumber: i + 2,
            leadId,
            data: transformed.data
          });
        } catch (error) {
          result.failed++;
          result.errors.push({
            rowNumber: i + 2,
            error: error.message
          });

          this.logger.error('Row import failed', { rowNumber: i + 2, error: error.message });
        }
      }

      const duration = Date.now() - startTime;

      result.message = `Import completed: ${result.imported} imported, ${result.reEnquired} re-enquired, ${result.skipped} skipped, ${result.failed} failed`;
      result.duration = duration;

      return result;
    } catch (error) {
      this.logger.error('Import failed', error);
      throw error;
    }
  }

  async recordSkippedLead(integrationId, syncOptions, rowNumber, leadData, duplicate, reason) {
    if (!syncOptions.sourceId) return;
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
      sourceId: syncOptions.sourceId,
      studentName: leadData.student_name || '',
      phone: String(leadData.phone || '').replace(/\D/g, '')
    })).digest('hex');
    await this.pool.execute(
      `INSERT INTO crm_integration_skipped_leads
        (integration_id, source_id, sheet_name, branch_id, branch_name, sheet_row_number,
         student_name, phone, reason, existing_lead_id, existing_lead_number, row_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason=VALUES(reason), existing_lead_id=VALUES(existing_lead_id),
         existing_lead_number=VALUES(existing_lead_number), sheet_row_number=VALUES(sheet_row_number),
         occurrence_count=occurrence_count+1, last_seen_at=CURRENT_TIMESTAMP(6)`,
      [
        integrationId, syncOptions.sourceId, syncOptions.sourceName || null,
        Number(syncOptions.branchId) || null, syncOptions.branchName || null, rowNumber,
        leadData.student_name || null, leadData.phone || null, reason,
        duplicate.id || null, duplicate.leadNumber || null, fingerprint
      ]
    );
  }

  async appendSecondarySource(leadId, data, userId, branchId) {
    const refs = await this.resolveLeadReferences(data, branchId);
    await this.pool.execute(
      `INSERT INTO crm_lead_source_history
       (lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id)
       VALUES(?,?,?,?,?,FALSE,'integration',?)`,
      [leadId, refs.academicYear, refs.sourceId, refs.channelId, refs.campaignId, Number(userId)]
    );
    await this.pool.execute(
      `UPDATE crm_leads SET re_enquired_at_utc=CURRENT_TIMESTAMP(6),updated_at_utc=CURRENT_TIMESTAMP(6),updated_by_user_id=? WHERE id=?`,
      [Number(userId), leadId]
    );
    await this.pool.execute(
      `INSERT INTO crm_lead_activities(lead_id,activity_type,summary,actor_user_id)
       VALUES(?,'re_enquired','Re-enquiry received from Google Sheets with a new source',?)`,
      [leadId, Number(userId)]
    );
  }

  async resolveLeadReferences(data, branchId) {
    const numericClassId = Number(data.class_id);
    const numericSourceId = Number(data.source_id);
    const numericSubstageId = Number(data.substage_id);
    const [[[classConfig]], [[campaign]], [[substage]], [[source]], [[channel]]] = await Promise.all([
      this.pool.execute(
        `SELECT c.id, c.display_name, acc.academic_year, acc.curriculum_id, acc.admission_type_id
         FROM crm_admission_class_configuration_details d
         JOIN crm_admission_class_configurations acc ON acc.id=d.configuration_id
         JOIN crm_classes c ON c.id=d.class_id
         WHERE d.class_id=? AND acc.branch_id=? AND d.is_active=TRUE AND acc.is_active=TRUE AND c.is_active=TRUE
         ORDER BY acc.academic_year DESC LIMIT 1`,
        [numericClassId, Number(branchId)]
      ),
      this.pool.execute('SELECT id FROM crm_campaigns WHERE LOWER(display_name)=LOWER(?) AND is_active=TRUE LIMIT 1', [String(data.campaign_name || '').trim()]),
      this.pool.execute('SELECT id, stage_id FROM crm_lead_substages WHERE id=? AND is_active=TRUE LIMIT 1', [numericSubstageId]),
      this.pool.execute('SELECT id, channel_id FROM crm_lead_sources WHERE id=? AND is_active=TRUE LIMIT 1', [numericSourceId]),
      this.pool.execute(
        `SELECT ch.id FROM crm_lead_sources s
         JOIN crm_lead_channels ch ON ch.id=s.channel_id AND ch.is_active=TRUE
         WHERE s.id=?
         UNION
         SELECT ch.id FROM crm_lead_source_history h
         JOIN crm_lead_channels ch ON ch.id=h.channel_id AND ch.is_active=TRUE
         WHERE h.source_id=? ORDER BY id LIMIT 1`,
        [numericSourceId, numericSourceId]
      )
    ]);
    if (!classConfig) throw new Error(`Class ID ${data.class_id} has no active academic configuration for this branch`);
    if (!campaign) throw new Error(`Campaign "${data.campaign_name}" was not found or is inactive`);
    if (!substage) throw new Error(`Sub-stage ID ${data.substage_id} was not found or is inactive`);
    if (!source) throw new Error(`Source ID ${data.source_id} was not found or is inactive`);
    if (!channel) throw new Error(`Source ID ${data.source_id} has no associated active channel`);
    return {
      classId: classConfig.id, className: classConfig.display_name,
      academicYear: classConfig.academic_year, curriculumId: classConfig.curriculum_id,
      admissionTypeId: classConfig.admission_type_id, campaignId: campaign.id,
      substageId: substage.id, stageId: substage.stage_id,
      sourceId: source.id, channelId: channel.id
    };
  }

  /**
   * Export CRM leads to Google Sheets
   */
  async exportLeads(integrationConfig, oauthToken, syncOptions = {}) {
    try {
      const startTime = Date.now();
      const result = {
        exported: 0,
        failed: 0,
        errors: [],
        startTime
      };

      // Decrypt OAuth token
      const masterKey = getMasterKey();
      let decryptedToken;
      try {
        decryptedToken = decryptToken(oauthToken.access_token, masterKey);
      } catch (error) {
        decryptedToken = oauthToken.access_token;
      }

      // Initialize provider
      const provider = new GoogleSheetsProvider(integrationConfig.config, decryptedToken, this.logger);

      // Get field mappings
      const fieldMappings = await this.getFieldMappings(integrationConfig.id);
      if (!fieldMappings || Object.keys(fieldMappings).length === 0) {
        throw new Error('No field mappings configured');
      }

      // Get leads from CRM
      const leads = await this.getLeadsForExport(
        integrationConfig.organization_id,
        syncOptions.since,
        syncOptions.limit || 1000
      );

      if (leads.length === 0) {
        return { ...result, message: 'No leads to export' };
      }

      // Transform and prepare data
      const dataToExport = [];

      // Add headers
      const headers = fieldMappings.map(m => m.external_field);
      dataToExport.push(headers);

      // Transform each lead
      for (const lead of leads) {
        try {
          const transformed = transformCrmData(lead, fieldMappings);
          const row = fieldMappings.map(m => transformed[m.external_field] || '');
          dataToExport.push(row);
          result.exported++;
        } catch (error) {
          result.failed++;
          result.errors.push({
            leadId: lead.id,
            error: error.message
          });
        }
      }

      // Send to Google Sheets
      const sheetResult = await provider.sendData({
        worksheetName: syncOptions.worksheetName || 'CRM_Export',
        values: dataToExport
      });

      const duration = Date.now() - startTime;

      result.message = `Export completed: ${result.exported} leads exported, ${result.failed} failed`;
      result.duration = duration;
      result.rowsAdded = sheetResult.rowsAdded;

      return result;
    } catch (error) {
      this.logger.error('Export failed', error);
      throw error;
    }
  }

  /**
   * Get field mappings for integration
   * CONSOLIDATED: Uses single 'integrations' table (migration 005)
   */
  async getFieldMappings(integrationId) {
    // Field mappings are saved in the config.fieldMappings object
    // Format: { "sheet_0": "student_name", "sheet_1": "phone", ... }
    const [configs] = await this.pool.execute(
      'SELECT config FROM crm_integrations WHERE id = ?',
      [integrationId]
    );

    if (!configs || configs.length === 0) {
      return [];
    }

    try {
      const rawConfig = configs[0].config ?? configs[0].config_json ?? {};
      const config = typeof rawConfig === 'string' ? JSON.parse(rawConfig || '{}') : rawConfig;
      const fieldMappings = config.fieldMappings || {};

      // Convert to internal format expected by transformRow
      // fieldMappings is { "sheet_0": "student_name", "sheet_1": "phone", ... }
      return fieldMappings; // Return as-is since transformRow expects this format
    } catch (error) {
      this.logger.error('Failed to parse field mappings', error);
      return {};
    }
  }

  /**
   * Build row object from headers and data
   */
  buildRowObject(headers, row) {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = row[i] || '';
    }
    return obj;
  }

  /**
   * Create lead in CRM
   */
  async createLead(organizationId, leadData, integrationId, branchId) {
    const {
      student_name,
      phone,
      class_id,
      campaign_name,
      source_id,
      substage_id,
      assign_to,
      remarks
    } = leadData;

    const numericClassId = Number(class_id);
    const numericSubstageId = Number(substage_id);
    const numericBranchId = Number(branchId);
    if (!student_name || !phone || !numericClassId || !campaign_name || !source_id || !numericSubstageId || !assign_to) {
      throw new Error('All required Google Sheets lead fields must be provided');
    }

    const [refs, [[owner]]] = await Promise.all([
      this.resolveLeadReferences(leadData, numericBranchId),
      this.pool.execute(
        `SELECT e.id FROM app_users u JOIN employees e ON e.id=u.employee_id
         WHERE LOWER(u.email)=LOWER(?) AND u.is_active=TRUE AND e.status='Active' LIMIT 1`,
        [String(assign_to).trim()]
      )
    ]);
    if (!owner) throw new Error(`Active CRM user "${assign_to}" was not found`);

    // Generate unique lead_number: LEAD-YYYYMMDD-XXXXXX
    const now = new Date();
    const date = now.toISOString().split('T')[0].replace(/-/g, '');
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    const leadNumber = `LEAD-${date}-${random}`;

    const [result] = await this.pool.execute(
      `INSERT INTO crm_leads (
        lead_number, branch_id, student_name, phone, normalized_phone,
        applying_class, class_id, curriculum_id, academic_year, source_id, channel_id, campaign_id,
        admission_type_id, stage_id, substage_id,
        owner_employee_id, remarks, status,
        created_by_user_id, created_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, CURRENT_TIMESTAMP(6))`,
      [
        leadNumber,
        numericBranchId,
        String(student_name).trim(),
        String(phone).trim(),
        String(phone).replace(/\D/g, ''),
        refs.className,
        refs.classId,
        refs.curriculumId,
        refs.academicYear,
        refs.sourceId,
        refs.channelId,
        refs.campaignId,
        refs.admissionTypeId,
        refs.stageId,
        refs.substageId,
        owner.id,
        remarks ? String(remarks).trim() : null,
        Number(organizationId) || 1
      ]
    );
    await this.pool.execute(
      `INSERT INTO crm_lead_source_history
       (lead_id,academic_year,source_id,channel_id,campaign_id,is_primary,intake_method,created_by_user_id)
       VALUES(?,?,?,?,?,TRUE,'integration',?)`,
      [result.insertId, refs.academicYear, refs.sourceId, refs.channelId, refs.campaignId, Number(organizationId) || 1]
    );

    return result.insertId;
  }

  /**
   * Update existing lead
   */
  async updateLead(leadId, leadData) {
    const {
      student_name,
      phone,
      class_id,
      remarks
    } = leadData;

    await this.pool.execute(
      `UPDATE crm_leads SET
        student_name = COALESCE(?, student_name), phone = COALESCE(?, phone),
        normalized_phone = COALESCE(?, normalized_phone), class_id = COALESCE(?, class_id),
        remarks = COALESCE(?, remarks)
      WHERE id = ?`,
      [
        student_name || null,
        phone || null,
        phone ? String(phone).replace(/\D/g, '') : null,
        Number(class_id) || null,
        remarks || null,
        leadId
      ]
    );
  }

  /**
   * Get leads for export
   */
  async getLeadsForExport(organizationId, since = null, limit = 1000) {
    let query = 'SELECT * FROM crm_leads WHERE 1=1';
    const params = [];

    if (since) {
      query += ' AND updated_at >= ?';
      params.push(new Date(since));
    }

    query += ` ORDER BY updated_at DESC LIMIT ${limit}`;

    const [rows] = await this.pool.execute(query, params);
    return rows || [];
  }
}
