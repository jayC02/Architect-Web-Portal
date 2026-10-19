# Agent reliability audit - 15 October 2026

Seven additional reliability issues were reproduced and fixed in the portal source and Agent 4.2.7. The existing 4.2.6 download is unchanged until the next deployment. No live application was created, restarted, submitted or paid for during this audit.

The review followed the queue claim, job download, cancellation, execution release, heartbeat, update failure and idle/review display paths. It used the existing source and controlled failure tests, including the actual Windows filesystem and Qt download worker.

| Issue | Trigger and effect | Correction and evidence |
| --- | --- | --- |
| Deleted or reassigned job blocks release | The Agent waits for release acknowledgement. The server previously acknowledged a missing exact execution only if the job was still READY and unclaimed. A deleted project or reassigned claim could leave the Agent waiting indefinitely, blocking new jobs and updates. | Acknowledge the absence of the old execution without changing a newer owner. Clear only an obsolete registration pointer. Heartbeats tell an obsolete local worker to stop using its own reported job/run identity. Tests cover deleted projects, reassignment, live ownership, scoped cancellation and execution exclusivity. |
| Completion races an in-flight heartbeat | A worker can finish while its polling request is outstanding. The polling engine previously continued into the next claim without noticing the newly pending release. | Recheck the release barrier after heartbeat and queue requests. A deterministic test finishes a worker inside the heartbeat response and verifies that no successor is claimed before acknowledgement. |
| Cancellation leaves the download batch running | Cancelling a claimed job invalidated its UI signals but did not interrupt the download worker. The previous batch could continue fetching all remaining documents while a successor waited. | Request worker interruption, check cancellation between downloads and after a network response, and never publish the cancelled batch as loaded. Tests cover both the GUI cancellation path and an actual Qt worker with a held network response. The current request keeps its existing 45-second timeout; cancellation does not forcibly abort that request. |
| Long filenames fail inside job folders | The previous filename limit ignored the full AppData/job path and could strip the extension. Long or duplicated names could fail when written to disk. | Calculate the available filename length from the complete local folder and retain the extension and unique suffix. A Windows filesystem test downloads three identical long filenames and verifies distinct names, bounded paths and intact bytes. |
| Prolonged outage can kill polling | The retry delay capped its result after computing an unbounded exponential. Eventually this raised OverflowError inside connection-error handling and terminated the poller. The outer loop also shortened the intended backoff to 30 seconds. | Cap the exponent before calculation and honour the interruptible retry delay. A test simulates 3,000 consecutive connection failures, then verifies recovery resets the counter. |
| Failed update loses polling or a claim | If an interrupted poller was still finishing, update failure did not restart it when it eventually exited. If it had finished, the replacement engine discarded any job claimed during the last request. | Defer restart until the previous worker finishes and reuse its engine, preserving its job, run identity and pending release. Tests cover both worker timing cases. Connection reset also clears old review-display state. |
| Connected UI retains loading or overwrites review text | An authenticated READY heartbeat changed the green indicator/message but left the startup heading and spinner visible. It could also replace an existing application-review message with idle text. | Render a complete idle state after authenticated readiness and preserve a prepared application's review card. Tests cover both states. |

The main implementation files are `src/pages/api/desktop/heartbeat.ts`, `src/server/services/desktop-execution.service.ts`, and the Agent's `gui/agent_app.py`, `gui/services/background_agent.py` and `gui/services/portal_handoff.py`.

## Verification

- Agent suite: **389 tests passed, plus four subtests**. One existing PyPDF2 deprecation warning remains.
- `npm run test:agent-reliability`: deleted-project recovery, ownership/exclusivity, review leases, cancellation, queue removal, queue ordering/isolation and start acknowledgement.
- `npm run test:login-recovery`: login recovery, fresh retries, canonical snapshots, postcode recovery, status and callback contracts.
- `npm run check`: 469 files, zero errors, zero warnings and three existing hints.
- `npm run build`: production build passed, including Vercel function bundling and static download files.
- The corrected idle screen was rendered and inspected with native Windows Qt in an invisible widget, using mocked credentials and readiness signals. This verifies presentation; it is not a live connection check.
- Regression tests failed against the previous behaviour before the corresponding fixes were applied.
- The source check initially scanned generated browser-profile files and exhausted memory. `tsconfig.json` now excludes generated `output` and build folders. An existing client-review test fixture was updated with its required `attentionCount` field; the start-acknowledgement test harness now supplies the state-model dependency introduced earlier.

Command output is retained privately in `output/agent-reliability-*.log` in the portal checkout and `Releases/reliability-audit-*.log` in the Agent checkout.

The Agent 4.2.7 installer is **46,187,297 bytes**, SHA-256 `946105d74e4bc120ebffbed8fe95106567f47583388e0f17a4fc54d13cebd87a`. The packaged executable reports `4.2.7.0`; all **137** source-archive entries match the current local source byte for byte. The local public download route and release metadata point to the verified installer with no-store headers. Previous release files were preserved.

## Deployment and remaining verification

Deploy the portal changes and the new 4.2.7 release files together, then install the update on the computer that runs applications. Preserve the existing 4.2.6 files and their hashes.

These are reproduced defects with regression coverage. They do not establish that any one of them caused the earlier remote failure: its detailed traceback was unavailable. They also do not replace a complete normal run of the installed 4.2.7 Agent on the affected computer. Server tests use controlled database doubles and simulated transactions; the audit did not exercise production database concurrency or submit a government application.
