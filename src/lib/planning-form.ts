// Which ePlanning form a planning application uses: Householder or Planning Permission.
// Decided from what the drawings show, then the project scope; the architect can change it.
// Runs in the browser too, so it must not import the database client.

export type PlanningFormKey = 'HOUSEHOLDER' | 'PLANNING_PERMISSION';
export type PlanningJobType = 'HOUSEHOLDER_PLANNING' | 'PLANNING_APPLICATION';

export const PLANNING_FORMS: Record<PlanningFormKey, { label: string; description: string; jobType: PlanningJobType }> = {
  HOUSEHOLDER: {
    label: 'Householder',
    description: 'Works to an existing house or its garden',
    jobType: 'HOUSEHOLDER_PLANNING',
  },
  PLANNING_PERMISSION: {
    label: 'Planning Permission',
    description: 'New dwellings, flats, change of use or commercial work',
    jobType: 'PLANNING_APPLICATION',
  },
};
export const PLANNING_FORM_KEYS = Object.keys(PLANNING_FORMS) as PlanningFormKey[];

export type PlanningFormFact = { fieldKey: string; value: string | number | boolean };
export type PlanningFormSuggestion = { form: PlanningFormKey; reason: string; source: 'drawings' | 'scope' };
export type StoredPlanningForm = {
  form: PlanningFormKey;
  chosenBy: 'SUGGESTED' | 'USER';
  reason: string | null;
  suggestedForm: PlanningFormKey | null;
  chosenAt: string;
};
export type EffectivePlanningForm = {
  form: PlanningFormKey;
  /** USER: changed by the architect. SUGGESTED: picked from drawings or scope. RUN: an earlier run's form. */
  chosenBy: 'USER' | 'SUGGESTED' | 'RUN' | 'DEFAULT';
  reason: string | null;
};

const FLAT = /\b(flat|flats|maisonette|maisonettes|apartment|apartments)\b/i;
const NEW_DWELLING = /\b(erection|construction) of\b.*\b(dwelling|dwellings|house|houses)\b|\bnew (dwelling|dwellings|house|houses)\b/i;
const RESIDENTIAL_USE = /\b(dwelling|house|home|residential|domestic)\b/i;
const MAX_QUOTE = 160;

const quote = (text: string) => (text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE - 1).trimEnd()}…` : text);
const fromDrawings = (text: string) => `From the drawings: ${quote(text)}`;
const fromScope = (text: string) => `From the project scope: ${text}`;

const textsOf = (facts: readonly PlanningFormFact[], key: string) => facts
  .filter((fact) => fact.fieldKey === key && typeof fact.value === 'string' && fact.value.trim())
  .map((fact) => String(fact.value).trim());

/** The full-permission reason the drawings give, if any. */
const permissionFromDrawings = (facts: readonly PlanningFormFact[]) => {
  const descriptions = textsOf(facts, 'application.descriptionOfWork');
  const currentUses = textsOf(facts, 'application.currentUse');
  const proposedUses = textsOf(facts, 'application.proposedUse');
  const workTypes = textsOf(facts, 'project.typeOfWork').map((value) => value.toLowerCase());
  const flat = [...descriptions, ...currentUses, ...proposedUses].find((text) => FLAT.test(text));
  if (flat) return fromDrawings(`${flat} (works to a flat need full planning permission)`);
  const dwelling = descriptions.find((text) => NEW_DWELLING.test(text));
  if (dwelling) return fromDrawings(dwelling);
  if (workTypes.includes('new build')) return fromDrawings('new build');
  if (workTypes.includes('conversion / change of use')) return fromDrawings('conversion or change of use');
  const current = currentUses[0];
  const proposed = proposedUses[0];
  if (current && proposed && RESIDENTIAL_USE.test(current) !== RESIDENTIAL_USE.test(proposed)) {
    return fromDrawings(`change of use from ${current} to ${proposed}`);
  }
  if (textsOf(facts, 'project.buildingUse').some((value) => value.toLowerCase() === 'commercial')) {
    return fromDrawings('commercial building');
  }
  return null;
};

const permissionFromScope = (buildingUse: string | null | undefined, workTypes: readonly string[]) => {
  if (buildingUse === 'commercial') return fromScope('commercial building');
  if (workTypes.includes('new_build')) return fromScope('new build');
  if (workTypes.includes('conversion_change_of_use')) return fromScope('conversion or change of use');
  return null;
};

export const suggestPlanningForm = (input: {
  buildingUse?: string | null;
  typeOfWorkKeys: readonly string[];
  facts: readonly PlanningFormFact[];
}): PlanningFormSuggestion | null => {
  // Anything that needs full permission wins, whichever source shows it.
  const drawings = permissionFromDrawings(input.facts);
  if (drawings) return { form: 'PLANNING_PERMISSION', reason: drawings, source: 'drawings' };
  const scope = permissionFromScope(input.buildingUse, input.typeOfWorkKeys);
  if (scope) return { form: 'PLANNING_PERMISSION', reason: scope, source: 'scope' };

  const description = textsOf(input.facts, 'application.descriptionOfWork')[0];
  if (description) return { form: 'HOUSEHOLDER', reason: fromDrawings(description), source: 'drawings' };
  if (textsOf(input.facts, 'project.typeOfWork').some((value) => value.toLowerCase() === 'domestic alteration / extension')) {
    return { form: 'HOUSEHOLDER', reason: fromDrawings('alteration or extension to a house'), source: 'drawings' };
  }
  if (input.buildingUse === 'residential' && input.typeOfWorkKeys.includes('domestic_alteration_extension')) {
    return { form: 'HOUSEHOLDER', reason: fromScope('alteration or extension to a house'), source: 'scope' };
  }
  return null;
};

const isFormKey = (value: unknown): value is PlanningFormKey => value === 'HOUSEHOLDER' || value === 'PLANNING_PERMISSION';

export const readPlanningForm = (preparationData: unknown): StoredPlanningForm | null => {
  if (!preparationData || typeof preparationData !== 'object' || Array.isArray(preparationData)) return null;
  const value = (preparationData as { planningForm?: unknown }).planningForm;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isFormKey(record.form) || (record.chosenBy !== 'SUGGESTED' && record.chosenBy !== 'USER')) return null;
  return {
    form: record.form,
    chosenBy: record.chosenBy,
    reason: typeof record.reason === 'string' ? record.reason : null,
    suggestedForm: isFormKey(record.suggestedForm) ? record.suggestedForm : null,
    chosenAt: typeof record.chosenAt === 'string' ? record.chosenAt : '',
  };
};

export const planningFormForJobType = (type: string | null | undefined): PlanningFormKey | null =>
  type === 'HOUSEHOLDER_PLANNING' ? 'HOUSEHOLDER' : type === 'PLANNING_APPLICATION' ? 'PLANNING_PERMISSION' : null;

export const effectivePlanningForm = (input: {
  stored: StoredPlanningForm | null;
  latestJobType?: string | null;
  suggestion: PlanningFormSuggestion | null;
}): EffectivePlanningForm => {
  if (input.stored) return { form: input.stored.form, chosenBy: input.stored.chosenBy, reason: input.stored.reason };
  const fromRun = planningFormForJobType(input.latestJobType);
  if (fromRun) return { form: fromRun, chosenBy: 'RUN', reason: null };
  if (input.suggestion) return { form: input.suggestion.form, chosenBy: 'SUGGESTED', reason: input.suggestion.reason };
  return { form: 'HOUSEHOLDER', chosenBy: 'DEFAULT', reason: null };
};
