# API developer scripts

These scripts are outside the application runtime and are not executed by `npm run dev`, `npm start`, or `npm run migrate`.

- `diagnostics/` contains read-oriented database and integration checks.
- `maintenance/` contains scripts that can modify configuration or data. Review them before use.
- `experiments/` contains one-off integration probes and test-data utilities. They are not part of the automated test suite.

Run scripts from `apps/api` so dependencies and environment variables resolve consistently:

```powershell
node --env-file=.env scripts/diagnostics/check-schema.js
node --env-file=.env scripts/diagnostics/audit-foreign-keys.js
node --env-file=.env scripts/diagnostics/audit-table-namespace.js
```

The scripts use environment variables and must not contain committed credentials.
