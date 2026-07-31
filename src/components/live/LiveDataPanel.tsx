import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '@/lib/api/http';
import { AlertTriangle, ArrowRight, Mail, MapPin, Phone, Plus, Search, X } from 'lucide-react';
import { UK_PHONE_HTML_PATTERN } from '@/lib/validation/client-contact';
import { clientIdentityLabel, clientStructuredAddress } from '@/lib/clients/display';

type Variant =
  | 'dashboard'
  | 'projects'
  | 'projectOverview'
  | 'projectFiles'
  | 'planning'
  | 'warrants'
  | 'clients'
  | 'sites'
  | 'deadlines'
  | 'documentsHub'
  | 'documentFolder'
  | 'settingsOverview'
  | 'integrations';

interface Props {
  endpoint: string;
  variant: Variant;
}

type AnyRecord = Record<string, any>;

const date = (value?: string | null) => value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not set';
const bytes = (value = 0) => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
const human = (value?: string | null) => value ? value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not set';

const planningStatuses = ['NOT_STARTED', 'DRAFTING', 'SUBMITTED', 'VALIDATED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED', 'APPROVED', 'REFUSED', 'WITHDRAWN', 'CLOSED'];
const documentTypes = ['LOCATION_PLAN', 'EXISTING_DRAWING', 'PROPOSED_DRAWING', 'ELEVATION', 'SECTION', 'DETAILS', 'CALCULATIONS', 'SPECIFICATIONS', 'PHOTO', 'OTHER'];
const documentStatuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED', 'REJECTED'];
const warrantTypes = ['INITIAL', 'AMENDMENT', 'STAGED', 'LATE', 'COMPLETION_CERTIFICATE'];
const warrantStatuses = ['NOT_STARTED', 'DRAFTING', 'SUBMITTED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED', 'GRANTED', 'REJECTED', 'EXPIRED', 'COMPLETED', 'CLOSED'];
const certificateStatuses = ['NOT_REQUIRED', 'NOT_STARTED', 'DRAFTING', 'SUBMITTED', 'ACCEPTED', 'REJECTED'];
const deadlinePriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const packageTypes = ['PLANNING', 'BUILDING_WARRANT'];
const packageStatuses = ['DRAFT', 'READY', 'EXPORTED', 'SUBMITTED', 'ARCHIVED'];

function SkeletonBlock({ className = 'h-20' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg border border-stone-200 bg-white/70 ${className}`} />;
}

function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="panel overflow-hidden rounded-lg">
      {Array.from({ length: rows }, (_, index) => <SkeletonBlock key={index} className="h-16 rounded-none border-x-0 border-t-0" />)}
    </div>
  );
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-semibold">This panel could not be loaded.</p>
      <p className="mt-1">{message}</p>
      <button type="button" onClick={retry} className="btn mt-3 border border-red-200 bg-white text-red-800 hover:bg-red-100">Retry</button>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <div className="panel rounded-lg p-8 text-center text-sm text-stone-500">{children}</div>;
}

function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'warning' | 'danger' | 'info' }) {
  const classes = {
    neutral: { dot: 'bg-stone-400', text: 'text-stone-600' },
    warning: { dot: 'bg-amber-500', text: 'text-amber-800' },
    danger: { dot: 'bg-red-700', text: 'text-red-800' },
    info: { dot: 'bg-moss', text: 'text-stone-700' },
  }[tone];
  return <span className={`inline-flex items-center gap-2 text-xs font-medium ${classes.text}`}><span className={`h-2 w-2 rounded-full ${classes.dot}`} aria-hidden="true" />{label}</span>;
}

const dateInput = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';

function Dashboard({ data }: { data: AnyRecord }) {
  const attentionItems = data.needsAttention ?? [];
  const activeProjects = data.activeProjectSummaries ?? [];
  const pipeline = data.pipeline ?? [];
  const documentOverview = data.documentOverview ?? { total: 0, reviewed: 0, needsReview: 0 };
  const actionWorkload = data.actionWorkload ?? {
    overdueDeadlines: 0,
    planningActions: Number(data.planningActionCount ?? 0),
    warrantActions: Number(data.warrantActionCount ?? 0),
    automationReady: Number(data.automationJobsReady ?? 0),
  };
  const range = Number(data.deadlineRange ?? 14);

  return (
    <div className="space-y-6">
      <section className="grid gap-5 xl:grid-cols-[1.08fr_1fr_0.86fr]">
        <ProjectPipelineCard pipeline={pipeline} activeProjectCount={Number(data.activeProjects ?? 0)} />
        <DocumentsOverviewCard overview={documentOverview} />
        <ActionWorkloadCard workload={actionWorkload} range={range} />
      </section>

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)]">
        <ActiveProjectsPanel projects={activeProjects} />
        <NeedsAttentionPanel items={attentionItems} />
      </section>
    </div>
  );
}

function ProjectPipelineCard({ pipeline, activeProjectCount }: { pipeline: AnyRecord[]; activeProjectCount: number }) {
  const max = Math.max(1, ...pipeline.map((stage) => Number(stage.count ?? 0)));
  return (
    <article className="panel rounded-lg p-5">
      <DashboardCardHeader title="Project Pipeline" subtitle="Projects by current stage" />
      <div className="mt-5 space-y-3">
        {pipeline.length ? pipeline.map((stage) => {
          const count = Number(stage.count ?? 0);
          return (
            <a key={stage.key} href={stage.href ?? '/projects'} className="grid grid-cols-[118px_minmax(0,1fr)_24px] items-center gap-3 text-sm transition hover:text-ink">
              <span className="truncate text-stone-700">{stage.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-stone-100">
                <span className="block h-full rounded-full bg-moss/70" style={{ width: `${Math.max(count ? 10 : 0, (count / max) * 100)}%` }} />
              </span>
              <span className="text-right font-semibold text-ink">{count}</span>
            </a>
          );
        }) : <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-500">No projects to show yet.</p>}
      </div>
      <div className="mt-5 border-t border-stone-200 pt-4 text-sm font-semibold text-ink">Total active projects <span className="float-right">{activeProjectCount}</span></div>
    </article>
  );
}

function DocumentsOverviewCard({ overview }: { overview: AnyRecord }) {
  const total = Number(overview.total ?? 0);
  const reviewed = Number(overview.reviewed ?? 0);
  const needsReview = Number(overview.needsReview ?? 0);
  const reviewedPercent = total ? Math.round((reviewed / total) * 100) : 0;
  const needsPercent = total ? Math.max(0, 100 - reviewedPercent) : 0;

  return (
    <article className="panel rounded-lg p-5">
      <DashboardCardHeader title="Documents Overview" subtitle="All projects" />
      <div className="mt-5 grid items-center gap-5 sm:grid-cols-[132px_1fr]">
        <div className="relative mx-auto h-32 w-32">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`${total} total documents`}>
            <circle cx="50" cy="50" r="38" fill="none" stroke="#ede9dd" strokeWidth="12" />
            <circle cx="50" cy="50" r="38" fill="none" stroke="#738365" strokeWidth="12" pathLength="100" strokeDasharray={`${reviewedPercent} 100`} strokeLinecap="round" />
            <circle cx="50" cy="50" r="38" fill="none" stroke="#d99a18" strokeWidth="12" pathLength="100" strokeDasharray={`${needsPercent} 100`} strokeDashoffset={-reviewedPercent} strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-3xl font-semibold text-ink">{total}</span>
            <span className="text-xs text-stone-500">Total</span>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <DocumentLegendRow label="Reviewed" count={reviewed} total={total} className="bg-moss/80" />
          <DocumentLegendRow label="Need review" count={needsReview} total={total} className="bg-amber-500" />
        </div>
      </div>
      <a href="/projects" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-moss">View all documents <ArrowRight size={14} aria-hidden="true" /></a>
    </article>
  );
}

function DocumentLegendRow({ label, count, total, className }: { label: string; count: number; total: number; className: string }) {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-2 text-stone-600"><span className={`h-2.5 w-2.5 rounded-full ${className}`} />{label}</span>
      <span className="font-medium text-stone-700">{count} ({percent}%)</span>
    </div>
  );
}

function ActionWorkloadCard({ workload, range }: { workload: AnyRecord; range: number }) {
  const rows = [
    { label: 'Overdue deadlines', value: workload.overdueDeadlines ?? 0, className: 'bg-red-700', href: '/deadlines' },
    { label: 'Planning actions', value: workload.planningActions ?? 0, className: 'bg-amber-500', href: '/projects' },
    { label: 'Warrant actions', value: workload.warrantActions ?? 0, className: 'bg-amber-500', href: '/projects' },
    { label: 'Automation ready', value: workload.automationReady ?? 0, className: 'bg-moss/80', href: '/projects' },
  ];
  return (
    <article className="panel rounded-lg p-5">
      <DashboardCardHeader title="Action Workload" subtitle={`Next ${range} days`} />
      <div className="mt-5 space-y-4">
        {rows.map((row) => (
          <a key={row.label} href={row.href} className="flex items-center justify-between gap-4 text-sm hover:text-ink">
            <span className="inline-flex min-w-0 items-center gap-3 text-stone-700"><span className={`h-2.5 w-2.5 rounded-full ${row.className}`} />{row.label}</span>
            <span className="font-semibold text-ink">{row.value}</span>
          </a>
        ))}
      </div>
      <a href="/deadlines" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-ink hover:text-moss">View all actions <ArrowRight size={14} aria-hidden="true" /></a>
    </article>
  );
}

function DashboardCardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink">{title}</h2>
      <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
    </div>
  );
}
function NeedsAttentionPanel({ items }: { items: AnyRecord[] }) {
  return (
    <article className="panel rounded-lg p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Needs attention</h2>
          <p className="mt-1 text-sm text-stone-500">Urgent deadlines, missing files and ready jobs.</p>
        </div>
        <AlertTriangle size={18} className="mt-1 text-amber-700" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        {items.length ? items.map((item) => <AttentionItem key={item.id} item={item} />) : (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-500">No urgent practice items found.</div>
        )}
      </div>
    </article>
  );
}

function AttentionItem({ item }: { item: AnyRecord }) {
  const tone = item.tone === 'danger' ? 'border-red-200 bg-red-50/70 text-red-800' : item.tone === 'warning' ? 'border-amber-200 bg-amber-50/70 text-amber-800' : item.tone === 'ready' ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800' : 'border-stone-200 bg-white text-ink';
  return (
    <a href={item.href} className={`group block rounded-lg border px-3 py-3 transition hover:bg-white ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase opacity-80">{item.type}</p>
          <p className="mt-1 truncate font-semibold">{item.projectName}</p>
          <p className="mt-1 text-sm opacity-85">{item.reason}</p>
          {item.date && <p className="mt-1 text-xs opacity-75">{date(item.date)}</p>}
        </div>
        <ArrowRight size={15} className="mt-1 shrink-0 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-90" aria-hidden="true" />
      </div>
    </a>
  );
}

function ActiveProjectsPanel({ projects }: { projects: AnyRecord[] }) {
  return (
    <article className="panel rounded-lg p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Active projects</h2>
          <p className="mt-1 text-sm text-stone-500">Current project movement and next useful action.</p>
        </div>
        <a href="/projects" className="text-sm font-semibold text-stone-600 hover:text-ink">View all</a>
      </div>
      <div className="space-y-3">
        {projects.length ? projects.map((project) => <ActiveProjectCard key={project.id} project={project} />) : (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-500">No active projects yet.</div>
        )}
      </div>
    </article>
  );
}

function ActiveProjectCard({ project }: { project: AnyRecord }) {
  const currentIndex = projectStageIndex(project.stage);
  const actionClass = project.nextAction?.tone === 'danger' ? 'text-red-800' : project.nextAction?.tone === 'warning' ? 'text-amber-800' : 'text-ink';
  const deadlineInfo = project.nextDeadline ? `Deadline: ${date(project.nextDeadline.dueDate)}` : 'No upcoming deadline';
  const documentInfo = project.documentReviewCount > 0 ? `Documents: ${project.documentReviewCount} to review` : 'Documents clear';
  const automationInfo = project.readyAutomationJobCount > 0 ? `Automation: ${project.readyAutomationJobCount} ready` : 'Automation: none ready';

  return (
    <a href={`/projects/${project.id}`} className="group block overflow-hidden rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss/30 sm:p-5">
      <div className="grid gap-5 lg:grid-cols-[112px_minmax(0,1fr)_minmax(250px,0.46fr)]">
        <ProjectSketch />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-ink">{project.name}</p>
          <p className="mt-1 truncate text-sm text-stone-500">{project.siteSummary}</p>
          <p className="mt-3 text-sm text-stone-600">Stage: {human(project.stage)}</p>
          <ProjectStageProgress currentIndex={currentIndex} />
        </div>

        <div className="min-w-0 border-stone-200 lg:border-l lg:pl-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Next action</p>
          <p className={`mt-1 break-words text-sm font-semibold ${actionClass}`}>{project.nextAction?.label ?? 'No action needed'}</p>
          <div className="mt-3 space-y-1 text-sm text-stone-500">
            <p>{deadlineInfo}</p>
            <p>{documentInfo}</p>
            <p>{automationInfo}</p>
          </div>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink group-hover:text-moss">
            Open project <ArrowRight size={14} aria-hidden="true" />
          </span>
        </div>
      </div>
    </a>
  );
}

function ProjectSketch() {
  return (
    <div className="hidden h-28 w-28 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-[#fbfaf6] text-stone-400 sm:flex" aria-hidden="true">
      <svg viewBox="0 0 96 96" className="h-20 w-20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 72h60" />
        <path d="M25 72V34l24-12 23 12v38" />
        <path d="M35 72V43l14-7 14 7v29" />
        <path d="M25 34l24 11 23-11" />
        <path d="M40 50h7M52 50h7M40 60h7M52 60h7" />
        <path d="M16 78c18-4 46-4 64 0" />
      </svg>
    </div>
  );
}

function ProjectStageProgress({ currentIndex }: { currentIndex: number }) {
  const stages = ['Lead', 'Documents', 'Planning', 'Warrant', 'Complete'];
  return (
    <div className="mt-4">
      <div className="grid grid-cols-5 items-center" aria-hidden="true">
        {stages.map((stage, index) => (
          <Fragment key={stage}>
            <div className="flex items-center">
              <span className={`h-3 w-3 rounded-full border ${index <= currentIndex ? 'border-moss bg-moss' : 'border-stone-300 bg-stone-50'}`} />
              {index < stages.length - 1 && <span className={`h-px flex-1 ${index < currentIndex ? 'bg-moss/70' : 'bg-stone-200'}`} />}
            </div>
          </Fragment>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1 text-[11px] text-stone-500">
        {stages.map((stage, index) => <span key={stage} className={index <= currentIndex ? 'font-semibold text-moss' : ''}>{stage}</span>)}
      </div>
    </div>
  );
}

function projectStageIndex(stage?: string | null) {
  if (stage === 'SURVEY' || stage === 'DESIGN') return 1;
  if (stage === 'PLANNING') return 2;
  if (stage === 'BUILDING_WARRANT' || stage === 'CONSTRUCTION') return 3;
  if (stage === 'COMPLETION' || stage === 'ARCHIVED') return 4;
  return 0;
}
function ListPanel({ title, href, rows, empty, render }: { title: string; href?: string; rows: AnyRecord[]; empty: string; render: (row: AnyRecord) => React.ReactNode }) {
  return (
    <article className="panel rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {href && <a href={href} className="text-sm font-semibold text-stone-600 hover:text-ink">View all</a>}
      </div>
      <div className="space-y-2">{rows?.length ? rows.map((row) => <div key={row.id ?? row.project?.id ?? row.originalName}>{render(row)}</div>) : <p className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-500">{empty}</p>}</div>
    </article>
  );
}

function Projects({ data }: { data: AnyRecord }) {
  const projects = data.projects ?? [];
  if (!projects.length) return <EmptyState>No projects yet.</EmptyState>;
  return (
    <div className="panel overflow-hidden rounded-lg">
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="table-head"><tr><th className="px-4 py-3">Project</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Stage</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Authority</th></tr></thead>
        <tbody>{projects.map((project: AnyRecord) => <tr key={project.id} className="cursor-pointer hover:bg-stone-50" onClick={() => { window.location.href = `/projects/${project.id}`; }}><td className="table-cell"><a className="font-semibold hover:underline" href={`/projects/${project.id}`}>{project.name}</a><p className="text-xs text-stone-500">{project.internalReference ?? 'No reference'}</p></td><td className="table-cell">{project.client?.name ?? 'Not linked'}</td><td className="table-cell"><Chip label={human(project.stage)} tone="info" /></td><td className="table-cell">{human(project.status)}</td><td className="table-cell">{project.localAuthority ?? 'Not set'}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function ProjectOverview({ data }: { data: AnyRecord }) {
  const project = data.project;
  if (!project) return <EmptyState>This project is no longer available.</EmptyState>;

  return (
    <>
      <section className="grid gap-4 lg:grid-cols-3">
        <InfoCard label="Client" value={project.client?.name ?? 'Not linked'} detail={project.client?.email ?? ''} />
        <InfoCard label="Site" value={project.site?.addressLine1 ?? project.siteAddress ?? 'Not linked'} detail={project.site?.postcode ?? project.localAuthority ?? ''} />
        <InfoCard label="Status" value={human(project.status)} detail={`Updated ${date(project.updatedAt)}`} />
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <ListPanel title="Deadlines" rows={project.deadlines ?? []} empty="No deadlines linked yet." render={(deadline) => <div className="rounded-md border border-stone-200 p-3"><div className="flex justify-between gap-3"><p className="font-semibold">{deadline.title}</p><span className="text-sm text-stone-500">{date(deadline.dueDate)}</span></div><p className="text-sm text-stone-500">{human(deadline.type)} - {human(deadline.priority)}</p></div>} />
        <ListPanel title="Recent documents" rows={project.documents ?? []} empty="No documents uploaded yet." render={(document) => <a href={`/projects/${project.id}/files`} className="block rounded-md border border-stone-200 p-3 hover:bg-stone-50"><p className="truncate font-semibold">{document.originalName}</p><p className="text-sm text-stone-500">{human(document.type)} - {document.revision ?? 'No revision'}</p></a>} />
      </section>
    </>
  );
}

function InfoCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="panel rounded-lg p-4"><p className="label">{label}</p><p className="font-semibold">{value}</p>{detail && <p className="mt-1 text-sm text-stone-500">{detail}</p>}</div>;
}

function Clients({ data }: { data: AnyRecord }) {
  const clients = data.clients ?? [];
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'create' | 'view' | 'edit'; item?: AnyRecord } | null>(null);

  useEffect(() => {
    const closeOnSave = () => setDrawer(null);
    window.addEventListener('portal:mutation-success', closeOnSave);
    return () => window.removeEventListener('portal:mutation-success', closeOnSave);
  }, []);

  const filteredClients = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((client: AnyRecord) => [
      client.name,
      client.firstName,
      client.lastName,
      client.companyName,
      client.email,
      client.phone,
      client.address,
      client.addressLine1,
      client.addressLine2,
      client.townCity,
      client.postcode,
      client.notes,
    ].some((value) => String(value ?? '').toLowerCase().includes(needle)));
  }, [clients, query]);

  return (
    <section className="space-y-5">
      <DirectoryToolbar
        count={clients.length}
        noun="client"
        searchLabel="Search clients"
        searchPlaceholder="Search clients by name, email, phone or address..."
        value={query}
        onChange={setQuery}
        actionLabel="New client"
        onAction={() => setDrawer({ mode: 'create' })}
      />

      {clients.length ? (
        <ClientDirectoryTable clients={filteredClients} onView={(client) => setDrawer({ mode: 'view', item: client })} onEdit={(client) => setDrawer({ mode: 'edit', item: client })} />
      ) : (
        <DirectoryEmptyState title="No clients yet" text="Add your first client so projects can be linked to the right contact." actionLabel="New client" onAction={() => setDrawer({ mode: 'create' })} />
      )}

      {clients.length > 0 && !filteredClients.length && <EmptyState>No clients match your search.</EmptyState>}
      {drawer && <ClientDrawer drawer={drawer} onClose={() => setDrawer(null)} onEdit={(client) => setDrawer({ mode: 'edit', item: client })} />}
    </section>
  );
}

function Sites({ data }: { data: AnyRecord }) {
  const sites = data.sites ?? [];
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'create' | 'view' | 'edit'; item?: AnyRecord } | null>(null);

  useEffect(() => {
    const closeOnSave = () => setDrawer(null);
    window.addEventListener('portal:mutation-success', closeOnSave);
    return () => window.removeEventListener('portal:mutation-success', closeOnSave);
  }, []);

  const filteredSites = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sites;
    return sites.filter((site: AnyRecord) => [site.addressLine1, site.addressLine2, site.townCity, site.postcode, site.localAuthority, site.notes].some((value) => String(value ?? '').toLowerCase().includes(needle)));
  }, [sites, query]);

  return (
    <section className="space-y-5">
      <DirectoryToolbar
        count={sites.length}
        noun="site"
        searchLabel="Search sites"
        searchPlaceholder="Search sites by address, postcode, town or authority..."
        value={query}
        onChange={setQuery}
        actionLabel="New site"
        onAction={() => setDrawer({ mode: 'create' })}
      />

      {sites.length ? (
        <SiteDirectoryTable sites={filteredSites} onView={(site) => setDrawer({ mode: 'view', item: site })} onEdit={(site) => setDrawer({ mode: 'edit', item: site })} />
      ) : (
        <DirectoryEmptyState title="No sites yet" text="Add your first site so projects can share accurate addresses and local authorities." actionLabel="New site" onAction={() => setDrawer({ mode: 'create' })} />
      )}

      {sites.length > 0 && !filteredSites.length && <EmptyState>No sites match your search.</EmptyState>}
      {drawer && <SiteDrawer drawer={drawer} onClose={() => setDrawer(null)} onEdit={(site) => setDrawer({ mode: 'edit', item: site })} />}
    </section>
  );
}

function DirectoryToolbar({ count, noun, searchLabel, searchPlaceholder, value, onChange, actionLabel, onAction }: { count: number; noun: string; searchLabel: string; searchPlaceholder: string; value: string; onChange: (value: string) => void; actionLabel: string; onAction: () => void }) {
  const searchId = `directory-search-${noun.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-xl">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden="true" />
        <label className="sr-only" htmlFor={searchId}>{searchLabel}</label>
        <input id={searchId} name={searchId} className="field h-12" style={{ paddingLeft: '3rem' }} value={value} onChange={(event) => onChange(event.target.value)} placeholder={searchPlaceholder} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-stone-500">{count} {noun}{count === 1 ? '' : 's'}</span>
        <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={onAction}><Plus size={16} aria-hidden="true" />{actionLabel}</button>
      </div>
    </div>
  );
}

function DirectoryEmptyState({ title, text, actionLabel, onAction }: { title: string; text: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="panel rounded-lg p-10 text-center">
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{text}</p>
      <button type="button" className="btn btn-primary mt-5 inline-flex items-center gap-2" onClick={onAction}><Plus size={16} aria-hidden="true" />{actionLabel}</button>
    </div>
  );
}

function ClientDirectoryTable({ clients, onView, onEdit }: { clients: AnyRecord[]; onView: (client: AnyRecord) => void; onEdit: (client: AnyRecord) => void }) {
  if (!clients.length) return null;
  return (
    <div className="panel overflow-hidden rounded-lg">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead className="table-head"><tr><th className="px-5 py-4">Client</th><th className="px-5 py-4">Contact</th><th className="px-5 py-4">Address</th><th className="px-5 py-4">Projects</th><th className="px-5 py-4 text-right">Actions</th></tr></thead>
          <tbody>{clients.map((client) => <tr key={client.id} className="border-t border-stone-100 transition hover:bg-stone-50"><td className="px-5 py-5 align-middle"><div className="flex items-center gap-3"><DirectoryInitial label={client.name} /><div className="min-w-0"><p className="truncate font-semibold text-ink">{client.name}</p><p className="text-sm text-stone-500">Client</p></div></div></td><td className="px-5 py-5 align-middle text-sm text-stone-600"><DirectoryContact email={client.email} phone={client.phone} /></td><td className="px-5 py-5 align-middle text-sm text-stone-600"><DirectoryAddress value={client.address} /></td><td className="px-5 py-5 align-middle text-sm text-stone-700">{client._count?.projects ?? 0} project{(client._count?.projects ?? 0) === 1 ? '' : 's'}</td><td className="px-5 py-5 align-middle"><div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={() => onView(client)}>View</button><button type="button" className="btn btn-secondary" onClick={() => onEdit(client)}>Edit</button></div></td></tr>)}</tbody>
        </table>
      </div>
      <div className="border-t border-stone-100 px-5 py-4 text-center text-sm text-stone-500">End of clients</div>
    </div>
  );
}

function SiteDirectoryTable({ sites, onView, onEdit }: { sites: AnyRecord[]; onView: (site: AnyRecord) => void; onEdit: (site: AnyRecord) => void }) {
  if (!sites.length) return null;
  return (
    <div className="panel overflow-hidden rounded-lg">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead className="table-head"><tr><th className="px-5 py-4">Site</th><th className="px-5 py-4">Local authority</th><th className="px-5 py-4">Notes</th><th className="px-5 py-4">Projects</th><th className="px-5 py-4 text-right">Actions</th></tr></thead>
          <tbody>{sites.map((site) => <tr key={site.id} className="border-t border-stone-100 transition hover:bg-stone-50"><td className="px-5 py-5 align-middle"><div className="flex items-center gap-3"><DirectoryInitial label={site.addressLine1} /><div className="min-w-0"><p className="truncate font-semibold text-ink">{site.addressLine1}</p><p className="text-sm text-stone-500">{[site.addressLine2, site.townCity, site.postcode].filter(Boolean).join(', ') || 'No address summary'}</p></div></div></td><td className="px-5 py-5 align-middle text-sm text-stone-600">{site.localAuthority || 'Not set'}</td><td className="max-w-sm px-5 py-5 align-middle text-sm text-stone-600"><p className="line-clamp-2">{site.notes || 'No notes'}</p></td><td className="px-5 py-5 align-middle text-sm text-stone-700">{site._count?.projects ?? 0} project{(site._count?.projects ?? 0) === 1 ? '' : 's'}</td><td className="px-5 py-5 align-middle"><div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={() => onView(site)}>View</button><button type="button" className="btn btn-secondary" onClick={() => onEdit(site)}>Edit</button></div></td></tr>)}</tbody>
        </table>
      </div>
      <div className="border-t border-stone-100 px-5 py-4 text-center text-sm text-stone-500">End of sites</div>
    </div>
  );
}

function DirectoryInitial({ label }: { label?: string | null }) {
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-moss/10 text-sm font-semibold text-moss">{(label || '?').trim().charAt(0).toUpperCase()}</span>;
}

function DirectoryContact({ email, phone }: { email?: string | null; phone?: string | null }) {
  return <div className="space-y-1.5"><p className="flex items-center gap-2"><Mail size={14} className="text-stone-400" aria-hidden="true" />{email || 'No email'}</p><p className="flex items-center gap-2"><Phone size={14} className="text-stone-400" aria-hidden="true" />{phone || 'No phone'}</p></div>;
}

function DirectoryAddress({ value }: { value?: string | null }) {
  return <p className="flex items-start gap-2"><MapPin size={14} className="mt-0.5 shrink-0 text-stone-400" aria-hidden="true" /><span>{value || 'No address'}</span></p>;
}

function DirectoryDrawer({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close panel" className="absolute inset-0 h-full w-full bg-ink/20 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-stone-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 p-6">
          <div><h2 className="text-xl font-semibold text-ink">{title}</h2><p className="mt-2 text-sm leading-6 text-stone-500">{description}</p></div>
          <button type="button" className="rounded-full p-2 text-stone-500 transition hover:bg-stone-100 hover:text-ink" onClick={onClose} aria-label="Close panel"><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </aside>
    </div>
  );
}

function ClientDrawer({ drawer, onClose, onEdit }: { drawer: { mode: 'create' | 'view' | 'edit'; item?: AnyRecord }; onClose: () => void; onEdit: (client: AnyRecord) => void }) {
  if (drawer.mode === 'view' && drawer.item) {
    const client = drawer.item;
    const identity = clientIdentityLabel(client);
    const address = clientStructuredAddress(client);
    return <DirectoryDrawer title={client.name} description="Client profile linked into project records." onClose={onClose}><div className="space-y-5 text-sm"><DetailRow label="Client" value={identity || 'Individual'} /><DetailRow label="Email" value={client.email || 'No email'} /><DetailRow label="Phone" value={client.phone || 'No phone'} /><DetailRow label="Address" value={address} /><DetailRow label="Projects" value={`${client._count?.projects ?? 0} project${(client._count?.projects ?? 0) === 1 ? '' : 's'}`} /><DetailRow label="Notes" value={client.notes || 'No notes'} /><button type="button" className="btn btn-primary w-full" onClick={() => onEdit(client)}>Edit client</button></div></DirectoryDrawer>;
  }
  const client = drawer.item;
  const editing = drawer.mode === 'edit';
  return <DirectoryDrawer title={editing ? 'Edit client' : 'New client'} description={editing ? 'Update this client profile.' : 'Add a new client profile that can be linked to projects.'} onClose={onClose}><ClientForm client={client} onClose={onClose} />{editing && client && <DeleteForm action={`/api/clients/${client.id}`} label="Delete client" confirm="Delete this client? Linked projects will keep their project record." />}</DirectoryDrawer>;
}

function ClientForm({ client, onClose }: { client?: AnyRecord; onClose: () => void }) {
  const editing = Boolean(client?.id);
  return (
    <form
      data-api-form
      data-field-errors
      data-action={editing ? `/api/clients/${client?.id}` : '/api/clients'}
      data-method={editing ? 'PATCH' : 'POST'}
      className="grid gap-4"
    >
      <label className="block">
        <span className="label">Name</span>
        <input required name="name" defaultValue={client?.name ?? ''} className="field" placeholder="Enter client name" />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block"><span className="label">Title</span><select name="title" defaultValue={client?.title ?? ''} className="field"><option value="">Not set</option><option>Mr</option><option>Mrs</option><option>Miss</option><option>Ms</option><option>Other</option></select></label>
        <label className="block"><span className="label">First name</span><input name="firstName" defaultValue={client?.firstName ?? ''} className="field" /></label>
        <label className="block"><span className="label">Last name</span><input name="lastName" defaultValue={client?.lastName ?? ''} className="field" /></label>
      </div>
      <label className="block"><span className="label">Company name</span><input name="companyName" defaultValue={client?.companyName ?? ''} className="field" /></label>
      <label className="block">
        <span className="label">Email</span>
        <input
          type="email"
          name="email"
          maxLength={160}
          autoComplete="email"
          defaultValue={client?.email ?? ''}
          className="field peer invalid:border-red-300"
          placeholder="Enter email address"
          aria-describedby="client-email-error"
        />
        <p
          id="client-email-error"
          data-field-error="email"
          className="mt-1 hidden text-xs text-red-700 peer-invalid:block"
        >
          Enter a valid email address.
        </p>
      </label>
      <label className="block">
        <span className="label">Phone</span>
        <input
          type="tel"
          name="phone"
          maxLength={20}
          inputMode="tel"
          autoComplete="tel"
          pattern={UK_PHONE_HTML_PATTERN}
          defaultValue={client?.phone ?? ''}
          className="field peer invalid:border-red-300"
          placeholder="07483 882299"
          aria-describedby="client-phone-error"
        />
        <p
          id="client-phone-error"
          data-field-error="phone"
          className="mt-1 hidden text-xs text-red-700 peer-invalid:block"
        >
          Enter a valid phone number.
        </p>
      </label>
      <label className="block">
        <span className="label">Address line 1</span>
        <input name="addressLine1" defaultValue={client?.addressLine1 ?? ''} className="field" />
      </label>
      <label className="block"><span className="label">Address line 2</span><input name="addressLine2" defaultValue={client?.addressLine2 ?? ''} className="field" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="label">Town/city</span><input name="townCity" defaultValue={client?.townCity ?? ''} className="field" /></label>
        <label className="block"><span className="label">Postcode</span><input name="postcode" defaultValue={client?.postcode ?? ''} className="field" /></label>
      </div>
      <label className="block"><span className="label">Country</span><input name="country" defaultValue={client?.country ?? ''} className="field" placeholder="United Kingdom" /></label>
      <details className="rounded-md border border-stone-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">Legacy address</summary>
        <textarea name="address" rows={3} defaultValue={client?.address ?? ''} className="field mt-3" placeholder="Used only by older project records" />
      </details>
      <label className="block">
        <span className="label">Notes</span>
        <textarea name="notes" rows={4} defaultValue={client?.notes ?? ''} className="field" placeholder="Add any notes about this client" />
      </label>
      <button className="btn btn-primary w-full">Save client</button>
      <button type="button" className="btn btn-secondary w-full" onClick={onClose}>Cancel</button>
      <p data-form-status className="text-sm text-stone-500" />
    </form>
  );
}

function SiteDrawer({ drawer, onClose, onEdit }: { drawer: { mode: 'create' | 'view' | 'edit'; item?: AnyRecord }; onClose: () => void; onEdit: (site: AnyRecord) => void }) {
  if (drawer.mode === 'view' && drawer.item) {
    const site = drawer.item;
    return <DirectoryDrawer title={site.addressLine1} description="Site profile for project records and local authority details." onClose={onClose}><div className="space-y-5 text-sm"><DetailRow label="Address" value={[site.addressLine1, site.addressLine2, site.townCity, site.postcode].filter(Boolean).join(', ') || 'No address'} /><DetailRow label="Local authority" value={site.localAuthority || 'Not set'} /><DetailRow label="Projects" value={`${site._count?.projects ?? 0} project${(site._count?.projects ?? 0) === 1 ? '' : 's'}`} /><DetailRow label="Notes" value={site.notes || 'No notes'} /><button type="button" className="btn btn-primary w-full" onClick={() => onEdit(site)}>Edit site</button></div></DirectoryDrawer>;
  }
  const site = drawer.item;
  const editing = drawer.mode === 'edit';
  return <DirectoryDrawer title={editing ? 'Edit site' : 'New site'} description={editing ? 'Update this site profile.' : 'Add a reusable site address for projects.'} onClose={onClose}><SiteForm site={site} onClose={onClose} />{editing && site && <DeleteForm action={`/api/sites/${site.id}`} label="Delete site" confirm="Delete this site? Linked projects will keep their project record." />}</DirectoryDrawer>;
}

function SiteForm({ site, onClose }: { site?: AnyRecord; onClose: () => void }) {
  const editing = Boolean(site?.id);
  return <form data-api-form data-action={editing ? `/api/sites/${site?.id}` : '/api/sites'} data-method={editing ? 'PATCH' : 'POST'} className="grid gap-4"><label className="block"><span className="label">Address line 1</span><input required name="addressLine1" defaultValue={site?.addressLine1 ?? ''} className="field" placeholder="Enter address line 1" /></label><label className="block"><span className="label">Address line 2</span><input name="addressLine2" defaultValue={site?.addressLine2 ?? ''} className="field" placeholder="Enter address line 2" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="label">Town/city</span><input required name="townCity" defaultValue={site?.townCity ?? ''} className="field" placeholder="Town or city" /></label><label className="block"><span className="label">Postcode</span><input required name="postcode" defaultValue={site?.postcode ?? ''} className="field" placeholder="Postcode" /></label></div><label className="block"><span className="label">Local authority</span><input name="localAuthority" defaultValue={site?.localAuthority ?? ''} className="field" placeholder="Local authority" /></label><label className="block"><span className="label">Notes</span><textarea name="notes" rows={4} defaultValue={site?.notes ?? ''} className="field" placeholder="Add any notes about this site" /></label><button className="btn btn-primary w-full">Save site</button><button type="button" className="btn btn-secondary w-full" onClick={onClose}>Cancel</button><p data-form-status className="text-sm text-stone-500" /></form>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-stone-100 pb-4 last:border-b-0"><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</p><p className="mt-1 whitespace-pre-wrap text-stone-800">{value}</p></div>;
}
function Deadlines({ data }: { data: AnyRecord }) {
  const deadlines = data.deadlines ?? [];
  const projects = data.projects ?? [];
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'create' | 'view' | 'edit'; item?: AnyRecord } | null>(null);

  useEffect(() => {
    const closeOnSave = () => setDrawer(null);
    window.addEventListener('portal:mutation-success', closeOnSave);
    return () => window.removeEventListener('portal:mutation-success', closeOnSave);
  }, []);

  const filteredDeadlines = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return deadlines;
    return deadlines.filter((deadline: AnyRecord) => [deadline.title, deadline.description, deadline.project?.name, deadline.priority]
      .some((value) => String(value ?? '').toLowerCase().includes(needle)));
  }, [deadlines, query]);

  return (
    <section className="space-y-5">
      <DirectoryToolbar
        count={deadlines.length}
        noun="deadline"
        searchLabel="Search deadlines"
        searchPlaceholder="Search deadlines by project or description..."
        value={query}
        onChange={setQuery}
        actionLabel="New deadline"
        onAction={() => setDrawer({ mode: 'create' })}
      />

      {deadlines.length ? (
        <DeadlineDirectoryTable deadlines={filteredDeadlines} onView={(deadline) => setDrawer({ mode: 'view', item: deadline })} onEdit={(deadline) => setDrawer({ mode: 'edit', item: deadline })} />
      ) : (
        <DirectoryEmptyState title="No deadlines yet" text="Add your first deadline to keep project dates visible in the practice calendar." actionLabel="New deadline" onAction={() => setDrawer({ mode: 'create' })} />
      )}

      {deadlines.length > 0 && !filteredDeadlines.length && <EmptyState>No deadlines match your search.</EmptyState>}
      {drawer && <DeadlineDrawer drawer={drawer} projects={projects} onClose={() => setDrawer(null)} onEdit={(deadline) => setDrawer({ mode: 'edit', item: deadline })} />}
    </section>
  );
}

function DeadlineDirectoryTable({ deadlines, onView, onEdit }: { deadlines: AnyRecord[]; onView: (deadline: AnyRecord) => void; onEdit: (deadline: AnyRecord) => void }) {
  if (!deadlines.length) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (
    <div className="panel overflow-hidden rounded-lg">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse">
          <thead className="table-head"><tr><th className="px-5 py-4">Deadline</th><th className="px-5 py-4">Project</th><th className="px-5 py-4">Due date</th><th className="px-5 py-4">Priority</th><th className="px-5 py-4 text-right">Actions</th></tr></thead>
          <tbody>{deadlines.map((deadline) => {
            const overdue = deadline.status !== 'COMPLETED' && new Date(deadline.dueDate) < today;
            return <tr key={deadline.id} className="border-t border-stone-100 transition hover:bg-stone-50"><td className="max-w-md px-5 py-5 align-middle"><p className="truncate font-semibold text-ink">{deadline.title}</p><p className="mt-1 line-clamp-1 text-sm text-stone-500">{deadline.description || 'No description'}</p></td><td className="px-5 py-5 align-middle text-sm text-stone-700">{deadline.project?.name ?? 'General'}</td><td className={`px-5 py-5 align-middle text-sm font-medium ${overdue ? 'text-red-800' : 'text-stone-700'}`}>{date(deadline.dueDate)}{overdue && <span className="ml-2 text-xs font-semibold">Overdue</span>}</td><td className="px-5 py-5 align-middle text-sm text-stone-700"><span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${deadline.priority === 'CRITICAL' ? 'bg-red-700' : deadline.priority === 'HIGH' ? 'bg-amber-500' : 'bg-moss/70'}`} />{human(deadline.priority)}</span></td><td className="px-5 py-5 align-middle"><div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={() => onView(deadline)}>View</button><button type="button" className="btn btn-secondary" onClick={() => onEdit(deadline)}>Edit</button></div></td></tr>;
          })}</tbody>
        </table>
      </div>
      <div className="border-t border-stone-100 px-5 py-4 text-center text-sm text-stone-500">End of deadlines</div>
    </div>
  );
}

function DeadlineDrawer({ drawer, projects, onClose, onEdit }: { drawer: { mode: 'create' | 'view' | 'edit'; item?: AnyRecord }; projects: AnyRecord[]; onClose: () => void; onEdit: (deadline: AnyRecord) => void }) {
  if (drawer.mode === 'view' && drawer.item) {
    const deadline = drawer.item;
    return <DirectoryDrawer title={deadline.title} description="Project deadline details." onClose={onClose}><div className="space-y-5 text-sm"><DetailRow label="Project" value={deadline.project?.name ?? 'General'} /><DetailRow label="Due date" value={date(deadline.dueDate)} /><DetailRow label="Priority" value={human(deadline.priority)} /><DetailRow label="Description" value={deadline.description || 'No description'} /><button type="button" className="btn btn-primary w-full" onClick={() => onEdit(deadline)}>Edit deadline</button></div></DirectoryDrawer>;
  }
  const deadline = drawer.item;
  const editing = drawer.mode === 'edit';
  return <DirectoryDrawer title={editing ? 'Edit deadline' : 'New deadline'} description={editing ? 'Update the project, date or details for this deadline.' : 'Add a project date. It will sync automatically when Google Calendar is connected.'} onClose={onClose}><DeadlineForm deadline={deadline} projects={projects} onClose={onClose} />{editing && deadline && <DeleteForm action={`/api/deadlines/${deadline.id}`} label="Delete deadline" confirm="Delete this deadline? It will also be removed from Google Calendar." />}</DirectoryDrawer>;
}

function DeadlineForm({ deadline, projects, onClose }: { deadline?: AnyRecord; projects: AnyRecord[]; onClose: () => void }) {
  const selectedFromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('projectId') ?? '' : '';
  const [projectId, setProjectId] = useState(deadline?.projectId ?? selectedFromUrl);
  const [description, setDescription] = useState(deadline?.description ?? '');
  const editing = Boolean(deadline?.id);

  return (
    <form data-api-form data-action={editing ? `/api/deadlines/${deadline?.id}` : '/api/deadlines'} data-method={editing ? 'PATCH' : 'POST'} className="grid gap-4">
      <input type="hidden" name="type" value={deadline?.type ?? 'CUSTOM'} />
      <input type="hidden" name="status" value={deadline?.status ?? 'UPCOMING'} />
      <label className="block"><span className="label">Title</span><input required name="title" maxLength={160} defaultValue={deadline?.title ?? ''} className="field" placeholder="Enter deadline title" autoFocus /></label>
      <label className="block"><span className="label">Project</span><select name="projectId" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="field"><option value="">General</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className="block"><span className="label">Due date</span><input required type="date" name="dueDate" defaultValue={dateInput(deadline?.dueDate)} className="field" /></label>
      <label className="block"><span className="label">Priority</span><select name="priority" defaultValue={deadline?.priority ?? 'MEDIUM'} className="field">{deadlinePriorities.map((priority) => <option key={priority} value={priority}>{human(priority)}</option>)}</select></label>
      <label className="block"><span className="label">Description <span className="normal-case text-stone-400">(optional)</span></span><textarea name="description" rows={5} value={description} onChange={(event) => setDescription(event.target.value)} className="field" placeholder="What needs to happen by this date?" /></label>
      <button className="btn btn-primary w-full">Save deadline</button>
      <button type="button" className="btn btn-secondary w-full" onClick={onClose}>Cancel</button>
      <p data-form-status className="text-sm text-stone-500" />
    </form>
  );
}

function Planning({ data, warrant = false }: { data: AnyRecord; warrant?: boolean }) {
  const rows = warrant ? data.applications ?? data.warrants ?? [] : data.applications ?? [];
  if (!rows.length) return <EmptyState>{warrant ? 'No building warrant applications yet.' : 'No planning applications yet.'}</EmptyState>;
  return <div className="space-y-4">{rows.map((item: AnyRecord) => warrant ? <WarrantCard key={item.id} item={item} /> : <PlanningCard key={item.id} item={item} />)}</div>;
}

function PlanningCard({ item }: { item: AnyRecord }) {
  return <article className="panel rounded-lg p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-lg font-semibold">{item.applicationReference ?? 'Planning application'}</p><p className="mt-1 text-sm text-stone-500">Target decision: {date(item.decisionTargetDate)}</p></div><Chip label={human(item.status)} tone="info" /></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4"><div><dt className="text-stone-500">Submitted</dt><dd>{date(item.submissionDate)}</dd></div><div><dt className="text-stone-500">Valid</dt><dd>{date(item.validDate)}</dd></div><div><dt className="text-stone-500">Decision</dt><dd>{date(item.decisionDate)}</dd></div><div><dt className="text-stone-500">Portal</dt><dd>{item.portalUrl ? <a className="font-semibold underline" href={item.portalUrl} target="_blank" rel="noreferrer">Open</a> : 'Not set'}</dd></div></dl>{item.notes && <p className="mt-4 rounded-md bg-stone-50 p-3 text-sm text-stone-600">{item.notes}</p>}<details className="mt-4 rounded-md border border-stone-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Edit planning record</summary><form data-api-form data-action={`/api/planning/${item.id}`} data-method="PATCH" className="mt-4 grid gap-4"><label className="block"><span className="label">Application reference</span><input name="applicationReference" defaultValue={item.applicationReference ?? ''} className="field" /></label><label className="block"><span className="label">Status</span><select name="status" defaultValue={item.status} className="field">{planningStatuses.map((status) => <option key={status} value={status}>{human(status)}</option>)}</select></label><DateGrid item={item} fields={['submissionDate', 'validDate', 'decisionTargetDate', 'decisionDate']} /><label className="block"><span className="label">Portal URL</span><input type="url" name="portalUrl" defaultValue={item.portalUrl ?? ''} className="field" /></label><label className="block"><span className="label">Notes</span><textarea name="notes" rows={4} defaultValue={item.notes ?? ''} className="field" /></label><button className="btn btn-primary">Save planning record</button><span data-form-status className="text-sm text-stone-500" /></form><DeleteForm action={`/api/planning/${item.id}`} label="Delete planning record" confirm="Delete this planning application record?" /></details></article>;
}

function WarrantCard({ item }: { item: AnyRecord }) {
  return <article className="panel rounded-lg p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-lg font-semibold">{item.warrantReference ?? 'Building warrant application'}</p><p className="mt-1 text-sm text-stone-500">{human(item.warrantType)} - first response {date(item.firstResponseTargetDate)}</p></div><Chip label={human(item.status)} tone="info" /></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4"><div><dt className="text-stone-500">Submitted</dt><dd>{date(item.submissionDate)}</dd></div><div><dt className="text-stone-500">Granted</dt><dd>{date(item.grantedDate)}</dd></div><div><dt className="text-stone-500">Expiry</dt><dd>{date(item.expiryDate)}</dd></div><div><dt className="text-stone-500">Portal</dt><dd>{item.portalUrl ? <a className="font-semibold underline" href={item.portalUrl} target="_blank" rel="noreferrer">Open</a> : 'Not set'}</dd></div></dl>{item.notes && <p className="mt-4 rounded-md bg-stone-50 p-3 text-sm text-stone-600">{item.notes}</p>}<details className="mt-4 rounded-md border border-stone-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Edit warrant record</summary><form data-api-form data-action={`/api/building-warrant/${item.id}`} data-method="PATCH" className="mt-4 grid gap-4"><label className="block"><span className="label">Warrant reference</span><input name="warrantReference" defaultValue={item.warrantReference ?? ''} className="field" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="label">Type</span><select name="warrantType" defaultValue={item.warrantType} className="field">{warrantTypes.map((type) => <option key={type} value={type}>{human(type)}</option>)}</select></label><label className="block"><span className="label">Status</span><select name="status" defaultValue={item.status} className="field">{warrantStatuses.map((status) => <option key={status} value={status}>{human(status)}</option>)}</select></label></div><label className="block"><span className="label">Completion certificate</span><select name="completionCertificateStatus" defaultValue={item.completionCertificateStatus} className="field">{certificateStatuses.map((status) => <option key={status} value={status}>{human(status)}</option>)}</select></label><DateGrid item={item} fields={['submissionDate', 'firstResponseTargetDate', 'grantedDate', 'expiryDate']} /><label className="block"><span className="label">Portal URL</span><input type="url" name="portalUrl" defaultValue={item.portalUrl ?? ''} className="field" /></label><label className="block"><span className="label">Notes</span><textarea name="notes" rows={4} defaultValue={item.notes ?? ''} className="field" /></label><button className="btn btn-primary">Save warrant record</button><span data-form-status className="text-sm text-stone-500" /></form><DeleteForm action={`/api/building-warrant/${item.id}`} label="Delete warrant record" confirm="Delete this building warrant record?" /></details></article>;
}

function DateGrid({ item, fields }: { item: AnyRecord; fields: string[] }) {
  return <div className="grid gap-4 sm:grid-cols-2">{fields.map((field) => <label key={field} className="block"><span className="label">{human(field.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase())}</span><input type="date" name={field} defaultValue={dateInput(item[field])} className="field" /></label>)}</div>;
}

function DeleteForm({ action, label, confirm }: { action: string; label: string; confirm: string }) {
  return <form data-api-form data-action={action} data-method="DELETE" data-redirect="reload" data-confirm={confirm} className="mt-3"><button className="btn border border-red-200 bg-red-50 text-red-700 hover:bg-red-100">{label}</button><span data-form-status className="ml-3 text-sm text-stone-500" /></form>;
}

function ProjectFiles({ data }: { data: AnyRecord }) {
  const project = data.project;
  const documents = project.documents ?? [];
  return (
    <>
      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <SubmissionPackageForm project={project} documents={documents} />
        <DocumentsTable documents={documents} projectId={project.id} />
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-[420px_1fr]">
        <Packages packages={project.submissionPackages ?? []} />
        <Batches project={project} />
      </section>
    </>
  );
}

function DocumentsTable({ documents, projectId }: { documents: AnyRecord[]; projectId: string }) {
  if (!documents.length) return <EmptyState>No documents uploaded yet.</EmptyState>;
  return <div className="panel overflow-hidden rounded-lg"><table className="w-full min-w-[760px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">Document</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Revision</th><th className="px-4 py-3">Uploaded</th><th className="px-4 py-3">Size</th></tr></thead><tbody>{documents.map((document) => <Fragment key={document.id}><tr><td className="table-cell"><a className="font-semibold hover:underline" href={`/api/documents/${document.id}`} target="_blank" rel="noreferrer">{document.originalName}</a>{document.uploadedBy?.name && <p className="text-xs text-stone-500">{document.uploadedBy.name}</p>}</td><td className="table-cell">{human(document.type)}</td><td className="table-cell">{document.revision ?? 'None'}</td><td className="table-cell">{date(document.createdAt)}</td><td className="table-cell">{bytes(document.sizeBytes)}</td></tr><tr><td colSpan={5} className="border-b border-stone-100 bg-stone-50 px-4 py-3"><details><summary className="cursor-pointer text-sm font-semibold">Edit classification</summary><form data-api-form data-action={`/api/documents/${document.id}`} data-method="PATCH" className="mt-3 grid gap-3 md:grid-cols-4"><label className="block"><span className="label">Document type</span><select name="type" defaultValue={document.type} className="field">{documentTypes.map((type) => <option key={type} value={type}>{human(type)}</option>)}</select></label><label className="block"><span className="label">Revision</span><input name="revision" defaultValue={document.revision ?? ''} className="field" /></label><label className="block"><span className="label">Status</span><select name="status" defaultValue={document.status} className="field">{documentStatuses.map((status) => <option key={status} value={status}>{human(status)}</option>)}</select></label><label className="block"><span className="label">Notes</span><input name="notes" defaultValue={document.notes ?? ''} className="field" /></label><div className="flex items-center gap-3 md:col-span-4"><button className="btn btn-primary">Save classification</button><span data-form-status className="text-sm text-stone-500" /></div></form></details></td></tr></Fragment>)}</tbody></table><div className="border-t border-stone-100 p-4 text-sm"><a className="font-semibold hover:underline" href={`/documents/projects/${projectId}`}>Open grouped document workspace</a></div></div>;
}

function SubmissionPackageForm({ project, documents }: { project: AnyRecord; documents: AnyRecord[] }) {
  return <form data-api-form data-action="/api/submission-packages" data-method="POST" data-redirect="reload" className="panel rounded-lg p-4"><h2 className="text-lg font-semibold">Submission package</h2><input type="hidden" name="projectId" value={project.id} /><div className="mt-4 space-y-4"><label className="block"><span className="label">Package name</span><input required name="name" className="field" /></label><label className="block"><span className="label">Type</span><select name="type" className="field">{packageTypes.map((type) => <option key={type} value={type}>{human(type)}</option>)}</select></label><label className="block"><span className="label">Status</span><select name="status" className="field">{packageStatuses.map((status) => <option key={status} value={status}>{human(status)}</option>)}</select></label><div><span className="label">Documents</span><div className="max-h-48 space-y-2 overflow-auto rounded-md border border-stone-200 p-2">{documents.length ? documents.map((document) => <label key={document.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="documentIds" value={document.id} /><span className="truncate">{document.originalName}</span></label>) : <p className="text-sm text-stone-500">Upload documents before creating a package.</p>}</div></div></div><button className="btn btn-primary mt-4 w-full">Create package</button><p data-form-status className="mt-3 text-sm text-stone-500" /></form>;
}

function Packages({ packages }: { packages: AnyRecord[] }) {
  return <div className="panel rounded-lg p-4"><h2 className="text-lg font-semibold">Packages</h2><div className="mt-4 space-y-3">{packages.length ? packages.map((pkg) => <div key={pkg.id} className="rounded-md border border-stone-200 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{pkg.name}</p><p className="text-sm text-stone-500">{human(pkg.type)} - {pkg.documents?.length ?? 0} documents</p></div><Chip label={human(pkg.status)} tone="info" /></div></div>) : <p className="text-sm text-stone-500">No submission packages created yet.</p>}</div></div>;
}

function Batches({ project }: { project: AnyRecord }) {
  return <div className="panel rounded-lg p-4"><h2 className="text-lg font-semibold">Recent sorting batches</h2><div className="mt-3 space-y-2">{project.documentSortBatches?.length ? project.documentSortBatches.map((batch: AnyRecord) => <a key={batch.id} href={`/projects/${project.id}/files/sort/${batch.id}`} className="block rounded-md border border-stone-200 p-3 hover:border-moss"><span className="font-semibold">{batch.fileCount} files</span><span className="ml-2 text-sm text-stone-500">{human(batch.status)}</span><p className="mt-1 text-xs text-stone-500">{date(batch.createdAt)}</p></a>) : <p className="text-sm text-stone-500">No auto-sort batches yet.</p>}</div></div>;
}

function DocumentsHub({ data }: { data: AnyRecord }) {
  const projects = data.projects ?? [];
  return (
    <>
      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <InfoCard label="Project folders" value={String(projects.length)} />
        <InfoCard label="Documents" value={String(data.totalDocumentCount ?? 0)} />
        <InfoCard label="Missing location plans" value={String(data.missingLocationCount ?? 0)} />
      </section>
      <section id="project-folders"><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">Project folders</h2><span className="text-sm text-stone-500">{projects.length} folders</span></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{projects.length ? projects.map((project: AnyRecord) => <article key={project.id} className="panel rounded-lg p-4"><a href={`/documents/projects/${project.id}`} className="block"><h3 className="truncate text-lg font-semibold">{project.name}</h3>{project.internalReference && <p className="mt-1 text-sm font-medium text-stone-500">{project.internalReference}</p>}<p className="mt-3 min-h-10 text-sm text-stone-500">{project.summary}</p><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-md border border-stone-200 p-3"><p className="text-xs font-semibold uppercase text-stone-500">Documents</p><p className="mt-1 text-lg font-semibold">{project.documentCount}</p></div><div className="rounded-md border border-stone-200 p-3"><p className="text-xs font-semibold uppercase text-stone-500">Latest upload</p><p className="mt-1 text-sm font-semibold">{date(project.latestUpload)}</p></div></div>{project.missingLocationPlan && <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Location plan missing</div>}</a><div className="mt-4 flex flex-wrap gap-2"><a href={`/documents/projects/${project.id}`} className="btn btn-primary">Open folder</a><a href={`/documents/upload?projectId=${project.id}`} className="btn btn-secondary">Upload documents</a></div></article>) : <EmptyState>Create a project to start building document folders.</EmptyState>}</div></section>
      <ListPanel title="Recent documents" href="/documents?show=recent#recent-documents" rows={data.recentDocuments ?? []} empty="No documents uploaded yet." render={(document) => <div className="rounded-md border border-stone-200 p-3"><p className="font-semibold">{document.originalName}</p><p className="text-sm text-stone-500">{document.project.name} - {human(document.type)} - {date(document.createdAt)}</p></div>} />
      <DocumentsIndexPanel />
    </>
  );
}

function DocumentsIndexPanel() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [type, setType] = useState('');
  const [documents, setDocuments] = useState<AnyRecord[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ sort });
      if (query.trim()) params.set('q', query.trim());
      if (type) params.set('type', type);
      const result = await apiRequest<AnyRecord>(`/api/documents/list?${params.toString()}`);
      setDocuments(result.documents ?? []);
      setCount(result.count ?? 0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to search documents.');
    } finally {
      setLoading(false);
    }
  }, [query, sort, type]);

  const open = async () => {
    setExpanded(true);
    if (!documents.length && !loading) await loadDocuments();
  };

  return (
    <section id="all-documents" className="panel mt-6 rounded-lg p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">All documents</h2>
          <p className="mt-1 text-sm text-stone-500">Collapsed by default. Search by file, drawing or project when you need the full index.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={expanded ? () => setExpanded(false) : open}>{expanded ? 'Show less' : 'See more'}</button>
      </div>
      {expanded && (
        <div className="mt-4 space-y-4">
          <form
            className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_220px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void loadDocuments();
            }}
          >
            <label className="block">
              <span className="label">Search</span>
              <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="File name, drawing title or project" />
            </label>
            <label className="block">
              <span className="label">Sort</span>
              <select className="field" value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="recent">Most recent</option>
                <option value="oldest">Oldest</option>
                <option value="name">File name</option>
                <option value="project">Project</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Type</span>
              <select className="field" value={type} onChange={(event) => setType(event.target.value)}>
                <option value="">All types</option>
                {documentTypes.map((documentType) => <option key={documentType} value={documentType}>{human(documentType)}</option>)}
              </select>
            </label>
            <button className="btn btn-primary self-end">Apply filters</button>
          </form>
          {error && <ErrorState message={error} retry={loadDocuments} />}
          {loading ? <SkeletonTable rows={4} /> : documents.length ? (
            <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3 text-sm text-stone-500">
                <span>{count} document{count === 1 ? '' : 's'}</span>
                <span>Latest 100 results</span>
              </div>
              <table className="w-full min-w-[760px] border-collapse">
                <thead className="table-head"><tr><th className="px-4 py-3">Document</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Uploaded</th><th className="px-4 py-3">Size</th></tr></thead>
                <tbody>{documents.map((document) => <tr key={document.id} className="hover:bg-stone-50"><td className="table-cell"><a className="font-semibold hover:underline" href={`/documents/projects/${document.projectId}`}>{document.originalName}</a><p className="text-xs text-stone-500">{document.uploadedBy?.name ?? 'Unknown uploader'}</p></td><td className="table-cell">{document.project?.name ?? 'Unknown project'}</td><td className="table-cell">{human(document.type)}</td><td className="table-cell">{date(document.createdAt)}</td><td className="table-cell">{bytes(document.sizeBytes)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <EmptyState>No documents match those filters.</EmptyState>}
        </div>
      )}
    </section>
  );
}

function DocumentFolder({ data }: { data: AnyRecord }) {
  const project = data.project;
  const buckets = data.buckets ?? [];
  return <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Document buckets</h2><span className="text-sm text-stone-500">{project.documentCount} documents</span></div>{buckets.map((bucket: AnyRecord) => <details key={bucket.type} className="panel rounded-lg" open={bucket.documents.length > 0}><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"><span className="font-semibold">{bucket.label}</span><span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600">{bucket.documents.length} file{bucket.documents.length === 1 ? '' : 's'}</span></summary><div className="border-t border-stone-100">{bucket.documents.length ? bucket.documents.map((document: AnyRecord) => <div key={document.id} className="border-b border-stone-100 px-4 py-3 last:border-b-0"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><a className="font-semibold hover:underline" href={`/api/documents/${document.id}`} target="_blank" rel="noreferrer">{document.originalName}</a><p className="mt-1 text-xs text-stone-500">{document.revision ? `Rev ${document.revision}` : 'No revision'} - {human(document.status)} - {date(document.createdAt)} - {bytes(document.sizeBytes)}</p></div></div></div>) : <div className="px-4 py-6 text-sm text-stone-500">No files in this bucket yet.</div>}</div></details>)}</section>;
}

function SettingsOverview({ data }: { data: AnyRecord }) {
  const defaults = data.defaults ?? {};
  const certifierPresets = data.certifierPresets ?? [];
  const canManage = data.role === 'OWNER' || data.role === 'ADMIN';
  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <a href="/settings/integrations" className="panel rounded-lg p-5 hover:bg-stone-50">
          <p className="text-lg font-semibold">Integrations</p>
          <p className="mt-2 text-sm text-stone-500">Manage Google Calendar, Gmail and desktop access.</p>
        </a>
        <a href="/automation-jobs" className="panel rounded-lg p-5 hover:bg-stone-50">
          <p className="text-lg font-semibold">Desktop job history</p>
          <p className="mt-2 text-sm text-stone-500">View current and previous desktop application runs.</p>
        </a>
        <div className="panel rounded-lg p-5">
          <p className="text-lg font-semibold">Organisation</p>
          <p className="mt-2 text-sm text-stone-500">{data.organisation.name}</p>
          <p className="mt-2 text-xs uppercase text-stone-500">Your role: {data.role}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <form data-api-form data-action="/api/settings/organisation-defaults" data-method="PUT" className="panel grid gap-4 rounded-lg p-5">
          <div>
            <h2 className="text-xl font-semibold">Practice and agent defaults</h2>
            <p className="mt-1 text-sm text-stone-500">Reused when preparing applications. Project-specific facts remain on the application record.</p>
          </div>
          <label className="block"><span className="label">Practice name</span><input name="practiceName" defaultValue={defaults.practiceName ?? data.organisation.name} className="field" disabled={!canManage} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="label">Agent first name</span><input name="agentFirstName" defaultValue={defaults.agentFirstName ?? ''} className="field" disabled={!canManage} /></label>
            <label className="block"><span className="label">Agent last name</span><input name="agentLastName" defaultValue={defaults.agentLastName ?? ''} className="field" disabled={!canManage} /></label>
            <label className="block"><span className="label">Agent email</span><input type="email" name="agentEmail" defaultValue={defaults.agentEmail ?? ''} className="field" disabled={!canManage} /></label>
            <label className="block"><span className="label">Agent phone</span><input name="agentPhone" defaultValue={defaults.agentPhone ?? ''} className="field" disabled={!canManage} /></label>
          </div>
          <label className="block"><span className="label">Address line 1</span><input name="agentAddressLine1" defaultValue={defaults.agentAddressLine1 ?? ''} className="field" disabled={!canManage} /></label>
          <label className="block"><span className="label">Address line 2</span><input name="agentAddressLine2" defaultValue={defaults.agentAddressLine2 ?? ''} className="field" disabled={!canManage} /></label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block"><span className="label">Town/city</span><input name="agentTownCity" defaultValue={defaults.agentTownCity ?? ''} className="field" disabled={!canManage} /></label>
            <label className="block"><span className="label">Postcode</span><input name="agentPostcode" defaultValue={defaults.agentPostcode ?? ''} className="field" disabled={!canManage} /></label>
            <label className="block"><span className="label">Country</span><input name="agentCountry" defaultValue={defaults.agentCountry ?? 'United Kingdom'} className="field" disabled={!canManage} /></label>
          </div>
          <label className="block">
            <span className="label">Default certifier</span>
            <select name="defaultCertifierPresetId" defaultValue={defaults.defaultCertifierPresetId ?? ''} className="field" disabled={!canManage}>
              <option value="">No default certifier</option>
              {certifierPresets.map((preset: AnyRecord) => <option key={preset.id} value={preset.id}>{preset.displayName}</option>)}
            </select>
          </label>
          {canManage && <button className="btn btn-primary justify-self-start">Save organisation defaults</button>}
          <p data-form-status className="text-sm text-stone-500" />
        </form>

        <div className="space-y-4">
          <div className="panel rounded-lg p-5">
            <h2 className="text-xl font-semibold">Certifier presets</h2>
            <p className="mt-1 text-sm text-stone-500">Saved certificate values used by Building Warrant preparation.</p>
            <div className="mt-4 divide-y divide-stone-100">
              {certifierPresets.length ? certifierPresets.map((preset: AnyRecord) => (
                <div key={preset.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-semibold">{preset.displayName}</p>
                  <p className="mt-1 text-sm text-stone-500">{preset.certifierName || 'No certifier name'}{preset.isDefault ? ' · Default' : ''}</p>
                </div>
              )) : <p className="text-sm text-stone-500">No certifier presets saved.</p>}
            </div>
          </div>
          {canManage && (
            <form data-api-form data-action="/api/settings/certifier-presets" data-method="POST" className="panel grid gap-3 rounded-lg p-5">
              <h3 className="text-lg font-semibold">New certifier preset</h3>
              <label className="block"><span className="label">Preset name</span><input required name="displayName" className="field" /></label>
              <label className="block"><span className="label">Scheme type</span><input name="schemeType" className="field" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">Registration A prefix</span><input name="registrationAPart1" className="field" placeholder="SER1" /></label>
                <label className="block"><span className="label">Registration A number</span><input name="registrationAPart2" className="field" /></label>
                <label className="block"><span className="label">Registration B prefix</span><input name="registrationBPart1" className="field" /></label>
                <label className="block"><span className="label">Registration B number</span><input name="registrationBPart2" className="field" /></label>
              </div>
              <label className="block"><span className="label">Certifier name</span><input name="certifierName" className="field" /></label>
              <label className="block"><span className="label">Approved body</span><input name="approvedBody" className="field" /></label>
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="isDefault" /> Use as organisation default</label>
              <button className="btn btn-primary">Save certifier preset</button>
              <p data-form-status className="text-sm text-stone-500" />
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Integrations({ data }: { data: AnyRecord }) {
  return <section className="grid gap-4 md:grid-cols-2">{(data.connections ?? []).map((connection: AnyRecord) => <article key={connection.id} className="panel rounded-lg p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-lg font-semibold">{human(connection.provider)} Calendar</p><p className="mt-2 text-sm text-stone-500">Connection state is stored now; OAuth and event sync can be added later.</p></div><Chip label={human(connection.status)} /></div><dl className="mt-5 grid gap-3 text-sm"><div><dt className="text-stone-500">Account</dt><dd>{connection.accountEmail ?? 'Not connected'}</dd></div><div><dt className="text-stone-500">Last synced</dt><dd>{date(connection.lastSyncedAt)}</dd></div><div><dt className="text-stone-500">Sync error</dt><dd>{connection.syncError ?? 'None'}</dd></div></dl></article>)}</section>;
}

export default function LiveDataPanel({ endpoint, variant }: Props) {
  const [data, setData] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await apiRequest<AnyRecord>(endpoint));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load this panel.');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    let cancelled = false;
    let activeRequest: AbortController | null = null;
    const run = async () => {
      activeRequest?.abort();
      const request = new AbortController();
      activeRequest = request;
      setLoading(true);
      setError('');
      try {
        const nextData = await apiRequest<AnyRecord>(endpoint, { signal: request.signal });
        if (!cancelled) setData(nextData);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Unable to load this panel.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    const onMutation = () => void run();
    window.addEventListener('portal:mutation-success', onMutation);
    return () => {
      cancelled = true;
      activeRequest?.abort();
      window.removeEventListener('portal:mutation-success', onMutation);
    };
  }, [endpoint]);

  const skeleton = useMemo(() => {
    if (variant === 'dashboard') return <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-32" />)}</section><section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]"><SkeletonBlock className="h-72" /><SkeletonBlock className="h-72" /></section></>;
    if (variant === 'projects' || variant === 'clients' || variant === 'sites') return <SkeletonTable rows={5} />;
    if (variant === 'documentsHub') return <><section className="mb-6 grid gap-4 md:grid-cols-3"><SkeletonBlock className="h-24" /><SkeletonBlock className="h-24" /><SkeletonBlock className="h-24" /></section><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><SkeletonBlock className="h-64" /><SkeletonBlock className="h-64" /><SkeletonBlock className="h-64" /></div></>;
    return <div className="space-y-4">{Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-28" />)}</div>;
  }, [variant]);

  if (loading && !data) return skeleton;
  if (error && !data) return <ErrorState message={error} retry={load} />;
  if (!data) return null;

  if (variant === 'dashboard') return <Dashboard data={data} />;
  if (variant === 'projects') return <Projects data={data} />;
  if (variant === 'projectOverview') return <ProjectOverview data={data} />;
  if (variant === 'projectFiles') return <ProjectFiles data={data} />;
  if (variant === 'planning') return <Planning data={data} />;
  if (variant === 'warrants') return <Planning data={data} warrant />;
  if (variant === 'clients') return <Clients data={data} />;
  if (variant === 'sites') return <Sites data={data} />;
  if (variant === 'deadlines') return <Deadlines data={data} />;
  if (variant === 'documentsHub') return <DocumentsHub data={data} />;
  if (variant === 'documentFolder') return <DocumentFolder data={data} />;
  if (variant === 'settingsOverview') return <SettingsOverview data={data} />;
  if (variant === 'integrations') return <Integrations data={data} />;
  return null;
}
