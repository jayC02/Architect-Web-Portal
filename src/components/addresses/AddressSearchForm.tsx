import { useEffect, useRef, useState } from 'react';
import AddressSearch from './AddressSearch';

/** Bridges the shared address chooser into existing Astro and directory forms. */
export default function AddressSearchForm() {
  const root = useRef<HTMLDivElement>(null);
  const [editKey, setEditKey] = useState('');
  useEffect(() => {
    const form = root.current?.closest('form');
    const changed = () => setEditKey(JSON.stringify(Array.from(form?.querySelectorAll<HTMLInputElement>('input[name]:not([type=hidden])') ?? []).map(input => [input.name, input.value])));
    form?.addEventListener('input', changed);
    return () => form?.removeEventListener('input', changed);
  }, []);
  return <div ref={root}><AddressSearch editKey={editKey} onSelect={address => {
    const form = root.current?.closest('form');
    if (!form) return;
    for (const [name, value] of Object.entries(address)) {
      if (name === 'country') continue;
      let input = form.elements.namedItem(name) as HTMLInputElement | null;
      if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = name; form.append(input); }
      input.value = typeof value === 'object' && value ? JSON.stringify(value) : String(value ?? '');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }} /></div>;
}
