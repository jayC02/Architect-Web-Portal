export const TYPE_OF_WORK_OPTIONS = [
  'Domestic alteration / extension',
  'New build',
  'Conversion / change of use',
  'Demolition',
] as const;

export type TypeOfWork = (typeof TYPE_OF_WORK_OPTIONS)[number];

export const buildingWarrantProfileForTypeOfWork = (value: string | null | undefined): TypeOfWork => {
  const normalised = String(value ?? '').trim().toLowerCase();
  const exact = TYPE_OF_WORK_OPTIONS.find((option) => option.toLowerCase() === normalised);
  if (exact) return exact;

  // Existing projects may still contain one of the older free-text values.
  if (normalised.includes('demol')) return 'Demolition';
  if (normalised.includes('convert') || normalised.includes('change of use')) {
    return 'Conversion / change of use';
  }
  if (normalised.includes('new build') || normalised.includes('new-build')) return 'New build';
  return 'Domestic alteration / extension';
};
