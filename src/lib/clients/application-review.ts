import type { ApplicationDraftReview } from '@/lib/validation/application-draft';
import { normaliseUkAddress } from '@/lib/addresses/uk-address';

export type ReviewPerson = ApplicationDraftReview['client'];
export type ReviewClient = Omit<ReviewPerson, 'displayName' | 'clientType'> & {
  id: string;
  name: string;
  address?: string | null;
};

export const normaliseClientName = (value: string | null | undefined) =>
  (value ?? '').normalize('NFKC').toLocaleLowerCase('en-GB').replace(/\./g, '').trim().replace(/\s+/g, ' ');

// The server's schema may reorder object keys during a save without changing a field.
export const reviewPersonKey = (person: ReviewPerson) => JSON.stringify(
  Object.entries(person).sort(([left], [right]) => left.localeCompare(right)),
);

export const personFromDirectory = (client: ReviewClient): ReviewPerson => normaliseUkAddress({
  clientType: client.companyName ? 'ORGANISATION' : 'INDIVIDUAL',
  displayName: client.name,
  title: client.title,
  firstName: client.firstName,
  lastName: client.lastName,
  companyName: client.companyName,
  email: client.email,
  phone: client.phone,
  buildingNumber: client.buildingNumber,
  addressLine1: client.addressLine1 || client.address || null,
  addressLine2: client.addressLine2,
  townCity: client.townCity,
  postcode: client.postcode,
  country: client.country,
});

export const exactNameClients = (person: ReviewPerson, clients: ReviewClient[]) => {
  const name = normaliseClientName(person.displayName);
  if (!name || (person.clientType === 'INDIVIDUAL' && !name.includes(' '))) return [];
  return clients.filter(client => [client.name, [client.firstName, client.lastName].filter(Boolean).join(' '), client.companyName]
    .some(value => normaliseClientName(value) === name));
};

const comparable = (key: keyof ReviewPerson, value: string | null) => {
  if (key === 'phone') return (value ?? '').replace(/\D/g, '').replace(/^44(?=\d{10}$)/, '0');
  if (key === 'postcode') return (value ?? '').replace(/\s/g, '').toUpperCase();
  return normaliseClientName(value);
};

export const clientDifferences = (prepared: ReviewPerson, saved: ReviewPerson, ignored: (keyof ReviewPerson)[] = []) =>
  (['displayName', 'title', 'firstName', 'lastName', 'companyName', 'email', 'phone', 'buildingNumber', 'addressLine1', 'addressLine2', 'townCity', 'postcode'] as const)
    .filter(key => !ignored.includes(key) && prepared[key]?.trim()
      && comparable(key, prepared[key]) !== comparable(key, saved[key]));

export const selectDirectoryClient = (review: ApplicationDraftReview, client: ReviewClient): ApplicationDraftReview => {
  const person = personFromDirectory(client);
  return { ...review, clientMode: 'existing', existingClientId: client.id, client: person,
    clientAddressSameAsSite: false, applicant: review.applicantDifferentFromClient ? review.applicant : person };
};
