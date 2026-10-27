import { useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, CheckCheck, ChevronRight, FileCheck2, FileText, FolderOpen, House, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';

type ApplicationKind = 'planning' | 'warrant';
type ExampleDocument = { id: string; name: string; type: string; size: string };
const exampleDocuments: ExampleDocument[] = [
  { id: 'location', name: 'Location plan.pdf', type: 'Location plan', size: '420 KB' },
  { id: 'existing', name: 'Existing floor plan.pdf', type: 'Existing drawing', size: '1.2 MB' },
  { id: 'proposed', name: 'Proposed floor plan.pdf', type: 'Proposed drawing', size: '1.6 MB' },
  { id: 'specification', name: 'Construction specification.pdf', type: 'Specification', size: '680 KB' },
];
const steps = ['Your drawings', 'Prepared details', 'Your review'];
const originalProposal = 'Single-storey rear extension to the existing dwelling.';
const reviewChecks = [
  'Check the site and applicant details',
  'Review the drawings and document types',
  'Confirm declarations and any application fees',
];

function DrawingPreview({ document }: { document: ExampleDocument }) {
  const proposed = document.id === 'proposed';
  return <div className="demo-drawing-preview">
    <div className="demo-drawing-label"><span>{document.type}</span><span>Example drawing</span></div>
    {document.id === 'specification' ? <div className="demo-specification"><strong>Construction specification</strong><p>Willow Road extension</p><h4>External walls</h4><p>Construction details, insulation and finishes are reviewed alongside the proposed drawings.</p><h4>Roof construction</h4><p>The supporting specification stays linked to the application.</p><span>Illustrative document content</span></div> : <svg viewBox="0 0 360 260" role="img" aria-label={document.id === 'location' ? 'Illustrative location plan with the example property outlined' : `Illustrative ${proposed ? 'proposed' : 'existing'} floor plan of a rear extension`}>
      {document.id === 'location' ? <g fill="none" strokeWidth="1.5">
        <path d="M0 190H360M0 215H360M72 0V190M95 0V190M268 0V190M291 0V190" stroke="#c8d3e0" />
        <path d="M120 53h116v116H120z" stroke="#6b7e98" /><path d="M137 79h81v68h-81zM144 79V58h66v21" stroke="#6b7e98" />
        <path d="M112 43h132v136H112z" stroke="#4e5fc1" strokeWidth="2.5" />
        <path d="M17 71h37v58H17zM312 72h35v57h-35zM139 229h77v28h-77z" stroke="#c8d3e0" />
        <text x="178" y="119" textAnchor="middle" fill="#4e5fc1" stroke="none" fontSize="12">24</text>
        <text x="180" y="207" textAnchor="middle" fill="#637085" stroke="none" fontSize="10">Willow Road</text>
      </g> : <g fill="none" strokeLinejoin="miter">
        <path d="M66 83H294V222H66Z" stroke="#6b7e98" strokeWidth="4" />
        <path d="M166 83V167M66 167H136M166 167H294M136 167v55M223 83v84" stroke="#6b7e98" strokeWidth="2" />
        <path d="M137 195a27 27 0 0 1 27 27M166 168a29 29 0 0 1 29 29M223 141a26 26 0 0 1 26 26" stroke="#a8b4c6" strokeWidth="1" />
        <path d="M86 83h51M181 83h24M250 83h27M88 222h35M185 222h64" stroke="#d9e3ee" strokeWidth="5" />
        {proposed && <g className="demo-proposed-lines"><path d="M66 83V32H222V83" stroke="#4e5fc1" strokeWidth="4" /><path d="M84 32H204" stroke="#dce2fc" strokeWidth="5" /><path d="M66 82H222" stroke="#4e5fc1" strokeWidth="1" strokeDasharray="4 4" /><text x="143" y="62" textAnchor="middle" fill="#4e5fc1" stroke="none" fontSize="10">Proposed extension</text></g>}
        <text x="115" y="124" textAnchor="middle" fill="#536780" stroke="none" fontSize="10">Living</text>
        <text x="195" y="124" textAnchor="middle" fill="#536780" stroke="none" fontSize="10">Kitchen</text>
        <text x="257" y="124" textAnchor="middle" fill="#536780" stroke="none" fontSize="10">Utility</text>
        <text x="215" y="197" textAnchor="middle" fill="#536780" stroke="none" fontSize="10">Hall</text>
      </g>}
      <g stroke="#8e9db2" fill="none" strokeWidth="1"><path d="M324 54V28m-5 7 5-7 5 7" /><path d="M33 242H95m-62-3v6m31-6v6m31-6v6" /></g>
      <text x="324" y="20" textAnchor="middle" fill="#637085" fontSize="9">N</text>
      <text x="104" y="246" fill="#637085" fontSize="8">Illustrative scale</text>
    </svg>}
    <div className="demo-drawing-filename"><FileText size={13} aria-hidden="true" />{document.name}</div>
  </div>;
}

export default function ApplicationDemo() {
  const [kind, setKind] = useState<ApplicationKind>('planning');
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [selected, setSelected] = useState(['location', 'existing', 'proposed']);
  const [previewId, setPreviewId] = useState('proposed');
  const [proposal, setProposal] = useState(originalProposal);
  const [reviewed, setReviewed] = useState<boolean[]>([false, false, false]);
  const [finished, setFinished] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const fieldId = useId();
  const documents = kind === 'planning' ? exampleDocuments.slice(0, 3) : exampleDocuments;
  const previewDocument = documents.find(document => document.id === previewId) ?? documents[0];
  const selectedDocuments = documents.filter(document => selected.includes(document.id));
  const ready = selected.includes('location') && selected.includes('proposed');
  const checksComplete = reviewed.every(Boolean);

  const changeKind = (next: ApplicationKind) => {
    setKind(next); setStep(0); setFurthestStep(0); setFinished(false);
    setSelected((next === 'planning' ? exampleDocuments.slice(0, 3) : exampleDocuments).map(document => document.id));
    setPreviewId('proposed'); setProposal(originalProposal); setReviewed([false, false, false]);
  };
  const moveTo = (next: number) => {
    setStep(next); setFurthestStep(value => Math.max(value, next));
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  };
  const toggleDocument = (id: string) => {
    setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
    setFurthestStep(0); setFinished(false); setReviewed([false, false, false]);
  };
  const updateProposal = (value: string) => {
    setProposal(value); setFinished(false); setReviewed([false, false, false]);
  };

  return <section id="product-demo" className="application-demo" aria-label="Interactive application preparation demonstration">
    <div className="demo-window-bar"><span className="demo-window-title"><FolderOpen size={16} aria-hidden="true" />Willow Road extension</span><span className="demo-example-badge">Interactive example</span><button type="button" className="demo-restart" onClick={() => changeKind(kind)} aria-label="Restart the demonstration"><RotateCcw size={14} aria-hidden="true" /><span>Start again</span></button></div>
    <div className="demo-application-types" role="group" aria-label="Choose an example application type">
      <button type="button" aria-pressed={kind === 'planning'} onClick={() => changeKind('planning')}><House size={17} aria-hidden="true" />Planning permission</button>
      <button type="button" aria-pressed={kind === 'warrant'} onClick={() => changeKind('warrant')}><Building2 size={17} aria-hidden="true" />Building warrant</button>
    </div>
    <div className="demo-workspace">
      <nav className="demo-stepper" aria-label="Example application steps"><ol>{steps.map((label, index) => <li key={label}><button type="button" aria-current={step === index ? 'step' : undefined} disabled={index > furthestStep || (index === 2 && !proposal.trim())} onClick={() => moveTo(index)}><span className="demo-step-number">{index < step || finished ? <Check size={14} aria-hidden="true" /> : index + 1}</span><span>{label}</span><ChevronRight size={14} className="demo-step-chevron" aria-hidden="true" /></button></li>)}</ol><div className="demo-stepper-note"><ShieldCheck size={18} aria-hidden="true" /><p>Prepared with AI.<br />Reviewed by you.</p></div></nav>
      <div className="demo-content" key={`${kind}-${step}`}>
        {step === 0 && <><div className="demo-content-heading"><h3 ref={heading} tabIndex={-1}>Start with your drawings.</h3><p>Try the example files. Select a drawing to take a closer look.</p></div><div className="demo-documents-layout"><div className="demo-document-list">{documents.map(document => <div className="demo-document-row" key={document.id}><label className="demo-document-checkbox"><input type="checkbox" checked={selected.includes(document.id)} onChange={() => toggleDocument(document.id)} aria-label={`Include ${document.name}`} /></label><button type="button" className="demo-document-select" onClick={() => setPreviewId(document.id)} aria-pressed={previewId === document.id}><FileText size={19} strokeWidth={1.5} aria-hidden="true" /><span><strong>{document.name}</strong><span>{document.type}<span aria-hidden="true"> / </span>{document.size}</span></span><ChevronRight size={14} aria-hidden="true" /></button></div>)}<p className="demo-document-count">{selectedDocuments.length} example documents selected</p><details className="demo-mobile-drawing"><summary>Preview selected drawing</summary><DrawingPreview document={previewDocument} /></details></div><div className="demo-desktop-drawing"><DrawingPreview document={previewDocument} /></div></div><div className="demo-action-row"><span className="demo-selection-note">{ready ? 'Ready to see what happens next?' : 'Include the location and proposed plans to continue.'}</span><button type="button" className="home-button-primary" disabled={!ready} onClick={() => moveTo(1)}><Sparkles size={15} aria-hidden="true" />Prepare example<ArrowRight size={15} aria-hidden="true" /></button></div></>}
        {step === 1 && <><div className="demo-content-heading"><h3 ref={heading} tabIndex={-1}>The details, brought together.</h3><p>See how your documents inform the application. You can edit the example proposal.</p></div><div className="demo-prepared-layout"><dl className="demo-prepared-fields"><div><dt>Site address</dt><dd>24 Willow Road, Glasgow</dd><span><FileText size={11} aria-hidden="true" />From the example location plan</span></div><div><dt>Application type</dt><dd>{kind === 'planning' ? 'Householder planning permission' : 'Building warrant for an extension'}</dd></div><div className="demo-proposal-field"><label htmlFor={fieldId}>Proposal description</label><textarea id={fieldId} value={proposal} maxLength={300} onChange={event => updateProposal(event.target.value)} rows={2} /><span><FileText size={11} aria-hidden="true" />Based on the example proposed drawing</span></div></dl><div className="demo-prepared-documents"><span className="demo-prepared-label"><FileCheck2 size={16} aria-hidden="true" />Documents organised</span>{selectedDocuments.map(document => <div key={document.id}><Check size={13} aria-hidden="true" /><span>{document.type}</span></div>)}<p>{kind === 'planning' ? 'Ownership, declarations and application fees remain for you to confirm.' : 'Technical details, declarations and application fees remain for you to confirm.'}</p></div></div><div className="demo-action-row"><button type="button" className="demo-back" onClick={() => moveTo(0)}><ArrowLeft size={14} aria-hidden="true" />Back to drawings</button><button type="button" className="home-button-primary" disabled={!proposal.trim()} onClick={() => moveTo(2)}>Review example<ArrowRight size={15} aria-hidden="true" /></button></div></>}
        {step === 2 && <><div className="demo-content-heading"><h3 ref={heading} tabIndex={-1}>{finished ? 'Preparation done. Control kept.' : 'Your expertise has the final say.'}</h3><p>{finished ? 'That is the idea: a prepared application, with the important decisions still yours.' : 'The example is prepared. Confirm the review items to finish the demonstration.'}</p></div><div className="demo-review-layout"><div className="demo-review-summary"><span className="demo-review-kind">{kind === 'planning' ? 'Planning permission' : 'Building warrant'}</span><h4>Willow Road extension</h4><p>{proposal}</p><span className="demo-review-document-count"><FileCheck2 size={14} aria-hidden="true" />{selectedDocuments.length} supporting documents</span><span className="demo-review-status"><CheckCheck size={14} aria-hidden="true" />{finished ? 'Example review complete' : 'Prepared for review'}</span></div><fieldset className="demo-checklist" disabled={finished}><legend>Example review checklist</legend>{reviewChecks.map((label, index) => <label key={label}><input type="checkbox" checked={reviewed[index]} onChange={event => setReviewed(values => values.map((value, position) => position === index ? event.target.checked : value))} /><span>{label}</span></label>)}</fieldset></div><div className="demo-action-row"><button type="button" className="demo-back" onClick={() => moveTo(1)}><ArrowLeft size={14} aria-hidden="true" />Back to details</button>{finished ? <a href="/register" className="home-button-primary">Create your workspace<ArrowRight size={15} aria-hidden="true" /></a> : <button type="button" className="home-button-primary" disabled={!checksComplete} onClick={() => setFinished(true)}>Finish example review<Check size={15} aria-hidden="true" /></button>}</div></>}
      </div>
    </div>
    <div className="demo-disclosure"><ShieldCheck size={13} aria-hidden="true" /><span>Sample project and documents. Nothing is uploaded or submitted.</span><span className="demo-progress-status" role="status" aria-live="polite">{finished ? 'Example review complete' : `Step ${step + 1} of 3`}</span></div>
  </section>;
}
