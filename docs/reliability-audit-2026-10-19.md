# Portal and Agent reliability audit — 19 October 2026

This pass found and fixed additional failures in document uploads, draft review, project creation, Agent setup and queue interaction. The changes are local and ready for deployment with Agent **4.2.8**. No customer automation was rerun, no government proposal was created, and no application was submitted or paid for during this audit.

Production was checked read-only in Chrome: the sign-in page loaded without console errors, and `/api/desktop/releases/latest` still advertised **4.2.7**. The authenticated portal flows below were verified with the actual React components against isolated API fixtures; this was not a signed-in production acceptance test.

| Priority | Failure found | Change and evidence |
| --- | --- | --- |
| P1 | Adding or removing a PDF erased `confirmedData`, including saved client and application details. | Preserve the confirmed review, reconcile its document list with the current database rows, and retain the editable review while documents change. Reproduced against the real service through an isolated database double. |
| P1 | Reanalysis or document changes could replace an edit made less than 600 ms earlier, before autosave ran. | Flush pending saves before those actions, stop the action if saving fails, and suspend inputs and automatic lookups while it runs. Real-component browser checks cover immediate clicks, delayed saves and failed saves. |
| P1 | Cancel, remove, expiry cleanup or upload finalisation could act on stale draft state while project creation acquired the same files. | Fence changes through the parent draft before deleting storage or changing document metadata. Cancellation/expiry cannot claim a draft being created or one with a resulting project. Finalisation rechecks a concurrently completed upload before deleting anything. Deterministic interleaving tests verify that permanent bytes are not deleted. |
| P1 | A late autosave could restore a cancelled draft; project creation relied on a document list read before its transaction lock. | Saves lock and recheck the draft and files. Commit re-reads the document list after its lock and rejects unfinished uploads before creating permanent records. Tests cover cancellation, changed lists and an upload becoming incomplete after preflight. |
| P2 | Different PDFs with the same filename and size could reuse one upload intent because neither browser upload flow sent the supported content hash. | Both flows now send SHA-256 of the actual file bytes. A retry retains its content identity; different same-length content gets a different intent. The server continues to verify hashes during document analysis. |
| P2 | Adding PDFs to an existing review did not retry transient failures; an empty browser MIME type was rejected even for a valid `.pdf` selection. | Use the shared bounded retry helper and the `application/pdf` fallback in this flow too. Browser checks cover a recovered 503, stable retry hashes and missing MIME metadata. Permanent errors are not retried. |
| P2 | One failed upload could return control while other workers still ran. A partly completed batch could leave the screen showing an obsolete document list. | Drain the workers before returning, refresh the authoritative list after partial failure, keep completed uploads, show unfinished files and disable project creation until all are ready. Unit and browser checks cover this recovery path. |
| P2 | Unicode drawing names could throw during HTTP response-header creation, breaking previews and Agent downloads. Long server filenames also lost their `.pdf` extension. | Use an ASCII fallback plus UTF-8 `filename*` in all three download/preview routes, and retain the extension when shortening names. Header tests cover an en dash, accented text, emoji, CJK text, control characters and a lone surrogate. The header format follows [RFC 6266](https://www.rfc-editor.org/rfc/rfc6266). |
| P2 | An already connected computer could falsely complete another computer's setup. A replacement installation could also remain tied to an offline old registration. | Snapshot already connected versions before setup, require a new connection or version change, and bind only in-place updates to the prior registration. Browser tests verify both a rejected remote heartbeat and successful replacement setup. |
| P2 | Opening a completed application while another job loaded or ran could replace the active controls. A successor claim could overlap an application-view worker, whose late callback could overwrite the new job. | Defer review commands without acknowledging them until execution is free, wait for the view worker, and ignore retired view callbacks. Native GUI regressions reproduced the overlap before the fix. |
| P2 | Windows download names did not fully handle control characters, reserved device names or UTF-16 path length. | Sanitize those names and budget the whole path in UTF-16 code units, retaining PDF extensions and duplicate suffixes. Isolated filesystem tests cover reserved names, control characters and duplicate emoji names. Naming rules are documented by [Microsoft](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file). |
| P2 | A duplicate analysis request could interfere with another request's state and failure cleanup. | Claim analysis conditionally and let only the request that obtained the claim mark its failure. Preparation also refuses to replace a draft changed during synthesis. A regression verifies that a rejected duplicate leaves the running analysis active. |

## Verification

- Native Agent: **400 tests plus 4 subtests passed**. The suite needs Windows loopback and temporary app-data access; sandbox restrictions were distinguished from product failures before rerunning it with the required local permissions. One pre-existing PyPDF2 deprecation warning remains.
- New portal service/helper suite: **20 tests passed**, plus the existing upload retry/category-edit regressions.
- Portal browser recovery suite: **18 checks passed**, using real components and isolated data, with no browser JavaScript errors.
- Existing client/applicant browser suite: **42 checks passed**.
- Existing portal security, login/restart recovery and Agent/queue suites passed.
- Astro check: no errors or warnings; three existing hints in unrelated components.
- Portal production build passed.
- The isolated installer upgrade smoke test passed: older Agents in that test installation close, settings persist, one replacement launches, and an unrelated installation remains running. It does not install over the user's live Agent.
- All **137 source archive entries** match the final Agent source. The compiled application reports **4.2.8.0**. Download redirect, cache headers, installer size and SHA-256 are checked by `tests/agent-release-integrity.test.ts`.

The concurrency tests execute the real service code with deterministic database doubles. They demonstrate the state transitions and storage-deletion guards; they are not a live PostgreSQL concurrency stress test. The browser fixtures make no customer or government changes.

## Release

- Installer: `public/downloads/ArchitectProAgentSetup-4.2.8.exe`
- Source: `public/downloads/ArchitectProAgentSource-4.2.8.zip`
- Installer size: **46,184,115 bytes**
- SHA-256: `33cceaf24db5549833e94f73bfe65b0978266f015f5c9463767607c5fb05c557`
- Previous 4.2.7 files are retained. No database schema migration is needed.

Deploy the portal changes and release files together, then update the computer running the Agent. After deployment, `/agent/download` and the Agent's update check will offer 4.2.8. This audit did not deploy, push, install over the user's Agent or change the live queue.

Release acceptance still needs a supervised run on the affected computer: verify 4.2.8 and its connection, open the retained draft, complete supporting documents and the location plan, review the uploaded list, then verify that the next queued application can start. Payment and submission remain manual. A live provider outage or forced process termination during analysis was not exercised. These fixes do not prove the exact historical cause of the unavailable remote traceback, and they cannot guarantee that an external government portal will never change or fail.

Re-run the focused checks with `npm run test:portal-reliability`, `npm run test:portal-reliability:browser` and `npm run test:agent-reliability`. The native suite runs with `python -m pytest -q` from the Agent repository.
