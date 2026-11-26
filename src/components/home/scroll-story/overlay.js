import { APPLICATIONS, MANUAL_MIN, U_VALUE, ledgerAt, windowAt } from "./story.js";

// The Architect Pro window and the time ledger, drawn over the scene.
// Both are pure functions of state, so scrolling backwards shows exactly what it showed before.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** "Location plan · 1:1250" → ["Location plan", "1:1250"]: shown as two columns, never dot-joined. */
const split = (text) => {
  const i = text.indexOf(" · ");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i + 3)];
};
const tick = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const mark = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 27h24M7 27V14l9-8 9 8v13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M12.5 27v-7h7v7" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';
const appOf = (key) => APPLICATIONS.find((a) => a.key === key);
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
/** Up to three rows around the one in progress: what a phone has room for. */
const recent = (flags, i) => {
  const next = flags.indexOf(false);
  const at = next < 0 ? flags.length - 1 : next;
  return i <= at && i > at - 3;
};

function steps(state) {
  const last = state.app === "completion" ? "Submit" : "Pay";
  const order = ["collect", "fill", "pay", "running"];
  const at = order.indexOf(state.kind === "pay" && state.app === "completion" ? "running" : state.kind);
  return `<ol class="aw-steps">${["Read", "Fill", last]
    .map((name, i) => `<li data-k="step-${i}" class="${at > i || state.kind === "running" ? "done" : at === i ? "now" : ""}">${name}</li>`)
    .join("")}</ol>`;
}

function body(state) {
  if (state.kind === "uvalue") {
    const u = state.uvalue;
    return `<section class="aw-section aw-uvalue">
      <p class="aw-caption">Wall build-up</p>
      <ol class="aw-layers">${u.layers
        .map((l, i) => `<li data-k="layer-${i}" class="${i < u.shown ? "in" : ""}"><i style="--i:${i}"></i>${esc(l)}</li>`)
        .join("")}</ol>
      <p data-k="u-result" class="aw-result${u.result ? " in" : ""}"><b>${esc(U_VALUE.result)}</b><span>${esc(U_VALUE.method)}</span></p>
      <p data-k="u-target" class="aw-target${u.result ? " in" : ""}">${tick}Meets the ${esc(U_VALUE.target.replace(" · ", ", "))} target</p>
    </section>`;
  }
  if (state.kind === "running") {
    const app = appOf(state.app);
    const total = app.autoMin * 60;
    const done = state.etaSeconds === 0;
    return `<section class="aw-section aw-running${done ? " done" : ""}">
      <p class="aw-run"><span class="aw-dial" style="--t:${(1 - state.etaSeconds / total).toFixed(3)}"></span>
        <span><b data-k="run-title">${done ? "Submitted" : "Completing the portal"}</b>
        <small data-k="run-eta">${done ? "In the background, while you drew" : `About ${clock(state.etaSeconds)} left. Back to your drawing.`}</small></span></p>
    </section>`;
  }
  if (state.kind === "record") {
    return `<section class="aw-section aw-record"><p class="aw-caption">Project record</p><p class="aw-note">Drawings, certificates and replies kept together for the next stage.</p></section>`;
  }
  const docsRead = state.docs.map((d) => d.read);
  const reading = state.kind === "collect";
  const docs = `<section class="aw-section aw-docs${reading ? " current" : ""}">
    <p class="aw-caption">${reading ? "Reading documents" : `${state.docs.length} documents read`}</p>
    <ul>${state.docs
      .map((d, i) => {
        const [name, scale] = split(d.label);
        const scanning = reading && !d.read && docsRead.indexOf(false) === i;
        return `<li data-k="doc-${i}" class="${d.read ? "read" : ""}${scanning ? " scanning" : ""}${recent(docsRead, i) ? " recent" : ""}"><span class="aw-tick">${tick}</span><span class="aw-name">${esc(name)}</span><span class="aw-scale">${esc(scale)}</span></li>`;
      })
      .join("")}</ul>
  </section>`;
  if (reading) return docs;
  const filled = state.fields.map((f) => f.filled);
  const fields = `<section class="aw-section aw-fields current">
    <dl>${state.fields
      .map(
        (f, i) => `<div data-k="field-${i}" class="${f.filled ? "filled" : ""}${recent(filled, i) ? " recent" : ""}"><dt>${esc(f.label)}</dt><dd><span class="aw-value">${esc(f.value)}</span><small>from ${esc(f.source)}</small></dd></div>`,
      )
      .join("")}</dl>
  </section>`;
  let fee = "";
  if (state.fee) {
    const [label, detail] = split(state.fee.text);
    const pay = state.fee.kind === "none" ? "" : `<button type="button" tabindex="-1" data-action="pay" data-k="pay" class="aw-pay${state.payTapped ? " tapped" : ""}">Pay</button>`;
    fee = `<div class="aw-fee" data-fee="${state.fee.kind}"><p><b>${esc(label)}</b>${detail ? `<span>${esc(detail)}</span>` : ""}</p>${pay}</div>`;
  }
  return `<p class="aw-done-docs">${tick}${state.docs.length} documents read</p>${fields}${fee}`;
}

function titleBlock(state) {
  return `<footer class="aw-block">${state.statuses
    .map((s) => {
      const app = appOf(s.app);
      return `<p data-k="status-${s.app}" class="aw-status" data-state="${s.label.toLowerCase().replace(/\s+/g, "-")}" style="--app:${app.colour}"><span>${app.short}</span><b>${esc(s.label)}</b></p>`;
    })
    .join("")}</footer>`;
}

/** The Architect Pro window for one moment of the story. Empty when it is off screen. */
export function windowMarkup(state) {
  if (!state.visible) return "";
  const app = state.app ? appOf(state.app) : null;
  const head = `<header class="aw-head"><span class="aw-mark">${mark}</span><p><small>Architect Pro</small><b>${esc(state.title)}</b></p></header>`;
  const track = app && state.kind !== "uvalue" && state.kind !== "record" ? steps(state) : "";
  return `<div class="aw" data-app="${app ? app.key : "record"}" data-kind="${state.kind}" style="--app:${app ? app.colour : "var(--muted)"}">${head}${track}${body(state)}${titleBlock(state)}</div>`;
}

/** A scale bar, like the one on every drawing: an hour by hand against minutes with Architect Pro. */
export function ledgerMarkup(ledger) {
  const fmt = (m) => `${Number.isInteger(m) ? m : m.toFixed(1)} min`;
  let from = 0;
  const manual = APPLICATIONS.map((a) => {
    const share = Math.max(0, Math.min(a.manualMin, ledger.manual - from));
    const seg = `<i style="--from:${from / MANUAL_MIN};--w:${share / MANUAL_MIN};--app:${a.colour}"></i>`;
    from += a.manualMin;
    return seg;
  }).join("");
  const ticks = Array.from({ length: 13 }, (_, i) => `<u style="--at:${i / 12}"${i % 3 === 0 ? ' class="major"' : ""}></u>`).join("");
  return `<div class="lg-row"><span class="lg-label">By hand</span><span class="lg-bar">${ticks}${manual}</span><b>${fmt(Math.round(ledger.manual))}</b></div>
    <div class="lg-row lg-ap"><span class="lg-label">Architect Pro</span><span class="lg-bar">${ticks}<i style="--from:0;--w:${ledger.auto / MANUAL_MIN}"></i></span><b>${fmt(Math.round(ledger.auto * 2) / 2)}</b></div>
    <p class="lg-scale"><span>0</span><span>15</span><span>30</span><span>45</span><span>60 min</span></p>`;
}

/**
 * Patches the live overlay in place. Elements keep their identity while the same
 * application step is on screen, so CSS transitions (typing, ticks, the pay tap) run.
 */
function patch(host, html, key) {
  if (host.dataset.key !== key) {
    host.dataset.key = key;
    host.innerHTML = html;
    return;
  }
  const next = document.createElement("template");
  next.innerHTML = html;
  for (const el of next.content.querySelectorAll("[data-k]")) {
    const live = host.querySelector(`[data-k="${el.dataset.k}"]`);
    if (!live) continue;
    if (live.className !== el.className) live.className = el.className;
    if (live.getAttribute("style") !== el.getAttribute("style")) el.hasAttribute("style") ? live.setAttribute("style", el.getAttribute("style")) : live.removeAttribute("style");
    if (live.dataset.state !== el.dataset.state && el.dataset.state) live.dataset.state = el.dataset.state;
    if (!el.children.length && live.textContent !== el.textContent) live.textContent = el.textContent;
    else if (el.children.length && live.innerHTML !== el.innerHTML && !live.matches("li, div[data-k]")) live.innerHTML = el.innerHTML;
  }
  for (const el of next.content.querySelectorAll(".aw-dial, .lg-bar i")) {
    const all = [...next.content.querySelectorAll(el.matches(".aw-dial") ? ".aw-dial" : ".lg-bar i")];
    const live = host.querySelectorAll(el.matches(".aw-dial") ? ".aw-dial" : ".lg-bar i")[all.indexOf(el)];
    if (live && live.getAttribute("style") !== el.getAttribute("style")) live.setAttribute("style", el.getAttribute("style"));
  }
  for (const el of next.content.querySelectorAll(".lg-row b, .aw-caption")) {
    const sel = el.matches(".lg-row b") ? ".lg-row b" : ".aw-caption";
    const all = [...next.content.querySelectorAll(sel)];
    const live = host.querySelectorAll(sel)[all.indexOf(el)];
    if (live && live.textContent !== el.textContent) live.textContent = el.textContent;
  }
}

export function createOverlay(root) {
  const win = root.querySelector("#app-window"),
    led = root.querySelector("#ledger");
  let lastWindow = "",
    lastLedger = "";
  return {
    update(p) {
      const state = windowAt(p);
      const html = windowMarkup(state);
      if (html !== lastWindow) {
        lastWindow = html;
        patch(win, html, `${state.app}:${state.kind}:${state.visible}`);
        win.classList.toggle("show", state.visible);
      }
      const ledger = ledgerAt(p);
      const ledgerHtml = ledgerMarkup(ledger);
      if (ledgerHtml !== lastLedger) {
        lastLedger = ledgerHtml;
        patch(led, ledgerHtml, "ledger");
      }
      led.classList.toggle("show", p >= 0.115);
    },
    /** Where the window sits on screen, for documents flying into it. */
    rect() {
      if (!win.classList.contains("show")) return null;
      const r = win.getBoundingClientRect();
      return r.width && r.height ? r : null;
    },
  };
}
