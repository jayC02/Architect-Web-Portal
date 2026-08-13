import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  FileText,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { evaluateClientApplicationDraftReadiness } from '@/lib/application-draft-readiness';
import type { ApplicationDraftResponse } from '@/server/services/application-draft-view.service';

type Review = NonNullable<ApplicationDraftResponse['review']>;
type Prepared = NonNullable<ApplicationDraftResponse['prepared']>;
type Person = Review['client'];
type Agent = Review['agent'];
type DraftDocument = ApplicationDraftResponse['documents'][number];

type Option = {
  value: string;
  label: string;
};

type Props = {
  initialDraft: ApplicationDraftResponse;
  documentTypes: Option[];
  typeOfWorkOptions: Option[];
  certifierPresets: Option[];
};

type ApiErrorPayload = {
  error?: string;
  details?: unknown;
};

const buildingConfirmationQuestions = [
  ['applicantIsOwner', 'Is the applicant the legal owner?'],
  ['applicationIsStaged', 'Is the application staged?'],
  ['intendedLifeFiveYearsOrLess', 'Is the intended life of the building five years or less?'],
  ['fireAndRescueServiceEnforcingAuthority', 'Is Fire and Rescue Service the enforcing authority?'],
  ['listedBuildingOrConservationArea', 'Is the building listed or within a conservation area?'],
  ['otherHistoricalImportance', 'Does the building have other historical importance?'],
  ['scottishMinistersRelaxationDirection', 'Is the work subject to a Scottish Ministers relaxation direction?'],
  ['dangerousBuildingNotice', 'Is the building subject to a dangerous building notice?'],
  ['approvedCertifierOfConstruction', 'Will an approved certifier of construction be used?'],
  ['coveredBySTAS', 'Are the proposals covered by STAS?'],
  ['restrictPublicInspection', 'Should any proposal information be restricted from public inspection?'],
] as const;

const planningConfirmationQuestions = [
  ['discussedWithPlanningAuthority', 'Has the proposal been discussed with the planning authority?'],
  ['treesOnOrAdjacentToSite', 'Are there trees on or adjacent to the application site?'],
  ['newOrAlteredVehicleAccess', 'Is a new or altered vehicle access proposed?'],
] as const;

const legalPlanningQuestions = [
  ['soleOwner', 'Is the applicant the sole owner of all the land?'],
  ['agriculturalHolding', 'Is any of the land part of an agricultural holding?'],
] as const;

const statusCopy: Record<string, string> = {
  UPLOADING: 'Ready to analyse',
  ANALYSING: 'Analysing documents',
  NEEDS_REVIEW: 'Needs your review',
  READY_TO_CREATE: 'Ready to create',
  COMMITTING: 'Creating project records',
  COMMITTED: 'Application created',
  FAILED: 'Could not prepare',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const apiJson = async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as T & ApiErrorPayload;
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.');
  return payload;
};

const emptyPerson = (): Person => ({
  clientType: 'INDIVIDUAL',
  displayName: null,
  title: null,
  firstName: null,
  lastName: null,
  companyName: null,
  email: null,
  phone: null,
  buildingNumber: null,
  addressLine1: null,
  addressLine2: null,
  townCity: null,
  postcode: null,
  country: 'United Kingdom',
});

const text = (value: string | number | null | undefined) =>
  value === null || value === undefined || String(value).trim() === '' ? 'Not found' : String(value);

const reviewWithResolvedRoute = (draft: ApplicationDraftResponse): Review | null => {
  const review = draft.review;
  if (!review || review.selectedApplicationType !== 'AUTO') return review;
  const suggested = draft.suggestedApplicationType && draft.suggestedApplicationType !== 'AUTO'
    ? draft.suggestedApplicationType
    : review.application.typeOfWorkKeys.length || review.project.typeOfWorkKey ? 'BUILDING_WARRANT' : null;
  return suggested ? { ...review, selectedApplicationType: suggested } : review;
};

const personSummary = (person: Person) => {
  const name = person.displayName
    || [person.title, person.firstName, person.lastName].filter(Boolean).join(' ')
    || person.companyName;
  return [name, person.email, person.phone].filter(Boolean).join(' | ') || 'Details need attention';
};

const siteSummary = (site: Review['site']) =>
  [site.buildingNumber, site.addressLine1, site.addressLine2, site.townCity, site.postcode].filter(Boolean).join(', ')
  || 'Address needs attention';

const withSiteAddress = (person: Person, site: Review['site']): Person => ({
  ...person,
  buildingNumber: site.buildingNumber,
  addressLine1: site.addressLine1,
  addressLine2: site.addressLine2,
  townCity: site.townCity,
  postcode: site.postcode,
  country: site.country,
});

const hasRoute = (route: string, kind: 'building' | 'planning') =>
  kind === 'building'
    ? route === 'BUILDING_WARRANT'
    : route === 'HOUSEHOLDER_PLANNING' || route === 'PLANNING_APPLICATION';

function Section({
  title,
  summary,
  issueCount,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary: string;
  issueCount: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || issueCount > 0);
  const previousIssueCount = useRef(issueCount);

  useEffect(() => {
    if (issueCount > 0 && previousIssueCount.current === 0) setOpen(true);
    previousIssueCount.current = issueCount;
  }, [issueCount]);

  return (
    <details
      className="review-section group panel rounded-lg"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden">
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-base font-semibold text-ink">{title}</span>
            {issueCount > 0 ? (
              <span className="text-xs font-semibold text-red-700">{issueCount} to review</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#3f6840]">
                <CheckCircle2 size={13} />
                Prepared
              </span>
            )}
          </span>
          <span className="mt-1 block truncate text-sm text-stone-500">{summary}</span>
        </span>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-400 transition group-open:rotate-90">
          <ChevronRight size={17} />
        </span>
      </summary>
      <div className="border-t border-stone-200 px-5 py-5">{children}</div>
    </details>
  );
}

function Field({
  label,
  value,
  onChange,
  issue,
  type = 'text',
  placeholder,
  required,
}: {
  label: string;
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  issue?: string;
  type?: 'text' | 'email' | 'tel' | 'number';
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required ? <span className="ml-1 text-red-700">*</span> : null}
      </span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className={`field ${issue ? 'border-red-300 ring-2 ring-red-100' : ''}`}
        placeholder={placeholder}
        aria-invalid={Boolean(issue)}
      />
      {issue ? <span className="mt-1 block text-xs text-red-700">{issue}</span> : null}
    </label>
  );
}

function BooleanQuestion({
  label,
  value,
  onChange,
  issue,
  legal = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: boolean | null) => void;
  issue?: string;
  legal?: boolean;
}) {
  const selected = typeof value === 'boolean' ? String(value) : '';
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select
        value={selected}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')}
        className={`field ${issue ? 'border-red-300 ring-2 ring-red-100' : ''}`}
        aria-invalid={Boolean(issue)}
      >
        <option value="">{legal ? 'Choose and confirm' : 'Choose an answer'}</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
      {issue ? <span className="mt-1 block text-xs text-red-700">{issue}</span> : null}
    </label>
  );
}

function PersonFields({
  person,
  onChange,
  issueFor,
  prefix,
  showAddress = true,
}: {
  person: Person;
  onChange: (key: keyof Person, value: string) => void;
  issueFor: (key: string) => string | undefined;
  prefix: 'client' | 'applicant';
  showAddress?: boolean;
}) {
  return (
    <div className="space-y-5">
      <section aria-labelledby={`${prefix}-identity-heading`}>
        <h4 id={`${prefix}-identity-heading`} className="mb-3 text-sm font-semibold text-ink">Identity and contact</h4>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="label">{prefix === 'client' ? 'Client' : 'Applicant'} type</span>
            <select
              value={person.clientType}
              onChange={(event) => onChange('clientType', event.target.value)}
              className="field"
            >
              <option value="INDIVIDUAL">Individual</option>
              <option value="ORGANISATION">Organisation</option>
            </select>
          </label>
          <Field
            label="Display name"
            value={person.displayName}
            onChange={(value) => onChange('displayName', value)}
            issue={issueFor(`${prefix}.displayName`)}
            required
          />
          {person.clientType === 'INDIVIDUAL' ? (
            <>
              <label className="block">
                <span className="label">Title <span aria-hidden="true">*</span></span>
                <select
                  value={person.title ?? ''}
                  onChange={(event) => onChange('title', event.target.value)}
                  className={`field ${issueFor(`${prefix}.title`) ? 'border-red-300 ring-2 ring-red-100' : ''}`}
                  required
                  aria-invalid={Boolean(issueFor(`${prefix}.title`))}
                  aria-describedby={issueFor(`${prefix}.title`) ? `${prefix}-title-error` : undefined}
                >
                  <option value="">Choose title</option>
                  <option value="Mr">Mr</option>
                  <option value="Mrs">Mrs</option>
                  <option value="Miss">Miss</option>
                  <option value="Ms">Ms</option>
                  <option value="Other">Other</option>
                </select>
                {issueFor(`${prefix}.title`) ? <p id={`${prefix}-title-error`} className="mt-1 text-xs text-red-700">{issueFor(`${prefix}.title`)}</p> : null}
              </label>
              <Field label="First name" value={person.firstName} onChange={(value) => onChange('firstName', value)} issue={issueFor(`${prefix}.firstName`)} required />
              <Field label="Last name" value={person.lastName} onChange={(value) => onChange('lastName', value)} issue={issueFor(`${prefix}.lastName`)} required />
            </>
          ) : (
            <Field label="Company name" value={person.companyName} onChange={(value) => onChange('companyName', value)} issue={issueFor(`${prefix}.companyName`)} required />
          )}
          <Field label="Email" type="email" value={person.email} onChange={(value) => onChange('email', value)} issue={issueFor(`${prefix}.email`)} required />
          <Field label="Phone" type="tel" value={person.phone} onChange={(value) => onChange('phone', value)} />
        </div>
      </section>
      {showAddress ? <section aria-labelledby={`${prefix}-address-heading`}>
        <h4 id={`${prefix}-address-heading`} className="mb-3 text-sm font-semibold text-ink">Address details</h4>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Building number" value={person.buildingNumber} onChange={(value) => onChange('buildingNumber', value)} issue={issueFor(`${prefix}.buildingNumber`)} required />
          <Field label="Address line 1" value={person.addressLine1} onChange={(value) => onChange('addressLine1', value)} issue={issueFor(`${prefix}.addressLine1`)} required />
          <Field label="Address line 2" value={person.addressLine2} onChange={(value) => onChange('addressLine2', value)} />
          <Field label="Town or city" value={person.townCity} onChange={(value) => onChange('townCity', value)} issue={issueFor(`${prefix}.townCity`)} required />
          <Field label="Postcode" value={person.postcode} onChange={(value) => onChange('postcode', value)} issue={issueFor(`${prefix}.postcode`)} required />
          <Field label="Country" value={person.country} onChange={(value) => onChange('country', value)} />
        </div>
      </section> : null}
    </div>
  );
}

function Evidence({
  draftId,
  prepared,
  section,
  field,
}: {
  draftId: string;
  prepared: Prepared | null;
  section: 'project' | 'site' | 'client' | 'agent' | 'application';
  field: string;
}) {
  const data = prepared?.[section] as Record<string, { sources?: Array<{
    documentId: string;
    filename: string;
    page?: number;
    evidence: string;
  }> }> | undefined;
  const sources = data?.[field]?.sources ?? [];
  if (!sources.length) return null;
  return (
    <p className="mt-2 text-xs text-stone-500">
      {sources.slice(0, 2).map((source, index) => (
        <span key={`${source.documentId}-${source.page ?? 0}`}>
          {index > 0 ? ' | ' : ''}
          Found in{' '}
          {source.documentId === 'project-notes' ? (
            <strong className="font-semibold text-stone-700">{source.filename}</strong>
          ) : (
            <a
              href={`/api/application-drafts/${draftId}/documents/${source.documentId}`}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-stone-700 hover:underline"
            >
              {source.filename}{source.page ? `, page ${source.page}` : ''}
            </a>
          )}
          {source.evidence ? `: ${source.evidence}` : ''}
        </span>
      ))}
    </p>
  );
}

const evidenceLabels: Record<string, string> = {
  name: 'Project name',
  internalReference: 'Internal reference',
  typeOfWorkKey: 'Type of work',
  typeOfWorkKeys: 'Types of work',
  summary: 'Project summary',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  townCity: 'Town or city',
  postcode: 'Postcode',
  country: 'Country',
  localAuthority: 'Local authority',
  title: 'Title',
  firstName: 'First name',
  lastName: 'Last name',
  companyName: 'Company name',
  email: 'Email',
  phone: 'Phone',
  description: 'Description of work',
  currentUse: 'Current use',
  proposedUse: 'Proposed use',
  estimatedValue: 'Estimated value',
  route: 'Application route',
  presetKey: 'Application preset',
};

function EvidenceList({
  draftId,
  prepared,
  sections,
}: {
  draftId: string;
  prepared: Prepared | null;
  sections: Array<'project' | 'site' | 'client' | 'agent' | 'application'>;
}) {
  const entries = sections.flatMap((section) => {
    const fields = prepared?.[section] as Record<string, {
      sources?: Array<{
        documentId: string;
        filename: string;
        page?: number;
        evidence: string;
      }>;
    }> | undefined;
    return Object.entries(fields ?? {})
      .filter(([key, field]) => key !== 'route' && (field.sources?.length ?? 0) > 0)
      .map(([key, field]) => ({ key: `${section}.${key}`, label: evidenceLabels[key] ?? key, sources: field.sources ?? [] }));
  });
  if (!entries.length) return null;
  return (
    <details className="mt-5 border-t border-stone-200 pt-4">
      <summary className="cursor-pointer text-sm font-semibold text-stone-600 hover:text-ink">View source evidence</summary>
      <div className="mt-3 space-y-3 text-xs leading-5 text-stone-600">
        {entries.map((entry) => (
          <div key={entry.key}>
            <p className="font-semibold text-stone-700">{entry.label}</p>
            {entry.sources.slice(0, 3).map((source, index) => (
              <p key={`${entry.key}-${source.documentId}-${source.page ?? index}`}>
                {source.documentId === 'project-notes' ? (
                  <span>{source.filename}</span>
                ) : (
                  <a
                    href={`/api/application-drafts/${draftId}/documents/${source.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-stone-700 hover:underline"
                  >
                    {source.filename}{source.page ? `, page ${source.page}` : ''}
                  </a>
                )}
                {source.evidence ? `: ${source.evidence}` : ''}
              </p>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

function AnalysisState({
  draft,
  onDraft,
}: {
  draft: ApplicationDraftResponse;
  onDraft: (draft: ApplicationDraftResponse) => void;
}) {
  const [error, setError] = useState('');
  const [working, setWorking] = useState(draft.status === 'ANALYSING' || draft.status === 'UPLOADING');
  const started = useRef(false);
  const total = Math.max(draft.analysis.total, draft.documents.length, 1);
  const percentage = Math.min(100, Math.round((draft.analysis.completed / total) * 100));

  const analyse = async (force: boolean) => {
    setWorking(true);
    setError('');
    try {
      const payload = await apiJson<{ draft: ApplicationDraftResponse }>(
        `/api/application-drafts/${draft.id}/analyse`,
        { method: 'POST', body: JSON.stringify({ force }) },
      );
      onDraft(payload.draft);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The application could not be prepared.');
      setWorking(false);
    }
  };

  useEffect(() => {
    if (draft.status !== 'UPLOADING' || started.current) return;
    started.current = true;
    void analyse(false);
  }, [draft.status]);

  useEffect(() => {
    if (draft.status !== 'ANALYSING' && !working) return;
    const timer = window.setInterval(() => {
      void apiJson<{ draft: ApplicationDraftResponse }>(`/api/application-drafts/${draft.id}`)
        .then((payload) => {
          onDraft(payload.draft);
          if (payload.draft.status !== 'ANALYSING') setWorking(false);
        })
        .catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [draft.id, draft.status, onDraft, working]);

  return (
    <section className="panel rounded-lg p-6 sm:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#eef3e9] text-[#526a4a]">
          {working ? <LoaderCircle size={26} className="animate-spin" /> : <AlertCircle size={25} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
            {working ? 'Preparing application' : 'Preparation paused'}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">
            {working ? draft.analysis.message : 'Your documents are safe'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            {working
              ? 'Completed files remain cached while the remaining documents are checked.'
              : 'Architect Pro could not finish this preparation. Retry the analysis or return to the manual workflow.'}
          </p>
          {working ? (
            <div className="mt-5">
              <div className="mb-2 flex justify-between text-xs text-stone-500">
                <span>{draft.analysis.completed} of {total} documents</span>
                <span>{percentage}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
                <div className="h-full rounded-full bg-moss transition-[width]" style={{ width: `${percentage}%` }} />
              </div>
            </div>
          ) : null}
          {error ? <p className="mt-4 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
          {!working ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className="btn btn-primary gap-2" onClick={() => void analyse(true)}>
                <RefreshCw size={16} />
                Retry preparation
              </button>
              <a href="/projects/new" className="btn btn-secondary">Create manually</a>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default function ApplicationDraftReview({
  initialDraft,
  documentTypes,
  typeOfWorkOptions,
  certifierPresets,
}: Props) {
  const resolvedInitialReview = reviewWithResolvedRoute(initialDraft);
  const [draft, setDraft] = useState(initialDraft);
  const [review, setReview] = useState<Review | null>(resolvedInitialReview);
  const [issues, setIssues] = useState(
    resolvedInitialReview && resolvedInitialReview !== initialDraft.review
      ? evaluateClientApplicationDraftReadiness(resolvedInitialReview)
      : initialDraft.issues,
  );
  const [working, setWorking] = useState<'save' | 'commit' | 'analyse' | 'cancel' | 'files' | ''>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showAllDocuments, setShowAllDocuments] = useState(false);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const reviewRef = useRef<Review | null>(resolvedInitialReview);
  const autosaveTimer = useRef<number | null>(null);
  const autosaveInFlight = useRef<Promise<boolean> | null>(null);
  const lastSavedReview = useRef(initialDraft.review ? JSON.stringify(initialDraft.review) : '');
  const firstReviewRender = useRef(true);
  const saveImmediately = useRef(false);
  const categorySaveInFlight = useRef<string | null>(null);

  const issueMap = useMemo(
    () => new Map(issues.map((issue) => [issue.key, issue.message])),
    [issues],
  );
  const issuesBySection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) counts.set(issue.section, (counts.get(issue.section) ?? 0) + 1);
    return counts;
  }, [issues]);

  useEffect(() => {
    if (draft.review) {
      const resolved = reviewWithResolvedRoute(draft);
      reviewRef.current = resolved;
      setReview(resolved);
      lastSavedReview.current = JSON.stringify(draft.review);
      if (resolved && resolved !== draft.review) {
        setIssues(evaluateClientApplicationDraftReadiness(resolved));
        return;
      }
    }
    setIssues(draft.issues);
  }, [draft]);

  useEffect(() => () => {
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
  }, []);

  const persistCurrentReview = async (): Promise<boolean> => {
    const current = reviewRef.current;
    if (!current) return false;
    if (autosaveInFlight.current) {
      await autosaveInFlight.current;
      return persistCurrentReview();
    }
    const snapshot = JSON.stringify(current);
    if (snapshot === lastSavedReview.current) {
      setSaveState('saved');
      return true;
    }
    setSaveState('saving');
    const request = (async () => {
      try {
        const payload = await apiJson<{
          draft: ApplicationDraftResponse;
          issues: ApplicationDraftResponse['issues'];
        }>(`/api/application-drafts/${draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ review: current }),
        });
        if (JSON.stringify(reviewRef.current) === snapshot) {
          lastSavedReview.current = snapshot;
          setDraft(payload.draft);
          setIssues(payload.issues);
          setSaveState('saved');
        }
        return true;
      } catch (requestError) {
        if (JSON.stringify(reviewRef.current) === snapshot) {
          setSaveState('failed');
          setError(requestError instanceof Error ? requestError.message : 'Could not save changes.');
        }
        return false;
      }
    })();
    autosaveInFlight.current = request;
    const saved = await request;
    autosaveInFlight.current = null;
    return JSON.stringify(reviewRef.current) === snapshot ? saved : persistCurrentReview();
  };

  useEffect(() => {
    if (firstReviewRender.current) {
      firstReviewRender.current = false;
      return;
    }
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    if (saveImmediately.current) {
      saveImmediately.current = false;
      void persistCurrentReview();
      return;
    }
    autosaveTimer.current = window.setTimeout(() => void persistCurrentReview(), 600);
  }, [review]);

  if (
    draft.status === 'UPLOADING'
    || draft.status === 'ANALYSING'
    || (draft.status === 'FAILED' && !review)
  ) {
    return <AnalysisState draft={draft} onDraft={setDraft} />;
  }

  if (draft.status === 'COMMITTED' && draft.result) {
    return (
      <section className="panel rounded-lg p-8 text-center">
        <CheckCircle2 size={34} className="mx-auto text-[#3f6840]" />
        <h2 className="mt-4 text-2xl font-semibold">Application created</h2>
        <p className="mt-2 text-stone-500">The project, records, documents and Snapshot V2 job are ready.</p>
        <div className="mt-6 flex justify-center gap-3">
          <a href={`/automation-job/${draft.result.automationJobId}`} className="btn btn-primary">Open prepared application</a>
          <a href={`/projects/${draft.result.projectId}`} className="btn btn-secondary">Open project</a>
        </div>
      </section>
    );
  }

  if (!review) {
    return (
      <AnalysisState
        draft={{ ...draft, status: 'FAILED' }}
        onDraft={setDraft}
      />
    );
  }

  const applyReview = (change: (current: Review) => Review, immediate = false) => {
    const current = reviewRef.current;
    if (!current) return;
    const next = change(current);
    reviewRef.current = next;
    saveImmediately.current = immediate;
    setReview(next);
    setIssues(evaluateClientApplicationDraftReadiness(next));
    setError('');
  };

  const updateProject = (key: keyof Review['project'], value: string | null) => {
    applyReview((current) => {
      const project = { ...current.project, [key]: value || null } as Review['project'];
      return {
        ...current,
        project,
      };
    });
  };
  const updateSite = (key: keyof Review['site'], value: string) => {
    applyReview((current) => {
      const site = { ...current.site, [key]: value || null };
      const client = current.clientAddressSameAsSite
        ? withSiteAddress(current.client, site)
        : current.client;
      return {
        ...current,
        site,
        client,
        applicant: current.applicantDifferentFromClient
          ? current.applicant
          : client,
      };
    });
  };
  const updatePerson = (target: 'client' | 'applicant', key: keyof Person, value: string) => {
    applyReview((current) => {
      const person = target === 'client' ? current.client : current.applicant ?? emptyPerson();
      return {
        ...current,
        [target]: { ...person, [key]: value || null },
      };
    });
  };
  const updateAgent = (key: keyof Agent, value: string | boolean) => {
    applyReview((current) => ({
      ...current,
      agent: { ...current.agent, [key]: typeof value === 'string' ? value || null : value },
    }));
  };
  const updateApplication = (key: keyof Review['application'], value: string | number | null) => {
    applyReview((current) => ({
      ...current,
      application: { ...current.application, [key]: value === '' ? null : value },
    }));
  };
  const toggleTypeOfWork = (value: Review['application']['typeOfWorkKeys'][number], checked: boolean) => {
    applyReview((current) => {
      const typeOfWorkKeys = checked
        ? [...new Set([...current.application.typeOfWorkKeys, value])]
        : current.application.typeOfWorkKeys.filter((key) => key !== value);
      return {
        ...current,
        project: { ...current.project, typeOfWorkKey: typeOfWorkKeys[0] ?? null },
        application: {
          ...current.application,
          typeOfWorkKeys,
          presetKey: typeOfWorkKeys[0] ?? null,
        },
      };
    }, true);
  };
  const updateConfirmation = (key: string, value: boolean | number | string | null) => {
    applyReview((current) => ({
      ...current,
      confirmations: { ...current.confirmations, [key]: value },
    }), true);
  };
  const updateDocument = (
    id: string,
    key: keyof Review['documents'][number],
    value: string | null,
  ) => {
    applyReview((current) => ({
      ...current,
      documents: current.documents.map((document) =>
        document.id === id ? { ...document, [key]: value || null } : document),
    }), true);
  };
  const acceptDocument = (id: string) => {
    applyReview((current) => ({
      ...current,
      documents: current.documents.map((document) => document.id === id ? {
        ...document,
        documentStatus: 'APPROVED',
      } : document),
    }), true);
  };
  const changeDocumentType = async (id: string, documentType: string) => {
    if (categorySaveInFlight.current) return;
    const previousReview = reviewRef.current;
    if (!previousReview) return;
    categorySaveInFlight.current = id;
    setSavingCategoryId(id);
    applyReview((current) => ({
      ...current,
      documents: current.documents.map((document) => document.id === id ? {
        ...document,
        documentType: documentType as Review['documents'][number]['documentType'],
        documentStatus: 'APPROVED',
      } : document),
    }));
    const saved = await persistCurrentReview();
    if (saved) {
      setEditingDocumentId(null);
    } else {
      reviewRef.current = previousReview;
      setReview(previousReview);
      setIssues(evaluateClientApplicationDraftReadiness(previousReview));
    }
    categorySaveInFlight.current = null;
    setSavingCategoryId(null);
  };

  const issueFor = (key: string) => issueMap.get(key);
  const route = review.selectedApplicationType;
  const building = hasRoute(route, 'building');
  const planning = hasRoute(route, 'planning');
  const draftDocumentsById = new Map(draft.documents.map((document) => [document.id, document]));
  const locationPlanCount = review.documents.filter((document) => String(document.documentType) === 'LOCATION_PLAN').length;
  const attentionDocumentIds = new Set(
    review.documents
      .filter((document) =>
        document.documentStatus === 'IN_REVIEW'
        || document.documentStatus === 'DRAFT'
        || (locationPlanCount > 1 && String(document.documentType) === 'LOCATION_PLAN'))
      .map((document) => document.id),
  );
  const visibleDocuments = showAllDocuments || attentionDocumentIds.size === 0
    ? review.documents
    : review.documents.filter((document) => attentionDocumentIds.has(document.id));
  const siteAddressComplete = Boolean(review.site.buildingNumber && review.site.addressLine1 && review.site.townCity && review.site.postcode);
  const locationPlanConflict = locationPlanCount > 1;

  const commit = async () => {
    setWorking('commit');
    setError('');
    setNotice('');
    try {
      const saved = await persistCurrentReview();
      if (!saved) return;
      const currentReview = reviewRef.current;
      const currentIssues = currentReview ? evaluateClientApplicationDraftReadiness(currentReview) : [];
      setIssues(currentIssues);
      if (currentIssues.length || !currentReview) {
        setError(`Review ${currentIssues.length} remaining detail${currentIssues.length === 1 ? '' : 's'} before creating the application.`);
        document.querySelector('[data-attention-summary]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const result = await apiJson<{ redirectTo: string }>(`/api/application-drafts/${draft.id}/commit`, {
        method: 'POST',
        body: JSON.stringify({ review: currentReview }),
      });
      window.location.assign(result.redirectTo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The application could not be created.');
    } finally {
      setWorking('');
    }
  };

  const analyseAgain = async () => {
    setWorking('analyse');
    setError('');
    try {
      setDraft((current) => ({
        ...current,
        status: 'ANALYSING',
        analysis: {
          ...current.analysis,
          phase: 'document-analysis',
          completed: 0,
          total: current.documents.length,
          message: 'Preparing document analysis',
        },
      }));
      const payload = await apiJson<{ draft: ApplicationDraftResponse }>(
        `/api/application-drafts/${draft.id}/analyse`,
        { method: 'POST', body: JSON.stringify({ force: true }) },
      );
      setDraft(payload.draft);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The application could not be analysed again.');
    } finally {
      setWorking('');
    }
  };

  const cancelDraft = async () => {
    if (!window.confirm('Cancel this application draft and remove its temporary files?')) return;
    setWorking('cancel');
    setError('');
    try {
      const payload = await apiJson<{ redirectTo: string }>(`/api/application-drafts/${draft.id}`, {
        method: 'DELETE',
        body: JSON.stringify({}),
      });
      window.location.assign(payload.redirectTo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The draft could not be cancelled.');
      setWorking('');
    }
  };

  const addDocuments = async (files: FileList | null) => {
    if (!files?.length) return;
    setWorking('files');
    setError('');
    try {
      const queue = Array.from(files);
      const invalid = queue.find((file) => (file.type && file.type !== 'application/pdf') || !file.name.toLowerCase().endsWith('.pdf'));
      if (invalid) throw new Error('PDF files only.');
      let next = 0;
      const uploadOne = async (file: File) => {
        const intent = await apiJson<{
          document: { id: string };
          upload: { url: string; token: string } | null;
        }>(`/api/application-drafts/${draft.id}/documents/upload-intent`, {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size }),
        });
        if (intent.upload) {
          const response = await fetch(intent.upload.url, {
            method: 'PUT',
            headers: {
              'content-type': file.type || 'application/pdf',
              'x-upsert': 'false',
            },
            body: file,
          });
          if (!response.ok) {
            const uploadError = await response.text().catch(() => '');
            if (response.status !== 409 && !/already exists/i.test(uploadError)) {
              throw new Error(`Could not upload ${file.name}.`);
            }
          }
        }
        await apiJson(`/api/application-drafts/${draft.id}/documents/${intent.document.id}/finalise`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      };
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (next < queue.length) await uploadOne(queue[next++]);
      }));
      const payload = await apiJson<{ draft: ApplicationDraftResponse }>(`/api/application-drafts/${draft.id}`);
      setDraft(payload.draft);
      setReview(payload.draft.review);
      setIssues(payload.draft.issues);
      setNotice(`${queue.length} document${queue.length === 1 ? '' : 's'} uploaded. Analyse again when ready.`);
      setWorking('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The documents could not be added.');
      setWorking('');
    }
  };

  const removeDocument = async (document: DraftDocument) => {
    if (!window.confirm(`Remove ${document.originalFilename} from this draft?`)) return;
    setWorking('files');
    setError('');
    try {
      await apiJson<{ ok: boolean }>(
        `/api/application-drafts/${draft.id}/documents/${document.id}`,
        { method: 'DELETE', body: JSON.stringify({}) },
      );
      const payload = await apiJson<{ draft: ApplicationDraftResponse }>(`/api/application-drafts/${draft.id}`);
      setDraft(payload.draft);
      reviewRef.current = payload.draft.review;
      setReview(payload.draft.review);
      setIssues(payload.draft.issues);
      setNotice(`${document.originalFilename} was removed.`);
      setWorking('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The document could not be removed.');
      setWorking('');
    }
  };

  const attentionCount = issues.length;
  const preparedCount = draft.prepared?.summary.preparedFieldCount ?? 0;
  const analysedCount = draft.prepared?.summary.analysedCount ?? draft.documents.length;

  return (
    <div>
      <header className="mb-6">
        <a href="/applications/new" className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600 hover:text-ink">
          <ArrowLeft size={15} />
          Back to new applications
        </a>
        <div className="mt-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-moss">Prepared application</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink sm:text-4xl">Review application</h1>
            <p className="mt-2 max-w-3xl text-stone-600">
              Architect Pro analysed {analysedCount} document{analysedCount === 1 ? '' : 's'} and prepared {preparedCount} application value{preparedCount === 1 ? '' : 's'}.
              {attentionCount > 0
                ? ` ${attentionCount} detail${attentionCount === 1 ? '' : 's'} need your attention.`
                : ' Ready to create project.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary gap-2" onClick={() => void analyseAgain()} disabled={Boolean(working)}>
              <RefreshCw size={15} />
              Analyse again
            </button>
            <button type="button" className="btn btn-secondary gap-2 text-red-700" onClick={() => void cancelDraft()} disabled={Boolean(working)}>
              <Trash2 size={15} />
              Cancel draft
            </button>
          </div>
        </div>
      </header>

      <section className="panel mb-5 grid gap-4 rounded-lg p-5 sm:grid-cols-4">
        <div>
          <p className="label">Review</p>
          <p className={`font-semibold ${attentionCount ? 'text-red-700' : 'text-[#3f6840]'}`}>{attentionCount ? 'Needs attention' : 'Complete'}</p>
        </div>
        <div>
          <p className="label">Documents</p>
          <p className="font-semibold">{review.documents.length}</p>
        </div>
        <div>
          <p className="label">Prepared</p>
          <p className="font-semibold">{preparedCount} values</p>
        </div>
        <div>
          <p className="label">Status</p>
          <p className={`font-semibold ${attentionCount ? 'text-red-700' : 'text-[#3f6840]'}`}>
            {attentionCount ? `${attentionCount} to review` : statusCopy[draft.status]}
          </p>
        </div>
      </section>

      {attentionCount > 0 ? (
        <section data-attention-summary className="mb-5 rounded-lg border border-amber-200 bg-[#fffbef] p-5">
          <div className="flex items-start gap-3">
            <AlertCircle size={19} className="mt-0.5 shrink-0 text-amber-700" />
            <div>
              <h2 className="font-semibold text-ink">Details requiring attention</h2>
              <p className="mt-1 text-sm text-stone-600">Open the highlighted sections below. Legal confirmations must be answered by you.</p>
              <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-stone-700 sm:grid-cols-2">
                {issues.slice(0, 8).map((issue) => (
                  <li key={issue.key} className="flex gap-2">
                    <span aria-hidden="true">-</span>
                    <span><strong>{issue.label}:</strong> {issue.message}</span>
                  </li>
                ))}
              </ul>
              {issues.length > 8 ? <p className="mt-2 text-xs text-stone-500">And {issues.length - 8} more in the sections below.</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {notice ? <p className="mb-5 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800" role="status">{notice}</p> : null}
      {error ? <p className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p> : null}

      <div className="space-y-4">
        <Section
          title="Project"
        summary={text(review.project.name)}
          issueCount={(issuesBySection.get('project') ?? 0) + (issuesBySection.get('application') ?? 0)}
          defaultOpen
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <label className="block lg:col-span-2">
              <span className="label">Use an existing project or create a new one</span>
              <select
                value={review.projectMode === 'existing' ? review.existingProjectId ?? '' : 'create'}
                onChange={(event) => {
                  const value = event.target.value;
                  applyReview((current) => ({
                    ...current,
                    projectMode: value === 'create' ? 'create' : 'existing',
                    existingProjectId: value === 'create' ? null : value,
                  }), true);
                }}
                className={`field ${issueFor('existingProjectId') ? 'border-red-300 ring-2 ring-red-100' : ''}`}
              >
                <option value="create">Create a new project</option>
                {draft.prepared?.matches.projects.map((match) => (
                  <option key={match.id} value={match.id}>{match.label} ({match.strength} match)</option>
                ))}
              </select>
              {draft.prepared?.matches.projects.length ? (
                <p className="mt-2 text-xs text-stone-500">Existing projects are never selected automatically.</p>
              ) : null}
            </label>

            {review.projectMode === 'create' ? (
              <>
                <Field
                  label="Project name"
                  value={review.project.name}
                  onChange={(value) => updateProject('name', value)}
                  issue={issueFor('project.name')}
                  required
                />
                <Field
                  label="Internal reference"
                  value={review.project.internalReference}
                  onChange={(value) => updateProject('internalReference', value)}
                />
              </>
            ) : null}

            <label className="block lg:col-span-2">
              <span className="label">Description of work</span>
              <textarea
                value={review.application.description ?? ''}
                onChange={(event) => updateApplication('description', event.target.value)}
                rows={4}
                className={`field resize-y ${issueFor('application.description') ? 'border-red-300 ring-2 ring-red-100' : ''}`}
                placeholder="Describe the proposed work clearly"
              />
              {issueFor('application.description') ? <span className="mt-1 block text-xs text-red-700">{issueFor('application.description')}</span> : null}
              <Evidence draftId={draft.id} prepared={draft.prepared} section="application" field="description" />
            </label>

            {building ? (
              <>
                <fieldset className={`lg:col-span-2 ${issueFor('application.typeOfWorkKeys') ? 'rounded-md border border-red-300 p-3 ring-2 ring-red-100' : ''}`}>
                  <legend className="label">Type of work</legend>
                  <p className="mt-1 text-sm text-stone-500">Select every type that applies to this warrant.</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {typeOfWorkOptions.map((option) => (
                      <label key={option.value} className="flex min-h-11 items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm font-medium text-ink">
                        <input
                          type="checkbox"
                          checked={review.application.typeOfWorkKeys.includes(option.value as Review['application']['typeOfWorkKeys'][number])}
                          onChange={(event) => toggleTypeOfWork(option.value as Review['application']['typeOfWorkKeys'][number], event.target.checked)}
                          className="h-4 w-4 accent-[#526a4a]"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  {issueFor('application.typeOfWorkKeys') ? <span className="mt-2 block text-xs text-red-700">{issueFor('application.typeOfWorkKeys')}</span> : null}
                </fieldset>
                <Field
                  label="Current use"
                  value={review.application.currentUse}
                  onChange={(value) => updateApplication('currentUse', value)}
                  issue={issueFor('application.currentUse')}
                  required
                />
                <Field
                  label="Proposed use"
                  value={review.application.proposedUse}
                  onChange={(value) => updateApplication('proposedUse', value)}
                  issue={issueFor('application.proposedUse')}
                  required
                />
                <Field
                  label="Estimated value"
                  type="number"
                  value={review.application.estimatedValue}
                  onChange={(value) => updateApplication('estimatedValue', value === '' ? null : Number(value))}
                  issue={issueFor('application.estimatedValue')}
                  required
                />
                <label className="block">
                  <span className="label">Certifier preset</span>
                  <select
                    value={review.application.selectedCertifierPresetId ?? ''}
                    onChange={(event) => updateApplication('selectedCertifierPresetId', event.target.value)}
                    className="field"
                  >
                    <option value="">No certifier selected</option>
                    {certifierPresets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </>
            ) : null}

            {review.projectMode === 'create' ? (
              <label className="block lg:col-span-2">
                <span className="label">Project summary <span className="normal-case font-normal">(optional)</span></span>
                <textarea
                  value={review.project.summary ?? ''}
                  onChange={(event) => updateProject('summary', event.target.value)}
                  rows={3}
                  className="field resize-y"
                />
              </label>
            ) : null}
          </div>
          <EvidenceList draftId={draft.id} prepared={draft.prepared} sections={['project', 'application']} />
        </Section>

        {review.projectMode === 'create' ? (
          <Section
            title="Site"
            summary={review.siteMode === 'existing'
              ? draft.prepared?.matches.sites.find((match) => match.id === review.existingSiteId)?.label ?? 'Existing site'
              : siteSummary(review.site)}
            issueCount={issuesBySection.get('site') ?? 0}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block sm:col-span-2 lg:col-span-3">
                <span className="label">Existing match</span>
                <select
                  value={review.siteMode === 'existing' ? review.existingSiteId ?? '' : 'create'}
                  onChange={(event) => {
                    const value = event.target.value;
                    applyReview((current) => ({
                      ...current,
                      siteMode: value === 'create' ? 'create' : 'existing',
                      existingSiteId: value === 'create' ? null : value,
                    }), true);
                  }}
                  className="field"
                >
                  <option value="create">Create a new site from the prepared address</option>
                  {draft.prepared?.matches.sites.map((match) => (
                    <option key={match.id} value={match.id}>{match.label} ({match.strength} match)</option>
                  ))}
                </select>
              </label>
              <Field label="Building number" value={review.site.buildingNumber} onChange={(value) => updateSite('buildingNumber', value)} issue={issueFor('site.buildingNumber')} required />
              {review.siteMode === 'create' ? (
                <>
                  <Field label="Address line 1" value={review.site.addressLine1} onChange={(value) => updateSite('addressLine1', value)} issue={issueFor('site.addressLine1')} required />
                  <Field label="Address line 2" value={review.site.addressLine2} onChange={(value) => updateSite('addressLine2', value)} />
                  <Field label="Town or city" value={review.site.townCity} onChange={(value) => updateSite('townCity', value)} issue={issueFor('site.townCity')} required />
                  <Field label="Postcode" value={review.site.postcode} onChange={(value) => updateSite('postcode', value)} issue={issueFor('site.postcode')} required />
                  <Field label="Country" value={review.site.country} onChange={(value) => updateSite('country', value)} />
                  <Field label="Local authority" value={review.site.localAuthority} onChange={(value) => updateSite('localAuthority', value)} issue={issueFor('site.localAuthority')} required />
                </>
              ) : null}
            </div>
            <EvidenceList draftId={draft.id} prepared={draft.prepared} sections={['site']} />
          </Section>
        ) : null}

        {review.projectMode === 'create' ? (
          <Section
            title="Client and applicant"
            summary={review.clientMode === 'existing'
              ? draft.prepared?.matches.clients.find((match) => match.id === review.existingClientId)?.label ?? 'Existing client'
              : personSummary(review.client)}
            issueCount={issuesBySection.get('client') ?? 0}
          >
            <div className="space-y-6">
              <section aria-labelledby="client-relationship-heading">
                <h3 id="client-relationship-heading" className="text-sm font-semibold text-ink">Client and applicant relationship</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex min-h-11 items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold text-ink">
                    <input
                      type="checkbox"
                      checked={!review.applicantDifferentFromClient}
                      aria-label={review.applicantDifferentFromClient ? 'Use client as applicant' : 'Use a different applicant'}
                      onChange={(event) => applyReview((current) => ({
                        ...current,
                        applicantDifferentFromClient: !event.target.checked,
                        applicant: event.target.checked ? current.applicant : current.applicant ?? { ...current.client },
                      }), true)}
                      className="h-4 w-4 rounded border-stone-300 text-ink focus:ring-moss"
                    />
                    Client is also the applicant
                  </label>
                {review.clientMode === 'create' ? (
                  <label className="flex min-h-11 items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm font-semibold text-ink">
                    <input
                      type="checkbox"
                      checked={review.clientAddressSameAsSite}
                      disabled={!siteAddressComplete}
                      onChange={(event) => applyReview((current) => ({
                        ...current,
                        clientAddressSameAsSite: event.target.checked,
                        client: event.target.checked
                          ? withSiteAddress(current.client, current.site)
                          : current.client,
                        applicant: event.target.checked && !current.applicantDifferentFromClient
                          ? withSiteAddress(current.applicant ?? current.client, current.site)
                          : current.applicant,
                      }), true)}
                      className="h-4 w-4 rounded border-stone-300 text-ink focus:ring-moss"
                    />
                    Client address is the same as the site address
                  </label>
                ) : (
                  <p className="flex min-h-11 items-center rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-500">The selected client keeps their saved address.</p>
                )}
                </div>
                {!siteAddressComplete && review.clientMode === 'create' ? <p className="mt-2 text-xs text-stone-500">Complete the site address before using it for the client.</p> : null}
              </section>

              <div className="rounded-md border border-stone-200 bg-stone-50 p-4">
                <label className="block">
                  <span className="label">Prepared client or existing client</span>
                  <select
                    value={review.clientMode === 'existing' ? review.existingClientId ?? '' : 'create'}
                    onChange={(event) => {
                      const value = event.target.value;
                      applyReview((current) => ({
                        ...current,
                        clientMode: value === 'create' ? 'create' : 'existing',
                        existingClientId: value === 'create' ? null : value,
                        clientAddressSameAsSite: value === 'create' ? current.clientAddressSameAsSite : false,
                      }), true);
                    }}
                    className="field bg-white"
                  >
                    <option value="create">Use the prepared client details</option>
                    {draft.prepared?.matches.clients.map((match) => (
                      <option key={match.id} value={match.id}>{match.label} ({match.strength} match)</option>
                    ))}
                  </select>
                  {draft.prepared?.matches.clients.some((match) => match.strength === 'possible') ? (
                    <p className="mt-2 text-xs text-stone-500">Possible matches require your choice. Architect Pro never matches on surname alone.</p>
                  ) : null}
                </label>
              </div>

              {review.clientMode === 'create' ? (
                <PersonFields
                  person={review.client}
                  onChange={(key, value) => updatePerson('client', key, value)}
                  issueFor={issueFor}
                  prefix="client"
                  showAddress={!review.clientAddressSameAsSite}
                />
              ) : null}

              {review.applicantDifferentFromClient ? (
                <section aria-labelledby="separate-applicant-heading">
                  <h3 id="separate-applicant-heading" className="mb-3 text-sm font-semibold text-ink">Separate applicant details</h3>
                  <PersonFields
                    person={review.applicant ?? emptyPerson()}
                    onChange={(key, value) => updatePerson('applicant', key, value)}
                    issueFor={issueFor}
                    prefix="applicant"
                  />
                </section>
              ) : null}
            </div>
          </Section>
        ) : null}

        <Section
          title="Agent and practice"
          summary={[review.agent.practiceName, review.agent.firstName, review.agent.lastName].filter(Boolean).join(' ') || 'Organisation defaults need attention'}
          issueCount={issuesBySection.get('agent') ?? 0}
        >
          <p className="mb-5 text-sm text-stone-500">Organisation defaults are applied automatically. Change these only for this application, or save the edits as the new normal default.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Practice name" value={review.agent.practiceName} onChange={(value) => updateAgent('practiceName', value)} issue={issueFor('agent.practiceName')} required />
            <Field label="First name" value={review.agent.firstName} onChange={(value) => updateAgent('firstName', value)} issue={issueFor('agent.firstName')} required />
            <Field label="Last name" value={review.agent.lastName} onChange={(value) => updateAgent('lastName', value)} issue={issueFor('agent.lastName')} required />
            <Field label="Email" type="email" value={review.agent.email} onChange={(value) => updateAgent('email', value)} issue={issueFor('agent.email')} required />
            <Field label="Phone" type="tel" value={review.agent.phone} onChange={(value) => updateAgent('phone', value)} />
            <Field label="Building number" value={review.agent.buildingNumber} onChange={(value) => updateAgent('buildingNumber', value)} issue={issueFor('agent.buildingNumber')} required />
            <Field label="Address line 1" value={review.agent.addressLine1} onChange={(value) => updateAgent('addressLine1', value)} issue={issueFor('agent.addressLine1')} required />
            <Field label="Address line 2" value={review.agent.addressLine2} onChange={(value) => updateAgent('addressLine2', value)} />
            <Field label="Town or city" value={review.agent.townCity} onChange={(value) => updateAgent('townCity', value)} issue={issueFor('agent.townCity')} required />
            <Field label="Postcode" value={review.agent.postcode} onChange={(value) => updateAgent('postcode', value)} issue={issueFor('agent.postcode')} required />
            <Field label="Country" value={review.agent.country} onChange={(value) => updateAgent('country', value)} />
          </div>
          <label className="mt-5 flex items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={review.agent.saveAsOrganisationDefault}
              onChange={(event) => updateAgent('saveAsOrganisationDefault', event.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-ink focus:ring-moss"
            />
            Save these agent details as the organisation default
          </label>
          <EvidenceList draftId={draft.id} prepared={draft.prepared} sections={['agent']} />
        </Section>

        <Section
          title="Documents"
          summary={`${review.documents.length} files | ${attentionDocumentIds.size} need review`}
          issueCount={issuesBySection.get('documents') ?? 0}
        >
          <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <label className="flex items-center gap-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={showAllDocuments}
                onChange={(event) => setShowAllDocuments(event.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-ink focus:ring-moss"
              />
              Show all documents
            </label>
            <label className="btn btn-secondary cursor-pointer gap-2">
              {working === 'files' ? <LoaderCircle size={15} className="animate-spin" /> : <FilePlus2 size={15} />}
              Add documents
              <input
                type="file"
                multiple
                accept=".pdf,application/pdf"
                className="sr-only"
                disabled={Boolean(working)}
                onChange={(event) => void addDocuments(event.target.files)}
              />
            </label>
          </div>

          <div className="overflow-hidden rounded-lg border border-stone-200">
            {visibleDocuments.map((document) => {
              const source = draftDocumentsById.get(document.id);
              const needsReview = document.documentStatus === 'IN_REVIEW' || document.documentStatus === 'DRAFT';
              const locationConflict = locationPlanConflict && String(document.documentType) === 'LOCATION_PLAN';
              const category = documentTypes.find((option) => option.value === document.documentType)?.label ?? document.documentType;
              return (
                <div key={document.id} className={`border-b border-stone-100 p-4 last:border-b-0 ${needsReview || locationConflict ? 'bg-amber-50/50' : ''}`}>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.9fr)_auto] lg:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-stone-500">
                        <FileText size={18} />
                      </span>
                      <span className="min-w-0">
                        <a href={source?.previewUrl} target="_blank" rel="noreferrer" className="block truncate font-semibold text-ink hover:underline">
                          {source?.originalFilename ?? document.id}
                        </a>
                        <span className="mt-1 block truncate text-xs text-stone-500">
                          {source?.drawingTitle || 'No drawing title'} | {source ? formatBytes(source.sizeBytes) : ''}
                        </span>
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-stone-500">{needsReview ? 'Suggested category' : 'Category'}</p>
                      {!needsReview && !locationConflict && editingDocumentId !== document.id ? (
                        <button
                          type="button"
                          className="mt-1 inline-flex items-center gap-1.5 rounded-sm text-left text-sm font-semibold text-ink hover:text-moss focus:outline-none focus-visible:ring-2 focus-visible:ring-moss/30"
                          aria-label={`Change category for ${source?.originalFilename ?? 'document'}`}
                          onClick={() => setEditingDocumentId(document.id)}
                        >
                          {category}
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                      ) : (
                        <p className="mt-1 text-sm font-semibold text-ink">{category}</p>
                      )}
                      {locationConflict ? (
                        <div className="mt-3">
                          <p className="text-xs text-amber-800">More than one document is marked as a Location Plan. Choose the current plan deliberately.</p>
                          <label className="mt-2 block">
                            <span className="sr-only">Choose category for {source?.originalFilename ?? 'document'}</span>
                            <select
                              value={document.documentType}
                              onChange={(event) => void changeDocumentType(document.id, event.target.value)}
                              disabled={savingCategoryId === document.id}
                              className="field"
                            >
                              {documentTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                        </div>
                      ) : editingDocumentId === document.id ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label className="min-w-[12rem] flex-1">
                            <span className="sr-only">Change category for {source?.originalFilename ?? 'document'}</span>
                            <select
                              value={document.documentType}
                              onChange={(event) => void changeDocumentType(document.id, event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape' && savingCategoryId !== document.id) setEditingDocumentId(null);
                              }}
                              disabled={savingCategoryId === document.id}
                              autoFocus
                              className="field"
                            >
                              {documentTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="text-sm font-semibold text-stone-600 hover:text-ink"
                            disabled={savingCategoryId === document.id}
                            onClick={() => setEditingDocumentId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : needsReview ? (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => acceptDocument(document.id)}>Accept</button>
                          <button type="button" className="text-sm font-semibold text-stone-600 hover:text-ink" onClick={() => setEditingDocumentId(document.id)}>Change</button>
                        </div>
                      ) : (
                        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#3f6840]"><CheckCircle2 size={13} /> Reviewed</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-stone-400 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Remove ${source?.originalFilename ?? 'document'}`}
                      onClick={() => source && void removeDocument(source)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-stone-500 hover:text-ink">Drawing details</summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field label="Drawing title" value={document.drawingTitle} onChange={(value) => updateDocument(document.id, 'drawingTitle', value)} />
                      <Field label="Drawing number" value={document.drawingNumber} onChange={(value) => updateDocument(document.id, 'drawingNumber', value)} />
                      <Field label="Revision" value={document.revision} onChange={(value) => updateDocument(document.id, 'revision', value)} />
                    </div>
                    {source?.analysisStatus === 'FALLBACK' || source?.analysisStatus === 'FAILED' ? (
                      <p className="mt-3 text-xs text-amber-800">Suggested using the deterministic fallback. Check this classification manually.</p>
                    ) : null}
                  </details>
                </div>
              );
            })}
          </div>
          {!showAllDocuments && attentionDocumentIds.size > 0 ? (
            <button type="button" className="mt-4 text-sm font-semibold text-stone-600 hover:text-ink" onClick={() => setShowAllDocuments(true)}>
              Show all {review.documents.length} documents
            </button>
          ) : null}
        </Section>

        {building || planning ? (
          <Section
            title="Confirmations"
            summary={issuesBySection.get('confirmations')
              ? 'Some declarations need your answer'
              : 'Application declarations prepared'}
            issueCount={issuesBySection.get('confirmations') ?? 0}
          >
            <p className="mb-4 text-sm text-stone-500">Review the prepared application declarations and change any answer that differs for this project.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              {building
                ? buildingConfirmationQuestions.map(([key, label]) => (
                    <BooleanQuestion
                      key={key}
                      label={label}
                      value={review.confirmations[key]}
                      onChange={(value) => updateConfirmation(key, value)}
                      issue={issueFor(`confirmations.${key}`)}
                      legal
                    />
                  ))
                : null}
              {planning
                ? planningConfirmationQuestions.map(([key, label]) => (
                    <BooleanQuestion
                      key={key}
                      label={label}
                      value={review.confirmations[key]}
                      onChange={(value) => updateConfirmation(key, value)}
                      issue={issueFor(`confirmations.${key}`)}
                    />
                  ))
                : null}
              {planning
                ? legalPlanningQuestions.map(([key, label]) => (
                    <BooleanQuestion
                      key={key}
                      label={label}
                      value={review.confirmations[key]}
                      onChange={(value) => updateConfirmation(key, value)}
                      issue={issueFor(`confirmations.${key}`)}
                      legal
                    />
                  ))
                : null}
              {planning && review.confirmations.newOrAlteredVehicleAccess === true ? (
                <>
                  <Field
                    label="Current parking spaces"
                    type="number"
                    value={review.confirmations.currentParkingSpaces as number | null}
                    onChange={(value) => updateConfirmation('currentParkingSpaces', value === '' ? null : Number(value))}
                    issue={issueFor('confirmations.currentParkingSpaces')}
                    required
                  />
                  <Field
                    label="Proposed parking spaces"
                    type="number"
                    value={review.confirmations.proposedParkingSpaces as number | null}
                    onChange={(value) => updateConfirmation('proposedParkingSpaces', value === '' ? null : Number(value))}
                    issue={issueFor('confirmations.proposedParkingSpaces')}
                    required
                  />
                </>
              ) : null}
            </div>
          </Section>
        ) : null}
      </div>

      <section className="panel sticky bottom-3 z-10 mt-6 rounded-lg p-4 shadow-[0_18px_50px_rgba(32,35,31,0.14)]">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className={`font-semibold ${attentionCount ? 'text-red-700' : 'text-[#3f6840]'}`}>
              {attentionCount
                ? `${attentionCount} detail${attentionCount === 1 ? '' : 's'} need attention`
                : 'Ready to create project'}
            </p>
            <p className="mt-1 text-xs text-stone-500">
              Changes are saved automatically. Permanent records are created only after you approve this review.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <p className={`self-center text-sm ${saveState === 'failed' ? 'text-red-700' : 'text-stone-500'}`} role="status" aria-live="polite">
              {saveState === 'saving' ? 'Saving...' : saveState === 'saved' ? 'Saved' : saveState === 'failed' ? 'Could not save changes' : ''}
            </p>
            <button type="button" className="btn btn-primary gap-2" onClick={() => void commit()} disabled={Boolean(working)}>
              {working === 'commit' ? <LoaderCircle size={16} className="animate-spin" /> : <ExternalLink size={16} />}
              {working === 'commit' ? 'Creating project...' : 'Create Project'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
