export const resolveSoleOwner = (savedValue: unknown): boolean =>
  typeof savedValue === 'boolean' ? savedValue : true;
