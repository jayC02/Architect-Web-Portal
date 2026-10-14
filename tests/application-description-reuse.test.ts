import assert from 'node:assert/strict';
import { prisma } from '../src/lib/db/prisma';
import { resolveApplicationDescription } from '../src/server/services/application-description.service';
import { ensureAutomationApplicationRecord } from '../src/server/services/automation-jobs.service';
import { AutomationJobType } from '@prisma/client';
import { householderPreparationUpdateSchema, buildingWarrantCertifierDetailsSchema } from '../src/lib/validation/domain';

const delegates = [prisma.applicationDraft, prisma.planningApplication, prisma.buildingWarrantApplication];
const originals = delegates.map(delegate => delegate.findFirst);
const createPlanning = prisma.planningApplication.create;
const createWarrant = prisma.buildingWarrantApplication.create;
const findProject = prisma.project.findFirst;
const calls: any[] = [];
let draft: any = { confirmedData: { application: { description: 'Reviewed description from the uploaded documents' } }, committedAt: new Date('2026-10-01') };
let planning: any = null;
let warrant: any = null;
try {
  delegates.forEach((delegate, index) => Object.assign(delegate, { findFirst: async (query: unknown) => {
    calls.push(query);
    if ((query as any).select.id) return null;
    return [draft, planning, warrant][index];
  } }));
  assert.equal(await resolveApplicationDescription('org', 'project', 'Edited application description'), 'Edited application description');
  assert.equal(calls.length, 0, 'an application-specific edit always wins');
  assert.equal(await resolveApplicationDescription('org', 'project', ' '), draft.confirmedData.application.description);
  assert.deepEqual(calls[0].where, { organisationId: 'org', resultingProjectId: 'project', status: 'COMMITTED' });
  assert.equal(calls[1].where.organisationId, 'org');
  assert.equal(calls[1].where.projectId, 'project');
  assert.equal(calls[2].where.organisationId, 'org');
  warrant = { description: 'More recently corrected work', updatedAt: new Date('2026-10-02') };
  assert.equal(await resolveApplicationDescription('org', 'project'), warrant.description, 'later applications inherit the latest saved correction');
  draft = null;
  assert.equal(await resolveApplicationDescription('org', 'project'), warrant.description);
  planning = { description: 'New planning correction', updatedAt: new Date('2026-10-03') };
  assert.equal(await resolveApplicationDescription('org', 'project'), planning.description);
  let created: any;
  Object.assign(prisma.planningApplication, { create: async (input: any) => { created = input.data; return { id: 'new-planning' }; } });
  Object.assign(prisma.buildingWarrantApplication, { create: async (input: any) => { created = input.data; return { id: 'new-warrant' }; } });
  Object.assign(prisma.project, { findFirst: async () => ({ projectType: 'domestic_alteration_extension' }) });
  assert.deepEqual(await ensureAutomationApplicationRecord('org', 'project', AutomationJobType.HOUSEHOLDER_PLANNING), { planningApplicationId: 'new-planning' });
  assert.equal(created.description, planning.description, 'actual Planning creation reuses the saved work description');
  assert.deepEqual(await ensureAutomationApplicationRecord('org', 'project', AutomationJobType.BUILDING_WARRANT), { buildingWarrantApplicationId: 'new-warrant' });
  assert.equal(created.description, planning.description, 'actual Building Warrant creation shares the same description');
  planning = null; warrant = null;
  assert.equal(await resolveApplicationDescription('org', 'project'), null, 'missing descriptions are not invented');
  const longDescription = 'A'.repeat(4000);
  assert.equal(householderPreparationUpdateSchema.parse({ description: longDescription,
    discussedWithPlanningAuthority: false, treesOnOrAdjacentToSite: false, newOrAlteredVehicleAccess: false,
    soleOwner: true, agriculturalHolding: false }).description, longDescription);
  assert.equal(buildingWarrantCertifierDetailsSchema.shape.description.parse(longDescription), longDescription);
  assert.throws(() => buildingWarrantCertifierDetailsSchema.shape.description.parse('A'.repeat(4001)));
  console.log('Application description reuse, edit precedence and length validation passed.');
} finally {
  delegates.forEach((delegate, index) => Object.assign(delegate, { findFirst: originals[index] }));
  Object.assign(prisma.planningApplication, { create: createPlanning });
  Object.assign(prisma.buildingWarrantApplication, { create: createWarrant });
  Object.assign(prisma.project, { findFirst: findProject });
}
