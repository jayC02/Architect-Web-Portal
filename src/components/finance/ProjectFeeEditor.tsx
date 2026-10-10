import { useEffect, useState } from 'react';
import EditDrawer from '@/components/ui/EditDrawer';
type Milestone = { milestoneKey: string; label: string; amount: string; currency: string; triggerEventType: string | null; invoiceDescription: string; enabled: boolean; accountCode: string | null; taxType: string | null; dueDays: number | null; percentage: string | null; state: string };
type Agreement = { agreedAmount: string | null; currency: string; vatTreatment: string; vatRate: string | null; revision: number; notes: string | null; milestones: Milestone[] };
export default function ProjectFeeEditor({ projectId, agreement, templates }: { projectId: string; agreement: Agreement | null; templates: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [amount, setAmount] = useState(agreement?.agreedAmount ?? '');
  const [currency, setCurrency] = useState(agreement?.currency ?? 'GBP');
  const [vat, setVat] = useState(agreement?.vatTreatment ?? '');
  const [rate, setRate] = useState(agreement?.vatRate ?? '');
  const [notes, setNotes] = useState(agreement?.notes ?? '');
  const [schedule, setSchedule] = useState<'keep' | 'percent' | 'fixed' | 'template'>('keep');
  const [templateId, setTemplate] = useState('');
  const [rows, setRows] = useState(agreement?.milestones.filter(row => row.enabled && row.state !== 'WAIVED') ?? []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const defaults = () => [25, 50, 25].map((percent, index) => ({ milestoneKey: `stage-${index + 1}`, label: ['Appointment', 'Application', 'Completion'][index], amount: '0.01', percentage: String(percent), currency, triggerEventType: null, invoiceDescription: ['Appointment fee', 'Application fee', 'Completion fee'][index], enabled: true, accountCode: null, taxType: null, dueDays: null, state: 'PENDING' }));
  return <><button type="button" disabled={!hydrated} className="btn btn-secondary" onClick={() => setOpen(true)}>{agreement?.agreedAmount ? 'Edit project fee' : 'Add project fee'}</button>
    {open && <EditDrawer title={agreement?.agreedAmount ? 'Edit project fee' : 'Add project fee'} description="Record the agreed professional fee. Planning and building warrant application fees are separate." onClose={() => setOpen(false)}>
      <form data-action={`/api/finance/projects/${projectId}/fee-plan`} className="grid gap-4" onSubmit={async event => {
        event.preventDefault(); setSaving(true); setError('');
        const payload: Record<string, unknown> = { agreedAmount: amount, currency, vatTreatment: vat, ...(vat === 'STANDARD' ? { vatRate: rate } : {}), notes, ...(agreement ? { revision: agreement.revision } : {}) };
        if (schedule === 'template') payload.templateId = templateId;
        if (schedule === 'percent' || schedule === 'fixed') {
          // Keep protected/historical rows in the submitted schedule so the server
          // can preserve their identities rather than silently replacing them.
          const history = agreement?.milestones.filter(row => !rows.some(next => next.milestoneKey === row.milestoneKey)) ?? [];
          payload.milestones = [...rows, ...history].map(({ currency: _currency, state: _state, percentage, ...row }) => ({ ...row, ...(schedule === 'percent' ? { percentage: percentage ?? '0' } : {}) }));
        }
        try {
          const response = await fetch(`/api/finance/projects/${projectId}/fee-plan`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'The fee could not be saved.');
          window.dispatchEvent(new CustomEvent('portal:mutation-success', { detail: { action: `/api/finance/projects/${projectId}/fee-plan` } }));
          window.location.reload();
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Save failed. Your values have been kept.'); }
        finally { setSaving(false); }
      }}>
        <label><span className="label">Agreed fee, excluding VAT</span><input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} className="field" placeholder="5000.00" /></label>
        <label><span className="label">Currency</span><input required maxLength={3} value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} className="field" /></label>
        <label><span className="label">VAT treatment</span><select required value={vat} onChange={event => setVat(event.target.value)} className="field"><option value="">Choose VAT treatment</option><option value="STANDARD">Standard rated</option><option value="ZERO">Zero rated</option><option value="EXEMPT">Exempt</option><option value="NOT_REGISTERED">Not VAT registered</option>{agreement?.vatTreatment === 'LEGACY_UNKNOWN' && <option value="LEGACY_UNKNOWN">Historical VAT unknown</option>}</select></label>
        {vat === 'STANDARD' && <label><span className="label">VAT rate (%)</span><input required inputMode="decimal" value={rate} onChange={event => setRate(event.target.value)} className="field" /></label>}
        <details className="rounded-md border border-stone-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Optional billing schedule and notes</summary>
          <p className="mt-3 text-sm text-stone-600">Changing the agreement keeps the existing schedule. Reconcile it before creating invoices.</p>
          <label className="mt-3 block"><span className="label">Billing schedule</span><select className="field" value={schedule} onChange={event => {
            const next = event.target.value as typeof schedule; setSchedule(next);
            if ((next === 'percent' || next === 'fixed') && !rows.length) setRows(defaults());
          }}><option value="keep">{agreement?.milestones.length ? 'Keep existing milestones' : 'No milestones'}</option><option value="percent">Percentage milestones</option><option value="fixed">Fixed amounts</option><option value="template">Use a template</option></select></label>
          {schedule === 'template' && <label className="mt-3 block"><span className="label">Template</span><select className="field" value={templateId} onChange={event => setTemplate(event.target.value)} required><option value="">Choose template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>}
          {(schedule === 'percent' || schedule === 'fixed') && <div className="mt-3 space-y-3">{rows.map((row, index) => <div key={row.milestoneKey} className="rounded border border-stone-200 p-3"><label><span className="label">Milestone {index + 1}</span><input value={row.label} required className="field" onChange={event => setRows(current => current.map((item, at) => at === index ? { ...item, label: event.target.value, invoiceDescription: event.target.value } : item))} /></label><label className="mt-2 block"><span className="label">{schedule === 'percent' ? 'Percentage of agreed fee' : 'Net amount'}</span><input required inputMode="decimal" value={schedule === 'percent' ? row.percentage ?? '' : row.amount} className="field" onChange={event => setRows(current => current.map((item, at) => at === index ? { ...item, [schedule === 'percent' ? 'percentage' : 'amount']: event.target.value } : item))} /></label></div>)}<button type="button" className="text-sm font-semibold text-moss" onClick={() => setRows(current => [...current, { ...defaults()[0], milestoneKey: `stage-${crypto.randomUUID()}`, label: 'Additional stage', percentage: '', amount: '' }])}>Add milestone</button></div>}
          <label className="mt-3 block"><span className="label">Agreement notes</span><textarea className="field" value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} /></label>
        </details>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save project fee'}</button>
      </form>
    </EditDrawer>}
  </>;
}
