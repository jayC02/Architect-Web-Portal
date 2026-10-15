import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';
import { calculateUValue, ThermalCalculationError, U_VALUE_METHOD_VERSION, uValueInputSchema } from '@/lib/u-value/calculator';

export const saveUValueSchema = z.object({
  requestId: z.string().uuid(), title: z.string().trim().min(1, 'Give the calculation a name.').max(160),
  projectId: z.string().min(1).max(120).nullable().default(null),
  reference: z.string().trim().max(120).default(''), location: z.string().trim().max(400).default(''),
  inputs: uValueInputSchema,
}).strict();

export const saveUValueCalculation = async (input: {
  organisationId: string; organisationName: string; userId: string; userName: string;
  body: unknown; database?: PrismaClient;
}) => {
  const body = saveUValueSchema.parse(input.body);
  let result;
  try { result = calculateUValue(body.inputs); }
  catch (error) {
    if (error instanceof ThermalCalculationError) throw new HttpError(400, error.message);
    throw error;
  }
  if (result.missingSources.length) throw new HttpError(400, 'Add design-value references for every included material and bridge before saving a report.');
  if (!body.inputs.correctionsAssessed) throw new HttpError(400, 'Confirm that applicable corrections have been assessed before saving a report.');
  const hash = createHash('sha256').update(JSON.stringify({ methodVersion: U_VALUE_METHOD_VERSION, title: body.title,
    projectId: body.projectId, reference: body.reference, location: body.location, inputs: body.inputs })).digest('hex');
  const database = input.database ?? prisma;
  const key = `${input.organisationId}:${body.requestId}`;
  try { return await database.$transaction(async tx => {
    const previous = await tx.uValueCalculation.findUnique({ where: { idempotencyKey: key } });
    if (previous) {
      if (previous.inputHash !== hash) throw new HttpError(409, 'This save request was already used for different inputs. Save a new calculation.');
      return previous;
    }
    const project = body.projectId ? await tx.project.findFirst({
      where: { id: body.projectId, organisationId: input.organisationId },
      select: { id: true, name: true, internalReference: true, siteAddress: true },
    }) : null;
    if (body.projectId && !project) throw new HttpError(404, 'Project not found.');
    // Only the validated inputs and server-calculated result can be persisted.
    // Snapshots are immutable; later edits create a new report reference.
    const saved = await tx.uValueCalculation.create({
      data: {
        organisationId: input.organisationId, projectId: project?.id ?? null, createdById: input.userId,
        title: body.title, methodVersion: U_VALUE_METHOD_VERSION, inputHash: hash, idempotencyKey: key,
        inputSnapshot: body.inputs as Prisma.InputJsonValue, resultSnapshot: result as Prisma.InputJsonValue,
        contextSnapshot: { organisationName: input.organisationName, preparedBy: input.userName,
          projectName: project?.name ?? '', reference: body.reference || project?.internalReference || '',
          location: body.location || project?.siteAddress || '' },
      },
    });
    if (saved.inputHash !== hash) throw new HttpError(409, 'This save request was already used for different inputs. Save a new calculation.');
    return saved;
  }); } catch (error) {
    // A concurrent retry can win the unique insert. Read after the failed
    // transaction, since PostgreSQL cannot query inside an aborted transaction.
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      const previous = await database.uValueCalculation.findUnique({ where: { idempotencyKey: key } });
      if (previous && previous.inputHash === hash) return previous;
      if (previous) throw new HttpError(409, 'This save request was already used for different inputs. Save a new calculation.');
    }
    throw error;
  }
};
