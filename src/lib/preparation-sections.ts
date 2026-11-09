// Which preparation-page section answers each preflight requirement.
// Returns null when the requirement is not answered on the page, such as a missing document.
export type WarrantSectionId = 'details' | 'questions' | 'sustainability' | 'certificates' | 'fee' | 'declaration';

const rules: Array<[RegExp, WarrantSectionId | null]> = [
  [/^documents\./, null],
  [/owner/i, 'questions'],
  [/sustainab/i, 'sustainability'],
  [/declaration/i, 'declaration'],
  [/fee|disabledPersons/i, 'fee'],
  [/certif/i, 'certificates'],
  [/fire|listing|listed|historical|dangerous|relaxation|stas/i, 'questions'],
];

export const warrantSectionForRequirement = (field: string): WarrantSectionId | null => {
  for (const [pattern, section] of rules) if (pattern.test(field)) return section;
  return 'details';
};
