# CallerDesk calling integration

The CRM integrates CallerDesk's published member, group, deskphone, contact, click-to-call, call-report, live-call, routing, dashboard, billing, analysis, break-status, notification and webhook APIs. The implementation uses the operational endpoints documented at <https://api.callerdesk.io/> and keeps the CallerDesk `authcode` encrypted at rest.

Enable **Capture call recordings in CRM** to retain CallerDesk's `CallRecordingUrl` in call activities and the lead timeline. Disabling it removes recording fields from stored webhook payloads and prevents recording links from being retained. CallerDesk account-level recording must also be enabled because its click-to-call API does not publish a general recording toggle.

## Enable it

1. Apply `database/mysql/051_callerdesk_calling.sql` with the normal migration command.
2. Set `INTEGRATION_MASTER_KEY` to a stable secret of at least 32 characters. Do not rotate it without re-encrypting stored credentials.
3. Open **Settings → Calling** and enter the CallerDesk API key, secret key and integration key. CallerDesk also expects the API key in the legacy `authcode` parameter. Encrypted credentials and defaults are stored in `crm_integrations.config`.
4. Map each branch to its CallerDesk DID number (and optional DID ID/call group). These values are stored on the existing `branches` row; the default DID is only a fallback.
5. Copy the generated outcome webhook URL into CallerDesk. The URL includes a random per-account secret; treat it as sensitive.
6. In **User Management**, add or edit each calling user, enable one-click calling, and select their CallerDesk member and optional call group. Mapping fields are stored directly on `app_users`; the member-ID call method is used by the Leads screen.

## Calling workflow

- The phone button on a lead starts click-to-call. The CRM selects the DID mapped to that lead's branch, then CallerDesk rings the mapped agent and connects the lead.
- The callback is matched to a lead by normalized phone number and stores status, direction, start/end times, total/talk duration, cost, group and recording URL.
- A call entry is also added to lead activity. Disposition, notes and a next-follow-up can be stored through the call activity API.
- Lead contacts can be pushed to CallerDesk. Account members, groups, deskphones, reports, live calls, routing, dashboard data and billing data are available through `/api/callerdesk/*`.

## Dialling modes and safety

The data model supports `manual`, `preview`, and `progressive` queues, up to five attempts, retry delays, per-campaign agent/DID/group selection, pausing and cancellation. Creating a queue does not call anyone. A campaign must be explicitly moved to `running`, and each progressive step claims one queued lead. This prevents an accidental bulk launch and makes it possible for the UI or a controlled worker to respect agent availability and consent rules.

CallerDesk does not document a separate predictive/autodial campaign endpoint in the published collection. Progressive auto-dialling is therefore orchestrated by the CRM through click-to-call. Before enabling an unattended worker, define operating hours, DND/consent exclusions, retry limits, concurrency per agent and jurisdiction-specific calling rules.

## Implemented API bridge

- Account: profile/billing, dashboard, deskphones and routing details
- Team: member list, CRM-to-member mapping, groups and live calls
- Leads: contact sync, standard/member/group/reverse/mobile click-to-call, optional scheduled start
- Reporting: filtered call report with dates, DID, member, result and direction
- Outcomes: authenticated inbound webhook, lead matching, recordings and activity history
- Operations: notification reads, campaign/queue storage, start/pause/cancel and guarded next-lead claiming

The lower-level provider endpoints remain isolated in `apps/api/src/callerdesk/callerdesk.routes.js`, so add/update/delete member/group/contact operations can be exposed to administrators later without placing the CallerDesk credential in the browser.
