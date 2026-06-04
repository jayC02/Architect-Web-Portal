import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/auth/password';

const prisma = new PrismaClient();

async function main() {
  const email = 'demo@architect-portal.local';
  const passwordHash = await hashPassword(process.env.DEMO_USER_PASSWORD || 'ChangeMe123!');

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: 'Demo Architect',
      email,
      passwordHash,
    },
  });

  const organisation = await prisma.organisation.upsert({
    where: { slug: 'demo-practice' },
    update: {},
    create: {
      name: 'Demo Architecture Practice',
      slug: 'demo-practice',
      members: {
        create: {
          userId: user.id,
          role: 'OWNER',
        },
      },
      clients: {
        create: {
          name: 'Harbour Homes Ltd',
          email: 'projects@example.com',
          phone: '0131 000 0000',
          address: '1 Practice Street, Edinburgh',
        },
      },
    },
    include: { clients: true },
  });

  const site = await prisma.site.create({
    data: {
      organisationId: organisation.id,
      addressLine1: '24 North Lane',
      townCity: 'Edinburgh',
      postcode: 'EH1 1AA',
      localAuthority: 'City of Edinburgh Council',
    },
  });

  const project = await prisma.project.create({
    data: {
      organisationId: organisation.id,
      clientId: organisation.clients[0]?.id,
      siteId: site.id,
      name: 'North Lane Extension',
      internalReference: 'A-001',
      projectType: 'Domestic extension',
      stage: 'PLANNING',
      localAuthority: 'City of Edinburgh Council',
      siteAddress: '24 North Lane, Edinburgh, EH1 1AA',
      notes: 'Demo project seeded for local evaluation.',
    },
  });

  await prisma.planningApplication.create({
    data: {
      organisationId: organisation.id,
      projectId: project.id,
      status: 'DRAFTING',
      decisionTargetDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 42),
      notes: 'Prepare drawings and supporting statement.',
    },
  });

  await prisma.deadline.create({
    data: {
      organisationId: organisation.id,
      projectId: project.id,
      title: 'Issue planning drawing set',
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      type: 'INTERNAL_TASK',
      status: 'DUE_SOON',
      priority: 'HIGH',
    },
  });

  await Promise.all([
    prisma.calendarConnection.upsert({
      where: { organisationId_provider: { organisationId: organisation.id, provider: 'GOOGLE' } },
      update: {},
      create: { organisationId: organisation.id, provider: 'GOOGLE' },
    }),
    prisma.calendarConnection.upsert({
      where: { organisationId_provider: { organisationId: organisation.id, provider: 'OUTLOOK' } },
      update: {},
      create: { organisationId: organisation.id, provider: 'OUTLOOK' },
    }),
  ]);

  console.info(`Seeded demo user ${email} / ${process.env.DEMO_USER_PASSWORD || 'ChangeMe123!'}`);
}

main()
  .finally(async () => prisma.$disconnect());
