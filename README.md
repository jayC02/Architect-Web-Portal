# Architect Web Portal

An Astro/React/Prisma MVP foundation for architecture practice operations.

## Architecture

- Astro server output with React islands for interactive forms.
- Tailwind CSS with a restrained professional dashboard UI.
- Prisma/Postgres data model.
- Custom email/password auth using bcrypt password hashes and database-backed sessions.
- HTTP-only `architect_portal_session` cookie with hashed tokens stored in the database.
- Organisation-scoped data access through server-side membership checks.
- Zod validation for auth, project, client, site, document, application and deadline payloads.
- Origin validation for unsafe HTTP methods.
- In-memory rate limiting for auth, mutations and uploads.
- Local development uploads with Supabase Storage required in production.

## MVP Features

- Registration, login, logout and private route protection.
- Organisation, members and `OWNER` / `ADMIN` / `MEMBER` roles in the schema.
- Dashboard with active projects, deadlines, recent files, planning/warrant actions and missing document warnings.
- Project CRUD foundation with linked clients and sites.
- Client and site profile creation.
- Project document upload and manual classification.
- Planning application tracker.
- Building warrant tracker.
- Deadline/reminder model and UI.
- Calendar integration placeholder records for Google and Outlook.
- Submission package model and project-file package UI.

## Setup

1. Create `.env` from `.env.example`.
2. Set `DATABASE_URL` and `DIRECT_URL` to a Postgres database.
3. Run `npm install`.
4. Run `npm run db:migrate`.
5. Optional: run `npm run db:seed` for a demo organisation and project.
6. Run `npm run dev`.

## Environment Variables

- `DATABASE_URL`
- `DIRECT_URL`
- `PUBLIC_SITE_URL`
- `PUBLIC_ALLOWED_ORIGINS`
- `UPLOAD_STORAGE_PROVIDER`
- `UPLOAD_STORAGE_DIR`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `DEBUG_PERF`

## Validation

- `npm run check`
- `npm run test:security`
- `npm run build`

## Security Note

The current dependency set is pinned to the Node 20-compatible Astro 5 / Vercel adapter 9 line. `npm audit --omit=dev` reports advisories in the Astro/Vercel adapter chain whose automated fix upgrades to Astro 6 / Vercel adapter 10, which requires Node `>=22.12.0`. Upgrade Node first, then revisit `npm audit fix --force` and rerun the validation commands.
