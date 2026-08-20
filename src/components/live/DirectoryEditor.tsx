import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { UK_PHONE_HTML_PATTERN } from '@/lib/validation/client-contact';

export type DirectoryRecord = Record<string, any>;

export function DirectoryDrawer({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close panel" className="absolute inset-0 h-full w-full bg-ink/20 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-stone-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 p-6">
          <div><h2 className="text-xl font-semibold text-ink">{title}</h2><p className="mt-2 text-sm leading-6 text-stone-500">{description}</p></div>
          <button type="button" className="rounded-full p-2 text-stone-500 transition hover:bg-stone-100 hover:text-ink" onClick={onClose} aria-label="Close panel"><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </aside>
    </div>
  );
}

export function ClientForm({ client, onClose }: { client?: DirectoryRecord; onClose: () => void }) {
  const editing = Boolean(client?.id);
  return (
    <form data-api-form data-field-errors data-action={editing ? `/api/clients/${client?.id}` : '/api/clients'} data-method={editing ? 'PATCH' : 'POST'} className="grid gap-4">
      <label className="block"><span className="label">Name</span><input required name="name" defaultValue={client?.name ?? ''} className="field" placeholder="Enter client name" /></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block"><span className="label">Title</span><select name="title" defaultValue={client?.title ?? ''} className="field"><option value="">Not set</option><option>Mr</option><option>Mrs</option><option>Miss</option><option>Ms</option><option>Other</option></select></label>
        <label className="block"><span className="label">First name</span><input name="firstName" defaultValue={client?.firstName ?? ''} className="field" /></label>
        <label className="block"><span className="label">Last name</span><input name="lastName" defaultValue={client?.lastName ?? ''} className="field" /></label>
      </div>
      <label className="block"><span className="label">Company name</span><input name="companyName" defaultValue={client?.companyName ?? ''} className="field" /></label>
      <label className="block"><span className="label">Email</span><input type="email" name="email" maxLength={160} autoComplete="email" defaultValue={client?.email ?? ''} className="field peer invalid:border-red-300" placeholder="Enter email address" aria-describedby="client-email-error" /><p id="client-email-error" data-field-error="email" className="mt-1 hidden text-xs text-red-700 peer-invalid:block">Enter a valid email address.</p></label>
      <label className="block"><span className="label">Phone</span><input type="tel" name="phone" maxLength={20} inputMode="tel" autoComplete="tel" pattern={UK_PHONE_HTML_PATTERN} defaultValue={client?.phone ?? ''} className="field peer invalid:border-red-300" placeholder="07483 882299" aria-describedby="client-phone-error" /><p id="client-phone-error" data-field-error="phone" className="mt-1 hidden text-xs text-red-700 peer-invalid:block">Enter a valid phone number.</p></label>
      <label className="block"><span className="label">Building number</span><input name="buildingNumber" maxLength={40} defaultValue={client?.buildingNumber ?? ''} className="field" /></label>
      <label className="block"><span className="label">Address line 1</span><input name="addressLine1" defaultValue={client?.addressLine1 ?? ''} className="field" /></label>
      <label className="block"><span className="label">Address line 2</span><input name="addressLine2" defaultValue={client?.addressLine2 ?? ''} className="field" /></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="label">Town/city</span><input name="townCity" defaultValue={client?.townCity ?? ''} className="field" /></label><label className="block"><span className="label">Postcode</span><input name="postcode" defaultValue={client?.postcode ?? ''} className="field" /></label></div>
      <label className="block"><span className="label">Country</span><input name="country" defaultValue={client?.country ?? ''} className="field" placeholder="United Kingdom" /></label>
      <details className="rounded-md border border-stone-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Legacy address</summary><textarea name="address" rows={3} defaultValue={client?.address ?? ''} className="field mt-3" placeholder="Used only by older project records" /></details>
      <label className="block"><span className="label">Notes</span><textarea name="notes" rows={4} defaultValue={client?.notes ?? ''} className="field" placeholder="Add any notes about this client" /></label>
      <button className="btn btn-primary w-full">Save client</button>
      <button type="button" className="btn btn-secondary w-full" onClick={onClose}>Cancel</button>
      <p data-form-status className="text-sm text-stone-500" />
    </form>
  );
}

export function SiteForm({ site, onClose }: { site?: DirectoryRecord; onClose: () => void }) {
  const editing = Boolean(site?.id);
  return <form data-api-form data-field-errors data-action={editing ? `/api/sites/${site?.id}` : '/api/sites'} data-method={editing ? 'PATCH' : 'POST'} className="grid gap-4"><label className="block"><span className="label">Building number</span><input required name="buildingNumber" maxLength={40} defaultValue={site?.buildingNumber ?? ''} className="field" placeholder="Enter building number" /></label><label className="block"><span className="label">Address line 1</span><input required name="addressLine1" defaultValue={site?.addressLine1 ?? ''} className="field" placeholder="Enter street or address line 1" /></label><label className="block"><span className="label">Address line 2</span><input name="addressLine2" defaultValue={site?.addressLine2 ?? ''} className="field" placeholder="Enter address line 2" /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="label">Town/city</span><input required name="townCity" defaultValue={site?.townCity ?? ''} className="field" placeholder="Town or city" /></label><label className="block"><span className="label">Postcode</span><input required name="postcode" defaultValue={site?.postcode ?? ''} className="field" placeholder="Postcode" /></label></div><label className="block"><span className="label">Local authority</span><input name="localAuthority" defaultValue={site?.localAuthority ?? ''} className="field" placeholder="Local authority" /></label><label className="block"><span className="label">Notes</span><textarea name="notes" rows={4} defaultValue={site?.notes ?? ''} className="field" placeholder="Add any notes about this site" /></label><button className="btn btn-primary w-full">Save site</button><button type="button" className="btn btn-secondary w-full" onClick={onClose}>Cancel</button><p data-form-status className="text-sm text-stone-500" /></form>;
}
