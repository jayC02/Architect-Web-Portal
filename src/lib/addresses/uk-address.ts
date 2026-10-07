/** Conservative parsing shared by extraction, review and record matching. */
export type AddressParts = {
  buildingNumber?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  townCity?: string | null;
  postcode?: string | null;
};

const postcodePattern = /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/gi;
export const normalisePostcode = (value: string | null | undefined): string | null => {
  const compact = value?.trim().toUpperCase().replace(/\s+/g, '') ?? '';
  return /^(?:GIR0AA|[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2})$/.test(compact)
    ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : null;
};

export const normaliseUkAddress = <T extends AddressParts>(input: T): T & AddressParts => {
  const result: T & AddressParts = { ...input };
  let line = input.addressLine1?.trim() ?? '';
  // Do not reinterpret flat identifiers, named buildings, or an explicit different number.
  const number = line.match(/^(\d+[A-Z]?(?:\s*[-\u2013/]\s*\d+[A-Z]?)?)\s+(.+)$/i);
  if (number && (!input.buildingNumber?.trim()
    || input.buildingNumber.replace(/\s/g, '').toUpperCase() === number[1].replace(/\s/g, '').toUpperCase())) {
    result.buildingNumber = number[1].replace(/\s/g, '').replace(/\u2013/g, '-');
    line = number[2];
  }
  const embedded = [...new Set([line, input.addressLine2, input.townCity]
    .flatMap(value => value?.match(postcodePattern) ?? []).map(value => normalisePostcode(value)))];
  const suppliedPostcode = normalisePostcode(input.postcode);
  const postcode = suppliedPostcode ?? (!input.postcode?.trim() && embedded.length === 1 ? embedded[0] : null);
  if (postcode && embedded.every(value => value === postcode)) {
    result.postcode = postcode;
    const strip = (value: string) => value.replace(postcodePattern, '').replace(/[\s,]+$/, '').trim();
    line = strip(line);
    if (input.addressLine2) result.addressLine2 = strip(input.addressLine2) || null;
    if (input.townCity) result.townCity = strip(input.townCity) || null;
  }
  // The last comma-separated part is the locality; keep intermediate address lines together.
  const parts = line.split(/[,\n]+/).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const town = result.townCity?.trim();
    const last = parts.at(-1)!;
    const lastLooksLikeStreet = /^(?:flat|apartment|unit|\d)\b|\b(?:street|road|avenue|lane|drive|crescent|terrace|court|place|way)\b/i.test(last);
    if ((!town && !lastLooksLikeStreet) || last.toLowerCase() === town?.toLowerCase()) {
      result.townCity = town || parts.pop()!;
      if (town) parts.pop();
      if (parts.length === 1 || !result.addressLine2?.trim()) {
        line = parts[0];
        if (parts.length > 1) result.addressLine2 = parts.slice(1).join(', ');
      }
    }
  }
  if (input.addressLine1 !== undefined) result.addressLine1 = line || null;
  return result;
};

export const addressIdentity = (input: AddressParts): string => {
  const address = normaliseUkAddress(input);
  return [address.buildingNumber, address.addressLine1].filter(Boolean).join(' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .map(part => ({ avenue: 'ave', crescent: 'cres', court: 'ct', drive: 'dr', lane: 'ln',
      place: 'pl', road: 'rd', street: 'st', terrace: 'ter' })[part] ?? part).join(' ');
};
