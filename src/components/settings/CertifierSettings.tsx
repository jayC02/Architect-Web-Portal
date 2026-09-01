import { type FormEvent, useRef, useState } from 'react';
import { Check, Pencil, Plus, UserRoundCheck, X } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';
import { CERTIFIER_REGISTRATION_PART1_CODES } from '@/lib/certifier-registration';

type CertifierPreset = {
  id: string;
  displayName: string;
  schemeType: string | null;
  registrationAPart1: string | null;
  registrationAPart2: string | null;
  registrationBPart1: string | null;
  registrationBPart2: string | null;
  certifierName: string | null;
  approvedBody: string | null;
  isDefault: boolean;
};

type Props = { initialPresets: CertifierPreset[]; canManage: boolean };

const registration = (prefix?: string | null, number?: string | null) => [prefix, number].filter(Boolean).join('');

export default function CertifierSettings({ initialPresets, canManage }: Props) {
  const [presets, setPresets] = useState(initialPresets);
  const [editing, setEditing] = useState<CertifierPreset | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  const open = (preset: CertifierPreset | null) => {
    setEditing(preset);
    setError('');
    dialogRef.current?.showModal();
  };
  const close = () => {
    dialogRef.current?.close();
    setEditing(undefined);
    setError('');
  };
  const refresh = async () => {
    const result = await apiRequest<{ certifierPresets: CertifierPreset[] }>('/api/settings/certifier-presets');
    setPresets(result.certifierPresets);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      await apiRequest(editing ? `/api/settings/certifier-presets/${editing.id}` : '/api/settings/certifier-presets', {
        method: editing ? 'PATCH' : 'POST',
        json: { ...payload, isDefault: form.get('isDefault') === 'on' },
      });
      await refresh();
      close();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The certifier could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="max-w-4xl" aria-labelledby="saved-certifiers-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="saved-certifiers-heading" className="text-lg font-semibold text-ink">Saved certifiers</h2>
        {canManage && <button type="button" className="btn btn-primary gap-2" onClick={() => open(null)}><Plus size={16} aria-hidden="true" />Add certifier</button>}
      </div>

      <div className="mt-4 space-y-3">
        {presets.length ? presets.map((preset) => {
          const registrations = [registration(preset.registrationAPart1, preset.registrationAPart2), registration(preset.registrationBPart1, preset.registrationBPart2)].filter(Boolean);
          return <article key={preset.id} className="panel flex flex-col gap-4 rounded-lg p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600"><UserRoundCheck size={19} aria-hidden="true" /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{preset.certifierName || preset.displayName}</h3>
                  {preset.isDefault && <span className="inline-flex items-center gap-1 rounded bg-[#eef3e9] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-moss"><Check size={12} aria-hidden="true" />Default</span>}
                </div>
                <p className="mt-1 text-sm text-stone-600">{[preset.schemeType, ...registrations].filter(Boolean).join(' · ') || 'Registration not set'}</p>
                {preset.approvedBody && <p className="mt-1 text-xs text-stone-500">Approved body: {preset.approvedBody}</p>}
                {preset.certifierName && preset.certifierName !== preset.displayName && <p className="mt-1 text-xs text-stone-500">Saved as {preset.displayName}</p>}
              </div>
            </div>
            {canManage && <button type="button" className="btn btn-secondary gap-2 self-start sm:self-auto" onClick={() => open(preset)} aria-label={`Edit ${preset.certifierName || preset.displayName}`}><Pencil size={15} aria-hidden="true" />Edit</button>}
          </article>;
        }) : <div className="panel rounded-lg p-8 text-center"><UserRoundCheck className="mx-auto text-stone-400" size={28} aria-hidden="true" /><p className="mt-3 font-semibold text-ink">No certifiers saved yet</p><p className="mt-1 text-sm text-stone-500">Add a certifier to reuse their details on Building Warrant applications.</p>{canManage && <button type="button" className="btn btn-primary mt-5 gap-2" onClick={() => open(null)}><Plus size={16} aria-hidden="true" />Add certifier</button>}</div>}
      </div>
      {!canManage && <p className="mt-4 text-sm text-stone-500">An organisation owner or admin can add and edit certifiers.</p>}

      <dialog ref={dialogRef} onCancel={close} className="settings-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100%-2rem))] overflow-y-auto rounded-xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40">
        <form key={editing?.id ?? 'new'} onSubmit={(event) => void save(event)} className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="text-xl font-semibold">{editing ? 'Edit certifier' : 'Add certifier'}</h2><p className="mt-1 text-sm text-stone-500">These details are reused when preparing Building Warrant applications.</p></div>
            <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-moss/40" onClick={close} aria-label="Close certifier editor"><X size={20} aria-hidden="true" /></button>
          </div>

          <fieldset disabled={saving} className="mt-6 space-y-6">
            <section aria-labelledby="certifier-details-heading"><h3 id="certifier-details-heading" className="text-sm font-semibold text-ink">Certifier details</h3><div className="mt-3 grid gap-4 sm:grid-cols-2"><label className="block"><span className="label">Saved name</span><input required autoFocus name="displayName" defaultValue={editing?.displayName ?? ''} className="field" /></label><label className="block"><span className="label">Certifier name</span><input name="certifierName" defaultValue={editing?.certifierName ?? ''} className="field" /></label><label className="block sm:col-span-2"><span className="label">Approved body</span><input name="approvedBody" defaultValue={editing?.approvedBody ?? ''} className="field" /></label></div></section>
            <section aria-labelledby="registration-heading" className="border-t border-stone-200 pt-6"><h3 id="registration-heading" className="text-sm font-semibold text-ink">Registration</h3><div className="mt-3 grid gap-4 sm:grid-cols-2"><label className="block sm:col-span-2"><span className="label">Scheme type</span><input name="schemeType" defaultValue={editing?.schemeType ?? ''} className="field" placeholder="For example, SER" /></label><label className="block"><span className="label">Registration A prefix</span><select name="registrationAPart1" defaultValue={editing?.registrationAPart1 ?? ''} className="field"><option value="">Select prefix</option>{CERTIFIER_REGISTRATION_PART1_CODES.map((code) => <option key={code} value={code}>{code}</option>)}</select></label><label className="block"><span className="label">Registration A number</span><input name="registrationAPart2" defaultValue={editing?.registrationAPart2 ?? ''} className="field" /></label><label className="block"><span className="label">Registration B prefix</span><select name="registrationBPart1" defaultValue={editing?.registrationBPart1 ?? ''} className="field"><option value="">Select prefix</option>{CERTIFIER_REGISTRATION_PART1_CODES.map((code) => <option key={code} value={code}>{code}</option>)}</select></label><label className="block"><span className="label">Registration B number</span><input name="registrationBPart2" defaultValue={editing?.registrationBPart2 ?? ''} className="field" /></label></div></section>
            <label className="flex items-start gap-3 border-t border-stone-200 pt-6 text-sm"><input type="checkbox" name="isDefault" defaultChecked={Boolean(editing?.isDefault)} className="mt-0.5 h-4 w-4 accent-[#526a4a]" /><span><span className="block font-semibold text-ink">Use as organisation default</span><span className="mt-1 block text-stone-500">New Building Warrant applications will select this certifier first.</span></span></label>
          </fieldset>
          {error && <p role="alert" className="mt-4 text-sm font-semibold text-red-700">{error}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-stone-200 pt-5 sm:flex-row sm:justify-end"><button type="button" className="btn btn-secondary" disabled={saving} onClick={close}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save certifier' : 'Add certifier'}</button></div>
        </form>
      </dialog>
    </section>
  );
}
