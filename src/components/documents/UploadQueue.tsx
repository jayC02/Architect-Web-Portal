import { useEffect, useRef, useState } from 'react';
import { runUploadQueue } from '@/lib/application-upload-queue';
import { uploadDocument, type TransferProgress } from '@/lib/document-upload-controller';

type Entry = TransferProgress & { key: string; file: File; controller?: AbortController };
export default function UploadQueue({ baseUrl, pdfOnly = false, maxFiles = 50, onComplete }: {
  baseUrl: string; pdfOnly?: boolean; maxFiles?: number; onComplete?: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [recoverable, setRecoverable] = useState<Array<{ id: string; originalFilename: string; sizeBytes: number }>>([]);
  const live = useRef(entries);
  live.current = entries;
  const recover = async () => {
    try { const response = await fetch(`${baseUrl}/upload-intent`); if (response.ok) setRecoverable((await response.json()).documents ?? []); }
    catch { setError('Upload records could not be refreshed. Reselecting the same files still reuses their reserved uploads.'); }
  };
  useEffect(() => { void recover(); }, [baseUrl]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!live.current.some(entry => !['Ready', 'Cancelled'].includes(entry.state))) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); live.current.forEach(entry => entry.controller?.abort()); };
  }, []);
  const update = (key: string, values: Partial<Entry>) => setEntries(current => current.map(entry => entry.key === key ? { ...entry, ...values } : entry));
  const start = async (entry: Entry) => {
    if (['Ready', 'Uploading', 'Verifying'].includes(entry.state)) return;
    const controller = new AbortController();
    update(entry.key, { controller, state: 'Waiting' });
    try { await uploadDocument(entry.file, baseUrl, { signal: controller.signal, onProgress: progress => {
      update(entry.key, progress);
      if (controller.signal.aborted && progress.documentId) void fetch(`${baseUrl}/${progress.documentId}`, { method: 'DELETE' }).then(response => { if (!response.ok) setError('Retry server removal to confirm cancellation.'); });
    } }); }
    catch { /* Per-file recovery is visible; successful files stay in the queue. */ }
  };
  const cancel = async (entry: Entry) => {
    entry.controller?.abort();
    update(entry.key, { state: 'Cancelled' });
    if (!entry.documentId) return;
    const response = await fetch(`${baseUrl}/${entry.documentId}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!response.ok) setError('The local transfer stopped. Server cancellation could not be confirmed; retry removal before leaving.');
  };
  return <div className="space-y-4">
    <label className="block"><span className="label">Files</span><input type="file" multiple accept={pdfOnly ? 'application/pdf,.pdf' : undefined} disabled={working}
      onChange={event => {
        const files = Array.from(event.target.files ?? []);
        if (files.length + entries.filter(entry => entry.state !== 'Cancelled').length > maxFiles + recoverable.length || files.some(file => file.size > 25 * 1024 * 1024 || !file.size || (pdfOnly && !file.name.toLowerCase().endsWith('.pdf')))) { setError(`Choose up to ${maxFiles} new ${pdfOnly ? 'PDFs' : 'documents'}, at most 25 MB each; unfinished files can be reselected.`); return; }
        setError(''); setEntries(current => [...current, ...files.map(file => ({ key: crypto.randomUUID(), file, state: 'Waiting' as const, bytes: 0, total: file.size }))]); event.target.value = '';
      }} className="field" /></label>
    <p className="text-xs text-stone-600">Completed files are kept. After refreshing, reselect unfinished files to resume. Local files stay available only while this page is open.</p>
    {recoverable.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold">Unfinished uploads found</p><ul className="mt-2 space-y-2">{recoverable.map(record => <li key={record.id} className="flex flex-wrap justify-between gap-2 text-sm"><span>{record.originalFilename} · reselect the matching file to resume</span><button type="button" className="font-semibold text-moss" onClick={async () => { const response = await fetch(`${baseUrl}/${record.id}`, { method: 'DELETE' }); if (response.ok) await recover(); else setError('Removal could not be confirmed. Retry when connected.'); }}>Remove unfinished upload</button></li>)}</ul></div>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    <ul className="divide-y divide-stone-200" aria-live="polite">{entries.map(entry => <li key={entry.key} className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all text-sm font-semibold">{entry.file.name}</span><span className="text-xs text-stone-600">{entry.state}</span></div>
      <progress className="mt-2 h-2 w-full accent-[#556b4d]" max={entry.total} value={entry.bytes} aria-label={`Transfer progress for ${entry.file.name}`} />
      {entry.message && <p className="mt-1 text-sm text-stone-700">{entry.message}</p>}
      <div className="mt-2 flex gap-3">{['Failed', 'Action required'].includes(entry.state) && <button type="button" disabled={working} className="text-sm font-semibold text-moss" onClick={async () => { setWorking(true); await start(entry); setWorking(false); await recover(); onComplete?.(); }}>Retry {entry.file.name}</button>}
      {!['Ready', 'Cancelled'].includes(entry.state) && <button type="button" className="text-sm font-semibold text-stone-600" onClick={() => void cancel(entry)}>Cancel {entry.file.name}</button>}
      {['Ready', 'Cancelled'].includes(entry.state) && <button type="button" className="text-sm text-stone-600" onClick={() => setEntries(current => current.filter(item => item.key !== entry.key))}>Remove from queue</button>}</div>
    </li>)}</ul>
    <button type="button" className="btn btn-primary" disabled={working || !entries.some(entry => ['Waiting', 'Failed', 'Action required'].includes(entry.state))} onClick={async () => {
      setWorking(true); await runUploadQueue(entries.filter(entry => !['Ready', 'Cancelled'].includes(entry.state)), 3, start); setWorking(false); await recover(); onComplete?.();
    }}>{working ? 'Uploading documents…' : 'Upload documents'}</button>
  </div>;
}
