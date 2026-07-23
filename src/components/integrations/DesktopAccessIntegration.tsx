import { ExternalLink, Laptop, ShieldCheck } from 'lucide-react';

export default function DesktopAccessIntegration() {
  return (
    <section className="panel overflow-hidden rounded-lg">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
            <Laptop size={22} />
          </span>
          <div>
            <h2 className="text-xl font-semibold">ArchitectPro Desktop</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
              Desktop handoff is automatic. From a project or prepared job, select <strong>Open in desktop app</strong> and the correct application data and documents will load securely.
            </p>
            <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-emerald-800">
              <ShieldCheck size={16} />No codes, passwords or device connection setup required.
            </p>
          </div>
        </div>
        <a className="btn btn-secondary shrink-0 gap-2" href="/automation-jobs">
          View desktop jobs<ExternalLink size={15} />
        </a>
      </div>
    </section>
  );
}
