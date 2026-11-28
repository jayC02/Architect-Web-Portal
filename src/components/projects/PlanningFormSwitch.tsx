import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, TriangleAlert } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';
import { PLANNING_FORM_KEYS, PLANNING_FORMS, type PlanningFormKey } from '@/lib/planning-form';

type Props = {
  applicationId: string;
  form: PlanningFormKey;
  suggestedForm: PlanningFormKey | null;
  currentJobId: string | null;
};

/** Householder or Planning Permission. Opened by the row's Change button. */
export default function PlanningFormSwitch({ applicationId, form, suggestedForm, currentJobId }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const requestId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<PlanningFormKey>(form);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const row = rootRef.current?.closest('details');
    const button = row?.querySelector<HTMLButtonElement>('[data-planning-form-change]');
    if (!row || !button) return;
    // The button sits in the row's summary: open the row and this switch, not toggle the row.
    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      row.open = true;
      setOpen(true);
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
    };
    button.addEventListener('click', onClick);
    return () => button.removeEventListener('click', onClick);
  }, []);

  const cancel = () => { setChoice(form); setError(''); setOpen(false); };
  const save = async () => {
    if (working || choice === form) return;
    setWorking(true);
    setError('');
    try {
      requestId.current ??= crypto.randomUUID();
      await apiRequest('/api/planning/' + encodeURIComponent(applicationId) + '/form', {
        method: 'POST', json: { form: choice, expectedJobId: currentJobId, requestId: requestId.current },
      });
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The form could not be changed. Refresh the project and try again.');
      setWorking(false);
    }
  };

  return <div ref={rootRef} hidden={!open} className="border-b border-stone-100 bg-stone-50/70 px-4 py-4 sm:px-5">
    <p id={`planning-form-${applicationId}`} className="text-sm font-semibold text-ink">Which ePlanning form?</p>
    <div role="radiogroup" aria-labelledby={`planning-form-${applicationId}`} className="mt-3 grid gap-2 sm:grid-cols-2">
      {PLANNING_FORM_KEYS.map((key) => {
        const selected = choice === key;
        return <button key={key} type="button" role="radio" aria-checked={selected} disabled={working} onClick={() => setChoice(key)}
          className={`flex min-w-0 items-start gap-3 rounded-lg border bg-white p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss/30 ${selected ? 'border-moss ring-1 ring-moss' : 'border-stone-200 hover:border-stone-300'}`}>
          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-moss bg-moss text-white' : 'border-stone-300'}`} aria-hidden="true">{selected && <Check size={11} strokeWidth={3} />}</span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-ink">{PLANNING_FORMS[key].label}
              {suggestedForm === key && <span className="text-xs font-medium text-stone-500">Suggested from the drawings</span>}
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-stone-500">{PLANNING_FORMS[key].description}</span>
          </span>
        </button>;
      })}
    </div>
    {choice !== form && <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-amber-800">
      <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{currentJobId
        ? `The prepared run is replaced with a fresh one for ${PLANNING_FORMS[choice].label}.`
        : `Desktop preparation will use the ${PLANNING_FORMS[choice].label} form.`}
      {choice === 'PLANNING_PERMISSION' ? ' Planning Permission asks a few more questions before it can be sent.' : ''}</span>
    </p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-primary gap-2" disabled={working || choice === form} onClick={save}>
        {working && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
        {choice === form ? 'No change' : `Switch to ${PLANNING_FORMS[choice].label}`}
      </button>
      <button type="button" className="btn btn-secondary" disabled={working} onClick={cancel}>Cancel</button>
    </div>
  </div>;
}
