import { uValueInputSchema, type UValueInput } from './calculator';
import { z } from 'zod';
import { additionalMethods, isAdditionalMethod, methodKeys, methodFields, type AdditionalMethod, type MethodField } from './methods';

export type MethodDraft = {
  values: Record<string, string>; source: string; applicabilityConfirmed: boolean;
  components: { name: string; kind: 'frame' | 'glazing' | 'panel'; area: string; u: string; source: string }[];
  edges: { name: string; length: string; psi: string; source: string }[];
  regions: { name: string; shape: 'rectangle' | 'triangle'; area: string; thickness1: string; thickness2: string; thickness3: string }[];
};
export const emptyMethodDraft = (method?: AdditionalMethod): MethodDraft => ({
  values: Object.fromEntries(method ? additionalMethods[method].fields.map((field: MethodField) => [field.key, field.initial || '']) : []),
  source: '', applicabilityConfirmed: false, components: [], edges: [], regions: [],
});

export type LayerDraft = {
  id: string; kind: 'solid' | 'resistance' | 'air'; name: string; productId: string;
  thickness: string; lambda: string; resistance: string; source: string;
  ventilation: 'unventilated' | 'slightly' | 'well'; openings: string;
  airMode: 'assessed' | 'table' | 'emissivity'; width: string; height: string;
  emissivity1: string; emissivity2: string; emissivityEvidence: string;
  bridged: boolean; bridgeName: string; bridgeLambda: string; bridgeFraction: string; bridgeGroup: string; bridgeSource: string;
};
export type CalculationDraft = {
  title: string; projectId: string; reference: string; location: string;
  basedOnId: string | null;
  element: UValueInput['element']; construction: UValueInput['construction'];
  heatFlow: UValueInput['heatFlow']; correctionsAssessed: boolean;
  layers: LayerDraft[]; target: string; targetReference: string;
  area: string; perimeter: string; wallThickness: string; soilLambda: string; groundSource: string;
  groundConfiguration: NonNullable<UValueInput['ground']>['configuration'];
  corrections: { id: string; name: string; value: string; source: string }[];
  automaticCorrections: AutomaticCorrectionDraft[];
  methodData: MethodDraft;
};
export type AutomaticCorrectionDraft = {
  id: string; kind: 'airgap' | 'fastener'; layerId: string; level: '0' | '1' | '2'; source: string;
  conductivity: string; diameter: string; count: string; penetration: 'full' | 'recessed'; penetrationDepth: string; applicabilityConfirmed: boolean;
};
export const newAutomaticCorrection = (id: string, kind: AutomaticCorrectionDraft['kind'], layerId = ''): AutomaticCorrectionDraft => ({
  id, kind, layerId, level: '1', source: '', conductivity: '', diameter: '', count: '', penetration: 'full', penetrationDepth: '', applicabilityConfirmed: false,
});
export const newLayer = (id: string, kind: LayerDraft['kind'] = 'solid'): LayerDraft => ({
  id, kind, name: '', productId: '', thickness: kind === 'air' ? '50' : '', lambda: '', resistance: '', source: '',
  ventilation: 'unventilated', openings: '1000', bridged: false, bridgeName: 'Timber framing',
  airMode: 'assessed', width: '', height: '', emissivity1: '0.9', emissivity2: '0.9', emissivityEvidence: '',
  bridgeLambda: '0.13', bridgeFraction: '15', bridgeGroup: 'frame-1', bridgeSource: '',
});
export const emptyCalculation = (): CalculationDraft => ({
  title: '', projectId: '', reference: '', location: '', basedOnId: null, element: 'wall', construction: 'standard', layers: [],
  heatFlow: 'automatic', correctionsAssessed: false,
  target: '', targetReference: '', area: '', perimeter: '', wallThickness: '300', soilLambda: '2',
  groundSource: '',
  groundConfiguration: 'uniform-slab', corrections: [], automaticCorrections: [], methodData: emptyMethodDraft(),
});
const numeric = (value: string) => value.trim() ? Number(value) : NaN;
const draftText = z.string().max(2000);
const layerDraftSchema = z.object({
  id: z.string().min(1).max(80), kind: z.enum(['solid', 'resistance', 'air']), name: draftText, productId: draftText,
  thickness: draftText, lambda: draftText, resistance: draftText, source: draftText,
  ventilation: z.enum(['unventilated', 'slightly', 'well']), openings: draftText, bridged: z.boolean(),
  airMode: z.enum(['assessed', 'table', 'emissivity']).default('assessed'), width: draftText.default(''), height: draftText.default(''),
  emissivity1: draftText.default('0.9'), emissivity2: draftText.default('0.9'), emissivityEvidence: draftText.default(''),
  bridgeName: draftText, bridgeLambda: draftText, bridgeFraction: draftText, bridgeGroup: draftText, bridgeSource: draftText,
});
const draftSchema = z.object({
  title: draftText, projectId: draftText, reference: draftText, location: draftText,
  basedOnId: z.string().min(1).max(120).nullable().default(null),
  element: z.enum(['wall', 'roof', 'exposed-floor', 'ground-slab', ...methodKeys]), construction: z.enum(['standard', 'steel-frame', 'inverted-roof', 'specialist']),
  methodData: z.object({ values: z.record(draftText), source: draftText, applicabilityConfirmed: z.boolean(),
    components: z.array(z.object({ name: draftText, kind: z.enum(['frame', 'glazing', 'panel']), area: draftText, u: draftText, source: draftText })).max(32),
    edges: z.array(z.object({ name: draftText, length: draftText, psi: draftText, source: draftText })).max(32),
    regions: z.array(z.object({ name: draftText, shape: z.enum(['rectangle', 'triangle']), area: draftText, thickness1: draftText, thickness2: draftText, thickness3: draftText })).max(32),
  }).default(emptyMethodDraft),
  heatFlow: z.enum(['automatic', 'upwards', 'horizontal', 'downwards']).default('automatic'), correctionsAssessed: z.boolean().default(false),
  layers: z.array(layerDraftSchema).max(32), target: draftText, targetReference: draftText,
  area: draftText, perimeter: draftText, wallThickness: draftText, soilLambda: draftText, groundSource: draftText,
  groundConfiguration: z.enum(['uniform-slab', 'edge-insulated', 'suspended', 'basement', 'flowing-groundwater']),
  corrections: z.array(z.object({ id: draftText, name: draftText, value: draftText, source: draftText })).max(12),
  automaticCorrections: z.array(z.object({ id: draftText, kind: z.enum(['airgap', 'fastener']), layerId: draftText,
    level: z.enum(['0', '1', '2']), source: draftText, conductivity: draftText, diameter: draftText, count: draftText,
    penetration: z.enum(['full', 'recessed']), penetrationDepth: draftText, applicabilityConfirmed: z.boolean(),
  })).max(12).default([]),
});
export function parseStoredDraft(raw: unknown): CalculationDraft | null {
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success || new Set(parsed.data.layers.map(layer => layer.id)).size !== parsed.data.layers.length) return null;
  return parsed.data;
}
export function draftInputs(draft: CalculationDraft): unknown {
  if (isAdditionalMethod(draft.element)) {
    const data = draft.methodData;
    const fields = methodFields(draft.element, data.values);
    return { element: draft.element, construction: 'standard', heatFlow: 'automatic', correctionsAssessed: draft.correctionsAssessed,
      layers: [], corrections: [], automaticCorrections: [], ground: null,
      target: draft.target.trim() ? numeric(draft.target) : null, targetReference: draft.targetReference,
      methodData: { values: Object.fromEntries(fields.map(field => [field.key, field.options || field.text ? data.values[field.key] : numeric(data.values[field.key] || '')])),
        source: data.source, applicabilityConfirmed: data.applicabilityConfirmed,
        components: data.components.map(c => ({ name: c.name, kind: c.kind, area_m2: numeric(c.area), u_value_w_m2k: numeric(c.u), evidence: c.source })),
        edges: data.edges.map(e => ({ name: e.name, length_m: numeric(e.length), psi_w_mk: numeric(e.psi), evidence: e.source })),
        regions: data.regions.map(r => ({ name: r.name, shape: r.shape, area_m2: numeric(r.area), thicknesses_mm: [r.thickness1, r.thickness2, ...(r.shape === 'triangle' ? [r.thickness3] : [])].map(numeric) })),
      },
    };
  }
  return {
    element: draft.element, construction: draft.construction,
    heatFlow: draft.heatFlow, correctionsAssessed: draft.correctionsAssessed,
    layers: draft.layers.map(layer => {
      const common = { id: layer.id, name: layer.name, thicknessMm: numeric(layer.thickness || (layer.kind === 'resistance' ? '0' : '')), source: layer.source };
      if (layer.kind === 'solid') return { ...common, kind: layer.kind, lambda: numeric(layer.lambda), productId: layer.productId || null,
        bridge: layer.bridged ? { name: layer.bridgeName, lambda: numeric(layer.bridgeLambda), fraction: numeric(layer.bridgeFraction) / 100,
          group: layer.bridgeGroup, source: layer.bridgeSource } : null };
      if (layer.kind === 'air') return { ...common, kind: layer.kind, resistance: layer.airMode === 'assessed' ? numeric(layer.resistance) : null,
        ventilation: layer.ventilation, openings: numeric(layer.openings), airMode: layer.airMode,
        widthMm: layer.airMode === 'assessed' ? null : numeric(layer.width), heightMm: layer.airMode === 'assessed' ? null : numeric(layer.height),
        emissivity1: layer.airMode === 'emissivity' ? numeric(layer.emissivity1) : 0.9, emissivity2: layer.airMode === 'emissivity' ? numeric(layer.emissivity2) : 0.9,
        emissivityEvidence: layer.airMode === 'emissivity' ? layer.emissivityEvidence : '' };
      return { ...common, kind: layer.kind, resistance: numeric(layer.resistance) };
    }),
    ground: draft.element === 'ground-slab' ? { area: numeric(draft.area), perimeter: numeric(draft.perimeter),
      wallThicknessMm: numeric(draft.wallThickness), soilLambda: numeric(draft.soilLambda), source: draft.groundSource,
      configuration: draft.groundConfiguration } : null,
    corrections: draft.corrections.map(item => ({ name: item.name, deltaU: numeric(item.value), source: item.source })),
    automaticCorrections: draft.automaticCorrections.map(item => item.kind === 'airgap'
      ? { kind: item.kind, layerId: item.layerId, level: Number(item.level), source: item.source }
      : { kind: item.kind, layerId: item.layerId, source: item.source, conductivity: numeric(item.conductivity), diameterMm: numeric(item.diameter),
        countPerM2: numeric(item.count), penetration: item.penetration, penetrationMm: item.penetration === 'full' ? null : numeric(item.penetrationDepth), applicabilityConfirmed: item.applicabilityConfirmed }),
    target: draft.target.trim() ? numeric(draft.target) : null, targetReference: draft.targetReference,
  };
}
export function restoredDraft(rawInput: UValueInput, metadata: Partial<CalculationDraft> = {}): CalculationDraft {
  const input = uValueInputSchema.parse(rawInput);
  return { ...emptyCalculation(), ...metadata, element: input.element, construction: input.construction,
    methodData: input.methodData ? {
      values: Object.fromEntries(Object.entries(input.methodData.values).map(([key, value]) => [key, String(value)])), source: input.methodData.source, applicabilityConfirmed: input.methodData.applicabilityConfirmed,
      components: input.methodData.components.map(c => ({ name: c.name, kind: c.kind, area: String(c.area_m2), u: String(c.u_value_w_m2k), source: c.evidence })),
      edges: input.methodData.edges.map(e => ({ name: e.name, length: String(e.length_m), psi: String(e.psi_w_mk), source: e.evidence })),
      regions: input.methodData.regions.map(r => ({ name: r.name, shape: r.shape, area: String(r.area_m2), thickness1: String(r.thicknesses_mm[0]), thickness2: String(r.thicknesses_mm[1]), thickness3: r.thicknesses_mm[2] == null ? '' : String(r.thicknesses_mm[2]) })),
    } : emptyMethodDraft(),
    heatFlow: input.heatFlow, correctionsAssessed: input.correctionsAssessed,
    target: input.target == null ? '' : String(input.target), targetReference: input.targetReference,
    layers: input.layers.map(layer => ({ ...newLayer(layer.id, layer.kind), name: layer.name,
      thickness: String(layer.thicknessMm), source: layer.source,
      ...(layer.kind === 'solid' ? { productId: layer.productId || '', lambda: String(layer.lambda), bridged: Boolean(layer.bridge),
        ...(layer.bridge ? { bridgeName: layer.bridge.name, bridgeLambda: String(layer.bridge.lambda), bridgeFraction: String(layer.bridge.fraction * 100),
          bridgeGroup: layer.bridge.group, bridgeSource: layer.bridge.source } : {}) } : { resistance: layer.resistance == null ? '' : String(layer.resistance) }),
      ...(layer.kind === 'air' ? { ventilation: layer.ventilation, openings: String(layer.openings), airMode: layer.airMode,
        width: layer.widthMm == null ? '' : String(layer.widthMm), height: layer.heightMm == null ? '' : String(layer.heightMm),
        emissivity1: String(layer.emissivity1), emissivity2: String(layer.emissivity2), emissivityEvidence: layer.emissivityEvidence } : {}),
    })),
    ...(input.ground ? { area: String(input.ground.area), perimeter: String(input.ground.perimeter),
      wallThickness: String(input.ground.wallThicknessMm), soilLambda: String(input.ground.soilLambda),
      groundConfiguration: input.ground.configuration, groundSource: input.ground.source } : {}),
    corrections: input.corrections.map((item, index) => ({ id: `correction-${index}`, name: item.name, value: String(item.deltaU), source: item.source })),
    automaticCorrections: input.automaticCorrections.map((item, index) => ({ ...newAutomaticCorrection(`automatic-${index}`, item.kind, item.layerId), source: item.source,
      ...(item.kind === 'airgap' ? { level: String(item.level) as '0' | '1' | '2' } : { conductivity: String(item.conductivity), diameter: String(item.diameterMm),
        count: String(item.countPerM2), penetration: item.penetration, penetrationDepth: item.penetrationMm == null ? '' : String(item.penetrationMm), applicabilityConfirmed: item.applicabilityConfirmed }) })),
  };
}
