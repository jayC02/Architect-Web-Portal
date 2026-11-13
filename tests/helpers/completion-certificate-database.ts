/** In-memory stand-in for the Prisma calls the completion certificate services make. */

const entry = (register: 'construction' | 'design') => ({
  certificateNumber: register === 'construction' ? 'CC-100' : 'FQ-200',
  certifierRegistration: { part1: register === 'construction' ? 'SEL1' : 'SER1', part2: register === 'construction' ? 'C' : 'D', number: '12345' },
  certifierSignatureDate: '2026-10-01',
  approvedBodyRegistration: { part1: register === 'construction' ? 'SEL1' : 'SER1', part2: register === 'construction' ? 'CB' : 'DB', number: '678' },
  approvedBodySignatureDate: '2026-10-02',
  documentId: register === 'construction' ? 'doc_cc' : 'doc_fq',
});

const completionDocument = (documentId: string, filename: string, role: string) =>
  ({ documentId, filename, role, source: 'ai', details: {} });

export const completePreparation = {
  workCompletedDate: '2026-10-30',
  warrantReference: '26/01234/WARR',
  warrantDate: '2026-03-05',
  amendmentDates: '01/06/2026',
  relaxation: { applies: true, reference: 'RD/1', date: '2026-02-01' },
  constructionCertificates: { accompany: true, entries: [entry('construction')] },
  designCertificates: { accompaniedWarrant: true, formQRequired: true, entries: [entry('design')] },
  energyPerformanceCertificate: true,
  sustainabilityStatement: false,
  fireSafetyDesignSummary: false,
  continuingRequirements: { applies: true, details: 'Maintain the fire door.' },
  confirmedAt: null,
  documents: [
    completionDocument('doc_bw', 'Building warrant.pdf', 'BUILDING_WARRANT'),
    completionDocument('doc_epc', 'EPC.pdf', 'ENERGY_PERFORMANCE_CERTIFICATE'),
    completionDocument('doc_cc', 'CC-100 signed.pdf', 'CONSTRUCTION_CERTIFICATE'),
    completionDocument('doc_fq', 'Form Q.pdf', 'DESIGN_CERTIFICATE'),
  ],
};

const storedDocument = (id: string, originalName: string, type: string) => ({
  id, organisationId: 'org', projectId: 'project', originalName, fileName: `${id}.pdf`, mimeType: 'application/pdf',
  sizeBytes: 1200, type, status: 'APPROVED', revision: null, drawingNumber: null, drawingTitle: null,
  sortSource: 'completion', sortConfidence: 0.9, createdAt: new Date('2026-11-05T09:00:00.000Z'),
  updatedAt: new Date('2026-11-05T09:00:00.000Z'),
});

type Options = {
  completionPreparationData?: unknown;
  client?: null;
  completionCertificateStatus?: string;
};

export const completionDatabase = (options: Options = {}) => {
  const client = options.client === null ? null : {
    id: 'client', organisationId: 'org', name: 'Sam Client', title: 'Mr', firstName: 'Sam', lastName: 'Client',
    companyName: null, email: 'sam@example.com', phone: '07000000002', address: null, buildingNumber: '112',
    addressLine1: 'Ralston Avenue', addressLine2: null, townCity: 'Glasgow', postcode: 'G52 3NB', country: 'United Kingdom',
    updatedAt: new Date('2026-11-01T09:00:00.000Z'),
  };
  const site = {
    id: 'site', organisationId: 'org', buildingNumber: '112', addressLine1: 'Ralston Avenue', addressLine2: null,
    townCity: 'Glasgow', postcode: 'G52 3NB', localAuthority: 'Glasgow City Council',
    updatedAt: new Date('2026-11-02T09:00:00.000Z'),
  };
  const project = {
    id: 'project', organisationId: 'org', name: '112 Ralston Avenue', internalReference: '3567',
    projectType: 'domestic_alteration_extension', buildingUse: 'residential', typeOfWorkKeys: ['domestic_alteration_extension'],
    notes: null, stage: 'CONSTRUCTION', status: 'ACTIVE', localAuthority: 'Glasgow City Council', siteAddress: null,
    updatedAt: new Date('2026-11-03T09:00:00.000Z'), client, site,
  };
  const state = {
    warrant: {
      id: 'warrant_1', organisationId: 'org', projectId: 'project', warrantReference: '26/01234/WARR',
      warrantType: 'INITIAL', grantedDate: new Date('2026-03-05T00:00:00.000Z'), status: 'GRANTED',
      completionCertificateStatus: options.completionCertificateStatus ?? 'NOT_STARTED',
      description: 'Rear extension', presetVersion: 1, selectedCertifierPresetId: null, selectedCertifierPreset: null,
      preparationData: {
        scottishMinistersRelaxationDirection: false, approvedCertifierOfConstruction: false, designCertifierSelected: false,
      } as Record<string, unknown>,
      completionPreparationData: (options.completionPreparationData ?? null) as unknown,
      completionPreparedAt: null as Date | null,
      updatedAt: new Date('2026-11-10T09:00:00.000Z'),
      project,
    },
    amendments: [
      { id: 'amendment_1', organisationId: 'org', projectId: 'project', warrantType: 'AMENDMENT', grantedDate: new Date('2026-06-01T00:00:00.000Z') },
      { id: 'amendment_2', organisationId: 'org', projectId: 'project', warrantType: 'AMENDMENT', grantedDate: null },
      { id: 'amendment_3', organisationId: 'org', projectId: 'another-project', warrantType: 'AMENDMENT', grantedDate: new Date('2026-07-01T00:00:00.000Z') },
    ],
    defaults: {
      organisationId: 'org', practiceName: 'Fixture Practice', agentFirstName: 'Alex', agentLastName: 'Agent',
      agentEmail: 'agent@example.com', agentPhone: '07000000001', agentBuildingNumber: '1',
      agentAddressLine1: 'Practice Street', agentAddressLine2: null, agentTownCity: 'Glasgow', agentPostcode: 'G1 1AA',
      agentCountry: 'United Kingdom', defaultCertifierPreset: null, updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    },
    documents: [
      { ...storedDocument('doc_1', 'Certificate of construction.pdf', 'CERTIFICATE') },
      storedDocument('doc_bw', 'Building warrant.pdf', 'CORRESPONDENCE'),
      storedDocument('doc_epc', 'EPC.pdf', 'ENERGY'),
      storedDocument('doc_cc', 'CC-100 signed.pdf', 'CERTIFICATE'),
      storedDocument('doc_fq', 'Form Q.pdf', 'CERTIFICATE'),
    ] as any[],
    jobs: [] as any[],
    events: [] as any[],
    actions: [] as any[],
  };

  const database: any = {
    buildingWarrantApplication: {
      findFirst: async ({ where }: any) =>
        where.id === state.warrant.id && where.organisationId === state.warrant.organisationId ? state.warrant : null,
      findMany: async ({ where }: any) => state.amendments
        .filter((row) => row.organisationId === where.organisationId && row.projectId === where.projectId
          && row.warrantType === 'AMENDMENT' && row.grantedDate)
        .sort((left, right) => left.grantedDate!.getTime() - right.grantedDate!.getTime()),
      update: async ({ where, data }: any) => {
        assert(where.id === state.warrant.id);
        Object.assign(state.warrant, data, { updatedAt: new Date('2026-11-11T10:00:00.000Z') });
        return state.warrant;
      },
    },
    organisationDefaults: {
      findUnique: async ({ where }: any) => (where.organisationId === 'org' ? state.defaults : null),
    },
    automationJob: {
      findMany: async ({ where }: any) => state.jobs.filter((job) => job.organisationId === where.organisationId
        && job.projectId === where.projectId && job.type === where.type
        && (!where.status?.in || where.status.in.includes(job.status))),
      create: async ({ data }: any) => {
        const job = { claimedAt: null, executionAuthorisedAt: null, updatedAt: data.createdAt, ...data };
        state.jobs.push(job);
        return job;
      },
    },
    $executeRaw: async () => 0,
    $transaction: async (work: (tx: unknown) => unknown) => work(database),
    projectDocument: {
      findMany: async ({ where }: any) => state.documents
        .filter((row) => row.organisationId === where.organisationId && row.projectId === where.projectId
          && (!where.id?.in || where.id.in.includes(row.id))),
      findFirst: async ({ where }: any) => state.documents.find((row) => row.id === where.id
        && row.organisationId === where.organisationId && (!where.projectId || row.projectId === where.projectId)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `doc_new_${state.documents.length}`, status: 'APPROVED', revision: null, drawingNumber: null,
          drawingTitle: null, sortSource: null, sortConfidence: null, createdAt: new Date('2026-11-13T09:00:00.000Z'),
          updatedAt: new Date('2026-11-13T09:00:00.000Z'), ...data };
        state.documents.push(row);
        return row;
      },
    },
  };
  return { database, state };
};

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error('Unexpected database call in test.');
}
