import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api/http';

type Template = { id: string; name: string; version: number; currency: string; milestones: Array<{ id: string; label: string; amount: string; triggerEventType: string | null }> };
const starter = [
  { milestoneKey: 'appointment', label: 'On appointment', triggerEventType: 'PROJECT_CREATED', amount: '500', invoiceDescription: 'Architectural services — appointment' },
  { milestoneKey: 'planning-submission', label: 'Planning submission', triggerEventType: 'PLANNING_SUBMITTED', amount: '750', invoiceDescription: 'Architectural services — Planning submission' },
  { milestoneKey: 'planning-approval', label: 'Planning approval', triggerEventType: 'PLANNING_APPROVED', amount: '750', invoiceDescription: 'Architectural services — Planning approval' },
  { milestoneKey: 'warrant-submission', label: 'Building Warrant submission', triggerEventType: 'BUILDING_WARRANT_SUBMITTED', amount: '1000', invoiceDescription: 'Architectural services — Building Warrant submission' },
];

export default function FeePlanTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('Standard architectural fee plan');
  const [amounts, setAmounts] = useState(starter.map((milestone) => milestone.amount));
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => setTemplates((await apiRequest<{ templates: Template[] }>('/api/finance/fee-plan-templates')).templates), []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setSaving(true); setStatus('');
    try {
      await apiRequest('/api/finance/fee-plan-templates', { method: 'POST', body: JSON.stringify({
        name,
        currency: 'GBP',
        milestones: starter.map((milestone, index) => ({ ...milestone, amount: amounts[index], enabled: true, accountCode: null, taxType: null, dueDays: null })),
      }) });
      setStatus('Reusable fee plan template saved.');
      await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save template.'); }
    finally { setSaving(false); }
  };
  return <section className="panel mt-6 overflow-hidden rounded-lg">
    <div className="border-b border-stone-200 px-5 py-4"><h2 className="text-xl font-semibold">Fee plan templates</h2><p className="mt-1 text-sm text-stone-500">Reusable starting points. Assigning one copies a versioned snapshot onto the project.</p></div>
    {templates.length > 0 && <div className="divide-y divide-stone-100">{templates.map((template) => <article key={template.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="font-semibold">{template.name} · v{template.version}</p><p className="mt-1 text-xs text-stone-500">{template.milestones.length} milestones · {template.currency}</p></div></article>)}</div>}
    <div className="border-t border-stone-200 bg-stone-50/60 p-5"><h3 className="font-semibold">Create a four-stage template</h3><label className="mt-3 block"><span className="label">Template name</span><input className="field max-w-lg" value={name} onChange={(event) => setName(event.target.value)} /></label><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{starter.map((milestone, index) => <label key={milestone.milestoneKey}><span className="label">{milestone.label} (GBP)</span><input className="field" type="number" min="0.01" step="0.01" value={amounts[index]} onChange={(event) => setAmounts((current) => current.map((value, amountIndex) => amountIndex === index ? event.target.value : value))} /></label>)}</div><div className="mt-4 flex flex-wrap items-center gap-3"><button className="btn btn-primary" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save fee plan template'}</button>{status && <span className="text-sm text-stone-600" role="status">{status}</span>}</div></div>
  </section>;
}
