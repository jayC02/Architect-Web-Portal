CREATE TYPE "LifecycleAggregateType" AS ENUM ('PROJECT');
CREATE TYPE "LifecycleEventType" AS ENUM ('PROJECT_CREATED');
CREATE TYPE "LifecycleEventSource" AS ENUM ('MANUAL_PROJECT', 'APPLICATION_DRAFT');
CREATE TYPE "LifecycleActorType" AS ENUM ('USER', 'SYSTEM');
CREATE TYPE "WorkflowEffectStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRYABLE', 'COMPLETED', 'FAILED_FINAL');
CREATE TYPE "ActionItemKind" AS ENUM ('DOCUMENT_REVIEW');
CREATE TYPE "ActionItemPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "ActionItemStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ProjectActivityEventType" AS ENUM ('PROJECT_CREATED');
CREATE TYPE "ProjectActivityVisibility" AS ENUM ('STANDARD');
CREATE TYPE "WorkflowTargetKey" AS ENUM ('PROJECT_DOCUMENT_REVIEW');

ALTER TABLE "SyncedCalendarEvent" ADD COLUMN "syncKey" TEXT;

CREATE TABLE "LifecycleEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "aggregateType" "LifecycleAggregateType" NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" "LifecycleEventType" NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "source" "LifecycleEventSource" NOT NULL,
    "actorType" "LifecycleActorType" NOT NULL,
    "actorUserId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowEffect" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "lifecycleEventId" TEXT NOT NULL,
    "handlerKey" TEXT NOT NULL,
    "status" "WorkflowEffectStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkflowEffect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceLifecycleEventId" TEXT NOT NULL,
    "kind" "ActionItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "actionUrl" TEXT NOT NULL,
    "priority" "ActionItemPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ActionItemStatus" NOT NULL DEFAULT 'OPEN',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceLifecycleEventId" TEXT NOT NULL,
    "eventType" "ProjectActivityEventType" NOT NULL,
    "summary" TEXT NOT NULL,
    "actorType" "LifecycleActorType" NOT NULL,
    "actorUserId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "visibility" "ProjectActivityVisibility" NOT NULL DEFAULT 'STANDARD',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowTarget" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "key" "WorkflowTargetKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "offsetDays" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkflowTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LifecycleEvent_organisationId_idempotencyKey_key" ON "LifecycleEvent"("organisationId", "idempotencyKey");
CREATE INDEX "LifecycleEvent_organisationId_dispatchedAt_createdAt_idx" ON "LifecycleEvent"("organisationId", "dispatchedAt", "createdAt");
CREATE INDEX "LifecycleEvent_organisationId_projectId_occurredAt_idx" ON "LifecycleEvent"("organisationId", "projectId", "occurredAt");
CREATE INDEX "LifecycleEvent_aggregateType_aggregateId_occurredAt_idx" ON "LifecycleEvent"("aggregateType", "aggregateId", "occurredAt");
CREATE INDEX "LifecycleEvent_actorUserId_idx" ON "LifecycleEvent"("actorUserId");

CREATE UNIQUE INDEX "WorkflowEffect_lifecycleEventId_handlerKey_key" ON "WorkflowEffect"("lifecycleEventId", "handlerKey");
CREATE INDEX "WorkflowEffect_organisationId_status_availableAt_idx" ON "WorkflowEffect"("organisationId", "status", "availableAt");
CREATE INDEX "WorkflowEffect_status_availableAt_leaseExpiresAt_idx" ON "WorkflowEffect"("status", "availableAt", "leaseExpiresAt");
CREATE INDEX "WorkflowEffect_leaseOwner_leaseExpiresAt_idx" ON "WorkflowEffect"("leaseOwner", "leaseExpiresAt");

CREATE UNIQUE INDEX "ActionItem_organisationId_dedupeKey_key" ON "ActionItem"("organisationId", "dedupeKey");
CREATE INDEX "ActionItem_organisationId_status_priority_availableAt_idx" ON "ActionItem"("organisationId", "status", "priority", "availableAt");
CREATE INDEX "ActionItem_organisationId_projectId_status_idx" ON "ActionItem"("organisationId", "projectId", "status");
CREATE INDEX "ActionItem_sourceLifecycleEventId_idx" ON "ActionItem"("sourceLifecycleEventId");

CREATE UNIQUE INDEX "ProjectActivity_organisationId_idempotencyKey_key" ON "ProjectActivity"("organisationId", "idempotencyKey");
CREATE INDEX "ProjectActivity_organisationId_projectId_occurredAt_idx" ON "ProjectActivity"("organisationId", "projectId", "occurredAt");
CREATE INDEX "ProjectActivity_sourceLifecycleEventId_idx" ON "ProjectActivity"("sourceLifecycleEventId");
CREATE INDEX "ProjectActivity_actorUserId_idx" ON "ProjectActivity"("actorUserId");

CREATE UNIQUE INDEX "WorkflowTarget_organisationId_key_key" ON "WorkflowTarget"("organisationId", "key");
CREATE INDEX "WorkflowTarget_organisationId_enabled_idx" ON "WorkflowTarget"("organisationId", "enabled");
CREATE UNIQUE INDEX "SyncedCalendarEvent_syncKey_key" ON "SyncedCalendarEvent"("syncKey");

ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LifecycleEvent" ADD CONSTRAINT "LifecycleEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkflowEffect" ADD CONSTRAINT "WorkflowEffect_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowEffect" ADD CONSTRAINT "WorkflowEffect_lifecycleEventId_fkey" FOREIGN KEY ("lifecycleEventId") REFERENCES "LifecycleEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_sourceLifecycleEventId_fkey" FOREIGN KEY ("sourceLifecycleEventId") REFERENCES "LifecycleEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_sourceLifecycleEventId_fkey" FOREIGN KEY ("sourceLifecycleEventId") REFERENCES "LifecycleEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkflowTarget" ADD CONSTRAINT "WorkflowTarget_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
