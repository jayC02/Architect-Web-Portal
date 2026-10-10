import { databaseTable } from '@/lib/db/table';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { APPLICATION_UPLOAD_LIMITS } from '@/lib/application-upload-limits';
import { createSignedDirectUpload, getStoredDocumentMetadata, readStoredDocumentBytes } from '@/lib/server/upload-storage';
import { documentMetadataSchema } from '@/lib/validation/domain';
import { HttpError } from '@/lib/utils/http';
import { requireProjectAccess } from '@/server/permissions/authz';
import { retryDatabaseTransaction } from './transaction-retry';

const accepted = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain']);
export async function reserveProjectUpload(organisationId: string, userId: string, projectId: string, input: {
  filename: string; mimeType: string; size: number; clientSha256: string; clientUploadId?: string; metadata?: unknown;
}) {
  await requireProjectAccess(organisationId, projectId);
  if (!accepted.has(input.mimeType) || input.size > 25 * 1024 * 1024) throw new HttpError(400, 'Choose a supported document of at most 25 MB.');
  if (!input.filename.trim() || /[\\/\u0000-\u001f]/.test(input.filename)) throw new HttpError(400, 'Filename is invalid.');
  const metadata = documentMetadataSchema.parse(input.metadata ?? { status: 'IN_REVIEW' });
  const contentIdentity = `${input.filename}\0${input.size}\0${input.clientSha256}`;
  const identity = createHash('sha256').update(contentIdentity + (input.clientUploadId ? `\0${input.clientUploadId}` : '')).digest('hex');
  const intent = await retryDatabaseTransaction(() => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM ${databaseTable('Organisation')} WHERE id = ${organisationId} FOR UPDATE`;
    const existing = await tx.projectUploadIntent.findUnique({ where: { projectId_identity: { projectId, identity } } });
    if (existing?.cancelledAt) throw new HttpError(409, 'This upload was cancelled.');
    if (existing) return existing;
    const matching = await tx.projectUploadIntent.findFirst({ where: { projectId, organisationId, originalFilename: input.filename, mimeType: input.mimeType, sizeBytes: input.size, clientSha256: input.clientSha256, cancelledAt: null }, orderBy: { createdAt: 'desc' } });
    if (matching) return matching;
    const [committed, drafts, reservations] = await Promise.all([
      tx.projectDocument.aggregate({ where: { organisationId }, _sum: { sizeBytes: true } }),
      tx.applicationDraftDocument.aggregate({ where: { draft: { organisationId }, committedDocumentId: null, cancelledAt: null }, _sum: { sizeBytes: true } }),
      tx.projectUploadIntent.aggregate({ where: { organisationId, status: 'UPLOADING', cancelledAt: null }, _sum: { sizeBytes: true } }),
    ]);
    if ((committed._sum.sizeBytes ?? 0) + (drafts._sum.sizeBytes ?? 0) + (reservations._sum.sizeBytes ?? 0) + input.size > APPLICATION_UPLOAD_LIMITS.storageBlockBytes) throw new HttpError(507, 'Document storage is full.');
    const id = randomUUID();
    return tx.projectUploadIntent.create({ data: {
      id, organisationId, projectId, userId, identity, originalFilename: input.filename, mimeType: input.mimeType,
      sizeBytes: input.size, clientSha256: input.clientSha256, metadata: metadata as Prisma.InputJsonValue,
      storageKey: `organisations/${organisationId}/projects/${projectId}/documents/${id}`,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  const upload = intent.status === 'READY' ? null : await createSignedDirectUpload(intent.storageKey, intent.sizeBytes);
  return { document: { id: intent.id, uploadStatus: intent.status }, upload: upload ? { ...upload, url: upload.uploadUrl } : null };
}

export async function finaliseProjectUpload(organisationId: string, projectId: string, id: string) {
  await requireProjectAccess(organisationId, projectId);
  const intent = await prisma.projectUploadIntent.findFirst({ where: { id, organisationId, projectId, cancelledAt: null } });
  if (!intent) throw new HttpError(404, 'Active upload not found.');
  if (intent.projectDocumentId) return prisma.projectDocument.findFirstOrThrow({ where: { id: intent.projectDocumentId, organisationId, projectId } });
  const metadata = await getStoredDocumentMetadata(intent.storageKey);
  if (!metadata) throw new HttpError(503, 'Storage verification is pending.', { retryAfterSeconds: 2 });
  if (metadata.sizeBytes !== intent.sizeBytes) throw new HttpError(400, 'Uploaded size does not match the reserved file.');
  const bytes = await readStoredDocumentBytes(intent.storageKey);
  const fileHash = createHash('sha256').update(bytes).digest('hex');
  if (fileHash !== intent.clientSha256 || (intent.mimeType === 'application/pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))) throw new HttpError(400, 'The uploaded file failed integrity verification.');
  return retryDatabaseTransaction(() => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM ${databaseTable('ProjectUploadIntent')} WHERE id = ${id} FOR UPDATE`;
    const current = await tx.projectUploadIntent.findFirst({ where: { id, organisationId, projectId, cancelledAt: null } });
    if (!current) throw new HttpError(409, 'This upload was cancelled.');
    if (current.projectDocumentId) return tx.projectDocument.findUniqueOrThrow({ where: { id: current.projectDocumentId } });
    const document = await tx.projectDocument.create({ data: {
      organisationId, projectId, uploadedById: intent.userId, originalName: intent.originalFilename, fileName: intent.id,
      storageKey: intent.storageKey, storageUrl: '', mimeType: intent.mimeType, sizeBytes: intent.sizeBytes, fileHash,
      ...documentMetadataSchema.parse(intent.metadata),
    } });
    await tx.projectUploadIntent.update({ where: { id }, data: { status: 'READY', projectDocumentId: document.id } });
    return document;
  }));
}
