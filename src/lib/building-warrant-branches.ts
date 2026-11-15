import { z } from 'zod';

export const CONVERSION_DESCRIPTIONS = [
  ['C1', 'A building to create a dwelling or dwellings or a part thereof'],
  ['C2', 'A building ancillary to a dwelling to increase the area of human occupation'],
  ['C3', 'A building which alters the number of dwellings in a building'],
  ['C4', 'A domestic building to any other type of building'],
  ['C5', 'A residential building to any other type of building'],
  ['C6', 'A residential building involving a significant alteration of the characteristics of its occupants, or a significant increase in their number'],
  ['C7', 'A building so that it becomes a residential building'],
  ['C8', 'An exempt building to a building which is not so exempt'],
  ['C9', 'A building to allow access by the public where previously there was none'],
  ['C10', 'A building to accommodate parts in different occupation where previously it was not so occupied'],
] as const;
export const CONVERSION_KEYS = CONVERSION_DESCRIPTIONS.map(([key]) => key) as ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'];
const text = (limit: number) => z.string().trim().max(limit);
const optionalText = (limit: number) => z.preprocess(value => value === '' || value == null ? undefined : value, text(limit).optional());
export const constructionCertificateSchema = z.object({
  schemeType: z.enum(['1', '2']).optional(), certifierName: text(160).optional(), registrationNumber: text(80).optional(),
  approvedBody: text(160).optional(), approvedBodyRegistrationNumber: text(80).optional(), workTypeDetails: text(750).optional(),
});
const optionalDate = z.preprocess(value => value === '' || value == null ? undefined : value, z.string().date().optional());
// The design certificate supplied with the application: its number and the
// certifier's and approved body's signature dates (yyyy-mm-dd).
export const designCertificateSchema = z.object({
  certificateNumber: text(40).optional(), certifierSignatureDate: z.string().date().optional(), approvedBodySignatureDate: z.string().date().optional(),
});
export const designCertificateDetails = (number: string | null | undefined, certifierDate: string | null | undefined, approvedBodyDate: string | null | undefined) => ({
  certificateNumber: number ?? undefined, certifierSignatureDate: certifierDate ?? undefined, approvedBodySignatureDate: approvedBodyDate ?? undefined,
});
// The portal asks two Yes/No questions about when the certificates of design
// will be submitted. Only the first matters: "I will be uploading a
// certificate of design with this application" Yes opens the register asking
// for the certificate number and signature dates (whatever the second answer);
// No (the default) needs Yes to "I intend to submit a certificate of design
// following the submission of this application" and opens the register asking
// for names. So the architect answers the first and the second follows from it.
export const designCertificateTiming = (value: { designCertificateWithApplication?: unknown; designCertificateFollowingApplication?: unknown }) => {
  const withApplication = value.designCertificateWithApplication === true;
  return { designCertificateWithApplication: withApplication, designCertificateFollowingApplication: !withApplication };
};
// "Use a certifier of design?" Yes means the design certificate is provided: the
// Agent answers Yes in the portal and fills the certifier, and the fee discount
// applies. Warrants saved before that question existed keep their saved answer.
export const designCertificateProvided = (answers: { designCertifierSelected?: boolean | null; certifierOfDesignCertificateAvailable?: boolean | null }) =>
  typeof answers.designCertifierSelected === 'boolean' ? answers.designCertifierSelected : answers.certifierOfDesignCertificateAvailable === true;
export const warrantBranchSnapshotFields = {
  includesServices: z.boolean().optional(),
  relaxationDirections: z.array(z.object({ reference: text(750), date: z.union([z.string().date(), z.literal('')]) })).max(20).optional(),
  conversionDescriptions: z.array(z.enum(CONVERSION_KEYS)).max(10).optional(),
  demolitionWeeks: z.number().int().min(1).max(99).nullable().optional(),
  listingCategory: text(750).nullable().optional(), stasReference: text(20).nullable().optional(),
  constructionCertificate: constructionCertificateSchema.nullable().optional(),
  designCertificateWithApplication: z.boolean().optional(), designCertificateFollowingApplication: z.boolean().optional(),
  // Asked for by the portal's register when the certificate accompanies the application.
  designCertificate: designCertificateSchema.nullable().optional(),
};
const optionalBoolean = z.preprocess(value => value === '' || value == null ? undefined : value === 'true' || value === 'on' ? true : value === 'false' ? false : value, z.boolean().optional());
export const warrantBranchFormFields = {
  includesServices: z.preprocess(value => value === true || value === 'true' || value === 'on', z.boolean()),
  relaxationReferences: z.preprocess(value => value == null ? [] : Array.isArray(value) ? value : [value], z.array(text(750)).max(20)),
  relaxationDates: z.preprocess(value => value == null ? [] : Array.isArray(value) ? value : [value], z.array(z.union([z.string().date(), z.literal('')])).max(20)),
  declarationAuthorised: z.preprocess(value => value === true || value === 'true' || value === 'on', z.boolean()),
  conversionDescriptions: z.preprocess(value => value == null || value === '' ? [] : Array.isArray(value) ? value : [value], z.array(z.enum(CONVERSION_KEYS)).max(10).transform(values => [...new Set(values)])),
  demolitionWeeks: z.preprocess(value => value === '' || value == null ? undefined : value, z.coerce.number().int().min(1).max(99).optional()),
  listingCategory: optionalText(750), stasReference: optionalText(20),
  constructionSchemeType: z.preprocess(value => value === '' || value == null ? undefined : value, z.enum(['1', '2']).optional()),
  constructionCertifierName: optionalText(160), constructionRegistrationNumber: optionalText(80),
  constructionApprovedBody: optionalText(160), constructionApprovedBodyRegistrationNumber: optionalText(80), constructionWorkTypeDetails: optionalText(750),
  designCertifierSelected: optionalBoolean,
  // The portal's two Yes/No answers; designCertificateTiming is the older single choice.
  designCertificateWithApplication: optionalBoolean, designCertificateFollowingApplication: optionalBoolean,
  designCertificateTiming: z.preprocess(value => value === '' || value == null ? undefined : value, z.enum(['with_application', 'following_application']).optional()),
  designCertificateNumber: optionalText(40), designCertifierSignatureDate: optionalDate, designApprovedBodySignatureDate: optionalDate,
};
const branchForm = z.object(warrantBranchFormFields);
export const warrantBranchesFromForm = (value: z.infer<typeof branchForm>) => ({
  includesServices: value.includesServices,
  relaxationDirections: Array.from({ length: Math.max(value.relaxationReferences.length, value.relaxationDates.length) }, (_, index) => ({ reference: value.relaxationReferences[index] ?? '', date: value.relaxationDates[index] ?? '' })).filter(row => row.reference || row.date),
  conversionDescriptions: value.conversionDescriptions, demolitionWeeks: value.demolitionWeeks ?? null,
  listingCategory: value.listingCategory ?? null, stasReference: value.stasReference ?? null,
  constructionCertificate: {
    schemeType: value.constructionSchemeType, certifierName: value.constructionCertifierName,
    registrationNumber: value.constructionRegistrationNumber, approvedBody: value.constructionApprovedBody,
    approvedBodyRegistrationNumber: value.constructionApprovedBodyRegistrationNumber, workTypeDetails: value.constructionWorkTypeDetails,
  },
  ...designCertificateTimingFromForm(value),
});
type DesignCertificateAnswers = {
  designCertificateWithApplication?: boolean; designCertificateFollowingApplication?: boolean;
  designCertificate?: z.infer<typeof designCertificateSchema> | null;
};
const designCertificateTimingFromForm = (value: z.infer<typeof branchForm>): DesignCertificateAnswers => {
  const answered = value.designCertificateWithApplication !== undefined || value.designCertificateFollowingApplication !== undefined;
  if (!answered && !value.designCertificateTiming) return {};
  const timing = designCertificateTiming(answered ? value : {
    designCertificateWithApplication: value.designCertificateTiming === 'with_application',
    designCertificateFollowingApplication: value.designCertificateTiming === 'following_application',
  });
  return {
    ...timing,
    designCertificate: timing.designCertificateWithApplication
      ? designCertificateDetails(value.designCertificateNumber, value.designCertifierSignatureDate, value.designApprovedBodySignatureDate)
      : null,
  };
};
export const permitsSTAS = (buildingUse: unknown, workTypes: readonly string[]) => buildingUse === 'commercial' || workTypes.includes('new_build');
