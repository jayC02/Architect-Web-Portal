import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LifecycleEventSource,
  WorkflowEffectStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  emitProjectCreatedLifecycleEvent,
  PROJECT_CREATED_HANDLER_KEYS,
} from '../src/server/services/lifecycle-events.service';
import { createProjectWithLifecycle } from '../src/server/services/project-creation.service';
import {
  drainWorkflowEffects,
  RetryableWorkflowEffectError,
} from '../src/server/services/workflow-effects.service';
import { getProjectDocumentReviewTarget } from '../src/server/services/workflow-targets.service';

const now = new Date('2026-08-17T09:00:00.000Z');
let sequence = 0;
const id = (prefix: string) => `${prefix}_${++sequence}`;

type Store = {
  projects: any[];
  events: any[];
  effects: any[];
  actions: any[];
  activities: any[];
  deadlines: any[];
  targets: any[];
  failLifecycleCreate: boolean;
};

let store: Store = {
  projects: [], events: [], effects: [], actions: [], activities: [], deadlines: [], targets: [],
  failLifecycleCreate: false,
};

const eligible = (effect: any, where: any) => {
  if (typeof where.id === 'string' && effect.id !== where.id) return false;
  if (where.id?.in && !where.id.in.includes(effect.id)) return false;
  if (where.organisationId && effect.organisationId !== where.organisationId) return false;
  if (where.lifecycleEventId && effect.lifecycleEventId !== where.lifecycleEventId) return false;
  if (where.leaseOwner !== undefined && effect.leaseOwner !== where.leaseOwner) return false;
  if (where.status && typeof where.status === 'string' && effect.status !== where.status) return false;
  const current = where.OR?.[0]?.availableAt?.lte ?? where.OR?.[1]?.leaseExpiresAt?.lte;
  if (!where.OR) return true;
  return (
    [WorkflowEffectStatus.PENDING, WorkflowEffectStatus.RETRYABLE].includes(effect.status)
    && effect.availableAt <= current
  ) || (
    effect.status === WorkflowEffectStatus.PROCESSING
    && effect.leaseExpiresAt
    && effect.leaseExpiresAt <= current
  );
};

const database: any = {
  project: {
    create: async ({ data }: any) => {
      const project = {
        id: data.id ?? id('project'),
        organisationId: data.organisationId,
        name: data.name,
        clientId: data.clientId ?? null,
        siteId: data.siteId ?? null,
        internalReference: data.internalReference ?? null,
        projectType: data.projectType ?? null,
        stage: data.stage ?? 'LEAD',
        localAuthority: data.localAuthority ?? null,
        siteAddress: data.siteAddress ?? null,
        status: data.status ?? 'ACTIVE',
        notes: data.notes ?? null,
        createdAt: data.createdAt ?? now,
        updatedAt: data.createdAt ?? now,
      };
      store.projects.push(project);
      return project;
    },
    findFirst: async ({ where, select }: any) => {
      const project = store.projects.find((value) => value.id === where.id && value.organisationId === where.organisationId) ?? null;
      if (!project || !select) return project;
      return Object.fromEntries(Object.keys(select).map((key) => [key, project[key]]));
    },
  },
  lifecycleEvent: {
    upsert: async ({ where, create }: any) => {
      if (store.failLifecycleCreate) throw new Error('simulated lifecycle insert failure');
      const key = where.organisationId_idempotencyKey;
      const existing = store.events.find((event) => event.organisationId === key.organisationId && event.idempotencyKey === key.idempotencyKey);
      if (existing) return existing;
      const event = { id: id('event'), dispatchedAt: null, createdAt: now, ...create };
      store.events.push(event);
      return event;
    },
    update: async ({ where, data }: any) => {
      const event = store.events.find((value) => value.id === where.id);
      Object.assign(event, data);
      return event;
    },
    findMany: async () => [],
    updateMany: async () => ({ count: 0 }),
  },
  workflowEffect: {
    createMany: async ({ data }: any) => {
      let count = 0;
      for (const value of data) {
        if (store.effects.some((effect) => effect.lifecycleEventId === value.lifecycleEventId && effect.handlerKey === value.handlerKey)) continue;
        store.effects.push({
          id: id('effect'), status: WorkflowEffectStatus.PENDING, attempts: 0,
          availableAt: now, leaseOwner: null, leaseExpiresAt: null, lastError: null,
          completedAt: null, createdAt: now, updatedAt: now, ...value,
        });
        count += 1;
      }
      return { count };
    },
    findMany: async ({ where, take, select, include }: any) => {
      const values = store.effects.filter((effect) => eligible(effect, where)).slice(0, take ?? 100);
      if (select) return values.map((effect) => ({ id: effect.id }));
      return values.map((effect) => ({
        ...effect,
        ...(include?.lifecycleEvent ? { lifecycleEvent: store.events.find((event) => event.id === effect.lifecycleEventId) } : {}),
      }));
    },
    updateMany: async ({ where, data }: any) => {
      const effect = store.effects.find((value) => eligible(value, where));
      if (!effect) return { count: 0 };
      for (const [key, value] of Object.entries(data)) {
        if (key === 'attempts' && typeof value === 'object') effect.attempts += (value as any).increment;
        else effect[key] = value;
      }
      effect.updatedAt = new Date();
      return { count: 1 };
    },
  },
  workflowTarget: {
    findUnique: async ({ where }: any) => store.targets.find((target) => (
      target.organisationId === where.organisationId_key.organisationId
      && target.key === where.organisationId_key.key
    )) ?? null,
  },
  actionItem: {
    upsert: async ({ where, update, create }: any) => {
      const key = where.organisationId_dedupeKey;
      const existing = store.actions.find((item) => item.organisationId === key.organisationId && item.dedupeKey === key.dedupeKey);
      if (existing) { Object.assign(existing, update); return existing; }
      const item = { id: id('action'), createdAt: now, updatedAt: now, ...create };
      store.actions.push(item); return item;
    },
  },
  projectActivity: {
    upsert: async ({ where, create }: any) => {
      const key = where.organisationId_idempotencyKey;
      const existing = store.activities.find((item) => item.organisationId === key.organisationId && item.idempotencyKey === key.idempotencyKey);
      if (existing) return existing;
      const activity = { id: id('activity'), createdAt: now, ...create };
      store.activities.push(activity); return activity;
    },
  },
  deadline: {
    upsert: async ({ where, update, create }: any) => {
      const key = where.organisationId_sourceKey;
      const existing = store.deadlines.find((item) => item.organisationId === key.organisationId && item.sourceKey === key.sourceKey);
      if (existing) { Object.assign(existing, update); return existing; }
      const deadline = { id: id('deadline'), createdAt: now, updatedAt: now, ...create };
      store.deadlines.push(deadline); return deadline;
    },
  },
};

database.$transaction = async (callback: (tx: any) => Promise<unknown>) => {
  const snapshot = structuredClone(store);
  try {
    return await callback(database);
  } catch (error) {
    store = snapshot;
    throw error;
  }
};

const calendarEvents = new Set<string>();
const calendarSync = async (organisationId: string, deadlineId: string) => {
  calendarEvents.add(`${organisationId}:${deadlineId}`);
  return { attempted: true, synced: true };
};

const create = (organisationId: string, name: string) => createProjectWithLifecycle({
  data: { organisationId, name, createdAt: now },
  actorUserId: `user_${organisationId}`,
}, database as PrismaClient);

const first = await create('org_a', 'Project A');
assert.equal(store.projects.length, 1);
assert.equal(store.events.length, 1, 'project and event commit together');
assert.equal(store.effects.length, PROJECT_CREATED_HANDLER_KEYS.length, 'controlled handlers expand once');

await emitProjectCreatedLifecycleEvent(database as never, {
  organisationId: 'org_a',
  project: first.project,
  source: LifecycleEventSource.MANUAL_PROJECT,
  actorUserId: 'user_org_a',
});
assert.equal(store.events.length, 1, 're-emitting the same project event is idempotent');
assert.equal(store.effects.length, 3, 'effect expansion is idempotent');

const drained = await drainWorkflowEffects({
  database: database as PrismaClient,
  calendarSync,
  organisationId: 'org_a',
  lifecycleEventId: first.lifecycleEventId,
  limit: 3,
  now,
  random: () => 0,
});
assert.deepEqual(drained, { claimed: 3, completed: 3, retryable: 0, failedFinal: 0 });
assert.equal(store.actions.length, 1);
assert.equal(store.activities.length, 1);
assert.equal(store.deadlines.length, 1);
assert.equal(calendarEvents.size, 1);
assert.equal(store.deadlines[0].sourceKey, `workflow:project:${first.project.id}:document-review`);
assert.match(store.deadlines[0].description, /Internal practice target/);
assert.equal(store.deadlines[0].dueDate.toISOString(), '2026-08-20T09:00:00.000Z');

for (const effect of store.effects) {
  effect.status = WorkflowEffectStatus.RETRYABLE;
  effect.availableAt = now;
  effect.completedAt = null;
}
await drainWorkflowEffects({
  database: database as PrismaClient,
  calendarSync,
  organisationId: 'org_a',
  lifecycleEventId: first.lifecycleEventId,
  limit: 3,
  now,
  random: () => 0,
});
assert.equal(store.actions.length, 1, 'repeated handling keeps one ActionItem');
assert.equal(store.activities.length, 1, 'repeated handling keeps one ProjectActivity');
assert.equal(store.deadlines.length, 1, 'repeated handling keeps one Deadline');
assert.equal(calendarEvents.size, 1, 'repeated handling keeps one Calendar identity');

const beforeFailure = store.projects.length;
store.failLifecycleCreate = true;
await assert.rejects(() => create('org_a', 'Must roll back'), /simulated lifecycle insert failure/);
assert.equal(store.projects.length, beforeFailure, 'event insertion failure rolls project creation back');
store.failLifecycleCreate = false;

const retryProject = await create('org_a', 'Retry Project');
let attempts = 0;
const retryHandler = async (effect: any, { database: targetDatabase }: any) => {
  attempts += 1;
  if (attempts === 1) throw new RetryableWorkflowEffectError('temporary failure');
  const dedupeKey = `project:${effect.lifecycleEvent.projectId}:document-review`;
  await targetDatabase.actionItem.upsert({
    where: { organisationId_dedupeKey: { organisationId: effect.organisationId, dedupeKey } },
    update: { title: 'Review project documents' },
    create: {
      organisationId: effect.organisationId,
      projectId: effect.lifecycleEvent.projectId,
      sourceLifecycleEventId: effect.lifecycleEvent.id,
      kind: 'DOCUMENT_REVIEW', title: 'Review project documents', actionUrl: '#documents',
      dedupeKey,
    },
  });
};
const retryOverrides = { 'project.action.initial-document-review': retryHandler };
const firstAttempt = await drainWorkflowEffects({
  database: database as PrismaClient, calendarSync, organisationId: 'org_a',
  lifecycleEventId: retryProject.lifecycleEventId, limit: 3, now, random: () => 0,
  handlerOverrides: retryOverrides,
});
assert.equal(firstAttempt.retryable, 1);
assert.equal(firstAttempt.completed, 2, 'one failed effect does not block independent effects');
const secondAttempt = await drainWorkflowEffects({
  database: database as PrismaClient, calendarSync, organisationId: 'org_a',
  lifecycleEventId: retryProject.lifecycleEventId, limit: 1,
  now: new Date(now.getTime() + 60_000), random: () => 0,
  handlerOverrides: retryOverrides,
});
assert.equal(secondAttempt.completed, 1, 'a retryable effect succeeds later');
assert.equal(store.actions.filter((item) => item.projectId === retryProject.project.id).length, 1);

const calendarFailureProject = await create('org_a', 'Calendar Failure Project');
const calendarFailure = await drainWorkflowEffects({
  database: database as PrismaClient,
  calendarSync: async () => ({ attempted: true, synced: false }),
  organisationId: 'org_a', lifecycleEventId: calendarFailureProject.lifecycleEventId,
  limit: 3, now, random: () => 0,
});
assert.deepEqual(calendarFailure, { claimed: 3, completed: 2, retryable: 1, failedFinal: 0 });
assert.equal(store.projects.filter((item) => item.id === calendarFailureProject.project.id).length, 1);
assert.equal(store.events.filter((item) => item.id === calendarFailureProject.lifecycleEventId).length, 1);
assert.equal(store.actions.filter((item) => item.projectId === calendarFailureProject.project.id).length, 1);
assert.equal(store.activities.filter((item) => item.projectId === calendarFailureProject.project.id).length, 1);
assert.equal(store.deadlines.filter((item) => item.projectId === calendarFailureProject.project.id).length, 1);
const calendarRecovery = await drainWorkflowEffects({
  database: database as PrismaClient, calendarSync, organisationId: 'org_a',
  lifecycleEventId: calendarFailureProject.lifecycleEventId, limit: 1,
  now: new Date(now.getTime() + 60_000), random: () => 0,
});
assert.equal(calendarRecovery.completed, 1, 'Calendar reconciliation can recover independently');

const noCalendarProject = await create('org_a', 'No Calendar Project');
const noCalendar = await drainWorkflowEffects({
  database: database as PrismaClient,
  calendarSync: async () => ({ attempted: false, synced: false }),
  organisationId: 'org_a', lifecycleEventId: noCalendarProject.lifecycleEventId,
  limit: 3, now, random: () => 0,
});
assert.deepEqual(noCalendar, { claimed: 3, completed: 3, retryable: 0, failedFinal: 0 });

const expiredLeaseProject = await create('org_a', 'Expired Lease Project');
const expiredLeaseEffects = store.effects.filter((effect) => effect.lifecycleEventId === expiredLeaseProject.lifecycleEventId);
for (const effect of expiredLeaseEffects.slice(1)) effect.status = WorkflowEffectStatus.COMPLETED;
expiredLeaseEffects[0].status = WorkflowEffectStatus.PROCESSING;
expiredLeaseEffects[0].leaseOwner = 'stale-worker';
expiredLeaseEffects[0].leaseExpiresAt = new Date(now.getTime() - 1);
const reclaimed = await drainWorkflowEffects({
  database: database as PrismaClient, calendarSync, organisationId: 'org_a',
  lifecycleEventId: expiredLeaseProject.lifecycleEventId, limit: 1, now,
});
assert.equal(reclaimed.claimed, 1, 'an expired effect lease can be reclaimed');

const malformedProject = await create('org_a', 'Malformed Event Project');
const malformedEffects = store.effects.filter((effect) => effect.lifecycleEventId === malformedProject.lifecycleEventId);
for (const effect of malformedEffects.slice(1)) effect.status = WorkflowEffectStatus.COMPLETED;
store.events.find((event) => event.id === malformedProject.lifecycleEventId).payload = { projectId: malformedProject.project.id };
const malformed = await drainWorkflowEffects({
  database: database as PrismaClient, calendarSync, organisationId: 'org_a',
  lifecycleEventId: malformedProject.lifecycleEventId, limit: 1, now,
});
assert.equal(malformed.failedFinal, 1, 'malformed event payloads fail permanently');
assert.equal(malformedEffects[0].attempts, 1, 'malformed event payloads are not retried forever');

const finalFailureProject = await create('org_a', 'Final Failure Project');
const finalFailureEffects = store.effects.filter((effect) => effect.lifecycleEventId === finalFailureProject.lifecycleEventId);
const finalFailureEffect = finalFailureEffects.find((effect) => effect.handlerKey === 'project.action.initial-document-review');
for (const effect of finalFailureEffects) effect.status = WorkflowEffectStatus.COMPLETED;
finalFailureEffect.status = WorkflowEffectStatus.PENDING;
finalFailureEffect.attempts = 5;
const finalFailure = await drainWorkflowEffects({
  database: database as PrismaClient, calendarSync, organisationId: 'org_a',
  lifecycleEventId: finalFailureProject.lifecycleEventId, limit: 1, now, random: () => 0,
  handlerOverrides: { 'project.action.initial-document-review': async () => { throw new Error('inspectable final failure'); } },
});
assert.equal(finalFailure.failedFinal, 1);
assert.equal(finalFailureEffect.status, WorkflowEffectStatus.FAILED_FINAL);
assert.match(finalFailureEffect.lastError, /inspectable final failure/);

const orgB = await create('org_b', 'Project B');
await assert.rejects(() => emitProjectCreatedLifecycleEvent(database as never, {
  organisationId: 'org_a',
  project: orgB.project,
  source: LifecycleEventSource.MANUAL_PROJECT,
  actorUserId: 'user_org_a',
}), /outside the organisation/);
store.targets.push({ organisationId: 'org_b', key: 'PROJECT_DOCUMENT_REVIEW', enabled: true, offsetDays: 9 });
assert.deepEqual(
  await getProjectDocumentReviewTarget(database as PrismaClient, 'org_a'),
  { enabled: true, offsetDays: 3 },
  'workflow target lookup cannot read another organisation configuration',
);
const orgAEffectsBefore = store.effects.filter((effect) => effect.organisationId === 'org_a' && effect.status === WorkflowEffectStatus.PENDING).length;
await drainWorkflowEffects({
  database: database as PrismaClient, calendarSync, organisationId: 'org_b',
  lifecycleEventId: orgB.lifecycleEventId, limit: 1, now, random: () => 0,
});
assert.equal(
  store.effects.filter((effect) => effect.organisationId === 'org_a' && effect.status === WorkflowEffectStatus.PENDING).length,
  orgAEffectsBefore,
  'an organisation-scoped worker cannot claim another organisation effect',
);

const raceProject = await create('org_a', 'Race Project');
const raceEffects = store.effects.filter((effect) => effect.lifecycleEventId === raceProject.lifecycleEventId);
for (const effect of raceEffects.slice(1)) effect.status = WorkflowEffectStatus.COMPLETED;
const race = await Promise.all([
  drainWorkflowEffects({ database: database as PrismaClient, calendarSync, organisationId: 'org_a', lifecycleEventId: raceProject.lifecycleEventId, limit: 1, now }),
  drainWorkflowEffects({ database: database as PrismaClient, calendarSync, organisationId: 'org_a', lifecycleEventId: raceProject.lifecycleEventId, limit: 1, now }),
]);
assert.equal(race.reduce((total, value) => total + value.claimed, 0), 1, 'concurrent workers claim an active effect once');

const draftCommitSource = fs.readFileSync('src/server/services/application-draft-commit.service.ts', 'utf8');
assert.match(draftCommitSource, /records\.projectCreated\s*\?\s*await emitProjectCreatedLifecycleEvent/, 'new intake projects emit inside the commit transaction');
assert.match(draftCommitSource, /if \(selected\.project\)[\s\S]*projectCreated: false/, 'reused intake projects do not emit PROJECT_CREATED');
const projectPage = fs.readFileSync('src/pages/projects/[id].astro', 'utf8');
for (const model of ['actionItem', 'projectActivity']) {
  assert.match(projectPage, new RegExp(`prisma\\.${model}\\.findMany\\([\\s\\S]*organisationId: auth\\.organisation\\.id`), `${model} project UI is organisation scoped`);
}

console.log('lifecycle orchestration tests passed');
