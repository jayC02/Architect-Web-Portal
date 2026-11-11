// The whole story is a pure function of scroll progress (0 → 1).
// Nothing accumulates, so scrolling backwards always lands on exactly the same frame.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (v) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
/** Eased 0→1 window between progress a and b. */
export const win = (p, a, b) => smooth((p - a) / (b - a));
/** Linear 0→1 window: used for clocks, which should tick evenly. */
export const lin = (p, a, b) => clamp((p - a) / (b - a));
export const mix = (a, b, t) => a + (b - a) * t;

/** The headline numbers, in minutes, roughly. By hand means keying it all into the portal. */
export const PLANNING_MIN = 12;
export const WARRANT_MIN = 18;
export const AUTO_EACH_MIN = 1.5;
export const MANUAL_MIN = PLANNING_MIN + WARRANT_MIN; // both applications by hand
export const AUTO_MIN = AUTO_EACH_MIN * 2; // both with ArchitectPro

export const acts = [
  {
    name: "Site",
    start: 0,
    jump: 0.03,
    title: "Every project starts with a red line.",
    body: "A site, a boundary and a client with plans. Before anything is built, it has to be drawn, described and approved.",
  },
  {
    name: "Design",
    start: 0.15,
    jump: 0.23,
    title: "Then the design takes shape.",
    body: "Plans become walls, walls become rooms. This is the part architects trained for.",
  },
  {
    name: "The portal",
    start: 0.3,
    jump: 0.41,
    title: "And then the portal.",
    body: "By hand, every application means logging into eDevelopment, creating the proposal, finding the address, keying in every detail, attaching each document one by one and working out the fee. Roughly 12 minutes for planning permission and 18 for a building warrant.",
  },
  {
    name: "Automation",
    start: 0.45,
    jump: 0.55,
    title: "ArchitectPro does it in the background.",
    body: "It reads the project once, then does the whole portal for you in the background, fee calculation included. About a minute and a half per application. Add your payment method, pay, and you’re done.",
  },
  {
    name: "Tracking",
    start: 0.62,
    jump: 0.72,
    title: "Then it keeps track.",
    body: "Submissions and approvals are followed for you, and every project detail stays organised in one place for whenever you need it.",
  },
  {
    name: "Time back",
    start: 0.78,
    jump: 0.88,
    title: "27 minutes back on every project.",
    body: "Planning permission and building warrant, submitted for you. No portal, no re-typing, no timeouts. That time goes back into the architecture.",
  },
];

export const FINAL_AT = 0.965;

export function actAt(p) {
  let i = 0;
  while (i < acts.length - 1 && p >= acts[i + 1].start) i++;
  return i;
}

/**
 * Side panel per act. `clock` is a stopwatch driven by scroll; `compare` shows the
 * 16 vs 3 minute bars; a line's `steps` change its status text as you scroll.
 */
export const hud = {
  2: {
    title: "By hand, in the portal",
    clock: { to: MANUAL_MIN, a: 0.31, b: 0.44, label: "both applications", tone: "manual" },
    lines: [
      { at: 0.32, text: "Log in to eDevelopment" },
      { at: 0.334, text: "Create the proposal" },
      { at: 0.348, text: "Find the site address" },
      { at: 0.362, text: "Enter the proposal" },
      { at: 0.376, text: "Type every main detail into the portal" },
      { at: 0.39, text: "Attach each document and the location plan, one by one" },
      { at: 0.405, text: "Calculate the fee" },
      { at: 0.42, text: "Submit. Then do it all again for the warrant" },
    ],
  },
  3: {
    title: "With ArchitectPro",
    clock: { to: AUTO_MIN, a: 0.49, b: 0.6, label: "both applications", tone: "auto" },
    compare: { a: 0.49, b: 0.6 },
    lines: [
      { at: 0.5, text: "Project details read once" },
      { at: 0.515, text: "Proposal created, address found" },
      { at: 0.53, text: "Main details entered in the background" },
      { at: 0.545, text: "Documents and location plan attached" },
      { at: 0.56, text: "Fee calculated" },
      { at: 0.575, text: "You add your payment method and pay", you: true },
      { at: 0.6, text: "Planning and warrant submitted", detail: "1:30 each" },
    ],
  },
  4: {
    title: "Tracked for you",
    lines: [
      { at: 0.655, text: "Planning permission", steps: [[0.655, "Submitted"], [0.69, "Validated"], [0.72, "Approved"]] },
      { at: 0.67, text: "Building warrant", steps: [[0.67, "Submitted"], [0.705, "Validated"], [0.735, "Approved"]] },
      { at: 0.745, text: "Portal logins needed", detail: "None" },
      { at: 0.76, text: "Project record saved", detail: "24 documents" },
    ],
  },
};

/** Every animated quantity in the scene, derived from progress. */
export function poseAt(p) {
  const pack = win(p, 0.612, 0.652);
  return {
    p,
    redline: win(p, 0.01, 0.07),
    plan: win(p, 0.025, 0.13),
    grid: 1 - 0.8 * win(p, 0.14, 0.3),
    walls: [win(p, 0.14, 0.205), win(p, 0.18, 0.245), win(p, 0.22, 0.28)],
    slabs: [win(p, 0.195, 0.235), win(p, 0.235, 0.27)],
    roof: win(p, 0.265, 0.305),
    glazing: win(p, 0.28, 0.32),
    // paperwork
    docs: win(p, 0.3, 0.36),
    manual: lin(p, 0.31, 0.44),
    portal: win(p, 0.315, 0.355),
    portalAway: win(p, 0.455, 0.51),
    portalFill: lin(p, 0.53, 0.6),
    // automation
    noise: win(p, 0.445, 0.505),
    order: win(p, 0.455, 0.535),
    collapse: win(p, 0.47, 0.53),
    ai: win(p, 0.45, 0.49) * (1 - win(p, 0.6, 0.64)),
    scan: win(p, 0.48, 0.6),
    prepared: win(p, 0.505, 0.6),
    auto: lin(p, 0.49, 0.6),
    // tracking
    pack,
    submit: win(p, 0.652, 0.69),
    track: lin(p, 0.655, 0.76),
    record: win(p, 0.66, 0.7),
    store: win(p, 0.77, 0.82),
    ringHide: win(p, 0.6, 0.64),
    // time back
    built: win(p, 0.8, 0.92),
    finalRing: win(p, 0.84, 0.9),
    city: mix(mix(0.03, 0.3, win(p, 0.15, 0.3)), 1, win(p, 0.82, 0.95)),
    dusk: win(p, 0.88, 1),
  };
}

/**
 * Colour worlds: tinted paper, one per act. `paper` is the ground and horizon, `sky` the
 * tone overhead, `ink` the outline colour, `model` the white of the model itself.
 */
export const worlds = [
  { at: 0.0, paper: "#e6edf9", sky: "#d9e4f6", ink: "#1d3f9e", grid: "#9db4e3", model: "#ffffff" },
  { at: 0.13, paper: "#e9eff8", sky: "#dde7f6", ink: "#1d3f9e", grid: "#a9bde6", model: "#ffffff" },
  { at: 0.26, paper: "#f4f4f0", sky: "#eaece7", ink: "#1b2a4a", grid: "#c6cad3", model: "#ffffff" },
  { at: 0.35, paper: "#f9e7e0", sky: "#f5d9cf", ink: "#4a1c16", grid: "#e6b3a5", model: "#fffaf8" },
  { at: 0.43, paper: "#f7ddd3", sky: "#f2cdc0", ink: "#4a1c16", grid: "#e2a595", model: "#fff8f5" },
  { at: 0.5, paper: "#ebe8fc", sky: "#dedafa", ink: "#3a2bb0", grid: "#b3a9ee", model: "#f7f5ff" },
  { at: 0.6, paper: "#e8e5fb", sky: "#dad6f9", ink: "#3a2bb0", grid: "#a99eec", model: "#f4f1ff" },
  { at: 0.68, paper: "#e3f4ed", sky: "#d4ede2", ink: "#0f4a40", grid: "#a5d6c4", model: "#ffffff" },
  { at: 0.77, paper: "#e6f5ee", sky: "#d7efe5", ink: "#0f4a40", grid: "#a5d6c4", model: "#ffffff" },
  { at: 0.86, paper: "#f8eedc", sky: "#f2e4cb", ink: "#3d2a1a", grid: "#dcc7a3", model: "#ffffff" },
  { at: 1.0, paper: "#f8e3cc", sky: "#f3cfae", ink: "#3d2a1a", grid: "#d9b48a", model: "#fff7ec" },
];

/** Overlay theme per act: ink text on that act's paper. */
export const themes = [
  { paper: "#e6edf9", fg: "#10224f", muted: "#4e6293", accent: "#cd3428", panel: "rgba(255, 255, 255, 0.82)", line: "rgba(16, 34, 79, 0.16)" },
  { paper: "#f4f4f0", fg: "#14213d", muted: "#56627a", accent: "#2b52d4", panel: "rgba(255, 255, 255, 0.82)", line: "rgba(20, 33, 61, 0.16)" },
  { paper: "#f7ddd3", fg: "#3d1410", muted: "#82544a", accent: "#c63321", panel: "rgba(255, 255, 255, 0.84)", line: "rgba(61, 20, 16, 0.16)" },
  { paper: "#e8e5fb", fg: "#1e1560", muted: "#6258a8", accent: "#5a3df0", panel: "rgba(255, 255, 255, 0.84)", line: "rgba(30, 21, 96, 0.16)" },
  { paper: "#e6f5ee", fg: "#0c3a33", muted: "#477368", accent: "#087b60", panel: "rgba(255, 255, 255, 0.84)", line: "rgba(12, 58, 51, 0.16)" },
  { paper: "#f8eedc", fg: "#3a2513", muted: "#805f42", accent: "#a66305", panel: "rgba(255, 255, 255, 0.8)", line: "rgba(58, 37, 19, 0.16)" },
];
