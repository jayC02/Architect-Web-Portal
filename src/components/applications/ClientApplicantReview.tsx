import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, LoaderCircle } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';
import type { ApplicationDraftResponse } from '@/server/services/application-draft-view.service';
import {
  clientDifferences, exactNameClients, personFromDirectory, selectDirectoryClient, reviewPersonKey,
  type ReviewClient, type ReviewPerson,
} from '@/lib/clients/application-review';
import './client-applicant-review.css';

type Review = NonNullable<ApplicationDraftResponse['review']>;
type Props = {
  draft: ApplicationDraftResponse;
  review: Review;
  onChange: (change: (current: Review) => Review, immediate?: boolean) => void;
  issueFor: (key: string) => string | undefined;
  onContinue: () => Promise<boolean>;
  busy: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'failed';
  onLookupPending: (pending: boolean) => void;
  onVisibilityChange: (visible: boolean) => void;
};
const addressKeys = ['buildingNumber', 'addressLine1', 'addressLine2', 'townCity', 'postcode', 'country'] as const;
const emptyPerson = (): ReviewPerson => ({ clientType: 'INDIVIDUAL', displayName: null, title: null, firstName: null,
  lastName: null, companyName: null, email: null, phone: null, buildingNumber: null, addressLine1: null,
  addressLine2: null, townCity: null, postcode: null, country: null });
const preparedPerson = (draft: ApplicationDraftResponse): ReviewPerson => {
  const person = emptyPerson();
  for (const key of Object.keys(person) as (keyof ReviewPerson)[]) {
    if (key === 'clientType') continue;
    const value = draft.prepared?.client[key === 'displayName' ? 'name' : key]?.value;
    person[key] = typeof value === 'string' && value.trim() ? value : null;
  }
  person.clientType = person.companyName ? 'ORGANISATION' : 'INDIVIDUAL';
  person.displayName ||= person.companyName || [person.firstName, person.lastName].filter(Boolean).join(' ') || null;
  return person;
};
const labels: Partial<Record<keyof ReviewPerson, string>> = {
  displayName: 'Name', title: 'Title', firstName: 'First name', lastName: 'Last name', companyName: 'Company name',
  email: 'Email', phone: 'Phone', buildingNumber: 'Building number', addressLine1: 'Street', addressLine2: 'Address line 2',
  townCity: 'Town or city', postcode: 'Postcode', country: 'Country',
};
const ignoredDefaults = (review: Review, draft: ApplicationDraftResponse): (keyof ReviewPerson)[] => [
  ...(review.clientAddressSameAsSite ? addressKeys : []),
  ...Object.entries(draft.prepared?.client ?? {}).filter(([, field]) => field.status === 'default')
    .map(([key]) => key as keyof ReviewPerson),
];

function PersonField({ person, name, label, prefix, onChange, issue, required = false, readOnly = false, options }: {
  person: ReviewPerson; name: keyof ReviewPerson; label: string; prefix: string;
  onChange: (name: keyof ReviewPerson, value: string) => void; issue?: string; required?: boolean; readOnly?: boolean;
  options?: [string, string][];
}) {
  const id = useId();
  const [formatError, setFormatError] = useState('');
  const visibleIssue = issue || formatError;
  const value = person[name] ?? '';
  const maxLength = ['title', 'phone', 'buildingNumber'].includes(name) ? 40 : name === 'postcode' ? 20
    : ['firstName', 'lastName', 'townCity', 'country'].includes(name) ? 100 : 160;
  return <label className={`cr-field ${value ? 'cr-filled' : required && !readOnly ? 'cr-missing' : ''}`} htmlFor={id}>
    <span>{label}{!value && required && !readOnly ? <em>Required</em> : null}</span>
    {options ? <select id={id} value={value} onChange={event => onChange(name, event.target.value)} disabled={readOnly}
      aria-label={`${prefix} ${label}`} aria-required={required} aria-invalid={Boolean(visibleIssue)} aria-describedby={visibleIssue ? `${id}-error` : undefined}>
      {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select> : <input id={id} value={value} onChange={event => { setFormatError(''); onChange(name, event.target.value); }} readOnly={readOnly}
      onBlur={event => setFormatError(event.currentTarget.validity.typeMismatch ? 'Enter a valid email address.' : '')}
      onInvalid={event => { event.preventDefault(); setFormatError('Enter a valid email address.'); }}
      aria-label={`${prefix} ${label}`} aria-required={required} aria-invalid={Boolean(visibleIssue)} aria-describedby={visibleIssue ? `${id}-error` : undefined}
      maxLength={maxLength} type={name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'text'}
      placeholder={readOnly ? 'Not saved' : required ? `Enter ${label.toLowerCase()}` : 'Optional'} />}
    {visibleIssue ? <small className="cr-error" id={`${id}-error`}>{visibleIssue}</small> : null}
  </label>;
}

function PersonDetails({ person, prefix, onChange, issueFor, readOnly, site, useSite, sameAsSite }: {
  person: ReviewPerson; prefix: 'client' | 'applicant'; onChange: (key: keyof ReviewPerson, value: string) => void;
  issueFor: Props['issueFor']; readOnly: boolean; site: Review['site']; useSite: () => void; sameAsSite?: boolean;
}) {
  const siteComplete = Boolean(site.buildingNumber && site.addressLine1 && site.townCity && site.postcode);
  const field = (name: keyof ReviewPerson, label: string, required = false, options?: [string, string][]) =>
    <PersonField key={name} {...{ person, prefix, onChange, readOnly, name, label, required, options }} issue={issueFor(`${prefix}.${name}`)} />;
  return <>
    <div className="cr-row"><h4>Identity</h4><div className="cr-fields cr-identity">
      {person.clientType === 'INDIVIDUAL' ? <>
        {field('title', 'Title', true, [['', 'Choose'], ['Mr', 'Mr'], ['Mrs', 'Mrs'], ['Miss', 'Miss'], ['Ms', 'Ms'], ['Other', 'Other'],
          ...(!['', 'Mr', 'Mrs', 'Miss', 'Ms', 'Other'].includes(person.title ?? '') ? [[person.title!, person.title!] as [string, string]] : [])])}
        {field('firstName', 'First name', true)}{field('lastName', 'Last name', true)}
      </> : <div className="cr-company">{field('companyName', 'Company name', true)}</div>}
      {field('clientType', 'Type', false, [['INDIVIDUAL', 'Individual'], ['ORGANISATION', 'Organisation']])}
    </div></div>
    <div className="cr-row"><h4>Contact</h4><div className="cr-fields cr-contact">
      {field('email', 'Email', true)}{field('phone', 'Phone · optional')}
    </div></div>
    <div className="cr-row"><h4>Address</h4><div>
      <div className="cr-address-tools"><p>{sameAsSite ? 'Using the site address. Changes to the site stay in sync.' : 'Correspondence address'}</p>
        {!readOnly ? <button className="cr-reuse" type="button" disabled={!siteComplete} onClick={useSite}
          title={siteComplete ? [site.buildingNumber, site.addressLine1, site.townCity, site.postcode].filter(Boolean).join(', ') : 'Complete the site address first'}>Use site address ↗</button> : null}
      </div>
      <div className="cr-fields cr-address">
        {field('buildingNumber', 'Building number', true)}{field('addressLine1', 'Street', true)}{field('addressLine2', 'Address line 2 · optional')}
        {field('townCity', 'Town or city', true)}{field('postcode', 'Postcode', true)}{field('country', 'Country')}
      </div>
    </div></div>
  </>;
}

export default function ClientApplicantReview({ draft, review, onChange, issueFor, onContinue, busy, saveState, onLookupPending, onVisibilityChange }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReviewClient[]>([]);
  const [lookupError, setLookupError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [candidate, setCandidate] = useState<ReviewClient | null>(null);
  const [matchNotice, setMatchNotice] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState('');
  const [addressTarget, setAddressTarget] = useState<'client' | 'applicant' | null>(null);
  const previousPrepared = useRef<ReviewPerson>(review.clientMode === 'create' ? review.client : preparedPerson(draft));
  const separateApplicant = useRef<ReviewPerson | null>(review.applicantDifferentFromClient ? review.applicant ?? null : null);
  const manualChoice = useRef(false);
  const root = useRef<HTMLElement>(null);
  const current = useRef({ review, onChange, draft });
  current.current = { review, onChange, draft };
  const selected = review.clientMode === 'existing';
  const lookupName = review.client.displayName?.trim() ?? '';
  const selectedId = selected ? review.existingClientId : null;
  const lookup = searchOpen ? `q=${encodeURIComponent(query)}` : selectedId ? `clientId=${encodeURIComponent(selectedId)}`
    : lookupName ? `q=${encodeURIComponent(lookupName)}` : '';

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => onVisibilityChange(entry.isIntersecting));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, [onVisibilityChange]);

  // Read the organisation-scoped directory. Stale responses never replace edits or a newer choice.
  useEffect(() => {
    if (!lookup) { setResults([]); setMatchNotice(''); setLoading(false); onLookupPending(false); return; }
    const controller = new AbortController();
    const snapshot = reviewPersonKey(current.current.review.client);
    setLoading(true); onLookupPending(true); setLookupError(''); setMatchNotice('');
    const timer = window.setTimeout(async () => {
      try {
        const payload = await apiRequest<{ clients: ReviewClient[] }>(`/api/clients?${lookup}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResults(payload.clients);
        const latest = current.current;
        if (searchOpen || reviewPersonKey(latest.review.client) !== snapshot) return;
        if (selectedId) {
          const record = payload.clients.find(client => client.id === selectedId);
          if (!record) { setLookupError('This saved client is no longer available. Choose another client.'); return; }
          if (latest.review.existingClientId === selectedId && reviewPersonKey(personFromDirectory(record)) !== snapshot) {
            latest.onChange(value => value.clientMode === 'existing' && value.existingClientId === selectedId
              ? selectDirectoryClient(value, record) : value, true);
          }
          return;
        }
        if (manualChoice.current || latest.review.clientMode !== 'create') return;
        const matches = exactNameClients(latest.review.client, payload.clients);
        if (matches.length === 1 && payload.clients.length < 100) {
          const record = matches[0];
          const conflicts = clientDifferences(latest.review.client, personFromDirectory(record), ignoredDefaults(latest.review, latest.draft));
          if (conflicts.length || Object.values(latest.draft.prepared?.client ?? {}).some(field => field.status === 'conflict')) {
            setMatchNotice('A saved client has this name. Review the differing details before choosing.');
          } else {
            previousPrepared.current = latest.review.client;
            latest.onChange(value => value.clientMode === 'create' && reviewPersonKey(value.client) === snapshot
              ? selectDirectoryClient(value, record) : value, true);
          }
        } else if (matches.length > 1) setMatchNotice('More than one saved client has this name. Choose the correct client.');
      } catch (error) {
        if (!controller.signal.aborted) setLookupError(error instanceof Error ? error.message : 'Could not load saved clients.');
      } finally { if (!controller.signal.aborted) { setLoading(false); onLookupPending(false); } }
    }, searchOpen || !selectedId ? 300 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [lookup, selectedId, searchOpen, retry, onLookupPending]);

  useEffect(() => {
    if (!selectedId) return;
    // Refresh the saved record after an edit in the client-directory tab.
    const refresh = () => setRetry(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [selectedId]);

  const choose = (record: ReviewClient) => {
    if (review.clientMode === 'create') previousPrepared.current = review.client;
    manualChoice.current = true;
    onChange(value => selectDirectoryClient(value, record), true);
    setSearchOpen(false); setCandidate(null); setContinueError('');
  };
  const updatePerson = (prefix: 'client' | 'applicant', key: keyof ReviewPerson, value: string) => {
    setContinueError('');
    if (prefix === 'client' && key === 'displayName') manualChoice.current = false;
    onChange(current => {
      const person = { ...(prefix === 'client' ? current.client : current.applicant ?? emptyPerson()), [key]: value || null } as ReviewPerson;
      if (prefix === 'applicant') separateApplicant.current = person;
      return prefix === 'client' ? { ...current, client: person,
        clientAddressSameAsSite: addressKeys.includes(key as typeof addressKeys[number]) ? false : current.clientAddressSameAsSite,
        applicant: current.applicantDifferentFromClient ? current.applicant : person }
        : { ...current, applicant: person };
    });
  };
  const copySite = (prefix: 'client' | 'applicant') => {
    onChange(value => {
      const person = { ...(prefix === 'client' ? value.client : value.applicant ?? emptyPerson()),
        ...Object.fromEntries(addressKeys.map(key => [key, value.site[key]])) } as ReviewPerson;
      if (prefix === 'applicant') separateApplicant.current = person;
      return prefix === 'client' ? { ...value, client: person, clientAddressSameAsSite: true,
        applicant: value.applicantDifferentFromClient ? value.applicant : person } : { ...value, applicant: person };
    }, true);
    setAddressTarget(null);
  };
  const useSite = (prefix: 'client' | 'applicant') => {
    const person = prefix === 'client' ? review.client : review.applicant;
    if (addressKeys.some(key => person?.[key]?.trim() && person[key] !== review.site[key])) setAddressTarget(prefix);
    else copySite(prefix);
  };
  const errors = (key: string) => attempted ? issueFor(key) : undefined;
  const clientHasIssues = Object.keys(review.client).some(key => issueFor(`client.${key}`));
  const clientReady = !clientHasIssues && !issueFor('existingClientId');
  const applicantReady = !review.applicantDifferentFromClient || !Object.keys(review.applicant ?? emptyPerson()).some(key => issueFor(`applicant.${key}`));
  const source = Object.values(draft.prepared?.client ?? {}).flatMap(value => value.sources).find(source =>
    draft.documents.some(document => document.id === source.documentId));
  const savedLabel = draft.prepared?.matches.clients.find(match => match.id === selectedId)?.label;
  const titleId = useId();
  const relationshipId = useId();

  const personHeading = (person: ReviewPerson, prefix: 'client' | 'applicant') => <div className="cr-person-head">
    {prefix === 'client' ? <div className="cr-avatar" aria-hidden="true">{(person.displayName ?? '').trim().split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('') || '—'}</div> : null}
    <div className="cr-person-name">
      <PersonField person={person} name="displayName" label={prefix === 'client' ? 'Client name' : 'Applicant name'} prefix={prefix}
        required readOnly={selected && prefix === 'client'} onChange={(key, value) => updatePerson(prefix, key, value)} issue={errors(`${prefix}.displayName`)} />
      {prefix === 'client' ? <p className="cr-source">{selected ? 'Using saved client details' : source ? <>
        From <a href={`/api/application-drafts/${draft.id}/documents/${source.documentId}`} target="_blank" rel="noreferrer">{source.filename}</a>{source.page ? ` · page ${source.page}` : ''}
      </> : 'Prepared client details — correct or complete below'}</p> : null}
    </div>
    {prefix === 'client' ? <span className={`cr-status ${clientReady ? 'cr-good' : ''}`}>{clientReady ? <><Check size={12} /> {selected ? 'Saved client' : 'Details complete'}</> : 'Details to complete'}</span> : null}
  </div>;

  return <section className="client-review" ref={root} aria-labelledby={titleId}>
    <header className="cr-heading"><h2 id={titleId}>Client & Applicant</h2><p>Review the details. Fill the gaps. Confirm who’s applying.</p></header>
    <div className="cr-paper">
      <div className="cr-paper-top"><h3>Client details</h3><button type="button" className="cr-text-action" aria-expanded={searchOpen}
        onClick={() => { setSearchOpen(!searchOpen); setQuery(lookupName); setCandidate(null); }}>Search existing clients</button></div>
      {searchOpen ? <div className="cr-search">
        <label>Find an existing client<input autoFocus type="search" value={query} onChange={event => { setQuery(event.target.value); setCandidate(null); }} placeholder="Search name or email" /></label>
        {loading ? <p className="cr-helper" role="status">Searching saved clients…</p> : results.map(record => <button className="cr-result" type="button" key={record.id}
          onClick={() => clientDifferences(review.client, personFromDirectory(record), ignoredDefaults(review, draft)).length ? setCandidate(record) : choose(record)}>
          <span><strong>{record.name}</strong><small>{record.email || 'No saved email'}<br />{[record.buildingNumber, record.addressLine1, record.townCity, record.postcode].filter(Boolean).join(', ') || 'No saved address'}</small></span><span>Use client ↗</span>
        </button>)}
        {!loading && !lookupError && results.length === 0 ? <p className="cr-helper">No matching clients. Try another name or keep the prepared details.</p> : null}
        {results.length === 100 ? <p className="cr-helper">Showing 100 clients. Refine your search to find the right person.</p> : null}
        {candidate ? <div className="cr-conflict" role="region" aria-label="Saved client differences"><strong>These details differ</strong>
          {clientDifferences(review.client, personFromDirectory(candidate), ignoredDefaults(review, draft)).map(key => <p key={key}>{labels[key]}: <span>{review.client[key] || 'Not provided'}</span> → <strong>{personFromDirectory(candidate)[key] || 'Not saved'}</strong></p>)}
          <button type="button" className="cr-reuse" onClick={() => choose(candidate)}>Use this saved client</button>
          <button type="button" className="cr-text-action" onClick={() => setCandidate(null)}>Keep current details</button>
        </div> : null}
        <button type="button" className="cr-text-action" onClick={() => { setSearchOpen(false); setCandidate(null); }}>Close search</button>
      </div> : null}
      <div className="cr-body">
        {lookupError ? <p className="cr-error" role="alert">{lookupError} <button type="button" className="cr-text-action" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : null}
        {matchNotice && !searchOpen ? <p className="cr-helper" role="status">{matchNotice} <button type="button" className="cr-text-action" onClick={() => { setQuery(lookupName); setSearchOpen(true); }}>Review matches</button></p> : null}
        {personHeading(review.client, 'client')}
        {selected ? <p className="cr-saved-note">Linked to {savedLabel || review.client.displayName || 'your saved client'}.
          {' '}<a href="/clients" target="_blank" rel="noreferrer">Edit saved client ↗</a>
          <button type="button" className="cr-text-action" onClick={() => {
            manualChoice.current = true;
            onChange(value => ({ ...value, clientMode: 'create', existingClientId: null, client: previousPrepared.current, clientAddressSameAsSite: false,
              applicant: value.applicantDifferentFromClient ? value.applicant : previousPrepared.current }), true);
          }}>{previousPrepared.current.displayName ? 'Use prepared details instead' : 'Enter a new client'}</button>
        </p> : null}
        <PersonDetails person={review.client} prefix="client" onChange={(key, value) => updatePerson('client', key, value)} issueFor={errors}
          readOnly={selected} site={review.site} useSite={() => useSite('client')} sameAsSite={review.clientAddressSameAsSite} />
        {addressTarget ? <div className="cr-conflict" role="region" aria-label="Replace correspondence address"><p>Replace the {addressTarget}’s correspondence address with {[review.site.buildingNumber, review.site.addressLine1, review.site.townCity, review.site.postcode].filter(Boolean).join(', ')}?</p>
          <button type="button" className="cr-reuse" onClick={() => copySite(addressTarget)}>Use this address</button><button type="button" className="cr-text-action" onClick={() => setAddressTarget(null)}>Keep current address</button></div> : null}
        <fieldset className="cr-relationship"><legend>Is the client also the applicant?</legend><div className="cr-choices">
          <label><input type="radio" name={relationshipId} checked={!review.applicantDifferentFromClient} onChange={() => {
            separateApplicant.current = review.applicant ?? null;
            onChange(value => ({ ...value, applicantDifferentFromClient: false, applicant: value.client }), true);
          }} />Yes, use the client’s details</label>
          <label><input type="radio" name={relationshipId} checked={review.applicantDifferentFromClient} onChange={() => onChange(value => ({ ...value, applicantDifferentFromClient: true,
            applicant: separateApplicant.current ?? emptyPerson() }), true)} />No, a different applicant</label>
        </div><p className="cr-helper">{review.applicantDifferentFromClient ? 'Add the person or organisation making this application.' : 'The applicant will use the client’s details, including any corrections.'}</p></fieldset>
        {review.applicantDifferentFromClient ? <section className="cr-applicant"><h3>Applicant</h3><p className="cr-helper">These details apply to this application.</p>
          {personHeading(review.applicant ?? emptyPerson(), 'applicant')}
          <PersonDetails person={review.applicant ?? emptyPerson()} prefix="applicant" onChange={(key, value) => updatePerson('applicant', key, value)}
            issueFor={errors} readOnly={false} site={review.site} useSite={() => useSite('applicant')} />
        </section> : null}
      </div>
      <footer className="cr-foot"><div role="status"><strong>{clientReady && applicantReady ? 'Ready to continue' : 'Complete the remaining details'}</strong>
        <p>{saveState === 'saving' ? 'Saving changes…' : saveState === 'failed' ? 'Could not save. Your entries are still here.' : 'Your prepared details are already filled in.'}</p></div>
        <button type="button" className="cr-primary" disabled={busy || continuing || loading} onClick={async () => {
          setAttempted(true); setContinueError('');
          const invalid = Array.from(root.current?.querySelectorAll<HTMLInputElement>('input:not([readonly])') ?? []).find(input => !input.checkValidity());
          if (invalid) { invalid.focus(); return; }
          if (!clientReady || !applicantReady) { requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
          if (selected && lookupError) { setContinueError('Choose an available saved client before continuing.'); return; }
          setContinuing(true);
          try { if (!await onContinue()) setContinueError('Could not save these details. Your entries are still here; please retry.'); }
          catch { setContinueError('Could not save these details. Your entries are still here; please retry.'); }
          finally { setContinuing(false); }
        }}>{continuing ? <LoaderCircle size={16} className="animate-spin" /> : null}Save and continue <ArrowRight size={16} /></button>
      </footer>
      {continueError ? <p className="cr-save-error cr-error" role="alert">{continueError}</p> : null}
    </div>
  </section>;
}
