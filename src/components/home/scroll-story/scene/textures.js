import * as THREE from "three";

const FONT = '"Space Grotesk", system-ui, sans-serif';
const INK = "#16264a";
const SOFT = "#7d89a3";
const RULE = "#d9dee8";
const RED = "#e0402f";
const BLUE = "#2b52d4";

function canvasTexture(w, h, paint) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  paint(ctx, w, h);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}
function txt(ctx, value, x, y, size, color = INK, weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}
function lines(ctx, x, y, w, count, gap = 22, color = RULE) {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const len = w * (i % 4 === 3 ? 0.55 : 0.86 + ((i * 37) % 10) / 80);
    ctx.fillRect(x, y + i * gap, len, 7);
  }
}
function frame(ctx, x, y, w, h, color = INK, width = 3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x, y, w, h);
}

// Small line drawings that make each sheet read as what it is.
const drawings = {
  form(ctx) {
    for (let i = 0; i < 6; i++) {
      const y = 200 + i * 66;
      txt(ctx, ["Applicant", "Site address", "Proposal", "Agent", "Ownership", "Fee"][i], 46, y, 17, SOFT, 500);
      ctx.strokeStyle = RULE;
      ctx.lineWidth = 2;
      ctx.strokeRect(46, y + 10, 420, 34);
    }
    ctx.fillStyle = BLUE;
    ctx.fillRect(56, 222, 180, 10);
    ctx.fillRect(56, 288, 240, 10);
  },
  plan(ctx) {
    frame(ctx, 70, 190, 372, 250, INK, 6);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(70, 300);
    ctx.lineTo(300, 300);
    ctx.moveTo(300, 190);
    ctx.lineTo(300, 440);
    ctx.moveTo(180, 300);
    ctx.lineTo(180, 440);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(300, 360, 40, -Math.PI / 2, 0);
    ctx.stroke();
    lines(ctx, 46, 490, 420, 6);
  },
  elevation(ctx) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(60, 440);
    ctx.lineTo(452, 440);
    ctx.moveTo(90, 440);
    ctx.lineTo(90, 300);
    ctx.lineTo(420, 300);
    ctx.lineTo(420, 440);
    ctx.moveTo(220, 300);
    ctx.lineTo(220, 220);
    ctx.lineTo(320, 170);
    ctx.lineTo(420, 220);
    ctx.lineTo(420, 300);
    ctx.stroke();
    ctx.lineWidth = 2;
    [[110, 330], [180, 330], [250, 230], [330, 330]].forEach(([x, y]) => ctx.strokeRect(x, y, 48, 70));
    lines(ctx, 46, 500, 420, 5);
  },
  location(ctx) {
    ctx.fillStyle = "#eef1f6";
    ctx.fillRect(46, 180, 420, 300);
    ctx.strokeStyle = "#c3cad8";
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      ctx.strokeRect(60 + ((i * 97) % 360), 195 + ((i * 61) % 240), 50 + (i % 3) * 22, 36 + (i % 2) * 30);
    }
    ctx.strokeStyle = RED;
    ctx.lineWidth = 6;
    ctx.strokeRect(210, 290, 110, 84);
    lines(ctx, 46, 520, 420, 4);
  },
  text(ctx) {
    lines(ctx, 46, 190, 420, 16, 24);
  },
  calc(ctx) {
    for (let r = 0; r < 9; r++) {
      const y = 196 + r * 40;
      ctx.fillStyle = r % 2 ? "#f2f4f8" : "#ffffff";
      ctx.fillRect(46, y - 26, 420, 40);
      txt(ctx, ["Beam B1", "Load", "Span", "Moment", "Shear", "Deflection", "Section", "Check", "Result"][r], 58, y, 18, INK, 500);
      txt(ctx, ["", "6.4 kN/m", "4.2 m", "14.1 kNm", "13.4 kN", "L/412", "203×133", "OK", "Pass"][r], 300, y, 18, SOFT, 400);
    }
  },
  section(ctx) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.strokeRect(80, 220, 350, 220);
    ctx.fillStyle = "#cfd6e4";
    ctx.fillRect(80, 320, 350, 14);
    ctx.fillRect(80, 220, 350, 14);
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(60, 452);
    ctx.lineTo(452, 452);
    ctx.stroke();
    ctx.setLineDash([]);
    lines(ctx, 46, 500, 420, 5);
  },
  email(ctx) {
    txt(ctx, "From: client", 46, 196, 20, SOFT, 500);
    txt(ctx, "Re: Re: Fwd: revised drawings", 46, 232, 22, INK, 700);
    lines(ctx, 46, 270, 420, 10, 26);
  },
};

const docSpecs = [
  // Planning permission, 12 sheets
  ["Planning", "Application form", "Householder", "form"],
  ["Planning", "Location plan", "1:1250", "location"],
  ["Planning", "Site plan", "1:200", "plan"],
  ["Planning", "Existing elevations", "1:100", "elevation"],
  ["Planning", "Proposed elevations", "1:100", "elevation"],
  ["Planning", "Floor plans", "1:100", "plan"],
  ["Planning", "Design statement", "Rev B", "text"],
  ["Planning", "Ownership certificate", "Certificate A", "form"],
  ["Planning", "Roof plan", "1:100", "plan"],
  ["Planning", "Street elevation", "1:200", "elevation"],
  ["Planning", "Heritage statement", "Conservation area", "text"],
  ["Planning", "Tree survey", "Arboricultural", "location"],
  // Building warrant, 12 sheets
  ["Warrant", "Warrant application", "Form A", "form"],
  ["Warrant", "Structural calculations", "Certificate of design", "calc"],
  ["Warrant", "Fire safety strategy", "Section 2", "text"],
  ["Warrant", "Energy report", "Section 6 · SAP", "calc"],
  ["Warrant", "Drainage layout", "Section 3", "plan"],
  ["Warrant", "Building sections", "1:50", "section"],
  ["Warrant", "Specification", "Materials", "text"],
  ["Warrant", "Construction details", "1:20", "section"],
  ["Warrant", "Ventilation", "Section 3.14", "calc"],
  ["Warrant", "Accessibility", "Section 4", "text"],
  ["Warrant", "Foundations", "1:50", "section"],
  ["Warrant", "Noise separation", "Section 5", "calc"],
];
// Noise the AI clears away.
const noiseSpecs = [
  ["Email", "Revised drawings", "Fwd ×4", "email"],
  ["Email", "Council query", "Validation", "email"],
  ["Note", "Chase engineer", "", "note"],
  ["Email", "Fee invoice", "Overdue?", "email"],
  ["Note", "Which revision?", "", "note"],
  ["Email", "Client: any news?", "", "email"],
  ["Note", "Check boundary", "", "note"],
  ["Email", "Neighbour comment", "", "email"],
  ["Note", "Deadline Fri!", "", "note"],
  ["Email", "Re: drainage", "", "email"],
  ["Note", "Print SAP", "", "note"],
  ["Email", "Updated survey", "", "email"],
];

function documentTexture([group, title, sub, kind]) {
  return canvasTexture(512, 724, (ctx, w, h) => {
    if (kind === "note") {
      ctx.fillStyle = "#ffd85c";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      ctx.fillRect(0, 0, w, 60);
      txt(ctx, title, 46, 330, 58, "#3b2b05", 700);
      ctx.strokeStyle = "#3b2b05";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
      return;
    }
    ctx.fillStyle = "#f8f9fc";
    ctx.fillRect(0, 0, w, h);
    const band = { Planning: "#16264a", Warrant: "#1f3f9a" }[group] ?? "#8a93a8";
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, 18);
    const heading = { Planning: "Planning permission", Warrant: "Building warrant" }[group] ?? "Inbox";
    txt(ctx, heading, 46, 74, 19, SOFT, 500);
    txt(ctx, title, 46, 120, title.length > 18 ? 34 : 40, INK, 700);
    if (sub) txt(ctx, sub, 46, 154, 19, SOFT, 400);
    drawings[kind](ctx);
    ctx.strokeStyle = "#16264a";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    // title block
    ctx.fillStyle = RULE;
    ctx.fillRect(46, h - 96, 420, 2);
    txt(ctx, "14 Harbour Lane", 46, h - 56, 19, INK, 500);
    txt(ctx, "Rev " + "ABCD"[title.length % 4], 400, h - 56, 19, SOFT, 400);
  });
}

function badgeTexture(kind) {
  return canvasTexture(256, 256, (ctx) => {
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    if (kind === "prepared") {
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 14;
      ctx.strokeStyle = "#5a3df0";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(128, 128, 40, 0, Math.PI * 2);
      ctx.fillStyle = "#5a3df0";
      ctx.fill();
    } else if (kind === "flag") {
      ctx.fillStyle = "#ffb020";
      ctx.fill();
      ctx.fillStyle = "#1a1030";
      ctx.fillRect(116, 60, 24, 92);
      ctx.fillRect(116, 172, 24, 24);
    } else {
      ctx.fillStyle = "#0d9a78";
      ctx.fill();
      ctx.lineWidth = 22;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(78, 132);
      ctx.lineTo(112, 168);
      ctx.lineTo(180, 92);
      ctx.stroke();
    }
  });
}

function labelTexture(title, sub, color) {
  return canvasTexture(1024, 200, (ctx) => {
    txt(ctx, title, 8, 110, title.length > 20 ? 78 : 88, color, 700);
    txt(ctx, sub, 12, 176, 40, color, 400);
  });
}

/** A canvas texture that can be repainted when its state changes. */
function liveTexture(w, h, paint) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  let key = "";
  return {
    map,
    size: [w, h],
    draw(state) {
      const next = JSON.stringify(state);
      if (next === key) return;
      key = next;
      ctx.clearRect(0, 0, w, h);
      paint(ctx, w, h, state);
      map.needsUpdate = true;
    },
  };
}
function pill(ctx, x, y, label, bg, fg, size = 22) {
  ctx.font = `600 ${size}px ${FONT}`;
  const w = ctx.measureText(label).width + size * 1.4;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, size * 1.7, size * 0.85);
  ctx.fill();
  txt(ctx, label, x + size * 0.7, y + size * 1.17, size, fg, 600);
  return w;
}

// A generic government-style online applications portal. Deliberately unbranded.
const portalFields = [
  ["Site address", "14 Harbour Lane"],
  ["Applicant", "Harbour Lane Homes Ltd"],
  ["Agent", "Your practice"],
  ["Description of proposal", "Three-storey house with roof terrace"],
  ["Site area", "214 m²"],
  ["Application fee", "Calculated"],
];
function paintPortal(ctx, w, h, st) {
  ctx.fillStyle = "#eceef1";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#3d4450";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = "#3d4450";
  ctx.fillRect(0, 0, w, 74);
  txt(ctx, "Online applications portal", 34, 48, 28, "#ffffff", 600);
  txt(ctx, st.auto ? "Signed in automatically" : "Signed in", w - 300, 48, 22, "#c9ced6", 400);
  txt(ctx, `${st.title}  ·  Page ${st.page} of 14`, 34, 124, 24, "#5b6370", 500);
  // progress dots
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i < st.page ? (st.auto ? "#7a66ff" : "#5b6370") : "#cfd3da";
    ctx.fillRect(34 + i * 34, 142, 26, 8);
  }
  portalFields.forEach(([label, value], i) => {
    const y = 192 + i * 74;
    txt(ctx, label, 34, y, 20, "#5b6370", 500);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(34, y + 10, 620, 44);
    ctx.strokeStyle = i < st.filled && st.auto ? "#7a66ff" : "#b8bec8";
    ctx.lineWidth = 2;
    ctx.strokeRect(34, y + 10, 620, 44);
    if (i < st.filled) txt(ctx, value, 48, y + 40, 22, "#1f2633", 500);
    if (i === st.filled && !st.auto) {
      ctx.fillStyle = "#1f2633";
      ctx.fillRect(48, y + 20, 2, 26); // the caret: someone is still typing
    }
    if (i < st.filled && st.auto) pill(ctx, 520, y + 18, "Auto", "#7a66ff", "#ffffff", 16);
  });
  // uploads
  txt(ctx, "Drawings and documents", 700, 192, 20, "#5b6370", 500);
  for (let i = 0; i < 9; i++) {
    const x = 700 + (i % 3) * 98,
      y = 206 + Math.floor(i / 3) * 112;
    ctx.fillStyle = i < st.uploads ? "#ffffff" : "#e0e3e8";
    ctx.fillRect(x, y, 86, 100);
    ctx.strokeStyle = i < st.uploads ? (st.auto ? "#7a66ff" : "#8a93a3") : "#c4c9d1";
    ctx.setLineDash(i < st.uploads ? [] : [6, 5]);
    ctx.strokeRect(x, y, 86, 100);
    ctx.setLineDash([]);
    if (i < st.uploads) {
      ctx.fillStyle = "#cfd6e4";
      for (let r = 0; r < 4; r++) ctx.fillRect(x + 12, y + 18 + r * 16, 62 - (r % 2) * 18, 6);
    }
  }
  txt(ctx, `${st.uploads} of 9 uploaded`, 700, 568, 20, "#5b6370", 500);
  // banners
  if (st.pay) {
    ctx.fillStyle = "#2b2f8f";
    ctx.fillRect(0, h - 120, w, 120);
    txt(ctx, "Everything is filled in. Fee calculated.", 34, h - 70, 32, "#ffffff", 700);
    txt(ctx, "Add your payment method and pay to finish.", 34, h - 30, 24, "#d9dcff", 400);
  } else if (st.submitted) {
    ctx.fillStyle = "#1f7a52";
    ctx.fillRect(0, h - 120, w, 120);
    txt(ctx, "Submitted by ArchitectPro", 34, h - 70, 34, "#ffffff", 700);
    txt(ctx, "Paid and submitted. Planning permission and building warrant done.", 34, h - 30, 24, "#c9f2dc", 400);
  } else {
    ctx.fillStyle = "#d5d9df";
    ctx.fillRect(0, h - 90, w, 90);
    ctx.fillStyle = st.auto ? "#7a66ff" : "#3d4450";
    ctx.fillRect(w - 230, h - 70, 196, 52);
    txt(ctx, st.auto ? "Working…" : "Save and continue", w - 216, h - 36, 20, "#ffffff", 600);
  }
}

// ArchitectPro's project record: the calm opposite of the portal.
const statusStyle = {
  Waiting: ["#e6efec", "#4e7d73"],
  Submitted: ["#fdebc4", "#8a5a00"],
  Validated: ["#d9e8fb", "#1b5fb8"],
  Approved: ["#0d9a78", "#ffffff"],
};
function paintRecord(ctx, w, h, st) {
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, 34);
  ctx.fill();
  ctx.strokeStyle = "#0f4a40";
  ctx.lineWidth = 5;
  ctx.stroke();
  txt(ctx, "14 Harbour Lane", 56, 100, 56, "#0c3a33", 700);
  txt(ctx, "Project record, kept by ArchitectPro", 58, 146, 26, "#4e7d73", 400);
  st.rows.forEach(([label, status], i) => {
    const y = 200 + i * 106;
    ctx.fillStyle = "rgba(15, 74, 64, 0.14)";
    ctx.fillRect(56, y + 90, w - 112, 2);
    txt(ctx, label, 56, y + 58, 34, "#0c3a33", 500);
    const [bg, fg] = statusStyle[status];
    ctx.font = `600 24px ${FONT}`;
    pill(ctx, w - 96 - ctx.measureText(status).width - 34, y + 22, status, bg, fg, 24);
  });
  const stats = [["24", "documents"], ["9", "drawings"], ["0", "portal logins"]];
  stats.forEach(([n, l], i) => {
    const x = 56 + i * 300;
    txt(ctx, n, x, h - 74, 60, st.saved ? "#0d9a78" : "#a9c9c0", 700);
    txt(ctx, l, x, h - 34, 24, "#4e7d73", 400);
  });
}

export function createTextures() {
  return {
    docs: docSpecs.map(documentTexture),
    noise: noiseSpecs.map(documentTexture),
    docSpecs,
    noiseSpecs,
    prepared: badgeTexture("prepared"),
    approved: badgeTexture("approved"),
    labels: [
      labelTexture("Planning permission", "12 documents", "#1e1560"),
      labelTexture("Building warrant", "12 documents", "#1e1560"),
    ],
    portal: liveTexture(1024, 720, paintPortal),
    record: liveTexture(1024, 720, paintRecord),
  };
}

export function disposeTextures(t) {
  [...t.docs, ...t.noise, ...t.labels, t.prepared, t.approved, t.portal.map, t.record.map].forEach((m) => m.dispose());
}
