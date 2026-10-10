-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "addressProvenance" JSONB,
ADD COLUMN     "addressProvider" TEXT,
ADD COLUMN     "addressVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "administrativeAuthority" TEXT,
ADD COLUMN     "authorityVerification" TEXT NOT NULL DEFAULT 'legacy-unverified',
ADD COLUMN     "buildingStandardsAuthority" TEXT,
ADD COLUMN     "nationalPark" TEXT,
ADD COLUMN     "planningAuthority" TEXT,
ADD COLUMN     "uprn" TEXT;
