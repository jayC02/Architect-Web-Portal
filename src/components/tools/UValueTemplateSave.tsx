import { useState } from 'react';
export default function UValueTemplateSave({ id, title }: { id: string; title: string }) {
  const [name, setName] = useState(title), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/u-value/templates', { method: 'POST', credentials: 'same-origin', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calculationId: id, name }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save the construction template. Retry to save the same template.');
      setError(false); setMessage('Construction template saved. It is available in the calculator.');
    } catch (problem) { setError(true); setMessage(problem instanceof Error && problem.name !== 'AbortError' ? problem.message : 'The request timed out. Retry to save the same template.'); }
    finally { clearTimeout(timer); setBusy(false); }
  };
  return <section className="report-controls mx-auto mb-6 max-w-5xl rounded-xl border border-stone-200 bg-white p-5 sm:p-6"><h2 className="font-semibold">Reuse this construction</h2><p className="mt-2 text-sm text-stone-600">Save its inputs as a shared template. Project details and review status are set afresh when it is used.</p><div className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1"><span className="label">Construction template name</span><input className="field min-h-11" maxLength={160} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><button className="btn btn-secondary min-h-11" type="button" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save construction template'}</button></div>{message && <p role={error ? 'alert' : 'status'} className={`mt-3 text-sm ${error ? 'text-red-700' : 'text-moss'}`}>{message}</p>}</section>;
}
