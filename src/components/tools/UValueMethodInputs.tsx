import { additionalMethods, friendlyOption, methodFields, type AdditionalMethod } from '@/lib/u-value/methods';
import type { MethodDraft } from '@/lib/u-value/draft';

type Props = { method: AdditionalMethod; draft: MethodDraft; onChange: (draft: MethodDraft) => void };
const Input = ({ label, value, onChange, text = false }: { label: string; value: string; onChange: (value: string) => void; text?: boolean }) =>
  <label className="block min-w-0"><span className="label">{label}</span><input className="field min-h-11" type={text ? 'text' : 'number'} min={text ? undefined : 0} step={text ? undefined : 'any'} maxLength={text ? 600 : undefined} value={value} onChange={event => onChange(event.target.value)} /></label>;

export default function UValueMethodInputs({ method, draft, onChange }: Props) {
  const definition = additionalMethods[method];
  const patch = (values: Partial<MethodDraft>) => onChange({ ...draft, ...values });
  const fields = methodFields(method, draft.values);
  return <section className="panel rounded-xl p-5 sm:p-6" aria-label="Method inputs">
    <h2 className="text-base font-semibold">{definition.label}</h2><p className="mt-2 text-sm leading-relaxed text-stone-600">{definition.scope}</p>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">{fields.map(field => field.options
      ? <label key={field.key}><span className="label">{field.label}</span><select className="field min-h-11" value={draft.values[field.key] || ''} onChange={event => patch({ values: { ...draft.values, [field.key]: event.target.value } })}>{field.options.map(option => <option key={option} value={option}>{friendlyOption(option)}</option>)}</select></label>
      : <Input key={field.key} text={field.text} label={field.label} value={draft.values[field.key] || ''} onChange={value => patch({ values: { ...draft.values, [field.key]: value } })} />)}</div>
    {definition.family === 'opening' && <>
      <h3 className="mt-6 text-sm font-semibold">Projected components</h3><p className="mt-1 text-sm text-stone-600">Use whole-opening projected areas. Add each frame, glazing or panel area once.</p>
      {draft.components.map((component, index) => {
        const update = (values: Partial<typeof component>) => patch({ components: draft.components.map((c, i) => i === index ? { ...c, ...values } : c) });
        return <fieldset key={index} className="mt-4 rounded-lg border border-stone-200 p-4"><legend className="px-1 text-sm font-semibold">Component {index + 1}</legend><div className="grid gap-4 sm:grid-cols-2">
          <Input text label="Component name" value={component.name} onChange={name => update({ name })} /><label><span className="label">Component type</span><select className="field min-h-11" value={component.kind} onChange={event => update({ kind: event.target.value as typeof component.kind })}><option value="frame">Frame</option><option value="glazing">Glazing</option>{method === 'door' && <option value="panel">Opaque panel</option>}</select></label>
          <Input label="Projected component area (m²)" value={component.area} onChange={area => update({ area })} /><Input label="Component U-value (W/m²K)" value={component.u} onChange={u => update({ u })} /><div className="sm:col-span-2"><Input text label="Component value reference" value={component.source} onChange={source => update({ source })} /></div>
        </div><button type="button" className="btn btn-secondary mt-4" onClick={() => patch({ components: draft.components.filter((_, i) => i !== index) })}>Remove component {index + 1}</button></fieldset>;
      })}
      <button type="button" className="btn btn-secondary mt-4" disabled={draft.components.length >= 32} onClick={() => patch({ components: [...draft.components, { name: '', kind: draft.components.length ? method === 'door' ? 'panel' : 'glazing' : 'frame', area: '', u: '', source: '' }] })}>Add component</button>
      <h3 className="mt-6 text-sm font-semibold">Component edges</h3><p className="mt-1 text-sm text-stone-600">Include assessed glazing/panel edge effects where applicable. An empty edge list means zero edge contribution.</p>
      {draft.edges.map((edge, index) => {
        const update = (values: Partial<typeof edge>) => patch({ edges: draft.edges.map((e, i) => i === index ? { ...e, ...values } : e) });
        return <fieldset key={index} className="mt-4 rounded-lg border border-stone-200 p-4"><legend className="px-1 text-sm font-semibold">Edge {index + 1}</legend><div className="grid gap-4 sm:grid-cols-2"><Input text label="Edge name" value={edge.name} onChange={name => update({ name })} /><Input label="Edge length (m)" value={edge.length} onChange={length => update({ length })} /><Input label="Linear transmittance Ψ (W/mK)" value={edge.psi} onChange={psi => update({ psi })} /><Input text label="Edge value reference" value={edge.source} onChange={source => update({ source })} /></div><button type="button" className="btn btn-secondary mt-4" onClick={() => patch({ edges: draft.edges.filter((_, i) => i !== index) })}>Remove edge {index + 1}</button></fieldset>;
      })}
      <button type="button" className="btn btn-secondary mt-4" disabled={draft.edges.length >= 32} onClick={() => patch({ edges: [...draft.edges, { name: '', length: '', psi: '', source: '' }] })}>Add component edge</button>
    </>}
    {method === 'tapered_roof' && <>
      <h3 className="mt-6 text-sm font-semibold">Roof regions</h3>
      {draft.regions.map((region, index) => {
        const update = (values: Partial<typeof region>) => patch({ regions: draft.regions.map((r, i) => i === index ? { ...r, ...values } : r) });
        return <fieldset key={index} className="mt-4 rounded-lg border border-stone-200 p-4"><legend className="px-1 text-sm font-semibold">Region {index + 1}</legend><div className="grid gap-4 sm:grid-cols-2"><Input text label="Region name" value={region.name} onChange={name => update({ name })} /><label><span className="label">Region shape</span><select className="field min-h-11" value={region.shape} onChange={event => update({ shape: event.target.value as typeof region.shape })}><option value="rectangle">Rectangle · one-way taper</option><option value="triangle">Triangle · planar taper</option></select></label><Input label="Region area (m²)" value={region.area} onChange={area => update({ area })} /><Input label="First edge / vertex thickness (mm)" value={region.thickness1} onChange={thickness1 => update({ thickness1 })} /><Input label="Second edge / vertex thickness (mm)" value={region.thickness2} onChange={thickness2 => update({ thickness2 })} />{region.shape === 'triangle' && <Input label="Third vertex thickness (mm)" value={region.thickness3} onChange={thickness3 => update({ thickness3 })} />}</div><button type="button" className="btn btn-secondary mt-4" onClick={() => patch({ regions: draft.regions.filter((_, i) => i !== index) })}>Remove region {index + 1}</button></fieldset>;
      })}
      <button type="button" className="btn btn-secondary mt-4" disabled={draft.regions.length >= 32} onClick={() => patch({ regions: [...draft.regions, { name: '', shape: 'rectangle', area: '', thickness1: '', thickness2: '', thickness3: '' }] })}>Add roof region</button>
    </>}
    <label className="mt-5 block"><span className="label">Construction assessment / design-value reference</span><textarea className="field" rows={3} maxLength={600} value={draft.source} onChange={event => patch({ source: event.target.value })} placeholder="Drawing, build-up calculation, ground/wind data, certificates and applicable design conditions" /></label>
    <label className="mt-4 flex min-h-11 items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 shrink-0 accent-moss" type="checkbox" checked={draft.applicabilityConfirmed} onChange={event => patch({ applicabilityConfirmed: event.target.checked })} /><span>I have checked the method conditions above, the reference areas and the basis of all supplied values.</span></label>
  </section>;
}
