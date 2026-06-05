-- CreateIndex
CREATE INDEX "ProjectDocument_organisationId_originalName_idx" ON "ProjectDocument"("organisationId", "originalName");

-- CreateIndex
CREATE INDEX "ProjectDocument_organisationId_sizeBytes_idx" ON "ProjectDocument"("organisationId", "sizeBytes");
