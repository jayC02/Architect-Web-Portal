ALTER TABLE "CalendarConnection"
ADD COLUMN "accessTokenEncrypted" TEXT,
ADD COLUMN "refreshTokenEncrypted" TEXT,
ADD COLUMN "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "grantedScopes" TEXT;
