import { useEffect, useState } from 'react';
import { MapPin, UserRound } from 'lucide-react';
import { ClientForm, DirectoryDrawer, SiteForm, type DirectoryRecord } from '@/components/live/DirectoryEditor';

type Props = {
  client: DirectoryRecord | null;
  site: DirectoryRecord | null;
};

type MutationDetail = {
  action?: string;
  method?: string;
  values?: Record<string, unknown>;
};

const text = (value: unknown) => typeof value === 'string' ? value : '';

export default function ProjectLinkedRecordEditor({ client: initialClient, site: initialSite }: Props) {
  const [client, setClient] = useState<DirectoryRecord | null>(initialClient);
  const [site, setSite] = useState<DirectoryRecord | null>(initialSite);
  const [editing, setEditing] = useState<'client' | 'site' | null>(null);

  useEffect(() => {
    const onMutationSuccess = (event: Event) => {
      const detail = (event as CustomEvent<MutationDetail>).detail;
      const values = detail?.values ?? {};
      if (detail?.method !== 'PATCH') return;
      if (client?.id && detail.action === `/api/clients/${client.id}`) {
        setClient((current) => current ? { ...current, ...values } : current);
        setEditing(null);
      }
      if (site?.id && detail.action === `/api/sites/${site.id}`) {
        setSite((current) => current ? { ...current, ...values } : current);
        setEditing(null);
      }
    };
    window.addEventListener('portal:mutation-success', onMutationSuccess);
    return () => window.removeEventListener('portal:mutation-success', onMutationSuccess);
  }, [client?.id, site?.id]);

  const clientName = text(client?.name) || 'Not linked';
  const clientEmail = text(client?.email) || 'No client email';
  const siteName = site
    ? [text(site.buildingNumber), text(site.addressLine1)].filter(Boolean).join(' ')
    : 'Not linked';
  const siteDetail = text(site?.postcode) || 'No authority set';

  return (
    <div className="contents">
      {client ? (
        <button type="button" className="group flex min-h-28 w-full gap-3 border-b border-stone-200 p-4 text-left transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss/30 sm:border-r xl:border-b-0" onClick={() => setEditing('client')} aria-label={`Edit client ${clientName}`}>
          <UserRound size={19} className="mt-0.5 shrink-0 text-stone-500 transition group-hover:text-moss" aria-hidden="true" />
          <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="label">Client</p><span className="text-xs font-semibold text-stone-400 transition group-hover:text-moss">Edit</span></div><p className="truncate font-semibold text-ink">{clientName}</p><p className="mt-1 truncate text-sm text-stone-500">{clientEmail}</p></div>
        </button>
      ) : (
        <article className="flex min-h-28 gap-3 border-b border-stone-200 p-4 sm:border-r xl:border-b-0"><UserRound size={19} className="mt-0.5 shrink-0 text-stone-500" aria-hidden="true" /><div className="min-w-0"><p className="label">Client</p><p className="truncate font-semibold text-ink">{clientName}</p><p className="mt-1 truncate text-sm text-stone-500">{clientEmail}</p></div></article>
      )}
      {site ? (
        <button type="button" className="group flex min-h-28 w-full gap-3 border-b border-stone-200 p-4 text-left transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss/30 xl:border-b-0 xl:border-r" onClick={() => setEditing('site')} aria-label={`Edit site ${siteName}`}>
          <MapPin size={19} className="mt-0.5 shrink-0 text-stone-500 transition group-hover:text-moss" aria-hidden="true" />
          <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="label">Site</p><span className="text-xs font-semibold text-stone-400 transition group-hover:text-moss">Edit</span></div><p className="break-words font-semibold text-ink">{siteName}</p><p className="mt-1 text-sm text-stone-500">{siteDetail}</p></div>
        </button>
      ) : (
        <article className="flex min-h-28 gap-3 border-b border-stone-200 p-4 xl:border-b-0 xl:border-r"><MapPin size={19} className="mt-0.5 shrink-0 text-stone-500" aria-hidden="true" /><div className="min-w-0"><p className="label">Site</p><p className="break-words font-semibold text-ink">{siteName}</p><p className="mt-1 text-sm text-stone-500">{siteDetail}</p></div></article>
      )}
      {editing === 'client' && client && <DirectoryDrawer title="Edit client" description="Update this client profile." onClose={() => setEditing(null)}><ClientForm client={client} onClose={() => setEditing(null)} /></DirectoryDrawer>}
      {editing === 'site' && site && <DirectoryDrawer title="Edit site" description="Update this site profile." onClose={() => setEditing(null)}><SiteForm site={site} onClose={() => setEditing(null)} /></DirectoryDrawer>}
    </div>
  );
}
