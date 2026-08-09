# Lead qualification write-back API

Response to *SmatBot — AI Voice Lead Qualification, CRM Integration Specification v0.1*,
section 8: the update-record API and its authentication method.

One endpoint serves both phases. It is **not** the CRM's ordinary lead update API —
that one authenticates a person, expires, carries that person's branch scope and can
change every field on a record. A partner needs none of that.

---

## Authentication

A long-lived API key, issued per partner per business unit, sent on every request:

```
X-API-Key: smatbot_<key>
```

Only the SHA-256 hash is stored, so a database leak yields nothing replayable. The key
is shown once at issue. It can be revoked on its own without affecting any user login.

Confirm a key works before wiring anything up:

```
GET /api/partner/ping
→ 200 { "success": true, "data": { "partner": "smatbot", "businessUnitId": 1,
                                   "scopes": "lead.qualification.write" } }
```

`401` means the key is missing, wrong or revoked.

---

## Write-back

```
POST /api/partner/leads/qualification
Content-Type: application/json
X-API-Key: smatbot_<key>
```

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `phase` | `1` or `2` | yes | 1 = AI pre-qualification, 2 = representative call |
| `lead_id` | string | yes | The CRM lead number, e.g. `ADM-2026-000621`. The numeric id is also accepted |
| `call_id` | string | recommended | Your identifier for this call. Makes retries safe — see *Retries* |
| `call_status` | enum | no | Phase 1: `answered`, `no_answer`, `busy`, `failed`. Phase 2: `connected`, `rep_no_answer`, `lead_no_answer`, `busy`, `failed` |
| `lead_quality` | enum | no | `hot`, `warm`, `cold`, `lost` |
| `call_assessment` | enum | no | `qualified`, `short_call`, `insufficient_info` — section 7 of your spec, already supported |
| `fitment` | object | no | `{ "<dimension>": "fit" \| "partial" \| "no_fit" }`. `<name>_fitment` top-level keys are also accepted |
| `purchase_urgency` | string | no | Free text |
| `budget_footprint` | string | no | Free text, phase 2 |
| `call_timestamp` | ISO 8601 | no | Send with an offset, e.g. `2026-08-09T10:15:00+05:30` |
| `call_duration` | integer seconds | no | Phase 2 |
| `recording_url` | string | no | Appears as a player on the lead's activity timeline |
| `summary` | string | no | AI summary |
| `sales_rep_id` | string | no | Phase 2 |

### Example

```json
{
  "phase": 1,
  "lead_id": "ADM-2026-000621",
  "call_id": "sb-88213",
  "call_status": "answered",
  "lead_quality": "warm",
  "call_assessment": "qualified",
  "fitment": { "budget": "fit", "grade": "fit", "curriculum": "partial", "campus": "no_fit" },
  "purchase_urgency": "within a month",
  "call_timestamp": "2026-08-09T10:15:00+05:30",
  "recording_url": "https://…/call.mp3"
}
```

### Responses

| Code | Meaning |
|---|---|
| `200` | Applied. Body echoes `lead_id`, `crm_lead_id`, `phase`, `lead_quality` |
| `400` | A value is outside its allowed set. The message names the field and the allowed values |
| `401` | Key missing, wrong or revoked |
| `404` | No lead in this key's business unit matches `lead_id` |

An unrecognised enum value is **rejected, not stored** — a typo will not sit silently in
the CRM looking like data.

---

## Retries

Send `call_id`. A delivery repeated with the same `phase` + `call_id` **updates** the
existing record rather than creating a second one, so retrying after a timeout is safe.

Without `call_id`, all deliveries for a phase collapse onto one record.

## Phase precedence

Phase 2 refines phase 1, as your spec states. The CRM enforces it: a phase 2 rating
always wins, and a phase 1 arriving late — or replayed — cannot overwrite it.

## Where the data lands

- `lead_quality` is written to the lead itself, so the list can be sorted and filtered
  by it. This is what lets the team see which leads to call first.
- The full result is kept per phase, so phase 1 and phase 2 can be compared.
- The call joins the lead's **activity timeline** alongside CallerDesk and Smartflo
  calls, with the recording playable inline.

---

## The qualification dimensions, for admissions

Section 4.2 of the spec carries sample dimensions (`budget_fitment`, `size_fitment`,
`configuration_fitment`, `location_fitment`). The admissions equivalents are below.

**Please send the captured value as well as the fit rating.** The CRM already has
structured fields for four of these, so a captured value updates the record and routes
the lead; a rating on its own can only be read. Use `captured` alongside `fitment`:

```json
{
  "fitment":  { "grade": "fit", "curriculum": "fit", "campus": "partial", "budget": "no_fit" },
  "captured": { "grade": "VI", "curriculum": "CBSE", "campus": "NACHARAM",
                "academic_year": "2027-2028", "admission_type": "Day Scholar",
                "budget": "up to 1.8L per year" }
}
```

| Dimension | CRM field | Allowed values |
|---|---|---|
| `grade` | `class_id` | `EY - 1`, `EY - 2`, `EY - 3`, `I`–`X`, `XI - SCI`, `XI - COM`, `XI - HUM`, `XII - SCI`, `XII - COM`, `XII - HUM` |
| `curriculum` | `curriculum_id` | `CBSE`, `Cambridge` |
| `campus` | `branch_id` | 20 branches — `NACHARAM`, `MAHENDRA HILLS`, `ALWAL`, … (full list on request) |
| `admission_type` | `admission_type_id` | `New admission`, `Transfer`, `Sibling admission`, `Re-admission`, `Day Scholar`, `Hostel` |
| `academic_year` | `academic_year` | `2027-2028` |
| `budget` | *(none yet)* | free text |

Unrecognised values are stored as sent and flagged, never silently mapped — a parent
saying "6th standard" must not become a different grade by guesswork.

## Still needed from SmatBot

1. **Confirmation of the dimensions above**, and whether you can return `captured`
   values, not only fit ratings.
2. **The trigger endpoint** and its expected payload, per section 3.
3. **`sales_rep_id`** — whether this is the CRM employee id or an identifier you hold.
   The CRM can send either.
4. **Retry policy** — attempts and period, for both call attempts and webhook delivery.
5. **Recording URL lifetime** — the CRM plays it directly in the browser. If the link
   is signed and expires, say how long it lasts and whether it can be re-fetched.
6. **Calling window, language and consent** — see the covering note.

## Issuing a key

```
cd apps/api
node --env-file=.env scripts/issue-partner-key.js smatbot "SmatBot AI voice" 1
```

The last argument is the business unit id. The key is printed once.
