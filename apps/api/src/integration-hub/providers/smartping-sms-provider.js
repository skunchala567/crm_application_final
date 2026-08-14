import axios from 'axios';
import { BaseIntegrationProvider, AuthenticationError, ValidationError } from '../base-provider.js';

const clean = value => String(value ?? '').trim();

export class SmartpingSmsProvider extends BaseIntegrationProvider {
  constructor(config, logger = console) {
    super(config || {}, logger);
    this.name = 'SmartpingSmsProvider';
    this.baseUrl = clean(config?.baseUrl).replace(/\/+$/, '');
    this.username = clean(config?.username);
    this.password = clean(config?.password);
    this.senderId = clean(config?.senderId);
    this.dltContentId = clean(config?.dltContentId);
    this.dltPrincipalEntityId = clean(config?.dltPrincipalEntityId);
    this.dltTelemarketerId = clean(config?.dltTelemarketerId);
    this.timeoutMs = Number(config?.timeoutMs || 15000);
  }

  validateConfig() {
    if (!/^https?:\/\/[^\s/]+/i.test(this.baseUrl)) throw new ValidationError('A valid SmartPing API base URL is required');
    if (!this.username || !this.password) throw new AuthenticationError('SmartPing SMS username and API password are required');
    if (!/^[A-Za-z0-9]{6}$/.test(this.senderId)) throw new ValidationError('Sender ID must contain exactly 6 letters or numbers');
    if (!/^\d{4,19}$/.test(this.dltContentId)) throw new ValidationError('DLT Content ID must contain 4 to 19 digits');
    if (this.dltPrincipalEntityId && !/^\d{12,19}$/.test(this.dltPrincipalEntityId)) throw new ValidationError('DLT Principal Entity ID must contain 12 to 19 digits');
    if (this.dltTelemarketerId && !/^\d{12,19}$/.test(this.dltTelemarketerId)) throw new ValidationError('DLT Telemarketer ID must contain 12 to 19 digits');
  }

  async testConnection() {
    this.validateConfig();
    return {
      connected: true,
      configured: true,
      provider: 'SmartPing SMS',
      message: 'SmartPing SMS configuration is valid. No billable test SMS was sent.'
    };
  }

  formatRecipient(phoneNumber) {
    const digits = clean(phoneNumber).replace(/\D/g, '');
    if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
    if (/^91[6-9]\d{9}$/.test(digits)) return digits;
    throw new ValidationError('Recipient must be a valid 10-digit Indian mobile number, optionally prefixed with 91');
  }

  async sendMessage(phoneNumber, message, options = {}) {
    this.validateConfig();
    if (!clean(message)) throw new ValidationError('Message text is required');
    const dltContentId = clean(options.dltContentId || this.dltContentId);
    if (!/^\d{4,19}$/.test(dltContentId)) throw new ValidationError('A valid DLT Content ID is required');
    const recipient = this.formatRecipient(phoneNumber);
    const unicode = options.unicode ?? this.config.defaultUnicode ?? /[^\x00-\x7F]/.test(message);
    const payload = {
      extra: {
        dltContentId,
        ...(clean(options.dltPrincipalEntityId || this.dltPrincipalEntityId)
          ? { dltPrincipalEntityId: clean(options.dltPrincipalEntityId || this.dltPrincipalEntityId) } : {}),
        ...(clean(options.dltTelemarketerId || this.dltTelemarketerId)
          ? { dltTelemarketerId: clean(options.dltTelemarketerId || this.dltTelemarketerId) } : {}),
        ...(options.flash ? { 'message.is.flash': true } : {}),
        ...(options.correlationId ? { corelationId: String(options.correlationId) } : {})
      },
      message: { recipient, text: String(message) },
      sender: clean(options.senderId || this.senderId),
      unicode: Boolean(unicode)
    };

    try {
      const response = await axios.post(`${this.baseUrl}/fe/api/v1/message`, payload, {
        auth: { username: this.username, password: this.password },
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        timeout: this.timeoutMs
      });
      const data = response.data || {};
      const accepted = String(data.state || '').toUpperCase() === 'SUBMIT_ACCEPTED'
        || Number(data.statusCode) === 200;
      if (!accepted) {
        const error = new ValidationError(data.description || 'SmartPing rejected the SMS');
        error.response = { status: response.status, data };
        throw error;
      }
      return {
        success: true,
        transactionId: String(data.transactionId),
        messageId: String(data.transactionId),
        state: data.state,
        status: 'SUBMITTED',
        pdu: data.pdu,
        recipient,
        response: data,
        httpStatus: response.status
      };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof AuthenticationError) throw error;
      const detail = error.response?.data?.description || error.response?.data?.message || error.message;
      const wrapped = error.response?.status === 401
        ? new AuthenticationError(`SmartPing authentication failed: ${detail}`)
        : new ValidationError(`SmartPing SMS send failed: ${detail}`);
      wrapped.response = error.response;
      throw wrapped;
    }
  }
}
