-- CreateIndex
CREATE INDEX "BuildingWarrantApplication_organisationId_updatedAt_idx" ON "BuildingWarrantApplication"("organisationId", "updatedAt");

-- CreateIndex
CREATE INDEX "PlanningApplication_organisationId_updatedAt_idx" ON "PlanningApplication"("organisationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_organisationId_updatedAt_idx" ON "Project"("organisationId", "updatedAt");

-- CreateIndex
CREATE INDEX "ProjectDocument_organisationId_createdAt_idx" ON "ProjectDocument"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectDocument_organisationId_projectId_type_idx" ON "ProjectDocument"("organisationId", "projectId", "type");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");
