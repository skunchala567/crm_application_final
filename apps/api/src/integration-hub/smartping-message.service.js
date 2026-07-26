// =====================================================
// Smartping Message Service
// Handles incoming messages, conversations, and storage
// =====================================================

export class SmartpingMessageService {
  constructor(pool, logger = console) {
    this.pool = pool;
    this.logger = logger;
  }

  // ============= Integration Lookup =============

  async getIntegrationByProjectId(projectId) {
    try {
      // CONSOLIDATED: Uses single 'integrations' table (migration 005)
      const query = `
        SELECT id FROM crm_integrations
        WHERE LOWER(COALESCE(provider, '')) = 'smartping'
        AND COALESCE(
          NULLIF(project_id, ''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.projectId')), ''),
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(config, '$.project_id')), '')
        ) = ?
        AND deleted_at IS NULL
        LIMIT 1
      `;

      const [rows] = await this.pool.execute(query, [projectId]);
      return rows[0]?.id || null;
    } catch (error) {
      this.logger.error('Failed to get integration by project ID', error);
      return null;
    }
  }

  // ============= Message Storage =============

  async storeMessage(messageData, integrationId) {
    try {
      const {
        id,
        project_id,
        phone_number,
        contact_id,
        sender,
        message_type,
        message_content,
        campaign,
        status,
        is_HSM,
        chatbot_response,
        delivered_at,
        read_at,
        sent_at,
        failed_at,
        agent_id,
        failureResponse,
        messageId
      } = messageData;

      // Convert millisecond timestamps to datetime
      const convertTimestamp = (ms) => {
        if (!ms) return null;
        return new Date(parseInt(ms)).toISOString().slice(0, 19).replace('T', ' ');
      };

      const query = `
        INSERT INTO crm_smartping_messages (
          id, project_id, phone_number, contact_id, sender, message_type,
          message_content, campaign_name, campaign_sent_at, status, is_hsm,
          chatbot_query_text, chatbot_intent, delivered_at, read_at, sent_at,
          failed_at, agent_id, failure_code, failure_reason, message_id,
          integration_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          delivered_at = VALUES(delivered_at),
          read_at = VALUES(read_at),
          failed_at = VALUES(failed_at),
          updated_at = NOW()
      `;

      const values = [
        id || messageId || `msg_${Date.now()}`,
        project_id,
        phone_number,
        contact_id || null,
        sender,
        message_type,
        JSON.stringify(message_content || {}),
        campaign?.name || null,
        campaign?.sent_at || null,
        status,
        is_HSM || false,
        chatbot_response?.queryText || null,
        chatbot_response?.intent || null,
        convertTimestamp(delivered_at),
        convertTimestamp(read_at),
        convertTimestamp(sent_at),
        convertTimestamp(failed_at),
        agent_id || null,
        failureResponse?.code || null,
        failureResponse?.reason || null,
        messageId,
        integrationId
      ];

      await this.pool.execute(query, values);

      // Update or create conversation
      await this.updateConversation(integrationId, phone_number, contact_id, messageData);

      this.logger.info('Message stored', {
        messageId: messageId || id,
        phone: phone_number,
        sender: sender
      });

      return { success: true, messageId: messageId || id };
    } catch (error) {
      this.logger.error('Failed to store message', error);
      throw error;
    }
  }

  // ============= Conversation Management =============

  async updateConversation(integrationId, phoneNumber, contactId, messageData) {
    try {
      const conversationId = `conv_${integrationId}_${phoneNumber}`;

      // Extract message preview
      let messagePreview = '';
      if (messageData.message_type === 'TEXT') {
        messagePreview = (messageData.message_content?.body || '').substring(0, 100);
      } else {
        messagePreview = `[${messageData.message_type}]`;
      }

      const query = `
        INSERT INTO crm_smartping_conversations (
          id, integration_id, phone_number, contact_id, last_message,
          last_message_sender, last_message_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), 'ACTIVE', NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          last_message = VALUES(last_message),
          last_message_sender = VALUES(last_message_sender),
          last_message_at = NOW(),
          status = VALUES(status),
          updated_at = NOW()
      `;

      const values = [
        conversationId,
        integrationId,
        phoneNumber,
        contactId || null,
        messagePreview,
        messageData.sender
      ];

      await this.pool.execute(query, values);
    } catch (error) {
      this.logger.error('Failed to update conversation', error);
      // Don't throw - conversation update failure shouldn't block message storage
    }
  }

  // ============= Message Retrieval =============

  async getConversations(integrationId, filters = {}) {
    try {
      const { status = 'ACTIVE', limit = 50, offset = 0 } = filters;

      const query = `
        SELECT
          id, integration_id, phone_number, contact_id, contact_name,
          last_message, last_message_sender, last_message_at,
          status, unread_count, created_at, updated_at
        FROM crm_smartping_conversations
        WHERE integration_id = ? AND status = ?
        ORDER BY last_message_at DESC
        LIMIT ? OFFSET ?
      `;

      const [conversations] = await this.pool.execute(query, [
        integrationId,
        status,
        parseInt(limit),
        parseInt(offset)
      ]);

      return conversations;
    } catch (error) {
      this.logger.error('Failed to get conversations', error);
      throw error;
    }
  }

  async getConversation(integrationId, phoneNumber) {
    try {
      const conversationId = `conv_${integrationId}_${phoneNumber}`;

      const query = `
        SELECT
          id, integration_id, phone_number, contact_id, contact_name,
          last_message, last_message_sender, last_message_at,
          status, unread_count, created_at, updated_at
        FROM crm_smartping_conversations
        WHERE id = ?
      `;

      const [conversations] = await this.pool.execute(query, [conversationId]);
      return conversations[0] || null;
    } catch (error) {
      this.logger.error('Failed to get conversation', error);
      throw error;
    }
  }

  async getMessages(integrationId, phoneNumber, filters = {}) {
    try {
      const { limit = 50, offset = 0 } = filters;

      const query = `
        SELECT
          id, message_id, phone_number, sender, message_type, message_content,
          status, sent_at, delivered_at, read_at, failed_at,
          agent_id, campaign_name, is_hsm, failure_code, failure_reason,
          created_at
        FROM crm_smartping_messages
        WHERE integration_id = ? AND phone_number = ?
        ORDER BY sent_at DESC
        LIMIT ? OFFSET ?
      `;

      const [messages] = await this.pool.execute(query, [
        integrationId,
        phoneNumber,
        parseInt(limit),
        parseInt(offset)
      ]);

      // Parse JSON content
      return messages.map(msg => ({
        ...msg,
        message_content: msg.message_content ? JSON.parse(msg.message_content) : {}
      }));
    } catch (error) {
      this.logger.error('Failed to get messages', error);
      throw error;
    }
  }

  async getMessage(messageId) {
    try {
      const query = `
        SELECT
          id, message_id, project_id, phone_number, contact_id, sender,
          message_type, message_content, status, sent_at, delivered_at,
          read_at, failed_at, agent_id, campaign_name, is_hsm,
          chatbot_query_text, chatbot_intent, failure_code, failure_reason,
          created_at, updated_at
        FROM crm_smartping_messages
        WHERE message_id = ?
      `;

      const [messages] = await this.pool.execute(query, [messageId]);
      if (messages.length === 0) return null;

      const msg = messages[0];
      return {
        ...msg,
        message_content: msg.message_content ? JSON.parse(msg.message_content) : {}
      };
    } catch (error) {
      this.logger.error('Failed to get message', error);
      throw error;
    }
  }

  // ============= Message Status Updates =============

  async updateMessageStatus(messageId, status, statusTimestamp) {
    try {
      const normalizedStatus = String(status || '').toUpperCase();
      const statusFields = {
        SENT: 'sent_at',
        DELIVERED: 'delivered_at',
        READ: 'read_at',
        FAILED: 'failed_at'
      };
      const statusField = statusFields[normalizedStatus];
      if (!statusField) throw new Error(`Unsupported message status: ${status}`);
      const numericTimestamp = Number(statusTimestamp);
      const timestamp = Number.isFinite(numericTimestamp)
        ? new Date(numericTimestamp).toISOString().slice(0, 19).replace('T', ' ')
        : new Date().toISOString().slice(0, 19).replace('T', ' ');

      const query = `
        UPDATE crm_smartping_messages
        SET status = ?, ${statusField} = ?, updated_at = NOW()
        WHERE message_id = ?
      `;

      await this.pool.execute(query, [normalizedStatus, timestamp, messageId]);

      this.logger.info('Message status updated', {
        messageId: messageId,
        status: status
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to update message status', error);
      throw error;
    }
  }

  // ============= Unread Count Management =============

  async markConversationAsRead(integrationId, phoneNumber) {
    try {
      const conversationId = `conv_${integrationId}_${phoneNumber}`;

      const query = `
        UPDATE crm_smartping_conversations
        SET unread_count = 0, updated_at = NOW()
        WHERE id = ?
      `;

      await this.pool.execute(query, [conversationId]);

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to mark conversation as read', error);
      throw error;
    }
  }

  async getUnreadCount(integrationId) {
    try {
      const query = `
        SELECT COUNT(*) as total FROM crm_smartping_messages
        WHERE integration_id = ? AND sender = 'CONTACT' AND status != 'READ'
      `;

      const [result] = await this.pool.execute(query, [integrationId]);
      return result[0]?.total || 0;
    } catch (error) {
      this.logger.error('Failed to get unread count', error);
      return 0;
    }
  }

  // ============= Conversation Management =============

  async archiveConversation(integrationId, phoneNumber) {
    try {
      const conversationId = `conv_${integrationId}_${phoneNumber}`;

      const query = `
        UPDATE crm_smartping_conversations
        SET status = 'ARCHIVED', updated_at = NOW()
        WHERE id = ?
      `;

      await this.pool.execute(query, [conversationId]);

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to archive conversation', error);
      throw error;
    }
  }

  // ============= Search =============

  async searchMessages(integrationId, searchQuery, filters = {}) {
    try {
      const { limit = 20, offset = 0 } = filters;

      const query = `
        SELECT
          id, message_id, phone_number, sender, message_type, message_content,
          status, sent_at, created_at
        FROM crm_smartping_messages
        WHERE integration_id = ? AND (
          phone_number LIKE ? OR
          message_content LIKE ? OR
          contact_id LIKE ?
        )
        ORDER BY sent_at DESC
        LIMIT ? OFFSET ?
      `;

      const searchPattern = `%${searchQuery}%`;
      const [messages] = await this.pool.execute(query, [
        integrationId,
        searchPattern,
        searchPattern,
        searchPattern,
        parseInt(limit),
        parseInt(offset)
      ]);

      return messages.map(msg => ({
        ...msg,
        message_content: msg.message_content ? JSON.parse(msg.message_content) : {}
      }));
    } catch (error) {
      this.logger.error('Failed to search messages', error);
      throw error;
    }
  }
}
