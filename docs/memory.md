# Admissions CRM — Project Memory

Last updated: 2026-07-26

## Purpose

Admissions CRM is a production-oriented admissions lead-management application connected to the existing `attendance_biometric` MySQL database. It provides a single workspace for lead intake, ownership, follow-ups, academic configuration, bulk operations, Google Sheets imports, WhatsApp template management, and WhatsApp conversations.

This file is the consolidated development and operational reference. Historical phase reports, fix notes, RCA documents, and duplicate implementation summaries have been removed.

For the standalone, step-by-step WhatsApp implementation guide, see `docs/WHATSAPP_INTEGRATION_GUIDE.md`.

## Technology

- Web: React, React Router, Vite, Lucide icons
- API: Node.js, Express
- Database: MySQL through `mysql2`
- Authentication: JWT using existing Attendance users and CRM role/access records
- Integrations: Google OAuth 2.0, Google Sheets API, AiSensy/Smartping WhatsApp APIs
- Workspace: npm workspaces for `apps/api` and `apps/web`

## Project layout

```text
CRM Application/
|-- apps/
|   |-- api/
|   |   |-- src/                 # API application source
|   |   `-- scripts/             # Diagnostics, maintenance, experiments
|   `-- web/
|       |-- public/              # Static and import-template assets
|       `-- src/                 # React application source
|-- database/
|   |-- mysql/                   # Active ordered migrations
|   |-- diagnostics/             # Optional investigation queries
|   `-- reference/               # Schema reference snapshots
|-- docs/
|   `-- memory.md                # Consolidated project reference
|-- .env.example
|-- package.json
`-- README.md
```

## Commands

```powershell
npm install
npm run migrate -w apps/api
npm run dev
npm run check
```

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- Production web build: `npm run build -w apps/web`

## Authentication and authorization

- Login uses the existing Attendance account.
- JWTs are stored in browser local storage and checked for expiration.
- CRM access is controlled by CRM roles and the CRM user-access status table.
- Supported CRM roles include `ADMIN`, `CRM_ADMIN`, `ADMISSION_MANAGER`, `COUNSELLOR`, and `CRM_VIEWER`.
- Lead write, lead delete, and user-administration operations have separate permission checks.
- Branch scope is applied to lead data and relevant operations.
- `INTEGRATION_MASTER_KEY` must remain a stable secret of at least 32 characters. It encrypts Google OAuth access and refresh tokens with AES-256-GCM. Changing it makes existing OAuth tokens unreadable and requires Google reauthorization.

## Navigation and UI system

Primary navigation:

- Dashboard
- Leads
- Bulk Actions
- Reports
- Automations
- Settings

Settings navigation is collapsible and expands automatically for settings routes. It contains:

- User Management
- Lead Configuration
- Academic Configuration
- Integrations
- Google Sheets
- WhatsApp Templates

UI work completed across the platform:

- Leads screen is the visual baseline for buttons, filters, cards, tabs, spacing, tables, and empty states.
- Responsive headers and toolbars avoid overlap at reduced widths.
- Sidebar supports collapsed and expanded states and is responsive on mobile.
- Browser navigation uses React Router locations correctly.
- Academic Years and Admission Classes are combined under Academic Configuration with top tabs.
- Integrations are located under Settings.
- WhatsApp template list, creation form, details drawer, filters, empty state, and responsive layouts follow the project theme.

## Leads

The Leads screen supports:

- Search by lead number, name, phone, and related fields
- Branch, ownership, stage, sub-stage, academic, source, channel, campaign, score, and date filters
- Saved filters/funnels
- Expandable lead rows and detailed information
- Lead creation and editing
- Stage changes and bulk stage changes
- Follow-up notes and date tracking
- Lead referral and bulk referral
- Re-enquiry tracking
- Source history
- Per-lead and filtered-selection WhatsApp messaging
- Role- and branch-scoped access

Tracked timestamps include:

- Added
- Updated
- Referred
- Next follow-up
- Re-enquired

Dates are stored consistently by the backend and displayed in the application’s India time context.

## Lead identity and duplicate rules

Duplicate handling is shared by manual lead creation, bulk import, Google Sheets import, and other intake paths.

Business rule:

- A mobile number may appear across different branches.
- A mobile number may have multiple sources in the same branch.
- The same mobile number, branch, and source combination is the true duplicate boundary.
- A repeated enquiry in the same branch from a different source links the new source to the existing lead.
- Such enquiries are presented as re-enquired leads instead of being discarded.
- Source ID is accepted directly.
- Channel is derived from Source ID.
- Academic information is derived through Class ID.

Relevant migrations:

- `012_lead_source_history.sql`
- `020_unique_lead_branch_source.sql`
- `021_source_channel_relationship.sql`

## Bulk actions and imports

Bulk functionality includes:

- Downloadable import template
- Validation before import
- Branch-aware lead import
- Successful, duplicate, skipped, and failed result tracking
- Downloadable error and success outputs
- Bulk stage changes
- Bulk referrals
- Bulk WhatsApp sends

The public sample import description is retained at `apps/web/public/Sample_Import_Format.md`.

## Lead and academic configuration

Settings provides administration for:

- Lead stages and sub-stages
- Sources and source-to-channel relationships
- Channels and campaigns
- Branch-aware ownership/configuration values
- Academic years
- Admission class configurations
- Curricula
- Admission types

Academic Years and Admission Classes share the Academic Configuration screen with tabs.

## Integration Hub

The Integration Hub manages provider connections through the `crm_integrations` table and supporting OAuth, audit, error, sync, and mapping tables.

Common capabilities:

- Create, update, test, authorize, disconnect, and delete integrations
- Provider-specific configuration
- OAuth token storage
- Manual sync
- Sync history
- Field mappings
- Error records
- Audit records

Credentials are stored per integration rather than using numbered environment variables.

## Google Sheets integration

Each Google Sheets integration represents one authorized Google account. Each integration can own multiple sheet sources, commonly one per branch.

Workflow:

1. Create a Google Sheets integration.
2. Enter that integration’s Google OAuth credentials.
3. Authorize the intended Google account.
4. Add a sheet source.
5. Choose the spreadsheet, worksheet, and destination branch.
6. Map CRM fields to sheet columns before activation.
7. Activate continuous import.

Per-sheet actions are presented as side-by-side icons:

- Configuration
- Field mapping
- Sync data
- Sync logs
- Delete

The Google Sheets screen supports:

- Multiple Google integrations
- An integration filter with no forced selection by default
- Multiple sheet sources per integration
- Sheet-specific mapping and sync state
- Continuous polling/import
- Manual refresh/import
- Import history
- Skipped-lead records with reasons
- Full-screen skipped-lead view
- Filters and export

No successful empty sync log is stored merely because polling occurred; meaningful records are created when lead processing occurs.

### Google OAuth credential storage

Dedicated `crm_integrations` columns:

- `google_client_id`
- `google_client_secret`
- `google_redirect_uri`

The credentials are editable per Google integration under Integration Settings. They are used for:

- OAuth authorization URL generation
- Authorization-code exchange
- Access-token refresh
- Connection tests
- Spreadsheet listing and synchronization

Google client credentials are no longer read from `.env` and are not duplicated in the `config` JSON.

OAuth access and refresh tokens remain encrypted in the OAuth token table using `INTEGRATION_MASTER_KEY`.

## WhatsApp/AiSensy integrations

Multiple WhatsApp accounts are supported. Templates and messages are always scoped to the selected integration.

Dedicated `crm_integrations` columns:

- `project_id`
- `project_api_password`
- `aisensy_base_url`
- `aisensy_api_key`
- `media_public_base_url`

The former `AISENSY_API_KEY_1`, `_2`, `_3`, and `AISENSY_BASE_URL` environment values were migrated into the appropriate integration rows and removed from `.env`.

Per-account settings are editable under Integration Settings:

- Project ID
- Project API Password
- AiSensy Base URL
- AiSensy API Key
- Public Media Base URL

The Project API is used for direct template messaging so users do not have to create a separate campaign manually in another portal.

## WhatsApp templates

Template management supports:

- Integration filter
- Template synchronization
- Status tabs: All, Approved, Pending, Draft, Rejected, Archived
- Search and filters
- Responsive table layout
- Template creation scoped to a selected WhatsApp account
- Template detail drawer that does not overlap navigation
- Edit, duplicate, and delete actions
- Themed empty state
- Message sending and message history

Template creation supports:

- Name, label, category, language, and type
- Body parameters
- Footer
- Quick replies and call-to-action buttons
- Text, image, video, and file/document template types
- WhatsApp-style preview

Template message bodies are read-only when sending. Only parameter values and required media are supplied at send time.

## WhatsApp conversations and messaging

Leads open a mobile-style WhatsApp conversation drawer rather than a modal.

Conversation UX:

- Contact header and phone
- Refresh button
- Five-second automatic refresh
- Incoming and outgoing bubbles
- Image previews
- Download/open cards for documents and other attachments
- Delivery status display
- Responsive full-screen mobile layout
- Account and approved-template selectors below the message area

Messaging rules:

- A template is required to initiate a conversation.
- Template body text cannot be edited.
- Free-text replies unlock only after the contact has sent an incoming message.
- Template parameters remain editable.
- Image/video/document/file attachments appear only when required by the selected template type.
- The Send action remains disabled until required media has uploaded successfully.
- Client request IDs prevent duplicate sends.
- Bulk upload and selected-lead sending are supported.

Message history records template name, destination, status, provider response, retry information, and failure reason.

Supported states include:

- Pending
- Queued
- Accepted
- Sent
- Delivered
- Read
- Failed
- Rejected

## WhatsApp media uploads

Users select files from their system instead of entering public URLs.

Validation:

- Image: JPG, PNG, WebP, GIF; maximum 5 MB
- Video: MP4; maximum 16 MB
- Document/File: PDF, DOC, DOCX; maximum 20 MB

Files are isolated by integration ID under `uploads/whatsapp/<integrationId>/`. The public URL is built from the selected integration’s `media_public_base_url`.

The configured base URL must be a publicly reachable HTTPS API origin because AiSensy downloads media from it. A localhost address cannot be used by the external provider.

## WhatsApp webhooks

Supported inbound paths:

- `/hub/smartping/webhook`
- `/api/hub/smartping/webhook`
- `/api/webhooks/whatsapp/messages`

The webhook parser supports the documented AiSensy event model:

- `type`
- `id`
- `project_id`
- `phone_number`
- `contact_id`
- `sender`
- `message_content`
- `message_type`
- `status`
- lifecycle timestamps
- `messageId`

`CONTACT`, `CUSTOMER`, `USER`, `CLIENT`, and equivalent senders are normalized as incoming. Events are matched to the WhatsApp integration by project ID and stored in the normalized conversation/message tables.

Webhook endpoints must be reachable through a public HTTPS deployment or secure development tunnel. Messages that never reach the callback cannot be reconstructed from the local database.

## WhatsApp persistence

Primary normalized tables:

- `crm_whatsapp_conversations`
- `crm_whatsapp_messages`
- `crm_whatsapp_attachments`
- `crm_whatsapp_api_logs`
- WhatsApp template tables and template logs

The current chat drawer reads these normalized tables. Legacy Smartping message tables remain only for compatibility with older implementation paths.

## Important database migrations

CRM migrations are ordered under `database/mysql`.

Key integration and messaging migrations:

- `014_integration_hub_tables.sql`
- `019_google_sheet_skipped_leads.sql`
- `022_backfill_smartping_credentials.sql`
- `023_consolidate_integration_audit_logs.sql`
- `024_whatsapp_messaging.sql`
- `025_whatsapp_campaign_name.sql`
- `026_aisensy_integration_credentials.sql`
- `027_google_oauth_integration_credentials.sql`

Run migrations before starting a version that references new columns:

```powershell
npm run migrate -w apps/api
```

## Environment configuration

Application/environment concerns that remain appropriate in `.env`:

- API port and allowed web origin
- JWT signing secret and expiry
- MySQL connection
- `INTEGRATION_MASTER_KEY`
- Optional provider endpoint/retry defaults still listed in `.env.example`

Per-account Google and AiSensy credentials belong in `crm_integrations`, not `.env`.

Never commit live credentials.

## Operational requirements

- MySQL must be available; demo mode is disabled.
- Apply database migrations before deployment.
- Keep `INTEGRATION_MASTER_KEY` backed up securely and unchanged.
- Configure Google redirect URIs exactly in Google Cloud Console.
- Use public HTTPS URLs for Google callbacks, WhatsApp webhooks, and WhatsApp media in deployed environments.
- Persist `uploads/whatsapp` or replace it with durable object storage before horizontally scaling the API.
- Configure reverse-proxy upload limits to allow the supported attachment sizes.

## Validation

Standard validation:

```powershell
npm run check
```

This checks API syntax and builds the web application.

Additional smoke and QA scripts exist under `apps/api/src` for leads, users, filters, configuration, and visual checks.

Expected non-blocking build warning:

- React Router package-level `"use client"` directives may be ignored by Vite during bundling.

## Current status

- Core CRM, leads, settings, academic configuration, bulk actions, automation configuration, Google Sheets integration, WhatsApp templates, WhatsApp sending, conversation history, media rendering, and per-account credentials are implemented.
- Recent API syntax checks and Vite production builds pass.
- External OAuth, webhook, and media delivery still depend on correctly configured public provider URLs and credentials.
