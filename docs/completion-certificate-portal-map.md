# eBuilding Standards — Completion Certificate: the controls the Agent still hardcodes

Mapped live on 2026-11-27 against draft Completion Certificate `500808666-002`
(`CompletionCertificateMainDetails.aspx` and `Declaration.aspx`). The aim was to fill in every branch that
`automation/completion_certificate` (Agent repo) currently answers with a fixed value. The pages the Agent
already handles are listed for context; the **new** pages and controls are marked ★.

Prefix **`~` = `MainContent_CompletionCertificateAppWizard_`**. Every Main Details page shares one Next button:
`~StepNavigationTemplateContainerID_btnNext` (also `…_btnPrevious`, `…_btnSaveAndExit`, `…_btnClearPage`). On the
Review page the button is `~FinishNavigationTemplateContainerID_btnNext`. Pages are identified by their progress %.
None of the Main Details radios post back; follow-up pages appear only after Next.

---

## 1. What is hardcoded today, and what the portal actually offers

| Agent today (`details.py` / `submission.py`) | Portal options (live) | Extra page or fields when the other answer is chosen |
|---|---|---|
| Warrant obtained = **Yes** (`~rbObtainBWYes`) | Yes / **No** (`~rbObtainBWNo`) | ★ **No** skips the warrant-details page (8%) and goes straight to Notices (12%). Nothing else changes later. |
| The three notice references = **"N/A"** | free text, **optional** (no `*`) | none: the boxes can hold real references or stay blank |
| Dangerous building notice = **No** (`~rbDangerousBuildingNo`) | Yes (`~rbDangerousBuildingYes`) / No | ★ **Yes** → 15% page (below) |
| Agent + registered account details | Relevant Person (`~ApplicantOrAgent_rbApplicant`) / Agent; account Yes/No | ★ **Relevant Person** skips Agent Details (23%), and Relevant Person Details then also requires **Telephone and Email** |
| Relevant person is an **individual** | **there is no individual/organisation choice** on Relevant Person Details (27%) | ★ an organisation is just the Company/Organisation box; see the 27% rules below |
| Relevant person is the **owner** = Yes (`~rbApplicantOwnerYes`) | Yes / No (`~rbApplicantOwnerNo`) | ★ **No** → Owner Details list (35%) |
| Building address = warrant's (`~rbDifferentAddressNo`) | Yes (`~rbDifferentAddressYes`) / No | ★ **Yes** → address list (42%) |
| Covers all the warrant work = **Yes** (`~rbSumissionCoverYes`, sic) | Yes / No (`~rbSumissionCoverNo`) | ★ **No** → partial-completion page (50%) |
| Declaration: **"I"** | `I`, `We` | none |
| Declaration: "the work was carried out and made in accordance with the building warrant." | four statements (below) | none |
| Declaration notice question = **No** | Yes / No, **auto-postback** | ★ **Yes** → notices page (50%) and a different acceptance tick |

---

## 2. Main Details, page by page

| % | Page | Controls | Notes |
|---|---|---|---|
| 0 | Welcome | none | Next |
| 4 | Date work completed | `txtDateWorkCompleted` ★ (no prefix, dd/mm/yyyy, required); "Did you obtain a building warrant for this?" `~rbObtainBWYes` / ★ `~rbObtainBWNo` | |
| 8 | Building warrant details *(Yes only)* | `~BuildingWarrantDetails_txtBuildingWarrantRefNumber`, `txtBuildingWarrantDate` (no prefix), `~BuildingWarrantDetails_txtAmendmentDates` | from the existing Agent code |
| 12 | Notices | `~txtBuildingRegComplianceNotice`, `~txtBuildingWarrantEnforcementNotice`, `~txtDefectiveBuildingsNotice` (all **optional**); "Is the building subject to any Dangerous building notice(s)? *" `~rbDangerousBuildingYes` / `~rbDangerousBuildingNo` | |
| 15 ★ | Notices continued *(dangerous = Yes)* | `~txtDangerousBuildingRefNum` textarea, **required**, max 750: "Reference Number(s) for Dangerous Building Notices" | |
| 19 | Relevant Person or Agent Details | `~ApplicantOrAgent_rbApplicant` ("Relevant Person") / `~ApplicantOrAgent_rbAgent`; account details `~ApplicantOrAgent_rbAccountYes` / `~ApplicantOrAgent_rbAccountNo` | |
| 23 | Agent Details *(Agent only)* | `~AgentDetails_…` (same fields as every other form) + `~AgentDetails_rblIndividualOrOrganisation_0/_1` | existing Agent code |
| 27 | Relevant Person Details | `~ApplicantDetails_ddlApplicantTitle` (Please Select One/Mr/Mrs/Miss/Ms/Other), `_txtApplicantOtherTitle` (disabled unless Other), `_txtApplicantFirstName`, `_txtApplicantLastName`, `_txtApplicantCompany`, `_txtApplicantBuildingName` / `_txtApplicantBuildingNo` (one required), `_txtApplicantAddress1`*, `_txtApplicantAddress2`, `_txtApplicantTown`*, `_txtApplicantCountry`*, `_txtApplicantPostcode`, `_txtApplicantTelephoneNumber`, `_txtApplicantExtensionNumber`, `_txtApplicantMobileNumber`, `_txtApplicantFaxNumber`, `_txtApplicantEmailAddr` | ★ see the rules below |
| 31 | Owner of building | `~rbApplicantOwnerYes` / ★ `~rbApplicantOwnerNo` | |
| 35 ★ | Owner Details *(owner = No)* | list "1/1": `~OwnerDetails_btnAddOwner`, `_btnRemoveOwner`, `_btnFirstOwner`, `_btnPreviousOwner`, `_btnNextOwner` (⚠ these page through owners, they don't advance the wizard), `_btnLastOwner`; fields `~OwnerDetails_ddlOwnerTitle`, `_txtOwnerOtherTitle`, `_txtOwnerFirstName`, `_txtOwnerLastName`, `_txtOwnerCompany`, `_txtOwnerBuildingName` / `_txtOwnerBuildingNo`, `_txtOwnerAddress1`, `_txtOwnerAddress2`, `_txtOwnerTown`, `_txtOwnerCountry`, `_txtOwnerPostcode`, `_txtOwnerTelephoneNumber`, `_txtOwnerExtensionNumber`, `_txtOwnerMobileNumber`, `_txtOwnerFaxNumber`, `_txtOwnerEmailAddr` | ★ see the rules below |
| 38 | Building warrant address | "address amended, or submission covers only part of the warrant?" `~rbDifferentAddressYes` / `~rbDifferentAddressNo` | |
| 42 ★ | Building warrant address continued *(Yes)* | list "1/1": `~CompletionCertificateDifferentAddress_btnAddAddress`, `_btnRemoveAddress`, `_btnFirstAddress`, `_btnPreviousAddress`, `_btnNextAddress`, `_btnLastAddress`; `_txtAddress1`*, `_txtAddress2`, `_txtTown`*, `_txtPostcode`* | empty submit: Address Line 1, Town/City and Postcode are required |
| 46 | Description of building | "Does this submission cover all the work under the building warrant?" `~rbSumissionCoverYes` / ★ `~rbSumissionCoverNo` | |
| 50 ★ | Description of building continued *(No)* | `~txtWorkDescription` textarea, **required**, max 750: "describe the work to which this submission applies"; "Is this the last submission related to the building warrant?" `~rbLastSubmissionYes` / `~rbLastSubmissionNo` | either last-submission answer goes to 54% |
| 54 | Relaxation Directions | `~rbRelaxationDirectionYes` / `~rbRelaxationDirectionNo` | existing code; Yes → details (`~RelaxationDirections_txtReferenceNumber`, `txtRelaxDirDate`) |
| 62 | Certificates of construction | `~CertificatesRegisterQuestion_rbCertificatesAccompanyYes` / `…No` | existing code (register page when Yes) |
| 69 | Certificates of design | `~rbDesignCertificatesAccompanyYes` / `…No` | existing code (Form Q → register when Yes) |
| 81 | Energy Performance Certificate | `~rbEnergyPerformanceYes` / `…No` | existing |
| 85 | Statement of sustainability | `~rbSustainabilityYes` / `…No` | existing |
| 88 | Fire Safety Design Summary | `~rbFireSafetyYes` / `…No` | existing |
| 92 | Continuing requirements | `~rbContinuingRequirementsYes` / `…No` (+ `~txtContinuingRequirements`) | existing |
| 100 | Review | `~FinishNavigationTemplateContainerID_btnNext` → Form Summary, Main Details ✔ | |

The progress % stays fixed per page whatever is skipped: Previous and Next simply jump the gaps.

### Rules found by testing empty and partial submissions
* **Relevant Person Details (27%), Agent route.** The server enforces **Title**, a building name or number,
  Address 1, Town and Country. **First and last name are starred but not enforced**: Title + Company + address passes.
  That is how an organisation is entered, since there is no type choice. ⚠ When the names are left empty the
  portal saves the word **"blank"** in them. The Agent should fill real names when it has them, and expect "blank"
  on a re-run.
* **Relevant Person Details, Relevant Person route.** The same page also **requires Telephone Number and Email Address**.
* **Owner Details (35%).** Every owner requires **Title, First Name, Last Name, Telephone, Email**, a building name or
  number, Address 1, Town and Country, **even when it's a company**. Add saves the current owner and opens a blank
  one ("2/2"); Next saves the last one.
* **Address list (42%).** Address Line 1, Town/City and Postcode are required.

---

## 3. Declaration (`Declaration.aspx`, prefix `MainContent_DeclarationWizard_`)

It opens even before Supporting Documentation and Email Notification are complete.

**20% Review and Declare**
* `btnReviewCompletionCert`: PDF preview (don't click).
* `ddlCompletionCert1`: `I` | `We`.
* `ddlCompletionCert2` (value = text):
  1. `the work was carried out and made in accordance with the building warrant.`
  2. `the work was carried out and conversion was made in accordance with the building warrant.`
  3. `the conversion was made in accordance with the building warrant.`
  4. `the work done in response to a notice has been completed in accordance with the requirements of the notice.`
* "Is this certificate submitted for work done in response to a notice where no warrant was required? *"
  `RbnCompletionCertNoticeYes` / `RbnCompletionCertNoticeNo`. ⚠ **These post back immediately.**
  * **No** → `cbAcceptCompletionCert` appears on this page ("If you are happy with your application please tick here
    and click Next"), then `btnNextCompletionCert`. This is the route the Agent uses today.
  * ★ **Yes** → no tick on this page; `btnNextCompletionCert` goes to:

**★ 50% Continued (notice = Yes)**: "Please indicate below which notice(s) the work was done in response to."
* `CblCompletionCertNotices_0` Continuing requirement enforcement notice
* `CblCompletionCertNotices_1` Building regulations compliance notice (where no warrant was required)
* `CblCompletionCertNotices_2` Defective buildings notice (where no warrant was required)
* `CblCompletionCertNotices_3` Dangerous building notice
* `cbAcceptCompletionCertNotices` (tick to accept), then `btnNextCompletionCertNotices`
  (also `btnSaveCompletionCertNotices` "Exit", `btnClearCompletionCertNotices`, `btnPreviousCompletionCertNotices`)

The page after either acceptance was not opened during mapping.

Other buttons on the 20% page: `btnSaveCompletionCert` ("Exit"), `btnClearCompletionCert`, `btnPreviousCompletionCert`.

---

## 4. Built: completion contract 3

Implemented in Architect Pro (`src/lib/completion-certificate.ts`, `CompletionCertificateForm.tsx`) and the Agent
(`automation/completion_certificate/branches.py`). The snapshot's `completionCertificate` now carries `notices`,
`dangerousBuilding`, `relevantPersonIsOwner` + `owners`, `differentAddress`, `coverage` and `declaration`. Its
`fixedAnswers` are just `warrantObtained`, `actingAs`, `useAccountDetails` and `noticeWithoutWarrant`.
Completion jobs are offered only to Agents advertising `completionContractVersions` 3. The Agent still runs a job
queued under contract 2, whose answers default to the old fixed ones.

**Still fixed, deliberately:** warrant obtained = Yes, acting as agent with the account details, and the
Declaration notice question = No. Architect Pro prepares completions from a granted warrant on the practice's
behalf, so the "no warrant" routes don't apply.

The original list of answers (kept for reference):

| Answer | Controls |
|---|---|
| `warrantObtained` (bool) | 4% radio; when false skip warrant details, and the statement is likely #4 (notice) |
| `noticeReferences` {complianceNotice, enforcementNotice, defectiveNotice} (optional text) | 12% boxes (blank instead of "N/A" when none) |
| `dangerousBuildingNotice` (bool) + `dangerousBuildingReferences` (≤750) | 12% radio, 15% textarea |
| `actingAs` `AGENT`/`RELEVANT_PERSON` | 19% radio; relevant person route also needs phone and email |
| relevant person **organisation**: company name, with Title still required | 27% Company box |
| `relevantPersonIsOwner` (bool) + `owners` [{title, firstName, lastName, company, buildingName/No, address1/2, town, country, postcode, phone, email}] | 31% radio, 35% list (Add between owners) |
| `differentBuildingAddress` (bool) + `addresses` [{line1, line2, town, postcode}] | 38% radio, 42% list |
| `coversAllWork` (bool) + `workDescription` (≤750) + `lastSubmission` (bool) | 46% radio, 50% page |
| `declarationPerson` `I`/`We`, `declarationStatement` (one of 4) | Declaration dropdowns |
| `noticeWithoutWarrant` (bool) + `notices` [continuing, compliance, defective, dangerous] | Declaration radio (postback) and the 50% tick-boxes, with a different accept/Next pair |

> ⚠ Draft `500808666-002` was used for mapping and now holds **test answers**: date completed 01/11/2026,
> warrant obtained **No**, dangerous building **Yes** ("TEST DBN-1"), Relevant Person route with "TEST Org Ltd"
> (names saved as "blank"), owner = No with two test owners, a different address ("2 Test Street"),
> partial completion ("TEST partial completion…", last submission Yes), relaxation, certificates, EPC,
> sustainability, fire safety and continuing requirements all No. Main Details shows ✔. The Declaration was left
> on its notices page with **Yes**, "I" and the notice statement, and nothing ticked. Clear these answers or
> delete the form before using it. Nothing was submitted.

---

## 5. The other sections, and what is still unmapped

*(From the earlier version of this document.)*

The Agent finds the warrant’s proposal, opens its single Completion Certificate draft, and completes Main Details through Declaration. It returns control to the architect for submission. The [original Main Details mapping](superpowers/specs/2026-11-11-completion-certificate-design.md#stage-3-main-details) covers the initial wizard. The current Agent code adds supporting documents, email notification and the declaration.

| Portal area | Existing selectors and entry behaviour | Agent source |
| --- | --- | --- |
| Proposal Summary | Match the Completion Certificate by name under Draft Forms. The draft link uses the `MainContent_ProposalSummaryWizard_btnEditForm` prefix and a variable suffix. Match the proposal to the warrant’s site address before using it. | `automation/completion_certificate/proposal.py` |
| Main Details | `MainContent_FormSections_btnMainDetails` opens the wizard. The usual control prefix is `MainContent_CompletionCertificateAppWizard_`. The two register prefixes within it are `CertificatesRegister_` for construction and `CertificatesRegister1_` for design. The work-completed, warrant, relaxation and register signature dates use standalone IDs. | `automation/completion_certificate/details.py`, `certificates.py`, `navigation.py` |
| Supporting Documentation | `MainContent_FormSections_btnSupportingDocumentation` opens the section. The controls use `MainContent_SupportingDocumentationWizard_`. The Agent enters the document title and description, chooses the paper size and document type, attaches the file, and checks it appears in the saved list. | `automation/completion_certificate/submission.py` |
| Email Notification | `MainContent_FormSections_btnEmailNotification` opens the section. The Agent clears `MainContent_cbUseEmail` and clicks `MainContent_btnConfirm`. | `automation/completion_certificate/submission.py` |
| Declaration | `MainContent_FormSections_btnDeclaration` opens the section. Its selectors use `MainContent_DeclarationWizard_` with `ddlCompletionCert1`, `ddlCompletionCert2`, `RbnCompletionCertNoticeNo`, `cbAcceptCompletionCert` and `btnNextCompletionCert`. The declaration Next ends the run. | `automation/completion_certificate/submission.py`, `run.py` |

### Remaining portal controls

The published flow proceeds from the completed Form Summary to a submission preview with its own acceptance checkbox and Submit button. It then shows a confirmation and lists the form under Submitted Forms on the proposal. The guide establishes the screen order and visible actions. [Midlothian Council portal walkthrough](https://www.midlothian.gov.uk/info/161/building_standards/577/how_to_submit_electronic_documents_on_the_ebuilding_standards_portal/8)

| Priority | Screen or branch | Live evidence to capture |
| --- | --- | --- |
| 1 | Completed Form Summary | Completion indicators for all four sections, Next control ID and its destination. |
| 2 | Submission preview | Screen marker, acceptance checkbox, Submit and return controls, and any online form reference displayed. Stop at this preview. |
| 3 | Conditional Main Details | Follow-up controls for a relevant person who is an organisation or is different from the owner, a different building address, and a certificate covering part of the warrant work. **Done:** mapped live above (§2) and built (§4). |
| 4 | Submitted Forms | Where an already-submitted certificate is available, record the row or link selector, the displayed form reference if present, and the distinction from the proposal reference and council warrant number. |

For each live step, record the heading or step marker, visible label, exact HTML `id` and `name`, control type, select or radio values, required state, and the answer or action that shows the next screen. Inspect real drafts without changing their answers. Use a test draft for any branch that needs an answer changed. Redact personal details and reference values from the mapping.
