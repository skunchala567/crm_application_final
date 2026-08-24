# Tata Smartflo integration

This CRM integration follows Tata Smartflo's API reference at:

- https://docs.smartflo.tatatelebusiness.com/reference/introduction-to-apis-1
- https://docs.smartflo.tatatelebusiness.com/llms.txt

## Setup

The account belongs to the business unit it is added from
(`crm_integrations.business_unit_id`). Select the unit first: another unit does
not inherit these credentials and configures its own account, and calls, DIDs
and agent mappings follow the account of the unit being worked in.

1. Run `database/mysql/051_callerdesk_calling.sql` if it has not already been applied, followed by `database/mysql/052_smartflo_telephony.sql`, `database/mysql/053_smartflo_ivr_mapping.sql`, and `database/mysql/107_integration_business_unit.sql`.
2. Open **Settings → Integrations**, add **Tata Cloud Telephony / Tata Smartflo**, and open its settings.
3. Enter either the Smartflo login email and password or an API access token from **API Connect → API Tokens**. Do not paste a key from **Click to Call Support API Tokens**: Tata documents that as a separate `api_key` for a predefined calling configuration, not an API authentication token, and it cannot fetch users, DIDs, or departments.
4. Test the connection. The CRM then loads DIDs from `/v1/my_number`, departments from `/v1/departments`, and users/agents from `/v1/users`.
5. Map each branch's DID, inbound IVR, and department in **Settings → Business Units → Branches**. Saving a DID and IVR updates the Tata My Number destination to `ivr||<IVR ID>`.
6. Map each CRM user to a Smartflo agent in **Settings → User Management**.
7. Configure the generated public HTTPS webhook URL in Smartflo.

Opening a lead's **History** tab also reconciles the last 30 days of matching Smartflo CDRs. This provides a fallback for local/development installations whose webhook URL is not publicly reachable and imports Tata's documented `recording_url`, outcome, duration, and agent data into the CRM timeline.

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
- Integration-level calling mode selects either agent-first `/v1/click_to_call` or customer-first `/v1/click_to_call_support`. Customer First requires a separate encrypted Click-to-Call Support API key whose Tata-side configuration determines the second-leg destination.
- Smartflo users/agents, DIDs, departments, live calls, and call-detail records.
- Existing IVR retrieval and IVR create/update/delete proxy operations.
- DID-to-IVR routing through `PUT /v1/my_number/{id}`.
- Webhook ingestion for status, direction, duration, disposition, and recording URL.
- Live call state, elapsed time, and provider hang-up inside Follow-up & Notes. After the live call ends, the CRM reconciles its CDR, Q.850 hang-up cause, duration, and recording. The provider cause and the counsellor's required CRM disposition are retained separately.
- Hang-up uses the active conversation's `call_id` from `/v1/live_calls` with the dedicated `/v1/call/hangup` API. `/v1/call/options` is reserved for Tata's documented Monitor, Whisper, Barge, and Transfer operation types and is not used to disconnect calls.

The outbound caller ID resolves in this order: caller ID supplied with the request, branch Smartflo DID, then account default DID. Agent identity is always taken from the CRM user's Smartflo mapping.

Calling mode is selected once under **Settings → Integrations → Smartflo → Calling configuration** and applies to every Smartflo Call button. **Agent First** calls the mapped CRM agent and then the customer. **Customer First** calls the customer and then the destination configured against the saved Support API key. Both modes normalize into `crm_call_activities` and share the same webhooks, live status, CDR reconciliation, recordings, dispositions, and lead history. The settings screen also provides a real Test Call against the currently saved mode.

For agent-first one-click calling, the CRM sends the mapped user's canonical Smartflo Agent ID (or softphone extension) as `agent_number` and the lead phone as `destination_number`. A registered agent mobile is used only when the Users API supplies no Agent ID. The request always sends `async: 1`, a bounded `call_timeout`, and uses only `/v1/click_to_call`; the customer-first `/v1/click_to_call_support` endpoint is not used. Tata documents that the regular endpoint rings the agent first and calls the customer only after the agent answers.

## Recording capture

Enable **Capture call recordings in CRM** in Smartflo settings to retain recording URLs and Tata recording identifiers returned through completion webhooks. Captured recordings appear in the lead activity timeline. Disabling it removes recording fields from stored webhook payloads and prevents recording links from being retained.

This controls CRM retention, not Tata's underlying recording policy. Recording must also be enabled for the applicable DIDs, agents, departments, and call products in Smartflo. Configure the public HTTPS CRM webhook for the final call-hangup event so Tata sends `recording_url` and `aws_call_recording_identifier`.
