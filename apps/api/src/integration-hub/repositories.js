// =====================================================
// Integration Hub Repositories
// Data access layer for integration operations
// =====================================================

export class IntegrationConfigRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list(organizationId, filters = {}) {
    // Build query with dynamic filters
    const whereConditions = ['organization_id = ?'];
    const params = [organizationId];

    if (filters.status) {
      whereConditions.push('status = ?');
      params.push(filters.status);
    }

    if (filters.type) {
      whereConditions.push('integration_type = ?');
      params.push(filters.type);
    }

    if (filters.provider) {
      whereConditions.push('provider_name = ?');
      params.push(filters.provider);
    }

    let query = `SELECT * FROM integration_configs WHERE ${whereConditions.join(' AND ')} ORDER BY created_at DESC`;

    if (filters.limit) {
      const offset = ((filters.page || 1) - 1) * filters.limit;
      query += ` LIMIT ${filters.limit} OFFSET ${offset}`;
    }

    const [rows] = await this.pool.execute(query, params);
    return rows || [];
  }

  async getById(integrationId, organizationId) {
    const [rows] = await this.pool.execute(`
      SELECT * FROM integration_configs
      WHERE id = ? AND organization_id = ?
      LIMIT 1
    `, [integrationId, organizationId]);

    if (!rows.length) return null;

    const config = rows[0];
    if (typeof config.config_json === 'string') {
      config.config = JSON.parse(config.config_json);
    } else {
      config.config = config.config_json || {};
    }
    return config;
  }

  async create(integrationData) {
    const {
      organizationId, integrationName, integrationType, providerName,
      config, createdById, status = 'pending_auth'
    } = integrationData;

    // Validate required fields
    if (!organizationId || !integrationName || !integrationType || !providerName) {
      throw new Error('Missing required fields for integration creation');
    }

    const [result] = await this.pool.execute(`
      INSERT INTO integration_configs
        (organization_id, integration_name, integration_type, provider_name, config_json, status, created_by_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      organizationId,
      integrationName,
      integrationType,
      providerName,
      JSON.stringify(config || {}),
      status,
      createdById || null  // Convert undefined to null for SQL
    ]);

    return this.getById(result.insertId, organizationId);
  }

  async update(integrationId, organizationId, updateData) {
    const { integrationName, config, status } = updateData;

    const updates = [];
    const params = [];

    if (integrationName !== undefined) {
      updates.push('integration_name = ?');
      params.push(integrationName);
    }
    if (config !== undefined) {
      updates.push('config_json = ?');
      params.push(JSON.stringify(config));
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) return this.getById(integrationId, organizationId);

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(integrationId);
    params.push(organizationId);

    await this.pool.execute(`
      UPDATE integration_configs
      SET ${updates.join(', ')}
      WHERE id = ? AND organization_id = ?
    `, params);

    return this.getById(integrationId, organizationId);
  }

  async updateSyncStatus(integrationId, organizationId, syncData) {
    const { lastSyncedAt, nextSyncAt, lastErrorMessage, status } = syncData;

    await this.pool.execute(`
      UPDATE integration_configs
      SET last_synced_at = ?, next_sync_at = ?, last_error_message = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `, [lastSyncedAt, nextSyncAt, lastErrorMessage, status, integrationId, organizationId]);

    return this.getById(integrationId, organizationId);
  }

  async updateQuota(integrationId, organizationId, quotaData) {
    const { quotaLimit, quotaRemaining, quotaResetAt } = quotaData;
    const updates = [];
    const params = [];

    if (quotaLimit !== undefined) {
      updates.push('api_quota_limit = ?');
      params.push(quotaLimit);
    }
    if (quotaRemaining !== undefined) {
      updates.push('api_quota_remaining = ?');
      params.push(quotaRemaining);
    }
    if (quotaResetAt !== undefined) {
      updates.push('api_quota_reset_at = ?');
      params.push(quotaResetAt);
    }

    if (!updates.length) return;

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(integrationId, organizationId);

    await this.pool.execute(
      `UPDATE integration_configs SET ${updates.join(', ')} WHERE id = ? AND organization_id = ?`,
      params
    );
  }

  async delete(integrationId, organizationId) {
    const [result] = await this.pool.execute(`
      UPDATE integration_configs
      SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `, [integrationId, organizationId]);

    return result.affectedRows > 0;
  }
}

export class OAuthTokenRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async save(integrationConfigId, tokenData) {
    const { providerName, accessToken, refreshToken, tokenType, expiresAt, scope } = tokenData;

    // Check if exists
    const [existing] = await this.pool.execute(
      'SELECT id FROM integration_oauth_tokens WHERE integration_config_id = ? LIMIT 1',
      [integrationConfigId]
    );

    if (existing.length > 0) {
      // Update
      await this.pool.execute(`
        UPDATE integration_oauth_tokens
        SET access_token = ?, refresh_token = ?, token_type = ?, expires_at = ?, scope = ?, updated_at = CURRENT_TIMESTAMP
        WHERE integration_config_id = ?
      `, [accessToken, refreshToken, tokenType, expiresAt, scope, integrationConfigId]);
    } else {
      // Create
      await this.pool.execute(`
        INSERT INTO integration_oauth_tokens
          (integration_config_id, provider_name, access_token, refresh_token, token_type, expires_at, scope, obtained_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [integrationConfigId, providerName, accessToken, refreshToken, tokenType, expiresAt, scope]);
    }
  }

  async get(integrationConfigId) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM integration_oauth_tokens WHERE integration_config_id = ? LIMIT 1',
      [integrationConfigId]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  async delete(integrationConfigId) {
    await this.pool.execute(
      'DELETE FROM integration_oauth_tokens WHERE integration_config_id = ?',
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

    const [result] = await this.pool.execute(`
      INSERT INTO integration_sync_jobs
        (integration_config_id, sync_type, status, metadata, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [integrationConfigId, syncType, JSON.stringify(metadata || {})]);

    return result.insertId;
  }

  async getById(jobId) {
    const [rows] = await this.pool.execute(
      'SELECT * FROM integration_sync_jobs WHERE id = ? LIMIT 1',
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
      UPDATE integration_sync_jobs
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, jobId]);
  }

  async markRunning(jobId) {
    await this.pool.execute(
      'UPDATE integration_sync_jobs SET status = ?, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['running', jobId]
    );
  }

  async markCompleted(jobId, status, completedData) {
    await this.pool.execute(`
      UPDATE integration_sync_jobs
      SET status = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, jobId]);
  }

  async scheduleRetry(jobId, nextRetryAt, retryCount) {
    await this.pool.execute(`
      UPDATE integration_sync_jobs
      SET status = 'pending', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [jobId]);
  }

  async getPendingRetries(limit = 10) {
    const [rows] = await this.pool.execute(`
      SELECT * FROM integration_sync_jobs
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

    const [result] = await this.pool.execute(`
      INSERT INTO integration_sync_logs
        (integration_config_id, sync_job_id, sync_type, status, records_processed, records_created, records_updated, records_failed, stats, error_summary, duration_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
      integrationConfigId || null,
      syncJobId || null,
      syncType || null,
      status || null,
      stats?.processed || 0,
      stats?.created || 0,
      stats?.updated || 0,
      stats?.failed || 0,
      typeof stats === 'string' ? stats : JSON.stringify(stats || {}),
      errorSummary || null
    ]);

    return result.insertId;
  }

  async list(integrationConfigId, filters = {}) {
    let query = `
      SELECT * FROM integration_sync_logs
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
      SELECT * FROM integration_field_mappings
      WHERE integration_config_id = ? AND active = TRUE
      ORDER BY crm_field ASC
    `, [integrationConfigId]);

    return rows || [];
  }

  async create(mappingData) {
    const { integrationConfigId, crmField, externalField, fieldType, isRequired, transformRule, direction } = mappingData;

    await this.pool.execute(`
      INSERT INTO integration_field_mappings
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
      UPDATE integration_field_mappings
      SET direction = ?, transform_rule = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [direction, JSON.stringify(transformRule || {}), active ? 1 : 0, mappingId]);
  }

  async delete(mappingId) {
    await this.pool.execute(
      'UPDATE integration_field_mappings SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
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
      INSERT INTO integration_error_logs
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
    let query = 'SELECT * FROM integration_error_logs WHERE integration_config_id = ?';
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
      UPDATE integration_error_logs
      SET is_resolved = TRUE, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [errorId]);
  }
}

export class AuditLogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async log(integrationConfigId, auditData) {
    const { action, notes, createdById } = auditData;

    await this.pool.execute(`
      INSERT INTO integration_audit_logs
        (integration_config_id, action, notes, created_by_id, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      integrationConfigId || null,
      action || null,
      notes || null,
      createdById || null
    ]);
  }

  async list(integrationConfigId) {
    const [rows] = await this.pool.execute(`
      SELECT * FROM integration_audit_logs
      WHERE integration_config_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `, [integrationConfigId]);

    return rows || [];
  }
}
