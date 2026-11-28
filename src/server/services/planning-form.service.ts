// Which ePlanning form a planning application uses, and changing it (docs/superpowers/specs/2026-11-28-applications-section-design.md).
import { AutomationJobStatus, AutomationJobType, Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { readProjectScreener } from '@/lib/projects/screener';
import { HttpError } from '@/lib/utils/http';
import {
  effectivePlanningForm,
  PLANNING_FORMS,
  readPlanningForm,
  suggestPlanningForm,
  type EffectivePlanningForm,
  type PlanningFormFact,
  type PlanningFormKey,
  type PlanningFormSuggestion,
  type StoredPlanningForm,
} from '@/lib/planning-form';
import { resetAutomationJobInTransaction } from '@/server/services/automation-job-reset.service';
import { desktopAutomationJobSelect, selectCurrentAutomationJob } from '@/server/services/desktop-automation-status.service';
import { classificationDetailsFromAudit } from '@/server/services/pdf-classification.service';

type Database = PrismaClient | Prisma.TransactionClient;
const PLANNING_JOB_TYPES = [AutomationJobType.HOUSEHOLDER_PLANNING, AutomationJobType.PLANNING_APPLICATION];
const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The facts the drawings showed, read from each document's stored analysis. */
export const documentFactsForPlanningForm = (documents: { analysisResult: unknown }[]): PlanningFormFact[] =>
  documents.flatMap((document) => {
    const facts: unknown = classificationDetailsFromAudit(document.analysisResult)?.extractedFacts;
    if (!Array.isArray(facts)) return [];
    return facts.flatMap((fact): PlanningFormFact[] => {
      const { fieldKey, value } = (fact ?? {}) as { fieldKey?: unknown; value?: unknown };
      return typeof fieldKey === 'string' && ['string', 'number', 'boolean'].includes(typeof value)
        ? [{ fieldKey, value: value as PlanningFormFact['value'] }] : [];
    });
  });

export const planningFormSuggestionFor = (
  project: { buildingUse?: unknown; typeOfWorkKeys?: unknown; projectType?: unknown },
  documents: { analysisResult: unknown }[],
): PlanningFormSuggestion | null => {
  const screener = readProjectScreener(project);
  return suggestPlanningForm({
    buildingUse: screener.buildingUse,
    typeOfWorkKeys: screener.typeOfWorkKeys,
    facts: documentFactsForPlanningForm(documents),
  });
};

export type ResolvedPlanningForm = EffectivePlanningForm & {
  suggestion: PlanningFormSuggestion | null;
  stored: StoredPlanningForm | null;
  jobType: AutomationJobType;
  currentJob: { id: string; type: AutomationJobType; status: AutomationJobStatus } | null;
};

export const resolvePlanningForm = async (
  db: Database,
  organisationId: string,
  planningApplicationId: string,
): Promise<ResolvedPlanningForm> => {
  const application = await db.planningApplication.findFirst({
    where: { id: planningApplicationId, organisationId },
    select: { id: true, projectId: true, preparationData: true },
  });
  if (!application) throw new HttpError(404, 'Planning application not found.');
  const [project, documents, jobs] = await Promise.all([
    db.project.findFirst({
      where: { id: application.projectId, organisationId },
      select: { buildingUse: true, typeOfWorkKeys: true, projectType: true },
    }),
    db.projectDocument.findMany({
      where: { organisationId, projectId: application.projectId },
      select: { analysisResult: true },
    }),
    db.automationJob.findMany({
      where: { organisationId, projectId: application.projectId, type: { in: PLANNING_JOB_TYPES } },
      select: desktopAutomationJobSelect,
    }),
  ]);
  const suggestion = planningFormSuggestionFor(project ?? {}, documents);
  const stored = readPlanningForm(application.preparationData);
  const currentJob = selectCurrentAutomationJob(jobs, {
    projectId: application.projectId, types: PLANNING_JOB_TYPES, applicationId: application.id,
  });
  const effective = effectivePlanningForm({ stored, latestJobType: currentJob?.type, suggestion });
  return {
    ...effective,
    suggestion,
    stored,
    jobType: PLANNING_FORMS[effective.form].jobType as AutomationJobType,
    currentJob: currentJob ? { id: currentJob.id, type: currentJob.type, status: currentJob.status } : null,
  };
};

/** Records the suggested form the first time a run is prepared, so later runs keep it. */
export const rememberSuggestedPlanningForm = async (
  db: Database,
  organisationId: string,
  planningApplicationId: string,
  resolved: ResolvedPlanningForm,
) => {
  if (resolved.stored || resolved.chosenBy !== 'SUGGESTED') return;
  const application = await db.planningApplication.findFirst({
    where: { id: planningApplicationId, organisationId }, select: { preparationData: true },
  });
  if (!application) return;
  const planningForm: StoredPlanningForm = {
    form: resolved.form, chosenBy: 'SUGGESTED', reason: resolved.reason,
    suggestedForm: resolved.suggestion?.form ?? null, chosenAt: new Date().toISOString(),
  };
  await db.planningApplication.updateMany({
    where: { id: planningApplicationId, organisationId },
    data: { preparationData: { ...objectValue(application.preparationData), planningForm } as Prisma.InputJsonObject },
  });
};

type ChooseInput = {
  organisation: { id: string; name: string };
  actor: { id: string; name: string | null; email: string };
  planningApplicationId: string;
  form: PlanningFormKey;
  expectedJobId: string | null;
  requestId: string;
};

export const choosePlanningFormInTransaction = async (tx: Prisma.TransactionClient, input: ChooseInput) => {
  const application = await tx.planningApplication.findFirst({
    where: { id: input.planningApplicationId, organisationId: input.organisation.id },
    select: { id: true, status: true, submissionDate: true, preparationData: true },
  });
  if (!application) throw new HttpError(404, 'Planning application not found.');
  if (!['NOT_STARTED', 'DRAFTING'].includes(application.status) || application.submissionDate) {
    throw new HttpError(409, 'This application has been submitted, so its form can no longer be changed.');
  }
  const resolved = await resolvePlanningForm(tx, input.organisation.id, application.id);
  if ((resolved.currentJob?.id ?? null) !== input.expectedJobId) {
    throw new HttpError(409, 'This application has a newer run. Refresh the project before changing its form.');
  }
  if (resolved.form === input.form) return { changed: false, jobId: resolved.currentJob?.id ?? null };

  const planningForm: StoredPlanningForm = {
    form: input.form, chosenBy: 'USER', reason: null,
    suggestedForm: resolved.suggestion?.form ?? null, chosenAt: new Date().toISOString(),
  };
  await tx.planningApplication.update({
    where: { id: application.id },
    data: { preparationData: { ...objectValue(application.preparationData), planningForm } as Prisma.InputJsonObject },
  });
  const current = resolved.currentJob;
  if (!current || current.status === AutomationJobStatus.CANCELLED) return { changed: true, jobId: null };
  // The run was prepared for the other form: replace it with a fresh run of the new one.
  const job = await resetAutomationJobInTransaction(tx, {
    organisation: input.organisation,
    actor: input.actor,
    applicationId: application.id,
    type: PLANNING_FORMS[input.form].jobType,
    expectedJobId: current.id,
    requestId: input.requestId,
  });
  return { changed: true, jobId: job.id };
};

export const choosePlanningForm = async (input: ChooseInput) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction((tx) => choosePlanningFormInTransaction(tx, input), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000,
      });
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
    }
  }
};

