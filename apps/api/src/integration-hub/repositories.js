// =====================================================
// Integration Hub Repositories
// Data access layer for integration operations
// =====================================================

// =====================================================
// IntegrationRepository
// CONSOLIDATED: Uses single 'integrations' table as source of truth
// DO NOT use crm_integration_configs - it has been deprecated
// =====================================================

export class IntegrationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  // Map old ENUM status values to new status values for consistent frontend API
  normalizeStatus(oldStatus) {
    const reverseMap = {
      'INACTIVE': 'inactive',
      'CONNECTED': 'active',
      'DISCONNECTED': 'disconnected',
      'ERROR': 'error',
      'ACTIVE': 'active'
    };
    return reverseMap[oldStatus] || oldStatus;
  }

  // Map new integration type names to old ENUM values
  mapIntegrationType(newType) {
    // Old schema ENUM: 'SMARTPING', 'WHATSAPP', 'EMAIL', 'SMS', 'SLACK'
    // New types: 'google_sheets', 'smartping', 'whatsapp', 'meta', etc.
    const typeMap = {
      'google_sheets': 'EMAIL',       // Map to EMAIL for now (generic category)
      'smartping': 'SMARTPING',
      'whatsapp': 'WHATSAPP',
      'meta': 'WHATSAPP',            // Meta (Facebook) is WhatsApp-related
      'email': 'EMAIL',
      'sms': 'SMS',
      'slack': 'SLACK'
    };
    const mapped = typeMap[newType?.toLowerCase()];
    if (!mapped) {
      console.warn(`Unknown integration type "${newType}", defaulting to EMAIL`);
      return 'EMAIL';
    }
    return mapped;
  }

  // Reverse map: convert old ENUM type back to new type name
  normalizeType(oldType) {
    const reverseMap = {
      'SMARTPING': 'smartping',
      'WHATSAPP': 'whatsapp',
      'EMAIL': 'google_sheets',      // Assume EMAIL type is google_sheets
      'SMS': 'sms',
      'SLACK': 'slack'
    };
    return reverseMap[oldType] || oldType?.toLowerCase();
  }

  async list(organizationId, filters = {}) {
    const whereConditions = ['organization_id = ?'];
    const params = [organizationId];

    if (filters.status) {
      whereConditions.push('status = ?');
      params.push(filters.status);
    }

    if (filters.type) {
      // Use old column name 'type' (works with current schema)
      // Will work with new schema after migration 005 adds integration_type
      whereConditions.push('type = ?');
      params.push(filters.type);
    }

    if (filters.provider) {
      // Use old column name 'provider' (works with current schema)
      // Will work with new schema after migration 005 adds provider_name
      whereConditions.push('provider = ?');
      params.push(filters.provider);
    }

    let query = `SELECT * FROM crm_integrations WHERE ${whereConditions.join(' AND ')} ORDER BY created_at DESC`;

    if (filters.limit) {
      const offset = ((filters.page || 1) - 1) * filters.limit;
      query += ` LIMIT ${filters.limit} OFFSET ${offset}`;
    }

    const [rows] = await this.pool.execute(query, params);

    // Normalize field names for all rows (same normalization as getById)
    return (rows || []).map(row => {
      // Handle config parsing
      let configData = {};
      if (row.config) {
        configData = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
      } else if (row.config_json) {
        configData = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
      }
      if ((row.provider_name || row.provider)?.toLowerCase() === 'smartping') {
        configData = {
          ...configData,
          projectId: row.project_id || configData.projectId,
          projectApiPassword: row.project_api_password || configData.projectApiPassword,
          baseUrl: row.aisensy_base_url || configData.baseUrl,
          apiKey: row.aisensy_api_key || configData.apiKey,
          mediaPublicBaseUrl: row.media_public_base_url || configData.mediaPublicBaseUrl
        };
      }
      if ((row.provider_name || row.provider)?.toLowerCase() === 'google_sheets') {
        configData = {
          ...configData,
          clientId: row.google_client_id || configData.clientId,
          clientSecret: row.google_client_secret || configData.clientSecret,
          redirectUrl: row.google_redirect_uri || configData.redirectUrl
        };
      }

      // Normalize field names to support both old schema and migration 005 schema
      return {
        id: row.id,
        uuid: row.uuid || undefined,
        organization_id: row.organization_id,
        integration_type: row.integration_type || this.normalizeType(row.type),  // NEW or map old ENUM
        provider_name: row.provider_name || row.provider,    // NEW or OLD
        integration_name: row.integration_name || row.name,  // NEW or OLD
        status: this.normalizeStatus(row.status),  // Map old ENUM to new string format
        config: configData,
        last_synced_at: row.last_synced_at || row.last_sync_at,
        next_sync_at: row.next_sync_at,
        is_webhook_active: row.is_webhook_active,
        webhook_url: row.webhook_url,
        webhook_secret: row.webhook_secret,
        created_by_id: row.created_by_id || row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        // Include old schema fields for backward compatibility
        type: row.type,
        provider: row.provider,
        name: row.name,
        description: row.description,
        api_key: row.api_key,
        api_secret: row.api_secret,
        connected_at: row.connected_at,
        last_sync_at: row.last_sync_at,
        created_by: row.created_by,
        updated_by: row.updated_by,
        deleted_at: row.deleted_at
      };
    });
  }

  async getById(integrationId, organizationId) {
    const [rows] = await this.pool.execute(`
      SELECT * FROM crm_integrations
      WHERE id = ? AND organization_id = ?
      LIMIT 1
    `, [integrationId, organizationId]);

    if (!rows.length) return null;

    const row = rows[0];

    // Handle config parsing (supports both 'config' and 'config_json' column names)
    let configData = {};
    if (row.config) {
      configData = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
    } else if (row.config_json) {
      configData = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json;
    }
    if ((row.provider_name || row.provider)?.toLowerCase() === 'smartping') {
      configData = {
        ...configData,
        projectId: row.project_id || configData.projectId,
        projectApiPassword: row.project_api_password || configData.projectApiPassword,
        baseUrl: row.aisensy_base_url || configData.baseUrl,
        apiKey: row.aisensy_api_key || configData.apiKey,
        mediaPublicBaseUrl: row.media_public_base_url || configData.mediaPublicBaseUrl
      };
    }
    if ((row.provider_name || row.provider)?.toLowerCase() === 'google_sheets') {
      configData = {
        ...configData,
        clientId: row.google_client_id || configData.clientId,
        clientSecret: row.google_client_secret || configData.clientSecret,
        redirectUrl: row.google_redirect_uri || configData.redirectUrl
      };
    }

    // Normalize field names to support both old schema and migration 005 schema
    // OLD SCHEMA (before migration 005): type ENUM, provider, name, status ENUM
    // NEW SCHEMA (after migration 005): integration_type VARCHAR, provider_name, integration_name, uuid, status VARCHAR
    return {
      id: row.id,
      uuid: row.uuid || undefined,  // Only in new schema
      organization_id: row.organization_id,
      integration_type: row.integration_type || this.normalizeType(row.type),  // NEW or map old ENUM
      provider_name: row.provider_name || row.provider,    // NEW or OLD
      integration_name: row.integration_name || row.name,  // NEW or OLD
      status: this.normalizeStatus(row.status),  // Map old ENUM to new string format
      config: configData,
      last_synced_at: row.last_synced_at || row.last_sync_at,
      next_sync_at: row.next_sync_at,  // Only in new schema
      is_webhook_active: row.is_webhook_active,  // Only in new schema
      webhook_url: row.webhook_url,  // Only in new schema
      webhook_secret: row.webhook_secret,  // Only in new schema
      created_by_id: row.created_by_id || row.created_by,  // Support both
      created_at: row.created_at,
      updated_at: row.updated_at,
      // Include old schema fields for backward compatibility
      type: row.type,
      provider: row.provider,
      name: row.name,
      description: row.description,
      api_key: row.api_key,
      api_secret: row.api_secret,
      connected_at: row.connected_at,
      last_sync_at: row.last_sync_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
      deleted_at: row.deleted_at
    };
  }

  async create(integrationData) {
    const {
      organizationId, integrationName, integrationType, providerName,
      config, createdById, status = 'pending_auth'
    } = integrationData;

    if (!organizationId || !integrationName || !integrationType || !providerName) {
      throw new Error('Missing required fields: organizationId, integrationName, integrationType, providerName');
    }

    // Map new status values to old ENUM values
    // Old schema: ENUM('ACTIVE', 'INACTIVE', 'CONNECTED', 'DISCONNECTED', 'ERROR')
    // New schema: VARCHAR(50) allows any status value
    const statusMap = {
      'pending_auth': 'INACTIVE',      // Not yet connected
      'active': 'CONNECTED',            // Successfully connected
      'inactive': 'INACTIVE',           // Explicitly disabled
      'error': 'ERROR',                 // Error state
      'disconnected': 'DISCONNECTED'    // Was connected but now disconnected
    };
    const mappedStatus = statusMap[status?.toLowerCase()] || 'INACTIVE';
    const mappedType = this.mapIntegrationType(integrationType);
    const isSmartping = providerName?.toLowerCase() === 'smartping';
    const projectId = isSmartping ? (config?.projectId || config?.project_id || null) : null;
    const projectApiPassword = isSmartping
      ? (config?.projectApiPassword || config?.project_api_password || null)
      : null;
    const aisensyBaseUrl = isSmartping ? (config?.baseUrl || config?.aisensyBaseUrl || null) : null;
    const aisensyApiKey = isSmartping ? (config?.apiKey || config?.aisensyApiKey || null) : null;
    const mediaPublicBaseUrl = isSmartping ? (config?.mediaPublicBaseUrl || null) : null;
    const isGoogleSheets = providerName?.toLowerCase() === 'google_sheets';
    const googleClientId = isGoogleSheets ? (config?.clientId || null) : null;
    const googleClientSecret = isGoogleSheets ? (config?.clientSecret || null) : null;
    const googleRedirectUri = isGoogleSheets ? (config?.redirectUrl || null) : null;
    const storedConfig = { ...(config || {}) };
    if (isSmartping) {
      ['projectId', 'project_id', 'projectApiPassword', 'project_api_password', 'baseUrl', 'aisensyBaseUrl', 'apiKey', 'aisensyApiKey', 'mediaPublicBaseUrl']
        .forEach(key => delete storedConfig[key]);
    }
    if (isGoogleSheets) {
      ['clientId', 'clientSecret', 'redirectUrl'].forEach(key => delete storedConfig[key]);
    }

    // Use old column names (type, provider, name) since they exist in current schema
    // Migration 005 will add new columns (integration_type, provider_name, integration_name)
    const [result] = await this.pool.execute(`
      INSERT INTO crm_integrations
        (organization_id, name, type, provider, config, project_id, project_api_password,
         aisensy_base_url, aisensy_api_key, media_public_base_url,
         google_client_id, google_client_secret, google_redirect_uri,
         status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      organizationId,
      integrationName,
      mappedType,  // Map new type to old ENUM value
      providerName,
      JSON.stringify(storedConfig),
      projectId,
      projectApiPassword,
      aisensyBaseUrl,
      aisensyApiKey,
      mediaPublicBaseUrl,
      googleClientId,
      googleClientSecret,
      googleRedirectUri,
      mappedStatus,
      createdById || null
    ]);

    return this.getById(result.insertId, organizationId);
  }

  async update(integrationId, organizationId, updateData) {
    const { integrationName, config, status } = updateData;
    const updates = [];
    const params = [];

    // Use old column names (name) since they exist in current schema
    if (integrationName !== undefined) {
      updates.push('name = ?');
      params.push(integrationName);
    }
    if (config !== undefined) {
      const storedConfig = { ...(config || {}) };
      ['projectId', 'project_id', 'projectApiPassword', 'project_api_password', 'baseUrl', 'aisensyBaseUrl', 'apiKey', 'aisensyApiKey', 'mediaPublicBaseUrl']
        .forEach(key => delete storedConfig[key]);
      ['clientId', 'clientSecret', 'redirectUrl'].forEach(key => delete storedConfig[key]);
      updates.push('config = ?');
      params.push(JSON.stringify(storedConfig));

      const current = await this.getById(integrationId, organizationId);
      if (current?.provider_name?.toLowerCase() === 'smartping') {
        updates.push('project_id = ?');
        params.push(config?.projectId || config?.project_id || null);
        updates.push('project_api_password = ?');
        params.push(config?.projectApiPassword || config?.project_api_password || null);
        updates.push('aisensy_base_url = ?');
        params.push(config?.baseUrl || config?.aisensyBaseUrl || null);
        updates.push('aisensy_api_key = ?');
        params.push(config?.apiKey || config?.aisensyApiKey || null);
        updates.push('media_public_base_url = ?');
        params.push(config?.mediaPublicBaseUrl || null);
      }
      if (current?.provider_name?.toLowerCase() === 'google_sheets') {
        updates.push('google_client_id = ?');
        params.push(config?.clientId || null);
        updates.push('google_client_secret = ?');
        params.push(config?.clientSecret || null);
        updates.push('google_redirect_uri = ?');
        params.push(config?.redirectUrl || null);
      }
    }
    if (status !== undefined) {
      // Map new status values to old ENUM values
      const statusMap = {
        'pending_auth': 'INACTIVE',
        'active': 'CONNECTED',
        'inactive': 'INACTIVE',
        'error': 'ERROR',
        'disconnected': 'DISCONNECTED'
      };
      const mappedStatus = statusMap[status?.toLowerCase()] || status;
      updates.push('status = ?');
      params.push(mappedStatus);
    }

    if (updates.length === 0) return this.getById(integrationId, organizationId);

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(integrationId);
    params.push(organizationId);

    await this.pool.execute(`
      UPDATE crm_integrations
      SET ${updates.join(', ')}
      WHERE id = ? AND organization_id = ?
    `, params);

    return this.getById(integrationId, organizationId);
  }

  async updateSyncStatus(integrationId, organizationId, syncData) {
    const { lastSyncedAt, status } = syncData;

    // Map new status values to old ENUM values
    const statusMap = {
      'pending_auth': 'INACTIVE',
      'active': 'CONNECTED',
      'inactive': 'INACTIVE',
      'error': 'ERROR',
      'disconnected': 'DISCONNECTED'
    };
    const mappedStatus = status ? (statusMap[status?.toLowerCase()] || status) : 'CONNECTED';

    // Use old column name (last_sync_at) since it exists in current schema
    // Migration 005 will add next_sync_at column
    await this.pool.execute(`
      UPDATE crm_integrations
      SET last_sync_at = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `, [lastSyncedAt, mappedStatus, integrationId, organizationId]);

    return this.getById(integrationId, organizationId);
  }

  async updateWebhook(integrationId, organizationId, webhookData) {
    // Note: Webhook columns (is_webhook_active, webhook_url, webhook_secret)
    // are only added in migration 005. This is a no-op for older schemas.
    // TODO: Implement after migration 005 is applied
    console.warn('updateWebhook: Webhook columns not available in current schema. Migration 005 required.');
    return;
  }

  async delete(integrationId, organizationId) {
    const [result] = await this.pool.execute(`
      UPDATE crm_integrations
      SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `, [integrationId, organizationId]);

    return result.affectedRows > 0;
  }
}

// Backward compatibility alias
export const IntegrationConfigRepository = IntegrationRepository;

export class OAuthTokenRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async save(integrationConfigId, tokenData) {
    const { providerName, accessToken, refreshToken, tokenType, expiresAt, scope } = tokenData;

    // Check if integration_id column exists (new schema after migration 005)
    const [columns] = await this.pool.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'crm_integration_oauth_tokens' AND TABLE_SCHEMA = DATABASE()"
    );
    const hasIntegrationIdColumn = columns.some(col => col.COLUMN_NAME === 'integration_id');

    // Determine which column to use
    const idColumnName = hasIntegrationIdColumn ? 'integration_id' : 'integration_config_id';

    // Check if exists
    const [existing] = await this.pool.execute(
      `SELECT id FROM crm_integration_oauth_tokens WHERE ${idColumnName} = ? LIMIT 1`,
      [integrationConfigId]
    );

    if (existing.length > 0) {
      // Update
      await this.pool.execute(`
        UPDATE crm_integration_oauth_tokens
        SET access_token = ?, refresh_token = ?, token_type = ?, expires_at = ?, scope = ?, updated_at = CURRENT_TIMESTAMP
        WHERE ${idColumnName} = ?
      `, [accessToken, refreshToken, tokenType, expiresAt, scope, integrationConfigId]);
    } else {
      // Create - try new schema first (migration 005), fall back to old schema
      if (hasIntegrationIdColumn) {
        await this.pool.execute(`
          INSERT INTO crm_integration_oauth_tokens
            (integration_id, provider_name, access_token, refresh_token, token_type, expires_at, scope, obtained_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [integrationConfigId, providerName, accessToken, refreshToken, tokenType, expiresAt, scope]);
      } else {
        // Old schema - disable foreign key check temporarily if the integration is in integrations table
        await this.pool.execute('SET FOREIGN_KEY_CHECKS=0');
        try {
          await this.pool.execute(`
            INSERT INTO crm_integration_oauth_tokens
              (integration_config_id, provider_name, access_token, refresh_token, token_type, expires_at, scope, obtained_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `, [integrationConfigId, providerName, accessToken, refreshToken, tokenType, expiresAt, scope]);
        } finally {
          await this.pool.execute('SET FOREIGN_KEY_CHECKS=1');
        }
      }
    }
  }

  async get(integrationConfigId) {
    // Check if integration_id column exists (new schema after migration 005)
    const [columns] = await this.pool.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'crm_integration_oauth_tokens' AND TABLE_SCHEMA = DATABASE()"
    );
    const hasIntegrationIdColumn = columns.some(col => col.COLUMN_NAME === 'integration_id');

    const idColumnName = hasIntegrationIdColumn ? 'integration_id' : 'integration_config_id';
    const [rows] = await this.pool.execute(
      `SELECT * FROM crm_integration_oauth_tokens WHERE ${idColumnName} = ? LIMIT 1`,
      [integrationConfigId]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  async delete(integrationConfigId) {
    // Check if integration_id column exists (new schema after migration 005)
    const [columns] = await this.pool.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'crm_integration_oauth_tokens' AND TABLE_SCHEMA = DATABASE()"
    );
    const hasIntegrationIdColumn = columns.some(col => col.COLUMN_NAME === 'integration_id');

    const idColumnName = hasIntegrationIdColumn ? 'integration_id' : 'integration_config_id';
    await this.pool.execute(
      `DELETE FROM crm_integration_oauth_tokens WHERE ${idColumnName} = ?`,
      [integrationConfigId]
    );
  }
}

export class SyncJobRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(jobData) {
    const {
      integrationConfigId, syncType = 'manual', metadata
    } = jobData;

    if (!integrationConfigId) {
      throw new Error('integrationConfigId is required');
    }

    // Check if integration_id column exists (new schema after migration 005)
    const [columns] = await this.pool.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'crm_integration_sync_jobs' AND TABLE_SCHEMA = DATABASE()"
    );
    const hasIntegrationIdColumn = columns.some(col => col.COLUMN_NAME === 'integration_id');

    // Use new schema if available, otherwise use old schema with FK check disabled
    if (hasIntegrationIdColumn) {
      const [result] = await this.pool.execute(`
        INSERT INTO crm_integration_sync_jobs
          (integration_id, sync_type, status, metadata, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [integrationConfigId, syncType, JSON.stringify(metadata || {})]);
      return result.insertId;
    } else {
      // Old schema - disable FK checks temporarily
      await this.pool.execute('SET FOREIGN_KEY_CHECKS=0');
      try {
        const [result] = await this.pool.execute(`
          INSERT INTO crm_integration_sync_jobs
            (integration_config_id, sync_type, status, metadata, created_at, updated_at)
          VALUES (?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [integrationConfigId, syncType, JSON.stringify(metadata || {})]);
        return result.insertId;
      } finally {
        await this.pool.execute('SET FOREIGN_KEY_CHECKS=1');
      }
    }
  }

  async getById(jobId) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM crm_integration_sync_jobs WHERE id = ? LIMIT 1',
      [jobId]
    );

    if (!rows.length) return null;
    const job = rows[0];
    if (typeof job.metadata === 'string') {
      job.metadata = JSON.parse(job.metadata);
    }
    return job;
  }

  async updateStatus(jobId, status) {
    await this.pool.execute(`
      UPDATE crm_integration_sync_jobs
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, jobId]);
  }

  async markRunning(jobId) {
    await this.pool.execute(
      'UPDATE crm_integration_sync_jobs SET status = ?, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['running', jobId]
    );
  }

  async markCompleted(jobId, status, completedData) {
    await this.pool.execute(`
      UPDATE crm_integration_sync_jobs
      SET status = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, jobId]);
  }

  async scheduleRetry(jobId, nextRetryAt, retryCount) {
    await this.pool.execute(`
      UPDATE crm_integration_sync_jobs
      SET status = 'pending', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [jobId]);
  }

  async getPendingRetries(limit = 10) {
    const [rows] = await this.pool.execute(`
      SELECT * FROM crm_integration_sync_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `, [limit]);

    return rows || [];
  }
}

export class SyncLogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(logData) {
    const {
      integrationConfigId, syncJobId, syncType, status, stats, errorSummary
    } = logData;

    // Check if integration_id column exists (new schema after migration 005)
    const [columns] = await this.pool.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'crm_integration_sync_logs' AND TABLE_SCHEMA = DATABASE()"
    );
    const hasIntegrationIdColumn = columns.some(col => col.COLUMN_NAME === 'integration_id');

    const parsedStats = typeof stats === 'string' ? JSON.parse(stats || '{}') : (stats || {});
    const statsData = JSON.stringify(parsedStats);

    if (hasIntegrationIdColumn) {
      const [result] = await this.pool.execute(`
        INSERT INTO crm_integration_sync_logs
          (integration_id, sync_job_id, sync_type, status, records_processed, records_created, records_updated, records_failed, stats, error_summary, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `, [
        integrationConfigId || null,
        syncJobId || null,
        syncType || null,
        status || null,
        parsedStats.processed || 0,
        parsedStats.created || 0,
        parsedStats.updated || 0,
        parsedStats.failed || 0,
        statsData,
        errorSummary || null
      ]);
      return result.insertId;
    } else {
      // Old schema - disable FK checks temporarily
      await this.pool.execute('SET FOREIGN_KEY_CHECKS=0');
      try {
        const [result] = await this.pool.execute(`
          INSERT INTO crm_integration_sync_logs
            (integration_config_id, sync_job_id, sync_type, status, records_processed, records_created, records_updated, records_failed, stats, error_summary, duration_seconds)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `, [
          integrationConfigId || null,
          syncJobId || null,
          syncType || null,
          status || null,
          parsedStats.processed || 0,
          parsedStats.created || 0,
          parsedStats.updated || 0,
          parsedStats.failed || 0,
          statsData,
          errorSummary || null
        ]);
        return result.insertId;
      } finally {
        await this.pool.execute('SET FOREIGN_KEY_CHECKS=1');
      }
    }
  }

  async list(integrationConfigId, filters = {}) {
    let query = `
      SELECT * FROM crm_integration_sync_logs
      WHERE integration_config_id = ?
    `;

    const params = [integrationConfigId];

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.since) {
      query += ' AND created_at >= ?';
      params.push(filters.since);
    }

    query += ' ORDER BY created_at DESC LIMIT 50';

    const [rows] = await this.pool.execute(query, params);
    return rows || [];
  }
}

export class FieldMappingRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list(integrationConfigId) {
    const [rows] = await this.pool.execute(`
      SELECT * FROM crm_integration_field_mappings
      WHERE integration_config_id = ? AND active = TRUE
      ORDER BY crm_field ASC
    `, [integrationConfigId]);

    return rows || [];
  }

  async create(mappingData) {
    const { integrationConfigId, crmField, externalField, fieldType, isRequired, transformRule, direction } = mappingData;

    await this.pool.execute(`
      INSERT INTO crm_integration_field_mappings
        (integration_config_id, crm_field, external_field, field_type, is_required, transform_rule, direction, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      integrationConfigId,
      crmField,
      externalField,
      fieldType,
      isRequired ? 1 : 0,
      JSON.stringify(transformRule || {}),
      direction
    ]);
  }

  async update(mappingId, updateData) {
    const { direction, transformRule, active } = updateData;

    await this.pool.execute(`
      UPDATE crm_integration_field_mappings
      SET direction = ?, transform_rule = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [direction, JSON.stringify(transformRule || {}), active ? 1 : 0, mappingId]);
  }

  async delete(mappingId) {
    await this.pool.execute(
      'UPDATE crm_integration_field_mappings SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [mappingId]
    );
  }
}

export class ErrorLogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async log(integrationConfigId, errorData) {
    const { errorType, errorMessage, errorDetails, affectedRecords } = errorData;

    await this.pool.execute(`
      INSERT INTO crm_integration_error_logs
        (integration_config_id, error_type, error_message, error_details, affected_records, is_resolved, created_at)
      VALUES (?, ?, ?, ?, ?, FALSE, CURRENT_TIMESTAMP)
    `, [
      integrationConfigId,
      errorType,
      errorMessage,
      JSON.stringify(errorDetails || {}),
      affectedRecords || 0
    ]);
  }

  async list(integrationConfigId, filters = {}) {
    let query = 'SELECT * FROM crm_integration_error_logs WHERE integration_config_id = ?';
    const params = [integrationConfigId];

    if (filters.resolved === false) {
      query += ' AND is_resolved = FALSE';
    }

    query += ' ORDER BY created_at DESC LIMIT 100';

    const [rows] = await this.pool.execute(query, params);
    return rows || [];
  }

  async resolve(errorId, resolutionNotes) {
    await this.pool.execute(`
      UPDATE crm_integration_error_logs
      SET is_resolved = TRUE, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [errorId]);
  }
}

export class AuditLogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async log(integrationId, auditData) {
    try {
      const { action, notes, createdById } = auditData;

      await this.pool.execute(`
        INSERT INTO crm_integration_audit_logs
          (integration_id, action, notes, created_by_id, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        integrationId || null,
        action || null,
        notes || null,
        createdById || null
      ]);
    } catch (error) {
      // Audit logging is non-blocking - log the error but don't fail the operation
      console.warn('Audit log failed (non-blocking):', error.message);
      return false;
    }
    return true;
  }

  async list(integrationId) {
    const [rows] = await this.pool.execute(`
      SELECT * FROM crm_integration_audit_logs
      WHERE integration_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `, [integrationId]);

    return rows || [];
  }
}
