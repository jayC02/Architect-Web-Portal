import { z } from 'zod';
import { calculateConstruction } from '../../../vendor/uvalue-backend/backend/calculations.mjs';

export type MethodField = { key: string; label: string; initial?: string; options?: readonly string[]; positive?: boolean; text?: boolean };
const field = (key: string, label: string, initial?: string): MethodField => ({ key, label, initial });
const groundFields: MethodField[] = [
  { key: 'area_m2', label: 'Floor footprint area (m²)', positive: true },
  { key: 'exposed_perimeter_m', label: 'Exposed perimeter (m)', positive: true },
  { key: 'wall_thickness_m', label: 'External wall thickness (m)', positive: true },
  { key: 'soil_conductivity_w_mk', label: 'Design soil conductivity (W/mK)', positive: true },
  field('rsi_m2k_w', 'Floor internal surface resistance (m²K/W)', '0.17'),
  field('rse_m2k_w', 'Floor external surface resistance (m²K/W)', '0.04'),
];
const floorR = field('floor_resistance_m2k_w', 'Floor build-up R, excluding surfaces (m²K/W)');
const wallFields = [field('wall_resistance_m2k_w', 'Basement wall build-up R, excluding surfaces (m²K/W)'),
  field('wall_rsi_m2k_w', 'Wall internal surface resistance (m²K/W)', '0.13'), field('wall_rse_m2k_w', 'Wall external surface resistance (m²K/W)', '0.04')];
const depth = field('basement_depth_m', 'Basement depth below ground (m)');
const groundScope = 'Annual-average steady-state method. No flowing groundwater, embedded heating or seasonal calculation. Use the complete relevant footprint and exposed perimeter. Resistances must come from a referenced build-up; floor and wall R exclude surfaces.';
export const additionalMethods = {
  edge_insulated_slab: { label: 'Ground slab · perimeter insulation', family: 'edge', scope: `${groundScope} One narrow insulation detail covering the full exposed perimeter. No significant wall/floor junction bridge; partial perimeter coverage or wide edge details require numerical assessment. Edge R excludes displaced soil.`, fields: [...groundFields, floorR,
    { key: 'orientation', label: 'Edge insulation orientation', initial: 'vertical', options: ['vertical', 'horizontal'] }, field('extent_m', 'Edge insulation depth / width (m)'), field('thickness_m', 'Edge insulation through-flow thickness (m)'), field('resistance_m2k_w', 'Edge insulation design R (m²K/W)')] },
  inverted_roof: { label: 'Inverted roof · rainfall correction', family: 'inverted', scope: 'Homogeneous roof with insulation above the waterproof membrane. Use moisture-adjusted design values and heating-season rainfall for this site. Above-membrane R includes the insulation only; below-membrane R excludes surfaces. Ballast thermal resistance is excluded. No metal framing, local tapers or interacting fixing corrections.', fields: [
    field('above_r', 'Insulation R above membrane (m²K/W)'), field('below_r', 'Build-up R below membrane, excluding surfaces (m²K/W)'), field('rainfall_mm_per_day', 'Heating-season rainfall (mm/day)'), field('fx_w_day_m2k_mm', 'Combined drainage / cooling factor fx (W·day/m²K·mm)'),
    { key: 'rainfall_evidence', label: 'Site rainfall reference', text: true }, { key: 'drainage_evidence', label: 'System drainage / cooling factor reference', text: true }, { key: 'design_conductivity_evidence', label: 'Moisture-adjusted insulation design-value reference', text: true }] },
  unheated_space: { label: 'Wall adjoining an unheated space', family: 'unheated', scope: 'Steady-state heat balance to a passive unheated space. Both paths must use consistent boundaries and the same outside temperature. No gains, independent ground temperature or coupled spaces. The separating wall U includes 0.13 m²K/W on each face and all applicable corrections. Hi must represent the complete inside-to-space heat loss, not just this wall.', fields: [
    field('u', 'Separating element U-value (W/m²K)'), field('hi', 'Total inside-to-space heat-loss coefficient Hi (W/K)'), field('he', 'Total space-to-outside heat-loss coefficient He (W/K)')] },
  suspended_ground_floor: { label: 'Suspended ground floor', family: 'ground', scope: `${groundScope} Naturally ventilated void only. Deck U includes its applicable surface resistances.`, fields: [...groundFields,
    field('deck_u_value_w_m2k', 'Separating deck U-value (W/m²K)'), field('floor_height_m', 'Floor height above outside ground (m)'),
    field('underfloor_wall_u_value_w_m2k', 'Underfloor wall U-value (W/m²K)'), field('ventilation_opening_area_per_perimeter_m2_m', 'Ventilation openings per exposed perimeter (m²/m)'),
    field('annual_wind_speed_10m_m_s', 'Annual wind speed at 10 m (m/s)'), field('wind_shielding_factor', 'Wind shielding factor'),
    field('base_depth_m', 'Void base depth below ground (m)'), field('base_insulation_resistance_m2k_w', 'Void base insulation R (m²K/W)'),
    field('below_ground_wall_resistance_m2k_w', 'Below-ground wall R, excluding surfaces (m²K/W)'), ...wallFields.slice(1)] },
  basement_floor: { label: 'Basement floor', family: 'ground', scope: groundScope, fields: [...groundFields, depth, floorR] },
  basement_wall: { label: 'Basement wall', family: 'ground', scope: `${groundScope} The wall calculation also needs the associated basement floor resistance.`, fields: [...groundFields.filter(f => f.key !== 'area_m2'), depth, floorR, ...wallFields] },
  heated_basement: { label: 'Heated basement · floor and walls', family: 'ground', scope: `${groundScope} Result area is the floor plus below-ground walls, not the footprint alone.`, fields: [...groundFields, depth, floorR, ...wallFields] },
  unheated_basement: { label: 'Floor over an unheated basement', family: 'ground', scope: `${groundScope} Basement ventilation is to outside air. Result is referred to the separating deck footprint.`, fields: [...groundFields, depth, floorR, ...wallFields,
    field('deck_u_value_w_m2k', 'Separating deck U-value (W/m²K)'), field('above_ground_wall_height_m', 'Basement wall height above ground (m)'),
    field('above_ground_wall_u_value_w_m2k', 'Above-ground basement wall U-value (W/m²K)'), field('air_changes_per_hour', 'Basement air changes per hour'), field('basement_air_volume_m3', 'Basement air volume (m³)')] },
  ceiling_insulated_roof: { label: 'Roof insulated at ceiling level', family: 'roof', scope: 'Naturally ventilated roof space with an uninsulated external roof envelope. Ceiling R excludes surface resistances. Assess hatches, recessed lights and other local inclusions separately.', fields: [
    field('ceiling_r', 'Ceiling build-up R, excluding surfaces (m²K/W)'), { key: 'roof_covering', label: 'Roof covering', initial: 'tiles_no_underlay', options: ['tiles_no_underlay', 'sheeted_or_tiles_with_underlay', 'low_emissivity_underlay', 'boards_and_felt'] }] },
  rafter_roof_flat_ceiling: { label: 'Rafter roof above a flat ceiling', family: 'roof', scope: 'Simple pitched roof over a flat ceiling. Enter assessed build-up resistances excluding surfaces. The roof/ceiling areas follow the pitch projection. No interacting corrections or local inclusions are modelled.', fields: [
    field('rafter_r', 'Sloping rafter build-up R, excluding surfaces (m²K/W)'), field('ceiling_r', 'Flat ceiling build-up R, excluding surfaces (m²K/W)'), field('pitch_degrees', 'Roof pitch (degrees)')] },
  tapered_roof: { label: 'Tapered insulation roof', family: 'roof', scope: 'One-way rectangular tapers or planar triangular regions only. Regions must cover the entire roof without gaps or overlaps. Base R includes surfaces and all non-tapered layers; entered taper thicknesses include the minimum insulation. No metal framing, curved/bilinear tapers or local correction interactions.', fields: [
    field('base_resistance_m2k_w', 'Base R including surfaces, excluding tapered insulation (m²K/W)'), field('conductivity_w_mk', 'Taper insulation design conductivity (W/mK)')] },
  window: { label: 'Window · supplied component values', family: 'opening', scope: 'Projected whole-opening area method using referenced glazing, frame U-values and glazing-edge Ψ-values. Component areas must sum to the total opening and use consistent boundaries. Installation junction bridges are separate. This does not calculate glazing gases or frame profiles.', fields: [field('total_area_m2', 'Total projected opening area (m²)')] },
  door: { label: 'Door · supplied component values', family: 'opening', scope: 'Projected whole-opening area method using referenced panel, glazing and frame values. Component areas must sum to the total opening and use consistent boundaries. Installation junction bridges are separate. This is not a product rating certificate.', fields: [field('total_area_m2', 'Total projected opening area (m²)')] },
  supplied_u: { label: 'Externally assessed U-value', family: 'assessed', scope: 'Records an externally calculated or certified value with its source and applicable construction. Architect Pro does not independently derive or authenticate this value.', fields: [field('u_value_w_m2k', 'Assessed U-value (W/m²K)')] },
} satisfies Record<string, { label: string; family: string; scope: string; fields: MethodField[] }>;
export type AdditionalMethod = keyof typeof additionalMethods;
export const methodKeys = Object.keys(additionalMethods) as [AdditionalMethod, ...AdditionalMethod[]];
export const isAdditionalMethod = (element: string): element is AdditionalMethod => Object.hasOwn(additionalMethods, element);
export function methodFields(method: AdditionalMethod, values: Record<string, string | number>): MethodField[] {
  const fields: MethodField[] = additionalMethods[method].fields;
  return method === 'suspended_ground_floor' && !(Number(values.base_depth_m) > 0.5)
    ? fields.filter(f => !['below_ground_wall_resistance_m2k_w', 'wall_rsi_m2k_w', 'wall_rse_m2k_w'].includes(f.key)) : fields;
}
const evidence = z.string().trim().max(600);
export const methodDataSchema = z.object({
  values: z.record(z.union([z.number().finite().min(0).max(1e7), z.string().max(600)])).refine(v => Object.keys(v).length <= 24, 'Too many method inputs.'),
  source: evidence, applicabilityConfirmed: z.boolean(),
  components: z.array(z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(['frame', 'glazing', 'panel']), area_m2: z.number().finite().positive().max(1e6), u_value_w_m2k: z.number().finite().positive().max(100), evidence: evidence.min(1) }).strict()).max(32).default([]),
  edges: z.array(z.object({ name: z.string().trim().min(1).max(120), length_m: z.number().finite().min(0).max(1e6), psi_w_mk: z.number().finite().min(0).max(100), evidence: evidence.min(1) }).strict()).max(32).default([]),
  regions: z.array(z.object({ name: z.string().trim().min(1).max(120), shape: z.enum(['rectangle', 'triangle']), area_m2: z.number().finite().positive().max(1e6), thicknesses_mm: z.array(z.number().finite().min(0).max(2000)).min(2).max(3) }).strict()).max(32).default([]),
}).strict();
export type MethodData = z.infer<typeof methodDataSchema>;
export const friendlyOption = (value: string) => ({ tiles_no_underlay: 'Tiles without underlay', sheeted_or_tiles_with_underlay: 'Sheeting or tiles with underlay', low_emissivity_underlay: 'Low-emissivity underlay', boards_and_felt: 'Boards and felt' }[value] || value);
export const formatWorkingNumber = (value: number) => String(Number(value.toPrecision(10)));
export function calculateAdditionalMethod(method: AdditionalMethod, data: MethodData) {
  if (!data.applicabilityConfirmed) throw new Error('Confirm that this construction meets the method’s stated conditions.');
  const definition = additionalMethods[method];
  const fields = methodFields(method, data.values);
  if (Object.keys(data.values).some(key => !fields.some(field => field.key === key))) throw new Error('Unexpected inputs for this calculation method.');
  for (const field of fields) {
    const value = data.values[field.key];
    if (field.options ? !field.options.includes(String(value)) : field.text ? typeof value !== 'string' || !value.trim() : typeof value !== 'number' || !Number.isFinite(value) || (field.positive && value <= 0)) throw new Error(`Enter a valid value for ${field.label.toLowerCase()}.`);
  }
  if (definition.family !== 'opening' && (data.components.length || data.edges.length)) throw new Error('Opening components are not applicable to this method.');
  if (method !== 'tapered_roof' && data.regions.length) throw new Error('Tapered regions are not applicable to this method.');
  const v = data.values;
  let construction: Record<string, unknown> = { element: method };
  if (definition.family === 'ground') construction.ground = { ...v, edge_insulation: 'none', flowing_groundwater: false, embedded_heating: false,
    ...(method === 'suspended_ground_floor' ? { ventilation: 'natural' } : method === 'unheated_basement' ? { ventilation: 'external_air' } : {}) };
  if (method === 'edge_insulated_slab') {
    const { orientation, extent_m, thickness_m, resistance_m2k_w, ...ground } = v;
    construction = { element: 'slab_on_ground', ground: { ...ground, basement_depth_m: 0, edge_insulation_small_extent: true, edge_junction_thermal_bridge_free: true,
      edge_insulation: [{ orientation, extent_m, thickness_m, resistance_m2k_w }], flowing_groundwater: false, embedded_heating: false } };
  }
  if (method === 'inverted_roof') construction = { element: 'layered_roof', heat_flow: 'up', rsi: .1, rse: .04, omit_small_corrections: false,
    layers: [{ resistance: v.above_r }, ...(Number(v.below_r) > 0 ? [{ resistance: v.below_r }] : [])],
    corrections: [{ kind: 'inverted_roof_rain', layer_indices: [0], rainfall_mm_per_day: v.rainfall_mm_per_day, fx_w_day_m2k_mm: v.fx_w_day_m2k_mm, ballast_excluded: true,
      rainfall_evidence: v.rainfall_evidence, drainage_evidence: v.drainage_evidence, design_conductivity_evidence: v.design_conductivity_evidence }] };
  if (method === 'unheated_space') {
    const r = 1 / Number(v.u) - .26;
    if (!Number.isFinite(r) || r <= 0) throw new Error('Separating element U must include 0.13 m²K/W on each face and a positive build-up resistance.');
    construction = { element: 'layered_wall', rsi: .13, rse: .13, layers: [{ resistance: r }],
      unheated_space: { method: 'heat_balance', h_inside_to_unheated_w_k: v.hi, h_unheated_to_outside_w_k: v.he, ground_heat_transfer: false, heat_sources: false, coupled_unheated_spaces: false } };
  }
  if (definition.family === 'opening') construction.opening = { total_area_m2: v.total_area_m2, components: data.components, edges: data.edges, projected_areas_non_overlapping: true, component_boundaries_consistent: true };
  if (method === 'supplied_u') construction = { ...construction, u_value_w_m2k: v.u_value_w_m2k, evidence: data.source || 'Working draft; source required before saving.' };
  if (method === 'ceiling_insulated_roof') construction = { ...construction, heat_flow: 'up', rsi: 0.1, rse: 0.04, layers: [{ resistance: v.ceiling_r }], roof_space: { ventilation: 'natural', external_envelope_insulated: false, roof_covering: v.roof_covering } };
  if (method === 'rafter_roof_flat_ceiling') construction = { ...construction, heat_flow: 'up', rsi: 0.1, rse: 0.04, layers: [{ resistance: v.rafter_r }], ceiling_layers: [{ resistance: v.ceiling_r }], roof: { pitch_degrees: v.pitch_degrees } };
  if (method === 'tapered_roof') construction.roof = { ...v, regions: data.regions, regions_partition_roof: true };
  const result = calculateConstruction(construction);
  const working = fields.map(field => ({ label: field.label, value: typeof v[field.key] === 'number' ? formatWorkingNumber(v[field.key] as number) : friendlyOption(String(v[field.key])) }));
  if (typeof result.reference_area_m2 === 'number') working.push({ label: 'Result reference area (m²)', value: String(result.reference_area_m2) });
  if (typeof result.heat_loss_coefficient_w_k === 'number') working.push({ label: 'Heat-loss coefficient (W/K)', value: result.heat_loss_coefficient_w_k.toFixed(8) });
  return { result, working, scope: definition.scope, label: definition.label };
}
