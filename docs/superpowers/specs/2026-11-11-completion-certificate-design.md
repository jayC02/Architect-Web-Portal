# Completion Certificate — Main Details: Design

Date: 2026-11-11
Status: awaiting review

## Goal

Architects can prepare a completion certificate from an existing building warrant in Architect Pro and have the Agent fill the **Completion Certificate → Main Details** section in eBuilding Standards. The run ends when the portal shows Main Details as completed. The architect then reviews the form in the portal.

Out of scope for this phase: supporting-document uploads, the declaration, fee and submission. A relevant person who is not the owner, a different building address, and partial completion are also out of scope (see Fixed answers).

## Repositories

| Repository | Path | Role |
|---|---|---|
| Website | `D:\Jayveer\Documents\websites\Architect Web Portal` | Astro/React/Prisma. Preparation page, job contract, queue. |
| Agent | `C:\Users\Jayveer\Building Portal` | Python/Selenium/Qt, currently 4.2.14. Portal automation. |

Release order is fixed: **the website deploys first**, then Agent 4.2.15 is published. The website validates Agent capabilities with a strict list of workflow names, so an Agent advertising a workflow the deployed website does not know would have its heartbeat rejected.

## Fixed answers

These are not editable in this phase. The preparation page shows them so the architect can confirm the project fits.

| Portal question | Answer |
|---|---|
| Did you obtain a building warrant for this? | Yes |
| Building regulations compliance / warrant enforcement / defective buildings notice references | N/A (typed into each box, as on the warrant) |
| Subject to any Dangerous building notice(s)? | No |
| Relevant person or agent? | Agent |
| Use your registered account details? | Yes |
| Relevant person is an individual or organisation? | Individual |
| Is the Relevant Person the owner of the building? | Yes |
| Building address different from the associated warrant? | No |
| Does this submission cover all the work under the warrant? | Yes |

Follow-up items recorded in code comments and this spec: owner is not the relevant person; partial completion; organisation as relevant person; different building address.

## Data model (website)

One migration:

- `AutomationJobType` gains `COMPLETION_CERTIFICATE`.
- `BuildingWarrantApplication` gains `completionPreparationData Json?` and `completionPreparedAt DateTime?`.

`completionPreparationData` is separate from `preparationData`. Saving completion answers never writes to the original warrant's preparation data, description, certifier selection or status.

`completionCertificateStatus` (existing enum) moves to `DRAFTING` when a completion job is first queued. It is not changed by the Agent reporting Main Details completed. `SUBMITTED` and later remain manual.

### Completion preparation shape

```ts
type CertificateEntry = {
  certificateNumber: string;                 // required, ≤ 80
  certifierRegistration: { part1: string; part2: string; number: string };
  certifierSignatureDate: string;            // ISO date
  approvedBodyRegistration: { part1: string; part2: string; number: string };
  approvedBodySignatureDate: string;         // ISO date
  documentId: string | null;                 // associated supporting document, for the later upload phase
};

type CompletionPreparation = {
  workCompletedDate: string | null;          // ISO date, never defaulted to today
  warrantReference: string | null;
  warrantDate: string | null;                // ISO date
  amendmentDates: string | null;             // ≤ 750
  relaxation: { applies: boolean | null; reference: string | null; date: string | null };
  constructionCertificates: { accompany: boolean | null; entries: CertificateEntry[] };   // ≤ 20 entries
  designCertificates: {
    accompaniedWarrant: boolean | null;
    formQRequired: boolean | null;           // only asked when accompaniedWarrant is true
    entries: CertificateEntry[];             // Form Q entries, ≤ 20
  };
  energyPerformanceCertificate: boolean | null;
  sustainabilityStatement: boolean | null;
  fireSafetyDesignSummary: boolean | null;
  continuingRequirements: { applies: boolean | null; details: string | null };            // details ≤ 750
  confirmedAt: string | null;                // set when the architect confirms the review
};
```

Registration options, taken from the portal:

| Register | Part 1 | Part 2 (certifier) | Part 2 (approved body) |
|---|---|---|---|
| Construction (`CertificatesRegister`) | `NIC1`, `SEL1`, `SNP1` | `C` | `CB` |
| Design / Form Q (`CertificatesRegister1`) | `BRE1`, `BRE2`, `RIA1`, `RIA2`, `SER1` (existing `CERTIFIER_REGISTRATION_PART1_CODES`) | `D` | `DB` |

Part 2 is fixed by register, so the website stores it but does not ask for it. Part 1 is a dropdown.

## Website

### Entry point

The Building Warrant card on the project page (`ApplicationSummaryCard` in `src/pages/projects/[id].astro`) shows **Prepare Completion Certificate** when the warrant's status is `SUBMITTED` or later. It links to the preparation page.

### Preparation page

- Page: `/building-warrant/[id]/completion-certificate/preparation`
- API: `GET` and `PATCH /api/building-warrant/[id]/completion-certificate/preparation`, organisation-scoped, with the same origin check, rate limit and Zod validation as the existing warrant preparation endpoint.

`GET` returns saved answers merged over prefill. Prefill sources, used only where no saved answer exists:

| Field | Prefill |
|---|---|
| Work-completed date | None. Required entry. |
| Warrant reference | `warrantReference` |
| Warrant date | `grantedDate` |
| Amendment dates | Granted dates of other warrant records on the same project with type `AMENDMENT`, one per line as `dd/mm/yyyy` |
| Relaxation | Warrant `preparationData`: `scottishMinistersRelaxationDirection`, first relaxation reference and date |
| Construction certificates accompany | Warrant `approvedCertifierOfConstruction`; entries start empty |
| Design certificates accompanied warrant | Warrant `designCertifierSelected`; a first Form Q entry is prefilled from the saved certifier's registration parts |
| Sustainability statement | True when the warrant has sustainability data; still needs confirmation |
| EPC, fire safety, continuing requirements | None. Required entry. |
| Agent details | Organisation defaults (read-only here, edited in Settings) |
| Relevant person | Project client (read-only here, with a link to edit the client) |

The page has repeatable certificate entries for the construction register and the Form Q register, a list of missing required information, the fixed answers table, and a **Confirm and send to Agent** action that is disabled while anything is missing.

### Validation (blocks queueing)

- Work-completed date, warrant reference and warrant date present; dates valid and not in the future.
- Amendment dates and continuing requirements ≤ 750 characters.
- Client has title, first name, last name, building name or number, address line 1, town, country, and postcode when the country is in the UK. Title `Other` needs an other-title value (existing client rule).
- Agent defaults complete (existing rule).
- Relaxation Yes needs reference and date.
- Construction certificates Yes needs at least one complete entry.
- Design certificates Yes needs a Form Q answer; Form Q Yes needs at least one complete entry.
- EPC, sustainability, fire safety and continuing requirements each answered; continuing requirements Yes needs the wording.

### Job contract

Snapshot v2 (`automationJobSnapshotV2Schema`) gains an optional section. Existing snapshots stay valid.

```ts
completionCertificate: {
  sourceWarrantId: string;
  proposalHint: { proposalName: string | null };   // site address as used for the proposal name
  ...CompletionPreparation fields with every nullable answer resolved,
  fixedAnswers: { warrantObtained: true, dangerousBuildingNotice: false, actingAs: 'AGENT',
    useAccountDetails: true, relevantPersonType: 'INDIVIDUAL', relevantPersonIsOwner: true,
    differentBuildingAddress: false, coversAllWork: true },
  updatedAt: string;
} | null
```

A completion job has `metadata.applicationType = COMPLETION_CERTIFICATE`, `planning: null`, `buildingWarrant: null`, and an empty `documents` list. Its application identity is `completionCertificate.sourceWarrantId`. Because it carries no `buildingWarrant.recordId`, it cannot be selected as the warrant's own current run.

`preflight.locationPlanStatus` gains the value `NOT_APPLICABLE`, used only by completion jobs, since they carry no documents.

`metadata.sourceUpdatedAt` covers the warrant row, client, site and organisation defaults, so the existing stale-snapshot rule applies: changing a reviewed input requires preparing again before another run.

### Job-type audit

About 44 source files branch on job type, most as "building warrant, otherwise planning". Each is reviewed and given an explicit completion branch or an explicit exclusion. The ones that must change:

- `resolveAutomationJobIdentity` and `selectCurrentAutomationJob` (`desktop-automation-status.service.ts`): third identity branch.
- `agentCapabilitiesSchema` (`validation/desktop-agent.ts`): accept `COMPLETION_CERTIFICATE`.
- `automation-jobs.service.ts`: snapshot builder for the new type.
- `automation-preflight.service.ts`: completion preflight using the validation rules above.
- Labels and routing in `AgentQueueDropdown`, `DesktopAutomationLiveCard`, `AutomationFailureRecovery`, `automation-job/[id].astro`, `automation-jobs.astro`.
- Lifecycle handlers: a completion job result must not change `WarrantStatus`, deadlines, Xero milestones or calendar events.
- Reset and restart services: a completion job is restartable; Reset Building Warrant does not touch it.
- Fees: no fee calculation for completion jobs.

Older Agents never receive completion jobs: `agentSupportsJob` already requires the job type to appear in the Agent's advertised workflows. When no compatible Agent is online, the existing "Agent update required" notice appears.

### Result

The existing callback contract is unchanged. A successful run reports `COMPLETED` with outcome `completed_to_final_review` (the Agent's existing success mapping) and the summary "Completion Certificate Main Details completed". The completion preparation page shows the run's progress and result; `/automation-job/<id>` redirects a completion job there. The Agent leaves the form open in the browser for review, and its open-for-review command reopens the same form without ever adding one.

## Agent

Version 4.2.15. `CAPABILITIES["workflows"]` adds `COMPLETION_CERTIFICATE`.

### Structure

New package `automation/completion_certificate/`:

| Module | Responsibility |
|---|---|
| `run.py` | `main(...)` with the same signature as the warrant workflow; validates inputs, drives the stages in order. |
| `proposal.py` | Find and open the source proposal; add or reopen the Completion Certificate form. |
| `navigation.py` | `click_next` and `wait_for_step` bound to the `CompletionCertificateAppWizard` prefix. |
| `details.py` | Completion and warrant details, notices, applicant-or-agent, ownership, extent, relaxation, EPC, sustainability, fire safety, continuing requirements. |
| `certificates.py` | Both certificate registers. |

Shared code changes:

- `automation/models.py`: `COMPLETION_TYPES`; `RuntimeJob` accepts the type.
- `automation/runner.py`: `_workflow_for` dispatches three ways and raises on an unknown type instead of defaulting to building warrant.
- `gui/services/portal_handoff.py`: accept the job type, validate the `completionCertificate` section, map it to runtime inputs, resolve identity from `sourceWarrantId`.
- `automation/building_warrant/agent.py`, `applicant.py`: take a wizard prefix parameter (default unchanged) so the completion workflow reuses them.
- `automation/building_warrant/certificates.py`: `check_certificate_validation` and `_select_text` are reused as-is.
- `automation/progress.py`: a `completion_certificate` stage profile: validation, browser, login, proposal, completion_form, main_details, final_review.
- `gui/agent_app.py`: label for the new type.

### Stage 1: find the proposal

1. Sign in with the existing eBuilding Standards login and open My Proposals (`myproposals.aspx`; the `ctl00$sideBar$ctl03` button is the fallback).
2. Resolve the proposal in this order:
   1. **Saved identity.** The Agent's local proposal state holds the proposal reference for warrants it created. Match on project ID, building-warrant type and site address; use the newest entry. Open it by proposal reference.
   2. **Name match.** Exactly one proposal in the list whose name equals the site address (existing normalised comparison).
   3. **Architect selects.** Otherwise report `USER_ACTION_REQUIRED` at stage `proposal`, reveal the browser on My Proposals, and wait up to ten minutes for the Proposal Summary page (`MainContent_ProposalSummaryWizard_LinkBtnAddForm` present). Then continue.
3. Before editing, confirm the Proposal Summary's address (the Summary panel heading, e.g. `112 RALSTON AVENUE, GLASGOW, G52 3NB`) matches the job's site address using the existing normalised comparison, and read the Proposal Reference from the same panel. If the address does not match, stop with a review-portal failure naming both addresses.

The Proposal Summary shows the address and the Proposal Reference but not the council's warrant number, so the address is the on-screen check. The Building Warrant form itself is not required to be present: once submitted it moves to Submitted Forms and the portal removes it 90 days later.

### Stage 2: open the completion form

An added form appears as a link under **Draft Forms** on the Proposal Summary. Count the links there whose text is exactly `Completion Certificate` (IDs start `MainContent_ProposalSummaryWizard_btnEditForm`; the numeric suffix is never hardcoded).

- **One:** click it.
- **More than one:** stop with a review-portal failure naming the duplicates.
- **None in Draft Forms, one in Submitted Forms:** stop; the completion certificate has already been submitted.
- **None:** `LinkBtnAddForm` → select `AddAdditionalFormsWizard_UseList` → `btnContinue` → tick the label `Completion Certificate` (`AddAdditionalFormsWizard_T1`, matched by label text) → click **Add** (`MainContent_AddAdditionalFormsWizard_btnAddForms`) once → wait for exactly one `Completion Certificate` link under Draft Forms → click it.

Add is never repeated. If the link does not appear after Add, the run stops as uncertain and the next run takes the reuse branch.

Clicking the link lands on the form's Form Summary; the Agent opens Main Details (`MainContent_FormSections_btnMainDetails`) and waits for the wizard's Next button.

### Stage 3: Main Details

Wizard prefix `MainContent_CompletionCertificateAppWizard_`. Radios are answered by clicking their label. The portal's spelling `rbSumissionCoverYes` is kept.

| # | Screen | Marker awaited | Action |
|---|---|---|---|
| 1 | Introduction | Next button | Next |
| 2 | Completion and warrant | `txtDateWorkCompleted` | Work-completed date; `rbObtainBWYes`; `BuildingWarrantDetails_txtBuildingWarrantRefNumber`; `txtBuildingWarrantDate`; `BuildingWarrantDetails_txtAmendmentDates`; Next |
| 3 | Notices | `rbDangerousBuildingNo` | Leave three references blank; `rbDangerousBuildingNo`; Next |
| 4 | Applicant or agent | `ApplicantOrAgent_rbAgent` | `rbAgent`; `rbAccountYes`; Next |
| 5 | Agent details | `AgentDetails_txtAgentFirstName` | Existing agent-details fill; `rblIndividualOrOrganisation_0`; Next |
| 6 | Relevant person | `ApplicantDetails_txtApplicantFirstName` | Existing applicant fill, including Other title; Next |
| 7 | Ownership and address | `rbApplicantOwnerYes` | `rbApplicantOwnerYes`; `rbDifferentAddressNo`; Next |
| 8 | Extent and relaxation | `rbSumissionCoverYes` | `rbSumissionCoverYes`; `rbRelaxationDirectionYes`/`No`; if Yes `RelaxationDirections_txtReferenceNumber` and `txtRelaxDirDate`; Next |
| 9 | Construction certificates | `CertificatesRegisterQuestion_rbCertificatesAccompanyYes` | Yes/No; Next; if Yes fill register `CertificatesRegister_`, then Next |
| 10 | Design certificates | `rbDesignCertificatesAccompanyYes` | Yes/No; Next |
| 11 | Form Q (only after Yes at 10) | `rbNoticeOfDesignDetailsYes` | Yes/No; Next; if Yes fill register `CertificatesRegister1_`, then Next |
| 12 | EPC | `rbEnergyPerformanceYes` | Yes/No; Next |
| 13 | Sustainability | `rbSustainabilityYes` | Yes/No; Next |
| 14 | Fire safety | `rbFireSafetyYes` | Yes/No; Next |
| 15 | Continuing requirements | `rbContinuingRequirementsYes` | Yes/No; if Yes `txtContinuingRequirements`; Next |
| 16 | Finish | Final Next | Next; confirm completion |

Rules:

- **Missing Next buttons.** Where the mapping does not show a Next between two questions (rows 7–8, relaxation follow-up, continuing-requirements follow-up), the Agent first checks whether the next marker is already visible. It clicks Next only when it is not. This is the existing `ensure_follow_up` pattern.
- **After every Next** the Agent waits for the destination marker. If it does not appear, the run stops; Next is not repeated.
- **Postbacks.** Controls are located again after each postback, and each typed value is read back before moving on.
- **Dates** are ISO in the snapshot and typed as `dd/mm/yyyy`. `txtDateWorkCompleted`, `txtBuildingWarrantDate`, `txtRelaxDirDate`, `txtCertifierSignatureDate` and `txtApprovedBodySignatureDate` are standalone IDs.
- **Saved answers.** The portal keeps answers from an earlier run. On each screen the Agent compares what is already there with the reviewed value and changes it only when it differs, then clicks Next. A rerun therefore steps through the saved screens with Next and resumes real entry where the earlier run stopped, while still correcting anything that no longer matches the reviewed answers.
- **Completion.** After the final Next, success requires `MainContent_FormSections_btnSupportingDocumentation` to be clickable on the Form Summary. This is the same signal the building-warrant workflow uses. The Agent does not click it; supporting documents belong to the next phase. If it does not become clickable, the run ends as needs-review, not success.

### Certificate registers

For each entry, in order:

1. Select scheme type (`Construction` or `Design`) and wait for the postback to populate the registration dropdowns.
2. Type the certificate number.
3. Select certifier Part 1 (wait for postback), select Part 2 (`C` or `D`), type the number, type the signature date.
4. Select approved-body Part 1, Part 2 (`CB` or `DB`), type the number, type the signature date.
5. Read all values back.
6. Click **Validation Check** once and require a positive result (existing `check_certificate_validation`).
7. If more entries remain, click **Add** once and wait for the pager to read `n+1/n+1` before filling the next entry.

The register always shows at least one entry (`1/1`), blank on a new form. On a rerun it may already hold saved entries. The Agent reads the pager first: entries that already exist are stepped to with the `>` button and corrected in place, and **Add** is used only for entries beyond the saved count. If the register holds more entries than the job, the run stops for portal review; the Agent never clicks **Remove**.

If an expected dropdown option is missing, the run stops and reports the options the portal offered. A validation rejection reports the portal's message and points the architect to the entry to correct.

### Failure and recovery

Failures use the existing categories and callback fields. New stage labels: `proposal` ("Finding the warrant proposal"), `completion_form` ("Opening the completion certificate"), `main_details` ("Completing main details").

- Before the form is created: safe to retry.
- After the form exists: `review_portal`. A later run reuses the single existing form and steps through Main Details from the start, keeping saved answers that match and correcting those that do not.
- Cancellation is honoured at each stage boundary, as now.

## Testing

Website (`tsx` tests, added to `test:release-reliability`):

- Snapshot contract: completion section validates; existing fixtures still validate.
- Preparation: prefill, save, reopen; saving leaves `preparationData` and warrant status unchanged.
- Validation: each required field and conditional, both 750-character limits, future dates.
- Identity: a completion job never resolves as the warrant's or a planning application's current run.
- Compatibility: an Agent without the workflow is not offered the job; a heartbeat advertising it is accepted.
- Lifecycle: a completion result does not change warrant status, deadlines or milestones.

Agent (`unittest` with fake drivers, as existing tests):

- Proposal resolution: saved identity, unique name match, ambiguous list pauses.
- Form: none creates one; one is reused; several stops; uncertain Add is not repeated.
- Every Yes/No branch, including relaxation, both registers and Form Q skipped after No.
- Multiple certificate entries, missing dropdown option, validation rejection, validation timeout.
- Inline-versus-Next handling for follow-up fields.
- Runner dispatch: unknown type raises; warrant and planning dispatch unchanged.
- Snapshot mapping and date formatting.

Also covered by Agent tests: a rerun over saved answers changes nothing that already matches; a register with saved entries is corrected in place without Add; an address mismatch on the Proposal Summary stops the run.

Not automatable here: a supervised run against the real portal with real credentials. Every control the workflow uses is now mapped; that run confirms the sequence end to end.

## Build order

1. Website: migration, contract, capability schema, identity and job-type audit.
2. Website: preparation API, page, entry point, preflight, queueing.
3. Agent: models, handoff mapping, runner dispatch, completion workflow, progress, tests.
4. Deploy website, then build and publish Agent 4.2.15 and update `src/config/agent-release.json`.
5. Supervised portal run.
