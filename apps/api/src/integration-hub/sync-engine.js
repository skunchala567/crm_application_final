// =====================================================
// Data Sync Engine
// Handles bidirectional sync between Google Sheets and CRM
// =====================================================

import axios from 'axios';
import { ValidationError } from './base-provider.js';

export class SyncEngine {
  constructor(pool, logger = console) {
    this.pool = pool;
    this.logger = logger;
  }

  // ============= Import (Sheets → CRM) =============

  async importFromSheets(integrationId, organizationId, accessToken, config) {
    try {
      if (!config.spreadsheetId) throw new Error('No spreadsheet selected');
      if (!config.fieldMappings) throw new Error('No field mappings configured');

      this.logger.log('Starting import from Google Sheets');

      // Fetch data from sheet (skip header row)
      const sheetData = await this.fetchSheetData(
        config.spreadsheetId,
        accessToken
      );

      if (!sheetData || sheetData.length === 0) {
        return { success: true, imported: 0, duplicates: 0, errors: 0 };
      }

      // Transform sheet data to CRM format using field mappings
      const leadRecords = this.transformSheetDataToCRM(
        sheetData,
        config.fieldMappings
      );

      // Check for duplicates
      const { newRecords, duplicates } = await this.detectDuplicates(
        leadRecords,
        organizationId
      );

      // Import new records
      const importResult = await this.insertLeads(
        newRecords,
        organizationId
      );

      this.logger.log('Import completed', {
        imported: importResult.imported,
        duplicates: duplicates.length,
        errors: importResult.errors
      });

      return {
        success: true,
        imported: importResult.imported,
        duplicates: duplicates.length,
        errors: importResult.errors,
        message: `Imported ${importResult.imported} leads, found ${duplicates.length} duplicates`
      };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.logger.error('Import failed', { message: errorMsg });
      throw new ValidationError('Import failed: ' + errorMsg);
    }
  }

  async fetchSheetData(spreadsheetId, accessToken) {
    try {
      const response = await axios.get(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      const values = response.data.values || [];
      if (values.length <= 1) return []; // Only headers or empty

      // Skip header row, return data rows
      return values.slice(1);
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      throw new ValidationError('Failed to fetch sheet data: ' + errorMsg);
    }
  }

  transformSheetDataToCRM(sheetData, fieldMappings) {
    return sheetData.map((row) => {
      const record = {};

      // Apply field mappings
      Object.entries(fieldMappings).forEach(([sheetColKey, crmField]) => {
        const colIndex = parseInt(sheetColKey.replace('sheet_', ''));
        const value = row[colIndex];

        if (value && crmField) {
          record[crmField] = value;
        }
      });

      return record;
    }).filter(record => Object.keys(record).length > 0);
  }

  async detectDuplicates(leadRecords, organizationId) {
    try {
      const newRecords = [];
      const duplicates = [];

      for (const record of leadRecords) {
        // Check for existing lead by phone or email
        const isDuplicate = await this.findExistingLead(
          record,
          organizationId
        );

        if (isDuplicate) {
          duplicates.push(record);
        } else {
          newRecords.push(record);
        }
      }

      return { newRecords, duplicates };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.logger.error('Duplicate detection failed', { message: errorMsg });
      throw error;
    }
  }

  async findExistingLead(record, organizationId) {
    try {
      let query = 'SELECT id FROM crm_leads WHERE deleted_at_utc IS NULL AND ';
      const params = [];

      if (record.phone) {
        query += 'phone = ?';
        params.push(record.phone);
      } else if (record.email) {
        query += 'email = ?';
        params.push(record.email);
      } else if (record.student_name) {
        query += 'student_name = ?';
        params.push(record.student_name);
      } else {
        return false; // No unique identifier
      }

      const [rows] = await this.pool.execute(query, params);
      return rows.length > 0;
    } catch (error) {
      this.logger.error('Error checking for existing lead', { message: error.message });
      return false;
    }
  }

  async insertLeads(leadRecords, organizationId) {
    let imported = 0;
    let errors = 0;

    for (const record of leadRecords) {
      try {
        // Get default branch and stage
        const [branches] = await this.pool.execute(
          'SELECT id FROM branches LIMIT 1'
        );
        const [stages] = await this.pool.execute(
          'SELECT id FROM crm_lead_stages WHERE is_active = true LIMIT 1'
        );

        if (!branches.length || !stages.length) {
          throw new Error('Default branch or stage not found');
        }

        const leadNumber = `IMPORT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        await this.pool.execute(`
          INSERT INTO crm_leads (
            lead_number, branch_id, student_name, phone, email,
            alternate_phone, applying_class, parent_name, city,
            stage_id, status, lead_score, source_id, created_by_user_id, created_at_utc
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
        `, [
          leadNumber,
          branches[0].id,
          record.student_name || null,
          record.phone || null,
          record.email || null,
          record.alternate_phone || null,
          record.applying_class || null,
          record.parent_name || null,
          record.city || null,
          stages[0].id,
          'Active',
          record.lead_score ? parseInt(record.lead_score) : 0,
          1,
          organizationId || 1
        ]);

        imported++;
      } catch (error) {
        errors++;
        this.logger.error('Error inserting lead', {
          message: error.message,
          record: record.student_name
        });
      }
    }

    return { imported, errors };
  }

  // ============= Export (CRM → Sheets) =============

  async exportToSheets(integrationId, organizationId, accessToken, config) {
    try {
      if (!config.spreadsheetId) throw new Error('No spreadsheet selected');

      this.logger.log('Starting export to Google Sheets');

      // Fetch leads from CRM
      const leads = await this.fetchLeadsFromCRM(organizationId);

      if (leads.length === 0) {
        return { success: true, exported: 0 };
      }

      // Append to sheet
      const result = await this.appendToSheet(
        config.spreadsheetId,
        leads,
        accessToken
      );

      this.logger.log('Export completed', { exported: leads.length });

      return {
        success: true,
        exported: leads.length,
        message: `Exported ${leads.length} leads to Google Sheets`
      };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      this.logger.error('Export failed', { message: errorMsg });
      throw new ValidationError('Export failed: ' + errorMsg);
    }
  }

  async fetchLeadsFromCRM(organizationId) {
    try {
      const [rows] = await this.pool.execute(`
        SELECT
          id, lead_number, student_name, phone, alternate_phone, email,
          applying_class, parent_name, city, lead_score
        FROM crm_leads
        WHERE deleted_at_utc IS NULL
        LIMIT 100
      `);

      return rows || [];
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      throw new ValidationError('Failed to fetch leads: ' + errorMsg);
    }
  }

  async appendToSheet(spreadsheetId, leads, accessToken) {
    try {
      // Format leads as rows
      const values = leads.map(lead => [
        lead.lead_number,
        lead.student_name || '',
        lead.phone || '',
        lead.alternate_phone || '',
        lead.email || '',
        lead.applying_class || '',
        lead.parent_name || '',
        lead.city || '',
        lead.lead_score || 0
      ]);

      const response = await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:I:append?valueInputOption=RAW`,
        { values },
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      return { updatedRows: response.data.updates.updatedRows };
    } catch (error) {
      const errorMsg = error.message || 'Unknown error';
      throw new ValidationError('Failed to append to sheet: ' + errorMsg);
    }
  }
}
