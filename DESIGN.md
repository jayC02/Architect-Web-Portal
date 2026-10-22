---
name: Architect Pro dashboard
description: A precise workspace for architecture practice operations
colors:
  primary: "#4e5fc1"
  primary-hover: "#3f4fa8"
  primary-soft: "#edf0fc"
  ground: "#f5f7fb"
  surface: "#ffffff"
  rail: "#eaf0f7"
  ink: "#263449"
  muted: "#637085"
  line: "#e4e9f0"
  focus: "#7386df"
  lead: "#8b98ab"
  documents: "#9b83c1"
  planning: "#6c86c6"
  warrant: "#488b85"
  complete: "#7c9d70"
  planning-soft: "#ecf1fb"
  planning-ink: "#4a65a3"
  danger: "#ad5156"
  warning: "#87642d"
  ready: "#45796f"
typography:
  headline:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Aptos, sans-serif'
    fontSize: "clamp(27px, 2.2vw, 34px)"
    fontWeight: 620
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Aptos, sans-serif'
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  body:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Aptos, sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Aptos, sans-serif'
    fontSize: "11px"
    lineHeight: 1.5
  metric:
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", Aptos, sans-serif'
    fontSize: "29px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
rounded:
  tag: "4px"
  input: "6px"
  control: "7px"
  surface: "12px"
spacing:
  tight: "6px"
  control: "8px"
  inline: "12px"
  section: "20px"
  gutter: "24px"
  desktop: "35px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#445570"
    rounded: "{rounded.control}"
    padding: "8px 13px"
    height: "38px"
  search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "0 9px"
    height: "34px"
  nav-active:
    backgroundColor: "{colors.surface}"
    textColor: "#4759b5"
    rounded: "{rounded.control}"
    padding: "10px 13px"
    height: "45px"
  stage-planning:
    backgroundColor: "{colors.planning-soft}"
    textColor: "{colors.planning-ink}"
    rounded: "{rounded.tag}"
    padding: "3px 7px"
  register:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
---

# Design System: Architect Pro dashboard

## Overview

**Creative North Star: "The civic architecture centre"**

This system applies to the redesigned `/dashboard` and elements inside `.practice-shell`. It describes the built dashboard, not an application-wide theme migration. Other routes retain their existing warm palette and components.

Cool steel-blue navigation, white work surfaces and compact system typography give the practice a clear working environment. Brand expression comes from the shared project-stage palette and precise alignment, while navigation, search, filters and date controls remain familiar.

**Key Characteristics:**

- A project register with stage and next action visible together.
- Cool tonal layering with indigo selection and restrained state colours.
- Responsive density that preserves access to projects on small screens.
- Existing Architect Pro logo assets and consistent Lucide line icons.

## Colors

The neutral foundation is cool; colour distinguishes selection, project stage and actionable state.

- **Primary indigo:** `primary` for the main action, `primary-hover` for hover, and `primary-soft` for selected or quiet interactive surfaces.
- **Cool mist / white / steel-blue:** `ground`, `surface` and `rail` separate the canvas, working areas and navigation.
- **Graphite / slate / pale rule:** `ink`, `muted` and `line` establish hierarchy and boundaries.
- **Project phases:** `lead`, `documents`, `planning`, `warrant` and `complete` recur in pipeline segments, legend keys and project stage tracks.
- **State colours:** `danger` marks overdue or urgent work, `warning` marks review work, and `ready` marks prepared work.

**The Shared Phase Rule.** A project stage uses the same colour family in the pipeline and the project register. Always pair colour with a text label.

## Typography

The dashboard uses one workhorse UI stack: Segoe UI Variable Text, Segoe UI, Aptos, sans-serif. This is an Operate surface; typography supports repeated scanning rather than a separate display identity.

- **Headline:** the observed fluid page-heading role in frontmatter; 27px on the compact phone layout.
- **Title:** 16px / 650 for the project register; other section headings are 14px / 650.
- **Body:** 14px base, with project names at 13px / 600 and actionable row text at 12px.
- **Label:** 11px for secondary information. Dense metadata currently also uses 9–10px; that is not a recommended general-purpose text role.
- **Metric:** 29px / 600 on desktop and 24px in the compact phone summary.
- Counts, dates and stage totals use tabular numerals where defined in the source.

**The Single Voice Rule.** Preserve sentence case and the same UI family across headings, labels and actions.

## Layout

The desktop shell has a fixed 226px rail and a sticky utility header at least 65px high. Main content is centred within 1540px, with 35px horizontal padding. The primary work column is fluid; the secondary column is 292px, separated by 24px. The register uses a three-column table with project, current stage and next action.

At 1279px and below, the rail becomes 200px, the secondary column 255px, the gutter 18px and main padding 24px. At 1050px, the main work areas stack and the secondary area becomes two columns. At 767px, the rail gives way to a compact mobile header and native disclosure navigation; summary figures form a two-column grid. At 560px, project rows become a two-column layout beneath their project identity, search and filters stack, and the secondary area stacks vertically. The mobile summary compresses to label/value pairs and omits its explanatory captions, page tagline and redundant date line.

**The Working View Rule.** At 390×844, retain the first project's name, stage and next action in the first viewport. Density changes serve the task.

## Elevation & Depth

White surfaces and pale borders carry most of the hierarchy. Registers and the secondary column use a 1px rule without a broad shadow. Elevation is reserved for active navigation, a selected filter, input focus and the mobile navigation popover.

Observed shadows are `0 3px 9px #34508109` for active navigation, `0 1px 4px #273a5a13` for a selected filter, `0 0 0 2px #4e5fc11a` for search focus, and `0 10px 25px #26344918` for the mobile popover. The focus ring is functional, not decorative elevation.

## Shapes

Work surfaces use 12px corners. Primary and secondary actions and navigation use 7px; search uses 6px; stage tags use 4px. Stage-track segments have narrow, almost square corners. The profile avatar is circular. These different shapes encode hierarchy rather than applying one radius everywhere.

## Components

### Buttons

Primary buttons use indigo, white text, 7px corners and a 40px minimum desktop height. The hover colour deepens. Secondary actions use a white surface and pale border; text actions remain visually quieter. Controls have a visible 3px focus outline offset by 3px. Disabled buttons reduce opacity and show a waiting cursor.

### Search and filters

The search field is a bordered 34px-high container with a leading search icon, expanding to 38px on phones. Its focus treatment changes border colour and adds a functional ring. A clear control appears when the query is non-empty. The adjacent filter group uses a pale well with a white selected button; pressed state is programmatic as well as visual.

### Register and stage tags

Use one white, bordered register rather than separate cards for each project. Row separators, restrained hover fill and aligned columns support scanning. Keep each project's name, location/client, current stage and next useful action connected. Stage badges include text, and five small track segments repeat the appropriate phase colour.

### Navigation

The pale rail contains familiar links with 19px line icons. The current page is white with indigo text. A native disclosure menu replaces the rail on mobile, with 44px navigation rows. The queue remains inline in the sticky header.

### Attention and deadlines

Attention items use icons, text and state colour without individual bordered card shells. Preserve explicit planning-action and warrant-action totals below the list. Date tiles pair a month and day; overdue work also states “Overdue”. The deadline range applies to deadlines, independently of project search.

### States and browser surfaces

Initial loading uses calm skeletons. A failed initial request offers retry; a failed refresh retains the last loaded information and explains that it is stale. Empty filters offer recovery and an empty practice offers project creation. Selection, caret, scrollbars and focus treatments use the dashboard palette. Reduced-motion preference disables the loading animation and transitions.

## Do's and Don'ts

### Do

- **Do** keep the shared phase colours and explicit stage labels.
- **Do** preserve visible keyboard focus and semantic control states.
- **Do** compact secondary information before pushing project records down on phones.
- **Do** label preview data and keep it separate from live practice records.
- **Do** scope this system to the dashboard until another route is deliberately migrated.

### Don't

- **Don't** replace real project information with decorative architectural drawings.
- **Don't** add shadows to every work surface.
- **Don't** communicate urgency or project stage through colour alone.
- **Don't** treat the current 9–10px metadata as a default body-text size.
- **Don't** infer practice counts, activity trends or connection health from decorative placeholders.
