import { useEffect, useId, useRef, useState } from 'react';
import { evaluateClientApplicationDraftReadiness } from '@/lib/application-draft-readiness';
import type { ApplicationDraftResponse } from '@/server/services/application-draft-view.service';
import { blankApplicant, clientSection, directoryPerson, hasDifferentAddress, personName, preparedPerson, siteAddressReady,
  type ClientPerson, type ClientReview, type ClientSection, type DirectoryClient } from './client-review';

type Props = {
  review: ClientReview;
  prepared: ApplicationDraftResponse['prepared'];
  draftId: string;
  disabled: boolean;
  onSave: (section: ClientSection) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onConfirmationChange: (required: boolean) => void;
};

function InlineField({ label, value, onChange, required = false, readOnly = false, error, note, prominent = false, type = 'text' }: {
  label: string; value: string | null; onChange: (value: string) => void; required?: boolean; readOnly?: boolean;
  error?: string; note?: string; prominent?: boolean; type?: 'text' | 'email' | 'tel';
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [initiallyMissing] = useState(required && !value?.trim());
  const needsInput = !readOnly && (initiallyMissing || Boolean(note) || Boolean(error));
  return <label htmlFor={id} className={`block min-w-0 ${prominent ? 'text-xl' : ''}`} style={prominent && !needsInput ? { width: `${Math.max(5, Math.min((value?.length ?? 0) + 1.5, 32))}ch`, maxWidth: '100%' } : undefined}>
    <span className={needsInput ? 'label' : 'sr-only'}>{label}{needsInput && required ? ' *' : ''}</span>
    <input id={id} aria-label={label} type={type} value={value ?? ''} readOnly={readOnly || (!needsInput && !focused)}
      required={required} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={event => onChange(event.target.value)} placeholder={needsInput ? `Enter ${label.toLowerCase()}` : 'Not provided'}
      aria-invalid={Boolean(error)} aria-describedby={error || note ? `${id}-note` : undefined}
      className={needsInput ? `field ${error ? 'border-red-300' : ''}`
        : `w-full min-w-0 rounded-sm border border-transparent bg-transparent px-0 py-1 outline-none transition focus:border-moss focus:bg-stone-50 focus:px-2 focus:ring-2 focus:ring-moss/20 ${prominent ? 'text-xl font-semibold text-ink' : 'text-sm text-stone-700'} ${readOnly ? 'cursor-default' : 'cursor-text'}`} />
    {error || note ? <span id={`${id}-note`} className={`mt-1 block text-xs leading-5 ${error ? 'text-red-700' : 'text-stone-500'}`}>{error || note}</span> : null}
  </label>;
}

function PersonDetails({ person, prefix, requiredKeys, issues, submitted, onChange, readOnly = false, prepared, version }: {
  person: ClientPerson; prefix: 'client' | 'applicant'; requiredKeys: Set<string>; issues: ReturnType<typeof evaluateClientApplicationDraftReadiness>;
  submitted: boolean; onChange: (key: keyof ClientPerson, value: string) => void; readOnly?: boolean;
  prepared?: ApplicationDraftResponse['prepared']; version: number;
}) {
  const field = (key: keyof ClientPerson, label: string, prominent = false, type: 'text' | 'email' | 'tel' = 'text') => {
    const suggestion = prepared?.client[key === 'displayName' ? 'name' : key];
    const conflict = suggestion?.status === 'conflict' && String(suggestion.value ?? '') === String(person[key] ?? '');
    const uncertain = version === 0 && suggestion?.status === 'suggested' && suggestion.certainty !== 'high'
      && String(suggestion.value ?? '') === String(person[key] ?? '');
    const issue = issues.find(item => item.key === `${prefix}.${key}`)?.message;
    const invalidEmail = type === 'email' && Boolean(person[key]?.trim()) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person[key] ?? '');
    return <InlineField key={`${version}-${key}`} label={label} value={person[key]} onChange={value => onChange(key, value)} prominent={prominent} type={type}
      required={requiredKeys.has(key)} readOnly={readOnly} error={submitted ? invalidEmail ? 'Enter a valid email address.' : issue : undefined}
      note={conflict ? `The documents also give ${String(suggestion.currentValue ?? 'another value')}. Check the correct ${label.toLowerCase()}.`
        : uncertain ? `Check the ${label.toLowerCase()} suggested by the documents.` : undefined} />;
  };
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(' ');
  const [addressFocused, setAddressFocused] = useState(false);
  useEffect(() => { setAddressFocused(false); }, [version]);
  return <div className="min-w-0">
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="min-w-0">
        {person.clientType === 'INDIVIDUAL' && (fullName || requiredKeys.has('firstName') || requiredKeys.has('lastName')) ? <div className="flex flex-wrap gap-x-2 gap-y-3" aria-label={personName(person)}>
          {field('firstName', 'First name', true)}{field('lastName', 'Last name', true)}
        </div> : field(person.clientType === 'ORGANISATION' ? 'companyName' : 'displayName', person.clientType === 'ORGANISATION' ? 'Company name' : 'Name', true)}
        {person.displayName && person.displayName !== (person.clientType === 'ORGANISATION' ? person.companyName : fullName) ? <div className="mt-1">{field('displayName', 'Display name')}</div> : null}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
          {person.clientType === 'INDIVIDUAL' ? <label><span className="sr-only">Title</span>
            <select aria-label="Title" value={person.title ?? ''} disabled={readOnly} onChange={event => onChange('title', event.target.value)}
              style={{ width: `${Math.max(3, (person.title?.length ?? 11) + 1.5)}ch` }}
              className={`max-w-full rounded-sm border bg-transparent py-1 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20 ${requiredKeys.has('title') && !person.title ? 'border-stone-300 px-2' : 'appearance-none border-transparent'}`}>
              <option value="">Choose title</option>{['Mr', 'Mrs', 'Miss', 'Ms', 'Other'].map(title => <option key={title}>{title}</option>)}
            </select></label> : null}
          {person.clientType === 'INDIVIDUAL' ? <span aria-hidden="true">·</span> : null}
          <label><span className="sr-only">{prefix === 'client' ? 'Client type' : 'Applicant type'}</span>
            <select aria-label={prefix === 'client' ? 'Client type' : 'Applicant type'} value={person.clientType} disabled={readOnly}
              onChange={event => onChange('clientType', event.target.value)} className="max-w-full appearance-none rounded-sm border border-transparent bg-transparent py-1 outline-none focus:border-moss focus:ring-2 focus:ring-moss/20">
              <option value="INDIVIDUAL">Individual</option><option value="ORGANISATION">Organisation</option>
            </select></label>
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">{person.email || requiredKeys.has('email') ? field('email', 'Email', false, 'email') : <p className="py-1 text-sm text-stone-500">Email not provided</p>}{person.phone || requiredKeys.has('phone') ? field('phone', 'Phone', false, 'tel') : null}</div>
        <div onFocusCapture={() => setAddressFocused(true)}>
          <div className="grid grid-cols-[minmax(4rem,0.25fr)_minmax(0,1fr)] gap-x-3 gap-y-2">
            {person.buildingNumber || requiredKeys.has('buildingNumber') ? field('buildingNumber', 'Building number') : null}
            {person.addressLine1 || requiredKeys.has('addressLine1') || (addressFocused && !readOnly) ? field('addressLine1', 'Address line 1') : null}
          </div>
          {person.addressLine2 || (addressFocused && !readOnly) ? field('addressLine2', 'Address line 2') : null}
          <div className="grid grid-cols-2 gap-3">{person.townCity || requiredKeys.has('townCity') || (addressFocused && !readOnly) ? field('townCity', 'Town or city') : null}{person.postcode || requiredKeys.has('postcode') || (addressFocused && !readOnly) ? field('postcode', 'Postcode') : null}</div>
          {person.country ? field('country', 'Country') : null}
        </div>
      </div>
    </div>
  </div>;
}

export default function ClientApplicantReview(props: Props) {
  const { review, prepared, draftId } = props;
  const [value, setValue] = useState(() => {
    const initial = clientSection(review);
    if (!initial.client.displayName) initial.client.displayName = [initial.client.firstName, initial.client.lastName].filter(Boolean).join(' ') || initial.client.companyName;
    return initial;
  });
  const valueRef = useRef(value);
  const dirty = useRef(false);
  const preparedClient = useRef(review.clientMode === 'create' ? { ...review.client } : preparedPerson(prepared));
  const separate = useRef<ClientPerson | null>(review.applicantDifferentFromClient && review.applicant ? { ...review.applicant } : null);
  const [relationship, setRelationship] = useState<'yes' | 'no' | null>(typeof review.applicantDifferentFromClient === 'boolean' ? review.applicantDifferentFromClient ? 'no' : 'yes' : null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<DirectoryClient[]>([]);
  const [searchState, setSearchState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [confirmedSelection, setConfirmedSelection] = useState(false);
  const strongMatches = prepared?.matches.clients.filter(match => match.strength === 'strong') ?? [];
  const needsConfirmation = value.clientMode === 'existing' && strongMatches.length > 1 && !confirmedSelection;
  const searchRef = useRef<HTMLInputElement>(null);
  const personalKey = JSON.stringify(clientSection(review));
  const localIssues = evaluateClientApplicationDraftReadiness({ ...review, ...value }).filter(issue => issue.section === 'client');
  const clientRequirements = new Set(evaluateClientApplicationDraftReadiness({ ...review, ...value, client: { ...blankApplicant(), clientType: value.client.clientType } }).filter(issue => issue.key.startsWith('client.')).map(issue => issue.key.slice(7)));
  const applicantRequirements = new Set(evaluateClientApplicationDraftReadiness({ ...review, ...value, applicant: blankApplicant() }).filter(issue => issue.key.startsWith('applicant.')).map(issue => issue.key.slice(10)));
  const changingDirectory = value.clientMode === 'existing';

  useEffect(() => { props.onConfirmationChange(needsConfirmation); }, [needsConfirmation]);
  useEffect(() => {
    if (!dirty.current) { const next = clientSection(review); valueRef.current = next; setValue(next); setRelationship(typeof next.applicantDifferentFromClient === 'boolean' ? next.applicantDifferentFromClient ? 'no' : 'yes' : null); }
  }, [personalKey, version]);
  useEffect(() => {
    if (separate.current) return;
    try { const cached = JSON.parse(sessionStorage.getItem(`applicant-review:${draftId}`) ?? 'null');
      if (cached && ['INDIVIDUAL', 'ORGANISATION'].includes(cached.clientType) && Object.keys(blankApplicant()).every(key => cached[key] === null || typeof cached[key] === 'string')) separate.current = cached;
    } catch { /* Recovery still works in memory when browser storage is unavailable. */ }
  }, [draftId]);
  useEffect(() => {
    if (!searching && value.clientMode !== 'existing') return;
    const controller = new AbortController();
    const term = searching ? query : value.existingClientId ?? '';
    const timer = window.setTimeout(async () => {
      setSearchState('loading');
      try { const response = await fetch(`/api/clients?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (controller.signal.aborted) return;
        setClients(result.clients); setSearchState('ready');
        if (!searching && !dirty.current) {
          const record = result.clients.find((client: DirectoryClient) => client.id === value.existingClientId);
          if (record) { const next = { ...valueRef.current, client: directoryPerson(record) }; valueRef.current = next; setValue(next); }
        }
      } catch { if (!controller.signal.aborted) { setClients([]); setSearchState('error'); } }
    }, searching ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [searching, query, value.clientMode, value.existingClientId, searchAttempt]);
  useEffect(() => { if (searching) searchRef.current?.focus(); }, [searching]);

  const change = (next: ClientSection) => { dirty.current = true; props.onDirtyChange(true); valueRef.current = next; setValue(next); setMessage(''); };
  const remember = (person: ClientPerson) => { separate.current = { ...person }; try { sessionStorage.setItem(`applicant-review:${draftId}`, JSON.stringify(person)); } catch { /* Optional browser storage. */ } };
  const updatePerson = (target: 'client' | 'applicant', key: keyof ClientPerson, content: string) => {
    const current = valueRef.current;
    const previous = target === 'client' ? current.client : current.applicant ?? blankApplicant();
    const person = { ...previous, [key]: content || null };
    if (key === 'firstName' || key === 'lastName') {
      const previousName = [previous.firstName, previous.lastName].filter(Boolean).join(' ');
      if (!previous.displayName || previous.displayName === previousName) person.displayName = [person.firstName, person.lastName].filter(Boolean).join(' ') || null;
    }
    if (key === 'companyName' && (!previous.displayName || previous.displayName === previous.companyName)) person.displayName = person.companyName;
    if (target === 'applicant') remember(person);
    change({ ...current, [target]: person,
      ...(target === 'client' && ['buildingNumber','addressLine1','addressLine2','townCity','postcode','country'].includes(key) ? { clientAddressSameAsSite: false } : {}),
    });
  };
  const chooseRelationship = (answer: 'yes' | 'no') => {
    const current = valueRef.current;
    if (current.applicantDifferentFromClient && current.applicant) remember(current.applicant);
    setRelationship(answer);
    change({ ...current, applicantDifferentFromClient: answer === 'no', applicant: answer === 'no' ? { ...(separate.current ?? blankApplicant()) } : current.applicant });
  };
  const selectClient = (record: DirectoryClient | null) => {
    const current = valueRef.current;
    if (current.clientMode === 'create') preparedClient.current = { ...current.client };
    setConfirmedSelection(true);
    change({ ...current, clientMode: record ? 'existing' : 'create', existingClientId: record?.id ?? null,
      client: record ? directoryPerson(record) : { ...preparedClient.current }, clientAddressSameAsSite: false });
    setSearching(false);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSubmitted(true); setMessage('');
    if (!relationship) { setMessage('Choose Yes or No for the applicant.'); return; }
    if (needsConfirmation) { setMessage('Choose the matching saved client.'); setSearching(true); return; }
    setSaving(true);
    try {
      const saved = await props.onSave(valueRef.current);
      if (!saved) { setMessage('Could not save. Your entered details are kept; try Save and continue again.'); return; }
      dirty.current = false; props.onDirtyChange(false); setVersion(number => number + 1);
      if (localIssues.length) setMessage('Draft saved. Complete the missing details before creating the application.');
      else {
        setSubmitted(false); setMessage('Client and applicant details saved.');
        const next = document.querySelector('#client-applicant-review')?.nextElementSibling;
        const summary = next?.querySelector<HTMLElement>('summary');
        summary?.focus();
        next?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      }
    } finally { setSaving(false); }
  };

  return <section id="client-applicant-review" aria-labelledby="client-review-heading" className="panel scroll-mt-6 rounded-lg">
    <div className="px-5 py-5 sm:px-6 sm:py-6">
      <h2 id="client-review-heading" className="text-base font-semibold text-ink">Client &amp; Applicant</h2>
      <form onSubmit={event => void save(event)} noValidate className="mt-5">
        <fieldset disabled={saving || props.disabled} className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Client details</h3>
            <button type="button" className="min-h-9 text-xs font-semibold text-stone-600 underline decoration-stone-300 underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss" aria-expanded={searching} onClick={() => setSearching(!searching)}>Search saved clients</button>
          </div>
          {localIssues.length ? <p className="mb-4 text-sm text-stone-600">Some client details need completing.</p> : null}
          <PersonDetails person={value.client} prefix="client" requiredKeys={clientRequirements} issues={localIssues} submitted={submitted}
            onChange={(key, content) => updatePerson('client', key, content)} readOnly={changingDirectory} prepared={prepared} version={version} />
          {changingDirectory ? <p className="mt-3 text-xs text-stone-500">Using saved client details. They will remain unchanged.</p> : null}
          {!changingDirectory && !value.clientAddressSameAsSite && !value.client.addressLine1 && siteAddressReady(review.site) && !hasDifferentAddress(value.client, review.site) ? <button type="button" className="mt-3 min-h-10 text-sm font-semibold text-stone-600 underline decoration-stone-300 underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-moss"
            onClick={() => { const {localAuthority: _authority,...address}=review.site;change({...valueRef.current,clientAddressSameAsSite:true,client:{...valueRef.current.client,...address}}); }}>Use the confirmed site address for this client</button>
          : value.clientAddressSameAsSite ? <p className="mt-2 text-xs text-stone-500">Client address matches the site address.</p> : null}

          {searching ? <div className="mt-4 border-t border-stone-200 pt-4">
            <label className="block"><span className="label">Find a saved client</span><input ref={searchRef} type="search" className="field" value={query} placeholder="Name, email, phone or postcode" onChange={event=>setQuery(event.target.value)} /></label>
            <div className="mt-3 max-h-60 overflow-y-auto overscroll-contain divide-y divide-stone-100">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-3 text-sm"><input type="radio" name={`client-${draftId}`} checked={value.clientMode==='create'} onChange={()=>selectClient(null)} className="mt-1 text-ink focus:ring-moss" /><span>Keep the prepared client details</span></label>
              {searchState==='ready'?clients.map(record=><label key={record.id} className="flex cursor-pointer items-start gap-3 py-3 text-sm"><input type="radio" name={`client-${draftId}`} checked={value.existingClientId===record.id} onChange={()=>selectClient(record)} onClick={()=>{if(value.existingClientId===record.id)selectClient(record);}} className="mt-1 text-ink focus:ring-moss" />
                <span className="min-w-0"><strong className="block break-words font-semibold">{record.name}</strong><span className="mt-1 block break-words text-xs text-stone-500">{[record.email,record.phone,record.postcode].filter(Boolean).join(' · ')||'Contact details not provided'}</span></span></label>):null}
            </div>
            <p className="mt-2 text-xs text-stone-500" role="status">{searchState==='loading'?'Searching…':searchState==='error'?'Could not load saved clients. Your current details are kept.':clients.length===0?'No clients found. Try another name.':clients.length===100?'Refine your search to find older clients.':''}</p>
            {searchState==='error'?<button type="button" className="mt-2 min-h-9 text-xs font-semibold underline underline-offset-4" onClick={()=>setSearchAttempt(number=>number+1)}>Try search again</button>:null}
          </div>:null}

          <fieldset className="mt-5 border-t border-stone-200 pt-5">
            <legend className="float-left mb-3 w-full text-sm font-semibold text-ink">Is the client also the applicant?</legend>
            <div className="clear-both inline-flex overflow-hidden rounded-md border border-stone-300">
              {(['yes','no'] as const).map(answer=><label key={answer} className={`relative flex min-h-10 min-w-20 cursor-pointer items-center justify-center px-5 text-sm font-semibold transition ${relationship===answer?'bg-ink text-paper':'bg-white text-stone-600 hover:bg-stone-50'} focus-within:ring-2 focus-within:ring-inset focus-within:ring-moss`}>
                <input className="absolute inset-0 h-full w-full cursor-pointer opacity-0" type="radio" name={`applicant-relationship-${draftId}`} aria-label={answer==='yes'?'Yes':'No'} checked={relationship===answer} onChange={()=>chooseRelationship(answer)} />{answer==='yes'?'Yes':'No'}
              </label>)}
            </div>
            {relationship==='yes'?<p className="mt-3 text-xs text-stone-500">Applicant details will be the same as the client.</p>:relationship==='no'?<div className="mt-5"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Applicant details</h3>
              <PersonDetails person={value.applicant??blankApplicant()} prefix="applicant" requiredKeys={applicantRequirements} issues={localIssues} submitted={submitted} onChange={(key,content)=>updatePerson('applicant',key,content)} version={version} />
            </div>:null}
          </fieldset>
        </fieldset>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-5">
          <p className="min-w-0 text-xs leading-5 text-stone-500" role="status" aria-live="polite">{saving?'Saving client and applicant details…':message||'Review the details, then save to continue.'}</p>
          <button type="submit" className="btn btn-primary shrink-0" disabled={saving||props.disabled}>{saving?'Saving…':'Save and continue'}</button>
        </div>
      </form>
    </div>
  </section>;
}
