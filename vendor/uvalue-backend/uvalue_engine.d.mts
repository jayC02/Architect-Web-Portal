export type PlaneInput = {
  element: 'layered_wall' | 'layered_roof' | 'exposed_floor'; heat_flow: 'horizontal' | 'up' | 'down';
  rsi: number; rse: number; fractions: number[]; omit_small_corrections: boolean;
  layers: { name: string; thickness_mm: number; conductivity?: number; conductivities?: number[]; resistance?: number }[];
};
export function calculateUValue(input: PlaneInput): {
  r_upper: number; r_lower: number; r_total: number; path_resistances: number[];
  u_uncorrected: number; u_value: number; warnings: string[];
};
export function calculatePlaneLayers(input: PlaneInput): ReturnType<typeof calculateUValue>;
export function calculateSlabOnGround(input: {
  area_m2: number; exposed_perimeter_m: number; wall_thickness_m: number; soil_conductivity_w_mk: number;
  floor_resistance_m2k_w: number; rsi_m2k_w: number; rse_m2k_w: number; edge_insulation: 'none'; basement_depth_m: 0;
}): { u_value: number; characteristic_dimension_m: number; equivalent_ground_thickness_m: number; branch: string };
export function unventilatedAirLayerResistance(input: {
  thickness_mm: number; width_mm: number; height_mm: number; heat_flow: 'horizontal' | 'up' | 'down';
  method: 'table' | 'iso_6946_annex_d'; emissivity_1: number; emissivity_2: number; emissivity_evidence: string;
}): { resistance: number; warnings: string[]; method: string; references: string[] };
export function airGapCorrection(level: 0 | 1 | 2, insulationResistance: number, totalResistance: number): number;
export function discreteFastenerCorrection(input: {
  fastener_conductivity_w_mk: number; cross_section_area_mm2: number; count_per_m2: number;
  insulation_thickness_mm: number; metal_penetration_mm: number; insulation_conductivity_w_mk: number;
  total_homogeneous_resistance_m2k_w: number; both_ends_contact_metal: false; angle_degrees: 0;
}): { delta_u: number; alpha: number; penetrated_insulation_resistance_m2k_w: number;
  total_homogeneous_resistance_m2k_w: number; metal_penetration_mm: number; exemption: string | null };
