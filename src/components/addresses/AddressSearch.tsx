import { useEffect, useRef, useState } from 'react';
import type { AddressCandidate, ResolvedAddress } from '@/server/services/address-provider.service';
export default function AddressSearch({ onSelect, editKey = '' }: { onSelect: (address: ResolvedAddress) => void; editKey?: string }) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<AddressCandidate[]>([]);
  const [message, setMessage] = useState('');
  const [resolving, setResolving] = useState(false);
  const current = useRef({ query, editKey }); current.current = { query, editKey };
  const resolution = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    resolution.current?.abort();
    setCandidates([]);
    if (query.trim().length < 3) return;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/addresses/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted || current.current.query !== query) return;
        if (!response.ok) { setMessage(result.error || 'Search unavailable. Enter the address below.'); return; }
        setCandidates(result.candidates); setMessage(result.candidates.length ? 'Choose the property to fill its address.' : 'No matching postal address. Enter it manually.');
      } catch { if (!controller.signal.aborted) setMessage('Search unavailable. Manual entry is available.'); }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  useEffect(() => () => resolution.current?.abort(), []);
  return <div className="mb-4 rounded-md border border-stone-200 bg-stone-50 p-3">
    <label className="block"><span className="label">Find address or postcode</span><input type="search" className="field" value={query} onChange={event => setQuery(event.target.value)} placeholder="Start typing an address or postcode" /></label>
    <p role="status" className="mt-2 text-xs text-stone-600">{message || 'You can also enter the address manually below.'}</p>
    {candidates.length > 0 && <ul className="mt-2 max-h-60 overflow-y-auto divide-y divide-stone-200">{candidates.map(candidate => <li key={candidate.id}><button type="button" disabled={resolving} className="w-full p-3 text-left text-sm hover:bg-white focus-visible:ring-2 focus-visible:ring-moss" onClick={async () => {
      resolution.current?.abort(); const controller = new AbortController(); resolution.current = controller;
      const original = { ...current.current }; setResolving(true);
      try {
        const response = await fetch('/api/addresses/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: candidate.id }), signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted || original.editKey !== current.current.editKey || original.query !== current.current.query) return;
        if (!response.ok) { setMessage(result.error || 'Address could not be resolved.'); return; }
        onSelect(result.address); setCandidates([]); setMessage('Postal address verified. Confirm the application authorities below.');
      } catch { if (!controller.signal.aborted) setMessage('Address resolution unavailable. Manual values have been kept.'); }
      finally { if (resolution.current === controller) setResolving(false); }
    }}>{candidate.label}</button></li>)}</ul>}
  </div>;
}
