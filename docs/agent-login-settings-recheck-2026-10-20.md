# Agent login, Settings and recovery recheck — 20 October 2026

The checked flow is: choose or change an eDevelopment login in the Agent → save credentials and account selection → load a prepared job → start with matching credentials → preserve queue ownership, progress and review/restart controls through Settings and update actions.

The existing 400 Agent tests and the combined portal reliability command passed at the start of this pass. Additional controlled interleavings exposed gaps that those tests did not cover. The corrections are packaged in **Agent 4.2.10**. No customer application was run or submitted, no live queue was changed, and no deployment or replacement of the installed Agent was performed.

## Reproduced corrections

| Problem | Evidence and correction |
| --- | --- |
| Changing accounts after a job downloaded could pair the newly selected password with the old email retained in the job. | Reproduced for Planning and Building Warrant. Bind the selected email into a new immutable runtime input mapping when obtaining its password for execution. Preserve the original job and document/snapshot data. |
| A missing password for the selected account could silently select another account from legacy presets. | Reproduced with a selected account lacking a password and an unrelated saved legacy account. Only import legacy presets before an account has been selected; a missing selected password now requires login correction. First-upgrade import remains covered. |
| Removing a login ignored credential-store failures; a successful removal followed by save/restart could silently select another old account. | Both cases reproduced. Keep the selected account and show an error when deletion fails. Persist an explicit selection/removal marker so a removed login is not replaced from legacy presets. Only the selected credential is removed. |
| Tray Settings bypassed the disabled main button and could refresh an active worker. A job starting while the Settings dialog was open could also be refreshed when the dialog closed. The login protocol helper had a similar reload path. | Six controlled cases reproduced. Block Settings during active work and check execution again after the modal event loop. Login changes update the saved account without reloading an executing job. |
| Saving Settings after a failed login reloaded an already retired attempt and lost the restart controls. Correcting a login could also discard a downloaded job and require another manual Start. | Reproduced through Settings, including a failure before runtime-job creation, and with a ready downloaded job. Both settings paths now retain retired-attempt recovery; local settings changes reuse downloaded application data and bind credentials at execution. |
| A claim received while an update stopped polling could remain preserved in memory without starting its initial download after the update was abandoned. | Reproduced through the real GUI handlers. On update failure, resume loading that already-claimed job; do not claim it again or discard its identity. |
| Late browser commands or a manual Start could run during an update/reset/enrollment, and installer launch did not recheck whether execution had become active. | Eight cases reproduced. Defer browser commands without acknowledging them, guard manual starts, and recheck execution before launching the installer. Cancellation handling remains available. |
| A queue claim arriving during a login/Settings dialog could start using the previous selection or open another login prompt. An update could close the account dialog. | Real dialog callbacks reproduced these interactions. Reuse the existing identity-checked claim deferral until the dialog closes, suppress duplicate login prompts, and block updates while account dialogs are open. Additional checks cover cancelled claims and deferred review commands. |

The 34 new regression cases are in `C:/Users/Jayveer/Building Portal/tests/test_login_settings_reliability.py`. They include the pre-correction failure reproductions, preservation of first-upgrade legacy import, cancelled deferred claims, and first-time setup immediately after an enrollment-success signal.

A candidate maintenance guard initially blocked those last two positive cases because Qt can deliver enrollment success before its thread reports finished. This was caught before packaging. The final guard distinguishes accepted enrollment from an enrollment still waiting for authorization; both onboarding cases now pass.

The eDevelopment account indicator now says **Login saved** rather than implying that saving a password authenticated it with the government portal. The Show password / Hide password control and secure storage behaviour remain covered by the real Qt credential-dialog test.

## Rechecked earlier fixes

The earlier coverage inventory remains in [the full reliability recheck](./full-reliability-recheck-2026-10-20.md). This pass reran the native suite, all eight groups in `npm run test:release-reliability`, the client/applicant browser suite, the portal upload/recovery browser suite and the offline/reconnect Agent-card scenario.

| Check | Final result |
| --- | --- |
| Complete native Agent suite | **434 passed, plus four subtests**, including all 34 added cases. The existing PyPDF2 deprecation warning remains. |
| Portal server/contract checks | All eight groups passed: security, login recovery, Agent reliability, portal reliability, earlier fixes, state model, fees and addresses. |
| Browser checks | **70 passed**: 43 client/applicant and 27 portal recovery checks, with no browser runtime errors. |
| Offline/reconnect/status-outage scenario | Passed against the actual components and isolated API fixtures. |
| Installer handover | Passed with disposable processes: old Agents close, saved settings remain, one new Agent starts, an unrelated installation stays running. |
| Compiled Agent | Reports **4.2.10.0**; embedded code includes these corrections and the password toggle. Isolated packaged startup passed with a null credential backend. |
| Source archive | All **138 entries** match the final native source bytes. |
| Portal checks | **0 errors, 0 warnings, four existing hints**. |
| Production portal build | Passed with the final 4.2.10 download metadata and release files. |
| Release routes | New installer size/hash, source download and uncached download/update routes passed the release-integrity check. |

Native logs are under `C:/Users/Jayveer/Building Portal/Releases/login-audit-2026-10-20-*.log`; portal logs are under this checkout's ignored `output/login-audit-2026-10-20-*.log`. The reproduction logs deliberately contain the pre-correction failures. The final native log and targeted-final log contain the passing results.

## Release

- Installer: `public/downloads/ArchitectProAgentSetup-4.2.10.exe`
- Source: `public/downloads/ArchitectProAgentSource-4.2.10.zip`
- Installer bytes: **46,188,596**
- SHA-256: `524220e6bf0775225ce4fc43877d5953a61c84a88cf7ae2cbd6a28cecbd193a8`

The portal manifest now advertises 4.2.10 locally. Deploy the manifest and release files together; the normal download and Update Agent flow will then offer this version. Earlier installers remain available. Users need the new Agent for these native corrections.

This pass did not repeat a full application run against the affected computer's eDevelopment account. That acceptance run still needs supporting documents, the location plan, retained-draft review and the next queued job. Storage and concurrency failures were exercised with isolated fixtures and controlled interleavings, not a live PostgreSQL stress test or a government-portal outage. The evidence establishes these corrected behaviours and regressions; it does not guarantee zero future defects.
