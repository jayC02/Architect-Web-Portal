import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';

export const reviewSchema = z.object({
  requestId: z.string().uuid(), action: z.enum(['review', 'issue', 'withdraw']),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  statement: z.string().trim().min(10, 'Record a review, issue purpose or withdrawal reason (at least 10 characters).').max(2000),
  checks: z.object({ geometry: z.literal(true), designValues: z.literal(true), corrections: z.literal(true), scope: z.literal(true) }).strict().optional(),
}).strict();
export async function reviewUValueCalculation(input: { organisationId: string; userId: string; userName: string; calculationId: string; body: unknown; database?: PrismaClient }) {
  const body = reviewSchema.parse(input.body);
  if (body.action === 'review' && !body.checks) throw new HttpError(400, 'Complete all four review checks.');
  const db = input.database || prisma;
  const requestKey = `${input.organisationId}:${body.requestId}`;
  const requestHash = createHash('sha256').update(JSON.stringify({ calculationId: input.calculationId, actorId: input.userId, ...body })).digest('hex');
  return db.$transaction(async tx => {
    const calculation = await tx.uValueCalculation.findFirst({ where: { id: input.calculationId, organisationId: input.organisationId } });
    if (!calculation) throw new HttpError(404, 'Calculation not found.');
    const seriesId = calculation.seriesId || calculation.id;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.organisationId + ':' + seriesId}, 0))::text`;
    const existing = await tx.uValueReviewEvent.findUnique({ where: { requestKey } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new HttpError(409, 'This request has already been used for another review action.');
      return existing;
    }
    const current = await tx.uValueCalculation.findFirst({ where: { id: calculation.id, organisationId: input.organisationId } });
    if (!current || current.inputHash !== body.inputHash) throw new HttpError(409, 'The report fingerprint has changed. Reload before reviewing.');
    if (body.action !== 'withdraw') {
      const latest = await tx.uValueCalculation.findFirst({ where: { organisationId: input.organisationId, OR: [{ seriesId }, { id: seriesId }] }, orderBy: { revision: 'desc' } });
      if (latest?.id !== calculation.id) throw new HttpError(409, 'This report has a newer revision. Review and issue the latest revision.');
    }
    const from = { review: 'DRAFT', issue: 'REVIEWED', withdraw: 'ISSUED' }[body.action];
    const status = { review: 'REVIEWED', issue: 'ISSUED', withdraw: 'WITHDRAWN' }[body.action];
    if (current.status !== from) throw new HttpError(409, `This action is unavailable while the report is ${current.status.toLowerCase()}. Reload the report.`);
    const event = await tx.uValueReviewEvent.create({ data: { calculationId: calculation.id, organisationId: input.organisationId,
      actorId: input.userId, actorName: input.userName, action: body.action, statement: body.statement,
      inputHash: body.inputHash, requestKey, requestHash } });
    await tx.uValueCalculation.update({ where: { id: calculation.id }, data: { status } });
    return event;
  });
}
