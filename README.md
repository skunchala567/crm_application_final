# Admissions CRM

Admissions CRM is a Node.js and React admissions-management application connected to the existing `attendance_biometric` MySQL database.

## Technology

- Node.js with Express for the API
- React with Vite for the web application
- MySQL through `mysql2`
- JWT authentication using existing Attendance accounts

## Project layout

- `apps/api/src` - API routes, authentication, integrations, and business logic
- `apps/api/scripts` - developer diagnostics, maintenance utilities, and experiments
- `apps/web/src` - React application
- `database/mysql` - active ordered MySQL migrations
- `database/diagnostics` - optional database inspection queries
- `database/reference` - reference schema snapshots
- `docs/memory.md` - consolidated architecture, feature, integration, and operational reference
- `docs/WHATSAPP_INTEGRATION_GUIDE.md` - portable WhatsApp integration and ERP implementation guide

See `apps/api/scripts/README.md` and `database/README.md` before running non-application utilities.

## Local development

1. Copy `.env.example` to `apps/api/.env` and configure MySQL, JWT, and `INTEGRATION_MASTER_KEY`.
2. Install dependencies with `npm install`.
3. Apply migrations with `npm run migrate -w apps/api`.
4. Start both applications with `npm run dev`.

The web application runs at `http://localhost:3000` and the API at `http://localhost:3001`.

## Validation

Run `npm run check` to check the API syntax and build the web application.

Google and AiSensy account credentials are maintained per account in the `crm_integrations` table through Settings > Integrations. Do not place account credentials in `.env`.
