import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ActionItemStatus,
  AutomationJobStatus,
  AutomationJobType,
  LifecycleEventType,
  PlanningStatus,
  WarrantStatus,
} from '@prisma/client';
import {
  confirmBuildingWarrantSubmittedInTransaction,
  confirmPlanningApplicationSubmittedInTransaction,
} from '../src/server/services/application-lifecycle.service';
import { reconcilePreparedApplicationReview } from '../src/server/services/prepared-application-review.service';

const occurredAt = new Date('2026-09-02T10:30:00.000Z');

const selectFields = (value: Record<string, unknown> | null, select?: Record<string, boolean>) => (
  !value || !select ? value : Object.fromEntries(Object.keys(select).map((key) => [key, value[key]]))
);

const createLifecycleDatabase = () => {
  const state = {
    planning: {
      id: 'planning_a', organisationId: 'org_a', projectId: 'project_a',
      status: PlanningStatus.DRAFTING as PlanningStatus, submissionDate: null as Date | null,
    },
    warrant: {
      id: 'warrant_a', organisationId: 'org_a', projectId: 'project_a',
      status: WarrantStatus.DRAFTING as WarrantStatus, submissionDate: null as Date | null,
    },
    events: [] as any[],
    effects: [] as any[],
  };

  const matches = (record: any, where: any) => record.id === where.id
    && record.organisationId === where.organisationId;
  const applicationDelegate = (key: 'planning' | 'warrant') => ({
    findFirst: async ({ where, select }: any) => selectFields(matches(state[key], where) ? state[key] : null, select),
    updateMany: async ({ where, data }: any) => {
      const record = state[key];
      if (!matches(record, where) || (where.status?.in && !where.status.in.includes(record.status))) return { count: 0 };
      Object.assign(record, data);
      return { count: 1 };
    },
    findUniqueOrThrow: async ({ where, select }: any) => {
      assert.equal(where.id, state[key].id);
      return selectFields(state[key], select);
    },
  });

  const database: any = {
    planningApplication: applicationDelegate('planning'),
    buildingWarrantApplication: applicationDelegate('warrant'),
    project: {
      findFirst: async ({ where }: any) => where.id === 'project_a' && where.organisationId === 'org_a'
        ? { id: 'project_a' }
        : null,
    },
    lifecycleEvent: {
      upsert: async ({ where, create }: any) => {
        const key = where.organisationId_idempotencyKey;
        const existing = state.events.find((event) => event.organisationId === key.organisationId
          && event.idempotencyKey === key.idempotencyKey);
        if (existing) return existing;
        const event = { id: `event_${state.events.length + 1}`, dispatchedAt: null, ...create };
        state.events.push(event);
        return event;
      },
      update: async ({ where, data }: any) => {
        const event = state.events.find((candidate) => candidate.id === where.id);
        Object.assign(event, data);
        return event;
      },
    },
    workflowEffect: {
      createMany: async ({ data }: any) => {
        for (const effect of data) {
          if (!state.effects.some((candidate) => candidate.lifecycleEventId === effect.lifecycleEventId
            && candidate.handlerKey === effect.handlerKey)) state.effects.push(effect);
        }
        return { count: data.length };
      },
    },
  };
  return { database, state };
};

const planningLifecycle = createLifecycleDatabase();
const firstPlanning = await confirmPlanningApplicationSubmittedInTransaction(planningLifecycle.database, {
  organisationId: 'org_a', planningApplicationId: 'planning_a', actorUserId: 'user_a', occurredAt,
});
assert.equal(firstPlanning.changed, true);
assert.equal(firstPlanning.application.status, PlanningStatus.SUBMITTED);
assert.equal(firstPlanning.application.submissionDate?.toISOString(), occurredAt.toISOString());
assert.equal(planningLifecycle.state.events.length, 1);
assert.equal(planningLifecycle.state.events[0].eventType, LifecycleEventType.PLANNING_SUBMITTED);
assert.equal(planningLifecycle.state.effects.filter((effect) => effect.handlerKey === 'finance.fee-milestone.evaluate').length, 1);

const repeatedPlanning = await confirmPlanningApplicationSubmittedInTransaction(planningLifecycle.database, {
  organisationId: 'org_a', planningApplicationId: 'planning_a', actorUserId: 'user_a', occurredAt,
});
assert.equal(repeatedPlanning.changed, false);
assert.equal(planningLifecycle.state.events.length, 1, 'repeated confirmation emits no duplicate lifecycle event');

planningLifecycle.state.planning.status = PlanningStatus.VALIDATED;
const progressedPlanning = await confirmPlanningApplicationSubmittedInTransaction(planningLifecycle.database, {
  organisationId: 'org_a', planningApplicationId: 'planning_a', actorUserId: 'user_a', occurredAt,
});
assert.equal(progressedPlanning.changed, false);
assert.equal(progressedPlanning.application.status, PlanningStatus.VALIDATED, 'later council states never regress');

const warrantLifecycle = createLifecycleDatabase();
const firstWarrant = await confirmBuildingWarrantSubmittedInTransaction(warrantLifecycle.database, {
  organisationId: 'org_a', buildingWarrantApplicationId: 'warrant_a', actorUserId: 'user_a', occurredAt,
});
assert.equal(firstWarrant.changed, true);
assert.equal(firstWarrant.application.status, WarrantStatus.SUBMITTED);
assert.deepEqual(
  warrantLifecycle.state.effects.map((effect) => effect.handlerKey),
  ['warrant.action.submitted', 'warrant.deadline.submitted', 'finance.fee-milestone.evaluate'],
);
const repeatedWarrant = await confirmBuildingWarrantSubmittedInTransaction(warrantLifecycle.database, {
  organisationId: 'org_a', buildingWarrantApplicationId: 'warrant_a', actorUserId: 'user_a', occurredAt,
});
assert.equal(repeatedWarrant.changed, false);
assert.equal(warrantLifecycle.state.events.length, 1);

await assert.rejects(
  () => confirmPlanningApplicationSubmittedInTransaction(createLifecycleDatabase().database, {
    organisationId: 'org_b', planningApplicationId: 'planning_a', actorUserId: 'user_b', occurredAt,
  }),
  /Planning application not found/,
);

const projectionState = {
  planning: { id: 'planning_a', organisationId: 'org_a', projectId: 'project_a', status: PlanningStatus.DRAFTING as PlanningStatus },
  warrant: { id: 'warrant_a', organisationId: 'org_a', projectId: 'project_a', status: WarrantStatus.DRAFTING as WarrantStatus },
  actions: [] as any[],
};
const projectionDatabase: any = {
  planningApplication: {
    findFirst: async ({ where, select }: any) => selectFields(
      projectionState.planning.id === where.id
        && projectionState.planning.organisationId === where.organisationId
        && projectionState.planning.projectId === where.projectId
        ? projectionState.planning : null,
      select,
    ),
  },
  buildingWarrantApplication: {
    findFirst: async ({ where, select }: any) => selectFields(
      projectionState.warrant.id === where.id
        && projectionState.warrant.organisationId === where.organisationId
        && projectionState.warrant.projectId === where.projectId
        ? projectionState.warrant : null,
      select,
    ),
  },
  actionItem: {
    upsert: async ({ where, update, create }: any) => {
      const key = where.organisationId_dedupeKey;
      const existing = projectionState.actions.find((action) => action.organisationId === key.organisationId
        && action.dedupeKey === key.dedupeKey);
      if (existing) { Object.assign(existing, update); return existing; }
      const action = { id: `action_${projectionState.actions.length + 1}`, ...create };
      projectionState.actions.push(action);
      return action;
    },
    updateMany: async ({ where, data }: any) => {
      const matches = projectionState.actions.filter((action) => action.organisationId === where.organisationId
        && action.dedupeKey === where.dedupeKey && action.status === where.status);
      matches.forEach((action) => Object.assign(action, data));
      return { count: matches.length };
    },
  },
};

const planningJob = {
  id: 'job_planning', projectId: 'project_a', type: AutomationJobType.HOUSEHOLDER_PLANNING,
  status: AutomationJobStatus.COMPLETED,
  dataSnapshot: { project: { id: 'project_a' }, planningApplication: { id: 'planning_a' } },
};
assert.deepEqual(await reconcilePreparedApplicationReview(projectionDatabase, {
  organisationId: 'org_a', job: planningJob as any, occurredAt,
}), { outcome: 'opened', applicationId: 'planning_a' });
assert.equal(projectionState.actions.length, 1);
assert.equal(projectionState.actions[0].dedupeKey, 'planning:planning_a:final-review');
assert.equal(projectionState.actions[0].dueAt, null, 'prepared review remains undated');
assert.match(projectionState.actions[0].title, /prepared — review and submit/);

await reconcilePreparedApplicationReview(projectionDatabase, {
  organisationId: 'org_a', job: planningJob as any, occurredAt,
});
assert.equal(projectionState.actions.length, 1, 'callback replay reuses the organisation-scoped dedupe key');

projectionState.planning.status = PlanningStatus.SUBMITTED;
await reconcilePreparedApplicationReview(projectionDatabase, {
  organisationId: 'org_a', job: planningJob as any, occurredAt,
});
assert.equal(projectionState.actions[0].status, ActionItemStatus.RESOLVED);

const warrantJob = {
  id: 'job_warrant', projectId: 'project_a', type: AutomationJobType.BUILDING_WARRANT,
  status: AutomationJobStatus.AWAITING_PORTAL_REVIEW,
  dataSnapshot: { project: { id: 'project_a' }, buildingWarrantApplication: { id: 'warrant_a' } },
};
await reconcilePreparedApplicationReview(projectionDatabase, {
  organisationId: 'org_a', job: warrantJob as any, occurredAt,
});
const warrantAction = projectionState.actions.find((action) => action.dedupeKey === 'warrant:warrant_a:final-review');
assert.equal(warrantAction.dueAt, null);
assert.match(warrantAction.title, /pay, review and submit/);

const ambiguous = await reconcilePreparedApplicationReview(projectionDatabase, {
  organisationId: 'org_a',
  job: { ...planningJob, dataSnapshot: {} } as any,
  occurredAt,
});
assert.equal(ambiguous.outcome, 'identity-unavailable');

const source = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
for (const route of [
  source('../src/pages/api/planning/[id]/mark-submitted.ts'),
  source('../src/pages/api/building-warrant/[id]/mark-submitted.ts'),
]) {
  assert.match(route, /assertAllowedOrigin/);
  assert.match(route, /assertRateLimit/);
  assert.match(route, /requireOrganisation/);
  assert.match(route, /markApplicationSubmittedSchema/);
}
assert.match(source('../src/pages/api/building-warrant/[id]/certifier-details.ts'), /updateBuildingWarrantWithLifecycle/);
assert.match(source('../src/pages/api/desktop/automation-jobs/[id]/index.ts'), /reconcilePreparedApplicationReview/);
assert.match(source('../src/pages/api/projects/[id]/planning.ts'), /planningApplicationCreateSchema/);
assert.match(source('../src/pages/api/projects/[id]/building-warrant.ts'), /buildingWarrantCreateSchema/);

const liveCard = source('../src/components/automation/DesktopAutomationLiveCard.tsx');
assert.match(liveCard, /Prepared — needs your review/);
assert.match(liveCard, /Mark as submitted/);
assert.match(liveCard, /Confirm submission/);
assert.match(liveCard, /submissionInFlightRef\.current/);
assert.match(liveCard, /onCancel/);
assert.match(liveCard, /aria-live="polite"/);
assert.match(liveCard, /window\.location\.reload/);
assert.match(liveCard, /Submitted — waiting for council/);
assert.match(liveCard, /did not submit it/);

const gmailClassifier = source('../src/server/services/gmail-planning-classifier.service.ts');
assert.match(gmailClassifier, /Initial submission confirmation requires user review/);

const dashboard = source('../src/pages/api/dashboard/summary.ts');
assert.match(dashboard, /ActionItemKind\.PLANNING_FINAL_REVIEW/);
assert.match(dashboard, /ActionItemKind\.BUILDING_WARRANT_FINAL_REVIEW/);
assert.match(dashboard, /type: 'Needs your review'/);
assert.match(dashboard, /AND NOT \(a\.status = 'DRAFTING' AND EXISTS/);
assert.match(dashboard, /AND NOT \(w\.status = 'DRAFTING' AND EXISTS/);

console.log('submission state workflow tests passed');
