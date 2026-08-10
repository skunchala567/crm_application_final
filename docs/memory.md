# Admissions CRM — Project Memory

Last updated: 2026-08-10

The consolidated development and operational reference for the whole project.
For what each screen does, see [`FUNCTIONAL_SPECIFICATION.md`](FUNCTIONAL_SPECIFICATION.md).
For the step-by-step WhatsApp implementation guide, see
[`WHATSAPP_INTEGRATION_GUIDE.md`](WHATSAPP_INTEGRATION_GUIDE.md).

---

## 1. Purpose

A multi-tenant admissions CRM for education groups. It captures enquiries from
web forms, ad platforms, spreadsheets and phone systems, moves them through a
configurable pipeline, and drives follow-up through WhatsApp, telephony and
automation.

It is grafted onto an existing **attendance/biometric** system: it shares that
MySQL database, its `app_users`, `employees`, `branches` and `roles` tables, and
its login credentials. Everything the CRM owns is prefixed `crm_`
(113 tables today, alongside 26 shared/legacy ones).

## 2. Technology

- **Web** — React 18, React Router, Vite, Tailwind v4 over legacy CSS sheets, Lucide icons
- **API** — Node.js, Express (ESM), `mysql2/promise` pool, JWT auth
- **Database** — MySQL 8 (`attendance_biometric`); exportable to MariaDB 10.11 (§11)
- **Integrations** — Google OAuth 2.0 + Sheets API, Meta Lead Ads, AiSensy/Smartping WhatsApp, CallerDesk, Smartflo, Jodo payments
- **Workspace** — npm workspaces (`apps/api`, `apps/web`)

## 3. Project layout

```text
apps/api/src/
  server.js                  ~5200 lines: auth, leads, dashboard, admin, bulk, automations
  automation-engine.js       workflow evaluation + execution queue
  marketing-campaign-engine.js
  rbac/                      permission registry, route→permission map, guards
  integration-hub/           provider framework, repositories, providers/
  whatsapp/ meta/ callerdesk/ smartflo/ partner/
  migrations/                app-managed SQL
  scripts/                   diagnostics, maintenance
apps/web/src/
  App.jsx                    routes, shell, sidebar, permission gating
  components/                shared UI; components/ui = design-system primitives
  lib/                       utils, tooltips, dashboard layout, usage tracking
  pages/                     settings and integration screens
  styles/design-system.css   MUST stay the last stylesheet imported
database/mysql/              NNN_name.sql ordered migrations
database/reference/          schema snapshots
docs/                        this file, functional spec, integration guides
```

## 4. Commands

```bash
npm install
npm run dev                  # API (3001) + web (3000)
npm run build -w apps/web    # production bundle
npm run check -w apps/api    # permission-map audit
npm run check                # API syntax + web build
```

## 5. Core domain model

- **Business unit** (`crm_business_units`) is the tenant boundary. Almost every
  table carries `business_unit_id`; the web sends `X-Business-Unit-Id` and the
  API scopes queries to it. Switching units remounts the page tree
  (`key={activeBusinessUnitId}`), so screens must not cache across units.
- **Lead** (`crm_leads`) — student, phone, branch, class, curriculum,
  stage/substage, source/channel/campaign, owner employee.
- **Pipeline** is configurable per unit (`crm_lead_stages`,
  `crm_lead_substages`, plus a metadata variant for dynamic modules). No stage
  name is hard-coded except "Re-enquired", which is derived.
- **Attribution** — source history in `crm_lead_source_history`; re-enquiries
  append a source rather than overwriting.
- **Activity trail** — `crm_lead_activities` records every automated and manual
  action, and is the only durable record of some automation outcomes.

## 6. Authentication and authorization

- Login uses the existing Attendance account; JWTs live in `localStorage` and
  are checked for expiry on every start-up.
- CRM access is gated by CRM roles plus `crm_user_access_status`.
- Roles: `SUPER_ADMIN`, `CRM_ADMIN`, `ADMISSION_MANAGER`, `COUNSELLOR`,
  `CRM_VIEWER`.
- Permissions are `domain.subject.action` strings held in
  `crm_permission_registry` and mapped to routes in
  `apps/api/src/rbac/route-permissions.js`. `npm run check -w apps/api` fails if
  an endpoint is unmapped — currently **257 mapped, 21 deliberately open**.
- The web mirrors the same keys: `usePermissions().can(key)` hides navigation,
  `<RequirePermission do="...">` blocks the route. A hidden link and a blocked
  route can never disagree.
- Branch scope is applied to lead queries and related operations.
- `INTEGRATION_MASTER_KEY` must be a stable secret of ≥32 characters. It
  encrypts OAuth access/refresh tokens with AES-256-GCM; changing it makes
  existing tokens unreadable and forces reauthorization.

## 7. Lead identity and duplicate rules

Shared by manual creation, bulk import, Google Sheets, public forms and every
other intake path:

- A mobile number may appear across different branches.
- A mobile number may have multiple sources within the same branch.
- **(mobile, branch, source) is the true duplicate boundary.**
- A repeat enquiry in the same branch from a *different* source links the new
  source to the existing lead and surfaces it as **re-enquired**, not discarded.
- Source ID is accepted directly; channel is derived from source; academic
  information is derived through class.

Relevant migrations: `012_lead_source_history.sql`,
`020_unique_lead_branch_source.sql`, `021_source_channel_relationship.sql`.

## 8. Integrations

| Integration | Direction | Notes |
|---|---|---|
| Google Sheets | inbound | OAuth, field mapping, 60s sync, duplicates → `crm_integration_skipped_leads` |
| Meta Lead Ads | inbound | webhook + page/form subscription |
| WhatsApp (AiSensy / Smartping) | in + out | templates synced from provider, per-branch account mapping, media uploads, webhooks |
| CallerDesk / Smartflo | telephony | click-to-call, dialer campaigns, webhook call logging |
| Jodo | payments | per-branch API keys, payment links |
| Partner API | inbound | API-key authenticated |

The **integration hub** (`integration-hub/`) is the generic framework:
`crm_integrations` + OAuth tokens + field mappings + sync jobs. Per-account
Google and AiSensy credentials belong in `crm_integrations`, never `.env`.

Sync history is in `crm_integration_sync_logs`; it and
`crm_integration_error_logs` only take a row when a lead was actually created,
so a fetch that found nothing new leaves no noise.

## 9. Automation

`crm_automation_workflows` hold `{conditions, actions, logic}` JSON. Every 30
seconds the engine evaluates active workflows whose `start_at` has passed
against a single immutable lead snapshot, and inserts one row per
(workflow, lead, action) into `crm_automation_executions`.

That table is a **work queue**: editing a workflow's rules deletes its rows so
every lead is re-evaluated (the unique key on `(workflow_id, lead_id,
action_index)` would otherwise block re-scheduling). Durable run history is
appended separately to `crm_automation_execution_log` — that is what the UI
counts, so totals survive edits.

## 10. Conventions and traps

- **`api()` returns the parsed body, not an axios `{data}` envelope.** Several
  bugs have come from `response.data.x` against an endpoint answering `{x}`.
- **`BulkUpload.css` styles the bare `button` element globally** (44px tall,
  `padding: 0 20px`, `min-width: max-content`) and is *unlayered*, so it
  outranks every Tailwind utility regardless of specificity. Component button
  sizing must be plain CSS in a later-loading sheet.
- **`styles/design-system.css` must remain the last stylesheet imported** — it
  wins ties against the legacy sheets it overrides.
- **Grid placement follows order-modified document order.** A tab strip with a
  stale `order` lands in the wrong grid column; scope `order` rules with `>`.
- **Migrations are numbered `database/mysql/NNN_*.sql`** and applied manually. A
  missing one surfaces as `Unknown column …` at API start-up. Do not reuse a
  number.
- Timezone is pinned to `+05:30` on every pooled connection; user-facing dates
  are formatted in `Asia/Kolkata`.
- **Tooltips** — `lib/tooltips.js` turns `data-tooltip`, `title` and
  `aria-label` (on icon-only controls) into one instant, non-clipping layer.
  Prefer `data-tooltip`; never rely on the native `title` delay.
- **Tabs** share one visual language: outlined pill when unselected, tinted pill
  with a brand underline when selected. Overflowing bars use
  `components/ScrollableTabStrip.jsx`.
- `window.prompt` is unavailable in embedded browsers — the deletion-password
  challenge uses a React dialog registered through `setDeletionPasswordPrompt`.

## 11. Database export and MariaDB conversion

The application runs on MySQL 8, but the database can be exported as a single
self-contained script that provisions the same database on **MariaDB 10.11**.
Both scripts read `apps/api/.env` directly, so `--env-file` is not needed, and
both are read-only against the source.

```bash
cd apps/api
node scripts/export/export-mariadb.js       # generate
node scripts/export/verify-mariadb-export.js # prove it matches the source
```

| Flag | Effect |
|---|---|
| `--schema-only` | DROP + CREATE only, no `INSERT` statements |
| `--include-attendance` | Also drop, create and populate the attendance-only tables (~790k rows, ~400 MB) |
| `--out <path>` | Write somewhere other than `database/exports/MARIADB_1011_FULL_EXPORT.sql` |

**What the conversion does.**

- `utf8mb4_0900_ai_ci` — MySQL-8-only, absent in MariaDB — is rewritten to
  `utf8mb4_unicode_ci` throughout.
- `DROP TABLE IF EXISTS` + `CREATE` for CRM-owned tables and the shared
  identity/master tables the CRM has foreign keys into.
- `CREATE TABLE IF NOT EXISTS` (never dropped, no data) for attendance-only
  tables, unless `--include-attendance` is passed — so a CRM restore cannot
  destroy attendance history.
- `AUTO_INCREMENT=<n>` is stripped from every `CREATE TABLE`; populated tables
  instead get an explicit `ALTER TABLE … AUTO_INCREMENT = MAX(id)+1` after their
  data, so an empty table starts at 1.
- **Row IDs are written explicitly and never renumbered**, so every foreign key,
  JSON payload reference and audit-log target id stays valid.

**Verification** (`verify-mariadb-export.js`) runs three checks: coverage (every
managed table has a DROP and a CREATE), row count against `COUNT(*)` on the
source, and content — the server evaluates the exported value literals and the
resulting hash is compared with the same hash over the live table, which is what
proves the escaping of text, JSON, binary and datetime values. `--file <path>`
verifies a specific export.

**Output lands in `database/exports/`, which is git-ignored**: it contains lead
PII, password hashes and integration credentials. Regenerate rather than share.

Related: `database/reference/FULL_SCHEMA_MYSQL.sql` is a
`CREATE TABLE IF NOT EXISTS` snapshot of the live schema. It is safe to re-run
but, because every statement is `IF NOT EXISTS`, it cannot upgrade an existing
database — use the ordered migrations for that.

## 12. Environment configuration

In `.env` (see `.env.example`):

- API port and allowed web origin
- JWT signing secret and expiry
- MySQL connection (`MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`)
- `INTEGRATION_MASTER_KEY`
- Optional provider endpoint/retry defaults

Never commit live credentials.

## 13. Operational requirements

- MySQL must be available; demo mode is disabled.
- Apply database migrations before deploying a version that references new
  columns.
- Keep `INTEGRATION_MASTER_KEY` backed up and unchanged.
- Configure Google redirect URIs exactly in Google Cloud Console.
- Use public HTTPS URLs for Google callbacks, WhatsApp webhooks and media.
- Persist `uploads/whatsapp` or move to object storage before scaling the API
  horizontally; set reverse-proxy upload limits for attachment sizes.

## 14. Known gaps

- **Migration 005** (integrations consolidation) is not applied on the current
  database. The API logs a warning at start-up and runs a backward-compatible
  fallback for `integration_type`, `provider_name`, `integration_name`.
- Automation execution counts are cumulative across rule edits.
- Backfilled automation history records `action_index` 0, since the activity
  trail does not store which action fired.

## 15. Validation

```bash
npm run check                # API syntax + web build
npm run check -w apps/api    # permission-map audit
```

Additional smoke and QA scripts live under `apps/api/src` for leads, users,
filters and configuration.

Expected non-blocking build warning: React Router's package-level `"use client"`
directives may be ignored by Vite during bundling.
