export const prerender = false;

import { DocumentType } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { withPerf } from '@/lib/utils/perf';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    const orgId = organisation.id;
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const range = Number(new URL(context.request.url).searchParams.get('deadlineRange') ?? 14);
    const deadlineRange = [7, 14, 30].includes(range) ? range : 14;
    const deadlineEnd = new Date(today.getTime() + deadlineRange * 24 * 60 * 60 * 1000);
    const staleDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const actionSoon = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [row] = await withPerf('api.dashboard.summary', () => prisma.$queryRaw<any[]>`
      SELECT
        (SELECT COUNT(*)::int FROM "Project" WHERE "organisationId" = ${orgId} AND "status" NOT IN ('COMPLETED', 'ARCHIVED')) AS "activeProjects",
        (SELECT COUNT(*)::int FROM "Deadline" WHERE "organisationId" = ${orgId} AND "status" NOT IN ('COMPLETED', 'CANCELLED') AND "dueDate" <= ${deadlineEnd}) AS "upcomingDeadlineCount",
        (SELECT COUNT(*)::int FROM "PlanningApplication" WHERE "organisationId" = ${orgId} AND ("status" IN ('DRAFTING', 'FURTHER_INFORMATION_REQUESTED', 'IN_REVIEW') OR ("status" IN ('SUBMITTED', 'VALIDATED') AND ("updatedAt" <= ${staleDate} OR "decisionTargetDate" <= ${actionSoon})))) AS "planningActionCount",
        (SELECT COUNT(*)::int FROM "BuildingWarrantApplication" WHERE "organisationId" = ${orgId} AND ("status" IN ('DRAFTING', 'FURTHER_INFORMATION_REQUESTED', 'IN_REVIEW') OR ("status" = 'SUBMITTED' AND ("firstResponseTargetDate" <= ${actionSoon} OR "updatedAt" <= ${staleDate})) OR ("status" = 'GRANTED' AND "completionCertificateStatus" NOT IN ('ACCEPTED', 'NOT_REQUIRED')))) AS "warrantActionCount",
        COALESCE((SELECT jsonb_agg(to_jsonb(deadline_row)) FROM (
          SELECT d.id, d.title, d.type, d.status, d.priority, d."dueDate", CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id', p.id, 'name', p.name) END AS project
          FROM "Deadline" d LEFT JOIN "Project" p ON p.id = d."projectId"
          WHERE d."organisationId" = ${orgId} AND d.status NOT IN ('COMPLETED', 'CANCELLED') AND d."dueDate" <= ${deadlineEnd}
          ORDER BY d."dueDate" ASC LIMIT 6
        ) deadline_row), '[]'::jsonb) AS "upcomingDeadlines",
        COALESCE((SELECT jsonb_agg(to_jsonb(planning_row)) FROM (
          SELECT a.id, a."projectId", a."applicationReference", a.status, a."submissionDate", a."validDate", a."decisionTargetDate", a."updatedAt", jsonb_build_object('id', p.id, 'name', p.name) AS project
          FROM "PlanningApplication" a JOIN "Project" p ON p.id = a."projectId"
          WHERE a."organisationId" = ${orgId} AND (a.status IN ('DRAFTING', 'FURTHER_INFORMATION_REQUESTED', 'IN_REVIEW') OR (a.status IN ('SUBMITTED', 'VALIDATED') AND (a."updatedAt" <= ${staleDate} OR a."decisionTargetDate" <= ${actionSoon})))
          ORDER BY a."decisionTargetDate" ASC NULLS LAST, a."updatedAt" ASC LIMIT 6
        ) planning_row), '[]'::jsonb) AS "planningAwaitingAction",
        COALESCE((SELECT jsonb_agg(to_jsonb(warrant_row)) FROM (
          SELECT w.id, w."projectId", w."warrantReference", w."warrantType", w.status, w."submissionDate", w."firstResponseTargetDate", w."grantedDate", w."expiryDate", w."updatedAt", jsonb_build_object('id', p.id, 'name', p.name) AS project
          FROM "BuildingWarrantApplication" w JOIN "Project" p ON p.id = w."projectId"
          WHERE w."organisationId" = ${orgId} AND (w.status IN ('DRAFTING', 'FURTHER_INFORMATION_REQUESTED', 'IN_REVIEW') OR (w.status = 'SUBMITTED' AND (w."firstResponseTargetDate" <= ${actionSoon} OR w."updatedAt" <= ${staleDate})) OR (w.status = 'GRANTED' AND w."completionCertificateStatus" NOT IN ('ACCEPTED', 'NOT_REQUIRED')))
          ORDER BY w."firstResponseTargetDate" ASC NULLS LAST, w."updatedAt" ASC LIMIT 6
        ) warrant_row), '[]'::jsonb) AS "warrantsAwaitingAction",
        COALESCE((SELECT jsonb_agg(to_jsonb(file_row)) FROM (
          SELECT d.id, d."projectId", d."originalName", d.type, d."createdAt", d."sizeBytes", jsonb_build_object('id', p.id, 'name', p.name) AS project
          FROM "ProjectDocument" d JOIN "Project" p ON p.id = d."projectId"
          WHERE d."organisationId" = ${orgId}
          ORDER BY d."createdAt" DESC LIMIT 8
        ) file_row), '[]'::jsonb) AS "recentFiles",
        COALESCE((SELECT jsonb_agg(to_jsonb(project_row)) FROM (
          SELECT p.id, p.name
          FROM "Project" p
          WHERE p."organisationId" = ${orgId} AND p.status NOT IN ('COMPLETED', 'ARCHIVED') AND NOT EXISTS (
            SELECT 1 FROM "ProjectDocument" d WHERE d."projectId" = p.id AND d."organisationId" = ${orgId} AND d.type = ${DocumentType.LOCATION_PLAN}::"DocumentType"
          )
          ORDER BY p."updatedAt" DESC LIMIT 6
        ) project_row), '[]'::jsonb) AS "missingLocationPlanProjects"
    `);

    const missingDocumentWarnings = (Array.isArray(row?.missingLocationPlanProjects) ? row.missingLocationPlanProjects : [])
      .map((project: { id: string; name: string }) => ({ project, missing: ['Location Plan'] }));

    return jsonResponse(200, {
      activeProjects: Number(row?.activeProjects ?? 0),
      upcomingDeadlineCount: Number(row?.upcomingDeadlineCount ?? 0),
      planningActionCount: Number(row?.planningActionCount ?? 0),
      warrantActionCount: Number(row?.warrantActionCount ?? 0),
      upcomingDeadlines: row?.upcomingDeadlines ?? [],
      planningAwaitingAction: row?.planningAwaitingAction ?? [],
      warrantsAwaitingAction: row?.warrantsAwaitingAction ?? [],
      recentFiles: row?.recentFiles ?? [],
      missingDocumentWarnings,
    });
  }, context);