import type { ApplicationDraftResponse } from '@/server/services/application-draft-view.service';

export type ClientReview = NonNullable<ApplicationDraftResponse['review']>;
export type ClientPerson = ClientReview['client'];
export type PersonGroup = 'identity' | 'contact' | 'address';
export type DirectoryClient = Omit<ClientPerson, 'clientType' | 'displayName'> & { id: string; name: string; address?: string | null };

export const personName = (person: ClientPerson) => person.displayName?.trim()
  || (person.clientType === 'ORGANISATION' ? person.companyName?.trim() : [person.firstName, person.lastName].filter(Boolean).join(' '))
  || 'Name needs completing';

export const personAddress = (person: ClientPerson) => [
  [person.buildingNumber, person.addressLine1].filter(Boolean).join(' '), person.addressLine2, person.townCity, person.postcode,
].filter(Boolean).join(', ');

export const personIssueGroup = (key: string): PersonGroup => {
  const field = key.split('.').at(-1);
  if (field === 'email' || field === 'phone') return 'contact';
  return ['buildingNumber', 'addressLine1', 'addressLine2', 'townCity', 'postcode', 'country'].includes(field ?? '') ? 'address' : 'identity';
};

export const siteAddressReady = (site: ClientReview['site']) =>
  [site.buildingNumber, site.addressLine1, site.townCity, site.postcode].every(value => Boolean(value?.trim()));

export const hasDifferentAddress = (person: ClientPerson, site: ClientReview['site']) =>
  (['buildingNumber', 'addressLine1', 'addressLine2', 'townCity', 'postcode', 'country'] as const)
    .some(key => Boolean(person[key]?.trim()) && person[key]?.trim().toLowerCase() !== site[key]?.trim().toLowerCase());

export const directoryPerson = (record: DirectoryClient): ClientPerson => ({
  clientType: record.companyName ? 'ORGANISATION' : 'INDIVIDUAL', displayName: record.name,
  title: record.title, firstName: record.firstName, lastName: record.lastName, companyName: record.companyName,
  email: record.email, phone: record.phone, buildingNumber: record.buildingNumber,
  addressLine1: record.addressLine1 ?? record.address ?? null, addressLine2: record.addressLine2,
  townCity: record.townCity, postcode: record.postcode, country: record.country,
});

// Used only when the architect explicitly returns to the extracted draft details.
export const preparedPerson = (prepared: ApplicationDraftResponse['prepared']): ClientPerson => {
  const value = (key: string) => typeof prepared?.client[key]?.value === 'string' ? prepared.client[key].value as string : null;
  return {
    clientType: value('companyName') ? 'ORGANISATION' : 'INDIVIDUAL', displayName: value('name'),
    title: value('title'), firstName: value('firstName'), lastName: value('lastName'), companyName: value('companyName'),
    email: value('email'), phone: value('phone'), buildingNumber: value('buildingNumber'), addressLine1: value('addressLine1'),
    addressLine2: value('addressLine2'), townCity: value('townCity'), postcode: value('postcode'), country: value('country'),
  };
};
