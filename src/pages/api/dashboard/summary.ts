export const prerender = false;

import { ActionItemKind, ActionItemStatus, DeadlineStatus, DocumentStatus, ProjectStage, ProjectStatus } from '@prisma/client';
import type { APIRoute } from 'astro';
import { prisma } from '@/lib/db/prisma';
import { getProjectNextAction } from '@/lib/projects/next-action';
import { hasLocationPlanDocument, locationPlanPresenceWhere } from '@/lib/location-plan';
import { currentDashboardJobs, dashboardAutomationState, dashboardDayKey, dashboardDeadlineWindow, dashboardPhase, dashboardPreparationCurrent } from '@/lib/dashboard/overview';
import { automationJobApplicationId } from '@/server/services/desktop-automation-status.service';
import { currentAutomationSourceUpdatedAt } from '@/server/services/automation-jobs.service';
import { automationJobSnapshotV2Schema } from '@/lib/validation/automation-job';
import { withPerf } from '@/lib/utils/perf';
import { withErrorHandling } from '@/lib/utils/handlers';
import { jsonResponse } from '@/lib/utils/http';
import { requireOrganisation } from '@/server/permissions/authz';

const pipelineDefinitions: Array<{ key: string; label: string; stages: ProjectStage[] }> = [
  { key: 'lead', label: 'Lead', stages: [ProjectStage.LEAD] },
  { key: 'documents', label: 'Documents', stages: [ProjectStage.SURVEY, ProjectStage.DESIGN] },
  { key: 'planning', label: 'Planning', stages: [ProjectStage.PLANNING] },
  { key: 'warrant', label: 'Building Warrant', stages: [ProjectStage.BUILDING_WARRANT, ProjectStage.CONSTRUCTION] },
  { key: 'complete', label: 'Completion', stages: [ProjectStage.COMPLETION] },
];

const activeProjectWhere = (organisationId: string) => ({
  organisationId,
  status: { notIn: [ProjectStatus.COMPLETED, ProjectStatus.ARCHIVED] },
  stage: { not: ProjectStage.ARCHIVED },
});

const toTime = (value: unknown) => (value ? new Date(String(value)).getTime() : Number.MAX_SAFE_INTEGER);

export const getDashboardSummary = async (orgId: string, searchParams: URLSearchParams, now = new Date()) => {
    const range = Number(searchParams.get('deadlineRange') ?? 14);
    const deadlineRange = [7, 14, 30].includes(range) ? range : 14;
    const { firstDay, lastDay, queryEnd: deadlineEnd } = dashboardDeadlineWindow(now, deadlineRange);
    const staleDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const actionSoon = dashboardDeadlineWindow(now, 14).queryEnd;

    const [row] = await withPerf('api.dashboard.summary', () => prisma.$queryRaw<any[]>`
      SELECT
        (SELECT COUNT(*)::int FROM "Project" WHERE "organisationId" = ${orgId} AND "status" NOT IN ('COMPLETED', 'ARCHIVED') AND "stage" <> 'ARCHIVED') AS "activeProjects",
        (SELECT COUNT(*)::int FROM "Deadline" WHERE "organisationId" = ${orgId} AND "status" NOT IN ('COMPLETED', 'CANCELLED') AND "dueDate" <= ${deadlineEnd}) AS "upcomingDeadlineCount",
        (SELECT COUNT(*)::int FROM "PlanningApplication" a WHERE a."organisationId" = ${orgId} AND (a."status" IN ('DRAFTING', 'FURTHER_INFORMATION_REQUESTED', 'IN_REVIEW') OR (a."status" IN ('SUBMITTED', 'VALIDATED') AND (a."updatedAt" <= ${staleDate} OR a."decisionTargetDate" <= ${actionSoon})))) AS "planningActionCount",
        (SELECT COUNT(*)::int FROM "BuildingWarrantApplication" w WHERE w."organisationId" = ${orgId} AND (w."status" IN ('DRAFTING', 'FURTHER_INFORMATION_REQUESTED', 'IN_REVIEW') OR (w."status" = 'SUBMITTED' AND (w."firstResponseTargetDate" <= ${actionSoon} OR w."updatedAt" <= ${staleDate})) OR (w."status" = 'GRANTED' AND w."completionCertificateStatus" NOT IN ('ACCEPTED', 'NOT_REQUIRED')))) AS "warrantActionCount",
        COALESCE((SELECT jsonb_agg(to_jsonb(deadline_row)) FROM (
          SELECT d.id, d.title, d.type, d.status, d.priority, d."dueDate", CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id', p.id, 'name', p.name) END AS project
          FROM "Deadline" d LEFT JOIN "Project" p ON p.id = d."projectId"
          WHERE d."organisationId" = ${orgId} AND d.status NOT IN ('COMPLETED', 'CANCELLED') AND d."dueDate" <= ${deadlineEnd}
          ORDER BY d."dueDate" ASC, d.id ASC
        ) deadline_row), '[]'::jsonb) AS "upcomingDeadlines",
        COALESCE((SELECT jsonb_agg(to_jsonb(planning_row)) FROM (
          SELECT a.id, a."projectId", a."applicationReference", a.status, a."submissionDate", a."validDate", a."decisionTargetDate", a."updatedAt", jsonb_build_object('id', p.id, 'name', p.name) AS project
          FROM "PlanningApplication" a JOIN "Project" p ON p.id = a."projectId"
          WHERE a."organisationId" = ${orgId}
            AND (a.status IN ('DRAFTING', 'FURTHER_INFORMATION_REQUESTED', 'IN_REVIEW') OR (a.status IN ('SUBMITTED', 'VALIDATED') AND (a."updatedAt" <= ${staleDate} OR a."decisionTargetDate" <= ${actionSoon})))
            AND NOT (a.status = 'DRAFTING' AND EXISTS (
              SELECT 1 FROM "ActionItem" ai
              WHERE ai."organisationId" = ${orgId} AND ai.status = 'OPEN' AND ai.kind = 'PLANNING_FINAL_REVIEW'
                AND ai."availableAt" <= ${now}
                AND ai."dedupeKey" = ('planning:' || a.id || ':final-review')
            ))
          ORDER BY a."decisionTargetDate" ASC NULLS LAST, a."updatedAt" ASC
        ) planning_row), '[]'::jsonb) AS "planningAwaitingAction",
        COALESCE((SELECT jsonb_agg(to_jsonb(warrant_row)) FROM (
          SELECT w.id, w."projectId", w."warrantReference", w."warrantType", w.status, w."submissionDate", w."firstResponseTargetDate", w."grantedDate", w."expiryDate", w."updatedAt", jsonb_build_object('id', p.id, 'name', p.name) AS project
          FROM "BuildingWarrantApplication" w JOIN "Project" p ON p.id = w."projectId"
          WHERE w."organisationId" = ${orgId}
            AND (w.status IN ('DRAFTING', 'FURTHER_INFORMATION_REQUESTED', 'IN_REVIEW') OR (w.status = 'SUBMITTED' AND (w."firstResponseTargetDate" <= ${actionSoon} OR w."updatedAt" <= ${staleDate})) OR (w.status = 'GRANTED' AND w."completionCertificateStatus" NOT IN ('ACCEPTED', 'NOT_REQUIRED')))
            AND NOT (w.status = 'DRAFTING' AND EXISTS (
              SELECT 1 FROM "ActionItem" ai
              WHERE ai."organisationId" = ${orgId} AND ai.status = 'OPEN' AND ai.kind = 'BUILDING_WARRANT_FINAL_REVIEW'
                AND ai."availableAt" <= ${now}
                AND ai."dedupeKey" = ('warrant:' || w.id || ':final-review')
            ))
          ORDER BY w."firstResponseTargetDate" ASC NULLS LAST, w."updatedAt" ASC
        ) warrant_row), '[]'::jsonb) AS "warrantsAwaitingAction"
    `);

    const [documentsNeedingReview, automationJobs, preparedReviewActions, pipelineProjects, documentStatusCounts, activeProjects, documentReviewProjects] = await Promise.all([
      prisma.projectDocument.count({ where: { organisationId: orgId, status: DocumentStatus.IN_REVIEW } }),
      prisma.automationJob.findMany({ where: { organisationId: orgId, project: activeProjectWhere(orgId) }, select: {
        id: true, projectId: true, type: true, status: true, dataSnapshot: true, createdAt: true,
        preparedAt: true, executionAuthorisedAt: true, agentHeartbeatAt: true, leaseExpiresAt: true, sourceUpdatedAt: true,
        project: { select: { name: true, planningApplications: { select: { id: true } }, warrantApplications: { select: { id: true } } } },
      } }),
      prisma.actionItem.findMany({
        where: {
          organisationId: orgId,
          status: ActionItemStatus.OPEN,
          availableAt: { lte: now },
          kind: { in: [ActionItemKind.PLANNING_FINAL_REVIEW, ActionItemKind.BUILDING_WARRANT_FINAL_REVIEW] },
        },
        orderBy: [{ priority: 'desc' }, { availableAt: 'asc' }],
        select: {
          id: true,
          kind: true,
          title: true,
          summary: true,
          actionUrl: true,
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.project.findMany({ where: { organisationId: orgId, status: { not: ProjectStatus.ARCHIVED }, stage: { not: ProjectStage.ARCHIVED } }, select: { stage: true, status: true } }),
      prisma.projectDocument.groupBy({ by: ['status'], where: { organisationId: orgId }, _count: { _all: true } }),
      prisma.project.findMany({
        where: { organisationId: orgId, status: { not: ProjectStatus.ARCHIVED }, stage: { not: ProjectStage.ARCHIVED } },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          internalReference: true,
          stage: true,
          status: true,
          siteAddress: true,
          client: { select: { name: true } },
          site: { select: { addressLine1: true, postcode: true } },
          documents: { where: { OR: [{ status: DocumentStatus.IN_REVIEW }, locationPlanPresenceWhere] }, select: { status: true, type: true } },
          deadlines: { where: { status: { notIn: [DeadlineStatus.COMPLETED, DeadlineStatus.CANCELLED] } }, orderBy: { dueDate: 'asc' }, take: 1, select: { title: true, dueDate: true } },
          planningApplications: { orderBy: { updatedAt: 'desc' }, take: 1, select: { status: true } },
          warrantApplications: { orderBy: { updatedAt: 'desc' }, take: 1, select: { status: true } },
          _count: { select: { documents: true } },
        },
      }),
      prisma.project.findMany({
        where: { organisationId: orgId, documents: { some: { status: DocumentStatus.IN_REVIEW } } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, _count: { select: { documents: { where: { status: DocumentStatus.IN_REVIEW } } } } },
      }),
    ]);

    const latestJobs = currentDashboardJobs(automationJobs.map(job => {
      const applicationId = automationJobApplicationId(job);
      const applications = job.type === 'BUILDING_WARRANT' ? job.project.warrantApplications : job.project.planningApplications;
      return { ...job, applicationId: applications.some(application => application.id === applicationId) ? applicationId : null };
    }));
    const currentJobs = await Promise.all(latestJobs.map(async job => {
      let dashboardState = dashboardAutomationState(job, now);
      let dashboardReason: string | null = null;
      if (dashboardState === 'ready') {
        const snapshot = automationJobSnapshotV2Schema.safeParse(job.dataSnapshot);
        const currentSource = snapshot.success ? await currentAutomationSourceUpdatedAt(orgId, job.projectId, job.dataSnapshot) : null;
        if (!dashboardPreparationCurrent(snapshot.success ? snapshot.data.preflight.status : null, job.sourceUpdatedAt, currentSource)) {
          dashboardState = 'needsAttention';
          dashboardReason = 'Refresh preparation: application details changed or preflight needs checking';
        }
      }
      return { ...job, dashboardState, dashboardReason };
    }));
    const automationOverview = {
      ready: currentJobs.filter(job => job.dashboardState === 'ready').length,
      queued: currentJobs.filter(job => job.dashboardState === 'queued').length,
      running: currentJobs.filter(job => job.dashboardState === 'running').length,
      connectionLost: currentJobs.filter(job => job.dashboardState === 'connectionLost').length,
      needsAttention: currentJobs.filter(job => job.dashboardState === 'needsAttention').length,
    };
    const automationJobsReady = automationOverview.ready;
    const upcomingDeadlines = (row?.upcomingDeadlines ?? []).filter((deadline: { dueDate: string }) => dashboardDayKey(deadline.dueDate) <= lastDay);
    const overdueDeadlineCount = upcomingDeadlines.filter((deadline: { dueDate: string }) => dashboardDayKey(deadline.dueDate) < firstDay).length;

    const pipeline = pipelineDefinitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      count: pipelineProjects.filter(project => dashboardPhase(project.stage, project.status) === definition.key).length,
      // The directory supports a single stage. Grouped phases use dashboard filters instead.
      href: `/dashboard?projectPhase=${definition.key}`,
    }));

    const totalDocuments = documentStatusCounts.reduce((total, item) => total + item._count._all, 0);
    const documentsNeedingReviewByStatus = documentStatusCounts.find((item) => item.status === DocumentStatus.IN_REVIEW)?._count._all ?? 0;
    const documentsReviewed = documentStatusCounts.find(item => item.status === DocumentStatus.APPROVED)?._count._all ?? 0;

    const actionWorkload = {
      overdueDeadlines: overdueDeadlineCount,
      planningActions: Number(row?.planningActionCount ?? 0),
      warrantActions: Number(row?.warrantActionCount ?? 0),
      automationReady: automationJobsReady,
    };

    const missingDocumentWarnings = activeProjects
      .filter((project) => project.status !== ProjectStatus.COMPLETED && !hasLocationPlanDocument(project.documents))
      .map(({ id, name }) => ({ project: { id, name }, missing: ['Location Plan'] }));

    const projectSummaries = activeProjects.map((project) => {
      const documentReviewCount = project.documents.filter((document) => document.status === DocumentStatus.IN_REVIEW).length;
      const hasLocationPlan = hasLocationPlanDocument(project.documents);
      const readyAutomationJobCount = currentJobs.filter(job => job.projectId === project.id && job.dashboardState === 'ready').length;
      const nextDeadline = project.deadlines[0] ?? null;
      const nextAction = getProjectNextAction({
        projectId: project.id,
        stage: project.stage,
        documentCount: project._count.documents,
        documentReviewCount,
        hasLocationPlan,
        planningStatus: project.planningApplications[0]?.status,
        warrantStatus: project.warrantApplications[0]?.status,
        readyAutomationJobCount,
        nextDeadline,
      }, now);
      if (nextAction.href.startsWith('/deadlines?')) nextAction.href = `/projects/${project.id}#deadlines`;
      if (!['danger', 'warning'].includes(nextAction.tone)) {
        const review = preparedReviewActions.find(action => action.project?.id === project.id);
        const automation = currentJobs.find(job => job.projectId === project.id && ['connectionLost', 'needsAttention'].includes(job.dashboardState));
        if (review) Object.assign(nextAction, { label: review.title, href: review.actionUrl, tone: 'warning' });
        else if (automation) Object.assign(nextAction, {
          label: automation.dashboardState === 'connectionLost' ? 'Check Agent connection' : 'Refresh prepared application',
          href: `/automation-jobs?projectId=${project.id}`, tone: 'warning',
        });
      }
      if (project.status === ProjectStatus.COMPLETED) Object.assign(nextAction, { label: 'View completed project', href: `/projects/${project.id}`, tone: 'neutral' });
      return {
        id: project.id,
        name: project.name,
        internalReference: project.internalReference,
        stage: project.stage,
        status: project.status,
        siteSummary: project.site ? [project.site.addressLine1, project.site.postcode].filter(Boolean).join(', ') : project.siteAddress ?? 'No site address',
        clientName: project.client?.name ?? null,
        documentReviewCount,
        readyAutomationJobCount,
        needsAttention: documentReviewCount > 0 || readyAutomationJobCount > 0 || ['danger', 'warning'].includes(nextAction.tone)
          || Boolean(nextDeadline && dashboardDayKey(nextDeadline.dueDate) <= lastDay)
          || (row?.planningAwaitingAction ?? []).some((item: { projectId: string }) => item.projectId === project.id)
          || (row?.warrantsAwaitingAction ?? []).some((item: { projectId: string }) => item.projectId === project.id)
          || preparedReviewActions.some(action => action.project?.id === project.id)
          || currentJobs.some(job => job.projectId === project.id && ['connectionLost', 'needsAttention'].includes(job.dashboardState)),
        nextDeadline,
        nextAction,
      };
    });
    const activeProjectSummaries = projectSummaries.filter(project => project.status !== ProjectStatus.COMPLETED);

    const planningAwaitingAction = row?.planningAwaitingAction ?? [];
    const warrantsAwaitingAction = row?.warrantsAwaitingAction ?? [];

    const needsAttention = [
      ...upcomingDeadlines.map((deadline: any) => {
        const overdue = dashboardDayKey(deadline.dueDate) < firstDay;
        return {
          id: `deadline-${deadline.id}`,
          type: overdue ? 'Overdue deadline' : 'Upcoming deadline',
          projectName: deadline.project?.name ?? 'General',
          reason: `${deadline.title} - ${deadline.project?.name ? deadline.project.name : 'General'}`,
          date: deadline.dueDate,
          href: deadline.project?.id ? `/projects/${deadline.project.id}#deadlines` : '/deadlines',
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
      ...preparedReviewActions.map((action) => ({
        id: `prepared-review-${action.id}`,
        type: 'Needs your review',
        projectName: action.project?.name ?? 'Project',
        reason: action.title,
        href: action.actionUrl,
        tone: 'warning',
        priority: 1,
      })),
      ...planningAwaitingAction.map((item: any) => ({
        id: `planning-${item.id}`,
        type: 'Planning action',
        projectName: item.project?.name ?? 'Project',
        reason: `${item.applicationReference || 'Planning application'} - ${item.status}`,
        date: item.decisionTargetDate ?? item.updatedAt,
        href: `/planning/${item.id}/preparation`,
        tone: item.status === 'FURTHER_INFORMATION_REQUESTED' ? 'danger' : 'neutral',
        priority: item.status === 'FURTHER_INFORMATION_REQUESTED' ? 0 : 4,
      })),
      ...warrantsAwaitingAction.map((item: any) => ({
        id: `warrant-${item.id}`,
        type: 'Warrant action',
        projectName: item.project?.name ?? 'Project',
        reason: `${item.warrantReference || item.warrantType} - ${item.status}`,
        date: item.firstResponseTargetDate ?? item.expiryDate ?? item.updatedAt,
        href: `/building-warrant/${item.id}/preparation`,
        tone: item.status === 'FURTHER_INFORMATION_REQUESTED' ? 'danger' : 'neutral',
        priority: item.status === 'FURTHER_INFORMATION_REQUESTED' ? 0 : 4,
      })),
      ...currentJobs.filter(job => !['history', 'queued', 'running'].includes(job.dashboardState)).map(job => ({
        id: `automation-${job.id}`,
        type: job.dashboardState === 'ready' ? 'Automation ready' : job.dashboardState === 'connectionLost' ? 'Agent connection lost' : 'Automation needs attention',
        projectName: job.project.name,
        reason: `${job.type === 'BUILDING_WARRANT' ? 'Building warrant' : 'Planning'} · ${job.dashboardReason ?? (job.dashboardState === 'connectionLost' ? 'Check the application before resuming' : job.status.toLowerCase().replaceAll('_', ' '))}`,
        href: `/automation-jobs?projectId=${job.projectId}`,
        tone: job.dashboardState === 'ready' ? 'ready' : 'warning',
        priority: job.dashboardState === 'ready' ? 5 : 1,
      })),
    ].sort((a, b) => a.priority - b.priority || toTime(a.date) - toTime(b.date));

    return {
      activeProjects: Number(row?.activeProjects ?? 0),
      upcomingDeadlineCount: upcomingDeadlines.length,
      documentsNeedingReview,
      automationJobsReady,
      planningActionCount: Number(row?.planningActionCount ?? 0),
      warrantActionCount: Number(row?.warrantActionCount ?? 0),
      upcomingDeadlines,
      planningAwaitingAction,
      warrantsAwaitingAction,
      missingDocumentWarnings,
      pipeline,
      documentOverview: { total: totalDocuments, reviewed: documentsReviewed, approved: documentsReviewed, needsReview: documentsNeedingReviewByStatus,
        statuses: documentStatusCounts.map(item => ({ status: item.status, count: item._count._all })),
        projects: documentReviewProjects.map(project => ({ id: project.id, name: project.name, count: project._count.documents })),
      },
      automationOverview,
      actionWorkload,
      activeProjectSummaries,
      completedProjectSummaries: projectSummaries.filter(project => project.status === ProjectStatus.COMPLETED),
      completedProjects: pipelineProjects.filter(project => project.status === ProjectStatus.COMPLETED).length,
      needsAttention,
      deadlineRange,
      generatedAt: now.toISOString(),
    };
};

export const GET: APIRoute = (context) =>
  withErrorHandling(async () => {
    const { organisation } = await requireOrganisation(context);
    return jsonResponse(200, await getDashboardSummary(organisation.id, new URL(context.request.url).searchParams));
  }, context);
