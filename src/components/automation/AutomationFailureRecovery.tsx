import { useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, Play } from 'lucide-react';
import { AgentDefaultsForm, ClientForm, DirectoryDrawer, SiteForm, type DirectoryRecord } from '@/components/live/DirectoryEditor';
import type { AutomationFailureMetadata } from '@/lib/automation/failure-recovery';

export type FailureRecoveryContext = {
  client: DirectoryRecord | null;
  site: DirectoryRecord | null;
  applicationId: string | null;
  documentsHref: string;
  portalHref: string | null;
  typeOfWorkKeys: string[];
  typeOfWorkOptions: Array<{ key: string; label: string }>;
  agentDefaults: DirectoryRecord | null;
  organisationName: string;
  canManageAgentDefaults: boolean;
};

type Props = {
  metadata: AutomationFailureMetadata;
  context: FailureRecoveryContext;
  applicationType: 'HOUSEHOLDER_PLANNING' | 'BUILDING_WARRANT';
  retrying: boolean;
  onRetry: () => Promise<void>;
  detailsHref: string;
};

type Editor = 'address' | 'applicant' | 'agent' | 'site' | 'type_of_work' | null;

const recoveryEditors: Partial<Record<AutomationFailureMetadata['recoveryAction'], Exclude<Editor, null>>> = {
  review_address: 'address',
  review_applicant: 'applicant',
  review_agent: 'agent',
  review_site: 'site',
  review_type_of_work: 'type_of_work',
};
const recoveryEditor = (action: AutomationFailureMetadata['recoveryAction']): Editor => recoveryEditors[action] ?? null;

const actionLabels: Record<Exclude<Editor, null>, string> = {
  address: 'Review address',
  applicant: 'Review applicant',
  agent: 'Review agent details',
  site: 'Review site',
  type_of_work: 'Review type of work',
};
const actionLabel = (editor: Editor) => editor ? actionLabels[editor] : 'Review issue';

export default function AutomationFailureRecovery({
  metadata,
  context,
  applicationType,
  retrying,
  onRetry,
  detailsHref,
}: Props) {
  const [editor, setEditor] = useState<Editor>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const desiredEditor = recoveryEditor(metadata.recoveryAction);
  const isWarrant = applicationType === 'BUILDING_WARRANT';

  useEffect(() => {
    if (!editor) return;
    const expectedAction = editor === 'address' || editor === 'site'
      ? context.site?.id ? `/api/sites/${context.site.id}` : null
      : editor === 'applicant'
        ? context.client?.id ? `/api/clients/${context.client.id}` : null
        : editor === 'agent'
          ? '/api/settings/organisation-defaults'
          : editor === 'type_of_work' && context.applicationId
            ? `/api/building-warrant/${context.applicationId}/type-of-work`
            : null;
    const onMutationSuccess = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string }>).detail;
      if (!expectedAction || detail?.action !== expectedAction) return;
      setSaveMessage('Saved. Queuing a fresh safe attempt…');
      void onRetry()
        .then(() => setEditor(null))
        .catch((error) => setSaveMessage(error instanceof Error ? error.message : 'Saved, but the retry could not be queued.'));
    };
    window.addEventListener('portal:mutation-success', onMutationSuccess);
    return () => window.removeEventListener('portal:mutation-success', onMutationSuccess);
  }, [context.applicationId, context.client?.id, context.site?.id, editor, onRetry]);

  const openEditor = () => {
    setSaveMessage('');
    setEditor(desiredEditor);
  };

  const directRetry = metadata.recoveryAction === 'retry' && metadata.retrySafe;
  const canOpenEditor = Boolean(desiredEditor && (
    (desiredEditor === 'address' || desiredEditor === 'site') ? context.site
      : desiredEditor === 'applicant' ? context.client
        : desiredEditor === 'agent' ? context.canManageAgentDefaults
          : desiredEditor === 'type_of_work' ? isWarrant && context.applicationId
            : false
  ));

  return <>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {directRetry && <button type="button" className="btn btn-primary gap-2" disabled={retrying} onClick={() => void onRetry().catch(() => undefined)}>
        {retrying ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
        {retrying ? 'Queuing retry…' : 'Retry application'}
      </button>}
      {canOpenEditor && <button type="button" className="btn btn-primary" onClick={openEditor}>{actionLabel(desiredEditor)}</button>}
      {metadata.recoveryAction === 'update_login' && <a className="btn btn-primary" href="architectpro://settings/login">Update login</a>}
      {metadata.recoveryAction === 'update_login' && metadata.retrySafe && <button type="button" className="text-sm font-semibold text-stone-700 hover:text-ink" disabled={retrying} onClick={() => void onRetry().catch(() => undefined)}>{retrying ? 'Queuing retry…' : 'Retry after updating login'}</button>}
      {metadata.recoveryAction === 'review_documents' && <a className="btn btn-primary" href={context.documentsHref}>Review documents</a>}
      {(metadata.recoveryAction === 'review_portal' || metadata.recoveryAction === 'close') && <a className="btn btn-primary gap-2" href={context.portalHref ?? detailsHref} target={context.portalHref ? '_blank' : undefined} rel={context.portalHref ? 'noreferrer' : undefined}>
        {context.portalHref && <ExternalLink size={16} />}
        {context.portalHref ? (isWarrant ? 'View Warrant' : 'View Householder') : 'Review current portal state'}
      </a>}
      {metadata.retrySafe && !directRetry && !canOpenEditor && metadata.recoveryAction !== 'update_login' && <button type="button" className="btn btn-primary gap-2" disabled={retrying} onClick={() => void onRetry().catch(() => undefined)}><Play size={16} />Retry application</button>}
      <a className="text-sm font-semibold text-stone-600 hover:text-ink" href={detailsHref}>View run details</a>
    </div>
    {desiredEditor === 'agent' && !context.canManageAgentDefaults && <p className="mt-3 text-sm font-medium text-amber-900">An organisation owner or administrator must update the saved Agent details.</p>}

    {editor === 'address' && context.site && <DirectoryDrawer title="Property address needs review" description="Check the saved site address returned to the portal." onClose={() => setEditor(null)}>
      <SiteForm site={context.site} compact submitLabel="Save and retry application" onClose={() => setEditor(null)} />
      {saveMessage && <p role="status" className="mt-3 text-sm font-medium text-stone-700">{saveMessage}</p>}
    </DirectoryDrawer>}
    {editor === 'site' && context.site && <DirectoryDrawer title="Site information required" description="Correct the site fields needed by the application." onClose={() => setEditor(null)}>
      <SiteForm site={context.site} compact submitLabel="Save and retry application" onClose={() => setEditor(null)} />
      {saveMessage && <p role="status" className="mt-3 text-sm font-medium text-stone-700">{saveMessage}</p>}
    </DirectoryDrawer>}
    {editor === 'applicant' && context.client && <DirectoryDrawer title="Applicant information required" description="Correct only the applicant details needed by this application." onClose={() => setEditor(null)}>
      <ClientForm client={context.client} compactApplicant submitLabel="Save and retry application" onClose={() => setEditor(null)} />
      {saveMessage && <p role="status" className="mt-3 text-sm font-medium text-stone-700">{saveMessage}</p>}
    </DirectoryDrawer>}
    {editor === 'agent' && <DirectoryDrawer title="Agent information required" description="Update the practice details used when preparing applications." onClose={() => setEditor(null)}>
      <AgentDefaultsForm defaults={context.agentDefaults} organisationName={context.organisationName} compact submitLabel="Save and retry application" onClose={() => setEditor(null)} />
      {saveMessage && <p role="status" className="mt-3 text-sm font-medium text-stone-700">{saveMessage}</p>}
    </DirectoryDrawer>}
    {editor === 'type_of_work' && context.applicationId && <DirectoryDrawer title="Type of work required" description="Select at least one type of work before running the application." onClose={() => setEditor(null)}>
      <form data-api-form data-field-errors data-action={`/api/building-warrant/${context.applicationId}/type-of-work`} data-method="PATCH" className="grid gap-4">
        <fieldset><legend className="label">Type of work</legend><div className="mt-3 grid gap-2">{context.typeOfWorkOptions.map((option) => <label key={option.key} className="flex min-h-11 items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm font-medium text-ink"><input type="checkbox" name="typeOfWorkKeys" value={option.key} defaultChecked={context.typeOfWorkKeys.includes(option.key)} className="h-4 w-4 accent-[#526a4a]" /><span>{option.label}</span></label>)}</div><p data-field-error="typeOfWorkKeys" className="mt-2 text-sm text-red-700" /></fieldset>
        <button className="btn btn-primary w-full">Save and retry application</button><button type="button" className="btn btn-secondary w-full" onClick={() => setEditor(null)}>Cancel</button><p data-form-status className="text-sm text-stone-500" />
      </form>
      {saveMessage && <p role="status" className="mt-3 text-sm font-medium text-stone-700">{saveMessage}</p>}
    </DirectoryDrawer>}
  </>;
}
