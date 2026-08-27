# BonVoice IVR integration

Implemented from the public BonVoice Postman collection:
https://documenter.getpostman.com/view/21786347/2sAY52bJfR

## Setup

1. Run `database/mysql/109_bonvoice_ivr.sql`.
2. Open **Settings → Integrations → BonVoice IVR**.
3. Save either a BonVoice API token or username/password, the default DID and
   channel ID.
4. In User Management, enable BonVoice and enter each CRM user's own agent
   destination number. Map branch-specific DIDs where required.
5. Configure the generated callback URL in BonVoice for both call notification
   and call hangup events. JSON and `application/x-www-form-urlencoded` are
   accepted by the CRM endpoint.

## Provider mapping

- Authentication: `POST /usermanagement/external-auth/`, then
  `Authorization: Token <token>`.
- Lead calls: `POST /autoDialManagement/autoCallBridging/` with
  `autocallType=3`. Leg A rings the configured agent destination; leg B rings
  the lead. A unique `eventID` correlates every lifecycle event.
- Status fallback: `GET /get-autocall-log/{eventID}/`.
- IVR routes: `GET /external-route-list/` and voicebot route creation through
  `POST /external-route-create/`.
- Hangup recording: `ResourceURL` is retained in
  `crm_call_activities.recording_url` and shown in lead Activity History.
- Inbound IVR: `DisplayNumber` selects the branch DID, `SourceNumber` matches
  the lead, and `DTMF` is retained in the call notes.

Credentials and tokens are encrypted using the integration-hub master key and
are never returned to the browser. Webhook retries update the existing
`eventID`/`callID` activity instead of creating duplicates.
