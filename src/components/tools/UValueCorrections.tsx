import { Plus } from 'lucide-react';
import { newAutomaticCorrection, type AutomaticCorrectionDraft, type CalculationDraft } from '@/lib/u-value/draft';

type Props = {
  draft: CalculationDraft;
  onCalculatedChange: (items: AutomaticCorrectionDraft[]) => void;
  onAssessedChange: (items: CalculationDraft['corrections']) => void;
};
export default function UValueCorrections({ draft, onCalculatedChange, onAssessedChange }: Props) {
  const targets = draft.layers.filter(layer => layer.kind === 'solid');
  const update = (id: string, changes: Partial<AutomaticCorrectionDraft>) => onCalculatedChange(draft.automaticCorrections.map(item => item.id === id ? { ...item, ...changes } : item));
  const add = (kind: AutomaticCorrectionDraft['kind']) => onCalculatedChange([...draft.automaticCorrections, newAutomaticCorrection(crypto.randomUUID(), kind, targets[0]?.id)]);
  return <details className="panel rounded-xl p-5 sm:p-6">
    <summary className="cursor-pointer text-base font-semibold">U-value corrections</summary>
    <p className="mt-3 text-sm text-stone-600">Calculate air-gap and discrete-fixing corrections, or enter a separately assessed ΔU. Avoid counting the same heat loss twice. All corrections are included, even when their sum is below 3%.</p>
    {draft.automaticCorrections.map((item, index) => <section key={item.id} className="mt-5 border-t border-stone-200 pt-5" aria-label={`Calculated correction ${index + 1}`}>
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{item.kind === 'airgap' ? 'Air gaps' : 'Discrete fixings'}</h3><button type="button" className="btn btn-secondary min-h-11" onClick={() => onCalculatedChange(draft.automaticCorrections.filter(row => row.id !== item.id))}>Remove correction</button></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label><span className="label">Insulation layer</span><select className="field min-h-11" value={item.layerId} onChange={event => update(item.id, { layerId: event.target.value })}><option value="">Select an insulation layer</option>{targets.map(layer => <option key={layer.id} value={layer.id}>{layer.name || 'Unnamed material'}</option>)}</select></label>
        {item.kind === 'airgap' ? <label><span className="label">Air-gap correction level</span><select className="field min-h-11" value={item.level} onChange={event => update(item.id, { level: event.target.value as AutomaticCorrectionDraft['level'] })}><option value="0">0 · no significant air gaps</option><option value="1">1 · through gaps without air circulation</option><option value="2">2 · through gaps with air circulation</option></select></label> : <>
          {([
            ['conductivity', 'Fixing conductivity λf (W/mK)'], ['diameter', 'Metal fixing diameter (mm)'], ['count', 'Number of fixings per m²'],
          ] as const).map(([key, label]) => <label key={key}><span className="label">{label}</span><input type="number" min="0" step="any" className="field min-h-11" value={item[key]} onChange={event => update(item.id, { [key]: event.target.value })} /></label>)}
          <label><span className="label">Metal penetration</span><select className="field min-h-11" value={item.penetration} onChange={event => update(item.id, { penetration: event.target.value as AutomaticCorrectionDraft['penetration'] })}><option value="full">Full insulation depth</option><option value="recessed">Recessed fixing</option></select></label>
          {item.penetration === 'recessed' && <label><span className="label">Metal penetration depth (mm)</span><input type="number" min="0" step="any" className="field min-h-11" value={item.penetrationDepth} onChange={event => update(item.id, { penetrationDepth: event.target.value })} /></label>}
          <label className="flex items-start gap-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-moss" checked={item.applicabilityConfirmed} onChange={event => update(item.id, { applicabilityConfirmed: event.target.checked })} /><span>These are perpendicular, round discrete fixings through the selected insulation, are not already included in its framing, and do not connect metal sheets at both ends.</span></label>
          <p className="text-xs text-stone-600 sm:col-span-2">For composite fixings, angled screws, brackets or rails, use a separately assessed correction. In a bridged construction, the calculation uses the path through the main insulation material.</p>
        </>}
        <label className="sm:col-span-2"><span className="label">Correction basis / product reference</span><textarea rows={2} className="field" maxLength={600} value={item.source} onChange={event => update(item.id, { source: event.target.value })} /></label>
      </div>
    </section>)}
    {draft.corrections.map((item, index) => <section key={item.id} className="mt-5 grid gap-4 border-t border-stone-200 pt-5 sm:grid-cols-2" aria-label={`Assessed correction ${index + 1}`}>
      <label><span className="label">Correction name</span><input className="field min-h-11" maxLength={120} value={item.name} onChange={event => onAssessedChange(draft.corrections.map((row, i) => i === index ? { ...row, name: event.target.value } : row))} /></label>
      <label><span className="label">Assessed ΔU (W/m²K)</span><input type="number" min="0" step="any" className="field min-h-11" value={item.value} onChange={event => onAssessedChange(draft.corrections.map((row, i) => i === index ? { ...row, value: event.target.value } : row))} /></label>
      <label><span className="label">Correction reference</span><input className="field min-h-11" maxLength={600} value={item.source} onChange={event => onAssessedChange(draft.corrections.map((row, i) => i === index ? { ...row, source: event.target.value } : row))} /></label>
      <button type="button" className="btn btn-secondary self-end" onClick={() => onAssessedChange(draft.corrections.filter((_, i) => i !== index))}>Remove correction</button>
    </section>)}
    <div className="mt-5 flex flex-wrap gap-3"><button type="button" className="btn btn-secondary min-h-11 gap-2" disabled={!targets.length || draft.automaticCorrections.length >= 12} onClick={() => add('airgap')}><Plus size={16} />Add air-gap correction</button><button type="button" className="btn btn-secondary min-h-11 gap-2" disabled={!targets.length || draft.automaticCorrections.length >= 12} onClick={() => add('fastener')}><Plus size={16} />Add fixing correction</button><button type="button" className="btn btn-secondary min-h-11 gap-2" disabled={draft.corrections.length >= 12} onClick={() => onAssessedChange([...draft.corrections, { id: crypto.randomUUID(), name: '', value: '', source: '' }])}><Plus size={16} />Add assessed ΔU</button></div>
    {!targets.length && <p className="mt-3 text-xs text-stone-500">Add an insulation material layer to calculate air-gap or fixing corrections.</p>}
  </details>;
}
