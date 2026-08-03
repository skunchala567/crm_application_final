# Multi-Business CRM Architecture

## Compatibility strategy

`School Admissions` is the default Business Unit and uses `legacy_school` compatibility mode. Its existing lead, academic, source, automation, follow-up, integration, and communication tables remain authoritative. Migration `033_business_units_metadata_platform.sql` adds a non-null Business Unit reference to every existing school lead without changing its identifiers or workflow.

New Business Units use `metadata` mode. The main Leads route selects the correct implementation:

- `legacy_school` → existing `LeadsPage`
- `metadata` → generated `DynamicLeadsPage`

This routing boundary prevents a risky rewrite of the working admissions application.

## Metadata model

- `crm_business_units`: isolated business workspaces and compatibility mode.
- `crm_user_business_units`: optional per-user access and access level.
- `crm_business_modules`: enabled modules and layout/settings metadata.
- `crm_metadata_fields`: dynamic field types, validation, filters, search, and list-column settings.
- `crm_metadata_forms`: configurable form sections for future multi-form layouts.
- `crm_metadata_pipelines`: Business Unit lead pipelines.
- `crm_metadata_pipeline_stages`: ordered, typed, coloured lead stages.
- `crm_metadata_stage_transitions`: allowed transitions, conditions, and actions.
- `crm_dynamic_leads`: generic metadata-driven lead records.
- `crm_operation_workflows`: Business Unit operational processes.
- `crm_operation_stages`: ordered operation stages and checklists.
- `crm_operation_records`: runtime operational work linked to dynamic or legacy leads.

Custom values are stored as JSON against stable `field_key` definitions. This allows administrators to add fields without DDL or deployments while keeping common lead identity, ownership, pipeline, and follow-up fields indexable.

## Request scoping

The frontend stores the active Business Unit and sends it as `X-Business-Unit-Id` on API calls. New platform endpoints always include a Business Unit ID in their path and validate the authenticated user's access. Administrators have platform-wide access; other users are limited through `crm_user_business_units`.

Existing shared modules can adopt the header incrementally by adding `business_unit_id` to their root records or resolving it through their lead relationship. No UI rewrite is required for tasks, notes, follow-ups, communications, documents, reports, or dashboards.

## Extension rules

1. Do not add industry-specific columns to `crm_dynamic_leads`.
2. Add configurable attributes through `crm_metadata_fields`.
3. Store industry workflow definitions in pipeline or operation metadata.
4. Scope every new runtime record by `business_unit_id`.
5. Keep School Admissions changes inside the legacy profile until explicitly migrated.
6. Reuse shared activities, communications, documents, and follow-ups through lead linkage and the active Business Unit filter.
