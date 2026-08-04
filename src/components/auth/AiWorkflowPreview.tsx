import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  FileCheck2,
  FileText,
  LoaderCircle,
  Pencil,
  Upload,
} from 'lucide-react';

export const AI_WORKFLOW_STAGES = [
  { id: 'upload', label: 'Upload documents' },
  { id: 'analysis', label: 'AI analyses the files' },
  { id: 'review', label: 'Review suggestions' },
  { id: 'prepare', label: 'Prepare automation' },
] as const;

export type AiWorkflowStage = (typeof AI_WORKFLOW_STAGES)[number]['id'];

type Props = {
  compact?: boolean;
  initialStage?: AiWorkflowStage;
  autoAdvance?: boolean;
};

const documents = [
  'Proposed Elevations.pdf',
  'Site Plan.pdf',
  'Construction Details.pdf',
];

const suggestedDocuments = [
  { name: 'Proposed Elevations', category: 'Elevations', detail: 'Drawing title suggested' },
  { name: 'Site Plan', category: 'Location / Site Plan', detail: 'Drawing number suggested' },
  { name: 'Construction Details', category: 'Construction Details', detail: 'Revision suggested' },
];

export default function AiWorkflowPreview({
  compact = false,
  initialStage = 'upload',
  autoAdvance = true,
}: Props) {
  const initialIndex = Math.max(0, AI_WORKFLOW_STAGES.findIndex((stage) => stage.id === initialStage));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [timerVersion, setTimerVersion] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [reviewAction, setReviewAction] = useState<'pending' | 'editing' | 'approved'>('pending');
  const activeStage = AI_WORKFLOW_STAGES[activeIndex];

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (!autoAdvance || reducedMotion || hovered) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % AI_WORKFLOW_STAGES.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [autoAdvance, hovered, reducedMotion, timerVersion]);

  const stageProgress = useMemo(
    () => `${((activeIndex + 1) / AI_WORKFLOW_STAGES.length) * 100}%`,
    [activeIndex],
  );

  const selectStage = (index: number) => {
    setActiveIndex(index);
    setTimerVersion((current) => current + 1);
  };

  return (
    <section
      aria-label="Architect Pro AI document workflow"
      className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_18px_48px_rgba(32,35,31,0.06)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <style>{`
        @keyframes ap-workflow-enter {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ap-workflow-scan {
          from { transform: translateX(-120%); }
          to { transform: translateX(560%); }
        }
        .ap-workflow-stage { animation: ap-workflow-enter 260ms ease-out; }
        .ap-workflow-scan { animation: ap-workflow-scan 2.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .ap-workflow-stage, .ap-workflow-scan { animation: none !important; }
        }
      `}</style>

      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <img src="/brand/architect-pro-mark.png" width="512" height="512" alt="" className="h-6 w-6 object-contain" />
          <span className="text-xs font-semibold text-ink">Document intelligence</span>
        </div>
        <span className="text-xs text-stone-500">AI suggestions remain under your control</span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-stone-200 sm:grid-cols-4" aria-label="AI workflow stages">
        {AI_WORKFLOW_STAGES.map((stage, index) => (
          <button
            key={stage.id}
            type="button"
            aria-pressed={activeIndex === index}
            onClick={() => selectStage(index)}
            className={`min-h-11 bg-white px-3 py-2 text-left text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss/40 ${
              activeIndex === index ? 'text-ink' : 'text-stone-500 hover:bg-stone-50 hover:text-ink'
            }`}
          >
            <span className="mr-1 text-stone-400">{index + 1}.</span> {stage.label}
          </button>
        ))}
      </div>
      <div className="h-0.5 bg-stone-100" aria-hidden="true">
        <div className="h-full bg-moss transition-[width] duration-300" style={{ width: stageProgress }} />
      </div>

      <div className={`relative ${compact ? 'min-h-60 p-4' : 'min-h-72 p-5'}`} aria-live="off">
        <div key={activeStage.id} className="ap-workflow-stage" data-active-stage={activeStage.id}>
          {activeStage.id === 'upload' && (
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Project documents</p>
                  <p className="mt-0.5 text-xs text-stone-500">3 PDFs selected</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded border border-stone-200 px-2 py-1 text-xs font-semibold text-stone-600">
                  <Upload size={13} /> Ready to upload
                </span>
              </div>
              <div className="divide-y divide-stone-100 rounded-md border border-stone-200">
                {documents.slice(0, compact ? 2 : 3).map((name, index) => (
                  <div key={name} className={`${index === 2 ? 'hidden sm:flex' : 'flex'} items-center gap-3 px-3 py-3`}>
                    <FileText size={17} className="shrink-0 text-stone-400" />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{name}</span>
                    <span className="text-xs text-stone-500">Waiting</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeStage.id === 'analysis' && (
            <div>
              <div className="mb-4 flex items-center gap-2">
                <LoaderCircle size={16} className="animate-spin text-moss" />
                <div>
                  <p className="text-sm font-semibold text-ink">Analysing documents...</p>
                  <p className="mt-0.5 text-xs text-stone-500">Checking document content and drawing details</p>
                </div>
              </div>
              <div className="divide-y divide-stone-100 overflow-hidden rounded-md border border-stone-200">
                {documents.slice(0, compact ? 2 : 3).map((name, index) => (
                  <div key={name} className={`relative ${index === 2 ? 'hidden sm:flex' : 'flex'} items-center gap-3 overflow-hidden px-3 py-3`}>
                    {index === 0 && <span className="ap-workflow-scan absolute inset-y-0 left-0 w-16 border-x border-moss/20 bg-moss/10" aria-hidden="true" />}
                    <FileText size={17} className="relative shrink-0 text-stone-400" />
                    <span className="relative min-w-0 flex-1 truncate text-xs font-semibold text-ink">{name}</span>
                    <span className="relative text-xs text-stone-500">{index === 0 ? 'Analysing' : 'Queued'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeStage.id === 'review' && (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Suggested categories</p>
                  <p className="mt-0.5 text-xs text-stone-500">Review before applying</p>
                </div>
                <span className="rounded bg-[#f1f5ee] px-2 py-1 text-xs font-semibold text-[#3f6840]">
                  {reviewAction === 'approved' ? 'Reviewed' : reviewAction === 'editing' ? 'Editing suggestion' : 'Ready to review'}
                </span>
              </div>
              <div className="divide-y divide-stone-100 rounded-md border border-stone-200">
                {suggestedDocuments.slice(0, compact ? 2 : 3).map((document, index) => (
                  <div key={document.name} className={`${index === 2 ? 'hidden sm:block' : 'block'} px-3 py-2.5`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-xs font-semibold text-ink">{document.name}</span>
                      <span className="text-xs font-semibold text-[#3f6840]">{document.category}</span>
                    </div>
                    {!compact && <p className="mt-1 hidden text-xs text-stone-500 sm:block">AI suggestion · {document.detail}</p>}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button type="button" className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-stone-300 px-3 text-xs font-semibold text-stone-600 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss/30" onClick={() => setReviewAction('editing')}>
                  <Pencil size={12} /> Edit suggestion
                </button>
                <button type="button" className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-xs font-semibold text-paper focus:outline-none focus-visible:ring-2 focus-visible:ring-moss/30" onClick={() => setReviewAction('approved')}>
                  <Check size={12} /> Approve
                </button>
              </div>
            </div>
          )}

          {activeStage.id === 'prepare' && (
            <div>
              <div className="mb-4 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#edf3ea] text-[#3f6840]">
                  <FileCheck2 size={18} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">Application data ready</p>
                  <p className="mt-0.5 text-xs text-stone-500">Approved information can continue to desktop preparation.</p>
                </div>
              </div>
              <div className="space-y-2 rounded-md border border-stone-200 px-3 py-3">
                {['Document categories reviewed', 'Drawing details prepared', 'Application information assembled'].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-xs text-stone-600">
                    <CheckCircle2 size={14} className="shrink-0 text-[#3f6840]" /> {item}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs font-semibold text-[#3f6840]">Ready for desktop automation</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
