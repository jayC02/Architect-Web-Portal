-- AlterTable
ALTER TABLE "XeroInvoiceSnapshot" ADD COLUMN     "amountCredited" DECIMAL(18,2),
ADD COLUMN     "netCredited" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "XeroCreditNoteSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "xeroCreditNoteId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "totalTax" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "allocations" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XeroCreditNoteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "XeroCreditNoteSnapshot_organisationId_connectionId_idx" ON "XeroCreditNoteSnapshot"("organisationId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "XeroCreditNoteSnapshot_connectionId_xeroCreditNoteId_key" ON "XeroCreditNoteSnapshot"("connectionId", "xeroCreditNoteId");

-- AddForeignKey
ALTER TABLE "XeroCreditNoteSnapshot" ADD CONSTRAINT "XeroCreditNoteSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XeroCreditNoteSnapshot" ADD CONSTRAINT "XeroCreditNoteSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "XeroConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
