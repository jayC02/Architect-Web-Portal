export type ClientDisplayRecord = {
  name?: string | null;
  title?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  address?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  townCity?: string | null;
  postcode?: string | null;
  country?: string | null;
};

export const clientDisplayName = (client: ClientDisplayRecord | null | undefined) =>
  client?.name
  || client?.companyName
  || [client?.title, client?.firstName, client?.lastName].filter(Boolean).join(' ')
  || 'Unnamed client';

export const clientIdentityLabel = (client: ClientDisplayRecord | null | undefined) =>
  client?.companyName
    ? `Company · ${client.companyName}`
    : ['Individual', client?.title, client?.firstName, client?.lastName].filter(Boolean).join(' · ');

export const clientStructuredAddress = (client: ClientDisplayRecord | null | undefined) =>
  [
    client?.addressLine1,
    client?.addressLine2,
    client?.townCity,
    client?.postcode,
    client?.country,
  ].filter(Boolean).join(', ') || client?.address || 'No address';
