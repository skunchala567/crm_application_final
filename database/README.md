# Database files

- `mysql/` is the authoritative ordered migration set used by `apps/api/src/migrate.js`.
- `diagnostics/` contains optional verification and root-cause-analysis queries. These do not run automatically.
- `reference/` contains schema snapshots for developer reference; it is not the migration source of truth.

Create schema changes as a new numbered file in `mysql/`. Do not edit an already-applied migration.

## Which file do I want?

| Goal | Use |
| --- | --- |
| Evolve an existing database | `mysql/` — add a new numbered migration |
| Provision a brand-new database | `reference/FULL_SCHEMA_MYSQL.sql` |
| Read the current shape of a table | `reference/FULL_SCHEMA_MYSQL.sql` |
| Move the database to MariaDB 10.11 | `exports/` — generate with `apps/api/scripts/export/export-mariadb.js` |

`exports/` is git-ignored. It holds generated MariaDB 10.11 provisioning
scripts, which carry real lead PII, password hashes and integration
credentials. Regenerate rather than share, and verify with
`apps/api/scripts/export/verify-mariadb-export.js`.

`reference/FULL_SCHEMA_MYSQL.sql` is a complete `CREATE TABLE IF NOT EXISTS`
snapshot of all 124 objects (98 CRM tables, 7 shared identity/master tables,
18 attendance-only tables, 1 view), generated from the live schema so it
reflects every migration including their `ALTER TABLE` statements. It is safe
to re-run, but because every statement is `IF NOT EXISTS` it cannot upgrade a
table that already exists — it provisions, it does not migrate.

`reference/DATABASE_SCHEMA_MYSQL.sql` is **deprecated — do not run it.** It is
an early design sketch that was never reconciled with `mysql/`. 25 of the 32
tables it declares do not exist in the application, and it uses pre-namespace
names (`leads`, `users`) instead of the real `crm_leads`, `app_users`. It is
kept only as a historical record.

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
