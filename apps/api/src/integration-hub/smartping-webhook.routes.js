// =====================================================
// Smartping Webhook Routes
// Handles incoming messages from Smartping
// =====================================================

import express from 'express';

export function createSmartpingWebhookRoutes(messageService, authenticate, requireCrmAccess) {
  const router = express.Router();

  // ============= Webhook Endpoint (Public - No Auth) =============
  // This endpoint receives messages from Smartping
  // Smartping will POST to: /hub/smartping/webhook

  router.post('/smartping/webhook', async (req, res, next) => {
    try {
      const event = req.body;

      console.log('Smartping webhook received:', {
        type: event.type,
        messageId: event.messageId,
        phoneNumber: event.phone_number,
        sender: event.sender
      });

      // Delivery lifecycle callbacks update the outbound history row created
      // when CRM submitted the message.
      if (event.type !== 'message') {
        const messageId = event.messageId || event.message_id || event.id;
        const status = event.status || event.message_status;
        if (messageId && status) {
          await messageService.updateMessageStatus(
            messageId,
            status,
            event.status_timestamp || event.timestamp || Date.now()
          );
          return res.json({ success: true, message: 'Message status updated' });
        }
        return res.json({ success: true, message: 'Event type not processed' });
      }

      // Find integration by project_id
      const integrationId = await messageService.getIntegrationByProjectId(event.project_id);
      if (!integrationId) {
        console.warn('No integration found for project:', event.project_id);
        return res.status(400).json({ success: false, message: 'Project not configured' });
      }

      // Store the message
      await messageService.storeMessage(event, integrationId);

      res.json({ success: true, message: 'Message received' });
    } catch (error) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ============= Messages Endpoints (Authenticated) =============

  // Get all conversations
  router.get('/integrations/:integrationId/messages/conversations', authenticate, requireCrmAccess, async (req, res, next) => {
    try {
      const organizationId = req.user?.id || 1;
      const integrationId = parseInt(req.params.integrationId);
      const { status = 'ACTIVE', limit = 50, offset = 0 } = req.query;

      const conversations = await messageService.getConversations(integrationId, {
        status,
        limit,
        offset
      });

      res.json({
        success: true,
        data: conversations,
        pagination: { limit, offset, total: conversations.length }
      });
    } catch (error) {
      next(error);
    }
  });

  // Get specific conversation
  router.get('/integrations/:integrationId/messages/conversations/:phoneNumber', authenticate, requireCrmAccess, async (req, res, next) => {
    try {
      const integrationId = parseInt(req.params.integrationId);
      const phoneNumber = req.params.phoneNumber;

      const conversation = await messageService.getConversation(integrationId, phoneNumber);
      if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
      }

      res.json({ success: true, data: conversation });
    } catch (error) {
      next(error);
    }
  });

  // Get messages for a conversation
  router.get('/integrations/:integrationId/messages/:phoneNumber', authenticate, requireCrmAccess, async (req, res, next) => {
    try {
      const integrationId = parseInt(req.params.integrationId);
      const phoneNumber = req.params.phoneNumber;
      const { limit = 50, offset = 0 } = req.query;

      const messages = await messageService.getMessages(integrationId, phoneNumber, {
        limit,
        offset
      });

      res.json({
        success: true,
        data: messages,
        pagination: { limit, offset, total: messages.length }
      });
    } catch (error) {
      next(error);
    }
  });

  // Get single message
  router.get('/integrations/:integrationId/messages/detail/:messageId', authenticate, requireCrmAccess, async (req, res, next) => {
    try {
      const messageId = req.params.messageId;

      const message = await messageService.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ success: false, message: 'Message not found' });
      }

      res.json({ success: true, data: message });
    } catch (error) {
      next(error);
    }
  });

  // Mark conversation as read
  router.post('/integrations/:integrationId/messages/conversations/:phoneNumber/read', authenticate, requireCrmAccess, async (req, res, next) => {
    try {
      const integrationId = parseInt(req.params.integrationId);
      const phoneNumber = req.params.phoneNumber;

      await messageService.markConversationAsRead(integrationId, phoneNumber);

      res.json({ success: true, message: 'Conversation marked as read' });
    } catch (error) {
      next(error);
    }
  });

  // Archive conversation
  router.post('/integrations/:integrationId/messages/conversations/:phoneNumber/archive', authenticate, requireCrmAccess, async (req, res, next) => {
    try {
      const integrationId = parseInt(req.params.integrationId);
      const phoneNumber = req.params.phoneNumber;

      await messageService.archiveConversation(integrationId, phoneNumber);

      res.json({ success: true, message: 'Conversation archived' });
    } catch (error) {
      next(error);
    }
  });

  // Get unread count
  router.get('/integrations/:integrationId/messages/unread-count', authenticate, requireCrmAccess, async (req, res, next) => {
    try {
      const integrationId = parseInt(req.params.integrationId);

      const unreadCount = await messageService.getUnreadCount(integrationId);

      res.json({ success: true, data: { unreadCount } });
    } catch (error) {
      next(error);
    }
  });

  // Search messages
  router.get('/integrations/:integrationId/messages/search', authenticate, requireCrmAccess, async (req, res, next) => {
    try {
      const integrationId = parseInt(req.params.integrationId);
      const { q, limit = 20, offset = 0 } = req.query;

      if (!q) {
        return res.status(400).json({ success: false, message: 'Search query required' });
      }

      const results = await messageService.searchMessages(integrationId, q, { limit, offset });

      res.json({
        success: true,
        data: results,
        pagination: { limit, offset, total: results.length }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
