import assert from 'node:assert/strict';
import { acceptTeamInvite, seatsAvailable, USER_LIMIT_CODE } from '../src/server/billing/team';
import { completeGoogleSignupSchema, registerSchema } from '../src/lib/validation/auth';

// ---------- seat counting ----------
assert.equal(seatsAvailable({ limit: null, members: 40, pending: 10 }), true, 'no limit means unlimited');
assert.equal(seatsAvailable({ limit: 3, members: 1, pending: 1 }), true);
assert.equal(seatsAvailable({ limit: 3, members: 2, pending: 1 }), false, 'pending invitations take a place');
assert.equal(seatsAvailable({ limit: 1, members: 1, pending: 0 }), false, 'pay as you go is one user');

// ---------- accepting an invitation ----------
const now = new Date('2026-11-26T12:00:00Z');
const fakeTx = (input: { invite: { id: string; email: string; role: 'MEMBER' | 'ADMIN' } | null; limit: number | null; members: number; claimable?: boolean }) => {
  let locked = false;
  const tx = {
    $executeRaw: async () => { locked = true; return 1; },
    teamInvite: {
      findFirst: async () => input.invite,
      updateMany: async () => ({ count: input.claimable === false ? 0 : 1 }),
    },
    organisationSubscription: { findUnique: async () => ({ userLimit: input.limit }) },
    organisationMember: { count: async () => input.members },
  };
  return { tx: tx as never, wasLocked: () => locked };
};
const accept = (tx: never, email = 'new@practice.test') =>
  acceptTeamInvite(tx, { inviteId: 'inv', organisationId: 'org', email, now });
const invite = { id: 'inv', email: 'new@practice.test', role: 'ADMIN' as const };

{
  const { tx, wasLocked } = fakeTx({ invite, limit: 3, members: 2 });
  const membership = await accept(tx, 'NEW@practice.test');
  assert.deepEqual(membership, { role: 'ADMIN', organisationId: 'org' }, 'email match ignores case; role carried over');
  assert.ok(wasLocked(), 'team changes are serialised');
}
await assert.rejects(accept(fakeTx({ invite, limit: 3, members: 2 }).tx, 'someone@else.test'),
  (error: { status: number }) => error.status === 403, 'invitation is bound to its email');
await assert.rejects(accept(fakeTx({ invite, limit: 2, members: 2 }).tx),
  (error: { status: number; details?: { code?: string } }) => error.status === 409 && error.details?.code === USER_LIMIT_CODE,
  'limit lowered since the invite was sent');
await assert.rejects(accept(fakeTx({ invite: null, limit: 3, members: 1 }).tx),
  (error: { status: number }) => error.status === 410, 'expired, cancelled or used');
await assert.rejects(accept(fakeTx({ invite, limit: 3, members: 1, claimable: false }).tx),
  (error: { status: number }) => error.status === 410, 'claimed by a concurrent sign-up');
await accept(fakeTx({ invite, limit: null, members: 99 }).tx);

// ---------- sign-up validation ----------
const base = { name: 'Alex Kerr', email: 'alex@practice.test', password: 'long enough password' };
assert.equal(registerSchema.safeParse({ ...base, team: 'tmi_token' }).success, true, 'joining needs no organisation name');
assert.equal(registerSchema.safeParse(base).success, false, 'a new workspace needs a name');
assert.equal(registerSchema.safeParse({ ...base, organisationName: 'Kerr Architects' }).success, true);
assert.equal(completeGoogleSignupSchema.safeParse({ joinTeam: '1' }).success, true);
assert.equal(completeGoogleSignupSchema.safeParse({}).success, false);
assert.equal(completeGoogleSignupSchema.safeParse({ organisationName: 'Kerr Architects' }).success, true);

console.log('PASS team invites: seat counting, email binding, limit re-check, single use and sign-up validation.');
