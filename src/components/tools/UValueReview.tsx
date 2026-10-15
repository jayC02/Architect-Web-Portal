import { useRef, useState } from 'react';
type Props = { id: string; inputHash: string; status: string; latestId: string; revision: number };
const labels = { DRAFT: 'Draft', REVIEWED: 'Reviewed', ISSUED: 'Issued', WITHDRAWN: 'Withdrawn' };
export default function UValueReview({ id, inputHash, status, latestId, revision }: Props) {
  const [checks, setChecks] = useState({ geometry: false, designValues: false, corrections: false, scope: false });
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const stale = latestId !== id;
  const action = status === 'DRAFT' ? 'review' : status === 'REVIEWED' ? 'issue' : status === 'ISSUED' ? 'withdraw' : null;
  const submit = async () => {
    if (!action || busy) return;
    setBusy(true); setError(''); requestId.current ||= crypto.randomUUID();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/u-value/${encodeURIComponent(id)}/review`, { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId.current, inputHash, action, statement, ...(action === 'review' ? { checks } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The action could not be completed. Your statement has been kept.');
      window.location.reload();
    } catch (problem) { setError(problem instanceof Error && problem.name !== 'AbortError' ? problem.message : 'The request timed out. Retry to check the same action; your statement has been kept.'); }
    finally { clearTimeout(timer); setBusy(false); }
  };
  return <section className="report-controls mx-auto mb-6 max-w-5xl rounded-xl border border-stone-200 bg-white p-5 sm:p-6" aria-labelledby="review-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="review-heading" className="text-lg font-semibold">Report review</h2><span className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">Revision {revision} · {labels[status as keyof typeof labels] || 'Draft'}</span></div>
    {stale && <p className="mt-4 text-sm text-amber-900">A newer revision exists. <a href={`/tools/u-value/reports/${latestId}`} className="font-semibold underline">Open the latest revision</a> to review or issue it.</p>}
    {action && (!stale || action === 'withdraw') && <>
      <p className="mt-3 text-sm text-stone-600">{action === 'review' ? 'Check the saved inputs and working below. This records your review of this exact calculation.' : action === 'issue' ? 'Record the purpose of issue. The report retains the review and issue identities and dates.' : 'Withdraw this issued report if it should no longer be relied upon. Its calculation and history are retained.'}</p>
      {action === 'review' && <div className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries({ geometry: 'Geometry, dimensions and reference area checked', designValues: 'Material design values and evidence checked', corrections: 'Air gaps, fixings and other applicable effects checked', scope: 'Method applicability and target basis checked' }).map(([key, label]) => <label className="flex min-h-11 items-start gap-3 text-sm" key={key}><input className="mt-1 h-4 w-4 shrink-0 accent-moss" type="checkbox" checked={checks[key as keyof typeof checks]} disabled={busy} onChange={event => { requestId.current = null; setChecks(previous => ({ ...previous, [key]: event.target.checked })); }} /><span>{label}</span></label>)}</div>}
      <label className="mt-4 block"><span className="label">{action === 'review' ? 'Review statement' : action === 'issue' ? 'Purpose of issue' : 'Withdrawal reason'}</span><textarea className="field" aria-describedby="review-statement-hint" maxLength={2000} rows={2} value={statement} disabled={busy} onChange={event => { requestId.current = null; setStatement(event.target.value); }} /></label><p id="review-statement-hint" className="mt-2 text-xs text-stone-500">Record at least 10 characters{action === 'review' ? ' and complete all four checks to enable the review action.' : '.'}</p>
      <button type="button" className={`btn mt-4 ${action === 'withdraw' ? 'btn-secondary' : 'btn-primary'}`} disabled={busy || statement.trim().length < 10 || (action === 'review' && !Object.values(checks).every(Boolean))} onClick={() => void submit()}>{busy ? 'Saving…' : action === 'review' ? 'Mark review complete' : action === 'issue' ? 'Issue calculation report' : 'Withdraw report'}</button>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </>}
  </section>;
}
