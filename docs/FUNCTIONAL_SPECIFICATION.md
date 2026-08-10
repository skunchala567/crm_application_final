# Functional Specification — Screen by Screen

Companion to [`../memory.md`](../memory.md), which covers architecture. This
document describes what each screen does, who can reach it, and what it talks
to.

Every authenticated screen is scoped to the **active business unit**. The
sidebar unit switcher remounts the page tree, so a screen never shows data from
two units at once.

**Conventions used below**

- *Permission* — the key checked by `<RequirePermission>`; if the user lacks it
  the sidebar entry is hidden and the route is blocked.
- *Key endpoints* — the API calls that drive the screen, not an exhaustive list.

---

## Contents

| # | Screen | Route | Permission |
|---|---|---|---|
| 1 | [Login](#1-login) | `/login` | — |
| 2 | [Dashboard](#2-dashboard) | `/` | `dashboard.overview.view` |
| 3 | [Leads](#3-leads) | `/leads` | `leads.list.view` |
| 4 | [Tracker](#4-tracker) | `/tracker` | `tracker.board.view` |
| 5 | [Bulk Actions](#5-bulk-actions) | `/bulk-actions` | `bulk_actions.workspace.view` |
| 6 | [Reports](#6-reports) | `/reports` | `reports.list.view` |
| 7 | [Report Builder](#7-report-builder) | `/saved-reports/new` | `reports.builder.view` |
| 8 | [Automations](#8-automations) | `/automations` | `automations.workflows.view` |
| 9 | [WhatsApp Inbox](#9-whatsapp-inbox) | `/whatsapp-inbox` | `whatsapp.inbox.view` |
| 10 | [Settings — User Management](#10-settings--user-management) | `/settings/users` | `settings.users.view` |
| 11 | [Settings — Business Units](#11-settings--business-units) | `/settings/business-units` | `settings.business_units.view` |
| 12 | [Settings — Payment Forms](#12-settings--payment-forms) | `/settings/payment-forms` | `settings.payment_forms.view` |
| 13 | [Settings — Integrations](#13-settings--integrations) | `/settings/integrations` | `integrations.hub.view` |
| 14 | [Settings — Google Sheets](#14-settings--google-sheets) | `/settings/google-sheets` | `integrations.google_sheets.view` |
| 15 | [Settings — WhatsApp](#15-settings--whatsapp) | `/settings/whatsapp-templates` | `whatsapp.templates.view` |
| 16 | [Settings — Meta Lead Ads](#16-settings--meta-lead-ads) | `/settings/meta-lead-ads` | `integrations.meta_lead_ads.view` |
| 17 | [Settings — CallerDesk / Smartflo](#17-settings--callerdesk--smartflo) | `/settings/callerdesk`, `/settings/smartflo` | `integrations.*.view` |
| 18 | [Public — Enquiry Form](#18-public--enquiry-form) | public | none |
| 19 | [Public — Payment Page](#19-public--payment-page) | public | none |
| 20 | [OAuth Callback](#20-oauth-callback) | `/oauth-callback` | none |

Legacy paths redirect rather than 404: `/operations` → `/tracker`,
`/integrations` → `/settings/integrations`, `/settings/lead-config` and the
academic routes → the matching Business Units tab.

---

## 1. Login

**Purpose.** Authenticate against the shared attendance account directory.

**Behaviour.** Email + password, with a show/hide toggle. On success the JWT and
user object go to `localStorage` (`crm_token`, `crm_user`) and the shell loads.
The token's `exp` is read on every start-up; an expired token is discarded and
the user returns here. A `crm:session-expired` event (fired by any 401) clears
the session from anywhere in the app.

**Session handling.** An idle timer warns before signing the user out; the
warning dialog offers *Stay signed in*. Daily active time is recorded and
surfaced on the Dashboard.

**Key endpoints.** `POST /api/auth/login`

---

## 2. Dashboard

**Purpose.** The daily "what needs attention" view for an admissions team.

**Layout.** Two tabs — **Overview** and **Saved Reports** — plus a filter icon
and a clear-filters icon in the header. Widgets, their order, width and
visibility come from the *Reports → Dashboard layout* editor, so no two units
need the same dashboard.

**Filters.** A single popover holds Branch, Lead Owner, Stage, Sub-stage,
Channel, Source and Campaign (each multi-select) plus a date filter whose field
is selectable (lead added / updated / referred / next follow-up / re-enquired).
Dependent lists narrow each other — choosing a Channel restricts Sources. A
badge counts active filters; the clear icon appears only when something is set.
Every widget below reflects the filters.

**Widgets.**

| Widget | Content |
|---|---|
| Stat cards | Total leads, New this week, Follow-ups due, Follow-ups done — each with a comparison against the previous period |
| My Daily CRM Activity | Line chart over the selected range, toggling between CRM usage time and lead counts |
| Admissions view | Per-stage counts as bars, each showing `count (share%)`, closing with a **Total Leads** row |
| Leads by Branch, Curriculum, Class and Stage | Expandable pivot table with selectable row fields and columns, plus a full-screen mode |
| Saved report widgets | Any saved report pinned to the dashboard |

All report-style widgets share a minimum height so a row never mixes a tall
chart with a collapsed card.

**Key endpoints.** `GET /api/dashboard`, `GET /api/leads`

---

## 3. Leads

**Purpose.** The primary working surface — find leads, act on them, record what
happened.

**Structure.** Command centre (saved views + actions) → stage tabs → filter row
→ table → detail drawer.

**Stage tabs.** "All" plus every configured stage plus "Re-enquired", each with
a live count reflecting the active filters. The strip stays on one line and
scrolls, with arrows appearing only when it overflows.

**Filters.** Branch, touch status, sub-stage, source, next-follow-up date range,
and a pending-follow-ups toggle (with a badge for follow-ups due through today).
More filters live in the full-screen filter workspace, which can be saved as a
**view** and re-applied later. An applied-filter rail shows what is active.

**Table.** Student (name, phone, avatar), class, source with timestamp, stage
badge, owner, next follow-up, and a sticky Actions column:

| Action | Effect |
|---|---|
| Call | Places a call through whichever telephony provider is configured |
| WhatsApp | Opens the send panel with the branch's mapped account and its templates |
| Follow-up history | Comments and follow-ups, with a count badge |
| Edit | Opens the lead drawer |
| More | Re-enquiry, delete, and other row actions |

Rows are selectable for bulk stage change, reassignment and export. Deleting a
lead may require the business unit's deletion password, which is asked for in a
dialog.

**Lead drawer.** Create and edit, split into **Student** and **Source** sections,
with the activity trail alongside. Source changes append history rather than
overwriting, so attribution survives a re-enquiry.

**Key endpoints.** `GET/POST/PUT/DELETE /api/leads`, `/api/leads/meta`,
`/api/saved-filters`, `/api/leads/referral-options/all`

---

## 4. Tracker

**Purpose.** Internal task and meeting workflow, separate from the lead
pipeline. Configured per unit under Business Units → Tracker.

**Tabs.**

1. **Action Items** — tasks with owner, deadline, stage and approval state.
   Filters for search, status, owner, deadline and approval; a calendar view;
   and CSV export. Tasks move through configurable operation stages and can
   require approval before closing. Guest owners (people without CRM accounts)
   can be assigned.
2. **MOM Records** — minutes of meeting sessions, each holding discussion points
   that can be promoted into action items.
3. **My Approvals** — items awaiting the signed-in user's decision, badged with
   a pending count.

**Key endpoints.** `/api/platform/business-units/:id/operations`,
`/mom-sessions`, `/tracker-approvals`, `/tracker-users`, `/tracker-guest-owners`

---

## 5. Bulk Actions

**Purpose.** Move data in and out in volume.

**Tabs.**

1. **Uploads** — spreadsheet import of leads. Download a template shaped by the
   unit's configured lead fields, upload, then review a per-row result: created,
   skipped as duplicate, or failed with a reason. Source rows are retained for
   audit.
2. **Operations** — history of bulk stage changes, reassignments and deletions,
   with who ran them and how many records each touched.
3. **Campaigns** — bulk WhatsApp/dialer campaigns and their delivery counts.

**Key endpoints.** `/api/bulk-uploads`, `/api/bulk-operations`,
`/api/callerdesk/campaigns`

---

## 6. Reports

**Purpose.** Saved reporting and dashboard composition.

**Tabs.**

1. **Reports library** — saved reports with their visual, filters and
   visibility. Reports can be opened, edited, duplicated or deleted.
2. **Dashboard layout** — the editor behind the Dashboard's Overview tab: choose
   which widgets appear, their order and their width (quarter / half /
   three-quarter / full). Saved per business unit and broadcast to open tabs, so
   the Dashboard picks up changes without a reload.

**Key endpoints.** `GET /api/leads`, `GET /api/dashboard`,
`/api/report-data-sources`

---

## 7. Report Builder

**Purpose.** Build one report.

**Layout.** Library rail (saved reports) → canvas (title, visual picker,
preview) → settings rail.

**Capabilities.** Pick a visual (funnel, bar, column, pie, table), choose the
grouping field and measure, filter by stage and date, and preview against live
lead data as you edit. Saved reports can be pinned to the Dashboard and shared
subject to visibility rules.

---

## 8. Automations

**Purpose.** Act on leads without anyone clicking.

**Tabs.** **Workflows** and **Bulk campaigns**, each badged with a count.

**Workflow list.** Name, category, created by, created on, start time, execution
summary (last status plus completed / failed / skipped / pending counts) and an
active toggle. The execution counts come from an append-only log, so they
survive edits to the workflow.

**Workflow editor.** An IF → THEN flow rail beside the editor.

- **IF** — condition groups combined with AND/OR, each condition being
  *field · operator · value*. Date fields support relative ("within last N
  minutes/hours/days") and absolute modes. Sub-groups allow nesting.
- **THEN** — actions: update a lead field, or send a WhatsApp template through a
  chosen account, each with an optional delay. A "don't re-check after delay"
  switch decides whether conditions are re-evaluated when a delayed action
  finally runs.

**Execution.** The engine runs every 30 seconds: it evaluates active workflows
whose start time has passed, queues one execution per lead and action, then
performs those that are due. Every action writes a lead activity. Editing a
workflow's rules clears its pending queue so leads are re-evaluated.

**Key endpoints.** `GET/POST/PUT /api/automations`, `/api/automations/:id/run`,
`/api/automations/:id/status`

---

## 9. WhatsApp Inbox

**Purpose.** Two-way conversations against the connected WhatsApp account.

**Behaviour.** Conversation list with unread counts, message thread, and a
composer restricted to approved templates outside the 24-hour service window.
Opening a conversation marks it read and links through to the lead record.

**Key endpoints.** `/api/hub/smartping/conversations/...`,
`/api/hub/integrations/:id/smartping/send`

---

## 10. Settings — User Management

**Purpose.** Decide who can use the CRM and what they may do.

**Tabs.** **Users** and **Access Control** (the latter only with
`settings.access_control.view`).

**Users.** Every active employee, whether or not they have a CRM login. Grant
access, assign a role, assign branches and business units, and activate or
deactivate. Branch lists show every active branch, not only the administrator's
own, so an admin assigned to 4 of 20 branches can still grant the other 16.

**Access Control.** Role-to-permission matrix backed by the permission registry,
with an audit trail of changes and of denied requests.

**Key endpoints.** `/api/admin/users`, `/api/admin/users/meta`,
`/api/admin/users/:id/status`, `/api/rbac/*`

---

## 11. Settings — Business Units

**Purpose.** Everything that makes one tenant different from another.

**Tabs.** The strip scrolls when it overflows.

| Tab | Contents |
|---|---|
| Overview | Counts of modules, lead fields, pipeline stages and tracker stages |
| Branches & payments | Branches, their Jodo payment credentials, application amount and stage |
| Lead fields | Field definitions — type, required, list column, filterable, searchable, importable, reportable |
| Enquiry forms | Public form builder: which fields, in what order, and the public URL |
| Lead pipeline | Stages and sub-stages, with allowed transitions |
| Source configuration | Channels, sources and campaigns, grouped by category |
| Academic configuration | Academic years, curricula, classes and admission types (legacy-school units only) |
| Tracker | Operation workflows and stages behind the Tracker screen |
| Database tables | Reference view of the unit's underlying tables |

A business unit may carry a **deletion password**; destructive actions then
require it, prompted through a dialog.

**Key endpoints.** `/api/platform/business-units`, `.../config`

---

## 12. Settings — Payment Forms

**Purpose.** Collect fees and application payments online.

**Behaviour.** Define a form (categories, amounts, which branch collects), share
its public link, and review submissions with their payment status. Payment links
are issued through Jodo using the branch's credentials.

**Key endpoints.** `/api/payment-forms`, `/api/jodo/payment-links`

---

## 13. Settings — Integrations

**Purpose.** The integration hub — connect, configure and monitor providers.

**Behaviour.** Cards per provider showing connection state. Opening one gives
**Settings**, **Field mapping** and **Sync history**. Field mapping pairs a
provider column with a CRM lead field. Sync history lists runs with records
processed / created / updated / failed — and only records a run that actually
created a lead, so a fetch that found nothing new leaves no noise.

**Key endpoints.** `/api/hub/integrations/...`

---

## 14. Settings — Google Sheets

**Purpose.** Import leads from spreadsheets on a schedule.

**Behaviour.** Connect a Google account by OAuth, pick a spreadsheet and
worksheet, map columns to lead fields, and set the branch and source each row
should land under. A sync runs every 60 seconds. Rows matching an existing lead
in the same branch *and* source are skipped and listed as duplicates; a match on
a different source appends a source to the existing lead instead of creating a
new one.

**Key endpoints.** `/api/hub/integrations/:id/...`, OAuth callback

---

## 15. Settings — WhatsApp

**Purpose.** Templates, usage and per-branch account routing.

**Tabs.**

1. **Dashboard** — messages sent, split by utility and marketing, estimated
   spend, day-wise usage with CSV export, and breakdowns by branch and campaign.
   Filterable by account and branch.
2. **Templates** — the template library synced from the provider, filtered by
   status (All / Approved / Pending / Draft / Rejected / Archived), account, and
   an advanced filter (created range, type, status, category, language). Create,
   edit, duplicate and preview templates; **Send message** and **History** for
   ad-hoc sends.
3. **Branch mapping** — which WhatsApp account each branch sends from. A branch
   with several accounts uses the first as its default; counsellors at a branch
   are offered only its accounts, and templates are filtered to match. Branches
   with no account are called out, since their counsellors cannot send at all.

**Key endpoints.** `/api/whatsapp/dashboard`, `/api/whatsapp/integrations/:id/templates`

---

## 16. Settings — Meta Lead Ads

**Purpose.** Receive Facebook/Instagram lead-form submissions.

**Behaviour.** Connect a Meta account, subscribe pages and forms, map form
fields to lead fields, and set the branch/source for incoming leads. Shows
connection state and recent imports; leads arrive by webhook.

**Key endpoints.** `/api/meta/...`

---

## 17. Settings — CallerDesk / Smartflo

**Purpose.** Telephony.

**Behaviour.** Store provider credentials, sync agents/users and groups or
departments, and map CRM users to provider agents. Once configured, the Leads
call action dials through the provider and inbound/outbound calls are logged
back against the lead.

**Key endpoints.** `/api/callerdesk/*`, `/api/smartflo/*`

---

## 18. Public — Enquiry Form

**Purpose.** Public lead capture, no login.

**Behaviour.** Renders the field schema defined in Business Units → Enquiry
forms, branded per unit. On submit it creates a lead attributed to the form's
configured branch, source and channel. Duplicate handling matches the rest of
the system: a repeat phone number in the same branch and source is treated as a
re-enquiry rather than a new lead.

**Key endpoints.** `POST /api/public/enquiry/...`

---

## 19. Public — Payment Page

**Purpose.** Pay a fee or application amount from a shared link, no login.

**Behaviour.** Shows the payment form's categories and amounts, collects payer
details, and hands off to the Jodo payment link. The result is recorded against
the submission and visible under Settings → Payment Forms.

**Key endpoints.** `/api/public/payment-forms/...`

---

## 20. OAuth Callback

**Purpose.** Landing page for provider OAuth redirects (Google, Meta).

**Behaviour.** Exchanges the returned code using a one-time state token, stores
the encrypted credential against the integration, and returns the user to the
integration's settings screen. `/oauth-error` renders the failure with the
provider's message.

---

## Cross-screen behaviour

**Shell.** Sidebar (business unit switcher, Main / Operations / System groups,
collapsible) and a topbar with breadcrumbs, global search, notifications and the
profile menu. Only permitted entries are rendered.

**Global search.** Searches leads across everything the user may see; gated on
`leads.search.view`, since the API refuses the endpoint without it.

**Tooltips.** Every button and filter explains itself on hover with no delay,
sourced from `data-tooltip`, from `title`, or from `aria-label` on icon-only
controls.

**Notifications.** In-app notifications (`crm_notifications`) with an unread
badge in the topbar.

**Tabs.** All tab bars share one visual language: an outlined pill when
unselected, a tinted pill with a brand underline when selected. Bars that
overflow scroll with arrows rather than wrapping.
