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
- Live Google Calendar sync for internal deadlines, with Outlook kept as a future integration.
- Submission package model and project-file package UI.

## Setup

1. Create `.env` from `.env.example`.
2. Set `DATABASE_URL` and `DIRECT_URL` to a Postgres database.
3. Run `npm install`.
4. Run `npm run db:migrate`.
5. Optional: run `npm run db:seed` for a demo organisation and project.
6. Run `npm start` to start the local Astro server on `127.0.0.1`. Use `npm run dev` to pass different Astro options.

`npm run preview` builds and serves a local Node preview on `127.0.0.1`. It uses the app's local environment settings and writes to `output/local-preview/`. `npm run build` creates the Vercel deployment output. Use a Vercel preview deployment to check that build with deployment settings.

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
- `DOCUMENT_AI_PROVIDER`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_DOCUMENT_MODEL`
- `ANTHROPIC_DOCUMENT_EFFORT`
- `GEMINI_API_KEY`
- `GEMINI_DOCUMENT_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_DOCUMENT_MODEL`
- `DOCUMENT_AI_TIMEOUT_MS`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CALENDAR_OAUTH_STATE_SECRET`

## Google Calendar Setup

1. Create or select a project in Google Cloud Console and enable the Google Calendar API.
2. Configure the OAuth consent screen and add the Calendar events scope used by the portal.
3. Create an OAuth 2.0 Client ID with application type `Web application`.
4. Add the production redirect URI: `https://www.architectpro.co.uk/api/integrations/google-calendar/callback`.
5. For local testing, also add `http://localhost:4321/api/integrations/google-calendar/callback`.
6. Add the client id and secret to the server environment. Never expose the client secret through a `PUBLIC_` variable.
7. Generate the encryption and state secrets with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

8. Set `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` to the first value and `GOOGLE_CALENDAR_OAUTH_STATE_SECRET` to the second.
9. Run `npm run db:deploy` in production, redeploy, then connect the account from Settings > Integrations.

For an External OAuth app left in Google's `Testing` publishing state, add the architect's Google account as a test user. Google normally expires these refresh tokens after seven days, so move the OAuth app to production or use an Internal Google Workspace app before relying on continuous live sync.

The portal is the source of truth. Active internal deadlines are written to the connected Google account's primary calendar. Completing, cancelling, editing, or deleting a portal deadline updates or removes its synced Google event.

## AI Document Classification

Set `DOCUMENT_AI_PROVIDER` to `anthropic`, `gemini` or `openai` and configure the matching server-side API key. The selected provider receives each uploaded PDF so it can inspect the visual document, title block, layout, and embedded text. Keys are never sent to the browser. If no provider is configured, a request fails, output is invalid, or a PDF exceeds the AI limit, the existing deterministic sorter is used instead.

With `anthropic`, PDFs are read by Claude through the Messages API using structured JSON output. The default model is `claude-haiku-5-5`; `ANTHROPIC_DOCUMENT_EFFORT` (`low`, `medium` or `high`, default `medium`) trades speed and cost against thoroughness. Rate-limit (`429`) and overloaded (`529`) responses are retried using the `retry-after` header, except when the monthly spend cap has been reached. Completion certificate documents use the same provider.

The default Gemini model is `gemini-3.1-flash-lite`. If a configured Gemini model has been retired and returns `404`, the classifier retries the stable `gemini-flash-lite-latest` alias before falling back to deterministic sorting.

The original uploaded PDF is never modified. AI suggestions remain in review until a user saves the document types. In production, document reads and previews continue through organisation-scoped private routes and Supabase service credentials remain server-side.

## Application Draft Uploads

AI-first application documents use metadata-only portal requests and direct private Supabase Storage uploads. The portal creates each document ID and object key, then finalises the upload by checking provider metadata before analysis. Limits are centralised at 20 files, 25 MB per file, and 75 MB per draft; browser uploads use at most three workers and analysis uses two.

An unfinished draft expires after seven days and is hidden from the New application page as soon as it expires. Objects that were uploaded but never finalised are removed after 24 hours. The `/api/cron/application-draft-cleanup` Vercel cron (daily, 05:00 UTC, authenticated with `CRON_SECRET`) marks expired drafts, deletes their temporary files, and removes abandoned uploads for every organisation. Users can also remove a draft from the "Continue an application" list, which cancels it through the same endpoint as "Cancel draft". Storage accounting is database metadata based, so it can temporarily differ from provider billing while an abandoned provider object awaits cleanup.

## Validation

The dashboard redesign has an isolated, read-only preview using labelled sample data:

```powershell
npm run preview:dashboard
```

Open `http://127.0.0.1:4322/dashboard`. This renders the dashboard components without authentication, database access or live API mutations. Project and application links explain their destination in the full application. Use `?state=empty` or `?state=error` to inspect recovery states. With the preview running, `npm run verify:dashboard` checks the interactive flows and responsive layout and saves screenshots under `output/dashboard-preview/`.

For the public homepage, run `npm run preview:homepage` and open `http://127.0.0.1:4323/`. This preview includes the always-3D six-act scroll story, dashboard and existing login/registration screens; all mutations are blocked. `npm run verify:homepage` checks chapter navigation, replay, reload restoration, toolbar changes, rotation, GPU recovery, mobile texture memory, reduced motion, responsive layouts, entry redirects and account navigation. Screenshots are saved under `output/homepage-preview/scroll-story/`. Its synthetic signed-in header exists only in the isolated preview, outside production source. See `docs/homepage-design.md` for source ownership and asset provenance.

- `npm run check`
- `npm run test:security`
- `npm run build`

## Security Note

The current dependency set is pinned to the Node 20-compatible Astro 5 / Vercel adapter 9 line. `npm audit --omit=dev` reports advisories in the Astro/Vercel adapter chain whose automated fix upgrades to Astro 6 / Vercel adapter 10, which requires Node `>=22.12.0`. Upgrade Node first, then revisit `npm audit fix --force` and rerun the validation commands.
