/** Architect Pro adapter types. Runtime validation remains in schema.mjs. */
export function calculateConstruction(input: Record<string, unknown>): {
  u_value: number; method: string; warnings?: string[]; reference_area_m2?: number;
  heat_loss_coefficient_w_k?: number; [key: string]: unknown;
};
