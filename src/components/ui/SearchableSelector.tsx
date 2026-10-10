import { useEffect, useId, useState } from 'react';
type Option = { value: string; label: string; reason?: string };
export default function SearchableSelector({ label, options, value, onChange, emptyLabel = 'Choose a record', clientSearch = false }: {
  label: string; options: Option[]; value: string; onChange: (value: string) => void; emptyLabel?: string; clientSearch?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [directory, setDirectory] = useState<Option[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!clientSearch) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/clients?q=${encodeURIComponent(search)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (controller.signal.aborted) return;
        setDirectory(current => [...current.filter(option => option.value === value), ...data.clients.map((client: { id: string; name: string; email?: string }) => ({ value: client.id, label: [client.name, client.email].filter(Boolean).join(' · '), reason: 'Organisation directory record; confirm that this is the correct client.' }))]);
        setError('');
      } catch { if (!controller.signal.aborted) setError('Directory search unavailable. Prepared suggestions are still available.'); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, clientSearch, value]);
  const id = useId();
  const all = [...new Map([...directory, ...options].map(option => [option.value, option])).values()];
  const selected = all.find(option => option.value === value);
  const filtered = all.filter(option => option.value === value || `${option.label} ${option.reason ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-2"><label htmlFor={`${id}-search`} className="label">Search {label.toLowerCase()}</label>
    <input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} className="field" placeholder="Search by name or reference" />
    <label htmlFor={id} className="label">{label}</label><select id={id} value={value} onChange={event => onChange(event.target.value)} className="field">
      <option value="">{emptyLabel}</option>{filtered.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>{selected?.reason && <p className="text-xs text-stone-600">{selected.reason}</p>}
    {!filtered.length && <p role="status" className="text-sm text-stone-600">No matching records.</p>}
    {error && <p role="status" className="text-sm text-stone-600">{error}</p>}
  </div>;
}
