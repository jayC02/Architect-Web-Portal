import * as THREE from "three";
import { APPLICATIONS } from "../story.js";

const FONT = '"Space Grotesk", system-ui, sans-serif';
const INK = "#16264a";
const SOFT = "#7d89a3";
const RULE = "#d9dee8";
const RED = "#e0402f";
const BLUE = "#2b52d4";

// Phones draw the static sheets at a smaller size. Text stays sharp at the size they appear.
let SCALE = 1;
function canvasTexture(w, h, paint) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * SCALE);
  canvas.height = Math.round(h * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  paint(ctx, w, h);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  // Once the GPU has its copy, free the canvas: dozens of full-size canvases kept in
  // memory are what push iOS into reloading the page.
  map.onUpdate = () => {
    canvas.width = canvas.height = 1;
    map.onUpdate = null;
  };
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
  uvalue(ctx) {
    // the wall build-up in section, then the result
    const layers = [["#c9785e", 70], ["#ffffff", 34], ["#efd15a", 70], ["#b9c0c8", 70], ["#f1efe9", 14]];
    let x = 70;
    layers.forEach(([color, w]) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, 190, w, 220);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, 190, w, 220);
      x += w;
    });
    txt(ctx, "U = 0.17 W/m²K", 46, 470, 34, INK, 700);
    txt(ctx, "ISO 6946 · combined method", 46, 506, 18, SOFT, 400);
    lines(ctx, 46, 540, 420, 4);
  },
};

// Each application's sheets, in the order they fly. The last column says where on the
// model a sheet peels from: the ground, the front, the roof, the side, or inside the house.
const docSpecs = [
  // Householder planning
  ["Planning", "Application form", "Householder", "form", "mid"],
  ["Planning", "Location plan", "1:1250", "location", "ground"],
  ["Planning", "Site plan", "1:200", "plan", "ground"],
  ["Planning", "Existing elevations", "1:100", "elevation", "facade"],
  ["Planning", "Proposed elevations", "1:100", "elevation", "facade"],
  ["Planning", "Floor plans", "1:100", "plan", "roof"],
  ["Planning", "Roof plan", "1:100", "plan", "roof"],
  ["Planning", "Design statement", "Rev B", "text", "mid"],
  ["Planning", "Ownership certificate", "Certificate A", "form", "mid"],
  // Building warrant
  ["Warrant", "Warrant application", "Form A", "form", "mid"],
  ["Warrant", "Building sections", "1:50", "section", "side"],
  ["Warrant", "Structural calculations", "Certificate of design", "calc", "mid"],
  ["Warrant", "Fire safety strategy", "Section 2", "text", "mid"],
  ["Warrant", "Energy report", "Section 6", "calc", "facade"],
  ["Warrant", "Drainage layout", "Section 3", "plan", "ground"],
  ["Warrant", "Construction details", "1:20", "section", "side"],
  ["Warrant", "Specification", "Materials", "text", "mid"],
  ["Warrant", "U-value report", "ISO 6946", "uvalue", "facade"],
  // Completion certificate
  ["Completion", "Completion certificate", "Relevant person", "form", "mid"],
  ["Completion", "Energy certificate", "EPC", "calc", "facade"],
  ["Completion", "Sustainability", "Statement", "text", "mid"],
  ["Completion", "Construction certificate", "Electrical", "form", "side"],
  ["Completion", "Design certificate", "Form Q", "form", "mid"],
  ["Completion", "Fire safety", "Design summary", "text", "mid"],
  ["Completion", "As-built plans", "1:100", "plan", "roof"],
  ["Completion", "As-built sections", "1:50", "section", "side"],
  ["Completion", "Drainage test", "Results", "calc", "ground"],
];
const GROUP = { Planning: 0, Warrant: 1, Completion: 2 };
// sheet bands: each application's colour, darkened a touch so it holds against white paper
const BANDS = ["#4a65a3", "#2f6f69", "#4f7a45"];

function documentTexture([group, title, sub, kind]) {
  return canvasTexture(512, 724, (ctx, w, h) => {
    ctx.fillStyle = "#f8f9fc";
    ctx.fillRect(0, 0, w, h);
    const g = GROUP[group];
    ctx.fillStyle = BANDS[g];
    ctx.fillRect(0, 0, w, 22);
    const heading = APPLICATIONS[g].name;
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

/** A green tick in a disc: approvals and inspection checks. */
function tickTexture() {
  return canvasTexture(256, 256, (ctx) => {
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fillStyle = "#1d8a5c";
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
  });
}

export function createTextures({ mobile = false } = {}) {
  SCALE = mobile ? 0.6 : 1;
  return {
    docs: docSpecs.map(documentTexture),
    docSpecs: docSpecs.map(([group, title, sub, kind, from]) => ({ group: GROUP[group], title, sub, kind, from })),
    tick: tickTexture(),
  };
}

export function disposeTextures(t) {
  [...t.docs, t.tick].forEach((m) => m.dispose());
}
