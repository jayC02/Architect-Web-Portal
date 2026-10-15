import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, FileText, LoaderCircle, Plus, Layers3, RotateCcw } from 'lucide-react';
import { calculateUValue, elementLabels, heatFlowLabels, ThermalCalculationError, uValueInputSchema, type UValueInput } from '@/lib/u-value/calculator';
import { thermalMaterials, materialLambda } from '@/lib/u-value/materials';
import { draftInputs, emptyCalculation, emptyMethodDraft, newLayer, parseStoredDraft, restoredDraft, type CalculationDraft, type LayerDraft } from '@/lib/u-value/draft';
import UValueCorrections from './UValueCorrections';
import UValueMethodInputs from './UValueMethodInputs';
import { isAdditionalMethod } from '@/lib/u-value/methods';

type Project = { id: string; name: string; internalReference: string | null; siteAddress: string | null };
type Saved = { id: string; title: string; createdAt: string; projectId: string | null };
type Props = { projects: Project[]; storageKey: string; initial?: CalculationDraft; initialSaved?: Saved[]; templates?: { id: string; name: string }[] };
const n = (value: number, digits = 3) => value.toFixed(digits);
const Field = ({ label, id, ...props }: { label: string; id: string } & InputHTMLAttributes<HTMLInputElement>) =>
  <label className="block min-w-0" htmlFor={id}><span className="label">{label}</span><input id={id} className="field min-h-11" {...props} /></label>;
const invalidInputMessage = (problem: unknown) => {
  if (problem instanceof ThermalCalculationError) return problem.message;
  if (!problem || typeof problem !== 'object' || !('issues' in problem)) return 'Check the construction inputs.';
  const issue = (problem as { issues: { message: string; code: string; path: (string | number)[] }[] }).issues[0];
  if (!issue) return 'Check the construction inputs.';
  const prefix = issue.path[0] === 'layers' && typeof issue.path[1] === 'number' ? `Layer ${issue.path[1] + 1}: `
    : issue.path[0] === 'automaticCorrections' && typeof issue.path[1] === 'number' ? `Correction ${issue.path[1] + 1}: ` : '';
  const fieldLabels: Record<string, string> = { thicknessMm: 'thickness', lambda: 'conductivity', resistance: 'resistance',
    widthMm: 'cavity width', heightMm: 'cavity height / length', emissivity1: 'first surface emissivity', emissivity2: 'second surface emissivity',
    conductivity: 'fixing conductivity', diameterMm: 'fixing diameter', countPerM2: 'number of fixings', penetrationMm: 'metal penetration depth',
    area: 'floor area', perimeter: 'exposed perimeter', soilLambda: 'soil conductivity', openings: 'ventilation opening area', target: 'target U-value' };
  const field = fieldLabels[String(issue.path.at(-1))] || 'this input';
  return prefix + (issue.code === 'invalid_type' ? `Enter a valid value for ${field}.` : issue.message);
};
async function calculationRequest(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The request could not be completed. Your working inputs have been kept.');
    return data;
  } catch (problem) {
    if (problem instanceof Error && problem.name === 'AbortError') throw new Error('The request timed out. Please try again; your working inputs have been kept.');
    throw problem;
  } finally { clearTimeout(timer); }
}

export default function UValueCalculator({ projects, storageKey, initial, initialSaved = [], templates = [] }: Props) {
  const [draft, setDraft] = useState<CalculationDraft>(initial || emptyCalculation);
  const [saved, setSaved] = useState(initialSaved);
  const [selectedSaved, setSelectedSaved] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [busy, setBusy] = useState<'save' | 'load' | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const generation = useRef(0);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    if (!initial) try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
      const validDraft = stored?.version === 1 ? parseStoredDraft(stored.draft) : null;
      if (validDraft) setDraft(validDraft);
    } catch { /* A missing or blocked local draft never stops calculation. */ }
    setHydrated(true);
  }, [storageKey, initial]);
  useEffect(() => {
    if (!hydrated) return;
    const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, draft })); } catch { /* Server saves remain available. */ } };
    const timer = setTimeout(persist, 300);
    window.addEventListener('pagehide', persist);
    return () => { clearTimeout(timer); window.removeEventListener('pagehide', persist); };
  }, [draft, storageKey, hydrated]);
  const change = (update: (previous: CalculationDraft) => CalculationDraft) => {
    generation.current++; requestId.current = null; setNotice(''); setError(''); setDraft(update);
  };
  const patch = <K extends keyof CalculationDraft>(key: K, value: CalculationDraft[K]) => change(previous => ({ ...previous, [key]: value }));
  const layerPatch = (id: string, values: Partial<LayerDraft>) => change(previous => ({ ...previous,
    layers: previous.layers.map(layer => layer.id === id ? { ...layer, ...values } : layer),
  }));
  const result = useMemo(() => {
    try { return { value: calculateUValue(draftInputs(draft)), message: '' }; }
    catch (problem) { return { value: null, message: invalidInputMessage(problem) }; }
  }, [draft]);
  const addLayer = (kind: LayerDraft['kind'] = 'solid') => change(previous => ({ ...previous,
    layers: [...previous.layers, newLayer(crypto.randomUUID(), kind)],
  }));
  const move = (index: number, direction: number) => change(previous => {
    const layers = [...previous.layers]; [layers[index], layers[index + direction]] = [layers[index + direction], layers[index]];
    return { ...previous, layers };
  });
  const chooseProduct = (layer: LayerDraft, id: string) => {
    const product = thermalMaterials.find(item => item.id === id);
    layerPatch(layer.id, product ? { productId: id, name: product.name, thickness: String(product.thickness),
      lambda: String(product.lambda), source: `${product.source} ${product.url}` } : { productId: '' });
  };
  const loadSaved = async () => {
    if (!selectedSaved || busy) return;
    if ((draft.layers.length || draft.methodData.source) && !window.confirm('Replace the current working calculation with a copy of the saved calculation?')) return;
    setBusy('load'); setError(''); const loadGeneration = generation.current;
    try {
      const data = await calculationRequest(`/api/u-value/${encodeURIComponent(selectedSaved)}`);
      if (generation.current !== loadGeneration) { setNotice('Your newer edits have been kept. Load the saved copy again when you are ready.'); return; }
      const item = data.calculation;
      const input = uValueInputSchema.parse(item.inputSnapshot);
      change(() => restoredDraft(input, { title: item.title, projectId: item.projectId || '',
        reference: item.contextSnapshot.reference || '', location: item.contextSnapshot.location || '' }));
      setNotice('Loaded a working copy. The saved report stays unchanged.');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not load this calculation.'); }
    finally { setBusy(''); }
  };
  const loadTemplate = async () => {
    if (!selectedTemplate || busy) return;
    if ((draft.layers.length || draft.methodData.source) && !window.confirm('Replace the current working inputs with this construction template?')) return;
    const version = generation.current; setBusy('load'); setError('');
    try {
      const { template } = await calculationRequest(`/api/u-value/templates/${encodeURIComponent(selectedTemplate)}`);
      if (generation.current !== version) { setNotice('Your newer edits have been kept. Load the template again when ready.'); return; }
      change(() => restoredDraft(template.inputSnapshot, { title: template.name }));
      setNotice('Construction template loaded. Select the project and check its applicability before saving.');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not load this construction template.'); }
    finally { setBusy(''); }
  };
  const save = async () => {
    if (busy || !result.value) return;
    setError(''); setNotice('');
    if (!draft.title.trim()) { setError('Give the calculation a name before creating the report.'); document.getElementById('calculation-title')?.focus(); return; }
    if (result.value.missingSources.length) { setError('Add a design-value reference for every included material and bridge before creating the report.'); return; }
    if (!draft.correctionsAssessed) { setError('Confirm that applicable corrections have been assessed before creating the report.'); return; }
    setBusy('save'); const saveGeneration = generation.current;
    requestId.current ||= crypto.randomUUID();
    try {
      const data = await calculationRequest('/api/u-value', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: requestId.current, title: draft.title, projectId: draft.projectId || null,
          reference: draft.reference, location: draft.location, basedOnId: draft.basedOnId, inputs: draftInputs(draft) }),
      });
      setSaved(previous => [data.calculation, ...previous.filter(item => item.id !== data.calculation.id)].slice(0, 100));
      if (generation.current !== saveGeneration) {
        setNotice('The previous inputs were saved. Your newer edits are still a working draft.'); return;
      }
      try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, draft })); } catch { /* The server snapshot has already been saved. */ }
      window.location.assign(data.reportUrl);
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not save the calculation. Your inputs have been kept.'); }
    finally { setBusy(''); }
  };
  const reset = () => {
    if ((draft.layers.length || draft.methodData.source) && !window.confirm('Start a new calculation? Saved reports will be kept.')) return;
    change(() => emptyCalculation()); setSelectedSaved(''); setSelectedTemplate('');
  };
  const totalThickness = draft.layers.reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);
  const calc = result.value;
  const additional = isAdditionalMethod(draft.element);
  if (!hydrated) return <div className="flex items-center gap-3 py-10 text-sm text-stone-600" role="status"><LoaderCircle size={18} className="animate-spin" />Loading calculation…</div>;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-moss">Design tools</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">U-value calculator</h1><p className="mt-2 text-sm text-stone-600">Build a construction, check its thermal performance and create a calculation report.</p></div>
      <button type="button" className="btn btn-secondary gap-2" onClick={reset} disabled={Boolean(busy)}><RotateCcw size={16} />New calculation</button>
    </header>
    {draft.basedOnId && <div className="rounded-lg border border-moss/30 bg-moss/5 p-4 text-sm">Creating a revision of a saved report. <a className="font-semibold underline" href={`/tools/u-value/reports/${draft.basedOnId}`}>View previous report</a>. Earlier inputs and review records will be retained.</div>}
    {saved.length > 0 && <section className="panel rounded-xl p-4" aria-label="Saved calculations">
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1"><span className="label">Saved calculations</span><select className="field min-h-11" value={selectedSaved} onChange={event => setSelectedSaved(event.target.value)}><option value="">Select a saved calculation</option>{saved.map(item => <option key={item.id} value={item.id}>{item.title} · {new Date(item.createdAt).toLocaleDateString('en-GB')}</option>)}</select></label>
        <button className="btn btn-secondary min-h-11 gap-2" type="button" disabled={!selectedSaved || Boolean(busy)} onClick={() => void loadSaved()}>{busy === 'load' && <LoaderCircle size={16} className="animate-spin" />}Load copy</button>
        {selectedSaved && <a className="btn btn-secondary min-h-11" href={`/tools/u-value/reports/${selectedSaved}`}>View saved report</a>}
      </div>
    </section>}
    {templates.length > 0 && <section className="panel rounded-xl p-4" aria-label="Construction templates"><div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1"><span className="label">Construction templates</span><select className="field min-h-11" value={selectedTemplate} onChange={event => setSelectedTemplate(event.target.value)}><option value="">Select a practice construction</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><button type="button" className="btn btn-secondary min-h-11" disabled={!selectedTemplate || Boolean(busy)} onClick={() => void loadTemplate()}>Use construction template</button></div></section>}
    {draft.projectId && <a className="btn btn-secondary" href={`/tools/u-value/projects/${encodeURIComponent(draft.projectId)}`}>Open project U-value schedule</a>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <section className="panel rounded-xl p-5 sm:p-6" aria-labelledby="details-heading">
          <h2 id="details-heading" className="text-base font-semibold">Calculation details</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Calculation name" id="calculation-title" value={draft.title} placeholder="External wall · W01" onChange={event => patch('title', event.target.value)} maxLength={160} />
            <label><span className="label">Project · optional</span><select className="field min-h-11" disabled={Boolean(draft.basedOnId)} value={draft.projectId} onChange={event => {
              const project = projects.find(item => item.id === event.target.value);
              change(previous => ({ ...previous, projectId: event.target.value, reference: project?.internalReference || previous.reference, location: project?.siteAddress || previous.location }));
            }}><option value="">Standalone calculation</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <Field label="Drawing / element reference" id="element-reference" value={draft.reference} onChange={event => patch('reference', event.target.value)} maxLength={120} />
            <Field label="Site address / location" id="calculation-location" value={draft.location} onChange={event => patch('location', event.target.value)} maxLength={400} />
            <label><span className="label">Building element</span><select className="field min-h-11" value={draft.element} onChange={event => { const element = event.target.value as UValueInput['element']; change(previous => ({ ...previous, element, correctionsAssessed: false, methodData: emptyMethodDraft(isAdditionalMethod(element) ? element : undefined) })); }}>{Object.entries(elementLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            {!additional && <>
            <label><span className="label">Construction system</span><select className="field min-h-11" value={draft.construction} onChange={event => patch('construction', event.target.value as UValueInput['construction'])}><option value="standard">Solid, masonry or timber construction</option><option value="steel-frame">Steel framing</option><option value="inverted-roof">Inverted roof</option><option value="specialist">Other specialist system</option></select></label>
            {draft.element !== 'ground-slab' && <label><span className="label">Heat-flow direction</span><select className="field min-h-11" value={draft.heatFlow} onChange={event => patch('heatFlow', event.target.value as UValueInput['heatFlow'])}>{Object.entries(heatFlowLabels).map(([key, label]) => <option key={key} value={key}>{key === 'automatic' ? `${draft.element === 'wall' ? 'Horizontal' : draft.element === 'roof' ? 'Upwards' : 'Downwards'} · element default` : label}</option>)}</select><span className="mt-1 block text-xs text-stone-500">Select the direction appropriate to the element’s inclination.</span></label>}
            </>}
          </div>
        </section>
        {draft.element === 'ground-slab' && <section className="panel rounded-xl p-5 sm:p-6" aria-labelledby="ground-heading"><h2 id="ground-heading" className="text-base font-semibold">Ground-floor geometry</h2><p className="mt-1 text-sm text-stone-600">Use the relevant floor footprint. Exposed perimeter excludes walls adjoining spaces heated to a similar temperature.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Floor area A (m²)" id="floor-area" type="number" step="any" min="0" value={draft.area} onChange={event => patch('area', event.target.value)} /><Field label="Exposed perimeter P (m)" id="floor-perimeter" type="number" step="any" min="0" value={draft.perimeter} onChange={event => patch('perimeter', event.target.value)} /><Field label="External wall thickness (mm)" id="floor-wall-thickness" type="number" step="any" min="0" value={draft.wallThickness} onChange={event => patch('wallThickness', event.target.value)} /><Field label="Design soil conductivity (W/mK)" id="soil-lambda" type="number" step="any" min="0" value={draft.soilLambda} onChange={event => patch('soilLambda', event.target.value)} />
          <label className="sm:col-span-2"><span className="label">Floor configuration</span><select className="field min-h-11" value={draft.groundConfiguration} onChange={event => patch('groundConfiguration', event.target.value as CalculationDraft['groundConfiguration'])}><option value="uniform-slab">Ground-level slab · uniform all-over layers · no separate edge insulation</option><option value="edge-insulated">Slab with separate edge insulation</option><option value="suspended">Suspended floor over a subfloor void</option><option value="basement">Basement floor</option><option value="flowing-groundwater">Floor affected by shallow flowing groundwater</option></select></label><Field label="Soil design-value reference" id="soil-reference" value={draft.groundSource} onChange={event => patch('groundSource', event.target.value)} /></div>
        </section>}
        {isAdditionalMethod(draft.element) ? <UValueMethodInputs key={draft.element} method={draft.element} draft={draft.methodData} onChange={value => patch('methodData', value)} /> : <section className="panel overflow-hidden rounded-xl" aria-labelledby="layers-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-4 sm:px-6"><div><h2 id="layers-heading" className="text-base font-semibold">Construction layers</h2><p className="mt-1 text-sm text-stone-500">Inside → {draft.element === 'ground-slab' ? 'ground' : 'outside'}</p></div><span className="text-sm text-stone-600">{totalThickness > 0 ? `${n(totalThickness, 1)} mm overall` : 'No layers yet'}</span></div>
          <div className="divide-y divide-stone-200">
          {!draft.layers.length && <div className="px-6 py-10 text-center"><Layers3 className="mx-auto text-moss" size={28} /><p className="mt-3 font-semibold">Start with the innermost layer</p><p className="mt-2 text-sm text-stone-600">Choose a referenced product or enter the material’s design conductivity.</p><button type="button" className="btn btn-primary mt-5 gap-2" onClick={() => addLayer()}><Plus size={16} />Add first layer</button></div>}
          {draft.layers.map((layer, index) => <div key={layer.id} className="p-5 sm:p-6" data-layer={layer.id}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-moss/10 text-sm font-semibold text-moss">{index + 1}</span><h3 className="min-w-0 text-sm font-semibold">{layer.name || `Layer ${index + 1}`}{calc?.ignoredLayerIds.includes(layer.id) && <span className="ml-2 text-xs font-normal text-stone-500">Beyond ventilated boundary</span>}</h3></div><div className="flex gap-1"><button type="button" className="btn btn-secondary min-h-11 px-3" aria-label={`Move layer ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button type="button" className="btn btn-secondary min-h-11 px-3" aria-label={`Move layer ${index + 1} down`} disabled={index === draft.layers.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button><button type="button" className="btn btn-secondary min-h-11 px-3" aria-label={`Remove layer ${index + 1}`} onClick={() => change(previous => ({ ...previous, layers: previous.layers.filter(item => item.id !== layer.id) }))}>Remove</button></div></div>
            <div className="grid gap-4 sm:grid-cols-2"><label><span className="label">Layer type</span><select className="field min-h-11" value={layer.kind} onChange={event => layerPatch(layer.id, { kind: event.target.value as LayerDraft['kind'], productId: '', bridged: false })}><option value="solid">Material · thickness / conductivity</option><option value="air">Air cavity</option><option value="resistance">Declared layer resistance</option></select></label>
              {layer.kind === 'solid' ? <label><span className="label">Material library</span><select className="field min-h-11" aria-label={`Material library for layer ${index + 1}`} value={layer.productId} onChange={event => chooseProduct(layer, event.target.value)}><option value="">Custom material / design value</option>{thermalMaterials.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label> : <Field label="Layer name" id={`layer-name-${layer.id}`} value={layer.name} onChange={event => layerPatch(layer.id, { name: event.target.value })} />}
              {layer.kind === 'solid' && !layer.productId && <Field label="Material name" id={`layer-name-${layer.id}`} value={layer.name} onChange={event => layerPatch(layer.id, { name: event.target.value })} />}
              <Field label="Thickness (mm)" id={`thickness-${layer.id}`} type="number" min="0" step="any" value={layer.thickness} onChange={event => {
                const lambda = layer.productId ? materialLambda(layer.productId, Number(event.target.value)) : null;
                layerPatch(layer.id, { thickness: event.target.value, ...(lambda != null ? { lambda: String(lambda) } : {}) });
              }} />
              {layer.kind === 'solid' ? <Field label="Design conductivity λ (W/mK)" id={`lambda-${layer.id}`} type="number" min="0" step="any" value={layer.lambda} readOnly={Boolean(layer.productId)} onChange={event => layerPatch(layer.id, { lambda: event.target.value })} /> : (layer.kind === 'resistance' || layer.airMode === 'assessed') && <Field label="Layer resistance R (m²K/W)" id={`resistance-${layer.id}`} type="number" min="0" step="any" value={layer.resistance} onChange={event => layerPatch(layer.id, { resistance: event.target.value })} />}
              {layer.kind === 'air' && <>
                <label><span className="label">Cavity resistance method</span><select className="field min-h-11" value={layer.airMode} onChange={event => layerPatch(layer.id, { airMode: event.target.value as LayerDraft['airMode'],
                  source: layer.source || (event.target.value === 'assessed' ? '' : 'ISO 6946 cavity method; BRE BR 443 section 4.7. https://www.cibse.org/media/wzrjrf3l/conventions-for-u-value-calculations.pdf') })}><option value="assessed">Enter assessed resistance</option><option value="table">Calculate · high-emissivity air-layer table</option><option value="emissivity">Calculate · surface emissivities</option></select></label>
                {layer.airMode !== 'assessed' && <>
                  <Field label="Cavity width (mm)" id={`cavity-width-${layer.id}`} type="number" min="0" step="any" value={layer.width} onChange={event => layerPatch(layer.id, { width: event.target.value })} />
                  <Field label="Cavity height / length (mm)" id={`cavity-height-${layer.id}`} type="number" min="0" step="any" value={layer.height} onChange={event => layerPatch(layer.id, { height: event.target.value })} />
                  {layer.airMode === 'emissivity' && <><Field label="First surface emissivity" id={`cavity-e1-${layer.id}`} type="number" min="0.02" max="1" step="any" value={layer.emissivity1} onChange={event => layerPatch(layer.id, { emissivity1: event.target.value })} /><Field label="Second surface emissivity" id={`cavity-e2-${layer.id}`} type="number" min="0.02" max="1" step="any" value={layer.emissivity2} onChange={event => layerPatch(layer.id, { emissivity2: event.target.value })} /><Field label="Emissivity certification / evidence" id={`cavity-evidence-${layer.id}`} value={layer.emissivityEvidence} onChange={event => layerPatch(layer.id, { emissivityEvidence: event.target.value })} maxLength={600} /></>}
                  <p className="text-xs text-stone-600 sm:col-span-2">For plane, parallel cavities: both dimensions must exceed ten times the thickness. Assumes mean cavity temperature 10°C and a temperature difference up to 5 K. {calc && `Calculated R: ${n(calc.layerResults.find(row => row.id === layer.id)!.resistance, 4)} m²K/W.`}</p>
                </>}
              </>}
              {layer.kind === 'air' && <><label><span className="label">Cavity ventilation</span><select className="field min-h-11" value={layer.ventilation} onChange={event => layerPatch(layer.id, { ventilation: event.target.value as LayerDraft['ventilation'] })}><option value="unventilated">Unventilated</option><option value="slightly">Slightly ventilated</option><option value="well">Well ventilated</option></select></label>{layer.ventilation === 'slightly' && <Field label={`Ventilation openings (mm²/${draft.element === 'wall' ? 'm' : 'm²'})`} id={`openings-${layer.id}`} type="number" min="0" step="any" value={layer.openings} onChange={event => layerPatch(layer.id, { openings: event.target.value })} />}<p className="text-xs text-stone-600 sm:col-span-2">Enter the resistance appropriate to the cavity dimensions, heat-flow direction and surface emissivity. No foil benefit is assumed automatically.</p></>}
              <label className="sm:col-span-2"><span className="label">Design-value / product reference</span><textarea className="field" rows={2} maxLength={600} value={layer.source} placeholder="Product datasheet, certificate or design-value reference" onChange={event => layerPatch(layer.id, { source: event.target.value })} /></label>
            </div>
            {layer.kind === 'solid' && <div className="mt-4"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={layer.bridged} onChange={event => layerPatch(layer.id, { bridged: event.target.checked })} />Repeating timber or masonry bridging in this layer</label>{layer.bridged && <div className="mt-3 grid gap-4 rounded-lg border border-stone-200 bg-stone-50 p-4 sm:grid-cols-2"><Field label="Bridging material" id={`bridge-name-${layer.id}`} value={layer.bridgeName} onChange={event => layerPatch(layer.id, { bridgeName: event.target.value })} /><Field label="Bridge conductivity (W/mK)" id={`bridge-lambda-${layer.id}`} type="number" min="0" step="any" value={layer.bridgeLambda} onChange={event => layerPatch(layer.id, { bridgeLambda: event.target.value })} /><Field label="Bridging area (%)" id={`bridge-fraction-${layer.id}`} type="number" min="0" max="95" step="any" value={layer.bridgeFraction} onChange={event => layerPatch(layer.id, { bridgeFraction: event.target.value })} /><label><span className="label">Bridge alignment group</span><select className="field min-h-11" value={layer.bridgeGroup} onChange={event => layerPatch(layer.id, { bridgeGroup: event.target.value })}>{[1, 2, 3, 4].map(group => <option key={group} value={`frame-${group}`}>Group {group}</option>)}</select></label><p className="text-xs text-stone-600 sm:col-span-2">Use the same group for aligned framing and the same area fraction. Different groups represent independent or crossing framing. Include all framing, not just stud width divided by spacing.</p><label className="sm:col-span-2"><span className="label">Bridge design-value reference</span><input className="field min-h-11" value={layer.bridgeSource} maxLength={600} onChange={event => layerPatch(layer.id, { bridgeSource: event.target.value })} /></label></div>}</div>}
          </div>)}
          </div>
          {draft.layers.length > 0 && <div className="flex flex-wrap gap-3 border-t border-stone-200 p-5 sm:px-6"><button type="button" className="btn btn-secondary gap-2" disabled={draft.layers.length >= 32} onClick={() => addLayer()}><Plus size={16} />Add layer</button><button type="button" className="btn btn-secondary" disabled={draft.layers.length >= 32} onClick={() => addLayer('air')}>Add air cavity</button></div>}
        </section>}
        <section className="panel rounded-xl p-5 sm:p-6"><h2 className="text-base font-semibold">Project target · optional</h2><p className="mt-1 text-sm text-stone-600">Enter the target applicable to this element and project. A target comparison is not a whole-building compliance assessment.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Maximum U-value (W/m²K)" id="target-u-value" type="number" step="any" min="0" value={draft.target} onChange={event => patch('target', event.target.value)} /><Field label="Target reference / handbook clause" id="target-reference" value={draft.targetReference} onChange={event => patch('targetReference', event.target.value)} /></div></section>
        {!additional && draft.element !== 'ground-slab' && <UValueCorrections draft={draft} onCalculatedChange={items => patch('automaticCorrections', items)} onAssessedChange={items => patch('corrections', items)} />}
      </div>
      <aside className="space-y-4 xl:sticky xl:top-6" aria-label="Calculation result">
        <section className="panel rounded-xl p-6"><p className="text-xs font-semibold uppercase tracking-wider text-moss">{draft.element === 'supplied_u' ? 'Externally assessed U-value' : 'Calculated U-value'}</p><div className="mt-3 flex items-baseline gap-2"><output className="text-5xl font-semibold tracking-tight" aria-label="U-value">{calc?.displayUValue || '—'}</output><span className="text-sm text-stone-600">W/m²K</span></div><p className="mt-2 text-sm text-stone-600">{elementLabels[draft.element]}</p>
          {calc ? <><p className="mt-5 border-t border-stone-200 pt-4 text-sm font-medium">{calc.method}</p><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-4"><dt className="text-stone-600">{calc.ground || calc.additional ? 'Effective resistance (1/U)' : 'Total resistance'}</dt><dd>{n(calc.totalResistance)} m²K/W</dd></div><div className="flex justify-between gap-4"><dt className="text-stone-600">Base U-value</dt><dd>{n(calc.baseUValue, 4)}</dd></div><div className="flex justify-between gap-4"><dt className="text-stone-600">{additional ? 'Method adjustment ΔU' : 'Corrections ΔU'}</dt><dd>{n(calc.correction, 4)}</dd></div>{!calc.ground && !calc.additional && <div className="flex justify-between gap-4"><dt className="text-stone-600">Rsi / Rse</dt><dd>{n(calc.rsi, 2)} / {n(calc.rse, 2)}</dd></div>}</dl>{calc.targetMet !== null && <p className={`mt-4 rounded-md px-3 py-2 text-sm font-semibold ${calc.targetMet ? 'bg-moss/10 text-moss' : 'bg-amber-50 text-amber-900'}`}>{calc.targetMet ? 'Meets selected target' : 'Above selected target'} · {draft.target} W/m²K</p>}
          <details className="mt-4 text-sm"><summary className="cursor-pointer text-stone-600">Calculation detail</summary><dl className="mt-3 space-y-2 text-xs"><div>Unrounded U: {calc.uValue.toFixed(8)} W/m²K</div>{calc.additional ? calc.additional.working.map(row => <div key={row.label}>{row.label}: {row.value}</div>) : calc.ground ? <><div>B′: {n(calc.ground.characteristicDimension)} m</div><div>Equivalent thickness dt: {n(calc.ground.equivalentThickness)} m</div><div>{calc.ground.regime}</div></> : <><div>Upper R: {n(calc.upperResistance, 5)}</div><div>Lower R: {n(calc.lowerResistance, 5)}</div><div>Approximation error: {n(calc.approximationErrorPercent, 2)}%</div><div>{calc.ventilation}</div></>}</dl></details></> : <p className="mt-5 text-sm text-stone-600" role="status">{additional || draft.layers.length ? result.message : 'Add construction layers to calculate the result.'}</p>}
          {calc && calc.missingSources.length > 0 && <p className="mt-4 text-sm text-amber-900">Add references for {calc.missingSources.join(', ')} before creating the report.</p>}
          <label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-moss" checked={draft.correctionsAssessed} onChange={event => patch('correctionsAssessed', event.target.checked)} /><span>I have assessed applicable corrections{additional ? ' and included any required effects in the supplied values.' : draft.element === 'ground-slab' ? ' and confirmed this floor matches the supported slab configuration.' : ', including air gaps and fixings, and included any required corrections.'}</span></label>
          <button type="button" className="btn btn-primary mt-6 w-full gap-2" disabled={!calc || calc.missingSources.length > 0 || !draft.correctionsAssessed || Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle size={16} className="animate-spin" /> : <FileText size={16} />}Create calculation report</button>
          <p className="mt-3 text-xs text-stone-500">Saves an immutable calculation and opens a report you can print or save as PDF.</p>
          {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-4 text-sm text-moss">{notice}</p>}
        </section>
        <div className="rounded-lg border border-stone-200 p-4 text-xs leading-relaxed text-stone-600"><p className="font-semibold text-ink">Calculation basis</p><p className="mt-2">ISO 6946 for supported opaque above-ground elements; ISO 13370 for supported ground-transfer methods. Opening calculations use supplied component values. Use appropriate design values and assess applicable corrections before issuing a report.</p><p className="mt-2">Choose the method that matches the construction. Numerical metal-frame analysis, interacting specialist corrections and flowing groundwater remain outside the supported portal methods.</p></div>
      </aside>
    </div>
  </div>;
}
