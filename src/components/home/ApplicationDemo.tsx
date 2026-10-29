import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Building2, Check, CheckCheck, ChevronRight, Clock3, FileCheck2, FileText, FolderOpen, House, LoaderCircle, RotateCcw, Send, ShieldCheck, Sparkles } from 'lucide-react';

type ApplicationKind = 'planning' | 'warrant';
type ExampleDocument = { id: string; name: string; type: string; size: string };
const exampleDocuments: ExampleDocument[] = [
  { id: 'location', name: 'Location plan.pdf', type: 'Location plan', size: '420 KB' },
  { id: 'existing', name: 'Existing floor plan.pdf', type: 'Existing drawing', size: '1.2 MB' },
  { id: 'proposed', name: 'Proposed floor plan.pdf', type: 'Proposed drawing', size: '1.6 MB' },
  { id: 'specification', name: 'Construction specification.pdf', type: 'Specification', size: '680 KB' },
];
type Phase = 'drawings' | 'preparing' | 'prepared' | 'submitting' | 'complete';
const steps = ['Your drawings', 'AI preparation', 'Submission'];
const originalProposal = 'Single-storey rear extension to the existing dwelling.';
const preparationTasks = ['Reading the drawings', 'Finding the site and applicant', 'Filling the application details', 'Organising supporting documents'];
const submissionTasks = ['Opening the example portal', 'Entering the application details', 'Attaching all supporting documents', 'Completing the example submission'];

function TypedValue({ value, reducedMotion }: { value: string; reducedMotion: boolean }) {
  const [length, setLength] = useState(reducedMotion ? value.length : 0);
  useEffect(() => {
    if (reducedMotion) { setLength(value.length); return; }
    setLength(0);
    const start = performance.now();
    const timer = window.setInterval(() => {
      const next = Math.min(value.length, Math.ceil((performance.now() - start) / 11));
      setLength(next);
      if (next === value.length) window.clearInterval(timer);
    }, 22);
    return () => window.clearInterval(timer);
  }, [value, reducedMotion]);
  return <><span className="demo-sr-only">{value}</span><span aria-hidden="true" className={length < value.length ? 'demo-typing' : undefined}>{value.slice(0, length)}</span></>;
}

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
  const [phase, setPhase] = useState<Phase>('drawings');
  const [received, setReceived] = useState(0);
  const [preparation, setPreparation] = useState(0);
  const [submission, setSubmission] = useState(0);
  const [run, setRun] = useState(0);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [previewId, setPreviewId] = useState('proposed');
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const interacted = useRef(false);
  const documents = kind === 'planning' ? exampleDocuments.slice(0, 3) : exampleDocuments;
  const previewDocument = documents.find(document => document.id === previewId) ?? documents[0];
  const step = phase === 'drawings' ? 0 : phase === 'preparing' || phase === 'prepared' ? 1 : 2;
  const busy = phase === 'preparing' || phase === 'submitting';
  const allReceived = received === documents.length;
  const applicationName = kind === 'planning' ? 'Planning permission' : 'Building warrant';
  const preparedFields = [
    { label: 'Site address', value: '24 Willow Road, Glasgow', source: 'From the example location plan' },
    { label: 'Applicant', value: 'Alex Morgan', source: 'From the example drawing title block' },
    { label: 'Application type', value: kind === 'planning' ? 'Householder planning permission' : 'Building warrant for an extension' },
    { label: 'Proposal description', value: originalProposal, source: 'From the example proposed drawing' },
  ];

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { threshold: 0.15 });
    if (section.current) observer.observe(section.current);
    return () => { preference.removeEventListener('change', update); observer.disconnect(); };
  }, []);

  // Each run owns its timers. Restarting, changing type or unmounting cancels the old sequence.
  useEffect(() => {
    if (!visible) return;
    const timers: number[] = [];
    const later = (callback: () => void, delay: number) => timers.push(window.setTimeout(callback, reducedMotion ? 0 : delay));
    if (phase === 'drawings') {
      for (let index = 1; index <= documents.length; index++) later(() => setReceived(index), 300 + index * 380);
    } else if (phase === 'preparing') {
      for (let index = 1; index <= preparedFields.length; index++) later(() => setPreparation(index), 650 + index * 850);
      later(() => setPhase('prepared'), 4800);
    } else if (phase === 'submitting') {
      for (let index = 1; index <= submissionTasks.length; index++) later(() => setSubmission(index), index * 750);
      later(() => setPhase('complete'), 3400);
    }
    return () => timers.forEach(window.clearTimeout);
  }, [phase, kind, run, visible, reducedMotion]);

  useEffect(() => {
    if (interacted.current) heading.current?.focus({ preventScroll: true });
  }, [phase]);

  const changeKind = (next: ApplicationKind) => {
    interacted.current = true;
    setKind(next); setPhase('drawings'); setReceived(0); setPreparation(0); setSubmission(0);
    setRun(value => value + 1); setPreviewId('proposed');
  };
  const startPreparation = () => {
    if (phase !== 'drawings' || !allReceived) return;
    interacted.current = true; setPhase('preparing');
  };
  const startSubmission = () => {
    if (phase === 'prepared') setPhase('submitting');
  };
  const status = phase === 'drawings' ? (allReceived ? 'All drawings added' : `Adding drawings: ${received} of ${documents.length}`)
    : phase === 'preparing' ? preparationTasks[Math.min(preparation, preparationTasks.length - 1)]
    : phase === 'prepared' ? 'Application prepared. Ready to submit the example.'
    : phase === 'submitting' ? submissionTasks[Math.min(submission, submissionTasks.length - 1)] : 'Example submission complete';

  return <section ref={section} id="product-demo" className="application-demo" aria-label="Interactive application preparation demonstration" data-phase={phase}>
    <div className="demo-window-bar"><span className="demo-window-title"><FolderOpen size={16} aria-hidden="true" />Willow Road extension</span><span className="demo-example-badge">Interactive example</span><button type="button" className="demo-restart" onClick={() => changeKind(kind)} aria-label="Restart the demonstration"><RotateCcw size={14} aria-hidden="true" /><span>Start again</span></button></div>
    <div className="demo-application-types" role="group" aria-label="Choose an example application type">
      <button type="button" aria-pressed={kind === 'planning'} onClick={() => { if (kind !== 'planning') changeKind('planning'); }}><House size={17} aria-hidden="true" />Planning permission</button>
      <button type="button" aria-pressed={kind === 'warrant'} onClick={() => { if (kind !== 'warrant') changeKind('warrant'); }}><Building2 size={17} aria-hidden="true" />Building warrant</button>
    </div>
    <div className="demo-workspace">
      <nav className="demo-stepper" aria-label="Example application steps"><ol>{steps.map((label, index) => <li className="demo-step-item" key={label} aria-current={step === index ? 'step' : undefined} data-complete={index < step || phase === 'complete'}><span className="demo-step-number">{index < step || phase === 'complete' ? <Check size={14} aria-hidden="true" /> : index + 1}</span><span>{label}</span><ChevronRight size={14} className="demo-step-chevron" aria-hidden="true" /></li>)}</ol><div className="demo-stepper-note"><Sparkles size={18} aria-hidden="true" /><p>Your drawings in.<br />The paperwork, done.</p></div></nav>
      <div className="demo-content" key={`${kind}-${step}`} aria-busy={busy}>
        {phase === 'drawings' && <><div className="demo-content-heading"><h3 ref={heading} tabIndex={-1}>{allReceived ? 'Your drawings. All in one place.' : 'First, bring in the drawings.'}</h3><p>Watch the example files arrive, then let AI take it from here.</p></div><div className="demo-documents-layout"><div className="demo-document-list">{documents.map((document, index) => <div className="demo-document-row demo-incoming-document" data-received={index < received} key={document.id}><button type="button" className="demo-document-select" disabled={index >= received} onClick={() => setPreviewId(document.id)} aria-pressed={previewId === document.id}><FileText size={19} strokeWidth={1.5} aria-hidden="true" /><span><strong>{document.name}</strong><span>{document.type}<span aria-hidden="true"> / </span>{document.size}</span></span></button><span className="demo-file-state">{index < received ? <><Check size={14} aria-hidden="true" /><span className="demo-sr-only">Added</span></> : <><span className="demo-file-wait" aria-hidden="true" /><span className="demo-sr-only">Waiting</span></>}</span></div>)}<p className="demo-document-count">{received} of {documents.length} example documents added</p><details className="demo-mobile-drawing"><summary>Preview selected drawing</summary><DrawingPreview document={previewDocument} /></details></div><div className="demo-desktop-drawing"><DrawingPreview document={previewDocument} /></div></div><div className="demo-action-row"><span className="demo-selection-note">{allReceived ? 'All drawings added. Ready when you are.' : 'Adding the example drawing set…'}</span><button type="button" className="home-button-primary" disabled={!allReceived} onClick={startPreparation}><Sparkles size={15} aria-hidden="true" />Prepare example<ArrowRight size={15} aria-hidden="true" /></button></div></>}
        {step === 1 && <><div className="demo-content-heading"><h3 ref={heading} tabIndex={-1}>{phase === 'preparing' ? 'AI is doing the paperwork.' : 'The details are in. You’re ready.'}</h3><p>{phase === 'preparing' ? 'Reading your drawings and filling in the application, field by field.' : 'Site, applicant, proposal and drawings, brought together automatically.'}</p></div><div className="demo-prepared-layout"><dl className="demo-prepared-fields">{preparedFields.map((field, index) => <div key={field.label} className="demo-auto-field" data-filled={preparation > index}><dt>{field.label}{preparation > index && <Check size={12} aria-label="Filled" />}</dt><dd>{preparation > index ? <TypedValue value={field.value} reducedMotion={reducedMotion || phase === 'prepared'} /> : <span className="demo-field-placeholder">Waiting for AI</span>}</dd>{preparation > index && field.source && <span><FileText size={11} aria-hidden="true" />{field.source}</span>}</div>)}</dl><div className="demo-ai-activity"><div className="demo-ai-label">{phase === 'preparing' ? <Sparkles size={17} className="demo-ai-spark" aria-hidden="true" /> : <CheckCheck size={17} aria-hidden="true" />}<strong>{phase === 'preparing' ? 'Architect Pro is working' : 'Application prepared'}</strong></div><ol className="demo-task-list">{preparationTasks.map((task, index) => <li key={task} data-state={phase === 'prepared' || preparation > index ? 'done' : preparation === index ? 'active' : 'waiting'}>{phase === 'prepared' || preparation > index ? <Check size={14} aria-hidden="true" /> : preparation === index ? <LoaderCircle size={14} className="demo-spinner" aria-hidden="true" /> : <span className="demo-task-dot" aria-hidden="true" />}<span>{task}</span></li>)}</ol><div className="demo-ai-document-note"><FileCheck2 size={15} aria-hidden="true" /><span>{documents.length} supporting documents{phase === 'prepared' ? ' organised and attached' : ' linked to this application'}</span></div></div></div><div className="demo-action-row"><span className="demo-selection-note">{phase === 'prepared' ? 'One more click. Watch the example submit.' : 'No copying. No re-entering the same details.'}</span><button type="button" className="home-button-primary" disabled={phase !== 'prepared'} onClick={startSubmission}>{phase === 'preparing' ? <><LoaderCircle size={15} className="demo-spinner" aria-hidden="true" />Preparing example…</> : <><Send size={14} aria-hidden="true" />Submit example<ArrowRight size={15} aria-hidden="true" /></>}</button></div></>}
        {step === 2 && <><div className="demo-content-heading"><h3 ref={heading} tabIndex={-1}>{phase === 'complete' ? 'Application submitted. Time back.' : 'One click. The rest happens for you.'}</h3><p>{phase === 'complete' ? `${applicationName}, from drawings to a completed example submission.` : `Watch Architect Pro complete the ${applicationName.toLowerCase()} submission in this example.`}</p></div><div className="demo-submission-layout"><div className="demo-submission-receipt"><span className="demo-review-kind">{applicationName}</span><h4>Willow Road extension</h4><p>24 Willow Road, Glasgow</p><span className="demo-review-document-count"><FileCheck2 size={14} aria-hidden="true" />{documents.length} supporting documents</span><div className="demo-submission-seal" data-complete={phase === 'complete'}>{phase === 'complete' ? <CheckCheck size={20} aria-hidden="true" /> : <LoaderCircle size={20} className="demo-spinner" aria-hidden="true" />}<span><strong>{phase === 'complete' ? 'Example submission complete' : 'Submitting your example'}</strong><span>{phase === 'complete' ? 'Application details and drawings sent together.' : 'Details, documents and submission handled for you.'}</span></span></div></div>{phase === 'submitting' ? <div className="demo-submission-progress"><strong>Completing the submission</strong><ol className="demo-task-list">{submissionTasks.map((task, index) => <li key={task} data-state={submission > index ? 'done' : submission === index ? 'active' : 'waiting'}>{submission > index ? <Check size={14} aria-hidden="true" /> : submission === index ? <LoaderCircle size={14} className="demo-spinner" aria-hidden="true" /> : <span className="demo-task-dot" aria-hidden="true" />}<span>{task}</span></li>)}</ol></div> : <div className="demo-time-result"><div className="demo-time-heading"><Clock3 size={16} aria-hidden="true" /><strong>Less admin. More architecture.</strong></div><div className="demo-time-comparison"><div><span>With Architect Pro</span><strong>1 <span>min</span></strong><span>per application</span></div><div><span>Manually</span><strong>25 <span>min</span></strong><span>per application</span></div></div><p className="demo-time-saving">24 minutes back for the work you do best.</p><p className="demo-time-footnote">Illustrative time comparison. Actual times vary.</p></div>}</div><div className="demo-action-row"><span className="demo-selection-note">{phase === 'complete' ? 'Your next application could start here.' : 'The example is completing automatically…'}</span>{phase === 'complete' ? <a href="/register" className="home-button-primary">Create your workspace<ArrowRight size={15} aria-hidden="true" /></a> : <button type="button" className="home-button-primary" disabled><LoaderCircle size={15} className="demo-spinner" aria-hidden="true" />Submitting example…</button>}</div></>}
      </div>
    </div>
    <div className="demo-disclosure"><ShieldCheck size={13} aria-hidden="true" /><span>Interactive simulation. No real uploads or submissions.</span><span className="demo-progress-status" role="status" aria-live="polite" aria-atomic="true">{status}</span></div>
  </section>;
}
