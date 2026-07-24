export const UK_PHONE_HTML_PATTERN =
  String.raw`(?:\+44\s?\d(?:\s?\d){8,9}|0\d(?:\s?\d){8,9})`;

export const blankContactToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const isValidUkPhone = (value: string) => {
  const compact = value.replace(/\s/g, '');
  return /^(?:\+44\d{9,10}|0\d{9,10})$/.test(compact);
};
