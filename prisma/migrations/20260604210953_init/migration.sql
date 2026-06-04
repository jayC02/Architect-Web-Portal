-- CreateEnum
CREATE TYPE "OrganisationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('LEAD', 'SURVEY', 'DESIGN', 'PLANNING', 'BUILDING_WARRANT', 'CONSTRUCTION', 'COMPLETION', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('LOCATION_PLAN', 'SITE_PLAN', 'BLOCK_PLAN', 'EXISTING_DRAWING', 'PROPOSED_DRAWING', 'ELEVATION', 'SECTION', 'DRAINAGE', 'STRUCTURAL', 'ENERGY', 'CERTIFICATE', 'PHOTO', 'CORRESPONDENCE', 'SUPPORTING_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlanningStatus" AS ENUM ('NOT_STARTED', 'DRAFTING', 'SUBMITTED', 'VALIDATED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED', 'APPROVED', 'REFUSED', 'WITHDRAWN', 'CLOSED');

-- CreateEnum
CREATE TYPE "WarrantType" AS ENUM ('INITIAL', 'AMENDMENT', 'STAGED', 'LATE', 'COMPLETION_CERTIFICATE');

-- CreateEnum
CREATE TYPE "WarrantStatus" AS ENUM ('NOT_STARTED', 'DRAFTING', 'SUBMITTED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED', 'GRANTED', 'REJECTED', 'EXPIRED', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CompletionCertificateStatus" AS ENUM ('NOT_REQUIRED', 'NOT_STARTED', 'DRAFTING', 'SUBMITTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeadlineType" AS ENUM ('PLANNING_DECISION', 'WARRANT_RESPONSE', 'WARRANT_EXPIRY', 'COMPLETION_CERTIFICATE', 'CLIENT_ACTION', 'INTERNAL_TASK', 'INSPECTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DeadlineStatus" AS ENUM ('UPCOMING', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeadlinePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'OUTLOOK');

-- CreateEnum
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR', 'PAUSED');

-- CreateEnum
CREATE TYPE "SubmissionPackageType" AS ENUM ('PLANNING', 'BUILDING_WARRANT');

-- CreateEnum
CREATE TYPE "SubmissionPackageStatus" AS ENUM ('DRAFT', 'READY', 'EXPORTED', 'SUBMITTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationMember" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganisationRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "townCity" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "localAuthority" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "clientId" TEXT,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "internalReference" TEXT,
    "projectType" TEXT,
    "stage" "ProjectStage" NOT NULL DEFAULT 'LEAD',
    "localAuthority" TEXT,
    "siteAddress" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "revision" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningApplication" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "applicationReference" TEXT,
    "submissionDate" TIMESTAMP(3),
    "validDate" TIMESTAMP(3),
    "decisionTargetDate" TIMESTAMP(3),
    "decisionDate" TIMESTAMP(3),
    "status" "PlanningStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "portalUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildingWarrantApplication" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "warrantReference" TEXT,
    "warrantType" "WarrantType" NOT NULL DEFAULT 'INITIAL',
    "submissionDate" TIMESTAMP(3),
    "firstResponseTargetDate" TIMESTAMP(3),
    "grantedDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "completionCertificateStatus" "CompletionCertificateStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "status" "WarrantStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "portalUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildingWarrantApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT,
    "planningApplicationId" TEXT,
    "buildingWarrantApplicationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "type" "DeadlineType" NOT NULL,
    "status" "DeadlineStatus" NOT NULL DEFAULT 'UPCOMING',
    "priority" "DeadlinePriority" NOT NULL DEFAULT 'MEDIUM',
    "reminderDate" TIMESTAMP(3),
    "completedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "provider" "CalendarProvider" NOT NULL,
    "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "accountEmail" TEXT,
    "externalId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncedCalendarEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "calendarConnectionId" TEXT,
    "deadlineId" TEXT,
    "provider" "CalendarProvider" NOT NULL,
    "providerEventId" TEXT,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncedCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionPackage" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SubmissionPackageType" NOT NULL,
    "status" "SubmissionPackageStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionPackageDocument" (
    "id" TEXT NOT NULL,
    "submissionPackageId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionPackageDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE INDEX "Organisation_slug_idx" ON "Organisation"("slug");

-- CreateIndex
CREATE INDEX "Organisation_updatedAt_idx" ON "Organisation"("updatedAt");

-- CreateIndex
CREATE INDEX "OrganisationMember_userId_idx" ON "OrganisationMember"("userId");

-- CreateIndex
CREATE INDEX "OrganisationMember_organisationId_role_idx" ON "OrganisationMember"("organisationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationMember_organisationId_userId_key" ON "OrganisationMember"("organisationId", "userId");

-- CreateIndex
CREATE INDEX "Client_organisationId_name_idx" ON "Client"("organisationId", "name");

-- CreateIndex
CREATE INDEX "Client_organisationId_updatedAt_idx" ON "Client"("organisationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Site_organisationId_postcode_idx" ON "Site"("organisationId", "postcode");

-- CreateIndex
CREATE INDEX "Site_organisationId_updatedAt_idx" ON "Site"("organisationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_organisationId_status_updatedAt_idx" ON "Project"("organisationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_organisationId_stage_idx" ON "Project"("organisationId", "stage");

-- CreateIndex
CREATE INDEX "Project_organisationId_clientId_idx" ON "Project"("organisationId", "clientId");

-- CreateIndex
CREATE INDEX "Project_organisationId_siteId_idx" ON "Project"("organisationId", "siteId");

-- CreateIndex
CREATE INDEX "ProjectDocument_organisationId_projectId_createdAt_idx" ON "ProjectDocument"("organisationId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectDocument_organisationId_type_idx" ON "ProjectDocument"("organisationId", "type");

-- CreateIndex
CREATE INDEX "ProjectDocument_uploadedById_idx" ON "ProjectDocument"("uploadedById");

-- CreateIndex
CREATE INDEX "PlanningApplication_organisationId_status_decisionTargetDat_idx" ON "PlanningApplication"("organisationId", "status", "decisionTargetDate");

-- CreateIndex
CREATE INDEX "PlanningApplication_organisationId_projectId_idx" ON "PlanningApplication"("organisationId", "projectId");

-- CreateIndex
CREATE INDEX "BuildingWarrantApplication_organisationId_status_firstRespo_idx" ON "BuildingWarrantApplication"("organisationId", "status", "firstResponseTargetDate");

-- CreateIndex
CREATE INDEX "BuildingWarrantApplication_organisationId_expiryDate_idx" ON "BuildingWarrantApplication"("organisationId", "expiryDate");

-- CreateIndex
CREATE INDEX "BuildingWarrantApplication_organisationId_projectId_idx" ON "BuildingWarrantApplication"("organisationId", "projectId");

-- CreateIndex
CREATE INDEX "Deadline_organisationId_status_dueDate_idx" ON "Deadline"("organisationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Deadline_organisationId_projectId_idx" ON "Deadline"("organisationId", "projectId");

-- CreateIndex
CREATE INDEX "Deadline_planningApplicationId_idx" ON "Deadline"("planningApplicationId");

-- CreateIndex
CREATE INDEX "Deadline_buildingWarrantApplicationId_idx" ON "Deadline"("buildingWarrantApplicationId");

-- CreateIndex
CREATE INDEX "CalendarConnection_organisationId_status_idx" ON "CalendarConnection"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_organisationId_provider_key" ON "CalendarConnection"("organisationId", "provider");

-- CreateIndex
CREATE INDEX "SyncedCalendarEvent_organisationId_provider_syncStatus_idx" ON "SyncedCalendarEvent"("organisationId", "provider", "syncStatus");

-- CreateIndex
CREATE INDEX "SyncedCalendarEvent_deadlineId_idx" ON "SyncedCalendarEvent"("deadlineId");

-- CreateIndex
CREATE INDEX "SubmissionPackage_organisationId_projectId_idx" ON "SubmissionPackage"("organisationId", "projectId");

-- CreateIndex
CREATE INDEX "SubmissionPackage_organisationId_status_idx" ON "SubmissionPackage"("organisationId", "status");

-- CreateIndex
CREATE INDEX "SubmissionPackageDocument_documentId_idx" ON "SubmissionPackageDocument"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionPackageDocument_submissionPackageId_documentId_key" ON "SubmissionPackageDocument"("submissionPackageId", "documentId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationMember" ADD CONSTRAINT "OrganisationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningApplication" ADD CONSTRAINT "PlanningApplication_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningApplication" ADD CONSTRAINT "PlanningApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingWarrantApplication" ADD CONSTRAINT "BuildingWarrantApplication_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingWarrantApplication" ADD CONSTRAINT "BuildingWarrantApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_planningApplicationId_fkey" FOREIGN KEY ("planningApplicationId") REFERENCES "PlanningApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_buildingWarrantApplicationId_fkey" FOREIGN KEY ("buildingWarrantApplicationId") REFERENCES "BuildingWarrantApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncedCalendarEvent" ADD CONSTRAINT "SyncedCalendarEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncedCalendarEvent" ADD CONSTRAINT "SyncedCalendarEvent_calendarConnectionId_fkey" FOREIGN KEY ("calendarConnectionId") REFERENCES "CalendarConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncedCalendarEvent" ADD CONSTRAINT "SyncedCalendarEvent_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "Deadline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPackage" ADD CONSTRAINT "SubmissionPackage_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPackage" ADD CONSTRAINT "SubmissionPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPackage" ADD CONSTRAINT "SubmissionPackage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPackageDocument" ADD CONSTRAINT "SubmissionPackageDocument_submissionPackageId_fkey" FOREIGN KEY ("submissionPackageId") REFERENCES "SubmissionPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionPackageDocument" ADD CONSTRAINT "SubmissionPackageDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
