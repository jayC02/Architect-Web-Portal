-- AlterTable
ALTER TABLE "ProjectFeePlan" ADD COLUMN     "agreedAmount" DECIMAL(18,2),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" DECIMAL(5,2),
ADD COLUMN     "vatTreatment" TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN';

-- AlterTable
ALTER TABLE "ProjectFeeMilestone" ADD COLUMN     "percentage" DECIMAL(7,4),
ADD COLUMN     "scheduleBasis" TEXT NOT NULL DEFAULT 'FIXED';

-- CreateTable
CREATE TABLE "ProjectFeeRevision" (
    "id" TEXT NOT NULL,
    "projectFeePlanId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectFeeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFeeRevision_projectFeePlanId_revision_key" ON "ProjectFeeRevision"("projectFeePlanId", "revision");

-- AddForeignKey
ALTER TABLE "ProjectFeeRevision" ADD CONSTRAINT "ProjectFeeRevision_projectFeePlanId_fkey" FOREIGN KEY ("projectFeePlanId") REFERENCES "ProjectFeePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
