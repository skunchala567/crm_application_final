# Tata Smartflo integration

This CRM integration follows Tata Smartflo's API reference at:

- https://docs.smartflo.tatatelebusiness.com/reference/introduction-to-apis-1
- https://docs.smartflo.tatatelebusiness.com/llms.txt

## Setup

1. Run `database/mysql/051_callerdesk_calling.sql` if it has not already been applied, followed by `database/mysql/052_smartflo_telephony.sql` and `database/mysql/053_smartflo_ivr_mapping.sql`.
2. Open **Settings → Integrations**, add **Tata Cloud Telephony / Tata Smartflo**, and open its settings.
3. Enter either the Smartflo login email and password or a permanent access token supplied by Tata.
4. Test the connection. The CRM then loads DIDs from `/v1/my_number`, departments from `/v1/departments`, and users/agents from `/v1/users`.
5. Map each branch's DID, inbound IVR, and department in **Settings → Business Units → Branches**. Saving a DID and IVR updates the Tata My Number destination to `ivr||<IVR ID>`.
6. Map each CRM user to a Smartflo agent in **Settings → User Management**.
7. Configure the generated public HTTPS webhook URL in Smartflo.

The webhook must not use `localhost`. In Smartflo, enable the relevant inbound and outbound triggers for each DID and use either JSON or form-urlencoded POST delivery. Tata may require a support request to enable Webhooks for the account.

System recordings must currently be prepared in the Smartflo portal because Tata's system-recording creation API is documented as temporarily disabled. Create the recording and IVR in Smartflo first; the CRM retrieves the resulting IVR and maps it to the branch DID.

## Existing-table reuse

- `crm_integrations`: encrypted Smartflo credentials/token and account-level fallback DID/department.
- `branches`: branch DID, department, and inbound/outbound flags.
- `app_users`: Smartflo user/agent mapping for one-click calling.
- `crm_call_activities`: initiated calls, call outcomes, durations, and recording URLs.
- `crm_lead_activities`: lead timeline entries.
- `crm_dialer_campaigns` and `crm_dialer_queue`: reserved for a future Smartflo dialer workflow.

No new operational table is introduced. Migrations 052 and 053 only extend `branches` and `app_users`.

## Supported API operations

- Authentication through `/v1/auth/login`, with cached one-hour tokens, or a permanent token.
- Click-to-call through `/v1/click_to_call` using the mapped agent and branch DID.
- Smartflo users/agents, DIDs, departments, live calls, and call-detail records.
- Existing IVR retrieval and IVR create/update/delete proxy operations.
- DID-to-IVR routing through `PUT /v1/my_number/{id}`.
- Webhook ingestion for status, direction, duration, disposition, and recording URL.

The outbound caller ID resolves in this order: caller ID supplied with the request, branch Smartflo DID, then account default DID. Agent identity is always taken from the CRM user's Smartflo mapping.

## Recording capture

Enable **Capture call recordings in CRM** in Smartflo settings to retain recording URLs and Tata recording identifiers returned through completion webhooks. Captured recordings appear in the lead activity timeline. Disabling it removes recording fields from stored webhook payloads and prevents recording links from being retained.

This controls CRM retention, not Tata's underlying recording policy. Recording must also be enabled for the applicable DIDs, agents, departments, and call products in Smartflo. Configure the public HTTPS CRM webhook for the final call-hangup event so Tata sends `recording_url` and `aws_call_recording_identifier`.
