# Functional Specification — Current As-Built System

Companion to [`memory.md`](memory.md), which covers architecture and operational
details. This document describes the functionality currently implemented in the
Admissions CRM, screen by screen.

**Document status:** As built
**Last updated:** 16 August 2026

Every authenticated screen operates within the **active business unit**. The
business-unit switcher remounts the active screen so information from separate
units is not mixed. Branch and record access is further restricted by the
signed-in user's assignments, permissions, and data scope.

## Conventions

- **Permission** is the permission key enforced by the frontend and API.
- **Data scope** can restrict relevant records to own, team, department, or all.
- **Key endpoints** lists the principal APIs, not every supporting request.
- A feature described here is developed unless explicitly identified as an
  external dependency or an item requiring business configuration.

---

## Screen index

| # | Screen | Route | Primary permission |
|---|---|---|---|
| 1 | Login | `/login` | Public |
| 2 | Dashboard | `/` | `dashboard.overview.view` |
| 3 | Leads | `/leads` | `leads.list.view` |
| 4 | Tracker | `/tracker` | `tracker.board.view` |
| 5 | Bulk Actions | `/bulk-actions` | `bulk_actions.workspace.view` |
| 6 | Reports | `/reports` | `reports.list.view` |
| 7 | Report Builder | `/saved-reports/new` | `reports.builder.view` |
| 8 | Automations | `/automations` | `automations.workflows.view` |
| 9 | WhatsApp Inbox | `/whatsapp-inbox` | `whatsapp.inbox.view` |
| 10 | User Management | `/settings/users` | `settings.users.view` |
| 11 | Business Units | `/settings/business-units` | `settings.business_units.view` |
| 12 | Payments | `/settings/payments` | Per-tab payment permission |
| 13 | Integrations | `/settings/integrations` | `integrations.hub.view` |
| 14 | Message Templates | `/settings/templates` | Per-channel template permission |
| 15 | Google Sheets | `/settings/google-sheets` | `integrations.google_sheets.view` |
| 16 | Meta Lead Ads | `/settings/meta-lead-ads` | `integrations.meta_lead_ads.view` |
| 17 | CallerDesk | `/settings/callerdesk` | `integrations.callerdesk.view` |
| 18 | Tata Smartflo | `/settings/smartflo` | `integrations.smartflo.view` |
| 19 | Email Configuration | `/settings/email-configuration` | `email.configuration.view` |
| 20 | Public Enquiry Form | `/public/enquiry/:formKey` | Public |
| 21 | Public Payment Form | `/payment/:formKey` | Public |
| 22 | OAuth Callback | `/oauth-callback` | Public callback |

Legacy paths remain supported where needed. `/operations` redirects to
`/tracker`, `/integrations` redirects to `/settings/integrations`, and legacy
lead/academic settings paths redirect to the appropriate Business Units tab.

---

## 1. Login and session management

### Purpose

Authenticate CRM users using the existing attendance application accounts.

### Current behaviour

- Login accepts email address and password.
- Password visibility can be toggled.
- On success, the JWT and user profile are stored in browser local storage.
- Expired or invalid sessions are cleared automatically.
- API authentication failures return the user to login.
- Daily active usage is recorded.
- Inactivity triggers a warning and then automatic logout unless the user
  chooses to remain signed in.
- The interface and API both enforce role permissions.

**Key endpoint:** `POST /api/auth/login`

---

## 2. Dashboard

### Purpose

Provide managers and counsellors with a current overview of admissions and
follow-up activity permitted for them.

### Current behaviour

- Summary cards show total leads, new leads, follow-ups due, and completed
  activity with period comparisons.
- Dashboard filters include branch, owner, stage, sub-stage, channel, source,
  campaign, and configurable date criteria.
- Lead stage, branch, curriculum, class, and source information is shown in
  chart or pivot-style widgets.
- Daily CRM usage and lead activity can be viewed.
- Widgets can be reordered, resized, hidden, or shown where the user has layout
  permission.
- Saved reports can be displayed as dashboard widgets.
- All statistics respect active business unit and data scope.

**Key endpoints:** `GET /api/dashboard`, `GET /api/leads`

---

## 3. Leads

### Purpose

Provide the main workspace for capturing, finding, assigning, progressing, and
communicating with admission enquiries.

### Current behaviour

- Create, view, edit, and delete are controlled independently by permission.
- The list supports stage tabs, live counts, pagination, selectable rows, and
  configurable columns.
- Filters include branch, stage, sub-stage, source, touch status, follow-up
  range, pending follow-ups, payment status, and advanced lead attributes.
- Advanced filter combinations can be saved and reused.
- Global search searches only leads the user may access.
- Leads can be assigned, referred, or reassigned to permitted employees.
- Stage and sub-stage changes are recorded in history.
- Re-enquiry and source history preserve attribution rather than replacing the
  original source.
- Lead details include student, parent, contact, academic, source, ownership,
  follow-up, activity, notes, documents, and communication information.
- Individual actions support calling, WhatsApp, Email, follow-up management,
  editing, referral, stage change, and deletion where permitted.
- A business-unit deletion password can be required before destructive actions.

### Payment information on leads

- The list provides a payment-status filter.
- Supported working statuses include collected, order created, unpaid, expired,
  and failed.
- A lead shows the paid amount only when a collected/paid/settled payment exists.
- The detail drawer shows collected amount and payment date only for paid leads.
- Leads without a completed payment do not display collected-payment details.

### Bulk action launcher

The lightning menu on the Leads screen supports:

- Bulk upload
- Bulk stage change
- Bulk referral
- Add to campaign
- Bulk WhatsApp
- Bulk SMS
- Bulk Email
- Export

Each option has its own permission and is disabled when a required selection is
missing.

**Key endpoints:** `/api/leads`, `/api/leads/meta`, `/api/saved-filters`,
`/api/leads/referral-options/all`, lead activity and bulk-action endpoints.

---

## 4. Tracker

### Purpose

Manage internal action items, approvals, and minutes of meeting separately from
the lead pipeline.

### Current behaviour

- Action items have an owner, deadline, workflow stage, and approval state.
- Configurable stages and transitions are maintained per business unit.
- Search, owner, deadline, stage, and approval filters are available.
- Calendar and list/board working views are supported.
- Guest owners can be assigned without creating CRM login access.
- Minutes of Meeting sessions contain discussion points that can be converted
  into action items.
- My Approvals shows items awaiting the current user's decision.
- Tracker activity can be exported.
- Notifications can be sent to owners and approvers using configured templates.

**Key endpoints:** business-unit operation, MOM, approval, tracker-user, and
guest-owner APIs under `/api/platform`.

---

## 5. Bulk Actions

### Purpose

Import leads and review high-volume CRM operations.

### Current behaviour

- Download a unit-specific lead import template.
- Upload lead spreadsheets using fields enabled for import.
- Review each row as created, duplicate/skipped, or failed with a reason.
- Retain uploaded source-row information for audit.
- Review bulk operation history, including operator and affected count.
- Review bulk campaigns and delivery counts where available.
- Bulk actions remain subject to permissions and data scope.

**Key endpoints:** `/api/bulk-uploads`, `/api/bulk-operations`, and campaign
endpoints.

---

## 6. Reports

### Purpose

Provide reusable analysis and control the dashboard layout.

### Current behaviour

- Reports library lists saved reports and their visibility.
- Users can open, edit, duplicate, delete, and export where permitted.
- Saved reports can be shared with selected CRM users.
- Dashboard Layout controls visible widgets, order, and width for the active
  business unit.
- Layout changes are propagated to open application tabs.
- Report queries respect business-unit, branch, permission, and scope rules.

**Key endpoints:** `/api/report-data-sources`, `/api/dashboard`, `/api/leads`.

---

## 7. Report Builder

### Purpose

Create a saved report from CRM data without writing a database query.

### Current behaviour

- Choose report fields, grouping, measures, filters, and date conditions.
- Supported presentations include funnel, bar, column, pie, and table views.
- Preview uses live permitted data while the report is being edited.
- Calculated values and supported formula operations can be configured.
- Reports can be saved, assigned user visibility, and pinned to the Dashboard.

---

## 8. Automations and assignment rules

### Purpose

Apply repeatable actions to leads and automatically distribute new work.

### Workflow functionality

- Create, edit, activate, deactivate, delete, and manually run workflows.
- Conditions support field/operator/value rules, AND/OR groups, nested groups,
  absolute dates, and relative dates.
- Actions support updating lead information and sending Email, SMS, or WhatsApp.
- WhatsApp actions select an integration and an allowed template.
- Optional action delays are supported.
- Delayed actions can either re-check or skip re-checking conditions.
- Execution status and completed, failed, skipped, and pending counts are kept in
  an append-only execution log.

### Assignment-rule functionality

- Administrators can create, edit, activate, deactivate, and delete assignment
  rules.
- Rules assign qualifying leads according to configured conditions and targets.
- Rule ordering/status determines which active configuration is applied.

### Bulk campaigns

- Campaign workflows can target selected or filtered leads.
- Recipient, delivery, attempt, and outcome information is retained.

**Key endpoints:** `/api/automations`, `/api/assignment-rules`, and related
campaign endpoints.

---

## 9. WhatsApp Inbox

### Purpose

Manage two-way WhatsApp communication against connected accounts.

### Current behaviour

- Conversation list displays unread counts and recent activity.
- Users can open a message thread and mark it read.
- Messages and supported attachments are displayed in the conversation.
- Approved templates are available outside the provider's free-form service
  window.
- Conversations can be related to lead records.
- Incoming messages and delivery events are processed by webhooks.
- Branch/account and template visibility rules limit available sending options.

**Key endpoints:** `/api/hub/smartping/conversations`, SmartPing message APIs,
and WhatsApp webhook routes.

---

## 10. User Management and Access Control

### Purpose

Control who can use the CRM, which records they can access, and which actions
they may perform.

### Users

- List existing employees and CRM users.
- Grant or revoke CRM access.
- Activate or deactivate users.
- Assign roles, business units, and branches.
- Export user information where permitted.

### Access Control

- Permissions are configurable by module, screen, tab, and action.
- Actions include view, create, edit, delete, import, export, assign, reassign,
  approve, upload, download, and manage where relevant.
- Scoped features can be limited to none, own, team, department, or all data.
- Presets support no access, view only, full access, and custom access.
- Permission changes and denied requests are auditable.

**Key endpoints:** `/api/admin/users`, `/api/rbac/*`.

---

## 11. Business Units and branch configuration

### Purpose

Configure each business operation, its data model, branch structure, pipeline,
and supporting workflows.

### Current tabs

| Tab | Current functionality |
|---|---|
| Overview | Configuration counts and summary. |
| Branches & payments | Branch information, calling routes, and branch-specific Jodo credentials. |
| Lead fields | Field types and required/list/filter/search/import/report behaviour. |
| Lead pipeline | Stages, sub-stages, and transitions. |
| Source configuration | Channel, source, campaign, and category structure. |
| Academic configuration | Academic years, curricula, classes, admission types, and valid combinations for legacy-school units. |
| Configuration | Configurable sections and combinations for non-school business units. |
| Tracker | Operation workflows and stages used by Tracker. |
| Database tables | Reference view of relevant unit data structures. |

### Branch-level settings

- Branch name, short name, status, and other branch details.
- CallerDesk and Smartflo calling identifiers.
- Jodo base URL, authorization header, collector code, API key, and secret.
- Payment provider credentials are stored on the branch and are never shown on
  a public form.
- Payable amount, component, and paid-application stage are configured on the
  Payment Form or Enquiry Form, not hard-coded globally for every branch.

### Other behaviour

- Manual-lead defaults can be configured.
- Assignment rules can route new leads.
- A deletion password can protect destructive operations.

**Key endpoints:** `/api/platform/business-units`, branch, business-config,
academic, and lead-configuration APIs.

---

## 12. Payments

### Purpose

Configure public collection journeys and monitor money collected through Jodo.

The combined Payments screen contains only tabs the current user may access.

### 12.1 Payment Forms

- Create and edit branch-specific public payment forms.
- Configure title, description, branch, single/multiple category selection,
  categories, amounts, additional payer fields, success message, redirect URL,
  expiry date, and active status.
- Copy the public link and preview the form.
- View category and submission counts.
- Delete forms that have no protected payment history; forms with collected
  records cannot be destructively removed.

### 12.2 Collections

- Display collections from enquiry forms, payment forms, and payment links in
  one report.
- Show payer, source, branch, order/transaction reference, amount, status,
  payment date, settlement date, and settlement UTR where available.
- Summary cards show record count, expected total, collected count, and
  collected amount.
- Filter by search text, status, source, branch, and date range.
- Export the current filtered result to CSV.
- Queries are branch- and permission-scoped.

### 12.3 Enquiry Forms

- Create public lead-capture forms with configurable fields and ordering.
- Configure default branch, stage, sub-stage, source, channel, campaign, owner,
  and academic-year information.
- Enable or disable application payment.
- Configure the payable amount per form; when blank, the configured branch/form
  fallback applies.
- Configure payment component and post-payment application stage where used.
- Copy and preview the public URL.

### Jodo integration

- Creates payment orders/links using the selected branch's credentials.
- Redirects the public user to the payment provider when payment is required.
- Supports authorization header storage or derivation from API key and secret.
- Processes payment-link and order webhook events including debited, expired,
  and settled outcomes.
- Updates local status, transaction ID, payment time, settlement time, and UTR.
- Associates payment records with leads where available.
- Prevents cancellation of already paid, settled, or cancelled links.

**Key endpoints:** `/api/payment-forms`, `/api/jodo/payment-links`, Jodo webhook
routes, and public form endpoints.

---

## 13. Integration Hub

### Purpose

Connect external services, store credentials, configure mappings, and review
integration activity.

### Current provider tiles

| Type | Provider/use |
|---|---|
| Google Sheets | Google Sheets API v4 lead import/synchronization |
| WhatsApp | AiSensy Smartping messaging and templates |
| Cloud Calling | CallerDesk |
| Cloud Telephony | Tata Smartflo |
| Meta Lead Ads | Facebook and Instagram lead forms |
| SMS | SmartPing SMS |
| Email | SMTP mail server |

### Common behaviour

- Add and configure one or more integrations.
- Display connection and credential state.
- Store secrets encrypted and avoid returning saved secret values to the UI.
- Map external fields to CRM fields where applicable.
- Review synchronization and error information.
- Map supported communication accounts to branches.

**Key endpoints:** `/api/hub/integrations` and provider-specific APIs.

---

## 14. Message Templates

### Purpose

Maintain WhatsApp, SMS, and Email templates in one settings screen.

The screen contains WhatsApp, SMS, and Email tabs. Each channel also retains
its existing deep-link route for compatibility.

### Template visibility rule

- An administrator chooses the CRM users allowed to use each template.
- CRM Admin and Super Admin users always see all templates.
- Other users see only templates explicitly assigned to them.
- An unassigned template is admin-only.
- Visibility is enforced by the API for lists, previews, and sends, including
  bulk sends; it is not only a frontend filter.

### 14.1 WhatsApp templates

- Select a WhatsApp account and synchronize provider templates.
- Filter by status, category, language, type, account, and date criteria.
- Create, edit, duplicate, preview, archive/delete, and inspect history where
  provider and permission allow.
- View approved, pending, draft, rejected, and archived states.
- Map accounts to branches and review usage/cost information.

### 14.2 SMS templates

- The default view is a searchable template list.
- **Add Template** opens a centered create modal; Edit opens the same modal with
  existing values.
- Store template name, exact DLT-approved message, DLT Content ID, category,
  optional Sender ID, active status, variables, and visible users.
- Variables use numbered placeholders such as `{{1}}` and `{{2}}`.
- Preview displays rendered wording, character count, and SMS segment count.
- DLT Content ID is selected from the template during individual or bulk send.

### 14.3 Email templates

- Create and edit reusable subject and formatted HTML body.
- Configure category, active/inactive status, merge fields, and visible users.
- Supported merge fields include student, parent, lead, branch, class,
  counsellor, application, follow-up, and organization information.
- Duplicate an existing template while retaining its visibility assignments.

---

## 15. Google Sheets

### Purpose

Import leads from a configured spreadsheet.

### Current behaviour

- Connect a Google account through OAuth.
- Select spreadsheet and worksheet.
- Map columns to CRM lead fields.
- Configure destination branch and source.
- Run and monitor synchronization.
- Skip same-branch/same-source duplicates.
- Append a new source/history entry when the matching lead arrives from a
  different source rather than creating an unnecessary duplicate.

**Key endpoints:** Google/integration APIs under `/api/hub` and OAuth callback.

---

## 16. Meta Lead Ads

### Purpose

Receive Facebook and Instagram lead-form submissions.

### Current behaviour

- Connect a Meta account.
- Select and subscribe pages/forms.
- Map provider fields to CRM lead fields.
- Configure destination branch, source, and other defaults.
- Receive leads through webhook and retain import records.
- Show connection and recent-import information.

**Key endpoints:** `/api/meta/*` and Meta webhook routes.

---

## 17. CallerDesk

### Purpose

Provide cloud-calling actions from CRM leads.

### Current behaviour

- Store provider credentials from the frontend.
- Synchronize provider users, groups, or campaigns where supported.
- Map CRM users to provider agents.
- Configure branch calling identifiers.
- Place calls from lead actions.
- Record call activity and results against the lead.

**Key endpoints:** `/api/callerdesk/*`.

---

## 18. Tata Smartflo

### Purpose

Provide Tata cloud-telephony calling from CRM leads.

### Current behaviour

- Store Smartflo credentials and configuration.
- Map CRM users/branches to telephony settings.
- Initiate supported calls from Leads.
- Record telephony activity against leads.

**Key endpoints:** `/api/smartflo/*`.

---

## 19. Email configuration and sending

### Configuration

- Enable or disable Email.
- Configure SMTP host, port, encryption, username, password, sender name,
  sender email, and reply-to email.
- Save credentials without returning the stored password to the browser.
- Validate the connection and send a test email.
- Map email accounts to branches where multiple accounts are configured.

### Individual Email

- Compose from a lead using a permitted template or write without a template.
- Specify To, CC, BCC, subject, formatted body, and supported attachments.
- Render merge fields using the related lead and current counsellor context.
- Store sent/failed status and activity against the lead.

### Bulk Email

- Send one permitted template to selected leads.
- Resolve merge fields separately for each lead.
- Skip leads without an email address and report them.
- Record per-recipient success/failure information.

**Key endpoints:** `/api/email/configuration`, `/api/email/accounts`,
`/api/email/templates`, `/api/email/send`, and `/api/email/send-bulk`.

---

## 20. SmartPing SMS configuration and sending

### Configuration

- Configure the complete SmartPing API URL or its base domain.
- The supported send URL includes
  `https://pgapi.sparc.smartping.io/fe/api/v1/send?`.
- Configure username, API password, six-character Sender ID, default DLT Content
  ID, PE ID, optional telemarketer ID, Unicode default, public callback URL, and
  callback secret.
- Validation does not send a billable test SMS.

### Sending

- The `/fe/api/v1/send` flow sends SmartPing's expected query parameters,
  including username, password, unicode, from, to, text, DLT Content ID, and PE
  ID.
- The legacy JSON `/message` endpoint remains supported when explicitly
  configured.
- Indian mobile numbers are normalized and validated.
- Individual and bulk template sends are supported.
- Bulk sends skip/report missing or invalid recipients without losing the whole
  batch.

**Key endpoints:** SMS integration APIs under `/api/hub` and template/send APIs
under `/api/sms`.

---

## 21. Public Enquiry Form

### Purpose

Capture a lead through a public URL without CRM login.

### Current behaviour

- Route: `/public/enquiry/:formKey`.
- Renders the configured fields, ordering, required rules, and branding.
- Validates email and required payment information where applicable.
- Creates or updates/re-enquires a lead using configured defaults.
- Retains attribution information.
- If payment is disabled, successful submission shows the configured success
  result or redirect.
- If payment is enabled, the form creates a payment order and redirects to Jodo.
- Payment callback/status requests update the enquiry and related lead.

**Key endpoints:** `/api/public/enquiry-forms/:formKey`, including `submit`,
`payment-order`, `payment-callback`, and `payment-status`.

---

## 22. Public Payment Form

### Purpose

Collect a configured payment through a shareable link without CRM login.

### Current behaviour

- Route: `/payment/:formKey`.
- Shows configured categories, amounts, selection rule, payer fields, expiry,
  and active state.
- Creates a local submission and Jodo payment link/order.
- Redirects the payer to the provider URL.
- Stores payment and settlement status for Collections reporting.
- Applies configured success message and redirect after completion where used.

**Key endpoints:** public payment-form endpoints and Jodo payment-link APIs.

---

## 23. OAuth Callback

### Purpose

Complete provider authorization flows such as Google and Meta.

### Current behaviour

- Accepts the provider authorization response.
- Validates the one-time state value.
- Exchanges the authorization code.
- Stores the credential against the integration.
- Returns the user to the relevant settings flow.
- `/oauth-error` displays provider authorization failures.

---

## Cross-screen behaviour

### Application shell

- Collapsible desktop sidebar and mobile navigation drawer.
- Active business-unit switcher.
- Permission-filtered Main, Operations, and System navigation.
- Breadcrumb header, global search, notifications, quick actions, profile menu,
  and daily usage indicator.
- Screen-level error boundary keeps the shell available if one screen fails.

### Notifications

- In-app notifications have unread counts.
- Follow-up and untouched-lead counters appear in the header where applicable.
- Visual notifications and best-effort notification sound are supported.

### Error and loading behaviour

- Screens display loading and empty states.
- API errors are surfaced through inline alerts or toasts.
- Bulk Email/SMS dialogs avoid repeated error/reload loops and remain stable
  when a provider/template request fails.

### Responsive behaviour

- Main navigation, filters, tables, tab strips, drawers, and modals adapt for
  smaller displays.
- Overflowing tab/stage strips scroll rather than forcing unusable wrapping.

---

## External dependencies and operational conditions

- MySQL/MariaDB must be reachable and current ordered migrations must be
  applied.
- Production requires secure JWT, database, encryption, and provider secrets.
- The public API URL must be reachable by configured webhook providers.
- Google, Meta, WhatsApp, SmartPing SMS, SMTP, CallerDesk, Smartflo, and Jodo
  remain dependent on active external accounts and provider availability.
- WhatsApp templates require provider approval.
- SMS text and DLT identifiers must match operator registration.
- SMTP delivery remains subject to the organization's mail-server policies.
- Payment status depends on successful provider redirection/webhook processing.

## Recommended user-acceptance coverage

1. Verify each production role and its own/team/department/all data scope.
2. Verify business-unit and branch switching does not leak records.
3. Test manual, bulk, Google, Meta, and public-form lead capture.
4. Test assignment, follow-up, referral, stage progression, and re-enquiry.
5. Test individual and bulk WhatsApp, SMS, and Email using assigned templates.
6. Test template visibility with an administrator and an unassigned counsellor.
7. Test enquiry-payment and standalone payment-form redirection through Jodo.
8. Test debited, expired, settled, failed, and cancelled payment outcomes.
9. Verify payment visibility on Leads and Collections export.
10. Verify reports, saved-report visibility, automations, and assignment rules.
