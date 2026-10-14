import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import { prisma } from '../src/lib/db/prisma';
import { GET } from '../src/pages/api/clients/index';

const findSession = prisma.session.findUnique;
const findClients = prisma.client.findMany;
let lastQuery: any;
const context = (query: string, authenticated = true) => ({
  url: new URL(`http://localhost/api/clients${query}`), request: new Request(`http://localhost/api/clients${query}`),
  cookies: { get: () => authenticated ? { value: 'test-session' } : undefined },
}) as unknown as APIContext;

try {
  Object.assign(prisma.session, { findUnique: async () => ({
    id: 'test-session', expiresAt: new Date(Date.now() + 90 * 86400000), lastSeenAt: new Date(),
    user: { id: 'test-user', organisationLinks: [{ role: 'MEMBER', organisation: { id: 'current-organisation' } }] },
  }) });
  Object.assign(prisma.client, { findMany: async (query: unknown) => { lastQuery = query; return []; } });
  const response = await GET(context('?q=L.%20MacDonald'));
  assert.equal(response.status, 200);
  assert.equal(lastQuery.where.organisationId, 'current-organisation', 'search stays scoped to the authenticated organisation');
  assert.equal(lastQuery.take, 100);
  assert.ok(JSON.stringify(lastQuery.where.OR).includes('MacDonald'));
  assert.deepEqual(await response.json(), { clients: [], canViewFinance: false });
  await GET(context('?clientId=older-client&q=ignored'));
  assert.deepEqual(lastQuery.where, { organisationId: 'current-organisation', id: 'older-client' }, 'default client is fetched directly, not lost outside the most recent 100');
  await GET(context(''));
  assert.deepEqual(lastQuery.where, { organisationId: 'current-organisation' }, 'the normal directory listing is unchanged');
  const records = Array.from({ length: 101 }, (_, index) => ({ id: `client-${index}`, name: `Client ${index}` }));
  Object.assign(prisma.client, { findMany: async (query: unknown) => { lastQuery = query; return records; } });
  const picker = await GET(context('?picker=true'));
  const page = await picker.json();
  assert.equal(page.clients.length, 100);
  assert.equal(page.nextCursor, 'client-99', 'the client picker can load beyond the first page');
  assert.deepEqual(lastQuery.orderBy, [{ name: 'asc' }, { id: 'asc' }]);
  await GET(context('?picker=true&after=client-99'));
  assert.deepEqual(lastQuery.cursor, { id: 'client-99' });
  assert.equal(lastQuery.skip, 1);
  assert.equal(lastQuery.where.organisationId, 'current-organisation', 'every picker page remains organisation scoped');
  Object.assign(prisma.client, { findMany: async () => [] });
  assert.equal((await (await GET(context('?picker=true&after=client-99'))).json()).nextCursor, null);
  lastQuery = null;
  assert.equal((await GET(context('?clientId=other-client', false))).status, 401);
  assert.equal(lastQuery, null, 'unauthenticated requests never query client data');
  console.log('Client directory search, ID lookup and organisation scope tests passed');
} finally {
  Object.assign(prisma.session, { findUnique: findSession });
  Object.assign(prisma.client, { findMany: findClients });
}
