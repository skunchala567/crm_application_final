# API developer scripts

These scripts are outside the application runtime and are not executed by `npm run dev`, `npm start`, or `npm run migrate`.

- `diagnostics/` contains read-oriented database and integration checks.
- `maintenance/` contains scripts that can modify configuration or data. Review them before use.
- `experiments/` contains one-off integration probes and test-data utilities. They are not part of the automated test suite.
- `export/` generates and verifies a MariaDB 10.11 provisioning script from the live schema. Read-only against the source.

Run scripts from `apps/api` so dependencies and environment variables resolve consistently:

```powershell
node --env-file=.env scripts/diagnostics/check-schema.js
node --env-file=.env scripts/diagnostics/audit-foreign-keys.js
node --env-file=.env scripts/diagnostics/audit-table-namespace.js
```

The scripts use environment variables and must not contain committed credentials.

## MariaDB export

`export/export-mariadb.js` reads the live MySQL 8 schema and data and writes a
single self-contained script that provisions the same database on MariaDB 10.11.
`export/verify-mariadb-export.js` then proves the generated file matches the
source, row for row and value for value.

```powershell
node scripts/export/export-mariadb.js
node scripts/export/verify-mariadb-export.js
```

Both read `apps/api/.env` directly, so `--env-file` is not needed.

| Flag | Effect |
| --- | --- |
| `--schema-only` | DROP + CREATE only, no `INSERT` statements |
| `--include-attendance` | Also drop, create and populate the attendance-only tables (~790k rows, ~400 MB) |
| `--out <path>` | Write somewhere other than `database/exports/MARIADB_1011_FULL_EXPORT.sql` |

The output lands in `database/exports/`, which is git-ignored: it contains lead
PII, password hashes and integration credentials.
