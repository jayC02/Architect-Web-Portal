export const prerender = false;

import { AutomationJobStatus, DeadlineStatus, DocumentStatus, DocumentType, ProjectStage, ProjectStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { getProjectNextAction } from '@/lib/projects/next-action';
import { withPerf } from '@/lib/utils/perf';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

const pipelineDefinitions: Array<{ key: string; label: string; stages: ProjectStage[] }> = [
  { key: 'lead', label: 'Lead', stages: [ProjectStage.LEAD] },
  { key: 'documents', label: 'Documents', stages: [ProjectStage.SURVEY, ProjectStage.DESIGN] },
  { key: 'planning', label: 'Planning', stages: [ProjectStage.PLANNING] },
  { key: 'warrant', label: 'Building Warrant', stages: [ProjectStage.BUILDING_WARRANT, ProjectStage.CONSTRUCTION] },
  { key: 'complete', label: 'Complete', stages: [ProjectStage.COMPLETION] },
];

const activeProjectWhere = (organisationId: string) => ({
  organisationId,
  status: { notIn: [ProjectStatus.COMPLETED, ProjectStatus.ARCHIVED] },
});

const toTime = (value: unknown) => (value ? new Date(String(value)).getTime() : Number.MAX_SAFE_INTEGER);

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
          ORDER BY d."dueDate" ASC LIMIT 8
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
          ORDER BY d."createdAt" DESC LIMIT 6
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

    const [documentsNeedingReview, automationJobsReady, pipelineProjects, documentStatusCounts, overdueDeadlineCount, activeProjects, documentReviewProjects, automationReadyProjects] = await Promise.all([
      prisma.projectDocument.count({ where: { organisationId: orgId, status: DocumentStatus.IN_REVIEW } }),
      prisma.automationJob.count({ where: { organisationId: orgId, status: AutomationJobStatus.READY } }),
      prisma.project.findMany({ where: { organisationId: orgId, status: { not: ProjectStatus.ARCHIVED } }, select: { stage: true, status: true } }),
      prisma.projectDocument.groupBy({ by: ['status'], where: { organisationId: orgId }, _count: { _all: true } }),
      prisma.deadline.count({ where: { organisationId: orgId, status: { notIn: [DeadlineStatus.COMPLETED, DeadlineStatus.CANCELLED] }, dueDate: { lt: today } } }),
      prisma.project.findMany({
        where: activeProjectWhere(orgId),
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        take: 6,
        select: {
          id: true,
          name: true,
          stage: true,
          status: true,
          siteAddress: true,
          client: { select: { name: true } },
          site: { select: { addressLine1: true, postcode: true } },
          documents: { where: { OR: [{ status: DocumentStatus.IN_REVIEW }, { type: DocumentType.LOCATION_PLAN }] }, select: { status: true, type: true } },
          deadlines: { where: { status: { notIn: [DeadlineStatus.COMPLETED, DeadlineStatus.CANCELLED] } }, orderBy: { dueDate: 'asc' }, take: 1, select: { title: true, dueDate: true } },
          planningApplications: { orderBy: { updatedAt: 'desc' }, take: 1, select: { status: true } },
          warrantApplications: { orderBy: { updatedAt: 'desc' }, take: 1, select: { status: true } },
          _count: { select: { documents: true, automationJobs: { where: { status: AutomationJobStatus.READY } } } },
        },
      }),
      prisma.project.findMany({
        where: { ...activeProjectWhere(orgId), documents: { some: { status: DocumentStatus.IN_REVIEW } } },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        select: { id: true, name: true, _count: { select: { documents: { where: { status: DocumentStatus.IN_REVIEW } } } } },
      }),
      prisma.project.findMany({
        where: { ...activeProjectWhere(orgId), automationJobs: { some: { status: AutomationJobStatus.READY } } },
        orderBy: { updatedAt: 'desc' },
        take: 6,
        select: { id: true, name: true, _count: { select: { automationJobs: { where: { status: AutomationJobStatus.READY } } } } },
      }),
    ]);

    const pipeline = pipelineDefinitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      count: pipelineProjects.filter((project) => (
        definition.key === 'complete'
          ? project.status === ProjectStatus.COMPLETED || definition.stages.includes(project.stage)
          : project.status !== ProjectStatus.COMPLETED && definition.stages.includes(project.stage)
      )).length,
      href: definition.stages.length === 1 ? `/projects?stage=${definition.stages[0]}` : '/projects',
    }));

    const totalDocuments = documentStatusCounts.reduce((total, item) => total + item._count._all, 0);
    const documentsNeedingReviewByStatus = documentStatusCounts.find((item) => item.status === DocumentStatus.IN_REVIEW)?._count._all ?? 0;
    const documentsReviewed = Math.max(0, totalDocuments - documentsNeedingReviewByStatus);

    const actionWorkload = {
      overdueDeadlines: overdueDeadlineCount,
      planningActions: Number(row?.planningActionCount ?? 0),
      warrantActions: Number(row?.warrantActionCount ?? 0),
      automationReady: automationJobsReady,
    };

    const missingDocumentWarnings = (Array.isArray(row?.missingLocationPlanProjects) ? row.missingLocationPlanProjects : [])
      .map((project: { id: string; name: string }) => ({ project, missing: ['Location Plan'] }));

    const activeProjectSummaries = activeProjects.map((project) => {
      const documentReviewCount = project.documents.filter((document) => document.status === DocumentStatus.IN_REVIEW).length;
      const hasLocationPlan = project.documents.some((document) => document.type === DocumentType.LOCATION_PLAN);
      const nextDeadline = project.deadlines[0] ?? null;
      const nextAction = getProjectNextAction({
        projectId: project.id,
        stage: project.stage,
        documentCount: project._count.documents,
        documentReviewCount,
        hasLocationPlan,
        planningStatus: project.planningApplications[0]?.status,
        warrantStatus: project.warrantApplications[0]?.status,
        readyAutomationJobCount: project._count.automationJobs,
        nextDeadline,
      });
      return {
        id: project.id,
        name: project.name,
        stage: project.stage,
        status: project.status,
        siteSummary: project.site ? [project.site.addressLine1, project.site.postcode].filter(Boolean).join(', ') : project.siteAddress ?? 'No site address',
        clientName: project.client?.name ?? null,
        documentReviewCount,
        readyAutomationJobCount: project._count.automationJobs,
        nextDeadline,
        nextAction,
      };
    });

    const upcomingDeadlines = row?.upcomingDeadlines ?? [];
    const planningAwaitingAction = row?.planningAwaitingAction ?? [];
    const warrantsAwaitingAction = row?.warrantsAwaitingAction ?? [];

    const needsAttention = [
      ...upcomingDeadlines.map((deadline: any) => {
        const overdue = toTime(deadline.dueDate) < today.getTime();
        return {
          id: `deadline-${deadline.id}`,
          type: overdue ? 'Overdue deadline' : 'Upcoming deadline',
          projectName: deadline.project?.name ?? 'General',
          reason: `${deadline.title} - ${deadline.project?.name ? deadline.project.name : 'General'}`,
          date: deadline.dueDate,
          href: deadline.project?.id ? `/deadlines?projectId=${deadline.project.id}` : '/deadlines',
          tone: overdue ? 'danger' : 'warning',
          priority: overdue ? 0 : 3,
        };
      }),
      ...documentReviewProjects.map((project) => ({
        id: `documents-${project.id}`,
        type: 'Documents to review',
        projectName: project.name,
        reason: `${project._count.documents} file${project._count.documents === 1 ? '' : 's'} need review`,
        href: `/projects/${project.id}/files`,
        tone: 'warning',
        priority: 1,
      })),
      ...missingDocumentWarnings.map((warning: any) => ({
        id: `missing-location-${warning.project.id}`,
        type: 'Missing location plan',
        projectName: warning.project.name,
        reason: 'Location Plan missing',
        href: `/documents/upload?projectId=${warning.project.id}`,
        tone: 'warning',
        priority: 2,
      })),
      ...planningAwaitingAction.map((item: any) => ({
        id: `planning-${item.id}`,
        type: 'Planning action',
        projectName: item.project?.name ?? 'Project',
        reason: `${item.applicationReference || 'Planning application'} - ${item.status}`,
        date: item.decisionTargetDate ?? item.updatedAt,
        href: `/projects/${item.projectId}/planning`,
        tone: item.status === 'FURTHER_INFORMATION_REQUESTED' ? 'danger' : 'neutral',
        priority: item.status === 'FURTHER_INFORMATION_REQUESTED' ? 0 : 4,
      })),
      ...warrantsAwaitingAction.map((item: any) => ({
        id: `warrant-${item.id}`,
        type: 'Warrant action',
        projectName: item.project?.name ?? 'Project',
        reason: `${item.warrantReference || item.warrantType} - ${item.status}`,
        date: item.firstResponseTargetDate ?? item.expiryDate ?? item.updatedAt,
        href: `/projects/${item.projectId}/building-warrant`,
        tone: item.status === 'FURTHER_INFORMATION_REQUESTED' ? 'danger' : 'neutral',
        priority: item.status === 'FURTHER_INFORMATION_REQUESTED' ? 0 : 4,
      })),
      ...automationReadyProjects.map((project) => ({
        id: `automation-${project.id}`,
        type: 'Automation ready',
        projectName: project.name,
        reason: `${project._count.automationJobs} job${project._count.automationJobs === 1 ? '' : 's'} ready`,
        href: `/automation-jobs?projectId=${project.id}`,
        tone: 'ready',
        priority: 5,
      })),
    ].sort((a, b) => a.priority - b.priority || toTime(a.date) - toTime(b.date)).slice(0, 10);

    return jsonResponse(200, {
      activeProjects: Number(row?.activeProjects ?? 0),
      upcomingDeadlineCount: Number(row?.upcomingDeadlineCount ?? 0),
      documentsNeedingReview,
      automationJobsReady,
      planningActionCount: Number(row?.planningActionCount ?? 0),
      warrantActionCount: Number(row?.warrantActionCount ?? 0),
      upcomingDeadlines,
      planningAwaitingAction,
      warrantsAwaitingAction,
      recentFiles: row?.recentFiles ?? [],
      missingDocumentWarnings,
      pipeline,
      documentOverview: { total: totalDocuments, reviewed: documentsReviewed, needsReview: documentsNeedingReviewByStatus },
      actionWorkload,
      activeProjectSummaries,
      needsAttention,
      deadlineRange,
    });
  }, context);