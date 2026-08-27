import assert from 'node:assert/strict';
import {
  BUILDING_STANDARDS_FEE_SCHEDULE_2026,
  calculateBuildingStandardsFee,
  decimalMoneyToMinorUnits,
  normalBuildingWarrantBaseFee,
} from '../src/lib/fees/building-standards-fee';

const publishedBands = [
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
] as const;

assert.equal(BUILDING_STANDARDS_FEE_SCHEDULE_2026.effectiveFrom, '2026-04-01');
assert.equal(BUILDING_STANDARDS_FEE_SCHEDULE_2026.bands.length, publishedBands.length);

let lowerPounds = 0;
for (const [upperPounds, feePounds] of publishedBands) {
  assert.equal(normalBuildingWarrantBaseFee(lowerPounds * 100), feePounds * 100, `lower boundary £${lowerPounds}`);
  assert.equal(normalBuildingWarrantBaseFee(upperPounds * 100), feePounds * 100, `upper boundary £${upperPounds}`);
  lowerPounds = upperPounds + 1;
}

for (const [valuePounds, feePounds] of [
  [0, 215], [5_000, 215], [5_001, 237], [10_000, 435], [10_001, 461],
  [20_000, 695], [20_001, 780], [40_000, 865], [100_000, 1_375],
  [100_001, 1_513], [1_000_000, 6_525], [1_000_001, 6_864],
  [1_100_000, 6_864], [1_100_001, 7_203],
] as const) {
  assert.equal(normalBuildingWarrantBaseFee(valuePounds * 100), feePounds * 100);
}
assert.equal(normalBuildingWarrantBaseFee(-1), null);
assert.equal(normalBuildingWarrantBaseFee(0.5), null);
assert.equal(decimalMoneyToMinorUnits('1390.00'), 139_000);
assert.equal(decimalMoneyToMinorUnits('1,390.50'), 139_050);
assert.equal(decimalMoneyToMinorUnits('12.345'), null);

const warrant = (overrides: Record<string, unknown> = {}) => calculateBuildingStandardsFee({
  effectiveDate: '2026-04-01',
  submissionType: 'BUILDING_WARRANT',
  valueOfWorksMinorUnits: 20_000 * 100,
  workStartedBeforeApplication: false,
  disabledPersonsFacilitiesOnly: false,
  ...overrides,
});

const calculatedTotal = (overrides: Record<string, unknown> = {}) => {
  const result = warrant(overrides);
  assert.equal(result.calculationStatus, 'CALCULATED');
  return result.totalFeeMinorUnits;
};

assert.equal(calculatedTotal(), 695 * 100);
assert.equal(calculatedTotal({ workStartedBeforeApplication: true }), 1_390 * 100);
assert.equal(calculatedTotal({ demolitionOnly: true }), 215 * 100);
assert.equal(calculatedTotal({ demolitionOnly: true, workStartedBeforeApplication: true }), 350 * 100);
assert.equal(calculatedTotal({ conversionOnly: true }), 215 * 100);
assert.equal(calculatedTotal({ amendmentValueIncreaseMinorUnits: 5_000 * 100 }), 150 * 100);
assert.equal(calculatedTotal({ amendmentValueIncreaseMinorUnits: 20_000 * 100 }), 695 * 100);
assert.equal(calculatedTotal({ stagedWarrantFurtherStage: true }), 150 * 100);
assert.equal(calculatedTotal({ extendWarrantValidity: true }), 150 * 100);
assert.equal(calculatedTotal({ disabledPersonsFacilitiesOnly: true }), 0);

const completion = (overrides: Record<string, unknown> = {}) => calculateBuildingStandardsFee({
  effectiveDate: '2026-04-01',
  submissionType: 'COMPLETION_CERTIFICATE_NO_WARRANT',
  valueOfWorksMinorUnits: 20_000 * 100,
  ...overrides,
});
const normalCompletion = completion();
assert.equal(normalCompletion.calculationStatus, 'CALCULATED');
if (normalCompletion.calculationStatus === 'CALCULATED') assert.equal(normalCompletion.totalFeeMinorUnits, 2_085 * 100);
const conversionCompletion = completion({ conversionOnly: true });
assert.equal(conversionCompletion.calculationStatus, 'CALCULATED');
if (conversionCompletion.calculationStatus === 'CALCULATED') assert.equal(conversionCompletion.totalFeeMinorUnits, 600 * 100);
const demolitionCompletion = completion({ demolitionOnly: true });
assert.equal(demolitionCompletion.calculationStatus, 'CALCULATED');
if (demolitionCompletion.calculationStatus === 'CALCULATED') assert.equal(demolitionCompletion.totalFeeMinorUnits, 600 * 100);

const designDiscounts = [
  [0, 45], [5_000, 45], [5_001, 55], [10_000, 55], [10_001, 65], [15_000, 65],
  [15_001, 80], [20_000, 80], [20_001, 105], [50_000, 105], [50_001, 130], [100_000, 130],
] as const;
for (const [valuePounds, discountPounds] of designDiscounts) {
  const result = warrant({
    valueOfWorksMinorUnits: valuePounds * 100,
    certifierOfDesign: { selected: true, certificateAvailable: true },
  });
  assert.equal(result.calculationStatus, 'CALCULATED');
  if (result.calculationStatus === 'CALCULATED') {
    assert.equal(result.adjustments[0]?.amountMinorUnits, -discountPounds * 100, `design discount £${valuePounds}`);
  }
}

const constructionDiscounts = [
  [0, 25], [5_000, 25], [5_001, 25], [10_000, 25], [10_001, 30], [15_000, 30],
  [15_001, 35], [20_000, 35], [20_001, 40], [50_000, 40], [50_001, 45], [100_000, 45],
] as const;
for (const [valuePounds, discountPounds] of constructionDiscounts) {
  const result = warrant({
    valueOfWorksMinorUnits: valuePounds * 100,
    certifierOfConstruction: { selected: true, certificateAvailable: true },
  });
  assert.equal(result.calculationStatus, 'CALCULATED');
  if (result.calculationStatus === 'CALCULATED') {
    assert.equal(result.adjustments[0]?.amountMinorUnits, -discountPounds * 100, `construction discount £${valuePounds}`);
  }
}

const percentageDesign = warrant({
  valueOfWorksMinorUnits: 100_001 * 100,
  certifierOfDesign: { selected: true, certificateAvailable: true },
});
assert.equal(percentageDesign.calculationStatus, 'CALCULATED');
if (percentageDesign.calculationStatus === 'CALCULATED') {
  assert.equal(percentageDesign.adjustments[0]?.amountMinorUnits, -15_130);
}
const percentageConstruction = warrant({
  valueOfWorksMinorUnits: 100_001 * 100,
  certifierOfConstruction: { selected: true, certificateAvailable: true },
});
assert.equal(percentageConstruction.calculationStatus, 'CALCULATED');
if (percentageConstruction.calculationStatus === 'CALCULATED') {
  assert.equal(percentageConstruction.adjustments[0]?.amountMinorUnits, -4_539);
}

const realExample = warrant({
  valueOfWorksMinorUnits: 40_000 * 100,
  certifierOfDesign: { selected: true, certificateAvailable: true },
});
assert.equal(realExample.calculationStatus, 'CALCULATED');
if (realExample.calculationStatus === 'CALCULATED') {
  assert.equal(realExample.baseFeeMinorUnits, 865 * 100);
  assert.equal(realExample.adjustments[0]?.amountMinorUnits, -105 * 100);
  assert.equal(realExample.totalFeeMinorUnits, 760 * 100);
}
assert.equal(calculatedTotal({ valueOfWorksMinorUnits: 40_000 * 100 }), 865 * 100);

const combined = warrant({
  valueOfWorksMinorUnits: 40_000 * 100,
  certifierOfDesign: { selected: true, certificateAvailable: true },
  certifierOfConstruction: { selected: true, certificateAvailable: true },
});
assert.equal(combined.calculationStatus, 'CALCULATED');
if (combined.calculationStatus === 'CALCULATED') {
  assert.equal(combined.totalFeeMinorUnits, (865 - 105 - 40) * 100);
}

const unavailable = warrant({
  valueOfWorksMinorUnits: 40_000 * 100,
  certifierOfDesign: { selected: true, certificateAvailable: false },
});
assert.equal(unavailable.calculationStatus, 'CALCULATED');
if (unavailable.calculationStatus === 'CALCULATED') assert.equal(unavailable.totalFeeMinorUnits, 865 * 100);

const unclear = warrant({
  valueOfWorksMinorUnits: 40_000 * 100,
  certifierOfDesign: { selected: true },
});
assert.equal(unclear.calculationStatus, 'NEEDS_INFORMATION');
if (unclear.calculationStatus === 'NEEDS_INFORMATION') {
  assert.deepEqual(unclear.missingInputs, ['certifierOfDesign.certificateAvailable']);
}
assert.equal(warrant({ valueOfWorksMinorUnits: -1 }).calculationStatus, 'NEEDS_INFORMATION');
assert.equal(warrant({ workStartedBeforeApplication: null }).calculationStatus, 'NEEDS_INFORMATION');
assert.equal(warrant({ disabledPersonsFacilitiesOnly: null }).calculationStatus, 'NEEDS_INFORMATION');

console.log('Building Standards fee tests passed.');
