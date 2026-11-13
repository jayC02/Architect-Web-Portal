import { z } from 'zod';
import { CERTIFIER_REGISTRATION_PART1_CODES } from '@/lib/certifier-registration';
import {
  MAX_COMPLETION_DOCUMENTS,
  completionDocumentSchema,
  type CompletionDocument,
} from '@/lib/completion-documents';

// Completion Certificate (eBuilding Standards) — Main Details preparation.
//
// Follow-ups not yet supported, and therefore fixed below: a relevant person
// who is not the owner, an organisation as relevant person, a building address
// that differs from the warrant, and partial completion of the warrant work.
export const COMPLETION_FIXED_ANSWERS = {
  warrantObtained: true,
  dangerousBuildingNotice: false,
  actingAs: 'AGENT',
  useAccountDetails: true,
  relevantPersonType: 'INDIVIDUAL',
  relevantPersonIsOwner: true,
  differentBuildingAddress: false,
  coversAllWork: true,
} as const;

export const COMPLETION_TEXT_LIMIT = 750;
export const MAX_CERTIFICATE_ENTRIES = 20;

// Registration options exactly as the portal's certificate registers offer them.
export const CONSTRUCTION_REGISTRATION_PART1_CODES = ['NIC1', 'SEL1', 'SNP1'] as const;
export const DESIGN_REGISTRATION_PART1_CODES = CERTIFIER_REGISTRATION_PART1_CODES;
export const REGISTER_PART2 = {
  construction: { certifier: 'C', approvedBody: 'CB' },
  design: { certifier: 'D', approvedBody: 'DB' },
} as const;

export type CertificateRegister = keyof typeof REGISTER_PART2;

export const registerPart1Codes = (register: CertificateRegister): readonly string[] =>
  register === 'construction' ? CONSTRUCTION_REGISTRATION_PART1_CODES : DESIGN_REGISTRATION_PART1_CODES;

const isRealIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** ISO `yyyy-mm-dd` to the portal's `dd/mm/yyyy`. */
export const formatPortalDate = (iso: string) => {
  if (!isRealIsoDate(iso)) throw new Error(`Invalid date: ${iso}`);
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};

const blankToNull = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '') ? null : value;

const isoDate = z.string().refine(isRealIsoDate, 'Enter a valid date.');
const nullableDate = z.preprocess(blankToNull, isoDate.nullable());
const nullableBoolean = z.preprocess((value) => (value === undefined ? null : value), z.boolean().nullable());
const nullableText = (limit: number) => z.preprocess(blankToNull, z.string().max(limit).nullable());
const shortText = (limit: number) =>
  z.preprocess((value) => (value === undefined || value === null ? '' : value), z.string().trim().max(limit));

const draftRegistrationSchema = z.object({ part1: shortText(10), part2: shortText(4), number: shortText(40) });

/** A saved entry may be incomplete; `completionIssues` reports what is missing. */
const draftCertificateEntrySchema = z.object({
  certificateNumber: shortText(80),
  certifierRegistration: draftRegistrationSchema,
  certifierSignatureDate: nullableDate,
  approvedBodyRegistration: draftRegistrationSchema,
  approvedBodySignatureDate: nullableDate,
  documentId: z.preprocess(blankToNull, z.string().max(120).nullable()),
});

/** A complete entry, as sent to the Agent. */
export const certificateEntrySchema = (register: CertificateRegister) => {
  const part1 = z.string().refine((value) => registerPart1Codes(register).includes(value), 'Choose a registration prefix.');
  return z.object({
    certificateNumber: z.string().trim().min(1).max(80),
    certifierRegistration: z.object({
      part1, part2: z.literal(REGISTER_PART2[register].certifier), number: z.string().trim().min(1).max(40),
    }),
    certifierSignatureDate: isoDate,
    approvedBodyRegistration: z.object({
      part1, part2: z.literal(REGISTER_PART2[register].approvedBody), number: z.string().trim().min(1).max(40),
    }),
    approvedBodySignatureDate: isoDate,
    documentId: z.string().max(120).nullable(),
  });
};

const entryList = z.preprocess(
  (value) => (Array.isArray(value) ? value : []),
  z.array(draftCertificateEntrySchema).max(MAX_CERTIFICATE_ENTRIES),
);
const objectOrEmpty = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export const completionPreparationSchema = z.object({
  workCompletedDate: nullableDate,
  warrantReference: nullableText(120),
  warrantDate: nullableDate,
  amendmentDates: nullableText(COMPLETION_TEXT_LIMIT),
  relaxation: z.preprocess(objectOrEmpty, z.object({
    applies: nullableBoolean, reference: nullableText(200), date: nullableDate,
  })),
  constructionCertificates: z.preprocess(objectOrEmpty, z.object({ accompany: nullableBoolean, entries: entryList })),
  designCertificates: z.preprocess(objectOrEmpty, z.object({
    accompaniedWarrant: nullableBoolean, formQRequired: nullableBoolean, entries: entryList,
  })),
  energyPerformanceCertificate: nullableBoolean,
  sustainabilityStatement: nullableBoolean,
  fireSafetyDesignSummary: nullableBoolean,
  continuingRequirements: z.preprocess(objectOrEmpty, z.object({
    applies: nullableBoolean, details: nullableText(COMPLETION_TEXT_LIMIT),
  })),
  confirmedAt: z.preprocess(blankToNull, z.string().datetime().nullable()),
  // Uploaded completion documents. They decide the EPC, sustainability, fire
  // safety and certificate answers: nothing uploaded means No.
  documents: z.preprocess(
    (value) => (Array.isArray(value) ? value : []),
    z.array(completionDocumentSchema).max(MAX_COMPLETION_DOCUMENTS),
  ),
});

export type CompletionPreparation = z.infer<typeof completionPreparationSchema>;
export type CompletionCertificateEntry = CompletionPreparation['constructionCertificates']['entries'][number];

export const emptyCompletionPreparation = (): CompletionPreparation => completionPreparationSchema.parse({});

export const emptyCertificateEntry = (register: CertificateRegister): CompletionCertificateEntry => ({
  certificateNumber: '',
  certifierRegistration: { part1: '', part2: REGISTER_PART2[register].certifier, number: '' },
  certifierSignatureDate: null,
  approvedBodyRegistration: { part1: '', part2: REGISTER_PART2[register].approvedBody, number: '' },
  approvedBodySignatureDate: null,
  documentId: null,
});

export type CompletionPrefillSource = {
  warrantReference: string | null;
  grantedDate: Date | null;
  amendmentGrantedDates: Date[];
  warrantPreparation: Record<string, unknown>;
  certifier: {
    registrationAPart1?: string | null;
    registrationAPart2?: string | null;
    registrationBPart1?: string | null;
    registrationBPart2?: string | null;
  } | null;
};

const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const booleanOrNull = (value: unknown) => (typeof value === 'boolean' ? value : null);
const validDate = (value: unknown) => (typeof value === 'string' && isRealIsoDate(value) ? value : null);

/** Starting values taken from the warrant. Never invents a completion date. */
export const completionPrefill = (source: CompletionPrefillSource): CompletionPreparation => {
  const preparation = emptyCompletionPreparation();
  const warrant = source.warrantPreparation;
  preparation.warrantReference = text(source.warrantReference);
  preparation.warrantDate = source.grantedDate ? isoDay(source.grantedDate) : null;
  preparation.amendmentDates = source.amendmentGrantedDates.length
    ? source.amendmentGrantedDates.map((date) => formatPortalDate(isoDay(date))).join('\n')
    : null;

  const directions = Array.isArray(warrant.relaxationDirections) ? warrant.relaxationDirections : [];
  const firstDirection = directions.find((row) => row && typeof row === 'object') as Record<string, unknown> | undefined;
  const relaxationApplies = booleanOrNull(warrant.scottishMinistersRelaxationDirection);
  preparation.relaxation = {
    applies: relaxationApplies,
    reference: relaxationApplies ? text(firstDirection?.reference) ?? text(warrant.relaxationReference) : null,
    date: relaxationApplies ? validDate(firstDirection?.date) ?? validDate(warrant.relaxationDate) : null,
  };

  preparation.constructionCertificates.accompany = booleanOrNull(warrant.approvedCertifierOfConstruction);
  preparation.designCertificates.accompaniedWarrant = booleanOrNull(warrant.designCertifierSelected);
  const certifier = source.certifier;
  if (preparation.designCertificates.accompaniedWarrant && certifier
    && (text(certifier.registrationAPart1) || text(certifier.registrationBPart1))) {
    const designCode = (value: unknown) => {
      const code = text(value);
      return code && registerPart1Codes('design').includes(code) ? code : '';
    };
    preparation.designCertificates.entries = [{
      ...emptyCertificateEntry('design'),
      certifierRegistration: {
        part1: designCode(certifier.registrationAPart1), part2: REGISTER_PART2.design.certifier,
        number: text(certifier.registrationAPart2) ?? '',
      },
      approvedBodyRegistration: {
        part1: designCode(certifier.registrationBPart1), part2: REGISTER_PART2.design.approvedBody,
        number: text(certifier.registrationBPart2) ?? '',
      },
    }];
  }
  return preparation;
};

/** A saved answer wins; prefill only fills what has not been answered. */
export const mergeCompletionPreparation = (saved: unknown, prefill: CompletionPreparation): CompletionPreparation => {
  const parsed = completionPreparationSchema.safeParse(objectOrEmpty(saved));
  if (!parsed.success) return prefill;
  const stored = parsed.data;
  const pick = <T,>(value: T | null, fallback: T | null) => (value === null ? fallback : value);
  return {
    workCompletedDate: stored.workCompletedDate,
    warrantReference: pick(stored.warrantReference, prefill.warrantReference),
    warrantDate: pick(stored.warrantDate, prefill.warrantDate),
    amendmentDates: pick(stored.amendmentDates, prefill.amendmentDates),
    relaxation: stored.relaxation.applies === null ? prefill.relaxation : stored.relaxation,
    constructionCertificates: {
      accompany: pick(stored.constructionCertificates.accompany, prefill.constructionCertificates.accompany),
      entries: stored.constructionCertificates.entries.length
        ? stored.constructionCertificates.entries : prefill.constructionCertificates.entries,
    },
    designCertificates: {
      accompaniedWarrant: pick(stored.designCertificates.accompaniedWarrant, prefill.designCertificates.accompaniedWarrant),
      formQRequired: pick(stored.designCertificates.formQRequired, prefill.designCertificates.formQRequired),
      entries: stored.designCertificates.entries.length
        ? stored.designCertificates.entries : prefill.designCertificates.entries,
    },
    energyPerformanceCertificate: pick(stored.energyPerformanceCertificate, prefill.energyPerformanceCertificate),
    sustainabilityStatement: pick(stored.sustainabilityStatement, prefill.sustainabilityStatement),
    fireSafetyDesignSummary: pick(stored.fireSafetyDesignSummary, prefill.fireSafetyDesignSummary),
    continuingRequirements: stored.continuingRequirements.applies === null
      ? prefill.continuingRequirements : stored.continuingRequirements,
    confirmedAt: stored.confirmedAt,
    documents: stored.documents,
  };
};

/** One entry per uploaded certificate: kept if already edited, otherwise from what was read off it. */
const entriesForDocuments = (
  register: CertificateRegister,
  documents: CompletionDocument[],
  existing: CompletionCertificateEntry[],
): CompletionCertificateEntry[] => documents.map((document) => {
  const kept = existing.find((entry) => entry.documentId === document.documentId);
  if (kept) return kept;
  const read = document.details.certificate;
  const blankEntry = emptyCertificateEntry(register);
  return read ? {
    ...blankEntry,
    certificateNumber: read.certificateNumber,
    certifierRegistration: { ...read.certifierRegistration, part2: REGISTER_PART2[register].certifier },
    certifierSignatureDate: read.certifierSignatureDate,
    approvedBodyRegistration: { ...read.approvedBodyRegistration, part2: REGISTER_PART2[register].approvedBody },
    approvedBodySignatureDate: read.approvedBodySignatureDate,
    documentId: document.documentId,
  } : { ...blankEntry, documentId: document.documentId };
});

/**
 * Make the document-driven answers agree with the uploads. If the architect
 * has not attached an EPC, statement of sustainability, Fire Safety Design
 * Summary or certificate, the matching answer is No.
 */
export const applyCompletionDocuments = (preparation: CompletionPreparation): CompletionPreparation => {
  const documents = preparation.documents ?? [];
  const withRole = (role: CompletionDocument['role']) => documents.filter((document) => document.role === role);
  const constructionDocuments = withRole('CONSTRUCTION_CERTIFICATE');
  const designDocuments = withRole('DESIGN_CERTIFICATE');
  const accompaniedWarrant = preparation.designCertificates.accompaniedWarrant;
  return {
    ...preparation,
    documents,
    energyPerformanceCertificate: withRole('ENERGY_PERFORMANCE_CERTIFICATE').length > 0,
    sustainabilityStatement: withRole('SUSTAINABILITY_STATEMENT').length > 0,
    fireSafetyDesignSummary: withRole('FIRE_SAFETY_DESIGN_SUMMARY').length > 0,
    constructionCertificates: {
      accompany: constructionDocuments.length > 0,
      entries: entriesForDocuments('construction', constructionDocuments, preparation.constructionCertificates.entries),
    },
    designCertificates: accompaniedWarrant
      ? {
          accompaniedWarrant,
          formQRequired: designDocuments.length > 0,
          entries: entriesForDocuments('design', designDocuments, preparation.designCertificates.entries),
        }
      : { accompaniedWarrant, formQRequired: null, entries: [] },
  };
};

type PartyText = string | null;
export type CompletionParties = {
  client: {
    title: PartyText; firstName: PartyText; lastName: PartyText; buildingNumber: PartyText;
    addressLine1: PartyText; townCity: PartyText; postcode: PartyText; country: PartyText;
  } | null;
  agent: {
    firstName: PartyText; lastName: PartyText; email: PartyText; phone: PartyText; buildingNumber: PartyText;
    addressLine1: PartyText; townCity: PartyText; postcode: PartyText; country: PartyText;
  };
};

export type CompletionIssue = { field: string; message: string };

// The portal marks the postcode as required for these country spellings only.
const UK_COUNTRIES = new Set(['uk', 'u.k', 'u.k.', 'united kingdom', 'scotland', 'england', 'wales',
  'northern ireland', 'britain', 'great britain', 'gb']);
const isUkCountry = (country: PartyText) => UK_COUNTRIES.has((country ?? 'United Kingdom').trim().toLowerCase());
const blank = (value: PartyText | undefined) => !value || !value.trim();

/** Everything that must be fixed before the job can be sent to the Agent. */
export const completionIssues = (
  submitted: CompletionPreparation,
  parties: CompletionParties,
  today: Date = new Date(),
): CompletionIssue[] => {
  const preparation = applyCompletionDocuments(submitted);
  const issues: CompletionIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const todayIso = isoDay(today);
  const pastDate = (field: string, value: string | null, label: string) => {
    if (!value) add(field, `Enter ${label}.`);
    else if (value > todayIso) add(field, `${label[0].toUpperCase()}${label.slice(1)} cannot be in the future.`);
  };

  pastDate('workCompletedDate', preparation.workCompletedDate, 'the date the work was completed');
  if (blank(preparation.warrantReference)) add('warrantReference', 'Enter the building warrant reference number.');
  pastDate('warrantDate', preparation.warrantDate, 'the date of the building warrant');

  const { relaxation } = preparation;
  if (relaxation.applies === null) add('relaxation.applies', 'Answer whether a relaxation direction was given.');
  if (relaxation.applies) {
    if (blank(relaxation.reference)) add('relaxation.reference', 'Enter the relaxation direction reference number.');
    if (!relaxation.date) add('relaxation.date', 'Enter the relaxation direction date.');
  }

  const checkEntries = (path: string, register: CertificateRegister, entries: CompletionCertificateEntry[], label: string) => {
    if (!entries.length) {
      add(`${path}.entries`, `Add at least one ${label}.`);
      return;
    }
    const schema = certificateEntrySchema(register);
    entries.forEach((entry, index) => {
      if (!schema.safeParse(entry).success) {
        add(`${path}.entries.${index}`, `Complete every field of ${label} ${index + 1}.`);
      }
    });
  };

  const construction = preparation.constructionCertificates;
  if (construction.accompany === null) {
    add('constructionCertificates.accompany', 'Answer whether certificates of construction accompany this submission.');
  }
  if (construction.accompany) {
    checkEntries('constructionCertificates', 'construction', construction.entries, 'certificate of construction');
  }

  const design = preparation.designCertificates;
  if (design.accompaniedWarrant === null) {
    add('designCertificates.accompaniedWarrant', 'Answer whether certificates of design accompanied the warrant application.');
  }
  if (design.accompaniedWarrant) {
    if (design.formQRequired === null) {
      add('designCertificates.formQRequired', 'Answer whether a Notice of Finalisation of Design Details (Form Q) is required.');
    }
    if (design.formQRequired) checkEntries('designCertificates', 'design', design.entries, 'Form Q certificate');
  }

  for (const document of preparation.documents) {
    if (document.role === 'UNRECOGNISED') {
      add(`documents.${document.documentId}`, `Choose what ${document.filename} is, or remove it.`);
    }
  }
  const continuing = preparation.continuingRequirements;
  if (continuing.applies === null) add('continuingRequirements.applies', 'Answer whether the warrant has continuing requirements.');
  if (continuing.applies && blank(continuing.details)) {
    add('continuingRequirements.details', 'List the continuing requirements in full.');
  }

  const { client, agent } = parties;
  if (!client) {
    add('client', 'Client record: link a client to this project. The client is the relevant person.');
  } else {
    const need = (field: keyof NonNullable<CompletionParties['client']>, label: string) => {
      if (blank(client[field])) add(`client.${field}`, `Client record: add the ${label}.`);
    };
    need('title', 'title');
    need('firstName', 'first name');
    need('lastName', 'last name');
    need('buildingNumber', 'building number');
    need('addressLine1', 'street address');
    need('townCity', 'town or city');
    if (isUkCountry(client.country)) need('postcode', 'postcode');
  }
  const needAgent = (field: keyof CompletionParties['agent'], label: string) => {
    if (blank(agent[field])) add(`agent.${field}`, `Organisation settings: add the agent ${label}.`);
  };
  needAgent('firstName', 'first name');
  needAgent('lastName', 'last name');
  needAgent('email', 'email address');
  needAgent('phone', 'telephone number');
  needAgent('buildingNumber', 'building number');
  needAgent('addressLine1', 'street address');
  needAgent('townCity', 'town or city');
  if (isUkCountry(agent.country)) needAgent('postcode', 'postcode');

  return issues;
};
