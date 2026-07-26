# WhatsApp Integration and ERP Implementation Guide

Last verified against this CRM implementation: 2026-07-26

## 1. Purpose

This is the single implementation guide for rebuilding the working AiSensy WhatsApp integration in another ERP application. It covers:

- multiple WhatsApp accounts per organization;
- per-account credentials;
- template creation, synchronization, and account filtering;
- single-recipient and bulk template messages;
- free-form replies inside the customer-service window;
- media upload and public media delivery;
- incoming messages and delivery-status webhooks;
- conversations, history, retry, polling, and idempotency;
- database ownership, API boundaries, UI behavior, security, and rollout.

This document describes the architecture and sequence. It does not replace provider access approval or the current AiSensy API contract supplied for the target account.

## 2. Important API decision

AiSensy exposes more than one API surface. Do not combine their authentication or payload formats.

### 2.1 Project API: preferred by this CRM

Use the Project API when the AiSensy account has Project API access and the ERP must:

- list, create, inspect, delete, or synchronize templates;
- send an approved template directly by its template name;
- send a free-form text message during an open service window;
- retrieve an individual message status;
- avoid creating a separate API Campaign for every template.

Implemented base paths:

```text
Template API base:
https://apis.aisensy.com/project-apis/v1

Messaging API base:
https://apis.aisensy.com/project-apis/v1/project
```

Authentication:

```http
X-AiSensy-Project-API-Pwd: <project API password>
```

The project ID is part of the URL. The password is a header. Do not put this password in a client-side application.

### 2.2 Campaign API: use only when Project API messaging is unavailable

Public AiSensy documentation describes:

```http
POST https://backend.aisensy.com/campaign/t1/api/v2
Content-Type: application/json
```

Authentication is the `apiKey` in the JSON body. This API requires a live AiSensy API Campaign whose name matches `campaignName`. Therefore it does not meet the “select an approved template and send without manually creating a campaign” requirement unless AiSensy exposes campaign-management APIs for the account.

Use the Campaign API only when:

- the target account does not have direct Project API messaging;
- creating and activating an API Campaign in AiSensy is acceptable;
- the ERP stores an exact template-to-campaign mapping.

Never silently fall back from the Project API to the Campaign API. Their prerequisites and payloads are different.

### 2.3 New Project API base

Keep this configurable for provider versions that expose:

```text
https://api.aisensy.io/v1
```

Do not assume that endpoints from the legacy Project API can simply be appended to this URL. Confirm the endpoint and authentication contract with AiSensy before enabling it.

### 2.4 Webhooks

Use webhooks as the primary source for:

- incoming customer messages;
- sent, delivered, read, failed, and rejected status transitions;
- failure codes and reasons;
- template approval-status changes.

Use polling only as a fallback or user-requested refresh.

## 3. Working CRM source map

The corresponding implementation in this project is:

```text
apps/api/src/integration-hub/providers/smartping-provider.js
  Provider transport, phone formatting, template/text send, status lookup,
  retry policy, and provider payload normalization.

apps/api/src/integration-hub/integration.service.js
  ERP orchestration, authorization scope, conversation/message persistence,
  bulk sending, retry, history, and status refresh.

apps/api/src/integration-hub/routes.js
  Authenticated ERP endpoints for send, bulk send, history, conversations,
  refresh, retry, and integration-level template operations.

apps/api/src/integration-hub/smartping-message.service.js
  Incoming Smartping event normalization and legacy conversation storage.

apps/api/src/integration-hub/smartping-webhook.routes.js
  Smartping webhook and conversation endpoints.

apps/api/src/whatsapp/aisensy-template-client.js
  AiSensy Project API template operations.

apps/api/src/whatsapp/whatsapp-template.service.js
  Template validation, local synchronization, and account ownership.

apps/api/src/whatsapp/whatsapp-template.routes.js
  Authenticated template-management routes.

apps/api/src/whatsapp/webhook.routes.js
  Incoming messages, message statuses, and template-status webhooks.

apps/api/src/server.js
  Route mounting, periodic status polling, media upload, and public media.

apps/web/src/components/WhatsAppSendPanel.jsx
  Lead-side WhatsApp conversation and send workspace.

apps/web/src/pages/SettingsWhatsAppTemplates.jsx
  Account-filtered template management, send, and history.
```

Do not copy obsolete SQL from `apps/api/src/migrations`. The authoritative migration sequence is `database/mysql`.

## 4. Target architecture

Keep four layers separate:

```text
ERP UI
  -> ERP WhatsApp controller
    -> WhatsApp application service
      -> Provider adapter
        -> AiSensy API

AiSensy webhook
  -> Public webhook controller
    -> verification and normalization
      -> idempotent message/status persistence
        -> UI refresh or realtime event
```

Responsibilities:

1. The UI selects an integration, template, recipients, and parameter values.
2. The controller authenticates the ERP user and validates the request shape.
3. The application service verifies organization ownership, enforces messaging rules, persists a pending message, and calls the provider.
4. The provider knows AiSensy URLs, headers, payloads, timeouts, and retries.
5. Webhook handlers normalize provider events and update the same message record.
6. The database remains the ERP source of truth for conversations and history.

Do not call AiSensy directly from the browser.

## 5. Database design

Apply the equivalent of these active migrations in order:

```text
014_integration_hub_tables.sql
022_backfill_smartping_credentials.sql
023_consolidate_integration_audit_logs.sql
024_whatsapp_messaging.sql
025_whatsapp_campaign_name.sql
026_aisensy_integration_credentials.sql
```

### 5.1 Integrations

Store one row per WhatsApp account in the shared `crm_integrations` table.

Required or supported fields:

```text
id
organization_id
name
type                         SMARTPING in this CRM
provider
status
project_id
project_api_password
aisensy_base_url
aisensy_api_key
media_public_base_url
config
created_at
updated_at
deleted_at
```

Field usage:

- `project_id`: AiSensy Project ID for the WhatsApp account.
- `project_api_password`: credential used in `X-AiSensy-Project-API-Pwd`.
- `aisensy_base_url`: per-account campaign or provider base URL.
- `aisensy_api_key`: Campaign API key when that API is explicitly used.
- `media_public_base_url`: public HTTPS origin used to construct uploaded-media URLs.
- `config`: non-secret provider options such as timeout and retry count.

Encrypt secret columns at rest using an application master key or a managed secret/KMS service. Never return secret values from list APIs.

### 5.2 Conversations

`crm_whatsapp_conversations` owns one conversation per integration and normalized mobile:

```text
id
organization_id
integration_id
mobile
contact_name
lead_id
last_message
last_message_time
unread_count
status
created_at
updated_at
```

Use a unique constraint on `(integration_id, mobile)`. The same mobile can have separate conversations for separate WhatsApp accounts.

### 5.3 Messages

`crm_whatsapp_messages` stores both directions:

```text
id
organization_id
integration_id
conversation_id
lead_id
client_request_id
message_id
template_name
campaign_name
direction
type
message
media_url
caption
status
api_response
failed_reason
retry_count
sent_at
delivered_at
read_at
created_at
updated_at
```

Critical constraints:

- `client_request_id` must be unique to prevent duplicate sends.
- Provider `message_id` must be unique when present.
- Store raw API responses for investigation, but redact credentials and authorization headers.

### 5.4 Attachments and API logs

Use:

- `crm_whatsapp_attachments` for file name, MIME type, URL, thumbnail, and size;
- `crm_whatsapp_api_logs` for operation, sanitized request, response, HTTP status, duration, retry count, and exception detail.

API logs are technical audit records. Message history must come from `crm_whatsapp_messages`, not log parsing.

## 6. Per-account credential workflow

1. An administrator creates a WhatsApp integration row.
2. The ERP collects Project ID, Project API password, optional Campaign API key, base URL, and public media base URL.
3. The API encrypts secrets before persistence.
4. The server tests the connection.
5. Mark the account `ACTIVE` only after credentials are accepted.
6. Account list endpoints return `configured: true/false`, never credentials.
7. Every template and send operation receives an `integrationId`.
8. Before use, verify that the integration belongs to the authenticated organization.

Do not use numbered environment variables such as `AISENSY_API_KEY_1`, `_2`, or `_3`. They do not scale and can associate the wrong credential after data migration. Environment variables should contain only infrastructure-wide configuration such as the encryption master key.

## 7. Template management

### 7.1 List and synchronize templates

Project API:

```http
GET /project/{projectId}/wa_template?limit=100&offset=0
X-AiSensy-Project-API-Pwd: <password>
```

Paginate until the returned page is shorter than the requested limit. Upsert each template locally using the provider template ID and integration ID.

Local uniqueness must include the integration:

```text
(integration_id, aisensy_template_id)
```

Never show templates from one WhatsApp account while another account is selected.

### 7.2 Get one template

```http
GET /project/{projectId}/wa_template/{templateId}
X-AiSensy-Project-API-Pwd: <password>
```

Use this for details, edit/view preparation, or targeted reconciliation.

### 7.3 Create and submit a template

```http
POST /project/{projectId}/wa_template
X-AiSensy-Project-API-Pwd: <password>
Content-Type: application/json
```

Validate before sending:

- lowercase template name with underscores;
- valid category such as `MARKETING`, `UTILITY`, or `AUTHENTICATION`;
- correct language;
- sequential body variables such as `{{1}}`, `{{2}}`;
- sample values for variables;
- media/header requirements for `IMAGE`, `VIDEO`, or `FILE`;
- only supported button definitions.

Persist the provider response and initial status. The provider/Meta approval status can be `PENDING`, `APPROVED`, or `REJECTED`; do not allow sending until approved.

### 7.4 Delete a template

Current Project API client:

```http
DELETE /wa_template/{templateId}
X-AiSensy-Project-API-Pwd: <password>
```

After provider success, soft-delete the local template. Do not hard-delete historical messages that reference its name.

### 7.5 Template status

Use the template-status webhook when available. Keep manual “Sync” as a recovery option.

## 8. Sending messages

### 8.1 Phone normalization

Normalize before lookup, idempotency, and send:

- remove spaces and punctuation;
- for an Indian 10-digit mobile beginning with 6-9, prefix `91`;
- accept an already normalized international number of 11-15 digits;
- reject ambiguous or invalid values.

Store one canonical form in conversations and messages.

### 8.2 Send an approved template directly

Use this outside the customer-service window and for the first outbound message.

```http
POST /project/{projectId}/messages
X-AiSensy-Project-API-Pwd: <password>
X-Client-Request-Id: <UUID>
Content-Type: application/json
```

Example:

```json
{
  "to": "919876543210",
  "type": "template",
  "recipient_type": "individual",
  "template": {
    "name": "admission_update",
    "language": {
      "code": "en"
    },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "John" },
          { "type": "text", "text": "Grade 8" }
        ]
      }
    ]
  },
  "source": "CRM",
  "tags": ["Lead"],
  "attributes": {
    "Branch": "Hyderabad"
  }
}
```

Rules:

- use the exact approved template name and language;
- build body parameters from the selected template, in order;
- do not let the user edit approved template text;
- include button components only when the approved template contains those buttons;
- include media only when the template header requires it;
- generate a unique client request ID before the first attempt and reuse it for retries of that logical send.

### 8.3 Media template

Add a header component:

```json
{
  "type": "header",
  "parameters": [
    {
      "type": "image",
      "image": {
        "link": "https://erp.example.com/media/whatsapp/12/file.jpg"
      }
    }
  ]
}
```

Use `video` or `document` instead of `image` when required. Documents can include `filename`.

The URL must be public HTTPS and retrievable by the provider without ERP login cookies or private-network access.

### 8.4 Free-form text

Use only after the contact has messaged the business and while the customer-service window is open:

```http
POST /project/{projectId}/messages
X-AiSensy-Project-API-Pwd: <password>
X-Client-Request-Id: <UUID>
Content-Type: application/json
```

```json
{
  "to": "919876543210",
  "type": "text",
  "recipient_type": "individual",
  "text": {
    "body": "Thank you. Our admissions team will call you shortly."
  }
}
```

The UI must keep free text disabled until an incoming message has opened the service window. Outside that window, require an approved template.

### 8.5 Bulk send

Bulk sending is orchestration around the same single-recipient API:

1. Resolve the selected integration and approved template once.
2. Validate and deduplicate recipients.
3. Create one unique client request ID per recipient.
4. Queue recipients instead of holding one long HTTP request for large batches.
5. Rate-limit for the account/provider allowance.
6. Store success or failure independently for every recipient.
7. Return aggregate counts and expose row-level failures for export/retry.

Do not use one idempotency key for the entire batch.

### 8.6 Campaign API alternative

Only if Project API direct send is unavailable:

```http
POST https://backend.aisensy.com/campaign/t1/api/v2
```

```json
{
  "apiKey": "<campaign API key>",
  "campaignName": "Student Admission",
  "destination": "919876543210",
  "userName": "John Doe",
  "source": "CRM",
  "templateParams": ["John Doe", "ABC School"],
  "media": {
    "url": "https://erp.example.com/media/offer.jpg",
    "filename": "offer.jpg"
  },
  "tags": ["Lead"],
  "attributes": {
    "Branch": "Hyderabad"
  }
}
```

The campaign must already exist and be live. A template name is not a campaign name.

## 9. Safe send transaction

For every single message:

1. Authenticate the ERP user.
2. Verify organization and integration access.
3. Normalize and validate the destination.
4. Verify the selected template belongs to that integration and is approved.
5. Validate parameter, media, and button counts against the template.
6. Upsert the conversation.
7. Generate `client_request_id`.
8. Insert an outgoing message with status `PENDING` or `SENDING`.
9. Commit that local insert.
10. Call AiSensy.
11. On success, store provider `message_id`, sanitized response, and `QUEUED`/`SENT`.
12. On failure, store HTTP status, provider response, reason, and retry count.
13. Return the stored message to the UI.

Persisting before the provider call gives the user immediate feedback and prevents an untraceable send.

## 10. Retry and error policy

Retry automatically only for transient failures:

- timeout or network failure;
- HTTP 408;
- HTTP 429;
- HTTP 5xx.

Do not automatically retry:

- HTTP 400 invalid payload/template;
- HTTP 401 invalid credential;
- HTTP 403 forbidden;
- HTTP 404 invalid project/template/message;
- explicit provider rejection.

Recommended exponential backoff:

```text
attempt 1: 500 ms
attempt 2: 1,000 ms
attempt 3: 2,000 ms
```

Keep the same client request ID across automatic attempts. A manual retry should link to the original failed message and use a deliberate idempotency policy.

Map provider errors into stable ERP codes while retaining the sanitized raw response for support.

## 11. Incoming messages and status webhooks

### 11.1 Public endpoint

Expose a public HTTPS endpoint such as:

```text
POST /api/webhooks/whatsapp/messages
```

This CRM accepts compatible aliases, but another ERP should configure one canonical production URL.

### 11.2 Event fields

Normalize events containing fields such as:

```json
{
  "type": "message",
  "id": "event-id",
  "project_id": "project-id",
  "phone_number": "919876543210",
  "contact_id": "contact-id",
  "campaign": {
    "name": "campaign-name",
    "sent_at": 1785056400000
  },
  "sender": "USER",
  "message_content": {},
  "message_type": "TEXT",
  "status": "DELIVERED",
  "is_HSM": false,
  "delivered_at": 1785056400000,
  "read_at": 1785056460000,
  "sent_at": 1785056300000,
  "failed_at": null,
  "agent_id": "",
  "failureResponse": {
    "code": "",
    "reason": ""
  },
  "messageId": "wamid..."
}
```

Provider payloads can vary by event type. Normalize:

- `messageId`, `message_id`, or provider `id`;
- `phone_number`, `from`, `sender`, or `to`;
- text nested in `message_content`;
- timestamps supplied as ISO text, seconds, or milliseconds;
- status values regardless of case.

### 11.3 Resolve the integration

Use `project_id` to find the exact active integration within the organization. Do not attach a webhook to the first available WhatsApp account.

Reject or quarantine an event when the project cannot be resolved.

### 11.4 Idempotent persistence

For incoming messages:

1. Verify webhook authenticity using the provider-supported signature or secret.
2. Resolve integration from `project_id`.
3. Normalize the mobile and message ID.
4. Upsert the conversation using `(integration_id, mobile)`.
5. Insert the message only if provider `message_id` is new.
6. Store direction `INCOMING`.
7. Store text/media content and attachment metadata.
8. Increment unread count only for a newly inserted incoming message.
9. Update conversation preview and last-message time.
10. Return HTTP 2xx quickly.

For status events:

1. Find the outgoing message by provider `message_id`.
2. Apply only a valid forward status transition.
3. Store `sent_at`, `delivered_at`, `read_at`, or failure reason.
4. Do not create a duplicate message bubble.

Recommended progression:

```text
PENDING -> QUEUED -> ACCEPTED -> SENT -> DELIVERED -> READ
                                  \-> FAILED
                                  \-> REJECTED
```

Never move `READ` back to `DELIVERED` because events arrived out of order.

### 11.5 Webhook security

- Require HTTPS.
- Verify the signature/secret exactly as AiSensy specifies for the account.
- Preserve the raw request body if signature verification requires it.
- Rate-limit the endpoint.
- Cap request size.
- Log an event ID and integration ID, not credentials.
- Return 2xx after durable acceptance; process expensive work asynchronously.
- Store unrecognized events for investigation instead of repeatedly throwing 500.

## 12. Status polling and refresh

If the Project API account supports message lookup:

```http
GET /project/{projectId}/messages/{messageId}
X-AiSensy-Project-API-Pwd: <password>
```

Use it for:

- manual refresh in the chat header;
- reconciliation of pending messages;
- fallback when webhooks are delayed.

Do not poll terminal `READ`, `FAILED`, or `REJECTED` records indefinitely. Poll only recent non-terminal messages, use increasing intervals, and stop after a configured age.

The current CRM periodically reconciles pending messages and also exposes a per-message refresh operation.

## 13. Media upload

The ERP upload endpoint should:

1. require an authenticated ERP user;
2. require an integration ID;
3. verify organization ownership;
4. infer allowed MIME types from the selected template type;
5. enforce a file-size limit;
6. generate a server-side file name;
7. prevent path traversal;
8. store outside the source tree;
9. return a public URL based on that integration's `media_public_base_url`.

Example returned URL:

```text
https://erp.example.com/media/whatsapp/{integrationId}/{generatedFile}
```

For production, prefer object storage with HTTPS, malware scanning, retention rules, and unguessable object names.

Enable upload only for templates whose approved header type requires media. Do not show a media control for text-only templates.

## 14. ERP-facing API contract

Suggested authenticated endpoints:

```text
GET    /api/whatsapp/integrations
GET    /api/whatsapp/integrations/{integrationId}/templates
POST   /api/whatsapp/integrations/{integrationId}/templates
DELETE /api/whatsapp/integrations/{integrationId}/templates/{templateId}
POST   /api/whatsapp/integrations/{integrationId}/sync

POST   /api/whatsapp/integrations/{integrationId}/send
POST   /api/whatsapp/integrations/{integrationId}/send-bulk
POST   /api/whatsapp/integrations/{integrationId}/media

GET    /api/whatsapp/history
GET    /api/whatsapp/conversations
GET    /api/whatsapp/conversations/{conversationId}/messages
PUT    /api/whatsapp/conversations/{conversationId}/read
POST   /api/whatsapp/messages/{messageId}/refresh
POST   /api/whatsapp/messages/{messageId}/retry

POST   /api/webhooks/whatsapp/messages
POST   /api/webhooks/whatsapp/template-status
```

This CRM currently mounts equivalent functionality across `/api/hub`, `/api/whatsapp`, and `/api/webhooks`. A new ERP should present one consistent namespace while keeping provider routes internal.

## 15. UI and UX rules

### 15.1 Integration screen

- Show every WhatsApp account as its own integration.
- Show configured, active, unavailable, or authorization-required status.
- Never determine availability from only a legacy JSON field; use the current credential columns.
- Allow admins to update credentials without exposing stored secrets.

### 15.2 Template screen

- Default filter: all integrations or no specific account selected.
- Require selecting an account before template creation.
- Filter templates by integration.
- Provide Sync, History, Send message, and New template actions.
- Empty state uses a normal themed card and button, not an oversized full-height control.

### 15.3 Lead chat

- Open as a right-side mobile-style panel.
- Show the lead name and normalized primary mobile.
- Include account and approved-template selectors below the message history.
- Once selected, template body text is read-only.
- Render outgoing messages on the right and incoming messages on the left.
- Render media inside the message bubble.
- Show sending, sent, delivered, read, failed, and retry states.
- Provide a refresh control in the header.
- Lazy-load older history in pages of 50.

### 15.4 Reply-window behavior

- Before an incoming customer message, disable free text and require a template.
- After an incoming customer message, allow free text only while the service window is open.
- Store the latest incoming timestamp server-side; do not trust a browser-only timer.

### 15.5 Bulk messaging

- Accept current filtered lead selection or uploaded contacts.
- Preview valid, invalid, and duplicate recipients before send.
- Require one selected integration and approved template.
- Map template parameters explicitly.
- Show per-recipient outcomes and downloadable failures.

## 16. Logging and observability

For each provider call record:

- integration ID and organization ID;
- operation name;
- message database ID and provider message ID;
- sanitized URL and payload;
- HTTP status;
- sanitized response;
- response duration;
- retry number;
- exception class and stack;
- timestamp.

Never log:

- Project API password;
- Campaign API key;
- webhook secret;
- full authorization headers;
- encryption master key.

Monitor:

- send success rate;
- delivery/read latency;
- failure rate by provider code;
- webhook processing failures;
- pending messages older than threshold;
- template synchronization failures;
- duplicate-send prevention events.

## 17. Testing strategy

### 17.1 Unit tests

- phone normalization;
- language normalization;
- template component generation;
- media-type selection;
- status ordering;
- webhook event normalization;
- idempotency;
- retry classification;
- secret redaction.

### 17.2 Provider contract tests

Mock AiSensy and verify exact:

- URL;
- HTTP method;
- headers;
- payload;
- timeout;
- retry behavior;
- response normalization.

Maintain separate fixtures for Project API and Campaign API.

### 17.3 Integration tests

- integration ownership and tenant isolation;
- template sync scoped to one account;
- pending message created before provider call;
- successful provider message ID update;
- duplicate client request rejection;
- incoming webhook creates one message;
- repeated webhook does not increment unread count twice;
- out-of-order status does not regress;
- media record and bubble rendering;
- bulk partial success;
- failed-message retry.

### 17.4 End-to-end acceptance

For each connected account:

1. Sync templates.
2. Create a test template and await approval.
3. Send a text template.
4. Send each supported media template.
5. Confirm sent, delivered, and read changes.
6. Send a customer reply to the business.
7. Confirm the incoming bubble appears in the correct account and lead.
8. Send a free-form reply during the service window.
9. Verify the message remains after reload.
10. Verify another organization cannot access the conversation.

## 18. Safe rollout into another ERP

Implement in this order:

1. Add integration credential fields and encryption.
2. Add conversation, message, attachment, and API-log tables.
3. Build a provider interface independent of AiSensy.
4. Implement the AiSensy Project API adapter.
5. Add integration ownership and connection testing.
6. Add template list/sync.
7. Add template creation and approval status.
8. Add single-recipient template sending with idempotency.
9. Add webhook verification and incoming/status persistence.
10. Add message history and right-side chat UI.
11. Add free-form replies with server-enforced service window.
12. Add media upload and media-template sending.
13. Add background reconciliation and manual refresh.
14. Add queued bulk sends.
15. Add metrics, alerts, retention, and operational runbooks.
16. Enable for one test account and branch.
17. Validate end to end before enabling additional accounts.

Use feature flags for sending, bulk sending, media, and free-form replies. Database changes should be additive and backward compatible. Do not remove the previous provider path until historical sends, callbacks, and rollback have been verified.

## 19. Portability checklist

- [ ] Provider contract and entitlement confirmed with AiSensy.
- [ ] Direct Project API vs Campaign API decision documented.
- [ ] Credentials stored per integration and encrypted.
- [ ] No provider secret exposed to the browser.
- [ ] Tenant and integration ownership enforced on every ERP endpoint.
- [ ] Templates scoped by integration.
- [ ] Only approved templates can be sent.
- [ ] Template text is immutable in send UI.
- [ ] Parameter/media/button validation matches the selected template.
- [ ] Public media URLs are HTTPS and externally reachable.
- [ ] Client request IDs prevent duplicate sends.
- [ ] Outgoing records exist before provider calls.
- [ ] Webhook signatures are verified.
- [ ] Incoming webhooks resolve integration by project ID.
- [ ] Webhook persistence is idempotent.
- [ ] Status transitions cannot regress.
- [ ] Free text is server-gated by the service window.
- [ ] Bulk sends are queued and rate-limited.
- [ ] Provider logs are sanitized.
- [ ] End-to-end tests pass for every connected account.

## 20. Provider documentation references

The public Campaign API and its requirement for a live API Campaign are documented by AiSensy:

- <https://wiki.aisensy.com/en/articles/11501889-api-reference-docs>
- <https://wiki.aisensy.com/en/articles/11501891-how-to-setup-whatsapp-api-campaigns-in-aisensy>

Template categories, types, variables, media rules, and approval flow:

- <https://wiki.aisensy.com/en/articles/11501573-how-to-create-whatsapp-template-messages-in-aisensy>

The Project API paths in this guide are based on the functioning provider contract implemented in this CRM. Before using them in another ERP, obtain the current Project API specification and credentials for that AiSensy account.
