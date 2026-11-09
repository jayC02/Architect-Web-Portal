// Which preparation-page section answers each preflight requirement.
// Returns null when the requirement is not answered on the page, such as a missing document.
export type WarrantSectionId = 'work' | 'owner' | 'site' | 'sustainability' | 'certificates' | 'fee' | 'review';

const rules: Array<[RegExp, WarrantSectionId | null]> = [
  [/^documents\./, null],
  [/owner/i, 'owner'],
  [/sustainab/i, 'sustainability'],
  [/declaration/i, 'review'],
  [/fee|disabledPersons/i, 'fee'],
  [/certif/i, 'certificates'],
  [/fire|listing|listed|historical|dangerous|relaxation|stas/i, 'site'],
];

export const warrantSectionForRequirement = (field: string): WarrantSectionId | null => {
  for (const [pattern, section] of rules) if (pattern.test(field)) return section;
  return 'work';
};
