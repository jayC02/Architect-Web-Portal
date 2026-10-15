import { z } from 'zod';
import { materialLambda, thermalMaterials } from './materials';
import { additionalMethods, methodKeys, isAdditionalMethod, methodDataSchema, calculateAdditionalMethod } from './methods';
import { calculatePlaneLayers as calculateEnginePlane, calculateSlabOnGround, unventilatedAirLayerResistance,
  airGapCorrection, discreteFastenerCorrection } from '../../../vendor/uvalue-backend/uvalue_engine.mjs';

export const U_VALUE_METHOD_VERSION = 'AP-THERMAL-3.0.0';
export const U_VALUE_ENGINE_VERSION = '4.0.0';
export const thermalReferences = [
  { title: 'ISO 6946:2017 — opaque building elements', url: 'https://www.iso.org/standard/65708.html' },
  { title: 'ISO 13370:2017 — heat transfer via the ground', url: 'https://www.iso.org/standard/65716.html' },
  { title: 'ISO 10077-1:2017 — supplied window and door component values', url: 'https://www.iso.org/standard/67090.html' },
  { title: 'ISO 13789:2017 — passive unheated-space heat balance', url: 'https://www.iso.org/standard/65713.html' },
  { title: 'BRE BR 443:2019 — UK calculation conventions', url: 'https://www.cibse.org/media/wzrjrf3l/conventions-for-u-value-calculations.pdf' },
  { title: 'Scottish domestic technical handbook — April 2026', url: 'https://www.gov.scot/publications/building-standards-technical-handbook-domestic-april-2026-pdf/' },
];

const positive = z.number().finite().positive();
const source = z.string().trim().max(600).default('');
const baseLayer = {
  id: z.string().min(1).max(80), name: z.string().trim().min(1, 'Name each construction layer.').max(160),
  thicknessMm: z.number().finite().min(0).max(2000), source,
};
const bridge = z.object({
  name: z.string().trim().min(1).max(120), lambda: positive.max(5, 'Metal framing needs a specialist thermal-bridge calculation.'),
  fraction: positive.max(0.95), group: z.string().min(1).max(40), source,
}).strict();
export const thermalLayerSchema = z.discriminatedUnion('kind', [
  z.object({ ...baseLayer, kind: z.literal('solid'), thicknessMm: positive.max(2000),
    lambda: positive.min(0.005).max(500), productId: z.string().max(80).nullable().default(null), bridge: bridge.nullable().default(null) }).strict(),
  z.object({ ...baseLayer, kind: z.literal('resistance'), resistance: z.number().finite().min(0).max(100) }).strict(),
  z.object({ ...baseLayer, kind: z.literal('air'), thicknessMm: positive.max(300),
    resistance: positive.max(5).nullable().default(null), ventilation: z.enum(['unventilated', 'slightly', 'well']),
    airMode: z.enum(['assessed', 'table', 'emissivity']).default('assessed'),
    widthMm: positive.max(1000000).nullable().default(null), heightMm: positive.max(1000000).nullable().default(null),
    emissivity1: positive.min(0.02).max(1).default(0.9), emissivity2: positive.min(0.02).max(1).default(0.9), emissivityEvidence: source,
    openings: z.number().finite().min(0).max(100000).default(0) }).strict(),
]);
export const uValueInputSchema = z.object({
  element: z.enum(['wall', 'roof', 'exposed-floor', 'ground-slab', ...methodKeys]),
  methodData: methodDataSchema.nullable().default(null),
  construction: z.enum(['standard', 'steel-frame', 'inverted-roof', 'specialist']).default('standard'),
  heatFlow: z.enum(['automatic', 'upwards', 'horizontal', 'downwards']).default('automatic'),
  correctionsAssessed: z.boolean().default(false),
  layers: z.array(thermalLayerSchema).max(32),
  corrections: z.array(z.object({
    name: z.string().trim().min(1).max(120), deltaU: z.number().finite().min(0).max(10),
    source: z.string().trim().min(1, 'Give a calculation or product reference for each correction.').max(600),
  }).strict()).max(12).default([]),
  automaticCorrections: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('airgap'), layerId: z.string().min(1).max(80), level: z.union([z.literal(0), z.literal(1), z.literal(2)]), source: z.string().trim().min(1, 'Give the correction a reference.').max(600) }).strict(),
    z.object({ kind: z.literal('fastener'), layerId: z.string().min(1).max(80), conductivity: positive.max(500),
      diameterMm: positive.max(50), countPerM2: z.number().finite().min(0).max(1000),
      penetration: z.enum(['full', 'recessed']), penetrationMm: positive.max(2000).nullable().default(null),
      applicabilityConfirmed: z.boolean().default(false), source: z.string().trim().min(1, 'Give the correction a reference.').max(600) }).strict(),
  ])).max(12).default([]),
  ground: z.object({
    area: positive.max(1000000), perimeter: positive.max(100000), wallThicknessMm: positive.max(2000),
    soilLambda: positive.min(0.1).max(10),
    configuration: z.enum(['uniform-slab', 'edge-insulated', 'suspended', 'basement', 'flowing-groundwater']),
    source,
  }).strict().nullable().default(null),
  target: positive.max(10).nullable().default(null), targetReference: source,
}).strict();
export type ThermalLayer = z.infer<typeof thermalLayerSchema>;
export type UValueInput = z.infer<typeof uValueInputSchema>;
export function referencesForInput(input: UValueInput) {
  const ground = input.element === 'ground-slab' || (isAdditionalMethod(input.element) && ['ground', 'edge'].includes(additionalMethods[input.element].family));
  const opening = input.element === 'window' || input.element === 'door';
  return thermalReferences.filter(reference => reference.title.startsWith('BRE') || (input.target != null && reference.title.startsWith('Scottish'))
    || (ground && reference.title.startsWith('ISO 13370')) || (opening && reference.title.startsWith('ISO 10077'))
    || (!ground && !opening && input.element !== 'supplied_u' && reference.title.startsWith('ISO 6946'))
    || (input.element === 'unheated_space' && reference.title.startsWith('ISO 13789')));
}
export class ThermalCalculationError extends Error {}

export const elementLabels: Record<UValueInput['element'], string> = {
  wall: 'External wall', roof: 'Roof', 'exposed-floor': 'Floor exposed to outside air', 'ground-slab': 'Ground-bearing slab',
  ...Object.fromEntries(Object.entries(additionalMethods).map(([key, value]) => [key, value.label])) as Record<keyof typeof additionalMethods, string>,
};
export const surfaceResistance = (element: UValueInput['element']) => element === 'wall' ? 0.13 : element === 'roof' ? 0.10 : 0.17;
export const heatFlowLabels = { automatic: 'Element default', upwards: 'Upwards', horizontal: 'Horizontal', downwards: 'Downwards' };
export const formatUValue = (value: number) => value.toPrecision(2);
type HeatFlow = 'upwards' | 'horizontal' | 'downwards';
const engineFlow = (flow: HeatFlow) => flow === 'upwards' ? 'up' : flow === 'downwards' ? 'down' : 'horizontal';
export function airLayerCalculation(layer: Extract<ThermalLayer, { kind: 'air' }>, flow: HeatFlow) {
  if (layer.airMode === 'assessed') return null;
  if (layer.widthMm == null || layer.heightMm == null) throw new ThermalCalculationError(`${layer.name}: enter the cavity width and height.`);
  try { return unventilatedAirLayerResistance({ thickness_mm: layer.thicknessMm, width_mm: layer.widthMm, height_mm: layer.heightMm,
    heat_flow: engineFlow(flow), method: layer.airMode === 'table' ? 'table' : 'iso_6946_annex_d',
    emissivity_1: layer.emissivity1, emissivity_2: layer.emissivity2, emissivity_evidence: layer.emissivityEvidence });
  } catch (error) { throw new ThermalCalculationError(`${layer.name}: ${error instanceof Error ? error.message : 'Check the cavity properties.'}`); }
}
export function layerResistance(layer: ThermalLayer, flow: HeatFlow = 'horizontal'): number {
  if (layer.kind === 'solid') return layer.thicknessMm / 1000 / layer.lambda;
  if (layer.kind === 'resistance') return layer.resistance;
  const calculated = airLayerCalculation(layer, flow);
  if (calculated) return calculated.resistance;
  if (layer.resistance == null) throw new ThermalCalculationError(`${layer.name}: enter the assessed cavity resistance.`);
  return layer.resistance;
}

type Bounds = { upper: number; lower: number; paths: { fraction: number; resistance: number; bridges: string[] }[] };
function resistanceBounds(layers: ThermalLayer[], rsi: number, rse: number, flow: HeatFlow): Bounds {
  const groups = new Map<string, number>();
  for (const layer of layers) if (layer.kind === 'solid' && layer.bridge) {
    const previous = groups.get(layer.bridge.group);
    if (previous != null && Math.abs(previous - layer.bridge.fraction) > 1e-9) {
      throw new ThermalCalculationError('Aligned bridging layers must use the same area fraction. Use another bridge group for crossing or independent framing.');
    }
    groups.set(layer.bridge.group, layer.bridge.fraction);
  }
  if (groups.size > 4) throw new ThermalCalculationError('At most four independent bridge groups are supported.');
  let sections: { fraction: number; selected: string[] }[] = [{ fraction: 1, selected: [] }];
  for (const [group, fraction] of groups) sections = sections.flatMap(section => [
    { fraction: section.fraction * (1 - fraction), selected: section.selected },
    { fraction: section.fraction * fraction, selected: [...section.selected, group] },
  ]);
  const activeLayers = layers.filter(layer => layerResistance(layer, flow) > 0);
  // Zero-resistance membranes remain in the saved build-up; they add no R.
  if (!activeLayers.length) return { upper: rsi + rse, lower: rsi + rse,
    paths: [{ fraction: 1, resistance: rsi + rse, bridges: [] }] };
  try {
    const calculation = calculateEnginePlane({ element: flow === 'horizontal' ? 'layered_wall' : flow === 'upwards' ? 'layered_roof' : 'exposed_floor',
      heat_flow: engineFlow(flow), rsi, rse, fractions: sections.map(section => section.fraction), omit_small_corrections: false,
      // Portal inputs are inside → outside; the supplied engine is outside → inside.
      layers: [...activeLayers].reverse().map(layer => ({ name: layer.name, thickness_mm: layer.thicknessMm,
        ...(layer.kind === 'solid' ? layer.bridge ? { conductivities: sections.map(section =>
          section.selected.includes(layer.bridge!.group) ? layer.bridge!.lambda : layer.lambda) } : { conductivity: layer.lambda }
          : { resistance: layerResistance(layer, flow) }) })),
    });
    return { upper: calculation.r_upper, lower: calculation.r_lower,
      paths: sections.map((section, index) => ({ fraction: section.fraction, bridges: section.selected, resistance: calculation.path_resistances[index] })) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Check the construction layers.';
    if (message.includes('more than 1.5')) throw new ThermalCalculationError('The upper/lower resistance ratio exceeds 1.5. Use a specialist numerical calculation.');
    throw new ThermalCalculationError(message);
  }
}

export function calculateUValue(raw: unknown) {
  const input = uValueInputSchema.parse(raw);
  if (isAdditionalMethod(input.element)) {
    if (input.construction !== 'standard' || input.layers.length || input.corrections.length || input.automaticCorrections.length || input.ground || input.heatFlow !== 'automatic') throw new ThermalCalculationError('Use only the inputs belonging to the selected calculation method.');
    if (!input.methodData) throw new ThermalCalculationError('Enter the method inputs.');
    let calculation;
    try { calculation = calculateAdditionalMethod(input.element, input.methodData); }
    catch (error) { throw new ThermalCalculationError(error instanceof Error ? error.message : 'Check the method inputs.'); }
    const uValue = calculation.result.u_value;
    if (!Number.isFinite(uValue) || uValue <= 0) throw new ThermalCalculationError('The calculation must produce a finite positive U-value.');
    const resistance = 1 / uValue;
    const baseU = typeof calculation.result.u_uncorrected === 'number' ? calculation.result.u_uncorrected
      : typeof calculation.result.uncorrected_u_value === 'number' ? calculation.result.uncorrected_u_value : uValue;
    return {
      methodVersion: U_VALUE_METHOD_VERSION, engineVersion: U_VALUE_ENGINE_VERSION,
      method: calculation.label, uValue, displayUValue: formatUValue(uValue), baseUValue: baseU, correction: uValue - baseU,
      correctionDetails: [], totalResistance: resistance, upperResistance: resistance, lowerResistance: resistance,
      approximationErrorPercent: 0, rsi: 0, rse: 0, heatFlow: 'upwards' as const,
      ventilation: 'See method conditions', ventilationDetails: null, ignoredLayerIds: [] as string[], paths: [] as Bounds['paths'], ground: null,
      layerResults: [] as { id: string; resistance: number; ignored: boolean }[],
      targetMet: input.target == null ? null : uValue <= input.target,
      missingSources: input.methodData.source ? [] : ['Construction assessment / design-value reference'],
      notes: [calculation.scope, ...(calculation.result.warnings || []), 'The calculation does not assess whole-building energy compliance, condensation or fire performance.'],
      additional: { working: calculation.working, engineResult: calculation.result, source: input.methodData.source },
    };
  }
  if (input.methodData) throw new ThermalCalculationError('Additional method inputs do not belong to this element.');
  if (!input.layers.length) throw new ThermalCalculationError('Add at least one construction layer.');
  for (const layer of input.layers) if (layer.kind === 'solid' && layer.productId) {
    const product = thermalMaterials.find(item => item.id === layer.productId);
    if (!product) throw new ThermalCalculationError('The selected product is not in the verified material library. Choose Custom material.');
    if (!(product.thicknesses as readonly number[]).includes(layer.thicknessMm)) throw new ThermalCalculationError(`${product.name} is not listed at ${layer.thicknessMm} mm. Select a listed thickness, use multiple layers or enter a referenced custom material.`);
    if (Math.abs(layer.lambda - materialLambda(product.id, layer.thicknessMm)!) > 1e-12) throw new ThermalCalculationError(`The conductivity differs from the selected manufacturer declaration. Choose Custom material to enter a referenced design value.`);
  }
  if (new Set(input.layers.map(layer => layer.id)).size !== input.layers.length) throw new ThermalCalculationError('Each layer must have a unique identifier.');
  if (input.construction !== 'standard') throw new ThermalCalculationError('This construction needs a specialist calculation. Steel framing, inverted roofs and other specialist systems are outside this calculator’s scope.');
  const heatFlow = input.element === 'ground-slab' ? 'downwards' : input.heatFlow === 'automatic'
    ? input.element === 'wall' ? 'horizontal' : input.element === 'roof' ? 'upwards' : 'downwards' : input.heatFlow;
  const rsi = heatFlow === 'upwards' ? 0.10 : heatFlow === 'horizontal' ? 0.13 : 0.17;
  let rse = 0.04;
  let used = input.layers;
  let ignoredLayerIds: string[] = [];
  let ventilation = 'No ventilated boundary';
  let ventilationDetails: null | { fraction: number; unventilatedUpper: number; unventilatedLower: number; shelteredUpper: number; shelteredLower: number } = null;
  let upper: number, lower: number, paths: Bounds['paths'], groundResult: null | {
    characteristicDimension: number; equivalentThickness: number; regime: string;
  } = null;
  let baseU: number;
  const notes: string[] = [];
  if (input.element === 'ground-slab') {
    const ground = input.ground;
    if (!ground) throw new ThermalCalculationError('Enter the ground-floor area, exposed perimeter, wall thickness and soil conductivity.');
    if (ground.configuration !== 'uniform-slab') throw new ThermalCalculationError('This ground-floor configuration needs a specialist ISO 13370 calculation. Only slabs at ground level with uniform all-over insulation and no separate edge insulation or flowing-groundwater correction are supported.');
    if (input.layers.some(layer => layer.kind === 'air' || (layer.kind === 'solid' && layer.bridge))) {
      throw new ThermalCalculationError('A ground-bearing slab must have homogeneous layers without air voids or repeating framing. Suspended floors need a different ground-transfer method.');
    }
    if (input.corrections.length || input.automaticCorrections.length) throw new ThermalCalculationError('Ground-floor edge and groundwater corrections require a specialist ISO 13370 calculation.');
    // ISO 13370 uniform slab: B′ = 2A/P and dt = w + λg(Rsi + Rf + Rse).
    const slab = calculateSlabOnGround({ area_m2: ground.area, exposed_perimeter_m: ground.perimeter,
      wall_thickness_m: ground.wallThicknessMm / 1000, soil_conductivity_w_mk: ground.soilLambda,
      floor_resistance_m2k_w: used.reduce((sum, layer) => sum + layerResistance(layer, heatFlow), 0),
      rsi_m2k_w: rsi, rse_m2k_w: rse, edge_insulation: 'none', basement_depth_m: 0 });
    const b = slab.characteristic_dimension_m, dt = slab.equivalent_ground_thickness_m;
    baseU = slab.u_value;
    upper = lower = 1 / baseU; paths = [];
    groundResult = { characteristicDimension: b, equivalentThickness: dt, regime: dt >= b ? 'dt ≥ B′' : 'dt < B′' };
    notes.push('Steady-state, annual-average slab-on-ground U-value. Use the complete relevant floor area and exposed perimeter, excluding boundaries to spaces heated to a similar temperature.');
  } else {
    const boundaryIndex = input.layers.findIndex(layer => layer.kind === 'air' && layer.ventilation !== 'unventilated');
    let bounds: Bounds;
    if (boundaryIndex >= 0) {
      const air = input.layers[boundaryIndex];
      if (air.kind !== 'air') throw new ThermalCalculationError('Invalid ventilated boundary.');
      if (air.airMode === 'emissivity' && Math.min(air.emissivity1, air.emissivity2) < 0.8) {
        throw new ThermalCalculationError('Reflective ventilated cavities require a separately assessed cavity and still-air surface resistance. The automatic emissivity method supports unventilated cavities only.');
      }
      if (input.layers.slice(boundaryIndex + 1).some(layer => layer.kind === 'air' && layer.ventilation !== 'unventilated')) {
        throw new ThermalCalculationError('Only one ventilated boundary is supported.');
      }
      // Well-ventilated cavities: disregard the cavity and layers beyond it,
      // and use a sheltered external surface resistance equal to Rsi.
      if (input.automaticCorrections.length) throw new ThermalCalculationError('Calculated corrections with a ventilated boundary require a separate assessment. Enter an independently assessed ΔU with its reference instead.');
      const sheltered = resistanceBounds(input.layers.slice(0, boundaryIndex), rsi, rsi, heatFlow);
      const fraction = air.ventilation === 'well' ? 1 : Math.max(0, Math.min(1, (air.openings - 500) / 1000));
      // Layers outside a well-ventilated cavity cannot affect the calculation,
      // including bridging groups that are outside the thermal boundary.
      const full = fraction === 1 ? sheltered : resistanceBounds(used, rsi, rse, heatFlow);
      if ((fraction < 1 && full.upper / full.lower > 1.5 + 1e-12)
        || (fraction > 0 && sheltered.upper / sheltered.lower > 1.5 + 1e-12)) {
        throw new ThermalCalculationError('A ventilation-boundary resistance ratio exceeds 1.5. Use a specialist numerical calculation.');
      }
      if (fraction < 1) ventilationDetails = { fraction, unventilatedUpper: full.upper, unventilatedLower: full.lower,
        shelteredUpper: sheltered.upper, shelteredLower: sheltered.lower };
      bounds = { upper: full.upper * (1 - fraction) + sheltered.upper * fraction,
        lower: full.lower * (1 - fraction) + sheltered.lower * fraction,
        paths: fraction === 1 ? sheltered.paths : fraction === 0 ? full.paths : [] };
      if (fraction === 1) { used = input.layers.slice(0, boundaryIndex); ignoredLayerIds = input.layers.slice(boundaryIndex).map(layer => layer.id); rse = rsi; }
      ventilation = fraction === 1 ? 'Well ventilated; sheltered external surface'
        : fraction === 0 ? 'Unventilated (openings ≤ 500)' : `Slightly ventilated; ${air.openings} mm²/${input.element === 'wall' ? 'm' : 'm²'}`;
      if (fraction > 0 && fraction < 1) notes.push('The unventilated and well-ventilated total resistances are interpolated using the stated ventilation openings.');
    } else bounds = resistanceBounds(used, rsi, rse, heatFlow);
    upper = bounds.upper; lower = bounds.lower; paths = bounds.paths;
    if (upper / lower > 1.5 + 1e-12) throw new ThermalCalculationError('The upper/lower resistance ratio exceeds 1.5. The ISO 6946 combined approximation is not applicable; use a specialist numerical calculation.');
    baseU = 1 / ((upper + lower) / 2);
  }
  const airgapLayers = new Set<string>();
  const calculatedCorrections = input.automaticCorrections.map(item => {
    const layer = input.layers.find(layer => layer.id === item.layerId);
    if (!layer || layer.kind !== 'solid') throw new ThermalCalculationError('Choose a solid insulation layer for each calculated correction.');
    if (item.kind === 'airgap') {
      if (airgapLayers.has(layer.id)) throw new ThermalCalculationError('Use only one air-gap correction per insulation layer.');
      airgapLayers.add(layer.id);
      if (heatFlow === 'downwards' && item.level !== 0) throw new ThermalCalculationError('Air-gap convection corrections are not applicable to downward heat flow.');
      const equivalentR = layer.bridge ? layer.thicknessMm / 1000 / ((1 - layer.bridge.fraction) * layer.lambda + layer.bridge.fraction * layer.bridge.lambda) : layerResistance(layer, heatFlow);
      const totalR = (upper + lower) / 2;
      return { kind: item.kind, layerId: layer.id, name: `Air gaps · ${layer.name} · level ${item.level}`,
        deltaU: airGapCorrection(item.level, equivalentR, totalR), source: item.source,
        working: `ΔUg = ${[0, 0.01, 0.04][item.level]} × (${equivalentR.toFixed(8)} / ${totalR.toFixed(8)})². Layer R is the equivalent resistance including repeating framing.` };
    }
    if (!item.applicabilityConfirmed) throw new ThermalCalculationError('Confirm the discrete-fixing applicability conditions before calculating this correction.');
    if (item.penetration === 'recessed' && item.penetrationMm == null) throw new ThermalCalculationError('Enter the metal penetration depth for a recessed fixing.');
    if (item.penetration === 'full' && item.penetrationMm != null) throw new ThermalCalculationError('Choose recessed fixing to enter a partial penetration depth.');
    const homogeneousR = rsi + rse + input.layers.reduce((sum, layer) => sum + layerResistance(layer, heatFlow), 0);
    const area = Math.PI * item.diameterMm ** 2 / 4;
    const penetration = item.penetration === 'full' ? layer.thicknessMm : item.penetrationMm!;
    let fixing;
    try { fixing = discreteFastenerCorrection({ fastener_conductivity_w_mk: item.conductivity, cross_section_area_mm2: area,
      count_per_m2: item.countPerM2, insulation_thickness_mm: layer.thicknessMm, metal_penetration_mm: penetration,
      insulation_conductivity_w_mk: layer.lambda, total_homogeneous_resistance_m2k_w: homogeneousR,
      both_ends_contact_metal: false, angle_degrees: 0 });
    } catch (error) { throw new ThermalCalculationError(error instanceof Error ? error.message : 'Check the fixing inputs.'); }
    return { kind: item.kind, layerId: layer.id, name: `Discrete fixings · ${layer.name}`, deltaU: fixing.delta_u, source: item.source,
      working: `Af = π × ${item.diameterMm}² / 4 = ${area.toFixed(8)} mm²; λf = ${item.conductivity} W/mK; n = ${item.countPerM2}/m²; d1 = ${penetration} mm; α = ${fixing.alpha.toFixed(8)}; R1 = ${fixing.penetrated_insulation_resistance_m2k_w.toFixed(8)} m²K/W; Rtot,h = ${homogeneousR.toFixed(8)} m²K/W. ΔUf = α λf Af n / d1 × (R1 / Rtot,h)², with lengths and area converted to metres and m².${fixing.exemption ? ' Conductivity below 1 W/mK: correction exempt.' : ''}` };
  });
  const correctionDetails = [...input.corrections.map(item => ({ ...item, kind: 'assessed', layerId: null, working: 'Independently assessed ΔU.' })), ...calculatedCorrections];
  const correction = correctionDetails.reduce((sum, item) => sum + item.deltaU, 0);
  const uValue = baseU + correction;
  if (!Number.isFinite(uValue) || uValue <= 0) throw new ThermalCalculationError('The inputs do not produce a finite positive U-value.');
  const missingSources = input.layers.filter(layer => !ignoredLayerIds.includes(layer.id) && !layer.source).map(layer => layer.name);
  if (input.element === 'ground-slab' && !input.ground?.source) missingSources.push('Soil conductivity');
  for (const layer of used) if (layer.kind === 'solid' && layer.bridge && !layer.bridge.source) missingSources.push(`${layer.bridge.name} bridge`);
  if (missingSources.length) notes.push(`Record a design-value reference before issuing the report: ${missingSources.join(', ')}.`);
  for (const layer of used) if (layer.kind === 'air') {
    const air = airLayerCalculation(layer, heatFlow);
    if (air) notes.push(`${layer.name}: ${air.method === 'table' ? 'high-emissivity design table' : 'surface-emissivity calculation'}, mean temperature 10°C, temperature difference at most 5 K, plane parallel cavity dimensions each greater than ten times thickness.`, ...air.warnings);
  }
  if (correction) notes.push('All entered and calculated corrections are included, including corrections below the 3% omission threshold.');
  else notes.push(input.element === 'ground-slab' ? 'No separate edge-insulation or groundwater correction is applied.'
    : 'No additional correction has been entered. Confirm that installation air gaps, mechanical fixings and other applicable corrections have been assessed.');
  notes.push('The calculation does not assess condensation, junction Ψ-values, whole-building energy performance or fire performance. It is not an independently certified software result.');
  return {
    methodVersion: U_VALUE_METHOD_VERSION, engineVersion: U_VALUE_ENGINE_VERSION, correctionDetails, additional: null,
    method: input.element === 'ground-slab' ? 'ISO 13370 — uniform slab on ground'
      : used.some(layer => layer.kind === 'solid' && layer.bridge) ? 'ISO 6946 — combined upper/lower method' : 'ISO 6946 — homogeneous layers',
    uValue, displayUValue: formatUValue(uValue), baseUValue: baseU, correction,
    totalResistance: (upper + lower) / 2, upperResistance: upper, lowerResistance: lower,
    approximationErrorPercent: (upper - lower) / (upper + lower) * 100,
    rsi, rse, heatFlow, ventilation, ventilationDetails, ignoredLayerIds, paths, ground: groundResult,
    layerResults: input.layers.map(layer => ({ id: layer.id, resistance: layerResistance(layer, heatFlow), ignored: ignoredLayerIds.includes(layer.id) })),
    targetMet: input.target == null ? null : uValue <= input.target,
    missingSources, notes,
  };
}
export type UValueResult = ReturnType<typeof calculateUValue>;
