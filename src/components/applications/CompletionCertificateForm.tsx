import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import {
  COMPLETION_TEXT_LIMIT,
  REGISTER_PART2,
  applyCompletionDocuments,
  registerPart1Codes,
  type CertificateRegister,
  type CompletionCertificateEntry,
  type CompletionIssue,
  type CompletionParties,
  type CompletionPreparation,
} from '@/lib/completion-certificate';
import {
  COMPLETION_DOCUMENT_ROLES,
  type CompletionDocument,
  type CompletionDocumentRoleKey,
} from '@/lib/completion-documents';

export type CompletionJobStatus = {
  id: string;
  status: string;
  progressMessage: string | null;
  progressPercent: number | null;
  resultSummary: string | null;
  error: string | null;
};

type Props = {
  warrantId: string;
  initial: CompletionPreparation;
  initialIssues: CompletionIssue[];
  parties: CompletionParties;
  documents: Array<{ id: string; name: string }>;
  clientHref: string;
  settingsHref: string;
  today: string;
  activeJob: CompletionJobStatus | null;
};

// The portal's answers that this version always gives. See the follow-up
// notes in src/lib/completion-certificate.ts.
const FIXED_ANSWER_ROWS: Array<[string, string]> = [
  ['Did you obtain a building warrant for this?', 'Yes'],
  ['Compliance, enforcement and defective buildings notice references', 'N/A'],
  ['Is the building subject to any Dangerous building notice(s)?', 'No'],
  ['Are you the relevant person or an agent?', 'Agent'],
  ['Do you want to use your registered account details?', 'Yes'],
  ['Is the relevant person an individual or an organisation?', 'Individual'],
  ['Is the Relevant Person the owner of the building?', 'Yes'],
  ['Is the building address different from the associated building warrant?', 'No'],
  ['Does this submission cover all the work under the building warrant?', 'Yes'],
];

// Changes save themselves this long after the last edit.
const AUTOSAVE_DELAY_MS = 800;
const AUTOSAVE_RETRY_MS = 5000;

type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';
type SavedState = { preparation: CompletionPreparation; issues: CompletionIssue[] };

const WAITING_STATUSES = new Set(['READY', 'CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW']);
// The Agent reports a finished run as COMPLETED; older flows use AWAITING_PORTAL_REVIEW.
const FINISHED_STATUSES = new Set(['COMPLETED', 'AWAITING_PORTAL_REVIEW']);
const JOB_LABELS: Record<string, string> = {
  READY: 'Queued for the Architect Pro Agent',
  CLAIMED: 'Starting',
  IN_PROGRESS: 'Running in eBuilding Standards',
  NEEDS_REVIEW: 'Needs attention in the Agent',
  AWAITING_PORTAL_REVIEW: 'Ready to submit — review it in eBuilding Standards',
  COMPLETED: 'Ready to submit — review it in eBuilding Standards',
  CANCELLED: 'Cancelled',
  FAILED_RETRYABLE: 'Stopped before finishing',
  FAILED_FINAL: 'Stopped before finishing',
};

const readError = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
};

function YesNo({ legend, value, onChange, hint }: {
  legend: string; value: boolean | null; onChange: (value: boolean) => void; hint?: string;
}) {
  const name = useId();
  return (
    <fieldset className="mt-4">
      <legend className="prep-field-question">{legend}</legend>
      {hint && <p className="mb-2 text-sm text-stone-500">{hint}</p>}
      <div className="flex gap-5">
        {[true, false].map((option) => (
          <label key={String(option)} className="inline-flex min-h-10 items-center gap-2 text-sm text-ink">
            <input type="radio" name={name} className="h-4 w-4 accent-[#526a4a]" checked={value === option} onChange={() => onChange(option)} />
            {option ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LimitedText({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string) => void }) {
  const length = (value ?? '').length;
  return (
    <label className="mt-4 block">
      <span className="prep-field-question">{label}</span>
      <textarea className="field" rows={5} maxLength={COMPLETION_TEXT_LIMIT} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
      <span className="mt-1 block text-xs text-stone-500" aria-live="polite">{length} / {COMPLETION_TEXT_LIMIT} characters</span>
    </label>
  );
}

function CertificateEntries({ register, title, entries, onChange, filenames, today }: {
  register: CertificateRegister;
  title: string;
  entries: CompletionCertificateEntry[];
  onChange: (entries: CompletionCertificateEntry[]) => void;
  filenames: Record<string, string>;
  today: string;
}) {
  const codes = registerPart1Codes(register);
  const update = (index: number, change: Partial<CompletionCertificateEntry>) =>
    onChange(entries.map((entry, position) => (position === index ? { ...entry, ...change } : entry)));
  const registration = (
    index: number,
    key: 'certifierRegistration' | 'approvedBodyRegistration',
    label: string,
    fixedPart: string,
  ) => {
    const value = entries[index][key];
    return (
      <div>
        <span className="prep-field-question">{label}</span>
        <div className="flex items-center gap-2">
          <select
            className="field w-28" aria-label={`${label}: prefix`} value={value.part1}
            onChange={(event) => update(index, { [key]: { ...value, part1: event.target.value, part2: fixedPart } })}
          >
            <option value="">Choose</option>
            {codes.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
          <span className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700" aria-label="Fixed by the portal">{fixedPart}</span>
          <input
            className="field" inputMode="numeric" aria-label={`${label}: number`} placeholder="Number" maxLength={40} value={value.number}
            onChange={(event) => update(index, { [key]: { ...value, number: event.target.value, part2: fixedPart } })}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="prep-followup mt-4">
      {entries.map((entry, index) => (
        <fieldset key={index} className="mb-4 rounded-lg border border-stone-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-ink">
            {title} {index + 1}{entry.documentId && filenames[entry.documentId] ? ` — ${filenames[entry.documentId]}` : ''}
          </legend>
          <p className="mb-3 text-xs text-stone-500">Read from the uploaded certificate. Check each value.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="prep-field-question">Certificate number</span>
              <input className="field" maxLength={80} value={entry.certificateNumber} onChange={(event) => update(index, { certificateNumber: event.target.value })} />
            </label>
            {registration(index, 'certifierRegistration', 'Certifier registration number (Part A)', REGISTER_PART2[register].certifier)}
            <label className="block">
              <span className="prep-field-question">Certifier date of signature</span>
              <input type="date" className="field" max={today} value={entry.certifierSignatureDate ?? ''} onChange={(event) => update(index, { certifierSignatureDate: event.target.value || null })} />
            </label>
            {registration(index, 'approvedBodyRegistration', 'Approved body registration number (Part B)', REGISTER_PART2[register].approvedBody)}
            <label className="block">
              <span className="prep-field-question">Approved body date of signature</span>
              <input type="date" className="field" max={today} value={entry.approvedBodySignatureDate ?? ''} onChange={(event) => update(index, { approvedBodySignatureDate: event.target.value || null })} />
            </label>
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section className="mt-7 border-t border-stone-200 pt-6 first-of-type:mt-0 first-of-type:border-t-0 first-of-type:pt-0" aria-labelledby={heading}>
      <h2 id={heading} className="text-xl font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
      {children}
    </section>
  );
}

function PartySummary({ rows, href, action }: { rows: Array<[string, string | null]>; href: string; action: string }) {
  return (
    <div className="mt-4">
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="prep-summary-row">
            <dt className="text-stone-500">{label}</dt>
            <dd className={value ? 'text-ink' : 'font-semibold text-amber-800'}>{value || 'Missing'}</dd>
          </div>
        ))}
      </dl>
      <a href={href} className="mt-3 inline-block text-sm font-semibold text-moss hover:text-ink">{action}</a>
    </div>
  );
}

export default function CompletionCertificateForm({
  warrantId, initial, initialIssues, parties, documents, clientHref, settingsHref, today, activeJob,
}: Props) {
  const [preparation, setPreparation] = useState(initial);
  const [issues, setIssues] = useState(initialIssues);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [saveError, setSaveError] = useState('');
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState('');
  // The latest answers and which edit they are, so a save that finishes after
  // further typing never replaces the newer text.
  const preparationRef = useRef(initial);
  const issuesRef = useRef(initialIssues);
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const saveInFlight = useRef<Promise<CompletionIssue[] | null> | null>(null);
  const [job, setJob] = useState(activeJob);
  const [uploading, setUploading] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const queueInFlight = useRef(false);
  const endpoint = `/api/building-warrant/${encodeURIComponent(warrantId)}/completion-certificate`;

  const change = (update: Partial<CompletionPreparation>) => {
    const next = { ...preparationRef.current, ...update };
    preparationRef.current = next;
    revisionRef.current += 1;
    setPreparation(next);
    setDirty(true);
    setSaveStatus('pending');
  };

  // Accept what the server now holds, e.g. after an upload.
  const acceptSaved = (body: SavedState) => {
    preparationRef.current = body.preparation;
    issuesRef.current = body.issues;
    revisionRef.current += 1;
    savedRevisionRef.current = revisionRef.current;
    setPreparation(body.preparation);
    setIssues(body.issues);
    setDirty(false);
    setSaveStatus('saved');
  };

  // Follow the Agent while a run is waiting or in progress.
  const jobId = job?.id;
  const jobWaiting = job ? WAITING_STATUSES.has(job.status) : false;
  useEffect(() => {
    if (!jobId || !jobWaiting) return undefined;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/automation-jobs/${encodeURIComponent(jobId)}/status`).catch(() => null);
      if (!response?.ok) return;
      const body = await response.json().catch(() => null) as { job?: CompletionJobStatus } | null;
      if (body?.job) setJob({ ...body.job, id: jobId });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [jobId, jobWaiting]);

  /** Save the latest answers. One save at a time; returns the issues, or null if it failed. */
  const saveNow = async (): Promise<CompletionIssue[] | null> => {
    if (saveInFlight.current) await saveInFlight.current;
    if (revisionRef.current === savedRevisionRef.current) return issuesRef.current;
    const revision = revisionRef.current;
    const run = (async () => {
      setSaveStatus('saving');
      try {
        const response = await fetch(`${endpoint}/preparation`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(preparationRef.current),
        });
        if (!response.ok) throw new Error(await readError(response, 'Could not save the completion certificate details.'));
        const body = await response.json() as SavedState;
        savedRevisionRef.current = Math.max(savedRevisionRef.current, revision);
        setSaveError('');
        if (revisionRef.current === revision) {
          acceptSaved(body);
        } else {
          setSaveStatus('pending');  // newer edits save next
        }
        return body.issues;
      } catch (requestError) {
        setSaveStatus('error');
        setSaveError(requestError instanceof Error ? requestError.message : 'Could not save the completion certificate details.');
        window.setTimeout(() => { void saveNow(); }, AUTOSAVE_RETRY_MS);
        return null;
      }
    })();
    saveInFlight.current = run;
    try {
      return await run;
    } finally {
      if (saveInFlight.current === run) saveInFlight.current = null;
    }
  };

  /** Wait until everything typed so far is saved. */
  const flush = async (): Promise<CompletionIssue[] | null> => {
    let latest: CompletionIssue[] | null = issuesRef.current;
    for (let attempt = 0; attempt < 5 && revisionRef.current !== savedRevisionRef.current; attempt += 1) {
      latest = await saveNow();
      if (latest === null) return null;
    }
    if (saveInFlight.current) latest = await saveInFlight.current;
    return latest;
  };

  // Save shortly after the last change.
  useEffect(() => {
    if (!dirty) return undefined;
    const timer = window.setTimeout(() => { void saveNow(); }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [preparation, dirty]);

  // Warn before leaving with changes not yet saved.
  useEffect(() => {
    if (!dirty && saveStatus !== 'saving') return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saveStatus]);

  // Uploads are saved straight away, so save typed changes first.
  const addDocuments = async (request: (body: RequestInit) => RequestInit[]) => {
    setError('');
    setUploadError('');
    if (await flush() === null) {
      setUploadError('Your latest changes could not be saved, so the document was not added. Try again in a moment.');
      setUploading('');
      return;
    }
    for (const init of request({})) {
      try {
        const response = await fetch(`${endpoint}/documents`, { method: 'POST', ...init });
        if (!response.ok) throw new Error(await readError(response, 'Could not add that document.'));
        acceptSaved(await response.json() as SavedState);
      } catch (requestError) {
        setUploadError(requestError instanceof Error ? requestError.message : 'Could not add that document.');
        break;
      }
    }
    setUploading('');
  };

  const uploadFiles = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setUploading(list.length === 1 ? `Reading ${list[0].name}…` : `Reading ${list.length} documents…`);
    void addDocuments(() => list.map((file) => {
      const form = new FormData();
      form.append('file', file);
      return { body: form };
    }));
  };

  const attachExisting = (documentId: string, name: string) => {
    setUploading(`Reading ${name}…`);
    void addDocuments(() => [{ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentId }) }]);
  };

  const setDocuments = (documents: CompletionDocument[]) => change({ documents });

  const queue = async () => {
    // One portal run per confirmation, however many times the button is pressed.
    if (queueInFlight.current) return;
    queueInFlight.current = true;
    setQueueing(true);
    setError('');
    try {
      const latest = await flush();
      if (latest === null) throw new Error('Your latest changes could not be saved yet. Try again in a moment.');
      if (latest.length) throw new Error('Some details are still missing. See Missing information.');
      const response = await fetch(`${endpoint}/run`, { method: 'POST' });
      if (!response.ok) throw new Error(await readError(response, 'Could not send the completion certificate to the Agent.'));
      const body = await response.json() as { redirectTo: string };
      window.location.assign(body.redirectTo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not send the completion certificate to the Agent.');
      queueInFlight.current = false;
      setQueueing(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    setError('');
    const response = await fetch(`/api/automation-jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' }).catch(() => null);
    if (!response?.ok) {
      setError(response ? await readError(response, 'Could not cancel this run.') : 'Could not cancel this run.');
      return;
    }
    setJob({ ...job, status: 'CANCELLED', progressMessage: 'Cancelled' });
  };

  // What will be sent: answers that follow the uploads, and one entry per uploaded certificate.
  const view = applyCompletionDocuments(preparation);
  const { relaxation, constructionCertificates, designCertificates, continuingRequirements } = view;
  const attached = new Set(view.documents.map((document) => document.documentId));
  const filenames = Object.fromEntries(view.documents.map((document) => [document.documentId, document.filename]));
  const projectDocuments = documents.filter((document) => !attached.has(document.id));
  const hasWarrant = view.documents.some((document) => document.role === 'BUILDING_WARRANT');
  const client = parties.client;
  const agent = parties.agent;
  const canQueue = !issues.length && !queueing && !jobWaiting && saveStatus !== 'error';
  const saveLabel = saveStatus === 'error'
    ? `Couldn't save: ${saveError} Retrying…`
    : saveStatus === 'saved' ? 'All changes saved' : 'Saving…';

  return (
    <div className="prep-form">
      {job && (
        <section className="mb-6 rounded-lg border border-stone-200 bg-moss/[0.04] p-5" aria-live="polite" aria-label="Completion certificate run">
          <p className="label">Architect Pro Agent</p>
          <p className="text-lg font-semibold text-ink">{JOB_LABELS[job.status] ?? job.status.toLowerCase().replaceAll('_', ' ')}</p>
          {jobWaiting && job.progressMessage && <p className="mt-1 text-sm text-stone-600">{job.progressMessage}</p>}
          {job.status === 'IN_PROGRESS' && job.progressPercent != null && (
            <progress className="mt-3 h-2 w-full" max={100} value={Math.max(0, Math.min(100, job.progressPercent))} aria-label="Completion certificate progress" />
          )}
          {!jobWaiting && !FINISHED_STATUSES.has(job.status) && (job.error || job.resultSummary) && <p className="mt-1 text-sm text-stone-600">{job.error || job.resultSummary}</p>}
          {FINISHED_STATUSES.has(job.status) && (
            <p className="mt-2 text-sm text-stone-600">Main Details, supporting documents, email notification and the declaration are done. Review it and submit it in eBuilding Standards.</p>
          )}
          {jobWaiting && job.status !== 'NEEDS_REVIEW' && <button type="button" className="btn btn-secondary mt-4" onClick={() => void cancel()}>Cancel run</button>}
        </section>
      )}

      <div className="panel rounded-lg p-5">
        <Section
          title="Completion documents"
          description="Upload anything that should go with this completion certificate. Each document is read to work out what it is, and the answers below follow from what you upload."
        >
          {!hasWarrant && (
            <p className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
              Tip: upload the granted building warrant too. It is only read to fill in the warrant reference and dates, and is not sent to the council.
            </p>
          )}
          <label
            className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center hover:border-moss ${dragging ? 'border-moss bg-moss/5' : 'border-stone-300 bg-white'}`}
            onDragOver={(event) => { event.preventDefault(); if (!uploading) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); if (!uploading) uploadFiles(event.dataTransfer.files); }}
          >
            <span className="text-sm font-semibold text-ink">Drop files here or click to choose</span>
            <span className="mt-1 text-xs text-stone-500">PDF is best. EPC, statement of sustainability, Fire Safety Design Summary, certificates, the building warrant or anything else.</span>
            <input
              type="file" multiple className="sr-only" accept="application/pdf,image/jpeg,image/png" disabled={Boolean(uploading)}
              onChange={(event) => { uploadFiles(event.target.files); event.target.value = ''; }}
            />
          </label>
          {uploading && <p role="status" className="mt-2 text-sm text-stone-600">{uploading}</p>}
          {uploadError && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{uploadError}</p>}

          {view.documents.length > 0 && (
            <ul className="mt-4 divide-y divide-stone-200 rounded-lg border border-stone-200">
              {view.documents.map((document) => (
                <li key={document.documentId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={document.filename}>{document.filename}</span>
                  <select
                    className="field w-auto" aria-label={`What ${document.filename} is`} value={document.role}
                    onChange={(event) => setDocuments(view.documents.map((item) => item.documentId === document.documentId
                      ? { ...item, role: event.target.value as CompletionDocumentRoleKey, source: 'manual' } : item))}
                  >
                    {COMPLETION_DOCUMENT_ROLES.filter((role) => role.key !== 'UNRECOGNISED' || document.role === 'UNRECOGNISED')
                      .map((role) => <option key={role.key} value={role.key}>{role.key === 'UNRECOGNISED' ? 'Not recognised — choose' : role.label}</option>)}
                  </select>
                  <span className="text-xs text-stone-500">
                    {document.role === 'BUILDING_WARRANT' ? 'Read only, not sent' : document.source === 'manual' ? 'Chosen by you' : 'Recognised automatically'}
                  </span>
                  <button
                    type="button" className="text-sm font-semibold text-stone-600 hover:text-ink"
                    onClick={() => setDocuments(view.documents.filter((item) => item.documentId !== document.documentId))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {projectDocuments.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-semibold text-moss">Add a document already in this project ({projectDocuments.length})</summary>
              <ul className="mt-2 space-y-1">
                {projectDocuments.map((document) => (
                  <li key={document.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-stone-700">{document.name}</span>
                    <button type="button" className="btn btn-secondary" disabled={Boolean(uploading)} onClick={() => attachExisting(document.id, document.name)}>Add</button>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <dl className="mt-4 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            {([
              ['Energy Performance Certificate', view.energyPerformanceCertificate],
              ['Statement of Sustainability', view.sustainabilityStatement],
              ['Fire Safety Design Summary', view.fireSafetyDesignSummary],
              ['Certificates of construction', constructionCertificates.accompany],
            ] as Array<[string, boolean | null]>).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-stone-600">{label}</dt>
                <dd className="font-semibold text-ink">{value ? 'Yes' : 'No'}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Completion and warrant details">
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="prep-field-question">Date work was completed</span>
              <input type="date" className="field" max={today} value={preparation.workCompletedDate ?? ''} onChange={(event) => change({ workCompletedDate: event.target.value || null })} />
            </label>
            <label className="block">
              <span className="prep-field-question">Building warrant reference number</span>
              <input className="field" placeholder="e.g. 19/11111/WARR" maxLength={120} value={preparation.warrantReference ?? ''} onChange={(event) => change({ warrantReference: event.target.value })} />
            </label>
            <label className="block">
              <span className="prep-field-question">Date of building warrant</span>
              <input type="date" className="field" max={today} value={preparation.warrantDate ?? ''} onChange={(event) => change({ warrantDate: event.target.value || null })} />
            </label>
          </div>
          <LimitedText label="Dates of any amendments given (optional)" value={preparation.amendmentDates} onChange={(value) => change({ amendmentDates: value })} />
        </Section>

        <Section title="Relevant person" description="The project client. These details are entered as the relevant person.">
          {client ? (
            <PartySummary
              href={clientHref} action="Edit client"
              rows={[
                ['Name', [client.title, client.firstName, client.lastName].filter(Boolean).join(' ') || null],
                ['Building no.', client.buildingNumber],
                ['Street', client.addressLine1],
                ['Town', client.townCity],
                ['Postcode', client.postcode],
                ['Country', client.country ?? 'United Kingdom'],
              ]}
            />
          ) : <p className="mt-4 text-sm font-semibold text-amber-800">No client is linked to this project. <a href={clientHref} className="underline">Link a client</a>.</p>}
        </Section>

        <Section title="Agent" description="Your registered practice details from Organisation settings.">
          <PartySummary
            href={settingsHref} action="Edit in Settings"
            rows={[
              ['Name', [agent.firstName, agent.lastName].filter(Boolean).join(' ') || null],
              ['Email', agent.email],
              ['Telephone', agent.phone],
              ['Building no.', agent.buildingNumber],
              ['Street', agent.addressLine1],
              ['Town', agent.townCity],
              ['Postcode', agent.postcode],
            ]}
          />
        </Section>

        <Section title="Relaxation direction">
          <YesNo
            legend="Was the work subject of a relaxation direction given by the Scottish Ministers?" value={relaxation.applies}
            onChange={(applies) => change({ relaxation: { ...relaxation, applies } })}
          />
          {relaxation.applies && (
            <div className="prep-followup mt-2 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="prep-field-question">Reference number</span>
                <input className="field" maxLength={200} value={relaxation.reference ?? ''} onChange={(event) => change({ relaxation: { ...relaxation, reference: event.target.value } })} />
              </label>
              <label className="block">
                <span className="prep-field-question">Date</span>
                <input type="date" className="field" max={today} value={relaxation.date ?? ''} onChange={(event) => change({ relaxation: { ...relaxation, date: event.target.value || null } })} />
              </label>
            </div>
          )}
        </Section>

        <Section title="Certificates of construction" description="Yes when a certificate of construction is uploaded above.">
          {constructionCertificates.accompany ? (
            <CertificateEntries
              register="construction" title="Certificate of construction" filenames={filenames} today={today}
              entries={constructionCertificates.entries}
              onChange={(entries) => change({ constructionCertificates: { ...constructionCertificates, entries } })}
            />
          ) : <p className="mt-3 text-sm text-stone-600">No certificate of construction uploaded, so the answer is No.</p>}
        </Section>

        <Section title="Certificates of design">
          <YesNo
            legend="Did any certificates from approved certifiers of design accompany the building warrant application?" value={designCertificates.accompaniedWarrant}
            onChange={(accompaniedWarrant) => change({ designCertificates: { ...designCertificates, accompaniedWarrant } })}
          />
          {designCertificates.accompaniedWarrant && (
            <div className="prep-followup">
              <p className="mt-3 text-sm text-stone-600">
                Notice of Finalisation of Design Details (Form Q): <strong>{designCertificates.formQRequired ? 'Yes' : 'No'}</strong>
                {designCertificates.formQRequired ? '' : ' — upload a Form Q above if one is required.'}
              </p>
              {designCertificates.formQRequired && (
                <CertificateEntries
                  register="design" title="Form Q certificate" filenames={filenames} today={today}
                  entries={designCertificates.entries}
                  onChange={(entries) => change({ designCertificates: { ...designCertificates, entries } })}
                />
              )}
            </div>
          )}
        </Section>

        <Section title="Continuing requirements">
          <YesNo
            legend="Are there any continuing requirements in the building warrant, made under section 22 of the Act?" value={continuingRequirements.applies}
            onChange={(applies) => change({ continuingRequirements: { ...continuingRequirements, applies } })}
          />
          {continuingRequirements.applies && (
            <div className="prep-followup">
              <LimitedText
                label="List continuing requirements in full" value={continuingRequirements.details}
                onChange={(details) => change({ continuingRequirements: { ...continuingRequirements, details } })}
              />
            </div>
          )}
        </Section>

        <Section title="Fixed answers" description="This version always gives these answers. If any is wrong for this project, complete the certificate in eBuilding Standards instead.">
          <dl className="mt-4 divide-y divide-stone-200 text-sm">
            {FIXED_ANSWER_ROWS.map(([question, answer]) => (
              <div key={question} className="flex items-start justify-between gap-6 py-2">
                <dt className="text-stone-600">{question}</dt>
                <dd className="shrink-0 font-semibold text-ink">{answer}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Missing information">
          {dirty ? <p className="mt-3 text-sm text-stone-600">Checking your latest changes…</p>
            : issues.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {issues.map((issue) => <li key={issue.field}>{issue.message}</li>)}
              </ul>
            ) : <p className="mt-3 text-sm text-stone-600">Nothing is missing. The Agent will complete Main Details, upload the documents, set email notification and complete the declaration, then stop for your review.</p>}
        </Section>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-5">
          <button type="button" className="btn btn-primary" disabled={!canQueue || issues.length > 0} onClick={() => void queue()}>
            {queueing ? 'Sending…' : 'Confirm and send to Agent'}
          </button>
          <span role="status" className={`text-sm ${saveStatus === 'error' ? 'font-semibold text-red-700' : 'text-stone-600'}`}>{saveLabel}</span>
          {jobWaiting && <span className="text-sm text-stone-600">A run is already waiting or in progress.</span>}
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      </div>
    </div>
  );
}
