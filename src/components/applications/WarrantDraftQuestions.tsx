// Building Warrant questions in the New application review. Each question is a tick box with the
// usual answer already selected; ticking one that needs more detail opens its follow-up directly
// underneath. Field names and limits match the Building Warrant details page.
import type { ReactNode } from 'react';
import { draftDesignCertificateTiming, OWNER_DRAFT_FIELDS, warrantTick, type WarrantTickKey } from '@/lib/building-warrant-draft-answers';

type Confirmations = Record<string, boolean | string | number | null | undefined>;
type Update = (key: string, value: boolean | string | number | null) => void;

const OWNER_REQUIRED = new Set(['title', 'firstName', 'lastName', 'telephone', 'email', 'addressLine1', 'townCity', 'country', 'postcode']);

const textValue = (confirmations: Confirmations, key: string) => {
  const value = confirmations[key];
  return typeof value === 'string' ? value : '';
};

function Tick({ confirmations, update, name, label, children, showWhen = true }: {
  confirmations: Confirmations;
  update: Update;
  name: WarrantTickKey;
  label: string;
  children?: ReactNode;
  showWhen?: boolean;
}) {
  const checked = warrantTick(confirmations, name);
  return (
    <div className="border-b border-stone-100" data-warrant-question={name}>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6 text-ink">
        <input type="checkbox" checked={checked} onChange={(event) => update(name, event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#526a4a]" />
        <span>{label}</span>
      </label>
      {children && checked === showWhen ? <div className="mb-3 ml-[7px] mt-1 min-w-0 border-l-2 border-stone-300 pl-5" data-warrant-follow-up={name}>{children}</div> : null}
    </div>
  );
}

function TextInput({ confirmations, update, name, label, max, type = 'text', multiline = false, placeholder }: {
  confirmations: Confirmations;
  update: Update;
  name: string;
  label: string;
  max: number;
  type?: 'text' | 'email' | 'date';
  multiline?: boolean;
  placeholder?: string;
}) {
  const value = textValue(confirmations, name);
  const change = (next: string) => update(name, next === '' ? null : next);
  return (
    <label className="block">
      <span className="label">{label}</span>
      {multiline
        ? <textarea className="field" rows={3} maxLength={max} value={value} onChange={(event) => change(event.target.value)} />
        : <input className="field" type={type} maxLength={type === 'date' ? undefined : max} value={value} placeholder={placeholder} onChange={(event) => change(event.target.value)} />}
    </label>
  );
}

function Choice({ confirmations, update, name, label, options, question = false }: {
  confirmations: Confirmations;
  update: Update;
  name: string;
  label: string;
  options: Array<[string, string]>;
  question?: boolean;
}) {
  const raw = confirmations[name];
  const value = typeof raw === 'boolean' ? String(raw) : typeof raw === 'string' ? raw : '';
  return (
    <label className="block">
      <span className={question ? 'mb-1 block text-sm font-medium leading-5 text-ink' : 'label'}>{label}</span>
      <select className="field" value={value} onChange={(event) => {
        const next = event.target.value;
        update(name, next === '' ? null : next === 'true' ? true : next === 'false' ? false : next);
      }}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

// The portal's question, No unless changed. No means the certificate follows the
// application (the portal's second answer is then Yes); Yes opens the register
// that asks for the certificate number and signature dates.
function DesignCertificateTiming({ confirmations, update }: { confirmations: Confirmations; update: Update }) {
  const timing = draftDesignCertificateTiming(confirmations);
  return (
    <div className="mt-3 grid gap-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium leading-5 text-ink">I will be uploading a certificate of design with this application</span>
        <select className="field" name="designCertificateWithApplication" value={String(timing.designCertificateWithApplication)}
          onChange={(event) => update('designCertificateWithApplication', event.target.value === 'true')}>
          <option value="false">No</option><option value="true">Yes</option>
        </select>
        <span className="mt-1 block text-sm text-stone-600">No means the certificate will be submitted following this application.</span>
      </label>
      {timing.designCertificateWithApplication && <div className="grid gap-4 sm:grid-cols-3">
        <TextInput confirmations={confirmations} update={update} name="designCertificateNumber" label="Design certificate number" max={40} />
        <TextInput confirmations={confirmations} update={update} name="designCertifierSignatureDate" label="Date the certifier signed" max={10} type="date" />
        <TextInput confirmations={confirmations} update={update} name="designApprovedBodySignatureDate" label="Date the approved body signed" max={10} type="date" />
      </div>}
    </div>
  );
}

export function WarrantCertificateQuestions({ confirmations, update }: { confirmations: Confirmations; update: Update }) {
  const props = { confirmations, update };
  return (
    <div className="border-t border-stone-100 lg:col-span-2" data-warrant-certificates>
      <Tick {...props} name="certifierOfDesignCertificateAvailable" label="Will the appropriate Certifier of Design certificate be provided?">
        <DesignCertificateTiming {...props} />
      </Tick>
      <Tick {...props} name="approvedCertifierOfConstruction" label="Will an approved certifier of construction be used?">
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice {...props} name="constructionSchemeType" label="Certification scheme" options={[['', 'Choose a scheme'], ['1', 'Drainage, Heating and Plumbing'], ['2', 'Electrical Installations to BS 7671']]} />
          <TextInput {...props} name="constructionCertifierName" label="Name of construction certifier" max={160} />
          <TextInput {...props} name="constructionRegistrationNumber" label="Certifier registration number" max={80} />
          <TextInput {...props} name="constructionApprovedBody" label="Name of approved body" max={160} />
          <TextInput {...props} name="constructionApprovedBodyRegistrationNumber" label="Approved-body registration number" max={80} />
          <div className="sm:col-span-2"><TextInput {...props} name="constructionWorkTypeDetails" label="Known work-type details for the scheme" max={750} multiline /></div>
        </div>
        <div className="mt-2 border-t border-stone-100">
          <Tick {...props} name="certifierOfConstructionCertificateAvailable" label="Will the appropriate Certifier of Construction certificate be provided?" />
        </div>
      </Tick>
    </div>
  );
}

export function WarrantConfirmationQuestions({ confirmations, update, showSTAS, clientName }: {
  confirmations: Confirmations;
  update: Update;
  showSTAS: boolean;
  clientName: string;
}) {
  const props = { confirmations, update };
  const ownerIsClient = confirmations.ownerIsClient;
  return (
    <div className="border-t border-stone-100" data-warrant-confirmations>
      <Tick {...props} name="applicantIsOwner" label="Applicant is the legal owner" showWhen={false}>
        <Choice {...props} name="ownerIsClient" question label={`Is the owner the saved client, ${clientName}?`} options={[['', 'Choose Yes or No'], ['true', 'Yes — use the saved client details'], ['false', 'No — enter a different owner']]} />
        {ownerIsClient === true ? <p className="mt-2 text-sm text-stone-500">The client's saved name, contact details and address will be used.</p> : null}
        {ownerIsClient === false ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {OWNER_DRAFT_FIELDS.filter(([key]) => key !== 'otherTitle' || textValue(confirmations, 'ownerTitle') === 'Other').map(([key, formKey, label, max]) => key === 'title'
              ? <Choice key={key} {...props} name={formKey} label={`${label} *`} options={[['', 'Choose a title'], ...['Mr', 'Mrs', 'Miss', 'Ms', 'Other'].map((title) => [title, title] as [string, string])]} />
              : <TextInput key={key} {...props} name={formKey} label={`${label}${OWNER_REQUIRED.has(key) ? ' *' : ''}`} max={max} type={key === 'email' ? 'email' : 'text'} placeholder={key === 'country' ? 'United Kingdom' : undefined} />)}
            <p className="text-sm text-stone-500 sm:col-span-2">Provide a building name, building number, or both.</p>
          </div>
        ) : null}
      </Tick>
      <Tick {...props} name="fireAndRescueServiceEnforcingAuthority" label="Fire and Rescue Service is the enforcing authority" showWhen={false}>
        <TextInput {...props} name="fireAuthorityName" label="Fire-authority name" max={20} />
        <p className="mt-1 text-sm text-stone-500">Required when Fire and Rescue Service is not the enforcing authority. Maximum 20 characters.</p>
      </Tick>
      <Tick {...props} name="listedBuildingOrConservationArea" label="Building is listed or within a conservation area">
        <TextInput {...props} name="listingCategory" label="Listing category or conservation-area details" max={750} multiline />
      </Tick>
      <Tick {...props} name="otherHistoricalImportance" label="Building has other historical importance">
        <TextInput {...props} name="historicalBuildingDetails" label="Historical-importance details" max={750} multiline />
      </Tick>
      <Tick {...props} name="scottishMinistersRelaxationDirection" label="Work is subject to a Scottish Ministers relaxation direction">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <TextInput {...props} name="relaxationReference" label="Scottish Ministers relaxation-direction reference" max={750} />
          <TextInput {...props} name="relaxationDate" label="Relaxation-direction date" max={10} type="date" />
        </div>
        <p className="mt-1 text-sm text-stone-500">Add further directions on the Building Warrant details page.</p>
      </Tick>
      <Tick {...props} name="dangerousBuildingNotice" label="Building is subject to a dangerous building notice">
        <TextInput {...props} name="dangerousBuildingReferences" label="Dangerous-building notice reference numbers" max={750} multiline />
      </Tick>
      {showSTAS ? (
        <Tick {...props} name="coveredBySTAS" label="Proposals are covered by STAS">
          <TextInput {...props} name="stasReference" label="STAS approval reference" max={20} />
        </Tick>
      ) : null}
      <Tick {...props} name="disabledPersonsFacilitiesOnly" label="All work is solely for qualifying disabled-person facilities" />
    </div>
  );
}
