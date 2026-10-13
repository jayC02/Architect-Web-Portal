import { useEffect, useId, useRef, useState } from 'react';
import type { ApplicationDraftResponse } from '@/server/services/application-draft-view.service';
import { directoryPerson, personAddress, personIssueGroup, personName, siteAddressReady, type ClientPerson, type ClientReview, type DirectoryClient, type PersonGroup } from './client-review';

type Props = {
  review: ClientReview;
  prepared: ApplicationDraftResponse['prepared'];
  issues: ApplicationDraftResponse['issues'];
  draftId: string;
  saveState: 'idle' | 'saving' | 'saved' | 'failed';
  selectionNeedsConfirmation: boolean;
  disabled: boolean;
  onChange: (target: 'client' | 'applicant', key: keyof ClientPerson, value: string) => void;
  onSelect: (person: ClientPerson | null, id: string | null) => void;
  onRelationship: (different: boolean) => void;
  onSiteAddress: (same: boolean) => void;
  onRetrySave: () => Promise<boolean>;
};
const groups: PersonGroup[] = ['identity', 'contact', 'address'];
const labels = { identity: 'Identity', contact: 'Contact', address: 'Address' };

function PersonInput({ label, value, onChange, issue, required, type = 'text' }: {
  label: string; value: string | null; onChange: (value: string) => void; issue?: string; required?: boolean; type?: 'text' | 'email' | 'tel';
}) {
  const id = useId();
  const error = issue || (type === 'email' && value?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'Enter a valid email address.' : undefined);
  return <label className="block" htmlFor={id}>
    <span className="label">{label}{required ? <span className="ml-1 text-stone-500" aria-hidden="true">*</span> : null}</span>
    <input id={id} aria-label={label} type={type} value={value ?? ''} onChange={event => onChange(event.target.value)} required={required}
      aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className={`field ${error ? 'border-red-300' : ''}`} />
    {error ? <span id={`${id}-error`} className="mt-1 block text-xs text-red-700">{error}</span> : null}
  </label>;
}

function PersonEditor({ person, group, prefix, onChange, issues, sameAsSite }: {
  person: ClientPerson; group: PersonGroup; prefix: 'client' | 'applicant'; onChange: Props['onChange']; issues: Props['issues']; sameAsSite: boolean;
}) {
  const field = (key: keyof ClientPerson, label: string, required = false, type: 'text' | 'email' | 'tel' = 'text') =>
    <PersonInput key={key} label={label} value={person[key]} onChange={value => onChange(prefix, key, value)} required={required} type={type}
      issue={issues.find(issue => issue.key === `${prefix}.${key}`)?.message} />;
  if (group === 'address' && sameAsSite) return <p className="text-sm leading-6 text-stone-600">{personAddress(person) || 'Complete the site address first.'}<span className="mt-1 block text-xs text-stone-500">Using the site address for this draft.</span></p>;
  return <div className="grid gap-4 sm:grid-cols-2">
    {group === 'identity' ? <>
      <label className="block"><span className="label">{prefix === 'client' ? 'Client' : 'Applicant'} type</span>
        <select aria-label={prefix === 'client' ? 'Client type' : 'Applicant type'} className="field" value={person.clientType} onChange={event => onChange(prefix, 'clientType', event.target.value)}><option value="INDIVIDUAL">Individual</option><option value="ORGANISATION">Organisation</option></select>
      </label>
      {field('displayName', 'Display name', true)}
      {person.clientType === 'INDIVIDUAL' ? <>
        <label className="block"><span className="label">Title</span><select aria-label="Title" className="field" value={person.title ?? ''} onChange={event => onChange(prefix, 'title', event.target.value)} aria-invalid={issues.some(issue => issue.key === `${prefix}.title`)}>
          <option value="">Choose title</option>{['Mr', 'Mrs', 'Miss', 'Ms', 'Other'].map(value => <option key={value}>{value}</option>)}
        </select></label>
        {field('firstName', 'First name', true)}{field('lastName', 'Last name', true)}
      </> : field('companyName', 'Company name', true)}
    </> : group === 'contact' ? <>{field('email', 'Email', true, 'email')}{field('phone', 'Phone', false, 'tel')}</> : <>
      {field('buildingNumber', 'Building number', true)}{field('addressLine1', 'Address line 1', true)}{field('addressLine2', 'Address line 2')}
      {field('townCity', 'Town or city', true)}{field('postcode', 'Postcode', true)}{field('country', 'Country')}
    </>}
  </div>;
}

export default function ClientApplicantReview(props: Props) {
  const { review, prepared, issues, draftId, saveState, disabled } = props;
  const clientIssues = issues.filter(issue => issue.section === 'client');
  const conflicts = Object.entries(prepared?.client ?? {}).filter(([key, suggestion]) => suggestion.status === 'conflict'
    && String(suggestion.value ?? '') === String(review.client[key === 'name' ? 'displayName' : key as keyof ClientPerson] ?? ''));
  const firstIssue = clientIssues.find(issue => issue.key.startsWith('client.'));
  const [editing, setEditing] = useState<{ target: 'client' | 'applicant'; group: PersonGroup } | null>(() =>
    firstIssue && review.clientMode === 'create' ? { target: 'client', group: personIssueGroup(firstIssue.key) }
      : review.applicantDifferentFromClient && clientIssues.some(issue => issue.key.startsWith('applicant.')) ? { target: 'applicant', group: 'identity' }
        : conflicts.length && review.clientMode === 'create' ? { target: 'client', group: personIssueGroup(`client.${conflicts[0][0]}`) } : null);
  const [choosing, setChoosing] = useState(props.selectionNeedsConfirmation);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<DirectoryClient[]>([]);
  const [selected, setSelected] = useState<DirectoryClient | null>(null);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [searchGeneration, setSearchGeneration] = useState(0);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const chooserRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const matches = prepared?.matches.clients ?? [];

  useEffect(() => {
    if (!choosing && review.clientMode !== 'existing') return;
    const controller = new AbortController();
    if (!choosing) {
      fetch(`/api/clients?q=${encodeURIComponent(review.existingClientId ?? '')}`, { signal: controller.signal })
        .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
        .then(data => { if (!controller.signal.aborted) setSelected(data.clients.find((client: DirectoryClient) => client.id === review.existingClientId) ?? null); })
        .catch(() => {});
      return () => controller.abort();
    }
    setSearchState('loading');
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/clients?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) { setClients(data.clients); setSearchState('ready'); }
      } catch { if (!controller.signal.aborted) { setClients([]); setSearchState('error'); } }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [choosing, query, review.clientMode, review.existingClientId, searchGeneration]);

  useEffect(() => { if (choosing) chooserRef.current?.focus(); }, [choosing]);
  useEffect(() => { if (editing) editorRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>('input:not(:disabled),select')?.focus(); }, [editing?.target, editing?.group]);

  const showEditor = (target: 'client' | 'applicant', group: PersonGroup) => setEditing({ target, group });
  const closeEditor = () => { setEditing(null); editButtonRef.current?.focus(); };
  const closeChooser = () => { setChoosing(false); setPendingId(null); changeButtonRef.current?.focus(); };
  const current = review.clientMode === 'existing' && selected ? directoryPerson(selected) : review.client;
  const activePerson = editing?.target === 'applicant' ? review.applicant ?? review.client : current;
  const attentionGroups = groups.filter(group => clientIssues.some(issue => personIssueGroup(issue.key) === group)
    || (review.clientMode === 'create' && conflicts.some(([key]) => personIssueGroup(`client.${key}`) === group)));

  return <section id="client-applicant-review" aria-labelledby="client-review-heading" className="panel scroll-mt-6 rounded-lg">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-4">
      <h2 id="client-review-heading" className="text-base font-semibold text-ink">Client &amp; Applicant</h2>
      <div className="flex flex-wrap gap-2">
        <button ref={editButtonRef} type="button" className="btn btn-secondary" disabled={disabled} aria-expanded={Boolean(editing)} aria-controls="client-detail-editor" onClick={() => showEditor('client', 'identity')}>Edit details</button>
        <button ref={changeButtonRef} type="button" className="btn btn-secondary" disabled={disabled} aria-expanded={choosing} aria-controls="client-selector" onClick={() => setChoosing(!choosing)}>Change client</button>
      </div>
    </header>
    <div className="px-5 py-5">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="min-w-0"><h3 className="break-words text-xl font-semibold leading-snug text-ink">{personName(current)}</h3>
          <p className="mt-1 text-sm text-stone-500">{current.clientType === 'ORGANISATION' ? 'Organisation' : 'Individual'}{review.clientMode === 'existing' ? ' · Saved client' : ''}</p>
          <p className="mt-3 text-sm text-stone-700">Applicant: <strong className="font-semibold">{review.applicantDifferentFromClient ? personName(review.applicant ?? review.client) : 'Same as client'}</strong></p>
        </div>
        <dl className="min-w-0 space-y-3 text-sm"><div><dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">Contact</dt><dd className="mt-1 break-words text-stone-700">{[current.email, current.phone].filter(Boolean).join(' · ') || 'Contact details not found'}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">Address</dt><dd className="mt-1 break-words text-stone-700">{personAddress(current) || 'Address not found'}{review.clientMode === 'create' && review.clientAddressSameAsSite ? <span className="mt-1 block text-xs text-stone-500">Same as site address</span> : null}</dd></div>
        </dl>
      </div>
      {attentionGroups.length ? <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-stone-100 pt-4 text-sm">
        <p className="text-amber-800">{conflicts.length ? 'Check conflicting details.' : 'A few details need completing.'}</p>
        {attentionGroups.map(group => <button key={group} type="button" className="min-h-10 font-semibold text-ink underline decoration-stone-300 underline-offset-4 hover:decoration-ink" onClick={() => showEditor(clientIssues.some(issue => issue.key.startsWith('applicant.') && personIssueGroup(issue.key) === group) && review.applicantDifferentFromClient ? 'applicant' : 'client', group)}>{labels[group]} needs review</button>)}
      </div> : null}
      {props.selectionNeedsConfirmation ? <p className="mt-3 text-sm text-amber-800" role="status">More than one saved client matches. Confirm your client below before creating the project.</p> : matches.some(match => match.strength === 'possible') && review.clientMode === 'create' ? <p className="mt-3 text-sm text-stone-500">{matches.length} possible saved {matches.length === 1 ? 'client' : 'clients'} to check. Choose Change client to compare, or keep these prepared details.</p> : null}

      {choosing ? <div id="client-selector" className="mt-5 border-t border-stone-200 pt-5" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeChooser(); } }}>
        <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-ink">Choose a client</h3><p className="mt-1 text-xs leading-5 text-stone-500">Search this organisation by name, email, phone or postcode. Possible matches require your confirmation; surnames alone are never used to choose a client.</p></div>
          <button type="button" className="btn btn-secondary" onClick={closeChooser}>Close search</button></div>
        <label className="mt-4 block"><span className="label">Search saved clients</span><input ref={chooserRef} className="field" type="search" value={query} onChange={event => { setQuery(event.target.value); setPendingId(null); }} placeholder="Name, email, phone or postcode" /></label>
        <p className="mt-2 text-xs text-stone-500" role="status">{searchState === 'loading' ? 'Searching clients…' : searchState === 'error' ? 'Saved clients could not be loaded. Your prepared details are kept.' : `${clients.length} ${query ? 'matching' : 'recent'} clients${clients.length === 100 ? ' · Refine your search to find older records.' : ''}`}</p>
        {searchState === 'error' ? <button type="button" className="btn btn-secondary mt-2" onClick={() => setSearchGeneration(value => value + 1)}>Retry search</button> : null}
        <div className="mt-3 max-h-72 overflow-y-auto overscroll-contain divide-y divide-stone-200" aria-label="Saved client search results">
          {searchState === 'ready' && !clients.length ? <p className="py-4 text-sm text-stone-500">No saved clients found. Try another name or keep the prepared details.</p> : null}
          {searchState === 'ready' ? clients.map(client => {
            const match = matches.find(item => item.id === client.id);
            return <div key={client.id} className="py-3"><button type="button" className="w-full rounded-md p-2 text-left transition hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss" aria-pressed={pendingId === client.id} onClick={() => setPendingId(client.id)}>
              <span className="block break-words font-semibold text-ink">{client.name}</span><span className="mt-1 block break-words text-xs text-stone-500">{[client.email, client.phone, client.postcode].filter(Boolean).join(' · ') || 'No contact details saved'}</span>
              {match ? <span className="mt-1 block text-xs text-moss">{match.strength === 'strong' ? 'Suggested match' : 'Possible match'}: {match.reasons.join('; ')}</span> : null}
            </button>
              {pendingId === client.id ? <div className="mt-2 flex flex-wrap items-center justify-between gap-3 pl-2"><p className="text-xs text-stone-600">{personAddress(directoryPerson(client)) || 'No address saved'}</p><button type="button" className="btn btn-primary" disabled={disabled} onClick={() => { setSelected(client); props.onSelect(directoryPerson(client), client.id); setEditing(null); closeChooser(); }}>Use this client</button></div> : null}
            </div>;
          }) : null}
        </div>
        <button type="button" className="btn btn-secondary mt-4" disabled={disabled} onClick={() => { setSelected(null); props.onSelect(null, null); closeChooser(); }}>Keep prepared client details</button>
      </div> : null}

      <div className="mt-5 border-t border-stone-200 pt-4">
        {editing || review.applicantDifferentFromClient ? <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink"><input type="checkbox" className="h-4 w-4 rounded border-stone-300 text-ink focus:ring-moss" checked={!review.applicantDifferentFromClient} disabled={disabled} onChange={event => { props.onRelationship(!event.target.checked); if (!event.target.checked) showEditor('applicant', 'identity'); else if (editing?.target === 'applicant') setEditing(null); }} />Client is also the applicant</label> : null}
        {review.clientMode === 'existing' ? <p className="mt-1 text-xs leading-5 text-stone-500">The saved client-directory record is kept unchanged. Use a separate applicant for application-specific details.</p> : <p className="mt-1 text-xs leading-5 text-stone-500">These details belong to this draft. A client-directory record is created when you approve the project.</p>}
        {review.applicantDifferentFromClient ? <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-stone-100 pt-4"><div><h3 id="separate-applicant-heading" className="font-semibold text-ink">Separate applicant</h3><p className="mt-1 break-words text-sm text-stone-700">{personName(review.applicant ?? review.client)}</p><p className="mt-1 break-words text-xs text-stone-500">{[review.applicant?.email, personAddress(review.applicant ?? review.client)].filter(Boolean).join(' · ') || 'Complete the applicant details below.'}</p></div><button type="button" className="btn btn-secondary" onClick={() => showEditor('applicant', 'identity')}>Edit applicant</button></div> : null}
      </div>

      {editing ? <div ref={editorRef} id="client-detail-editor" className="mt-5 border-t border-stone-200 pt-5" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeEditor(); } }}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-ink">{editing.target === 'client' ? 'Client details' : 'Applicant details'}</h3><button type="button" className="btn btn-secondary" onClick={closeEditor}>Done editing</button></div>
        {editing.target === 'client' && review.clientMode === 'existing' ? <p className="mt-3 text-sm leading-6 text-stone-600">{personName(current)} is selected from the client directory. To change application details, use a separate applicant. Choose Change client to use another record or the prepared details.</p> : <>
          <nav aria-label={`${editing.target === 'client' ? 'Client' : 'Applicant'} detail sections`} className="mb-5 mt-3 flex flex-wrap gap-1 border-b border-stone-200">
            {groups.map(group => <button type="button" key={group} aria-pressed={editing.group === group} className={`min-h-11 border-b-2 px-4 py-2 text-sm font-semibold transition ${editing.group === group ? 'border-ink text-ink' : 'border-transparent text-stone-500 hover:text-ink'}`} onClick={() => showEditor(editing.target, group)}>{labels[group]}</button>)}
          </nav>
          {editing.target === 'client' && editing.group === 'address' ? <div className="mb-4"><label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" className="h-4 w-4 rounded border-stone-300 text-ink focus:ring-moss" checked={review.clientAddressSameAsSite} disabled={!siteAddressReady(review.site)} onChange={event => props.onSiteAddress(event.target.checked)} />Client address is the same as the site address</label>{!siteAddressReady(review.site) ? <p className="mt-1 text-xs text-stone-500">Complete the site building number, street, town and postcode first.</p> : null}</div> : null}
          <PersonEditor person={activePerson} group={editing.group} prefix={editing.target} onChange={props.onChange} issues={clientIssues} sameAsSite={editing.target === 'client' && review.clientAddressSameAsSite} />
          {editing.target === 'client' ? <details className="mt-4 text-xs text-stone-500"><summary className="min-h-10 cursor-pointer py-2 font-semibold">Document evidence</summary>
            {Object.entries(prepared?.client ?? {}).filter(([key]) => personIssueGroup(`client.${key}`) === editing.group).map(([key, suggestion]) => suggestion.sources.length ? <p key={key} className="mb-2 break-words leading-5"><strong className="text-stone-700">{key === 'name' ? 'Name' : key}:</strong> {String(suggestion.value ?? 'Not found')}{suggestion.status === 'conflict' ? ` · Conflicting value: ${String(suggestion.currentValue ?? 'Not found')}` : ''}{suggestion.sources.map((source, index) => <span key={`${source.documentId}-${index}`} className="block">{source.documentId === 'project-notes' ? source.filename : <a className="underline underline-offset-2" href={`/api/application-drafts/${draftId}/documents/${source.documentId}`} target="_blank" rel="noreferrer">{source.filename}{source.page ? `, page ${source.page}` : ''}</a>}{`: ${source.evidence}`}</span>)}</p> : null)}
            {!Object.values(prepared?.client ?? {}).some(suggestion => suggestion.sources.length) ? <p>No source details were found. Enter the information supplied by your client.</p> : null}
          </details> : null}
        </>}
      </div> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500" aria-live="polite">
        <span>{saveState === 'failed' ? 'Changes are kept here. Save again before leaving.' : saveState === 'saving' ? 'Saving changes…' : saveState === 'saved' ? 'Changes saved' : 'Changes save automatically'}</span>
        {saveState === 'failed' ? <button type="button" className="btn btn-secondary" onClick={() => void props.onRetrySave()}>Retry saving details</button> : null}
      </div>
    </div>
  </section>;
}
