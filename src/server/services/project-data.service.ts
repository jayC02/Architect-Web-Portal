import { prisma } from '@/lib/db/prisma';
import { HttpError } from '@/lib/utils/http';

const siteAddress = (site: {
  addressLine1: string;
  addressLine2: string | null;
  townCity: string;
  postcode: string;
}) => [site.addressLine1, site.addressLine2, site.townCity, site.postcode].filter(Boolean).join(', ');

export const resolveProjectLinks = async (
  organisationId: string,
  clientId: string | undefined,
  siteId: string | undefined,
) => {
  const [client, site] = await Promise.all([
    clientId
      ? prisma.client.findFirst({ where: { id: clientId, organisationId }, select: { id: true } })
      : Promise.resolve(null),
    siteId
      ? prisma.site.findFirst({
          where: { id: siteId, organisationId },
          select: {
            id: true,
            addressLine1: true,
            addressLine2: true,
            townCity: true,
            postcode: true,
            localAuthority: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (clientId && !client) throw new HttpError(400, 'Client does not belong to this organisation.');
  if (siteId && !site) throw new HttpError(400, 'Site does not belong to this organisation.');

  return {
    clientId: client?.id ?? null,
    siteId: site?.id ?? null,
    derivedSite: site
      ? {
          siteAddress: siteAddress(site),
          localAuthority: site.localAuthority,
        }
      : null,
  };
};
