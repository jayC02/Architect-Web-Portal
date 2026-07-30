import type { Client, Project, Site } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { PreparedApplicationDraft } from '@/lib/validation/application-draft';

type MatchStrength = 'strong' | 'possible';

type MatchResult = {
  strength: MatchStrength;
  score: number;
  reasons: string[];
};

type ClientShape = Pick<
  Client,
  | 'id'
  | 'name'
  | 'email'
  | 'phone'
  | 'companyName'
  | 'firstName'
  | 'lastName'
  | 'address'
  | 'addressLine1'
  | 'townCity'
  | 'postcode'
>;

type SiteShape = Pick<Site, 'id' | 'addressLine1' | 'addressLine2' | 'townCity' | 'postcode'>;

type ProjectShape = Pick<Project, 'id' | 'name' | 'internalReference' | 'projectType' | 'siteId' | 'siteAddress'> & {
  site: SiteShape | null;
};

export type DraftMatchValues = {
  client: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    addressLine1?: string | null;
    townCity?: string | null;
    postcode?: string | null;
  };
  site: {
    addressLine1?: string | null;
    townCity?: string | null;
    postcode?: string | null;
  };
  project: {
    name?: string | null;
    internalReference?: string | null;
    typeOfWorkKey?: string | null;
  };
};

const normalizeText = (value: string | null | undefined) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeCompact = (value: string | null | undefined) => normalizeText(value).replace(/\s+/g, '');
const normalizeAddress = (value: string | null | undefined) =>
  normalizeText(value)
    .split(' ')
    .map((part) => ({
      avenue: 'ave',
      crescent: 'cres',
      court: 'ct',
      drive: 'dr',
      lane: 'ln',
      place: 'pl',
      road: 'rd',
      street: 'st',
      terrace: 'ter',
    })[part] ?? part)
    .join(' ');
const normalizeEmail = (value: string | null | undefined) => String(value ?? '').trim().toLowerCase();
const normalizePhone = (value: string | null | undefined) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('44') && digits.length > 10) return `0${digits.slice(2)}`;
  return digits;
};

const same = (left: string | null | undefined, right: string | null | undefined) => {
  const first = normalizeText(left);
  const second = normalizeText(right);
  return Boolean(first && second && first === second);
};

const fullClientName = (value: Pick<ClientShape, 'firstName' | 'lastName' | 'name'>) =>
  normalizeText([value.firstName, value.lastName].filter(Boolean).join(' ')) || normalizeText(value.name);

const inputClientName = (value: DraftMatchValues['client']) =>
  normalizeText([value.firstName, value.lastName].filter(Boolean).join(' '))
  || normalizeText(value.companyName)
  || normalizeText(value.name);

export const scoreClientMatch = (candidate: ClientShape, input: DraftMatchValues['client']): MatchResult | null => {
  let score = 0;
  const reasons: string[] = [];

  if (normalizeEmail(input.email) && normalizeEmail(input.email) === normalizeEmail(candidate.email)) {
    score += 100;
    reasons.push('Email address matches exactly');
  }
  if (normalizePhone(input.phone) && normalizePhone(input.phone) === normalizePhone(candidate.phone)) {
    score += 70;
    reasons.push('Phone number matches');
  }
  if (same(input.companyName, candidate.companyName) || same(input.companyName, candidate.name)) {
    score += 60;
    reasons.push('Company name matches');
  }

  const inputName = inputClientName(input);
  const candidateName = fullClientName(candidate);
  if (inputName && candidateName && inputName === candidateName) {
    score += 45;
    reasons.push('Full name matches');
  }
  if (same(input.postcode, candidate.postcode)) {
    score += 25;
    reasons.push('Postcode matches');
  }
  if (
    (
      normalizeAddress(input.addressLine1)
      && normalizeAddress(input.addressLine1) === normalizeAddress(candidate.addressLine1)
    )
    || (
      normalizeAddress(input.addressLine1)
      && normalizeAddress(input.addressLine1) === normalizeAddress(candidate.address)
    )
  ) {
    score += 35;
    reasons.push('Address matches');
  }

  if (score >= 80) return { strength: 'strong', score, reasons };
  if (score >= 45) return { strength: 'possible', score, reasons };
  return null;
};

export const scoreSiteMatch = (candidate: SiteShape, input: DraftMatchValues['site']): MatchResult | null => {
  let score = 0;
  const reasons: string[] = [];
  if (normalizeCompact(input.postcode) && normalizeCompact(input.postcode) === normalizeCompact(candidate.postcode)) {
    score += 50;
    reasons.push('Postcode matches');
  }
  if (
    normalizeAddress(input.addressLine1)
    && normalizeAddress(input.addressLine1) === normalizeAddress(candidate.addressLine1)
  ) {
    score += 50;
    reasons.push('Address line matches');
  }
  if (same(input.townCity, candidate.townCity)) {
    score += 10;
    reasons.push('Town or city matches');
  }
  if (score >= 90) return { strength: 'strong', score, reasons };
  if (score >= 50) return { strength: 'possible', score, reasons };
  return null;
};

export const scoreProjectMatch = (candidate: ProjectShape, input: DraftMatchValues): MatchResult | null => {
  let score = 0;
  const reasons: string[] = [];
  if (
    normalizeCompact(input.project.internalReference)
    && normalizeCompact(input.project.internalReference) === normalizeCompact(candidate.internalReference)
  ) {
    score += 100;
    reasons.push('Internal reference matches exactly');
  }
  if (same(input.project.name, candidate.name)) {
    score += 50;
    reasons.push('Project name matches');
  }
  const candidateAddress = candidate.site?.addressLine1 ?? candidate.siteAddress;
  if (
    normalizeAddress(input.site.addressLine1)
    && normalizeAddress(input.site.addressLine1) === normalizeAddress(candidateAddress)
  ) {
    score += 35;
    reasons.push('Site address matches');
  }
  if (
    normalizeCompact(input.site.postcode)
    && normalizeCompact(input.site.postcode) === normalizeCompact(candidate.site?.postcode)
  ) {
    score += 25;
    reasons.push('Site postcode matches');
  }
  if (input.project.typeOfWorkKey && input.project.typeOfWorkKey === candidate.projectType) {
    score += 10;
    reasons.push('Type of work matches');
  }
  if (score >= 90) return { strength: 'strong', score, reasons };
  if (score >= 50) return { strength: 'possible', score, reasons };
  return null;
};

const suggestionValue = (section: PreparedApplicationDraft[keyof Pick<
  PreparedApplicationDraft,
  'project' | 'site' | 'client'
>], key: string) => {
  const value = section[key]?.value;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
};

export const matchValuesFromPreparation = (prepared: PreparedApplicationDraft): DraftMatchValues => ({
  client: {
    name: suggestionValue(prepared.client, 'name'),
    email: suggestionValue(prepared.client, 'email'),
    phone: suggestionValue(prepared.client, 'phone'),
    companyName: suggestionValue(prepared.client, 'companyName'),
    firstName: suggestionValue(prepared.client, 'firstName'),
    lastName: suggestionValue(prepared.client, 'lastName'),
    addressLine1: suggestionValue(prepared.client, 'addressLine1'),
    townCity: suggestionValue(prepared.client, 'townCity'),
    postcode: suggestionValue(prepared.client, 'postcode'),
  },
  site: {
    addressLine1: suggestionValue(prepared.site, 'addressLine1'),
    townCity: suggestionValue(prepared.site, 'townCity'),
    postcode: suggestionValue(prepared.site, 'postcode'),
  },
  project: {
    name: suggestionValue(prepared.project, 'name'),
    internalReference: suggestionValue(prepared.project, 'internalReference'),
    typeOfWorkKey: suggestionValue(prepared.project, 'typeOfWorkKey'),
  },
});

export const findApplicationDraftMatches = async (
  organisationId: string,
  values: DraftMatchValues,
) => {
  const [clients, sites, projects] = await Promise.all([
    prisma.client.findMany({
      where: { organisationId },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    prisma.site.findMany({
      where: { organisationId },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    prisma.project.findMany({
      where: { organisationId },
      include: { site: true },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
  ]);

  const rankedClients = clients
    .flatMap((record) => {
      const match = scoreClientMatch(record, values.client);
      return match ? [{ record, match }] : [];
    })
    .sort((left, right) => right.match.score - left.match.score)
    .slice(0, 20);
  const rankedSites = sites
    .flatMap((record) => {
      const match = scoreSiteMatch(record, values.site);
      return match ? [{ record, match }] : [];
    })
    .sort((left, right) => right.match.score - left.match.score)
    .slice(0, 20);
  const rankedProjects = projects
    .flatMap((record) => {
      const match = scoreProjectMatch(record, values);
      return match ? [{ record, match }] : [];
    })
    .sort((left, right) => right.match.score - left.match.score)
    .slice(0, 20);

  return {
    clients: rankedClients.map(({ record, match }) => ({
      id: record.id,
      strength: match.strength,
      label: record.name,
      detail: [record.email, record.phone, record.postcode].filter(Boolean).join(' · ') || undefined,
      reasons: match.reasons,
    })),
    sites: rankedSites.map(({ record, match }) => ({
      id: record.id,
      strength: match.strength,
      label: [record.addressLine1, record.townCity, record.postcode].filter(Boolean).join(', '),
      detail: record.addressLine2 ?? undefined,
      reasons: match.reasons,
    })),
    projects: rankedProjects.map(({ record, match }) => ({
      id: record.id,
      strength: match.strength,
      label: record.name,
      detail: [record.internalReference && `Ref ${record.internalReference}`, record.site?.addressLine1 ?? record.siteAddress]
        .filter(Boolean)
        .join(' · ') || undefined,
      reasons: match.reasons,
    })),
    strongClient: rankedClients.find(({ match }) => match.strength === 'strong')?.record ?? null,
    strongSite: rankedSites.find(({ match }) => match.strength === 'strong')?.record ?? null,
  };
};
