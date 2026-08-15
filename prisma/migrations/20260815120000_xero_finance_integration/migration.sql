CREATE TYPE "XeroConnectionStatus" AS ENUM ('IDLE', 'SYNCING', 'CONNECTED', 'ERROR', 'RECONNECT_REQUIRED', 'DISCONNECTED');
CREATE TYPE "XeroReportType" AS ENUM ('PROFIT_AND_LOSS', 'AGED_RECEIVABLES');

CREATE TABLE "XeroConnection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "xeroConnectionId" TEXT NOT NULL,
    "xeroTenantId" TEXT NOT NULL,
    "xeroTenantName" TEXT NOT NULL,
    "xeroShortCode" TEXT,
    "baseCurrency" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "grantedScopes" TEXT NOT NULL,
    "status" "XeroConnectionStatus" NOT NULL DEFAULT 'IDLE',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "syncStartedAt" TIMESTAMP(3),
    "contactsLastSyncedAt" TIMESTAMP(3),
    "invoicesLastSyncedAt" TIMESTAMP(3),
    "paymentsLastSyncedAt" TIMESTAMP(3),
    "reportsLastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XeroConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XeroOAuthState" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "selectionTokenHash" TEXT,
    "selectionExpiresAt" TIMESTAMP(3),
    "pendingAccessTokenEncrypted" TEXT,
    "pendingRefreshTokenEncrypted" TEXT,
    "pendingAccessTokenExpiresAt" TIMESTAMP(3),
    "pendingGrantedScopes" TEXT,
    "pendingTenants" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XeroOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XeroContactSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "xeroContactId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountNumber" TEXT,
    "contactStatus" TEXT,
    "isCustomer" BOOLEAN NOT NULL DEFAULT false,
    "xeroUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XeroContactSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XeroInvoiceSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "xeroInvoiceId" TEXT NOT NULL,
    "xeroContactId" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL,
    "invoiceType" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "subtotal" DECIMAL(18,2) NOT NULL,
    "totalTax" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "amountPaid" DECIMAL(18,2) NOT NULL,
    "amountDue" DECIMAL(18,2) NOT NULL,
    "xeroUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XeroInvoiceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XeroPaymentSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "xeroPaymentId" TEXT NOT NULL,
    "xeroInvoiceId" TEXT,
    "paymentDate" TIMESTAMP(3),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT,
    "xeroUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XeroPaymentSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XeroClientLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "xeroContactId" TEXT NOT NULL,
    "linkedByUserId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XeroClientLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XeroProjectInvoiceLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "xeroInvoiceId" TEXT NOT NULL,
    "linkedByUserId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XeroProjectInvoiceLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XeroReportSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "reportType" "XeroReportType" NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT,
    "revenue" DECIMAL(18,2),
    "netProfit" DECIMAL(18,2),
    "summary" JSONB,
    "reportUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XeroReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XeroAgedReceivableSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "xeroContactId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "currentAmount" DECIMAL(18,2) NOT NULL,
    "days1To30" DECIMAL(18,2) NOT NULL,
    "days31To60" DECIMAL(18,2) NOT NULL,
    "days61To90" DECIMAL(18,2) NOT NULL,
    "days91Plus" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "summary" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XeroAgedReceivableSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "XeroConnection_organisationId_key" ON "XeroConnection"("organisationId");
CREATE UNIQUE INDEX "XeroConnection_xeroConnectionId_key" ON "XeroConnection"("xeroConnectionId");
CREATE UNIQUE INDEX "XeroConnection_organisationId_xeroTenantId_key" ON "XeroConnection"("organisationId", "xeroTenantId");
CREATE INDEX "XeroConnection_organisationId_status_idx" ON "XeroConnection"("organisationId", "status");
CREATE INDEX "XeroConnection_xeroTenantId_idx" ON "XeroConnection"("xeroTenantId");
CREATE UNIQUE INDEX "XeroOAuthState_stateHash_key" ON "XeroOAuthState"("stateHash");
CREATE UNIQUE INDEX "XeroOAuthState_selectionTokenHash_key" ON "XeroOAuthState"("selectionTokenHash");
CREATE INDEX "XeroOAuthState_organisationId_userId_expiresAt_idx" ON "XeroOAuthState"("organisationId", "userId", "expiresAt");
CREATE INDEX "XeroOAuthState_selectionExpiresAt_idx" ON "XeroOAuthState"("selectionExpiresAt");
CREATE UNIQUE INDEX "XeroContactSnapshot_connectionId_xeroContactId_key" ON "XeroContactSnapshot"("connectionId", "xeroContactId");
CREATE INDEX "XeroContactSnapshot_organisationId_name_idx" ON "XeroContactSnapshot"("organisationId", "name");
CREATE INDEX "XeroContactSnapshot_organisationId_email_idx" ON "XeroContactSnapshot"("organisationId", "email");
CREATE INDEX "XeroContactSnapshot_organisationId_isCustomer_idx" ON "XeroContactSnapshot"("organisationId", "isCustomer");
CREATE UNIQUE INDEX "XeroInvoiceSnapshot_connectionId_xeroInvoiceId_key" ON "XeroInvoiceSnapshot"("connectionId", "xeroInvoiceId");
CREATE INDEX "XeroInvoiceSnapshot_organisationId_status_dueDate_idx" ON "XeroInvoiceSnapshot"("organisationId", "status", "dueDate");
CREATE INDEX "XeroInvoiceSnapshot_organisationId_xeroContactId_idx" ON "XeroInvoiceSnapshot"("organisationId", "xeroContactId");
CREATE INDEX "XeroInvoiceSnapshot_organisationId_invoiceDate_idx" ON "XeroInvoiceSnapshot"("organisationId", "invoiceDate");
CREATE UNIQUE INDEX "XeroPaymentSnapshot_connectionId_xeroPaymentId_key" ON "XeroPaymentSnapshot"("connectionId", "xeroPaymentId");
CREATE INDEX "XeroPaymentSnapshot_organisationId_paymentDate_idx" ON "XeroPaymentSnapshot"("organisationId", "paymentDate");
CREATE INDEX "XeroPaymentSnapshot_organisationId_xeroInvoiceId_idx" ON "XeroPaymentSnapshot"("organisationId", "xeroInvoiceId");
CREATE UNIQUE INDEX "XeroClientLink_clientId_key" ON "XeroClientLink"("clientId");
CREATE UNIQUE INDEX "XeroClientLink_connectionId_xeroContactId_key" ON "XeroClientLink"("connectionId", "xeroContactId");
CREATE INDEX "XeroClientLink_organisationId_linkedAt_idx" ON "XeroClientLink"("organisationId", "linkedAt");
CREATE INDEX "XeroClientLink_linkedByUserId_idx" ON "XeroClientLink"("linkedByUserId");
CREATE UNIQUE INDEX "XeroProjectInvoiceLink_projectId_xeroInvoiceId_key" ON "XeroProjectInvoiceLink"("projectId", "xeroInvoiceId");
CREATE UNIQUE INDEX "XeroProjectInvoiceLink_connectionId_xeroInvoiceId_key" ON "XeroProjectInvoiceLink"("connectionId", "xeroInvoiceId");
CREATE INDEX "XeroProjectInvoiceLink_organisationId_projectId_idx" ON "XeroProjectInvoiceLink"("organisationId", "projectId");
CREATE INDEX "XeroProjectInvoiceLink_linkedByUserId_idx" ON "XeroProjectInvoiceLink"("linkedByUserId");
CREATE UNIQUE INDEX "XeroReportSnapshot_connectionId_reportType_periodEnd_key" ON "XeroReportSnapshot"("connectionId", "reportType", "periodEnd");
CREATE INDEX "XeroReportSnapshot_organisationId_reportType_periodEnd_idx" ON "XeroReportSnapshot"("organisationId", "reportType", "periodEnd");
CREATE UNIQUE INDEX "XeroAgedReceivableSnapshot_connectionId_xeroContactId_key" ON "XeroAgedReceivableSnapshot"("connectionId", "xeroContactId");
CREATE INDEX "XeroAgedReceivableSnapshot_organisationId_reportDate_idx" ON "XeroAgedReceivableSnapshot"("organisationId", "reportDate");
CREATE INDEX "XeroAgedReceivableSnapshot_organisationId_total_idx" ON "XeroAgedReceivableSnapshot"("organisationId", "total");

ALTER TABLE "XeroConnection" ADD CONSTRAINT "XeroConnection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroOAuthState" ADD CONSTRAINT "XeroOAuthState_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroOAuthState" ADD CONSTRAINT "XeroOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroContactSnapshot" ADD CONSTRAINT "XeroContactSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroContactSnapshot" ADD CONSTRAINT "XeroContactSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "XeroConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroInvoiceSnapshot" ADD CONSTRAINT "XeroInvoiceSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroInvoiceSnapshot" ADD CONSTRAINT "XeroInvoiceSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "XeroConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroPaymentSnapshot" ADD CONSTRAINT "XeroPaymentSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroPaymentSnapshot" ADD CONSTRAINT "XeroPaymentSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "XeroConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroPaymentSnapshot" ADD CONSTRAINT "XeroPaymentSnapshot_connectionId_xeroInvoiceId_fkey" FOREIGN KEY ("connectionId", "xeroInvoiceId") REFERENCES "XeroInvoiceSnapshot"("connectionId", "xeroInvoiceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "XeroClientLink" ADD CONSTRAINT "XeroClientLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroClientLink" ADD CONSTRAINT "XeroClientLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "XeroConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroClientLink" ADD CONSTRAINT "XeroClientLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroClientLink" ADD CONSTRAINT "XeroClientLink_connectionId_xeroContactId_fkey" FOREIGN KEY ("connectionId", "xeroContactId") REFERENCES "XeroContactSnapshot"("connectionId", "xeroContactId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroClientLink" ADD CONSTRAINT "XeroClientLink_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "XeroProjectInvoiceLink" ADD CONSTRAINT "XeroProjectInvoiceLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroProjectInvoiceLink" ADD CONSTRAINT "XeroProjectInvoiceLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "XeroConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroProjectInvoiceLink" ADD CONSTRAINT "XeroProjectInvoiceLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroProjectInvoiceLink" ADD CONSTRAINT "XeroProjectInvoiceLink_connectionId_xeroInvoiceId_fkey" FOREIGN KEY ("connectionId", "xeroInvoiceId") REFERENCES "XeroInvoiceSnapshot"("connectionId", "xeroInvoiceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroProjectInvoiceLink" ADD CONSTRAINT "XeroProjectInvoiceLink_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "XeroReportSnapshot" ADD CONSTRAINT "XeroReportSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroReportSnapshot" ADD CONSTRAINT "XeroReportSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "XeroConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroAgedReceivableSnapshot" ADD CONSTRAINT "XeroAgedReceivableSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "XeroAgedReceivableSnapshot" ADD CONSTRAINT "XeroAgedReceivableSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "XeroConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
