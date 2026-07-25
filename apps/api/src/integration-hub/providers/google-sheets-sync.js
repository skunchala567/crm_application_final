// =====================================================
// Google Sheets Sync Service
// Handles import/export of leads from Google Sheets
// =====================================================

import { GoogleSheetsProvider } from './google-sheets-provider.js';
import { transformRow, transformCrmData, extractFieldMappings } from '../data-transformer.js';
import { DuplicateDetector, DUPLICATE_DETECTION_STRATEGIES } from '../duplicate-detector.js';
import { decryptToken, getMasterKey } from '../crypto-utils.js';

export class GoogleSheetsSyncService {
  constructor(pool, logger = console) {
    this.pool = pool;
    this.logger = logger;
    this.duplicateDetector = new DuplicateDetector(pool);
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
      const provider = new GoogleSheetsProvider(integrationConfig.config, decryptedToken, this.logger);

      // Fetch data from Google Sheets
      this.logger.info('Fetching data from Google Sheets', {
        spreadsheetId: integrationConfig.config.spreadsheetId
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
      const fieldMappings = await this.getFieldMappings(integrationConfig.id);
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

          // Check for duplicates
          const duplicate = await this.duplicateDetector.findDuplicate(
            null, // organizationId not used
            transformed.data,
            syncOptions.duplicateDetection || 'all'
          );

          const duplicateAction = syncOptions.duplicateAction || DUPLICATE_DETECTION_STRATEGIES.skip;

          if (duplicate) {
            result.duplicates.push({
              rowNumber: i + 2,
              newData: transformed.data,
              existingId: duplicate.id,
              matchType: duplicate.matchType
            });

            if (duplicateAction === DUPLICATE_DETECTION_STRATEGIES.skip) {
              result.skipped++;
              continue;
            } else if (duplicateAction === DUPLICATE_DETECTION_STRATEGIES.update) {
              // Update existing lead
              await this.updateLead(duplicate.id, transformed.data);
              result.imported++;
              continue;
            }
            // For create_new, continue to import anyway
          }

          // Create lead in CRM
          const leadId = await this.createLead(
            null, // organizationId not used
            transformed.data,
            integrationConfig.id
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

      result.message = `Import completed: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`;
      result.duration = duration;

      return result;
    } catch (error) {
      this.logger.error('Import failed', error);
      throw error;
    }
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
      'SELECT config FROM integrations WHERE id = ?',
      [integrationId]
    );

    if (!configs || configs.length === 0) {
      return [];
    }

    try {
      const config = JSON.parse(configs[0].config_json || '{}');
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
  async createLead(organizationId, leadData, integrationId) {
    const {
      student_name,
      email,
      phone,
      applying_class,
      parent_name,
      city,
      alternate_phone,
      lead_score
    } = leadData;

    // Generate unique lead_number: LEAD-YYYYMMDD-XXXXXX
    const now = new Date();
    const date = now.toISOString().split('T')[0].replace(/-/g, '');
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    const leadNumber = `LEAD-${date}-${random}`;

    const [result] = await this.pool.execute(
      `INSERT INTO crm_leads (
        lead_number, branch_id, student_name, email, phone, alternate_phone,
        applying_class, parent_name, city, lead_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leadNumber,
        2, // Default branch_id
        student_name || null,
        email || null,
        phone || null,
        alternate_phone || null,
        applying_class || null,
        parent_name || null,
        city || null,
        lead_score ? parseInt(lead_score) : null
      ]
    );

    return result.insertId;
  }

  /**
   * Update existing lead
   */
  async updateLead(leadId, leadData) {
    const {
      student_name,
      email,
      phone,
      alternate_phone,
      applying_class,
      parent_name,
      city,
      lead_score
    } = leadData;

    await this.pool.execute(
      `UPDATE crm_leads SET
        student_name = ?, email = ?, phone = ?, alternate_phone = ?,
        applying_class = ?, parent_name = ?, city = ?, lead_score = ?
      WHERE id = ?`,
      [
        student_name || null,
        email || null,
        phone || null,
        alternate_phone || null,
        applying_class || null,
        parent_name || null,
        city || null,
        lead_score ? parseInt(lead_score) : null,
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
