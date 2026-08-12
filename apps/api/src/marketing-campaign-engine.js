export async function ensureMarketingCampaignSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_marketing_campaigns (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(180) NOT NULL,
      rule_type ENUM('days_gap','calendar_dates','weekdays') NOT NULL,
      communication_count SMALLINT UNSIGNED NOT NULL,
      first_communication_at DATETIME(6) NOT NULL,
      gap_days SMALLINT UNSIGNED NULL,
      weekdays_json JSON NULL,
      calendar_dates_json JSON NULL,
      audience_filters_json JSON NOT NULL,
      integration_id INT NOT NULL,
      response_owner ENUM('sender','lead_owner') NOT NULL DEFAULT 'sender',
      retry_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('ACTIVE','PAUSED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
      created_by BIGINT UNSIGNED NOT NULL,
      created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      KEY ix_crm_marketing_campaign_status (status, first_communication_at),
      KEY ix_crm_marketing_campaign_org (organization_id, created_at_utc),
      CONSTRAINT fk_crm_marketing_campaign_creator FOREIGN KEY (created_by)
        REFERENCES app_users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_crm_marketing_campaign_integration FOREIGN KEY (integration_id)
        REFERENCES crm_integrations(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_marketing_campaign_touches (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      campaign_id BIGINT UNSIGNED NOT NULL,
      sequence_number SMALLINT UNSIGNED NOT NULL,
      template_id INT NOT NULL,
      template_name VARCHAR(180) NOT NULL,
      template_body TEXT NOT NULL,
      template_language VARCHAR(30) NULL,
      template_params_json JSON NULL,
      media_url VARCHAR(1000) NULL,
      media_filename VARCHAR(255) NULL,
      scheduled_at DATETIME(6) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_crm_marketing_campaign_touch (campaign_id, sequence_number),
      CONSTRAINT fk_crm_marketing_touch_campaign FOREIGN KEY (campaign_id)
        REFERENCES crm_marketing_campaigns(id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_marketing_touch_template FOREIGN KEY (template_id)
        REFERENCES crm_whatsapp_templates(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [touchColumns] = await pool.query(`
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE()
      AND TABLE_NAME='crm_marketing_campaign_touches'
      AND COLUMN_NAME IN ('media_url','media_filename')
  `);
  const touchColumnNames = new Set(touchColumns.map((column) => column.COLUMN_NAME));
  if (!touchColumnNames.has('media_url')) {
    await pool.query(`
      ALTER TABLE crm_marketing_campaign_touches
      ADD COLUMN media_url VARCHAR(1000) NULL AFTER template_params_json
    `);
  }
  if (!touchColumnNames.has('media_filename')) {
    await pool.query(`
      ALTER TABLE crm_marketing_campaign_touches
      ADD COLUMN media_filename VARCHAR(255) NULL AFTER media_url
    `);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_marketing_campaign_recipients (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      campaign_id BIGINT UNSIGNED NOT NULL,
      lead_id BIGINT UNSIGNED NOT NULL,
      phone VARCHAR(30) NOT NULL,
      phone_type ENUM('primary','alternate') NOT NULL DEFAULT 'primary',
      status ENUM('PENDING','IN_PROGRESS','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
      created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY uq_crm_marketing_recipient (campaign_id, lead_id, phone_type),
      KEY ix_crm_marketing_recipient_lead (lead_id),
      CONSTRAINT fk_crm_marketing_recipient_campaign FOREIGN KEY (campaign_id)
        REFERENCES crm_marketing_campaigns(id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_marketing_recipient_lead FOREIGN KEY (lead_id)
        REFERENCES crm_leads(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_marketing_campaign_deliveries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      campaign_id BIGINT UNSIGNED NOT NULL,
      recipient_id BIGINT UNSIGNED NOT NULL,
      touch_id BIGINT UNSIGNED NOT NULL,
      sequence_number SMALLINT UNSIGNED NOT NULL,
      scheduled_for DATETIME(6) NOT NULL,
      status ENUM('PENDING','RUNNING','QUEUED','SENT','DELIVERED','READ','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
      attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      whatsapp_message_id VARCHAR(255) NULL,
      error_message VARCHAR(1000) NULL,
      sent_at_utc DATETIME(6) NULL,
      created_at_utc DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at_utc DATETIME(6) NULL ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY uq_crm_marketing_delivery (recipient_id, touch_id),
      KEY ix_crm_marketing_delivery_due (status, scheduled_for),
      KEY ix_crm_marketing_delivery_campaign (campaign_id, status),
      CONSTRAINT fk_crm_marketing_delivery_campaign FOREIGN KEY (campaign_id)
        REFERENCES crm_marketing_campaigns(id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_marketing_delivery_recipient FOREIGN KEY (recipient_id)
        REFERENCES crm_marketing_campaign_recipients(id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_marketing_delivery_touch FOREIGN KEY (touch_id)
        REFERENCES crm_marketing_campaign_touches(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export function createMarketingCampaignEngine(pool, { sendWhatsApp, logger = console }) {
  let running = false;

  async function refreshRollups(campaignId) {
    await pool.execute(`
      UPDATE crm_marketing_campaign_recipients r
      SET r.status = (
        SELECT CASE
          WHEN SUM(d.status='FAILED') > 0 AND SUM(d.status IN ('PENDING','RUNNING','QUEUED','SENT')) = 0 THEN 'FAILED'
          WHEN SUM(d.status IN ('PENDING','RUNNING','QUEUED','SENT')) > 0 THEN 'IN_PROGRESS'
          ELSE 'COMPLETED'
        END
        FROM crm_marketing_campaign_deliveries d WHERE d.recipient_id=r.id
      )
      WHERE r.campaign_id=?
    `, [campaignId]);
    await pool.execute(`
      UPDATE crm_marketing_campaigns c
      SET c.status='COMPLETED'
      WHERE c.id=? AND c.status='ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM crm_marketing_campaign_deliveries d
          WHERE d.campaign_id=c.id AND d.status IN ('PENDING','RUNNING','QUEUED','SENT')
        )
    `, [campaignId]);
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      await pool.query(`
        UPDATE crm_marketing_campaign_deliveries d
        JOIN crm_whatsapp_messages m
          ON CONVERT(m.message_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = d.whatsapp_message_id
        SET d.status=CASE UPPER(CONVERT(m.status USING utf8mb4) COLLATE utf8mb4_unicode_ci)
              WHEN 'READ' THEN 'READ'
              WHEN 'DELIVERED' THEN 'DELIVERED'
              WHEN 'FAILED' THEN 'FAILED'
              WHEN 'REJECTED' THEN 'FAILED'
              WHEN 'SENT' THEN 'SENT'
              ELSE d.status
            END,
            d.error_message=COALESCE(m.failed_reason,d.error_message)
        WHERE d.status IN ('QUEUED','SENT','DELIVERED')
          AND UPPER(CONVERT(m.status USING utf8mb4) COLLATE utf8mb4_unicode_ci) IN ('SENT','DELIVERED','READ','FAILED','REJECTED')
      `);
      await pool.query(`
        UPDATE crm_marketing_campaign_deliveries
        SET status='PENDING',error_message='Recovered after interrupted campaign cycle'
        WHERE status='RUNNING'
          AND COALESCE(updated_at_utc,created_at_utc)<DATE_SUB(NOW(),INTERVAL 2 MINUTE)
      `);
      const [activeCampaignRows] = await pool.query(`
        SELECT id FROM crm_marketing_campaigns WHERE status='ACTIVE'
      `);
      for (const campaign of activeCampaignRows) await refreshRollups(campaign.id);
      const [deliveries] = await pool.query(`
        SELECT d.id,d.campaign_id,d.recipient_id,d.attempts,
               c.organization_id,c.integration_id,c.retry_attempts,c.name campaign_name,
               r.lead_id,r.phone,l.student_name,
               t.template_name,t.template_body,t.template_language,t.template_params_json,
               t.media_url,t.media_filename
        FROM crm_marketing_campaign_deliveries d
        JOIN crm_marketing_campaigns c ON c.id=d.campaign_id AND c.status='ACTIVE'
        JOIN crm_marketing_campaign_recipients r ON r.id=d.recipient_id
        JOIN crm_leads l ON l.id=r.lead_id AND l.deleted_at_utc IS NULL
        JOIN crm_marketing_campaign_touches t ON t.id=d.touch_id
        WHERE d.status='PENDING' AND d.scheduled_for<=NOW()
        ORDER BY d.scheduled_for,d.id LIMIT 50
      `);
      const affectedCampaigns = new Set();
      for (const delivery of deliveries) {
        const [claim] = await pool.execute(
          `UPDATE crm_marketing_campaign_deliveries
           SET status='RUNNING',attempts=attempts+1
           WHERE id=? AND status='PENDING'`,
          [delivery.id],
        );
        if (!claim.affectedRows) continue;
        affectedCampaigns.add(Number(delivery.campaign_id));
        try {
          const params = typeof delivery.template_params_json === 'string'
            ? JSON.parse(delivery.template_params_json)
            : (delivery.template_params_json || []);
          const result = await sendWhatsApp({
            integrationId: Number(delivery.integration_id),
            organizationId: Number(delivery.organization_id),
            phoneNumber: delivery.phone,
            message: delivery.template_body,
            options: {
              templateName: delivery.template_name,
              campaignName: delivery.campaign_name,
              templateParams: params,
              language: delivery.template_language || 'en',
              media: delivery.media_url
                ? { url: delivery.media_url, filename: delivery.media_filename || 'attachment' }
                : undefined,
              leadId: Number(delivery.lead_id),
              userName: delivery.student_name,
              source: 'CRM Bulk Marketing',
              clientRequestId: `marketing-delivery-${delivery.id}`,
            },
          });
          await pool.execute(
            `UPDATE crm_marketing_campaign_deliveries
             SET status=?,whatsapp_message_id=?,error_message=NULL,sent_at_utc=NOW()
             WHERE id=?`,
            [String(result.status || 'QUEUED').toUpperCase(), result.messageId || null, delivery.id],
          );
        } catch (error) {
          const canRetry = Number(delivery.attempts) < Number(delivery.retry_attempts);
          const retryAt = new Date(Date.now() + (2 ** (Number(delivery.attempts) + 1)) * 60_000);
          await pool.execute(
            `UPDATE crm_marketing_campaign_deliveries
             SET status=?,error_message=?,
                 scheduled_for=IF(?,?,scheduled_for)
             WHERE id=?`,
            [
              canRetry ? 'PENDING' : 'FAILED',
              String(error.message || error).slice(0, 1000),
              canRetry ? 1 : 0,
              retryAt,
              delivery.id,
            ],
          );
        }
      }
      for (const campaignId of affectedCampaigns) await refreshRollups(campaignId);
    } catch (error) {
      logger.error('Bulk marketing campaign cycle failed:', error);
    } finally {
      running = false;
    }
  }

  return { run };
}
