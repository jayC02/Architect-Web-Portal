# Agent 4.2.12: manual proposal site location

The government portal's postcode outage is handled in the shared Agent proposal workflow for Planning and Building Warrant. No application database or snapshot schema change is required.

When manual entry is available, the Agent follows the visible wizard:

1. Open the new proposal and continue from Enter Address.
2. Select the saved site/project local authority from the live dropdown.
3. Enter the complete site address, including the postcode.
4. Use as Site Location, confirm the address, and confirm the authority.
5. Verify the site location on the proposal details page, then continue the existing proposal workflow.

The council is passed through from the existing snapshot's `site.localAuthority`, falling back to `project.localAuthority`. An unmatched or ambiguous authority opens a chooser containing the portal's current options. Selection resumes the same run without rewriting the immutable snapshot. Council matching accepts known spelling variants but does not guess between neighbouring authorities.

ASP.NET authority dropdown postbacks are awaited before entering the address. The live length limit is respected without truncating the address. Recognised confirmation screens may be skipped by portal versions, but the final site-location readback remains mandatory. A changed address or a conflicting council confirmation requires review before a proposal is created.

The previous postcode search, address result matching, pagination, address chooser and duplicate-proposal protection remain intact. A failed or incomplete postcode lookup can use manual entry when offered. If a restored postcode screen still exposes a nonworking manual tab, the Agent can return to the available postcode route. The location handler also accepts an already-open manual location editor without pressing New Proposal.

Existing saved proposal references continue to reopen their own draft. The change does not automatically alter an existing saved draft's location. Final review, submission and payment remain the user's existing workflow.

Release files are versioned alongside older downloads. The website release manifest points to 4.2.12 after its installer and source archive are staged; older installers and source archives are retained.

Verification:

- 486 Agent regression tests and four subtests passed.
- 18 isolated Chrome tests passed, covering both application types, manual entry, existing editor entry, dropdown postbacks, omitted confirmations, council choice, readback mismatch, address length, original postcode lookup and fallback from an obsolete manual tab.
- Python compilation passed.
- The installer-upgrade smoke test passed with disposable processes: settings were preserved, the new version launched once, and an unrelated installation remained running.
- Installer checksum, file size, source download and uncached release routes passed verification. The source archive matches the final implementation.
- The website production build passed with the staged versioned downloads.
- Tests use local fixtures and mocked services. No live government proposal was created or submitted.

The 4.2.12 installer can be installed directly over the current Agent. Website download metadata and files are prepared locally; deploy the portal changes to offer this release through the online Update Agent workflow.

Agent implementation and regression tests are in the `Building Portal` workspace. Browser checks can be repeated with `python -m pytest tests/browser_proposal_location.py -q`; service tests use `python -m pytest tests -q`.
