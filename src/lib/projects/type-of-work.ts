export const TYPE_OF_WORK_DEFINITIONS = [
  { key: 'domestic_alteration_extension', label: 'Domestic alteration / extension' },
  { key: 'new_build', label: 'New build' },
  { key: 'conversion_change_of_use', label: 'Conversion / change of use' },
  { key: 'demolition', label: 'Demolition' },
] as const;

export const TYPE_OF_WORK_KEYS = TYPE_OF_WORK_DEFINITIONS.map(({ key }) => key);
export const TYPE_OF_WORK_OPTIONS = TYPE_OF_WORK_DEFINITIONS.map(({ label }) => label);

export type TypeOfWorkKey = (typeof TYPE_OF_WORK_DEFINITIONS)[number]['key'];
export type TypeOfWork = (typeof TYPE_OF_WORK_DEFINITIONS)[number]['label'];

export const typeOfWorkKey = (value: string | null | undefined): TypeOfWorkKey => {
  const normalised = String(value ?? '').trim().toLowerCase();
  const exact = TYPE_OF_WORK_DEFINITIONS.find(
    (option) => option.key === normalised || option.label.toLowerCase() === normalised,
  );
  if (exact) return exact.key;

  // Existing projects may still contain one of the older free-text values.
  if (normalised.includes('demol')) return 'demolition';
  if (normalised.includes('convert') || normalised.includes('change of use')) {
    return 'conversion_change_of_use';
  }
  if (normalised.includes('new build') || normalised.includes('new-build')) return 'new_build';
  return 'domestic_alteration_extension';
};

export const typeOfWorkLabel = (value: string | null | undefined): TypeOfWork =>
  TYPE_OF_WORK_DEFINITIONS.find((option) => option.key === typeOfWorkKey(value))?.label
  ?? 'Domestic alteration / extension';

export const buildingWarrantProfileForTypeOfWork = typeOfWorkLabel;
