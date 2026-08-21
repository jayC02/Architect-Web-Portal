import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ActionItemStatus,
  AutomationJobStatus,
  AutomationJobType,
  DeadlineManagedBy,
  DeadlineStatus,
  LifecycleEventType,
  PlanningStatus,
  ProjectStage,
  ProjectStatus,
  WarrantStatus,
  WorkflowTargetKey,
  type PrismaClient,
} from '@prisma/client';
import {
  DOCUMENT_REVIEW_COMPLETED_HANDLER_KEYS,
  PLANNING_APPROVED_HANDLER_KEYS,
  PLANNING_INFORMATION_REQUESTED_HANDLER_KEYS,
  PLANNING_READY_HANDLER_KEYS,
  PLANNING_REFUSED_HANDLER_KEYS,
  PROJECT_CREATED_HANDLER_KEYS,
  emitDocumentReviewCompletedLifecycleEvent,
} from '../src/server/services/lifecycle-events.service';
import {
  PHASE_2_EFFECT_HANDLERS,
  workflowActionKeys,
  workflowSourceKeys,
} from '../src/server/services/phase2-workflow-handlers.service';
import {
  applyManualWorkflowDeadlineOverride,
  ensureWorkflowDeadline,
  resetWorkflowDeadlineToCalculated,
} from '../src/server/services/workflow-deadlines.service';
import {
  WORKFLOW_TARGET_DEFINITIONS,
  calculateWorkflowTargetDate,
  getWorkflowTarget,
  getWorkflowTargets,
  saveWorkflowTargets,
} from '../src/server/services/workflow-targets.service';
import { recordAutomationReadinessTransition } from '../src/server/services/application-lifecycle.service';

const occurredAt = new Date('2026-08-17T09:00:00.000Z');
let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${++sequence}`;

const store = {
  projects: [
    { id: 'project_a', organisationId: 'org_a', name: 'Project A', stage: ProjectStage.PLANNING, status: ProjectStatus.ACTIVE },
    { id: 'project_b', organisationId: 'org_b', name: 'Project B', stage: ProjectStage.PLANNING, status: ProjectStatus.ACTIVE },
  ] as any[],
  planning: [
    { id: 'planning_a', organisationId: 'org_a', projectId: 'project_a', status: PlanningStatus.DRAFTING },
  ] as any[],
  warrants: [
    { id: 'warrant_a', organisationId: 'org_a', projectId: 'project_a', status: WarrantStatus.DRAFTING, createdAt: occurredAt },
  ] as any[],
  targets: [] as any[],
  actions: [] as any[],
  deadlines: [] as any[],
  activities: [] as any[],
  events: [] as any[],
  effects: [] as any[],
  jobs: [] as any[],
};

const projectMatches = (value: any, where: any) => value.id === where.id
  && value.organisationId === where.organisationId;
const applicationMatches = (value: any, where: any) => value.id === where.id
  && value.organisationId === where.organisationId
  && value.projectId === where.projectId;
const selectFields = (value: any, select?: Record<string, boolean>) => !value || !select
  ? value
  : Object.fromEntries(Object.keys(select).map((key) => [key, value[key]]));

const database: any = {
  project: {
    findFirst: async ({ where, select }: any) => selectFields(
      store.projects.find((value) => projectMatches(value, where)) ?? null,
      select,
    ),
    updateMany: async ({ where, data }: any) => {
      const matches = store.projects.filter((value) => value.id === where.id
        && value.organisationId === where.organisationId
        && (!where.status || value.status === where.status)
        && (!where.stage?.in || where.stage.in.includes(value.stage)));
      matches.forEach((value) => Object.assign(value, data));
      return { count: matches.length };
    },
  },
  planningApplication: {
    findFirst: async ({ where, select }: any) => selectFields(
      store.planning.find((value) => applicationMatches(value, where)) ?? null,
      select,
    ),
  },
  buildingWarrantApplication: {
    findFirst: async ({ where, select }: any) => {
      const matches = store.warrants.filter((value) => value.organisationId === where.organisationId
        && value.projectId === where.projectId
        && (!where.id || value.id === where.id));
      const value = matches.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
      return selectFields(value, select);
    },
  },
  workflowTarget: {
    findUnique: async ({ where, select }: any) => {
      const key = where.organisationId_key;
      return selectFields(store.targets.find((value) => value.organisationId === key.organisationId && value.key === key.key) ?? null, select);
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.organisationId_key;
      const existing = store.targets.find((value) => value.organisationId === key.organisationId && value.key === key.key);
      if (existing) { Object.assign(existing, update); return existing; }
      const target = { id: nextId('target'), createdAt: occurredAt, updatedAt: occurredAt, ...create };
      store.targets.push(target);
      return target;
    },
  },
  actionItem: {
    findUnique: async ({ where, select }: any) => {
      const key = where.organisationId_dedupeKey;
      return selectFields(store.actions.find((value) => value.organisationId === key.organisationId && value.dedupeKey === key.dedupeKey) ?? null, select);
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.organisationId_dedupeKey;
      const existing = store.actions.find((value) => value.organisationId === key.organisationId && value.dedupeKey === key.dedupeKey);
      if (existing) { Object.assign(existing, update); return existing; }
      const action = { id: nextId('action'), createdAt: occurredAt, updatedAt: occurredAt, resolvedAt: null, ...create };
      store.actions.push(action);
      return action;
    },
    updateMany: async ({ where, data }: any) => {
      const matches = store.actions.filter((value) => value.organisationId === where.organisationId
        && (!where.projectId || value.projectId === where.projectId)
        && (!where.dedupeKey || value.dedupeKey === where.dedupeKey)
        && (!where.status || value.status === where.status)
        && (!where.kind?.in || where.kind.in.includes(value.kind)));
      matches.forEach((value) => Object.assign(value, data));
      return { count: matches.length };
    },
  },
  automationJob: {
    findMany: async () => store.jobs,
  },
  deadline: {
    findUnique: async ({ where, select }: any) => {
      const key = where.organisationId_sourceKey;
      return selectFields(store.deadlines.find((value) => value.organisationId === key.organisationId && value.sourceKey === key.sourceKey) ?? null, select);
    },
    findFirst: async ({ where }: any) => store.deadlines.find((value) => value.id === where.id
      && value.organisationId === where.organisationId
      && (!where.managedBy || value.managedBy === where.managedBy)
      && (!where.calculatedDueDate?.not || value.calculatedDueDate !== null)) ?? null,
    upsert: async ({ where, create, update }: any) => {
      const key = where.organisationId_sourceKey;
      const existing = store.deadlines.find((value) => value.organisationId === key.organisationId && value.sourceKey === key.sourceKey);
      if (existing) { Object.assign(existing, update); return existing; }
      const deadline = {
        id: nextId('deadline'), createdAt: occurredAt, updatedAt: occurredAt,
        completedDate: null, manualOverrideAt: null, manualOverrideById: null, ...create,
      };
      store.deadlines.push(deadline);
      return deadline;
    },
    update: async ({ where, data }: any) => {
      const existing = store.deadlines.find((value) => value.id === where.id);
      if (!existing) throw new Error('Deadline not found');
      Object.assign(existing, data);
      return existing;
    },
  },
  projectActivity: {
    upsert: async ({ where, create }: any) => {
      const key = where.organisationId_idempotencyKey;
      const existing = store.activities.find((value) => value.organisationId === key.organisationId && value.idempotencyKey === key.idempotencyKey);
      if (existing) return existing;
      const activity = { id: nextId('activity'), createdAt: occurredAt, ...create };
      store.activities.push(activity);
      return activity;
    },
  },
  lifecycleEvent: {
    upsert: async ({ where, create }: any) => {
      const key = where.organisationId_idempotencyKey;
      const existing = store.events.find((value) => value.organisationId === key.organisationId && value.idempotencyKey === key.idempotencyKey);
      if (existing) return existing;
      const event = { id: nextId('event'), createdAt: occurredAt, dispatchedAt: null, ...create };
      store.events.push(event);
      return event;
    },
    update: async ({ where, data }: any) => {
      const event = store.events.find((value) => value.id === where.id);
      Object.assign(event, data);
      return event;
    },
  },
  workflowEffect: {
    createMany: async ({ data }: any) => {
      for (const input of data) {
        if (!store.effects.some((value) => value.lifecycleEventId === input.lifecycleEventId && value.handlerKey === input.handlerKey)) {
          store.effects.push({ id: nextId('effect'), ...input });
        }
      }
      return { count: data.length };
    },
  },
};

const calendarSyncs: string[] = [];
const calendarSync = async (organisationId: string, deadlineId: string) => {
  calendarSyncs.push(`${organisationId}:${deadlineId}`);
  return { attempted: true, synced: true };
};
const calendarMilestones = new Map<string, { kind: string; aggregateId: string }>();
const calendarMilestoneSync = async (organisationId: string, kind: string, aggregateId: string) => {
  const scope = kind === 'PLANNING_DECISION' ? 'planning' : 'warrant';
  calendarMilestones.set(`${organisationId}:${scope}:${aggregateId}:decision`, { kind, aggregateId });
  return { attempted: true, synced: true };
};

const makeEffect = (id: string, eventType: LifecycleEventType, payload: Record<string, unknown>) => ({
  id: `effect_${id}`,
  organisationId: 'org_a',
  lifecycleEventId: id,
  handlerKey: '',
  lifecycleEvent: {
    id,
    organisationId: 'org_a',
    projectId: 'project_a',
    eventType,
    payload,
    actorType: 'USER',
    actorUserId: 'owner_a',
    occurredAt,
  },
});

const runHandlers = async (keys: readonly string[], effect: any, sync = calendarSync) => {
  for (const key of keys) {
    if (key === 'finance.fee-milestone.evaluate') continue;
    const handler = PHASE_2_EFFECT_HANDLERS[key as keyof typeof PHASE_2_EFFECT_HANDLERS];
    assert.ok(handler, `handler registered for ${key}`);
    await handler(effect, {
      database: database as PrismaClient,
      calendarSync: sync,
      calendarMilestoneSync: calendarMilestoneSync as never,
    });
  }
};

// Central defaults, organisation overrides, disabling, and tenant isolation.
const defaults = await getWorkflowTargets(database, 'org_a');
assert.deepEqual(defaults.map(({ key, enabled, offsetDays }) => ({ key, enabled, offsetDays })), [
  { key: WorkflowTargetKey.PROJECT_DOCUMENT_REVIEW, enabled: true, offsetDays: 0 },
  { key: WorkflowTargetKey.PLANNING_PREPARATION, enabled: true, offsetDays: 0 },
  { key: WorkflowTargetKey.PLANNING_FINAL_REVIEW, enabled: true, offsetDays: 0 },
  { key: WorkflowTargetKey.BUILDING_WARRANT_ACTION, enabled: true, offsetDays: 0 },
  { key: WorkflowTargetKey.BUILDING_WARRANT_FINAL_REVIEW, enabled: true, offsetDays: 0 },
]);
for (const definition of WORKFLOW_TARGET_DEFINITIONS) {
  assert.equal(
    calculateWorkflowTargetDate(occurredAt, definition.defaultOffsetDays).toISOString(),
    occurredAt.toISOString(),
    `${definition.key} is immediately actionable by default`,
  );
}
await saveWorkflowTargets(database, 'org_a', WORKFLOW_TARGET_DEFINITIONS.map((definition) => ({
  key: definition.key,
  enabled: definition.key !== WorkflowTargetKey.PROJECT_DOCUMENT_REVIEW,
  offsetDays: definition.key === WorkflowTargetKey.PLANNING_PREPARATION ? 9 : definition.defaultOffsetDays,
})));
assert.deepEqual(await getWorkflowTarget(database, 'org_a', WorkflowTargetKey.PLANNING_PREPARATION), {
  key: WorkflowTargetKey.PLANNING_PREPARATION, enabled: true, offsetDays: 9,
});
assert.equal((await getWorkflowTarget(database, 'org_b', WorkflowTargetKey.PLANNING_PREPARATION)).offsetDays, 0);
assert.equal((await getWorkflowTarget(database, 'org_a', WorkflowTargetKey.PROJECT_DOCUMENT_REVIEW)).enabled, false);

const permissionsSource = fs.readFileSync(new URL('../src/pages/api/settings/workflow-targets.ts', import.meta.url), 'utf8');
assert.match(permissionsSource, /requireOrganisationRole/);
assert.match(permissionsSource, /OrganisationRole\.OWNER/);
assert.match(permissionsSource, /OrganisationRole\.ADMIN/);
assert.doesNotMatch(permissionsSource, /OrganisationRole\.MEMBER/);

for (const [eventName, handlerKeys] of [
  ['PROJECT_CREATED', PROJECT_CREATED_HANDLER_KEYS],
  ['DOCUMENT_REVIEW_COMPLETED', DOCUMENT_REVIEW_COMPLETED_HANDLER_KEYS],
  ['PLANNING_READY', PLANNING_READY_HANDLER_KEYS],
  ['PLANNING_INFORMATION_REQUESTED', PLANNING_INFORMATION_REQUESTED_HANDLER_KEYS],
] as const) {
  assert.equal(
    handlerKeys.some((key) => key.includes('.calendar.')),
    false,
    `${eventName} has no generic Calendar milestone projection`,
  );
}

// The reviewed-draft boundary emits one event and one controlled effect set.
const reviewInput = {
  organisationId: 'org_a', projectId: 'project_a', applicationDraftId: 'draft_a',
  planningApplicationId: 'planning_a', buildingWarrantApplicationId: 'warrant_a', actorUserId: 'owner_a', occurredAt,
};
const reviewEvent = await emitDocumentReviewCompletedLifecycleEvent(database, reviewInput);
await emitDocumentReviewCompletedLifecycleEvent(database, reviewInput);
assert.equal(store.events.filter((value) => value.eventType === LifecycleEventType.DOCUMENT_REVIEW_COMPLETED).length, 1);
assert.equal(store.effects.filter((value) => value.lifecycleEventId === reviewEvent.id).length, DOCUMENT_REVIEW_COMPLETED_HANDLER_KEYS.length);

// The canonical Snapshot V2 status crossing emits one readiness lifecycle and a safe revocation.
const readyTransition = {
  organisationId: 'org_a', projectId: 'project_a', jobType: AutomationJobType.PLANNING_APPLICATION,
  previousStatus: AutomationJobStatus.NEEDS_INPUT, nextStatus: AutomationJobStatus.READY,
  readinessKey: 'snapshot-ready-a', planningApplicationId: 'planning_a', actorUserId: 'owner_a',
};
await recordAutomationReadinessTransition(database, readyTransition);
await recordAutomationReadinessTransition(database, readyTransition);
assert.equal(store.events.filter((value) => value.eventType === LifecycleEventType.PLANNING_READY).length, 1);
await recordAutomationReadinessTransition(database, {
  ...readyTransition,
  previousStatus: AutomationJobStatus.READY,
  nextStatus: AutomationJobStatus.NEEDS_INPUT,
  readinessKey: 'snapshot-incomplete-a',
});
assert.equal(store.events.filter((value) => value.eventType === LifecycleEventType.PLANNING_READINESS_REVOKED).length, 1);

const planningStatusRoute = fs.readFileSync(new URL('../src/pages/api/planning/[id].ts', import.meta.url), 'utf8');
const planningCompletionRoute = fs.readFileSync(new URL('../src/pages/api/planning/[id]/complete-details.ts', import.meta.url), 'utf8');
assert.match(planningStatusRoute, /updatePlanningApplicationWithLifecycle/);
assert.match(planningCompletionRoute, /updatePlanningApplicationWithLifecycle/);

store.actions.push({
  id: 'action_document', organisationId: 'org_a', projectId: 'project_a',
  dedupeKey: workflowActionKeys.documentReview('project_a'), status: ActionItemStatus.OPEN, resolvedAt: null,
});
store.deadlines.push({
  id: 'deadline_document', organisationId: 'org_a', projectId: 'project_a',
  sourceKey: workflowSourceKeys.documentReview('project_a'), status: DeadlineStatus.UPCOMING,
  dueDate: new Date('2026-08-20T09:00:00.000Z'), calculatedDueDate: new Date('2026-08-20T09:00:00.000Z'),
  managedBy: DeadlineManagedBy.WORKFLOW, manualOverrideAt: null, completedDate: null,
});
const reviewEffect = makeEffect(
  reviewEvent.id,
  LifecycleEventType.DOCUMENT_REVIEW_COMPLETED,
  reviewEvent.payload as Record<string, unknown>,
);
await runHandlers(DOCUMENT_REVIEW_COMPLETED_HANDLER_KEYS, reviewEffect);
await runHandlers(DOCUMENT_REVIEW_COMPLETED_HANDLER_KEYS, reviewEffect);
assert.equal(store.actions.find((value) => value.dedupeKey === workflowActionKeys.documentReview('project_a')).status, ActionItemStatus.RESOLVED);
assert.equal(store.deadlines.find((value) => value.sourceKey === workflowSourceKeys.documentReview('project_a')).status, DeadlineStatus.COMPLETED);
assert.equal(store.deadlines.filter((value) => value.sourceKey === workflowSourceKeys.planningPreparation('planning_a')).length, 1);
assert.equal(store.actions.filter((value) => value.dedupeKey === workflowActionKeys.planningPreparation('planning_a')).length, 1);

// Planning ready advances preparation to one final-review projection.
const planningReadyKeys = ['planning.action.ready', 'planning.activity.ready', 'planning.deadline.ready'] as const;
const planningReady = makeEffect('planning_ready', LifecycleEventType.PLANNING_READY, {
  projectId: 'project_a', planningApplicationId: 'planning_a',
});
await runHandlers(planningReadyKeys, planningReady);
await runHandlers(planningReadyKeys, planningReady);
assert.equal(store.deadlines.find((value) => value.sourceKey === workflowSourceKeys.planningPreparation('planning_a')).status, DeadlineStatus.COMPLETED);
assert.equal(store.deadlines.filter((value) => value.sourceKey === workflowSourceKeys.planningFinalReview('planning_a')).length, 1);
assert.equal(store.actions.filter((value) => value.dedupeKey === workflowActionKeys.planningFinalReview('planning_a')).length, 1);

// Submission resolves final review and creates no synthetic regulatory deadline.
store.planning[0].status = PlanningStatus.SUBMITTED;
const beforeSubmissionSources = new Set(store.deadlines.map((value) => value.sourceKey));
await runHandlers(
  ['planning.action.submitted', 'planning.activity.submitted', 'planning.deadline.submitted'],
  makeEffect('planning_submitted', LifecycleEventType.PLANNING_SUBMITTED, {
    projectId: 'project_a', planningApplicationId: 'planning_a',
  }),
);
assert.equal(store.deadlines.find((value) => value.sourceKey === workflowSourceKeys.planningFinalReview('planning_a')).status, DeadlineStatus.COMPLETED);
assert.deepEqual(new Set(store.deadlines.map((value) => value.sourceKey)), beforeSubmissionSources);

// An information request without a trusted response date stays in Action Items and Activity only.
store.planning[0].status = PlanningStatus.FURTHER_INFORMATION_REQUESTED;
const deadlinesBeforeUndatedRequest = store.deadlines.length;
await runHandlers(PLANNING_INFORMATION_REQUESTED_HANDLER_KEYS, makeEffect(
  'planning_information_requested',
  LifecycleEventType.PLANNING_INFORMATION_REQUESTED,
  { projectId: 'project_a', planningApplicationId: 'planning_a', trackedEmailId: 'email_information_request' },
));
assert.equal(store.deadlines.length, deadlinesBeforeUndatedRequest, 'no Calendar date is invented for an undated information request');
assert.equal(store.actions.filter((value) => value.dedupeKey === 'planning:planning_a:information-requested').length, 1);
assert.equal(calendarMilestones.size, 0);

// Approval reuses the existing Warrant and creates one continuation projection.
store.planning[0].status = PlanningStatus.APPROVED;
const approved = makeEffect('planning_approved', LifecycleEventType.PLANNING_APPROVED, {
  projectId: 'project_a', planningApplicationId: 'planning_a',
});
const approvedKeys = PLANNING_APPROVED_HANDLER_KEYS;
await runHandlers(approvedKeys, approved);
await runHandlers(approvedKeys, approved);
assert.equal(store.warrants.length, 1, 'approval never rebuilds Building Warrant data');
assert.equal(store.deadlines.filter((value) => value.sourceKey === workflowSourceKeys.warrantAction('warrant_a')).length, 1);
assert.equal(store.actions.filter((value) => value.dedupeKey === workflowActionKeys.warrantAction('warrant_a')).length, 1);
assert.equal(store.projects[0].stage, ProjectStage.BUILDING_WARRANT, 'active Planning project advances once to Building Warrant');
assert.match(store.actions.find((value) => value.dedupeKey === workflowActionKeys.warrantAction('warrant_a')).title, /needs project information/);
assert.equal(store.activities.filter((value) => value.eventType === 'BUILDING_WARRANT_ACTIVATED').length, 1);
assert.equal(calendarMilestones.size, 1, 'reprocessing Planning approval reconciles one logical calendar milestone');
assert.ok(calendarMilestones.has('org_a:planning:planning_a:decision'));

store.planning[0].status = PlanningStatus.REFUSED;
await runHandlers(PLANNING_REFUSED_HANDLER_KEYS, makeEffect('planning_refused', LifecycleEventType.PLANNING_REFUSED, {
  projectId: 'project_a', planningApplicationId: 'planning_a',
}));
assert.equal(calendarMilestones.size, 1, 'Planning refusal reconciles the existing decision milestone rather than duplicating it');
assert.equal(store.activities.filter((value) => value.eventType === 'PLANNING_REFUSED').length, 1);
assert.equal(store.actions.filter((value) => value.dedupeKey === 'planning:planning_a:decision-review').length, 1);
store.planning[0].status = PlanningStatus.APPROVED;

store.jobs = [{
  id: 'job_ready', projectId: 'project_a', type: AutomationJobType.BUILDING_WARRANT,
  status: AutomationJobStatus.READY,
  dataSnapshot: {
    project: { id: 'project_a' },
    buildingWarrantApplication: { id: 'warrant_a' },
    preflight: { missing: [] },
  },
}];
await runHandlers(['planning.action.approved'], makeEffect('planning_approved_ready', LifecycleEventType.PLANNING_APPROVED, {
  projectId: 'project_a', planningApplicationId: 'planning_a',
}));
assert.match(store.actions.find((value) => value.dedupeKey === workflowActionKeys.warrantAction('warrant_a')).title, /Building Warrant ready/);

store.jobs[0].status = AutomationJobStatus.NEEDS_INPUT;
store.jobs[0].dataSnapshot.preflight.missing = [{ key: 'one' }, { key: 'two' }];
await runHandlers(['planning.action.approved'], makeEffect('planning_approved_incomplete', LifecycleEventType.PLANNING_APPROVED, {
  projectId: 'project_a', planningApplicationId: 'planning_a',
}));
assert.match(store.actions.find((value) => value.dedupeKey === workflowActionKeys.warrantAction('warrant_a')).title, /needs 2 confirmations/);

const savedWarrant = store.warrants.splice(0, 1)[0];
await runHandlers(['planning.action.approved'], makeEffect('planning_approved_no_warrant', LifecycleEventType.PLANNING_APPROVED, {
  projectId: 'project_a', planningApplicationId: 'planning_a',
}));
assert.equal(store.actions.filter((value) => value.dedupeKey === 'planning:planning_a:confirm-warrant-required').length, 1);
store.warrants.push(savedWarrant);

store.projects[0].stage = ProjectStage.CONSTRUCTION;
await runHandlers(['planning.stage.approved'], makeEffect('planning_approved_later_stage', LifecycleEventType.PLANNING_APPROVED, {
  projectId: 'project_a', planningApplicationId: 'planning_a',
}));
assert.equal(store.projects[0].stage, ProjectStage.CONSTRUCTION, 'approval never regresses a later project stage');
store.projects[0].stage = ProjectStage.PLANNING;
store.projects[0].status = ProjectStatus.ON_HOLD;
await runHandlers(['planning.stage.approved'], makeEffect('planning_approved_on_hold', LifecycleEventType.PLANNING_APPROVED, {
  projectId: 'project_a', planningApplicationId: 'planning_a',
}));
assert.equal(store.projects[0].stage, ProjectStage.PLANNING, 'on-hold project does not auto-advance');
store.projects[0].status = ProjectStatus.ACTIVE;
store.projects[0].stage = ProjectStage.BUILDING_WARRANT;

// Warrant readiness resolves continuation and creates one final-review reminder.
const warrantReady = makeEffect('warrant_ready', LifecycleEventType.BUILDING_WARRANT_READY, {
  projectId: 'project_a', buildingWarrantApplicationId: 'warrant_a',
});
const warrantReadyKeys = ['warrant.action.ready', 'warrant.activity.ready', 'warrant.deadline.ready'] as const;
await runHandlers(warrantReadyKeys, warrantReady);
await runHandlers(warrantReadyKeys, warrantReady);
assert.equal(store.deadlines.find((value) => value.sourceKey === workflowSourceKeys.warrantAction('warrant_a')).status, DeadlineStatus.COMPLETED);
assert.equal(store.deadlines.filter((value) => value.sourceKey === workflowSourceKeys.warrantFinalReview('warrant_a')).length, 1);
assert.equal(store.actions.filter((value) => value.dedupeKey === workflowActionKeys.warrantFinalReview('warrant_a')).length, 1);

// Manual effective dates survive recalculation and can be reset explicitly.
const warrantFinal = store.deadlines.find((value) => value.sourceKey === workflowSourceKeys.warrantFinalReview('warrant_a'));
const manualDate = new Date('2026-09-01T09:00:00.000Z');
await applyManualWorkflowDeadlineOverride(database, {
  organisationId: 'org_a', deadlineId: warrantFinal.id, dueDate: manualDate, actorUserId: 'owner_a',
  updatedData: { title: warrantFinal.title },
});
await ensureWorkflowDeadline(database, {
  organisationId: 'org_a', projectId: 'project_a', buildingWarrantApplicationId: 'warrant_a',
  sourceKey: workflowSourceKeys.warrantFinalReview('warrant_a'), title: warrantFinal.title,
  description: warrantFinal.description, targetKey: WorkflowTargetKey.BUILDING_WARRANT_FINAL_REVIEW,
  occurredAt: new Date('2026-08-25T09:00:00.000Z'),
});
assert.equal(warrantFinal.dueDate.toISOString(), manualDate.toISOString());
assert.equal(warrantFinal.calculatedDueDate.toISOString(), '2026-08-25T09:00:00.000Z');
await resetWorkflowDeadlineToCalculated(database, 'org_a', warrantFinal.id);
assert.equal(warrantFinal.dueDate.toISOString(), warrantFinal.calculatedDueDate.toISOString());
assert.equal(warrantFinal.manualOverrideAt, null);

store.warrants[0].status = WarrantStatus.GRANTED;
await runHandlers(
  ['warrant.action.granted', 'warrant.activity.granted', 'warrant.calendar.decision'],
  makeEffect('warrant_granted', LifecycleEventType.BUILDING_WARRANT_GRANTED, {
    projectId: 'project_a', buildingWarrantApplicationId: 'warrant_a',
  }),
);
assert.ok(calendarMilestones.has('org_a:warrant:warrant_a:decision'), 'Building Warrant grant creates one managed milestone');
assert.equal(store.activities.filter((value) => value.eventType === 'BUILDING_WARRANT_GRANTED').length, 1);

// Disconnected Calendar is a no-op; an attempted failure remains retryable.
const disconnected = makeEffect('warrant_disconnected', LifecycleEventType.BUILDING_WARRANT_READY, {
  projectId: 'project_a', buildingWarrantApplicationId: 'warrant_a',
});
await assert.doesNotReject(() => runHandlers(['warrant.deadline.ready'], disconnected, async () => ({ attempted: false, synced: false })));
await assert.rejects(
  () => runHandlers(['warrant.deadline.ready'], disconnected, async () => ({ attempted: true, synced: false })),
  /Calendar deadline reconciliation failed/,
);
assert.equal(store.deadlines.filter((value) => value.organisationId === 'org_b').length, 0, 'effects stay tenant scoped');

assert.equal(new Set(store.deadlines.map((value) => `${value.organisationId}:${value.sourceKey}`)).size, store.deadlines.length);
assert.ok(calendarSyncs.length > 0, 'active and completed workflow deadlines use the existing Calendar reconciliation path');
console.log('phase 2 calendar workflow tests passed');
