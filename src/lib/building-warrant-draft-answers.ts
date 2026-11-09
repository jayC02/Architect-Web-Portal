// Building Warrant answers collected in the New application review, and how they become the
// application's preparation data. The keys match the Building Warrant details page and its save
// route, so whatever the review collects appears already filled in on that page.
import { permitsSTAS } from '@/lib/building-warrant-branches';
import { FIXED_WARRANT_ANSWERS } from '@/lib/building-warrant-follow-ups';
import { OWNER_FIELDS } from '@/lib/building-warrant-owner';

type DraftValue = boolean | string | number | null | undefined;
type DraftConfirmations = Record<string, DraftValue>;

// The usual answers; must stay equal to BUILDING_WARRANT_CONFIRMATION_DEFAULTS (tested).
export const WARRANT_TICK_DEFAULTS = Object.freeze({
  applicantIsOwner: true,
  fireAndRescueServiceEnforcingAuthority: true,
  listedBuildingOrConservationArea: false,
  otherHistoricalImportance: false,
  scottishMinistersRelaxationDirection: false,
  dangerousBuildingNotice: false,
  coveredBySTAS: false,
  approvedCertifierOfConstruction: false,
  disabledPersonsFacilitiesOnly: false,
  certifierOfDesignCertificateAvailable: false,
  certifierOfConstructionCertificateAvailable: false,
});
export type WarrantTickKey = keyof typeof WARRANT_TICK_DEFAULTS;

export const warrantTick = (confirmations: DraftConfirmations, key: WarrantTickKey) => {
  const value = confirmations[key];
  return typeof value === 'boolean' ? value : WARRANT_TICK_DEFAULTS[key];
};

const draftText = (confirmations: DraftConfirmations, key: string, max: number) => {
  const value = confirmations[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
};

const ownerFormKey = (key: string) => `owner${key[0].toUpperCase()}${key.slice(1)}`;
export const OWNER_DRAFT_FIELDS = OWNER_FIELDS.map(([key, label, max]) => [key, ownerFormKey(key), label, max] as const);

export const buildingWarrantDraftAnswers = (
  confirmations: DraftConfirmations,
  screening: { buildingUse: unknown; typeOfWorkKeys: readonly string[] },
) => {
  const tick = (key: WarrantTickKey) => warrantTick(confirmations, key);
  const text = (key: string, max: number) => draftText(confirmations, key, max);
  const applicantIsOwner = tick('applicantIsOwner');
  const fire = tick('fireAndRescueServiceEnforcingAuthority');
  const listed = tick('listedBuildingOrConservationArea');
  const historical = tick('otherHistoricalImportance');
  const relaxation = tick('scottishMinistersRelaxationDirection');
  const dangerous = tick('dangerousBuildingNotice');
  const stas = permitsSTAS(screening.buildingUse, screening.typeOfWorkKeys) && tick('coveredBySTAS');
  const construction = tick('approvedCertifierOfConstruction');
  const designCertificate = tick('certifierOfDesignCertificateAvailable');
  const ownerIsClient = typeof confirmations.ownerIsClient === 'boolean' ? confirmations.ownerIsClient : null;
  const timing = confirmations.designCertificateTiming;
  const relaxationReference = relaxation ? text('relaxationReference', 750) : null;
  const relaxationDate = relaxation ? text('relaxationDate', 10) : null;
  return {
    applicantIsOwner,
    workStartedBeforeApplication: FIXED_WARRANT_ANSWERS.workStartedBeforeApplication,
    applicationIsStaged: FIXED_WARRANT_ANSWERS.applicationIsStaged,
    intendedLifeFiveYearsOrLess: FIXED_WARRANT_ANSWERS.intendedLifeFiveYearsOrLess,
    restrictPublicInspection: FIXED_WARRANT_ANSWERS.restrictPublicInspection,
    fireAndRescueServiceEnforcingAuthority: fire,
    listedBuildingOrConservationArea: listed,
    otherHistoricalImportance: historical,
    scottishMinistersRelaxationDirection: relaxation,
    dangerousBuildingNotice: dangerous,
    coveredBySTAS: stas,
    approvedCertifierOfConstruction: construction,
    disabledPersonsFacilitiesOnly: tick('disabledPersonsFacilitiesOnly'),
    certifierOfDesignCertificateAvailable: designCertificate,
    ...(designCertificate ? { designCertifierSelected: true } : {}),
    ...(designCertificate && (timing === 'with_application' || timing === 'following_application') ? {
      designCertificateWithApplication: timing === 'with_application',
      designCertificateFollowingApplication: timing === 'following_application',
    } : {}),
    certifierOfConstructionCertificateAvailable: construction && tick('certifierOfConstructionCertificateAvailable'),
    ...(construction ? {
      constructionCertificate: {
        schemeType: confirmations.constructionSchemeType === '1' || confirmations.constructionSchemeType === '2' ? confirmations.constructionSchemeType : undefined,
        certifierName: text('constructionCertifierName', 160) ?? undefined,
        registrationNumber: text('constructionRegistrationNumber', 80) ?? undefined,
        approvedBody: text('constructionApprovedBody', 160) ?? undefined,
        approvedBodyRegistrationNumber: text('constructionApprovedBodyRegistrationNumber', 80) ?? undefined,
        workTypeDetails: text('constructionWorkTypeDetails', 750) ?? undefined,
      },
    } : {}),
    fireAuthorityName: fire ? null : text('fireAuthorityName', 20),
    listingCategory: listed ? text('listingCategory', 750) : null,
    historicalBuildingDetails: historical ? text('historicalBuildingDetails', 750) : null,
    dangerousBuildingReferences: dangerous ? text('dangerousBuildingReferences', 750) : null,
    relaxationReference,
    relaxationDate,
    ...(relaxationReference || relaxationDate ? { relaxationDirections: [{ reference: relaxationReference ?? '', date: relaxationDate ?? '' }] } : {}),
    stasReference: stas ? text('stasReference', 20) : null,
    ownerIsClient: applicantIsOwner ? null : ownerIsClient,
    ownerDetails: !applicantIsOwner && ownerIsClient === false
      ? {
        ...Object.fromEntries(OWNER_DRAFT_FIELDS.map(([key, formKey, , max]) => [key, text(formKey, max) ?? undefined]).filter(([, value]) => value !== undefined)),
        country: text('ownerCountry', 100) ?? 'United Kingdom',
      }
      : {},
  };
};
