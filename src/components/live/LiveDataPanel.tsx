import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '@/lib/api/http';

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
const deadlineTypes = ['PLANNING_DECISION', 'WARRANT_RESPONSE', 'WARRANT_EXPIRY', 'COMPLETION_CERTIFICATE', 'CLIENT_ACTION', 'INTERNAL_TASK', 'INSPECTION', 'CUSTOM'];
const deadlinePriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const deadlineStatuses = ['UPCOMING', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'CANCELLED'];
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
    neutral: 'bg-stone-100 text-stone-600',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-moss/10 text-moss',
  }[tone];
  return <span className={`status-chip ${classes}`}>{label}</span>;
}

const dateInput = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';

function Dashboard({ data }: { data: AnyRecord }) {
  const metrics = [
    ['Active projects', data.activeProjects, 'Open or on-hold projects', '/projects'],
    ['Upcoming deadlines', data.upcomingDeadlineCount, 'Current deadline window', '/deadlines'],
    ['Planning actions', data.planningActionCount, data.planningActionCount ? 'Needs action' : 'No action needed', '/projects'],
    ['Warrant actions', data.warrantActionCount, data.warrantActionCount ? 'Needs action' : 'No action needed', '/projects'],
  ];
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, context, href]) => (
          <a key={String(label)} href={String(href)} className="panel block rounded-lg p-4 transition hover:-translate-y-0.5 hover:bg-stone-50">
            <p className="text-xs font-semibold uppercase text-stone-500">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-ink">{String(value)}</p>
            <p className="mt-2 text-sm text-stone-500">{context}</p>
          </a>
        ))}
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <ListPanel title="Upcoming deadlines" href="/deadlines" rows={data.upcomingDeadlines} empty="No urgent deadlines in this range." render={(item) => (
          <a href="/deadlines" className="block rounded-lg border border-stone-200 px-3 py-3 hover:bg-stone-50">
            <div className="flex justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="text-xs text-stone-500">{item.project?.name ?? 'General'} - {human(item.type)}</p></div><Chip label={date(item.dueDate)} tone={new Date(item.dueDate) < new Date() ? 'danger' : 'info'} /></div>
          </a>
        )} />
        <ListPanel title="Missing document warnings" href="/documents" rows={data.missingDocumentWarnings} empty="No missing key document warnings found." render={(item) => (
          <a href={`/documents/projects/${item.project.id}`} className="block rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-3 hover:bg-amber-50">
            <p className="font-semibold">{item.project.name}</p><p className="text-xs text-amber-800">Missing: {item.missing.join(', ')}</p>
          </a>
        )} />
      </section>
      <section className="mt-6 grid items-start gap-6 xl:grid-cols-3">
        <ListPanel title="Planning awaiting action" href="/projects" rows={data.planningAwaitingAction} empty="No planning applications waiting for action." render={(item) => (
          <a href={`/projects/${item.projectId}/planning`} className="block rounded-lg border border-stone-200 px-3 py-3 hover:bg-stone-50"><p className="font-semibold">{item.project.name}</p><p className="text-xs text-stone-500">{item.applicationReference || 'No reference'} - {human(item.status)}</p></a>
        )} />
        <ListPanel title="Building warrants awaiting action" href="/projects" rows={data.warrantsAwaitingAction} empty="No warrant applications waiting for action." render={(item) => (
          <a href={`/projects/${item.projectId}/building-warrant`} className="block rounded-lg border border-stone-200 px-3 py-3 hover:bg-stone-50"><p className="font-semibold">{item.project.name}</p><p className="text-xs text-stone-500">{item.warrantReference || human(item.warrantType)} - {human(item.status)}</p></a>
        )} />
        <ListPanel title="Recent files" href="/documents" rows={data.recentFiles} empty="Upload documents to start seeing file activity." render={(file) => (
          <div className="rounded-lg border border-stone-200 px-3 py-3"><p className="truncate font-semibold">{file.originalName}</p><p className="text-xs text-stone-500">{file.project.name} - {human(file.type)}</p><p className="text-xs text-stone-400">{date(file.createdAt)} - {bytes(file.sizeBytes)}</p><div className="mt-2 flex gap-2"><a href={`/projects/${file.projectId}/files`} className="text-xs font-semibold">Open files</a><a href={`/projects/${file.projectId}`} className="text-xs font-semibold">Open project</a></div></div>
        )} />
      </section>
    </>
  );
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
  if (!clients.length) return <EmptyState>No clients yet.</EmptyState>;
  return (
    <div className="space-y-6">
      <SimpleTable headers={['Client', 'Contact', 'Projects']} rows={clients.map((client: AnyRecord) => [<><p className="font-semibold">{client.name}</p><p className="text-xs text-stone-500">{client.address ?? ''}</p></>, <>{client.email ?? 'No email'}<p className="text-xs text-stone-500">{client.phone ?? ''}</p></>, client._count?.projects ?? 0])} />
      <EditableCards title="Manage clients" rows={clients} kind="client" />
    </div>
  );
}

function Sites({ data }: { data: AnyRecord }) {
  const sites = data.sites ?? [];
  if (!sites.length) return <EmptyState>No sites yet.</EmptyState>;
  return (
    <div className="space-y-6">
      <SimpleTable headers={['Site', 'Authority', 'Projects']} rows={sites.map((site: AnyRecord) => [<><p className="font-semibold">{site.addressLine1}</p><p className="text-xs text-stone-500">{site.townCity}, {site.postcode}</p></>, site.localAuthority ?? 'Not set', site._count?.projects ?? 0])} />
      <EditableCards title="Manage sites" rows={sites} kind="site" />
    </div>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return <div className="panel overflow-hidden rounded-lg"><table className="w-full min-w-[680px] border-collapse"><thead className="table-head"><tr>{headers.map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="table-cell">{cell}</td>)}</tr>)}</tbody></table></div>;
}

function EditableCards({ title, rows, kind }: { title: string; rows: AnyRecord[]; kind: 'client' | 'site' }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((row) => kind === 'client' ? <ClientEditor key={row.id} client={row} /> : <SiteEditor key={row.id} site={row} />)}
      </div>
    </section>
  );
}

function ClientEditor({ client }: { client: AnyRecord }) {
  return <details className="panel rounded-lg p-4"><summary className="cursor-pointer font-semibold">{client.name}</summary><form data-api-form data-action={`/api/clients/${client.id}`} data-method="PATCH" className="mt-4 grid gap-4"><label className="block"><span className="label">Name</span><input required name="name" defaultValue={client.name} className="field" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="label">Email</span><input type="email" name="email" defaultValue={client.email ?? ''} className="field" /></label><label className="block"><span className="label">Phone</span><input name="phone" defaultValue={client.phone ?? ''} className="field" /></label></div><label className="block"><span className="label">Address</span><textarea name="address" rows={3} defaultValue={client.address ?? ''} className="field" /></label><label className="block"><span className="label">Notes</span><textarea name="notes" rows={3} defaultValue={client.notes ?? ''} className="field" /></label><div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary">Save client</button><span data-form-status className="text-sm text-stone-500" /></div></form><form data-api-form data-action={`/api/clients/${client.id}`} data-method="DELETE" data-redirect="reload" data-confirm="Delete this client? Linked projects will keep their project record." className="mt-3"><button className="btn border border-red-200 bg-red-50 text-red-700 hover:bg-red-100">Delete client</button><span data-form-status className="ml-3 text-sm text-stone-500" /></form></details>;
}

function SiteEditor({ site }: { site: AnyRecord }) {
  return <details className="panel rounded-lg p-4"><summary className="cursor-pointer font-semibold">{site.addressLine1}, {site.postcode}</summary><form data-api-form data-action={`/api/sites/${site.id}`} data-method="PATCH" className="mt-4 grid gap-4"><label className="block"><span className="label">Address line 1</span><input required name="addressLine1" defaultValue={site.addressLine1} className="field" /></label><label className="block"><span className="label">Address line 2</span><input name="addressLine2" defaultValue={site.addressLine2 ?? ''} className="field" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="label">Town/city</span><input required name="townCity" defaultValue={site.townCity} className="field" /></label><label className="block"><span className="label">Postcode</span><input required name="postcode" defaultValue={site.postcode} className="field" /></label></div><label className="block"><span className="label">Local authority</span><input name="localAuthority" defaultValue={site.localAuthority ?? ''} className="field" /></label><label className="block"><span className="label">Notes</span><textarea name="notes" rows={3} defaultValue={site.notes ?? ''} className="field" /></label><div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary">Save site</button><span data-form-status className="text-sm text-stone-500" /></div></form><form data-api-form data-action={`/api/sites/${site.id}`} data-method="DELETE" data-redirect="reload" data-confirm="Delete this site? Linked projects will keep their project record." className="mt-3"><button className="btn border border-red-200 bg-red-50 text-red-700 hover:bg-red-100">Delete site</button><span data-form-status className="ml-3 text-sm text-stone-500" /></form></details>;
}

function Deadlines({ data }: { data: AnyRecord }) {
  const deadlines = data.deadlines ?? [];
  if (!deadlines.length) return <EmptyState>No deadlines yet.</EmptyState>;
  return <div className="space-y-3">{deadlines.map((deadline: AnyRecord) => <article key={deadline.id} className="panel rounded-lg p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-semibold">{deadline.title}</p><p className="text-sm text-stone-500">{deadline.project?.name ?? 'General'} - {human(deadline.type)}</p></div><Chip label={date(deadline.dueDate)} tone="info" /></div><p className="mt-2 text-sm text-stone-600">{human(deadline.status)} - {human(deadline.priority)}</p><details className="mt-3 rounded-md border border-stone-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Edit deadline</summary><DeadlineForm deadline={deadline} projects={data.projects ?? []} /></details></article>)}</div>;
}

function DeadlineForm({ deadline, projects }: { deadline: AnyRecord; projects: AnyRecord[] }) {
  return <><form data-api-form data-action={`/api/deadlines/${deadline.id}`} data-method="PATCH" className="mt-4 grid gap-4"><label className="block"><span className="label">Title</span><input required name="title" defaultValue={deadline.title} className="field" /></label><label className="block"><span className="label">Linked project</span><select name="projectId" defaultValue={deadline.projectId ?? ''} className="field"><option value="">General</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="label">Due date</span><input required type="date" name="dueDate" defaultValue={dateInput(deadline.dueDate)} className="field" /></label><label className="block"><span className="label">Reminder date</span><input type="date" name="reminderDate" defaultValue={dateInput(deadline.reminderDate)} className="field" /></label><label className="block"><span className="label">Type</span><select name="type" defaultValue={deadline.type} className="field">{deadlineTypes.map((type) => <option key={type} value={type}>{human(type)}</option>)}</select></label><label className="block"><span className="label">Priority</span><select name="priority" defaultValue={deadline.priority} className="field">{deadlinePriorities.map((priority) => <option key={priority} value={priority}>{human(priority)}</option>)}</select></label></div><label className="block"><span className="label">Status</span><select name="status" defaultValue={deadline.status} className="field">{deadlineStatuses.map((status) => <option key={status} value={status}>{human(status)}</option>)}</select></label><label className="block"><span className="label">Description</span><textarea name="description" rows={3} defaultValue={deadline.description ?? ''} className="field" /></label><div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary">Save deadline</button><span data-form-status className="text-sm text-stone-500" /></div></form><form data-api-form data-action={`/api/deadlines/${deadline.id}`} data-method="DELETE" data-redirect="reload" data-confirm="Delete this deadline?" className="mt-3"><button className="btn border border-red-200 bg-red-50 text-red-700 hover:bg-red-100">Delete deadline</button><span data-form-status className="ml-3 text-sm text-stone-500" /></form></>;
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
  return <div className="panel overflow-hidden rounded-lg"><table className="w-full min-w-[760px] border-collapse"><thead className="table-head"><tr><th className="px-4 py-3">Document</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Revision</th><th className="px-4 py-3">Uploaded</th><th className="px-4 py-3">Size</th></tr></thead><tbody>{documents.map((document) => <Fragment key={document.id}><tr><td className="table-cell"><a className="font-semibold hover:underline" href={document.storageUrl} target="_blank" rel="noreferrer">{document.originalName}</a>{document.uploadedBy?.name && <p className="text-xs text-stone-500">{document.uploadedBy.name}</p>}</td><td className="table-cell">{human(document.type)}</td><td className="table-cell">{document.revision ?? 'None'}</td><td className="table-cell">{date(document.createdAt)}</td><td className="table-cell">{bytes(document.sizeBytes)}</td></tr><tr><td colSpan={5} className="border-b border-stone-100 bg-stone-50 px-4 py-3"><details><summary className="cursor-pointer text-sm font-semibold">Edit classification</summary><form data-api-form data-action={`/api/documents/${document.id}`} data-method="PATCH" className="mt-3 grid gap-3 md:grid-cols-4"><label className="block"><span className="label">Document type</span><select name="type" defaultValue={document.type} className="field">{documentTypes.map((type) => <option key={type} value={type}>{human(type)}</option>)}</select></label><label className="block"><span className="label">Revision</span><input name="revision" defaultValue={document.revision ?? ''} className="field" /></label><label className="block"><span className="label">Status</span><select name="status" defaultValue={document.status} className="field">{documentStatuses.map((status) => <option key={status} value={status}>{human(status)}</option>)}</select></label><label className="block"><span className="label">Notes</span><input name="notes" defaultValue={document.notes ?? ''} className="field" /></label><div className="flex items-center gap-3 md:col-span-4"><button className="btn btn-primary">Save classification</button><span data-form-status className="text-sm text-stone-500" /></div></form></details></td></tr></Fragment>)}</tbody></table><div className="border-t border-stone-100 p-4 text-sm"><a className="font-semibold hover:underline" href={`/documents/projects/${projectId}`}>Open grouped document workspace</a></div></div>;
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
  return <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Document buckets</h2><span className="text-sm text-stone-500">{project.documentCount} documents</span></div>{buckets.map((bucket: AnyRecord) => <details key={bucket.type} className="panel rounded-lg" open={bucket.documents.length > 0}><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"><span className="font-semibold">{bucket.label}</span><span className="rounded-md bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600">{bucket.documents.length} file{bucket.documents.length === 1 ? '' : 's'}</span></summary><div className="border-t border-stone-100">{bucket.documents.length ? bucket.documents.map((document: AnyRecord) => <div key={document.id} className="border-b border-stone-100 px-4 py-3 last:border-b-0"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><a className="font-semibold hover:underline" href={document.storageUrl} target="_blank" rel="noreferrer">{document.originalName}</a><p className="mt-1 text-xs text-stone-500">{document.revision ? `Rev ${document.revision}` : 'No revision'} - {human(document.status)} - {date(document.createdAt)} - {bytes(document.sizeBytes)}</p></div></div></div>) : <div className="px-4 py-6 text-sm text-stone-500">No files in this bucket yet.</div>}</div></details>)}</section>;
}

function SettingsOverview({ data }: { data: AnyRecord }) {
  return <section className="grid gap-4 md:grid-cols-2"><a href="/settings/integrations" className="panel rounded-lg p-5 hover:bg-stone-50"><p className="text-lg font-semibold">Integrations</p><p className="mt-2 text-sm text-stone-500">Calendar connection placeholders and sync status.</p></a><div className="panel rounded-lg p-5"><p className="text-lg font-semibold">Organisation</p><p className="mt-2 text-sm text-stone-500">{data.organisation.name}</p><p className="mt-2 text-xs uppercase text-stone-500">Your role: {data.role}</p></div></section>;
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
    if (variant === 'dashboard') return <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-32" />)}</section><section className="mt-6 grid gap-6 xl:grid-cols-2"><SkeletonBlock className="h-72" /><SkeletonBlock className="h-72" /></section></>;
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
