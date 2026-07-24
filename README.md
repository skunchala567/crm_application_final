# Admissions CRM

Admissions CRM is a Node.js and React application connected to the existing `attendance_biometric` MySQL database.

## Technology

- Node.js with Express for the API
- React with Vite for the web application
- MySQL through `mysql2`
- JWT authentication using existing Attendance accounts

## Project layout

- `apps/api/src/server.js` — API routes, authentication, and business logic
- `apps/api/src/migrate.js` — CRM database migrations
- `apps/web/src` — React application
- `database/migrations` — ordered MySQL migrations
- `DATABASE_SCHEMA_MYSQL.sql` — MySQL reference schema

## Local development

1. Configure `.env` with the MySQL connection and JWT secret.
2. Install dependencies with `npm install`.
3. Apply migrations with `npm run migrate -w apps/api`.
4. Start both applications with `npm run dev`.

The web application runs at `http://localhost:3000` and the API at `http://localhost:3001`.

## Validation

Run `npm run check` to check the API syntax and build the web application.
