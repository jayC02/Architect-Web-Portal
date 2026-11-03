# Manual application run reset — 3 November 2026

Reset Planning and Reset Building Warrant are separate controls on the project application cards. Saving a Site does not reset either run.

A reset reads the current saved Site, client, application answers, organisation defaults and project documents, then creates a distinct automation job. It is ready to run when preflight passes, or shows the missing details when it does not. Reset does not authorise execution; the user selects Run application afterwards.

The operation uses the same organisation execution lock as Agent claims, starts, cancellation and callbacks. Its transaction either commits the cancellation, new snapshot and reset journal together or rolls all of them back. A running Agent retains its execution ownership until it acknowledges stopping; the replacement cannot start before that release. An unstarted claim is fenced and released immediately.

The client retains a request UUID across uncertain responses, and the server returns that request's recorded replacement. The expected current job prevents two different requests from an old page creating competing replacements. Late results and automatic postcode corrections from a superseded attempt cannot revive it or overwrite the fresh preparation. Resets affect only the selected application and organisation.

Finished runs retain their original result and snapshot in history. Existing government portal drafts remain intact. Resetting an application that has a recorded submission or decision creates a new draft record and preserves the progressed record and references.

Each reset has a distinct portal draft key, included in snapshot integrity. Agent 4.2.13 uses that key in the new proposal name, so the same address cannot redirect a reset into an older draft. An uncertain creation or repeat of the same reset can recover only its exact draft. The key is preserved by later preparation refreshes. Old Agents remain compatible with existing jobs and cannot claim reset jobs they do not understand.

## Validation

- Transaction tests exercise both workflows across 13 job states, repeated and competing requests, stale pages, rollback after snapshot/create failures, missing details, unrelated applications, organisation isolation, claim release, running cancellation barriers, and preservation of submitted records.
- The real snapshot builder verifies the reset key survives schema parsing and participates in integrity.
- Callback and postcode recovery tests verify superseded results and corrections cannot revive an old run.
- Browser checks use the real cards and hydrated controls in an isolated fixture: desktop/mobile, keyboard and Escape focus, double-click prevention, stable retry identity, response confirmation and card refresh. No live applications are changed.
- Complete Agent suite: 511 passed, plus 4 subtests. One existing PyPDF2 deprecation warning.
- Application-card browser suite: 71 checks passed, no browser runtime errors.
- Agent 4.2.13 packaged startup exits successfully. The disposable Inno upgrade fixture preserves settings, starts the replacement once and leaves unrelated installations running.
- Website type checks, production build and installer/source integrity checks pass.

## Release

The workspace includes the 4.2.13 installer/source archive and updated release manifest. Deploy the portal changes and update the desktop Agent to 4.2.13 to use resets. No database migration is required. The installed Agent and production runs were not changed during implementation or verification.

## Related upload incident

Job `1e047222-862d-4e7b-b94e-fe3868376fd1` stopped at the first supporting-document Save for `2023 034 - 021 - (working) Ground floor.pdf`. Its local traceback records the ePlanning message: “An issue which requires your attention has occurred on this page.” This confirms a portal-reported error, but does not identify its underlying cause. The earlier replaced-element fix remained present and handled a different failure.

The run reopened draft `100774480`, previously prepared on 28 October, and all six downloaded PDFs match the earlier files byte for byte. Re-uploading into that draft is a plausible trigger; the generic portal banner does not prove a duplicate conflict. Agent 4.2.13 now preserves the filename, operation and actual portal message, searches for more specific validation errors, and labels an unexplained banner as an unspecified portal error rather than guessing. The Gemini 503 log supplied during investigation belongs to the earlier AI classification step, which has retry/fallback handling; it is not this Agent traceback.
