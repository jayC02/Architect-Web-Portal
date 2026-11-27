# Architect Pro

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Architecture practices managing projects, planning applications, building warrants, supporting documents and deadlines. The dashboard should prioritise an overview of active projects and practice activity, as confirmed by the user on 22 October 2026.

## Product Purpose

Provide an organisation-scoped workspace for running architecture projects and preparing and tracking applications.

## Operating Context

The existing Astro application uses React islands, Prisma and authenticated organisation membership. Its dashboard reads `/api/dashboard/summary`, with 7, 14 and 30 day deadline ranges. The desktop agent queue and practice calendar are existing features.

The public homepage says plainly what the product does: every application form, householder, full planning permission, building warrant and completion certificate, filled in and submitted in the background in a few clicks. It is a short marketing page in the features-page style, with small isometric drawings that animate as they scroll into view (an upload tray, a sheet being read, forms ticked off, a crane, a house from sketch to completion) and the background pen line. Its centre is a click-to-run product demo: pressing Run drops six drawings into an upload box, reads each one and shows the client, site, proposal and costs found in them, fills and submits planning permission, building warrant and completion certificate one after another (fees approved by the user, none for completion), then opens the finished project with client details, site address, the three applications and all nine documents together. It runs in the browser only, nothing is uploaded or submitted, and it is labelled illustrative. Below it the page follows one project from planning to completion, shows the 60 against 4 minutes, links to the live demo and shows the four plans with a link to the full pricing page. Signed-in visitors still go to their dashboard.

The live demo page (/live-demo, linked from the header) introduces the product through a scroll story in five chapters: Planning, Building warrant, Construction, Completion and Time back. It opens on a blank sheet: a two-storey house is pen-sketched as a new design, the case for full planning permission, then becomes a solid model, and a second-floor timber studio is sketched onto it, the case for a householder application. That one fictional project is then cut open in section, built and checked over. Its planning step lists both householder and full planning permission and picks householder from the proposal, since the project alters an existing house. Meanwhile an on-screen Architect Pro window shows the software reading the documents, filling each application from them, and handling payment before running in the background. The planning fee is added by the user, the building warrant fee is calculated, and a completion certificate has no fee. A U-value step shows the ISO 6946 calculation and its report, not calculation from dropped-in documents. A time ledger, drawn as a scale bar, builds up 15, 25 and 20 minutes by hand (60 in all) against 4 minutes with Architect Pro; these figures are illustrative, with actual times varying. The story runs locally in the browser without real uploads, AI calls or submissions. It always opens in 3D, including reduced-motion and landscape phones, with gentler transitions for reduced motion. The server renders the story rail before graphics load; reloads restore progress, rotation preserves it, and graphics resets recover in place. If WebGL is unavailable, an explanation appears while the HTML chapters still scroll. Existing sign-in and registration routes remain the account entry points, and returning signed-in visitors still reach their dashboard.

## Capabilities and Constraints

Preserve existing project, application, document, deadline, calendar and desktop automation workflows. Dashboard redesign is local and previewable; it does not authorise deployment. Preview data must be labelled as illustrative and isolated from real records.

## Brand Commitments

Architect Pro name and existing logo assets in `public/brand`.

## Evidence on Hand

README.md, existing dashboard components and API response shapes. Preview project names and counts are synthetic examples, not claims about the user's practice.

## Product Principles

- Make active projects and practice activity easy to scan.
- Show status and next useful actions together.
- Keep existing authenticated workflows and data access intact.
- Make the preview work without credentials or changes to customer data.
