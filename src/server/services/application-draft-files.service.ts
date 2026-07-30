import { createHash } from 'node:crypto';
import {
  ApplicationDraftStatus,
  Prisma,
  type ApplicationDraftDocument,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  deleteStoredDocument,
  saveUploadedDocument,
} from '@/lib/server/upload-storage';
import { HttpError } from '@/lib/utils/http';
import {
  APPLICATION_DRAFT_RETENTION_DAYS,
  MAX_APPLICATION_DRAFT_FILES,
  getApplicationDraftForOrganisation,
} from '@/server/services/application-draft.service';

const MAX_DRAFT_TOTAL_BYTES = 250 * 1024 * 1024;

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
    throw new HttpError(400, 'The application package is too large. Keep the combined files below 250 MB.');
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
};

export const applicationDraftExpiry = () => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + APPLICATION_DRAFT_RETENTION_DAYS);
  return expiresAt;
};
