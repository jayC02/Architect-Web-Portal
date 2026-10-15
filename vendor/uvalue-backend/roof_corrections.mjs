/** Inverted-roof rain correction. BBA Information Sheet 4 (2020), ISO 6946 F.4. */
export const INVERTED_ROOF_REFERENCE = 'https://www.bbacerts.co.uk/files/2022/06/17-06-74-Datasheet_Bulletin_No4i7.pdf';

const positive = (x, label, allowZero = false) => {
  if (typeof x !== 'number' || !Number.isFinite(x) || (allowZero ? x < 0 : x <= 0)) {
    throw new RangeError(`${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  return x;
};

/**
 * All resistances m²K/W. Rainfall is heating-season mean in mm/day.
 * fx_w_day_m2k_mm is the combined drainage/cooling factor for the actual system.
 * R above the membrane uses moisture-adjusted design insulation conductivity.
 * Supply provenance for rainfall, fx and design conductivity; not verified here.
 * Ballast/soil/vegetation must not contribute to the roof's Rtotal.
 */
export function invertedRoofRainCorrection({rainfall_mm_per_day, fx_w_day_m2k_mm,
  insulation_resistance_above_membrane, total_resistance,
  rainfall_evidence, drainage_evidence, design_conductivity_evidence}) {
  positive(rainfall_mm_per_day, 'rainfall_mm_per_day', true);
  positive(fx_w_day_m2k_mm, 'fx_w_day_m2k_mm');
  if (fx_w_day_m2k_mm > .04) throw new RangeError('fx exceeds the supported BBA cooling factor of 0.04');
  positive(insulation_resistance_above_membrane, 'insulation resistance above membrane');
  positive(total_resistance, 'total resistance');
  if (insulation_resistance_above_membrane > total_resistance) throw new RangeError('insulation resistance exceeds total resistance');
  for (const [label,value] of Object.entries({rainfall_evidence, drainage_evidence, design_conductivity_evidence})) {
    if (typeof value !== 'string' || !value.trim()) throw new RangeError(`${label} is required`);
  }
  return rainfall_mm_per_day * fx_w_day_m2k_mm * (insulation_resistance_above_membrane / total_resistance) ** 2;
}
