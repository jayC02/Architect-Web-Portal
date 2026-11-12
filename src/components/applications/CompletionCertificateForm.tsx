import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import {
  COMPLETION_TEXT_LIMIT,
  MAX_CERTIFICATE_ENTRIES,
  REGISTER_PART2,
  emptyCertificateEntry,
  registerPart1Codes,
  type CertificateRegister,
  type CompletionCertificateEntry,
  type CompletionIssue,
  type CompletionParties,
  type CompletionPreparation,
} from '@/lib/completion-certificate';

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

const WAITING_STATUSES = new Set(['READY', 'CLAIMED', 'IN_PROGRESS', 'NEEDS_REVIEW']);
// The Agent reports a finished run as COMPLETED; older flows use AWAITING_PORTAL_REVIEW.
const FINISHED_STATUSES = new Set(['COMPLETED', 'AWAITING_PORTAL_REVIEW']);
const JOB_LABELS: Record<string, string> = {
  READY: 'Queued for the Architect Pro Agent',
  CLAIMED: 'Starting',
  IN_PROGRESS: 'Running in eBuilding Standards',
  NEEDS_REVIEW: 'Needs attention in the Agent',
  AWAITING_PORTAL_REVIEW: 'Main Details completed — review it in eBuilding Standards',
  COMPLETED: 'Main Details completed — review it in eBuilding Standards',
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

function CertificateEntries({ register, title, entries, onChange, documents, today }: {
  register: CertificateRegister;
  title: string;
  entries: CompletionCertificateEntry[];
  onChange: (entries: CompletionCertificateEntry[]) => void;
  documents: Props['documents'];
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
          <legend className="px-1 text-sm font-semibold text-ink">{title} {index + 1}</legend>
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
            <label className="block sm:col-span-2">
              <span className="prep-field-question">Signed certificate (optional)</span>
              <select className="field" value={entry.documentId ?? ''} onChange={(event) => update(index, { documentId: event.target.value || null })}>
                <option value="">Not selected</option>
                {documents.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}
              </select>
              <span className="mt-1 block text-xs text-stone-500">Uploaded in a later step. Choosing it here does not upload it to the portal.</span>
            </label>
          </div>
          <button type="button" className="btn btn-secondary mt-4" onClick={() => onChange(entries.filter((_, position) => position !== index))}>
            Remove {title.toLowerCase()} {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button" className="btn btn-secondary" disabled={entries.length >= MAX_CERTIFICATE_ENTRIES}
        onClick={() => onChange([...entries, emptyCertificateEntry(register)])}
      >
        Add {title.toLowerCase()}
      </button>
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
  const [saving, setSaving] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [job, setJob] = useState(activeJob);
  const queueInFlight = useRef(false);
  const endpoint = `/api/building-warrant/${encodeURIComponent(warrantId)}/completion-certificate`;

  const change = (update: Partial<CompletionPreparation>) => {
    setPreparation((current) => ({ ...current, ...update }));
    setDirty(true);
    setMessage('');
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

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${endpoint}/preparation`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(preparation),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not save the completion certificate details.'));
      const body = await response.json() as { preparation: CompletionPreparation; issues: CompletionIssue[] };
      setPreparation(body.preparation);
      setIssues(body.issues);
      setDirty(false);
      setMessage(body.issues.length ? 'Saved. Some details are still missing.' : 'Saved. Ready to send to the Agent.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save the completion certificate details.');
    } finally {
      setSaving(false);
    }
  };

  const queue = async () => {
    // One portal run per confirmation, however many times the button is pressed.
    if (queueInFlight.current) return;
    queueInFlight.current = true;
    setQueueing(true);
    setError('');
    try {
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

  const { relaxation, constructionCertificates, designCertificates, continuingRequirements } = preparation;
  const client = parties.client;
  const agent = parties.agent;
  const canQueue = !issues.length && !dirty && !saving && !queueing && !jobWaiting;

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
            <p className="mt-2 text-sm text-stone-600">Supporting documents, the declaration and submission are still to be completed in eBuilding Standards.</p>
          )}
          {jobWaiting && job.status !== 'NEEDS_REVIEW' && <button type="button" className="btn btn-secondary mt-4" onClick={() => void cancel()}>Cancel run</button>}
        </section>
      )}

      <div className="panel rounded-lg p-5">
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

        <Section title="Certificates of construction">
          <YesNo
            legend="Do any certificates from approved certifiers of construction accompany this submission?" value={constructionCertificates.accompany}
            onChange={(accompany) => change({ constructionCertificates: { ...constructionCertificates, accompany } })}
          />
          {constructionCertificates.accompany && (
            <CertificateEntries
              register="construction" title="Certificate of construction" documents={documents} today={today}
              entries={constructionCertificates.entries}
              onChange={(entries) => change({ constructionCertificates: { ...constructionCertificates, entries } })}
            />
          )}
        </Section>

        <Section title="Certificates of design">
          <YesNo
            legend="Did any certificates from approved certifiers of design accompany the building warrant application?" value={designCertificates.accompaniedWarrant}
            onChange={(accompaniedWarrant) => change({ designCertificates: { ...designCertificates, accompaniedWarrant } })}
          />
          {designCertificates.accompaniedWarrant && (
            <div className="prep-followup">
              <YesNo
                legend="Do you require to provide the verifier with a Notice of Finalisation of Design Details (Form Q)?" value={designCertificates.formQRequired}
                onChange={(formQRequired) => change({ designCertificates: { ...designCertificates, formQRequired } })}
              />
              {designCertificates.formQRequired && (
                <CertificateEntries
                  register="design" title="Form Q certificate" documents={documents} today={today}
                  entries={designCertificates.entries}
                  onChange={(entries) => change({ designCertificates: { ...designCertificates, entries } })}
                />
              )}
            </div>
          )}
        </Section>

        <Section title="Accompanying documents" description="Answer for this completion submission. Uploads happen in a later step.">
          <YesNo
            legend="Does a copy of an Energy Performance Certificate(s) accompany this submission?" value={preparation.energyPerformanceCertificate}
            onChange={(energyPerformanceCertificate) => change({ energyPerformanceCertificate })}
          />
          <YesNo
            legend="Has a statement of sustainability been issued for the purpose of regulation 9 and section 7 of Schedule 5 to the Building (Scotland) Regulations 2004?"
            value={preparation.sustainabilityStatement} onChange={(sustainabilityStatement) => change({ sustainabilityStatement })}
          />
          <YesNo
            legend="Does a Fire Safety Design Summary accompany this submission?" value={preparation.fireSafetyDesignSummary}
            onChange={(fireSafetyDesignSummary) => change({ fireSafetyDesignSummary })}
          />
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
          {dirty ? <p className="mt-3 text-sm text-stone-600">Save your changes to check what is still missing.</p>
            : issues.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {issues.map((issue) => <li key={issue.field}>{issue.message}</li>)}
              </ul>
            ) : <p className="mt-3 text-sm text-stone-600">Nothing is missing. The Agent will complete Main Details and stop for your review.</p>}
        </Section>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-5">
          <button type="button" className="btn btn-secondary" disabled={saving || queueing || !dirty} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-primary" disabled={!canQueue || issues.length > 0} onClick={() => void queue()}>
            {queueing ? 'Sending…' : 'Confirm and send to Agent'}
          </button>
          {message && <span role="status" className="text-sm text-stone-600">{message}</span>}
          {jobWaiting && <span className="text-sm text-stone-600">A run is already waiting or in progress.</span>}
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      </div>
    </div>
  );
}
