import { z } from 'zod';

export const OWNER_FIELDS = [
  ['title', 'Title', 40], ['otherTitle', 'Other title', 40], ['firstName', 'First name', 100],
  ['lastName', 'Last name', 100], ['company', 'Company / organisation', 160], ['telephone', 'Telephone number', 40],
  ['extension', 'Extension number', 20], ['mobile', 'Mobile number', 40], ['fax', 'Fax number', 40],
  ['email', 'Email address', 160], ['buildingName', 'Building name', 160], ['buildingNumber', 'Building number', 40],
  ['addressLine1', 'Address 1 (street)', 160], ['addressLine2', 'Address 2', 160], ['townCity', 'Town / city', 100],
  ['country', 'Country', 100], ['postcode', 'Postcode', 20],
] as const;
export const ownerDetailsSchema = z.object(Object.fromEntries(OWNER_FIELDS.map(([key, , max]) => [key, z.string().trim().max(max).optional()]))) as z.ZodObject<Record<(typeof OWNER_FIELDS)[number][0], z.ZodOptional<z.ZodString>>>;
export type WarrantOwnerDetails = z.infer<typeof ownerDetailsSchema>;
const optionalText = (max: number) => z.preprocess(value => value === '' || value == null ? undefined : value, z.string().trim().max(max).optional());
export const ownerFormFields = {
  ownerIsClient: z.preprocess(value => value === '' || value == null ? undefined : value === 'true' ? true : value === 'false' ? false : value, z.boolean().optional()),
  ownerTitle: optionalText(40), ownerOtherTitle: optionalText(40), ownerFirstName: optionalText(100), ownerLastName: optionalText(100),
  ownerCompany: optionalText(160), ownerTelephone: optionalText(40), ownerExtension: optionalText(20), ownerMobile: optionalText(40), ownerFax: optionalText(40),
  ownerEmail: z.preprocess(value => value === '' || value == null ? undefined : value, z.string().trim().email().max(160).optional()),
  ownerBuildingName: optionalText(160), ownerBuildingNumber: optionalText(40), ownerAddressLine1: optionalText(160), ownerAddressLine2: optionalText(160),
  ownerTownCity: optionalText(100), ownerCountry: optionalText(100), ownerPostcode: optionalText(20),
};
export const ownerFromForm = (form: Record<string, unknown>) => ownerDetailsSchema.parse(Object.fromEntries(OWNER_FIELDS.map(([key]) => [key, form[`owner${key[0].toUpperCase()}${key.slice(1)}`]])));

export const resolveWarrantOwner = (preparation: Record<string, unknown>, client: Record<string, unknown> | null | undefined) => {
  if (preparation.ownerIsClient === true && client) {
    const text = (key: string) => typeof client[key] === 'string' ? client[key] as string : undefined;
    return { ...ownerDetailsSchema.parse({ title: text('title'), firstName: text('firstName'), lastName: text('lastName'),
      company: text('companyName'), telephone: text('phone'), email: text('email'), buildingNumber: text('buildingNumber'),
      addressLine1: text('addressLine1') ?? text('address'), addressLine2: text('addressLine2'), townCity: text('townCity'),
      postcode: text('postcode'), country: text('country') ?? 'United Kingdom' }), source: 'CLIENT' as const };
  }
  return preparation.ownerIsClient === false ? { ...ownerDetailsSchema.parse(preparation.ownerDetails ?? {}), source: 'MANUAL' as const } : null;
};

export const missingOwnerDetails = (owner: WarrantOwnerDetails | null | undefined) => {
  const missing: Array<{ field: string; message: string }> = [];
  for (const key of ['title', 'firstName', 'lastName', 'telephone', 'email', 'addressLine1', 'townCity', 'country', 'postcode'] as const) {
    if (!owner?.[key]?.trim()) missing.push({ field: `buildingWarrant.owner.${key}`, message: `Complete the property owner's ${OWNER_FIELDS.find(([field]) => field === key)![1].toLowerCase()}.` });
  }
  if (!owner?.buildingName?.trim() && !owner?.buildingNumber?.trim()) missing.push({ field: 'buildingWarrant.owner.buildingNumber', message: 'Enter a building name or number for the property owner.' });
  if (owner?.title?.toLowerCase() === 'other' && !owner.otherTitle?.trim()) missing.push({ field: 'buildingWarrant.owner.otherTitle', message: "Enter the property owner's actual title." });
  return missing;
};
