# Mapping pass — 6 November 2026

> Historical first-pass record. Its remaining-work list is superseded by [the 7 November coding completion report](./prelaunch-coding-completion-2026-11-07.md). Read that report for current implementation, verification and release status.


This is the first source change following the supplied pre-launch brief and mapping notes. It is not a claim that every conditional portal screen is implemented or live verified.

## Connected and checked in this pass

- The actual v2 snapshot-to-runtime adapter now carries all five work-profile answers. Demolition-only has no existing-building work, following the supplied mapping.
- All applicable proposed-work checkboxes survive as a list. The actual warrant workflow uses that list, clears obsolete selections and verifies the selected states. The old singular input remains compatible.
- All 11 additional warrant answers retain their explicit Yes/No values. Work-started and certificate-availability flags are also carried through. A design certificate is selected only when a certifier is attached and availability is Yes.
- All five Planning choices are checked through the actual runtime adapter for both values, with zero current/proposed parking spaces and a zero planning fee retained.
- Main Details Next operations wait for a visible destination control. Existing-building No can proceed directly to Proposed work without attempting an absent conversion screen. Uncertain Next is not clicked again automatically.
- The construction proposed-use screen receives the reviewed description, as specified in the mapping notes. Estimated value has no invented default and entry failure is propagated. Replayed notice values use replacement rather than append.
- The website holds unfinished branches as NEEDS_INPUT. The Agent also refuses them before login, including older saved jobs. This preserves truthful answers while the missing follow-up forms are built.

## Still required

- Project residential/commercial screener and its display rules.
- Website and snapshot fields plus actual portal handlers for conversion descriptions, demolition weeks, listing category, construction certification, STAS reference and sustainability.
- Captures for owner No, work-started Yes, fire authority name, historical importance, relaxation directions, dangerous notices, the domestic sustainability matrix and certificate validation.
- The brief's remaining certificate UI, security and lifecycle corrections.
- Supervised disposable-draft verification. The automated checks use an independent page-state fake and production entrypoints; they do not prove the live government portal's current behavior.

## Repeatable checks

- Agent: `python -B -m pytest tests/test_warrant_mapping_navigation.py tests/test_portal_handoff.py tests/test_portal_answers.py tests/test_building_warrant_documents.py tests/test_actions.py -q`
- Website: `npx tsx tests/warrant-mapping-preflight.test.ts`

The installed Agent and published installer are unchanged. A new release must be packaged after the intended mapping work is complete.

## Validation result

- Full offline Agent suite: 569 passed, plus four subtests. The existing PyPDF2 deprecation warning remains.
- Existing website release-reliability suite passed; the new mapping preflight check also passed and is included in the portal reliability command.
- Website type check: zero errors and warnings, four existing hints. Production build passed.
- No real government application was created, edited, submitted or paid for during these checks.
