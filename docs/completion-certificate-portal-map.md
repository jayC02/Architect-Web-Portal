# eBuilding Standards Completion Certificate portal map

Scope is the Completion Certificate for work under an existing Building Warrant. The baseline below comes from the current Agent implementation. The remaining controls need inspection in a signed-in portal tab.

## Implemented in the Agent

The Agent finds the warrant’s proposal, opens its single Completion Certificate draft, and completes Main Details through Declaration. It returns control to the architect for submission. The [original Main Details mapping](superpowers/specs/2026-11-11-completion-certificate-design.md#stage-3-main-details) covers the initial wizard. The current Agent code adds supporting documents, email notification and the declaration.

| Portal area | Existing selectors and entry behaviour | Agent source |
| --- | --- | --- |
| Proposal Summary | Match the Completion Certificate by name under Draft Forms. The draft link uses the `MainContent_ProposalSummaryWizard_btnEditForm` prefix and a variable suffix. Match the proposal to the warrant’s site address before using it. | `automation/completion_certificate/proposal.py` |
| Main Details | `MainContent_FormSections_btnMainDetails` opens the wizard. The usual control prefix is `MainContent_CompletionCertificateAppWizard_`. The two register prefixes within it are `CertificatesRegister_` for construction and `CertificatesRegister1_` for design. The work-completed, warrant, relaxation and register signature dates use standalone IDs. | `automation/completion_certificate/details.py`, `certificates.py`, `navigation.py` |
| Supporting Documentation | `MainContent_FormSections_btnSupportingDocumentation` opens the section. The controls use `MainContent_SupportingDocumentationWizard_`. The Agent enters the document title and description, chooses the paper size and document type, attaches the file, and checks it appears in the saved list. | `automation/completion_certificate/submission.py` |
| Email Notification | `MainContent_FormSections_btnEmailNotification` opens the section. The Agent clears `MainContent_cbUseEmail` and clicks `MainContent_btnConfirm`. | `automation/completion_certificate/submission.py` |
| Declaration | `MainContent_FormSections_btnDeclaration` opens the section. Its selectors use `MainContent_DeclarationWizard_` with `ddlCompletionCert1`, `ddlCompletionCert2`, `RbnCompletionCertNoticeNo`, `cbAcceptCompletionCert` and `btnNextCompletionCert`. The declaration Next ends the run. | `automation/completion_certificate/submission.py`, `run.py` |

## Remaining portal controls

The published flow proceeds from the completed Form Summary to a submission preview with its own acceptance checkbox and Submit button. It then shows a confirmation and lists the form under Submitted Forms on the proposal. The guide establishes the screen order and visible actions. [Midlothian Council portal walkthrough](https://www.midlothian.gov.uk/info/161/building_standards/577/how_to_submit_electronic_documents_on_the_ebuilding_standards_portal/8)

| Priority | Screen or branch | Live evidence to capture |
| --- | --- | --- |
| 1 | Completed Form Summary | Completion indicators for all four sections, Next control ID and its destination. |
| 2 | Submission preview | Screen marker, acceptance checkbox, Submit and return controls, and any online form reference displayed. Stop at this preview. |
| 3 | Conditional Main Details | Follow-up controls for a relevant person who is an organisation or is different from the owner, a different building address, and a certificate covering part of the warrant work. The Agent currently uses fixed answers for these questions. |
| 4 | Submitted Forms | Where an already-submitted certificate is available, record the row or link selector, the displayed form reference if present, and the distinction from the proposal reference and council warrant number. |

For each live step, record the heading or step marker, visible label, exact HTML `id` and `name`, control type, select or radio values, required state, and the answer or action that shows the next screen. Inspect real drafts without changing their answers. Use a test draft for any branch that needs an answer changed. Redact personal details and reference values from the mapping.
