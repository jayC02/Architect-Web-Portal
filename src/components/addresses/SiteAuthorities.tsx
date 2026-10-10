export default function SiteAuthorities({ site = {} }: { site?: Record<string, any> }) {
  return <details className="rounded-md border border-stone-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Application authorities</summary><p className="mt-2 text-xs text-stone-600">Postcode geography suggests an administrative area. Confirm planning and building standards separately, particularly for national parks or boundaries. Legacy values remain unverified.</p>
    <label className="mt-3 block"><span className="label">Administrative area (geography)</span><input name="administrativeAuthority" className="field" defaultValue={site.administrativeAuthority ?? ''} readOnly /></label>
    <label className="mt-3 block"><span className="label">Planning authority</span><input name="planningAuthority" className="field" defaultValue={site.planningAuthority ?? ''} /></label>
    <label className="mt-3 block"><span className="label">Building standards authority</span><input name="buildingStandardsAuthority" className="field" defaultValue={site.buildingStandardsAuthority ?? ''} /></label>
    <label className="mt-3 block"><span className="label">Authority confirmation</span><select name="authorityVerification" className="field" defaultValue={site.authorityVerification ?? 'legacy-unverified'}><option value="legacy-unverified">Legacy / unverified</option><option value="suggested">Suggested — needs confirmation</option><option value="confirmed">I confirm the application authorities</option></select></label>
  </details>;
}
