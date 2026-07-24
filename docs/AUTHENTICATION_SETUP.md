# Authentication setup

ArchitectPro supports the existing email/password flow, Google account sign-in, and one-time password reset links.

## Google sign-in

1. In Google Cloud Console, configure the OAuth consent screen for the ArchitectPro domain.
2. Create a Web application OAuth client.
3. Add the deployed callback URL as an authorised redirect URI:

   `https://your-domain.example/api/auth/google/callback`

4. Add the local callback when testing locally:

   `http://localhost:4321/api/auth/google/callback`

5. Configure these server-side environment variables:

   - `GOOGLE_AUTH_CLIENT_ID`
   - `GOOGLE_AUTH_CLIENT_SECRET`
   - `GOOGLE_AUTH_REDIRECT_URI`
   - `AUTH_OAUTH_STATE_SECRET`

Generate `AUTH_OAUTH_STATE_SECRET` as a long random value. Do not prefix these variables with `PUBLIC_`.

These credentials are separate from the Google Calendar/Gmail connection settings so each integration can be rotated independently.

## Password reset email

1. Create a Resend API key.
2. Verify the sending domain in Resend.
3. Set:

   - `RESEND_API_KEY`
   - `AUTH_EMAIL_FROM`, for example `ArchitectPro <accounts@architectpro.co.uk>`
   - `APP_BASE_URL`, for example `https://architectpro.co.uk`

Reset tokens expire after 45 minutes, are stored only as SHA-256 hashes, and can be used once. A successful reset closes all existing sessions.

## Database migration

Deploy the included Prisma migration before enabling Google sign-in or password reset:

```bash
npm run db:deploy
```

Do not use `prisma db push` against production.
