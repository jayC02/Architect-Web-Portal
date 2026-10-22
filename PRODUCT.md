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
