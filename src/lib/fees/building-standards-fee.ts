export const BUILDING_STANDARDS_FEE_SCHEDULE_2026 = {
  version: 'BUILDING_STANDARDS_2026',
  effectiveFrom: '2026-04-01',
  bands: [
    [5_000, 215], [5_500, 237], [6_000, 259], [6_500, 281], [7_000, 303],
    [7_500, 325], [8_000, 347], [8_500, 369], [9_000, 391], [9_500, 413],
    [10_000, 435], [11_000, 461], [12_000, 487], [13_000, 513], [14_000, 539],
    [15_000, 565], [16_000, 591], [17_000, 617], [18_000, 643], [19_000, 669],
    [20_000, 695], [30_000, 780], [40_000, 865], [50_000, 950], [60_000, 1_035],
    [70_000, 1_120], [80_000, 1_205], [90_000, 1_290], [100_000, 1_375],
    [120_000, 1_513], [140_000, 1_651], [160_000, 1_789], [180_000, 1_927],
    [200_000, 2_065], [220_000, 2_203], [240_000, 2_341], [260_000, 2_479],
    [280_000, 2_617], [300_000, 2_755], [320_000, 2_893], [340_000, 3_031],
    [360_000, 3_169], [380_000, 3_307], [400_000, 3_445], [420_000, 3_583],
    [440_000, 3_721], [460_000, 3_859], [480_000, 3_997], [500_000, 4_135],
    [550_000, 4_374], [600_000, 4_613], [650_000, 4_852], [700_000, 5_091],
    [750_000, 5_330], [800_000, 5_569], [850_000, 5_808], [900_000, 6_047],
    [950_000, 6_286], [1_000_000, 6_525],
  ].map(([upperPounds, feePounds]) => ({
    upperValueMinorUnits: upperPounds * 100,
    feeMinorUnits: feePounds * 100,
  })),
  overMillionIncrementValueMinorUnits: 100_000 * 100,
  overMillionIncrementFeeMinorUnits: 339 * 100,
  amendmentFixedThresholdMinorUnits: 5_000 * 100,
  fixedFeesMinorUnits: {
    conversion: 215 * 100,
    demolition: 215 * 100,
    amendment: 150 * 100,
    furtherStage: 150 * 100,
    extendValidity: 150 * 100,
    lateDemolition: 350 * 100,
    noWarrantConversion: 600 * 100,
    noWarrantDemolition: 600 * 100,
  },
  multipliers: { lateWarrant: 200, completionCertificateNoWarrant: 300 },
  certifierOfDesignDiscounts: [
    [5_000, 45], [10_000, 55], [15_000, 65], [20_000, 80], [50_000, 105], [100_000, 130],
  ].map(([upperPounds, discountPounds]) => ({
    upperValueMinorUnits: upperPounds * 100,
    discountMinorUnits: discountPounds * 100,
  })),
  certifierOfConstructionDiscounts: [
    [5_000, 25], [10_000, 25], [15_000, 30], [20_000, 35], [50_000, 40], [100_000, 45],
  ].map(([upperPounds, discountPounds]) => ({
    upperValueMinorUnits: upperPounds * 100,
    discountMinorUnits: discountPounds * 100,
  })),
  certifierOfDesignPercentage: 10,
  certifierOfConstructionPercentage: 3,
} as const;

export type BuildingStandardsSubmissionType =
  | 'BUILDING_WARRANT'
  | 'COMPLETION_CERTIFICATE_NO_WARRANT';

export type CertificateEligibility = {
  selected: boolean;
  certificateAvailable?: boolean | null;
};

export type BuildingStandardsFeeInput = {
  effectiveDate: string | Date;
  submissionType: BuildingStandardsSubmissionType;
  valueOfWorksMinorUnits?: number | null;
  workStartedBeforeApplication?: boolean | null;
  conversionOnly?: boolean;
  demolitionOnly?: boolean;
  amendmentValueIncreaseMinorUnits?: number | null;
  stagedWarrantFurtherStage?: boolean;
  extendWarrantValidity?: boolean;
  disabledPersonsFacilitiesOnly?: boolean | null;
  certifierOfDesign?: CertificateEligibility;
  certifierOfConstruction?: CertificateEligibility;
};

export type FeeAdjustment = {
  type: 'CERTIFIER_OF_DESIGN' | 'CERTIFIER_OF_CONSTRUCTION';
  label: string;
  amountMinorUnits: number;
};

export type CalculatedBuildingStandardsFee = {
  calculationStatus: 'CALCULATED';
  scheduleVersion: string;
  effectiveFrom: string;
  submissionType: BuildingStandardsSubmissionType;
  valueOfWorksMinorUnits: number | null;
  calculationBasisMinorUnits: number | null;
  baseFeeMinorUnits: number;
  multiplierPercent: number;
  subtotalMinorUnits: number;
  adjustments: FeeAdjustment[];
  totalFeeMinorUnits: number;
  specialRule: string | null;
  explanation: string[];
};

export type BuildingStandardsFeeNeedsInformation = {
  calculationStatus: 'NEEDS_INFORMATION';
  scheduleVersion: string;
  effectiveFrom: string;
  submissionType: BuildingStandardsSubmissionType;
  missingInputs: string[];
  explanation: string[];
};

export type BuildingStandardsFeeResult =
  | CalculatedBuildingStandardsFee
  | BuildingStandardsFeeNeedsInformation;

const schedule = BUILDING_STANDARDS_FEE_SCHEDULE_2026;
const wholeMinorUnits = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const pounds = (minorUnits: number) => minorUnits / 100;
const money = (minorUnits: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pounds(minorUnits));

export const decimalMoneyToMinorUnits = (value: string | number | null | undefined): number | null => {
  const text = String(value ?? '').trim().replaceAll(',', '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const minorUnits = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minorUnits) ? minorUnits : null;
};

export const formatMinorUnitsForPortal = (minorUnits: number): string => {
  if (!wholeMinorUnits(minorUnits)) throw new Error('Fee must be a non-negative integer number of minor units.');
  return `${Math.floor(minorUnits / 100)}.${String(minorUnits % 100).padStart(2, '0')}`;
};

export const normalBuildingWarrantBaseFee = (valueOfWorksMinorUnits: number): number | null => {
  if (!wholeMinorUnits(valueOfWorksMinorUnits)) return null;
  const band = schedule.bands.find(({ upperValueMinorUnits }) => valueOfWorksMinorUnits <= upperValueMinorUnits);
  if (band) return band.feeMinorUnits;
  const millionBand = schedule.bands[schedule.bands.length - 1];
  const excess = valueOfWorksMinorUnits - millionBand.upperValueMinorUnits;
  const increments = Math.ceil(excess / schedule.overMillionIncrementValueMinorUnits);
  return millionBand.feeMinorUnits + increments * schedule.overMillionIncrementFeeMinorUnits;
};

const roundedPercentage = (amountMinorUnits: number, percent: number) =>
  Math.floor((amountMinorUnits * percent + 50) / 100);

const fixedOrPercentageDiscount = (
  valueOfWorksMinorUnits: number,
  subtotalMinorUnits: number,
  kind: 'design' | 'construction',
) => {
  const bands = kind === 'design'
    ? schedule.certifierOfDesignDiscounts
    : schedule.certifierOfConstructionDiscounts;
  const fixed = bands.find(({ upperValueMinorUnits }) => valueOfWorksMinorUnits <= upperValueMinorUnits);
  if (fixed) return fixed.discountMinorUnits;
  return roundedPercentage(
    subtotalMinorUnits,
    kind === 'design' ? schedule.certifierOfDesignPercentage : schedule.certifierOfConstructionPercentage,
  );
};

const needsInformation = (
  input: BuildingStandardsFeeInput,
  missingInputs: string[],
  explanation: string,
): BuildingStandardsFeeNeedsInformation => ({
  calculationStatus: 'NEEDS_INFORMATION',
  scheduleVersion: schedule.version,
  effectiveFrom: schedule.effectiveFrom,
  submissionType: input.submissionType,
  missingInputs: Array.from(new Set(missingInputs)),
  explanation: [explanation],
});

export const calculateBuildingStandardsFee = (
  input: BuildingStandardsFeeInput,
): BuildingStandardsFeeResult => {
  const effectiveDate = input.effectiveDate instanceof Date
    ? input.effectiveDate.toISOString().slice(0, 10)
    : String(input.effectiveDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || effectiveDate < schedule.effectiveFrom) {
    return needsInformation(input, ['effectiveDate'], 'The supplied fee schedule only applies from 1 April 2026.');
  }
  if (input.conversionOnly && input.demolitionOnly) {
    return needsInformation(input, ['submissionType'], 'An application cannot be both conversion-only and demolition-only.');
  }

  const missingEligibility: string[] = [];
  if (input.certifierOfDesign?.selected && typeof input.certifierOfDesign.certificateAvailable !== 'boolean') {
    missingEligibility.push('certifierOfDesign.certificateAvailable');
  }
  if (input.certifierOfConstruction?.selected && typeof input.certifierOfConstruction.certificateAvailable !== 'boolean') {
    missingEligibility.push('certifierOfConstruction.certificateAvailable');
  }
  if (missingEligibility.length) {
    return needsInformation(
      input,
      missingEligibility,
      'Confirm whether each appropriate certifier certificate will be provided before a discount is applied.',
    );
  }

  const value = input.valueOfWorksMinorUnits;
  let basis: number | null = wholeMinorUnits(value) ? value : null;
  let baseFee: number | null = null;
  let multiplierPercent = 100;
  let specialRule: string | null = null;
  const explanation: string[] = [];

  if (input.submissionType === 'COMPLETION_CERTIFICATE_NO_WARRANT') {
    if (input.conversionOnly) {
      baseFee = schedule.fixedFeesMinorUnits.noWarrantConversion;
      basis = null;
      specialRule = 'COMPLETION_NO_WARRANT_CONVERSION';
    } else if (input.demolitionOnly) {
      baseFee = schedule.fixedFeesMinorUnits.noWarrantDemolition;
      basis = null;
      specialRule = 'COMPLETION_NO_WARRANT_DEMOLITION';
    } else {
      if (basis === null) return needsInformation(input, ['valueOfWorksMinorUnits'], 'Enter the estimated value of works.');
      baseFee = normalBuildingWarrantBaseFee(basis);
      multiplierPercent = schedule.multipliers.completionCertificateNoWarrant;
      specialRule = 'COMPLETION_CERTIFICATE_NO_WARRANT_300_PERCENT';
    }
  } else {
    if (typeof input.workStartedBeforeApplication !== 'boolean') {
      return needsInformation(
        input,
        ['workStartedBeforeApplication'],
        'Confirm whether work started before the original Building Warrant application.',
      );
    }
    if (!input.workStartedBeforeApplication && typeof input.disabledPersonsFacilitiesOnly !== 'boolean') {
      return needsInformation(
        input,
        ['disabledPersonsFacilitiesOnly'],
        'Confirm whether all work is solely for qualifying disabled-person facilities.',
      );
    }
    if (input.workStartedBeforeApplication) {
      if (input.demolitionOnly) {
        baseFee = schedule.fixedFeesMinorUnits.lateDemolition;
        basis = null;
        specialRule = 'LATE_DEMOLITION_FIXED_FEE';
      } else {
        if (basis === null) return needsInformation(input, ['valueOfWorksMinorUnits'], 'Enter the estimated value of works.');
        baseFee = normalBuildingWarrantBaseFee(basis);
        multiplierPercent = schedule.multipliers.lateWarrant;
        specialRule = 'LATE_BUILDING_WARRANT_200_PERCENT';
      }
    } else if (input.disabledPersonsFacilitiesOnly) {
      baseFee = 0;
      specialRule = 'DISABLED_PERSONS_FACILITIES_ONLY';
    } else if (input.extendWarrantValidity) {
      baseFee = schedule.fixedFeesMinorUnits.extendValidity;
      basis = null;
      specialRule = 'EXTEND_WARRANT_VALIDITY';
    } else if (input.amendmentValueIncreaseMinorUnits !== undefined && input.amendmentValueIncreaseMinorUnits !== null) {
      const increase = input.amendmentValueIncreaseMinorUnits;
      if (!wholeMinorUnits(increase)) {
        return needsInformation(input, ['amendmentValueIncreaseMinorUnits'], 'Enter a valid non-negative amendment value increase.');
      }
      basis = increase;
      if (increase <= schedule.amendmentFixedThresholdMinorUnits) {
        baseFee = schedule.fixedFeesMinorUnits.amendment;
        specialRule = 'AMENDMENT_UP_TO_5000';
      } else {
        baseFee = normalBuildingWarrantBaseFee(increase);
        specialRule = 'AMENDMENT_OVER_5000';
      }
    } else if (input.stagedWarrantFurtherStage) {
      baseFee = schedule.fixedFeesMinorUnits.furtherStage;
      basis = null;
      specialRule = 'FURTHER_STAGE_FIXED_FEE';
    } else if (input.conversionOnly) {
      baseFee = schedule.fixedFeesMinorUnits.conversion;
      basis = null;
      specialRule = 'CONVERSION_ONLY_FIXED_FEE';
    } else if (input.demolitionOnly) {
      baseFee = schedule.fixedFeesMinorUnits.demolition;
      basis = null;
      specialRule = 'DEMOLITION_ONLY_FIXED_FEE';
    } else {
      if (basis === null) return needsInformation(input, ['valueOfWorksMinorUnits'], 'Enter the estimated value of works.');
      baseFee = normalBuildingWarrantBaseFee(basis);
    }
  }

  if (baseFee === null) {
    return needsInformation(input, ['valueOfWorksMinorUnits'], 'The application fee could not be calculated.');
  }
  const subtotal = Math.floor((baseFee * multiplierPercent) / 100);
  explanation.push(`Base fee: ${money(baseFee)}.`);
  if (multiplierPercent !== 100) explanation.push(`Applied ${multiplierPercent}% multiplier: ${money(subtotal)}.`);
  if (specialRule) explanation.push(`Applied special rule: ${specialRule.toLowerCase().replaceAll('_', ' ')}.`);

  const adjustments: FeeAdjustment[] = [];
  const discountBasis = wholeMinorUnits(value) ? value : basis;
  if (subtotal > 0 && discountBasis !== null && input.certifierOfDesign?.selected && input.certifierOfDesign.certificateAvailable) {
    const discount = Math.min(subtotal, fixedOrPercentageDiscount(discountBasis, subtotal, 'design'));
    adjustments.push({
      type: 'CERTIFIER_OF_DESIGN',
      label: 'Certifier of Design discount',
      amountMinorUnits: -discount,
    });
    explanation.push(`Certifier of Design discount: -${money(discount)}.`);
  }
  if (subtotal > 0 && discountBasis !== null && input.certifierOfConstruction?.selected && input.certifierOfConstruction.certificateAvailable) {
    const discount = Math.min(subtotal, fixedOrPercentageDiscount(discountBasis, subtotal, 'construction'));
    adjustments.push({
      type: 'CERTIFIER_OF_CONSTRUCTION',
      label: 'Certifier of Construction discount',
      amountMinorUnits: -discount,
    });
    explanation.push(`Certifier of Construction discount: -${money(discount)}.`);
  }
  const totalFeeMinorUnits = Math.max(
    0,
    subtotal + adjustments.reduce((total, adjustment) => total + adjustment.amountMinorUnits, 0),
  );
  explanation.push(`Calculated fee: ${money(totalFeeMinorUnits)}.`);

  return {
    calculationStatus: 'CALCULATED',
    scheduleVersion: schedule.version,
    effectiveFrom: schedule.effectiveFrom,
    submissionType: input.submissionType,
    valueOfWorksMinorUnits: wholeMinorUnits(value) ? value : null,
    calculationBasisMinorUnits: basis,
    baseFeeMinorUnits: baseFee,
    multiplierPercent,
    subtotalMinorUnits: subtotal,
    adjustments,
    totalFeeMinorUnits,
    specialRule,
    explanation,
  };
};
