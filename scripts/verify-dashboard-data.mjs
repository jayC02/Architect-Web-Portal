import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { prisma } from '../src/lib/db/prisma.ts';
import { getDashboardSummary } from '../src/pages/api/dashboard/summary.ts';

const organisationId = process.env.DASHBOARD_ORGANISATION_ID;
if (!organisationId) throw new Error('Set DASHBOARD_ORGANISATION_ID.');
try {
  const now = new Date();
  const summary = await getDashboardSummary(organisationId, new URLSearchParams('deadlineRange=14'), now);
  const [projects, documents, deadlines] = await Promise.all([
    prisma.project.findMany({ where: { organisationId }, select: { id: true, stage: true, status: true } }),
    prisma.projectDocument.groupBy({ by: ['status'], where: { organisationId }, _count: true }),
    prisma.deadline.findMany({ where: { organisationId, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, select: { id: true, dueDate: true } }),
  ]);
  const active = projects.filter(item => !['COMPLETED', 'ARCHIVED'].includes(item.status) && item.stage !== 'ARCHIVED');
  assert.equal(summary.activeProjects, active.length);
  assert.deepEqual(summary.activeProjectSummaries.map(item => item.id).sort(), active.map(item => item.id).sort());
  assert.equal(summary.pipeline.reduce((total, phase) => total + phase.count, 0), projects.filter(item => item.status !== 'ARCHIVED' && item.stage !== 'ARCHIVED').length);
  assert.equal(summary.documentOverview.total, documents.reduce((total, group) => total + group._count, 0));
  assert.equal(summary.documentOverview.reviewed, documents.find(group => group.status === 'APPROVED')?._count ?? 0);
  assert.equal(summary.documentsNeedingReview, documents.find(group => group.status === 'IN_REVIEW')?._count ?? 0);
  assert.equal(summary.documentOverview.projects.reduce((total, item) => total + item.count, 0), summary.documentsNeedingReview);
  const dateKey = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const last = new Date(`${dateKey(now)}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + 13);
  const expectedDeadlines = deadlines.filter(item => dateKey(item.dueDate) <= last.toISOString().slice(0, 10));
  assert.equal(summary.upcomingDeadlineCount, expectedDeadlines.length);
  assert.equal(summary.actionWorkload.overdueDeadlines, deadlines.filter(item => dateKey(item.dueDate) < dateKey(now)).length);
  assert.ok(summary.needsAttention.every(item => item.href.startsWith('/') && !item.href.startsWith('/deadlines?')));
  await fs.mkdir('output/dashboard-audit', { recursive: true });
  await fs.writeFile('output/dashboard-audit/live-summary.json', JSON.stringify(summary, null, 2));
  const report = { activeProjects: summary.activeProjects, documents: summary.documentOverview.total, approved: summary.documentOverview.reviewed, inReview: summary.documentsNeedingReview, deadlines: summary.upcomingDeadlineCount, automation: summary.automationOverview, attentionItems: summary.needsAttention.length };
  console.log('Actual database records agree with dashboard:', JSON.stringify(report));
} finally { await prisma.$disconnect(); }
