// The whole story is a pure function of scroll progress (0 → 1).
// Nothing accumulates, so scrolling backwards always lands on exactly the same frame.
//
// 14 Harbour Lane is an existing two-storey house. The project adds a second-floor
// timber studio with a roof terrace: a householder planning application, a building
// warrant and, once it is built, a completion certificate.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (v) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
/** Eased 0→1 window between progress a and b. */
export const win = (p, a, b) => smooth((p - a) / (b - a));
/** Linear 0→1 window: used for clocks and ledgers, which should move evenly. */
export const lin = (p, a, b) => clamp((p - a) / (b - a));
export const mix = (a, b, t) => a + (b - a) * t;

/** The three applications, in the order a project meets them. Minutes are illustrative. */
export const APPLICATIONS = [
  { key: "planning", name: "Householder planning", short: "Planning", colour: "#6c86c6", manualMin: 15, autoMin: 1, fee: "entered" },
  { key: "warrant", name: "Building warrant", short: "Warrant", colour: "#488b85", manualMin: 25, autoMin: 1.5, fee: "calculated" },
  { key: "completion", name: "Completion certificate", short: "Completion", colour: "#7c9d70", manualMin: 20, autoMin: 1.5, fee: "none" },
];
export const MANUAL_MIN = APPLICATIONS.reduce((s, a) => s + a.manualMin, 0); // 60
export const AUTO_MIN = APPLICATIONS.reduce((s, a) => s + a.autoMin, 0); // 4
export const SAVED_MIN = MANUAL_MIN - AUTO_MIN;
export const FINAL_AT = 0.965;

/**
 * Each application's paperwork window: documents read, form filled, paid (or not),
 * then running in the background until it is submitted. Decisions arrive later as
 * tracked replies.
 */
const RUNS = [
  { collect: 0.12, fill: 0.17, pay: 0.215, tap: 0.235, submitted: 0.25, decided: 0.33, decision: "Approved", end: 0.27 },
  { collect: 0.38, fill: 0.42, pay: 0.455, tap: 0.468, submitted: 0.48, decided: 0.53, decision: "Approved", end: 0.5, uvalue: 0.32 },
  { collect: 0.74, fill: 0.79, pay: null, tap: 0.82, submitted: 0.84, decided: 0.875, decision: "Accepted", end: 0.9 },
];

export const beats = [
  { at: 0, chapter: 0, app: null, kind: "intro", headline: "From first sketch to completion certificate.", line: "Architect Pro prepares planning, building warrant and completion for you." },
  { at: 0.03, chapter: 0, app: null, kind: "design", headline: "Every project starts with a red line.", line: "Draw the site and the design, as you always have." },
  { at: 0.12, chapter: 0, app: "planning", kind: "collect", headline: "Your drawings, collected and read.", line: "Every sheet labelled by type, scale and revision. Anything it is unsure of, it asks you." },
  { at: 0.17, chapter: 0, app: "planning", kind: "fill", headline: "Read into the householder application.", line: "Each field filled from the drawings or the project. Nothing typed twice." },
  { at: 0.215, chapter: 0, app: "planning", kind: "pay", headline: "Add the fee and pay.", line: "That is your part. It completes the portal in the background." },
  { at: 0.27, chapter: 1, app: "warrant", kind: "design", headline: "Then the technical detail.", line: "Sections, structure, drainage, fire and energy for the building warrant." },
  { at: 0.32, chapter: 1, app: "warrant", kind: "uvalue", headline: "U-values, calculated to ISO 6946.", line: "Set out the build-up and the result and report are ready for the warrant." },
  { at: 0.38, chapter: 1, app: "warrant", kind: "collect", headline: "A full building warrant, coming together.", line: "Every document read and matched to the right section." },
  { at: 0.42, chapter: 1, app: "warrant", kind: "fill", headline: "Details finalised. Fee calculated.", line: "The building standards fee is worked out for you. All you do is pay." },
  { at: 0.455, chapter: 1, app: "warrant", kind: "pay", headline: "Pay, and get back to drawing.", line: "It submits in the background while you get on with the architecture." },
  { at: 0.5, chapter: 2, app: null, kind: "build", headline: "Then it gets built.", line: "Approved and on site. Every document stays in the project record." },
  { at: 0.66, chapter: 3, app: null, kind: "inspect", headline: "Finished, and checked over.", line: "Fire, energy, drainage and electrical, signed off one by one." },
  { at: 0.74, chapter: 3, app: "completion", kind: "collect", headline: "Completion certificates, gathered and read.", line: "EPC, sustainability, construction and design certificates matched to the warrant." },
  { at: 0.79, chapter: 3, app: "completion", kind: "fill", headline: "Completion, ready to submit.", line: "Details pulled from the warrant. No fee for a completion certificate." },
  { at: 0.82, chapter: 3, app: "completion", kind: "background", headline: "Submitted in the background.", line: "Accepted when the verifier replies." },
  { at: 0.86, chapter: 4, app: null, kind: "ring", headline: "An hour of portal work. Four minutes.", line: "Planning, warrant and completion, completed in the background." },
  { at: FINAL_AT, chapter: 4, app: null, kind: "final", headline: `${SAVED_MIN} minutes back on every project.`, line: "Spend them on architecture." },
];

const CHAPTERS = [
  { name: "Planning", start: 0, jump: 0.035 },
  { name: "Building warrant", start: 0.27, jump: 0.3 },
  { name: "Construction", start: 0.5, jump: 0.56 },
  { name: "Completion", start: 0.66, jump: 0.72 },
  { name: "Time back", start: 0.86, jump: 0.9 },
];
/** Chapters for the dock. Title and body are the chapter's opening beat, for the transcript. */
export const acts = CHAPTERS.map((c, i) => {
  const first = beats.find((b) => b.chapter === i);
  return { ...c, title: first.headline, body: first.line };
});

export function actAt(p) {
  let i = 0;
  while (i < acts.length - 1 && p >= acts[i + 1].start) i++;
  return i;
}
export function beatAt(p) {
  let i = 0;
  while (i < beats.length - 1 && p >= beats[i + 1].at) i++;
  return beats[i];
}

/** Minutes by hand and with Architect Pro, building up as each application is done. */
export function ledgerAt(p) {
  let manual = 0,
    auto = 0;
  APPLICATIONS.forEach((a, g) => {
    const t = lin(p, RUNS[g].collect, RUNS[g].submitted);
    manual += a.manualMin * t;
    auto += a.autoMin * t;
  });
  const round = (v) => Math.round(v * 100) / 100;
  return { manual: round(manual), auto: round(auto) };
}

// What the Architect Pro window shows for each application.
const money = (minor) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
/** calculateBuildingStandardsFee for £85,000 of works (checked against the calculator in the tests). */
export const EXAMPLE_WARRANT_FEE_MINOR = 129000;
const CONTENT = [
  {
    title: "Householder application",
    docs: ["Location plan · 1:1250", "Site plan · 1:200", "Existing elevations · 1:100", "Proposed elevations · 1:100", "Floor plans · 1:100"],
    fields: [
      ["Site address", "14 Harbour Lane", "Project"],
      ["Applicant", "Harbour Lane Homes Ltd", "Project"],
      ["Proposal", "Second-floor studio extension with roof terrace", "Design statement"],
      ["Ownership", "Certificate A", "Ownership certificate"],
    ],
    fee: { kind: "entered", text: "Planning fee · added by you" },
  },
  {
    title: "Building warrant",
    docs: ["Building sections · 1:50", "Structural calculations", "Drainage layout", "Fire safety strategy", "U-value report · ISO 6946"],
    fields: [
      ["Value of works", "£85,000", "Project"],
      ["Certifier of design", "Structural", "Certificate"],
      ["Description", "Second-floor timber studio", "Drawings"],
    ],
    fee: { kind: "calculated", text: `Fee calculated · ${money(EXAMPLE_WARRANT_FEE_MINOR)}` },
  },
  {
    title: "Completion certificate",
    docs: ["Energy Performance Certificate", "Statement of Sustainability", "Certificate of Construction", "Form Q · design certificate", "Fire Safety Design Summary"],
    fields: [
      ["Warrant", "BW/26/0412", "Warrant"],
      ["Covers all work", "Yes", "Warrant"],
    ],
    fee: { kind: "none", text: "No fee" },
  },
];
export const U_VALUE = {
  layers: ["Brick 102.5 mm", "Cavity 50 mm", "PIR insulation 100 mm", "Block 100 mm", "Plasterboard 12.5 mm"],
  result: "0.17 W/m²K",
  method: "ISO 6946",
  target: "0.17 or better · Section 6",
};
const TAP_HOLD = 0.006;
const WINDOW_FROM = 0.115,
  WINDOW_TO = 0.9;

function statusOf(g, p) {
  const r = RUNS[g];
  if (p >= r.decided) return r.decision;
  if (p >= r.submitted) return "Submitted";
  if (p >= (r.uvalue ?? r.collect)) return "In progress";
  return "Not started";
}

export function windowAt(p) {
  const statuses = APPLICATIONS.map((a, g) => ({ app: a.key, label: statusOf(g, p) }));
  const visible = p >= WINDOW_FROM && p < WINDOW_TO;
  // the application on screen, if any
  let g = -1;
  if (p >= RUNS[2].collect) g = 2;
  else if (p >= acts[1].start && p < acts[2].start) g = 1;
  else if (p < acts[1].start) g = 0;
  const base = { visible, app: null, kind: "record", title: "14 Harbour Lane", docs: [], fields: [], fee: null, uvalue: null, payTapped: false, etaSeconds: null, statuses };
  if (!visible || g < 0) return base;
  const r = RUNS[g],
    c = CONTENT[g],
    a = APPLICATIONS[g];
  // before its documents arrive, the warrant shows its U-value step, or the planning run still finishing
  if (p < r.collect) {
    if (g === 1 && p >= r.uvalue) {
      const t = lin(p, 0.33, 0.37);
      const shown = Math.min(U_VALUE.layers.length, Math.floor(t * U_VALUE.layers.length + 1e-9));
      return { ...base, app: a.key, kind: "uvalue", title: "U-value calculator", uvalue: { layers: U_VALUE.layers, shown, result: shown === U_VALUE.layers.length ? U_VALUE.result : null } };
    }
    return base;
  }
  const readT = lin(p, r.collect, r.fill - 0.005);
  const docs = c.docs.map((label, i) => ({ label, read: readT >= (i + 1) / c.docs.length }));
  const fillT = lin(p, r.fill, (r.pay ?? r.tap) - 0.005);
  const fields = c.fields.map(([label, value, source], i) => ({ label, value, source, filled: fillT >= (i + 1) / (c.fields.length + 0.5) }));
  const fee = p >= r.fill ? c.fee : null;
  let kind = p >= r.fill ? "fill" : "collect";
  if (r.pay !== null && p >= r.pay) kind = "pay";
  const payTapped = r.pay !== null && p >= r.tap;
  // the tap stays on screen for a moment before the run takes over
  const runFrom = r.pay !== null ? r.tap + TAP_HOLD : r.tap;
  let etaSeconds = null;
  if (p >= runFrom) {
    kind = "running";
    etaSeconds = Math.round(a.autoMin * 60 * (1 - lin(p, runFrom, r.submitted)));
  }
  return { ...base, app: a.key, kind, title: c.title, docs, fields, fee, payTapped, etaSeconds };
}

/** Every animated quantity in the scene, derived from progress. */
export function poseAt(p) {
  const ringOpen = win(p, 0, 0.02) * (1 - win(p, 0.035, 0.075));
  return {
    p,
    // planning: the red line, the drawing, the studio massing
    redline: win(p, 0.02, 0.06),
    plan: win(p, 0.035, 0.09),
    grid: 1 - 0.75 * win(p, 0.08, 0.2),
    studio: {
      walls: win(p, 0.07, 0.11),
      roof: win(p, 0.105, 0.125),
      glazing: win(p, 0.11, 0.13),
      terrace: win(p, 0.1, 0.125),
    },
    // each application's sheets, from the first peeling off the model to the last in the window
    sheets: RUNS.map((r) => ({ t: lin(p, r.collect, r.fill) })),
    // building warrant: the studio cut open, its wall build-up exploded into layers
    section: {
      cut: win(p, 0.275, 0.305) * (1 - win(p, 0.46, 0.5)),
      explode: win(p, 0.315, 0.345) * (1 - win(p, 0.37, 0.385)),
      uvalue: lin(p, 0.33, 0.37),
    },
    construction: {
      ghost: win(p, 0.5, 0.53) * (1 - win(p, 0.615, 0.645)),
      hoarding: win(p, 0.5, 0.52) * (1 - win(p, 0.655, 0.675)),
      scaffold: win(p, 0.51, 0.55) * (1 - win(p, 0.635, 0.66)),
      cranes: win(p, 0.515, 0.54) * (1 - win(p, 0.64, 0.665)),
      swing: 1.1 * Math.sin(lin(p, 0.54, 0.63) * Math.PI * 4),
      lift: lin(p, 0.54, 0.63),
      storey: lin(p, 0.545, 0.625),
      roof: win(p, 0.615, 0.64),
    },
    built: win(p, 0.6, 0.65),
    landscape: win(p, 0.66, 0.7),
    inspection: {
      ring: win(p, 0.675, 0.69) * (1 - win(p, 0.742, 0.76)),
      checks: [0.69, 0.703, 0.716, 0.729].map((a) => win(p, a, a + 0.007)),
    },
    city: mix(mix(0.05, 0.35, win(p, 0.03, 0.12)), 1, win(p, 0.12, 0.3)),
    dusk: win(p, 0.88, 1),
    ringOpen,
    ringFinal: lin(p, 0.87, 0.93),
    sketch: win(p, 0.92, 0.985),
  };
}

/**
 * Colour worlds: tinted paper. `paper` is the ground and horizon, `sky` the tone
 * overhead, `ink` the outline colour, `model` the white of the model itself.
 */
const BLUE = { paper: "#e6edf9", sky: "#d9e4f6", ink: "#1d3f9e", grid: "#9db4e3", model: "#ffffff" };
const TEAL = { paper: "#e3efee", sky: "#d4e7e5", ink: "#16403c", grid: "#a2c9c4", model: "#ffffff" };
const SITE = { paper: "#f5ebdd", sky: "#eedcc4", ink: "#3d2a1a", grid: "#dcc3a0", model: "#fffaf3" };
const GREEN = { paper: "#e3f4ed", sky: "#d4ede2", ink: "#0f4a40", grid: "#a5d6c4", model: "#ffffff" };
const GOLD = { paper: "#f8eedc", sky: "#f2e4cb", ink: "#3d2a1a", grid: "#dcc7a3", model: "#ffffff" };
export const worlds = [
  { at: 0, ...BLUE },
  { at: 0.245, ...BLUE },
  { at: 0.29, ...TEAL },
  { at: 0.48, ...TEAL },
  { at: 0.53, ...SITE },
  { at: 0.64, ...SITE },
  { at: 0.69, ...GREEN },
  { at: 0.85, ...GREEN },
  { at: 0.9, ...GOLD },
  { at: 1, paper: "#f8e3cc", sky: "#f3cfae", ink: "#3d2a1a", grid: "#d9b48a", model: "#fff7ec" },
];

/** Overlay theme per chapter: ink text on that chapter's paper. */
export const themes = [
  { paper: "#e6edf9", fg: "#10224f", muted: "#4e6293", accent: "#3f5fb0", panel: "rgba(255, 255, 255, 0.86)", line: "rgba(16, 34, 79, 0.14)" },
  { paper: "#e3efee", fg: "#0f3633", muted: "#4a6f6b", accent: "#2f6f69", panel: "rgba(255, 255, 255, 0.86)", line: "rgba(15, 54, 51, 0.14)" },
  { paper: "#f5ebdd", fg: "#3a2513", muted: "#7d5f44", accent: "#a35a12", panel: "rgba(255, 255, 255, 0.84)", line: "rgba(58, 37, 19, 0.14)" },
  { paper: "#e3f4ed", fg: "#0c3a33", muted: "#477368", accent: "#2f7a52", panel: "rgba(255, 255, 255, 0.86)", line: "rgba(12, 58, 51, 0.14)" },
  { paper: "#f8eedc", fg: "#3a2513", muted: "#805f42", accent: "#a66305", panel: "rgba(255, 255, 255, 0.82)", line: "rgba(58, 37, 19, 0.14)" },
];

