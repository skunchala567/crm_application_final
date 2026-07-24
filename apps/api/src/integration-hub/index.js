// =====================================================
// Integration Hub - Main Exports
// =====================================================

export { BaseIntegrationProvider, IntegrationError, AuthenticationError, RateLimitError, ValidationError } from './base-provider.js';

export {
  IntegrationConfigRepository,
  OAuthTokenRepository,
  SyncJobRepository,
  SyncLogRepository,
  FieldMappingRepository,
  ErrorLogRepository,
  AuditLogRepository
} from './repositories.js';

export { IntegrationHubService } from './integration.service.js';

export { createIntegrationHubRoutes } from './routes.js';

export { stateManager, flowDataManager, pkceManager } from './oauth-state-manager.js';
