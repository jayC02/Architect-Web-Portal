export const UK_PHONE_HTML_PATTERN =
  String.raw`(?:\+44\s?\d(?:\s?\d){8,9}|0\d(?:\s?\d){8,9})`;

export const blankContactToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const isValidUkPhone = (value: string) => {
  const compact = value.replace(/\s/g, '');
  return /^(?:\+44\d{9,10}|0\d{9,10})$/.test(compact);
};

export const agentPhoneError = (value: string | null | undefined): string | null => {
  if (!value?.trim()) return 'Enter the agent telephone number required by eDevelopment.';
  if (value.trim().length > 30 || !isValidUkPhone(value)) return 'Enter a valid UK agent telephone number.';
  return null;
};
