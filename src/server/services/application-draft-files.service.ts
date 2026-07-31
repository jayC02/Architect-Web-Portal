import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  ApplicationDraftDocumentUploadStatus,
  ApplicationDraftStatus,
  Prisma,
  type ApplicationDraftDocument,
} from '@prisma/client';
import { APPLICATION_UPLOAD_LIMITS } from '@/lib/application-upload-limits';
import { prisma } from '@/lib/db/prisma';
import {
  createSignedDirectUpload,
  deleteStoredDocument,
  getStoredDocumentMetadata,
  saveUploadedDocument,
} from '@/lib/server/upload-storage';
import { HttpError } from '@/lib/utils/http';
import { getApplicationDraftForOrganisation } from '@/server/services/application-draft.service';

const MAX_DRAFT_TOTAL_BYTES = APPLICATION_UPLOAD_LIMITS.maxPackageBytes;
const MAX_APPLICATION_DRAFT_FILES = APPLICATION_UPLOAD_LIMITS.maxFiles;

const mutableStatuses = new Set<ApplicationDraftStatus>([
  ApplicationDraftStatus.UPLOADING,
  ApplicationDraftStatus.NEEDS_REVIEW,
  ApplicationDraftStatus.READY_TO_CREATE,
  ApplicationDraftStatus.FAILED,
]);

const removeFiles = async (documents: Array<Pick<ApplicationDraftDocument, 'storageKey'>>) => {
  for (const document of documents) {
    await deleteStoredDocument(document.storageKey).catch((error) => {
      console.error('Could not remove application draft file.', error);
    });
  }
};

const acceptedMimeTypes = new Set(['application/pdf']);

const extensionFor = (mimeType: string) => ({
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/plain': '.txt',
}[mimeType] ?? '');

const normaliseFilename = (filename: string) => {
  const base = path.posix.basename(filename.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .trim();
  if (!base || base === '.' || base === '..') throw new HttpError(400, 'Document filename is invalid.');
  return base.slice(0, 180);
};

const intentKeyFor = (filename: string, size: number, clientSha256?: string | null) =>
  createHash('sha256').update(`${filename}\u0000${size}\u0000${clientSha256 ?? ''}`).digest('hex');

export type ApplicationStorageUsage = {
  committedBytes: number;
  activeDraftBytes: number;
  pendingBytes: number;
  totalBytes: number;
  warning: boolean;
  blocked: boolean;
};

export const getApplicationStorageUsage = async (organisationId: string): Promise<ApplicationStorageUsage> => {
  const [committed, draftDocuments] = await Promise.all([
    prisma.projectDocument.aggregate({ where: { organisationId }, _sum: { sizeBytes: true } }),
    prisma.applicationDraftDocument.findMany({
      where: { draft: { organisationId }, committedDocumentId: null },
      select: { sizeBytes: true, uploadStatus: true },
    }),
  ]);
  const pendingBytes = draftDocuments
    .filter((document) => document.uploadStatus !== ApplicationDraftDocumentUploadStatus.READY)
    .reduce((total, document) => total + document.sizeBytes, 0);
  const activeDraftBytes = draftDocuments
    .filter((document) => document.uploadStatus === ApplicationDraftDocumentUploadStatus.READY)
    .reduce((total, document) => total + document.sizeBytes, 0);
  const committedBytes = committed._sum.sizeBytes ?? 0;
  const totalBytes = committedBytes + activeDraftBytes + pendingBytes;
  return {
    committedBytes,
    activeDraftBytes,
    pendingBytes,
    totalBytes,
    warning: totalBytes >= APPLICATION_UPLOAD_LIMITS.storageWarningBytes,
    blocked: totalBytes >= APPLICATION_UPLOAD_LIMITS.storageBlockBytes,
  };
};

export const addApplicationDraftDocuments = async (
  draftId: string,
  organisationId: string,
  files: File[],
) => {
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  if (!mutableStatuses.has(draft.status)) {
    throw new HttpError(409, 'Documents cannot be changed for this application draft.');
  }
  if (draft.expiresAt <= new Date()) throw new HttpError(410, 'This application draft has expired.');
  if (!files.length) throw new HttpError(400, 'Choose at least one document.');
  if (draft.documents.length + files.length > MAX_APPLICATION_DRAFT_FILES) {
    throw new HttpError(400, `Application packages are limited to ${MAX_APPLICATION_DRAFT_FILES} files.`);
  }

  const existingBytes = draft.documents.reduce((total, document) => total + document.sizeBytes, 0);
  const submittedBytes = files.reduce((total, file) => total + file.size, 0);
  if (existingBytes + submittedBytes > MAX_DRAFT_TOTAL_BYTES) {
    throw new HttpError(400, 'The application package is too large. Keep the combined files below 75 MB.');
  }

  await prisma.applicationDraft.update({
    where: { id: draft.id },
    data: {
      status: ApplicationDraftStatus.UPLOADING,
      preparedData: Prisma.JsonNull,
      confirmedData: Prisma.JsonNull,
      unresolvedQuestions: Prisma.JsonNull,
      analysisSummary: {
        phase: 'upload',
        completed: draft.documents.length,
        total: draft.documents.length + files.length,
        message: 'Adding project documents',
      },
    },
  });

  const created: ApplicationDraftDocument[] = [];
  try {
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const saved = await saveUploadedDocument(file, {
        folder: `organisations/${organisationId}/application-drafts/${draft.id}`,
        label: 'application document',
      });
      try {
        const document = await prisma.applicationDraftDocument.create({
          data: {
            draftId: draft.id,
            originalFilename: file.name || saved.fileName,
            fileName: saved.fileName,
            storageKey: saved.storageKey,
            mimeType: saved.mimeType,
            sizeBytes: saved.sizeBytes,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            uploadIntentKey: `legacy:${saved.storageKey}`,
            uploadStatus: ApplicationDraftDocumentUploadStatus.READY,
            finalisedAt: new Date(),
          },
        });
        created.push(document);
      } catch (error) {
        await deleteStoredDocument(saved.storageKey).catch(() => undefined);
        throw error;
      }
    }
  } catch (error) {
    await removeFiles(created);
    if (created.length) {
      await prisma.applicationDraftDocument.deleteMany({
        where: { id: { in: created.map((document) => document.id) }, draftId: draft.id },
      });
    }
    throw error;
  }

  const total = draft.documents.length + created.length;
  await prisma.applicationDraft.update({
    where: { id: draft.id },
    data: {
      status: ApplicationDraftStatus.UPLOADING,
      analysisSummary: {
        phase: 'upload',
        completed: total,
        total,
        message: `${total} document${total === 1 ? '' : 's'} ready to analyse`,
      },
    },
  });
  return created;
};

export const createApplicationDraftUploadIntent = async (
  draftId: string,
  organisationId: string,
  input: { filename: string; mimeType: string; size: number; clientSha256?: string | null },
) => {
  const originalFilename = normaliseFilename(input.filename);
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!acceptedMimeTypes.has(mimeType)) throw new HttpError(400, 'PDF files only.');
  if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new HttpError(400, 'Document size is invalid.');
  if (input.size > APPLICATION_UPLOAD_LIMITS.maxFileBytes) {
    throw new HttpError(400, 'This document is larger than the 25 MB file limit.');
  }
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  if (!mutableStatuses.has(draft.status) || draft.expiresAt <= new Date()) {
    throw new HttpError(409, 'Documents cannot be changed for this application draft.');
  }
  const uploadIntentKey = intentKeyFor(originalFilename, input.size, input.clientSha256);
  const document = await prisma.$transaction(async (tx) => {
    const current = await tx.applicationDraft.findFirst({
      where: { id: draftId, organisationId },
      include: { documents: true },
    });
    if (!current || !mutableStatuses.has(current.status) || current.expiresAt <= new Date()) {
      throw new HttpError(409, 'Documents cannot be changed for this application draft.');
    }
    const existing = current.documents.find((candidate) => candidate.uploadIntentKey === uploadIntentKey);
    if (existing) return existing;
    if (current.documents.length >= APPLICATION_UPLOAD_LIMITS.maxFiles) {
      throw new HttpError(400, 'This application package is limited to 20 files.');
    }
    const packageBytes = current.documents.reduce((total, candidate) => total + candidate.sizeBytes, 0);
    if (packageBytes + input.size > APPLICATION_UPLOAD_LIMITS.maxPackageBytes) {
      throw new HttpError(400, 'This package is larger than the 75 MB project limit.');
    }
    const [committed, activeDraftDocuments] = await Promise.all([
      tx.projectDocument.aggregate({ where: { organisationId }, _sum: { sizeBytes: true } }),
      tx.applicationDraftDocument.findMany({
        where: { draft: { organisationId }, committedDocumentId: null },
        select: { sizeBytes: true },
      }),
    ]);
    const trackedBytes = (committed._sum.sizeBytes ?? 0)
      + activeDraftDocuments.reduce((total, candidate) => total + candidate.sizeBytes, 0);
    if (trackedBytes + input.size > APPLICATION_UPLOAD_LIMITS.storageBlockBytes) {
      throw new HttpError(507, 'Document storage is full. Remove unused documents before uploading more.');
    }
    const id = randomUUID();
    const fileName = `${id}${extensionFor(mimeType)}`;
    const created = await tx.applicationDraftDocument.create({
      data: {
        id,
        draftId,
        originalFilename,
        fileName,
        storageKey: `organisations/${organisationId}/application-drafts/${draftId}/documents/${fileName}`,
        mimeType,
        sizeBytes: input.size,
        clientSha256: input.clientSha256 ?? null,
        uploadIntentKey,
        uploadStatus: ApplicationDraftDocumentUploadStatus.UPLOADING,
      },
    });
    await tx.applicationDraft.update({
      where: { id: draftId },
      data: {
        status: ApplicationDraftStatus.UPLOADING,
        preparedData: Prisma.JsonNull,
        confirmedData: Prisma.JsonNull,
        unresolvedQuestions: Prisma.JsonNull,
        analysisSummary: {
          phase: 'upload',
          completed: current.documents.filter((candidate) => candidate.uploadStatus === ApplicationDraftDocumentUploadStatus.READY).length,
          total: current.documents.length + 1,
          message: 'Uploading project documents',
        },
      },
    });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const signedUpload = document.uploadStatus === ApplicationDraftDocumentUploadStatus.READY
    ? null
    : await createSignedDirectUpload(document.storageKey);
  const usage = await getApplicationStorageUsage(organisationId);
  return { document, signedUpload, storage: { warning: usage.warning, blocked: usage.blocked } };
};

export const finaliseApplicationDraftDocument = async (
  draftId: string,
  documentId: string,
  organisationId: string,
) => {
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  const document = draft.documents.find((candidate) => candidate.id === documentId);
  if (!document) throw new HttpError(404, 'Draft document not found.');
  if (document.committedDocumentId) throw new HttpError(409, 'This document already belongs to a project.');
  if (document.uploadStatus === ApplicationDraftDocumentUploadStatus.READY) return document;
  if (!mutableStatuses.has(draft.status)) throw new HttpError(409, 'Documents cannot be changed for this application draft.');
  const metadata = await getStoredDocumentMetadata(document.storageKey);
  if (!metadata || metadata.sizeBytes <= 0 || metadata.sizeBytes !== document.sizeBytes) {
    await deleteStoredDocument(document.storageKey).catch(() => undefined);
    await prisma.applicationDraftDocument.updateMany({
      where: { id: document.id, draftId, committedDocumentId: null },
      data: { uploadStatus: ApplicationDraftDocumentUploadStatus.FAILED, analysisError: 'The uploaded document was incomplete. Upload it again.' },
    });
    throw new HttpError(400, 'The uploaded document could not be verified. Upload it again.');
  }
  const updated = await prisma.applicationDraftDocument.update({
    where: { id: document.id },
    data: { uploadStatus: ApplicationDraftDocumentUploadStatus.READY, finalisedAt: new Date(), analysisError: null },
  });
  const finalised = await prisma.applicationDraftDocument.count({
    where: { draftId, uploadStatus: ApplicationDraftDocumentUploadStatus.READY },
  });
  await prisma.applicationDraft.updateMany({
    where: { id: draftId, organisationId, status: ApplicationDraftStatus.UPLOADING },
    data: {
      analysisSummary: {
        phase: 'finalise',
        completed: finalised,
        total: draft.documents.length,
        message: finalised === draft.documents.length ? 'Documents ready to analyse' : 'Finalising documents',
      },
    },
  });
  return updated;
};

export const cancelApplicationDraft = async (
  draftId: string,
  organisationId: string,
) => {
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  if (draft.status === ApplicationDraftStatus.COMMITTED) {
    throw new HttpError(409, 'A created application cannot be cancelled from its draft.');
  }
  if (draft.status === ApplicationDraftStatus.COMMITTING) {
    throw new HttpError(409, 'This application is currently being created.');
  }

  await prisma.applicationDraft.updateMany({
    where: { id: draft.id, organisationId },
    data: { status: ApplicationDraftStatus.CANCELLED },
  });
  const temporaryDocuments = draft.documents.filter((document) => !document.committedDocumentId);
  await removeFiles(temporaryDocuments);
  if (temporaryDocuments.length) {
    await prisma.applicationDraftDocument.deleteMany({
      where: {
        draftId: draft.id,
        id: { in: temporaryDocuments.map((document) => document.id) },
        committedDocumentId: null,
      },
    });
  }
};

export const removeApplicationDraftDocument = async (
  draftId: string,
  documentId: string,
  organisationId: string,
) => {
  const draft = await getApplicationDraftForOrganisation(draftId, organisationId);
  if (!mutableStatuses.has(draft.status)) {
    throw new HttpError(409, 'Documents cannot be changed for this application draft.');
  }
  const document = draft.documents.find((candidate) => candidate.id === documentId);
  if (!document) throw new HttpError(404, 'Draft document not found.');
  if (document.committedDocumentId) throw new HttpError(409, 'This document already belongs to a project.');

  await deleteStoredDocument(document.storageKey);
  await prisma.$transaction([
    prisma.applicationDraftDocument.deleteMany({
      where: { id: document.id, draftId: draft.id, committedDocumentId: null },
    }),
    prisma.applicationDraft.update({
      where: { id: draft.id },
      data: {
        status: ApplicationDraftStatus.UPLOADING,
        preparedData: Prisma.JsonNull,
        confirmedData: Prisma.JsonNull,
        unresolvedQuestions: Prisma.JsonNull,
        analysisSummary: {
          phase: 'upload',
          completed: Math.max(0, draft.documents.length - 1),
          total: Math.max(0, draft.documents.length - 1),
          message: 'Document removed. Analyse again when ready.',
        },
      },
    }),
  ]);
};

export const cleanupExpiredApplicationDrafts = async (organisationId: string) => {
  const unfinalisedBefore = new Date(
    Date.now() - APPLICATION_UPLOAD_LIMITS.unfinalisedRetentionHours * 60 * 60 * 1000,
  );
  const expired = await prisma.applicationDraft.findMany({
    where: {
      organisationId,
      expiresAt: { lte: new Date() },
      status: {
        notIn: [
          ApplicationDraftStatus.COMMITTED,
          ApplicationDraftStatus.COMMITTING,
          ApplicationDraftStatus.EXPIRED,
        ],
      },
    },
    include: { documents: true },
    take: 20,
  });
  for (const draft of expired) {
    await prisma.applicationDraft.updateMany({
      where: { id: draft.id, organisationId },
      data: { status: ApplicationDraftStatus.EXPIRED },
    });
    const temporaryDocuments = draft.documents.filter((document) => !document.committedDocumentId);
    await removeFiles(temporaryDocuments);
    if (temporaryDocuments.length) {
      await prisma.applicationDraftDocument.deleteMany({
        where: {
          draftId: draft.id,
          id: { in: temporaryDocuments.map((document) => document.id) },
          committedDocumentId: null,
        },
      });
    }
  }
  const abandoned = await prisma.applicationDraftDocument.findMany({
    where: {
      draft: {
        organisationId,
        status: { notIn: [ApplicationDraftStatus.COMMITTED, ApplicationDraftStatus.COMMITTING] },
      },
      committedDocumentId: null,
      uploadStatus: {
        in: [
          ApplicationDraftDocumentUploadStatus.UPLOADING,
          ApplicationDraftDocumentUploadStatus.UPLOADED,
          ApplicationDraftDocumentUploadStatus.FAILED,
        ],
      },
      updatedAt: { lte: unfinalisedBefore },
    },
    take: 50,
  });
  await removeFiles(abandoned);
  if (abandoned.length) {
    await prisma.applicationDraftDocument.deleteMany({
      where: { id: { in: abandoned.map((document) => document.id) }, committedDocumentId: null },
    });
  }
};

export const applicationDraftExpiry = () => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + APPLICATION_UPLOAD_LIMITS.unfinishedDraftRetentionDays);
  return expiresAt;
};
