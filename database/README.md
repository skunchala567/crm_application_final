# Database files

- `mysql/` is the authoritative ordered migration set used by `apps/api/src/migrate.js`.
- `diagnostics/` contains optional verification and root-cause-analysis queries. These do not run automatically.
- `reference/` contains schema snapshots for developer reference; it is not the migration source of truth.

Create schema changes as a new numbered file in `mysql/`. Do not edit an already-applied migration.

## CRM table namespace

Every table owned by this CRM uses the `crm_` prefix because the application
shares the `attendance_biometric` database with the Attendance system.

Examples:

- `crm_leads`
- `crm_integrations`
- `crm_integration_sync_logs`
- `crm_whatsapp_templates`
- `crm_whatsapp_messages`
- `crm_admission_class_configurations`

Shared Attendance master and identity tables keep their existing names. The CRM
references tables such as `app_users`, `employees`, `branches`, roles, and user
access tables but does not rename or own them.

Migration `000_crm_table_namespace.sql` performs the one-time physical rename
for existing databases and is a no-op on clean databases where the new names
already exist.
