import { createHash } from 'node:crypto';
import type { OrganisationCertifierPreset, Prisma, PrismaClient } from '@prisma/client';

export type CertifierProfileDetails = {
  schemeType?: string | null;
  registrationAPart1: string;
  registrationAPart2: string;
  certifierName: string;
  registrationBPart1: string;
  registrationBPart2: string;
  approvedBody: string;
};

type CertifierPresetClient = PrismaClient | Prisma.TransactionClient;

const normalise = (value: string | null | undefined) =>
  String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');

export const certifierProfileKey = (details: CertifierProfileDetails) => [
  details.schemeType,
  details.registrationAPart1,
  details.registrationAPart2,
  details.certifierName,
  details.registrationBPart1,
  details.registrationBPart2,
  details.approvedBody,
].map(normalise).join('|');

const matchesDetails = (preset: OrganisationCertifierPreset, details: CertifierProfileDetails) =>
  certifierProfileKey(preset as CertifierProfileDetails) === certifierProfileKey(details);

export const findOrCreateCertifierProfile = async (
  db: CertifierPresetClient,
  organisationId: string,
  details: CertifierProfileDetails,
) => {
  const presets = await db.organisationCertifierPreset.findMany({ where: { organisationId } });
  const existing = presets.find((preset) => matchesDetails(preset, details));
  if (existing) return existing;

  const baseDisplayName = `${details.certifierName} (${details.registrationAPart1}${details.registrationAPart2})`;
  const occupied = presets.some((preset) => normalise(preset.displayName) === normalise(baseDisplayName));
  const suffix = createHash('sha256').update(certifierProfileKey(details)).digest('hex').slice(0, 6);
  const displayName = occupied ? `${baseDisplayName} - ${suffix}` : baseDisplayName;

  try {
    return await db.organisationCertifierPreset.create({
      data: {
        organisationId,
        displayName,
        schemeType: details.schemeType ?? null,
        registrationAPart1: details.registrationAPart1,
        registrationAPart2: details.registrationAPart2,
        certifierName: details.certifierName,
        registrationBPart1: details.registrationBPart1,
        registrationBPart2: details.registrationBPart2,
        approvedBody: details.approvedBody,
      },
    });
  } catch (error) {
    const concurrent = await db.organisationCertifierPreset.findFirst({
      where: { organisationId, displayName },
    });
    if (concurrent && matchesDetails(concurrent, details)) return concurrent;
    throw error;
  }
};
