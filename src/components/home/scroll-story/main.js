import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { acts, actAt, hud, themes, FINAL_AT, MANUAL_MIN, AUTO_MIN, lin, win, mix } from "./story.js";

import { header, footer, simpleMarkup, pad, mark, fictionNote, FINAL_TITLE } from "./markup.js";

gsap.registerPlugin(ScrollTrigger);

export function mountScrollHome() {
  const root = document.getElementById("scroll-home");
  const app = document.getElementById("scroll-home-content");
  if (!root || !app) return;
  let generation = 0;
  let activeProgress = 0;

  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const isMobile = () => innerWidth <= 820;

  const tick = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const clockText = (min) => `${Math.floor(min)}:${String(Math.floor((min % 1) * 60)).padStart(2, "0")}`;

  function renderSimple(message = "") {
    root.dataset.view = "simple";
    view = "simple";
    applyTheme(0);
    app.innerHTML = simpleMarkup(message);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#e6edf9");
    window.scrollTo(0, 0);
  }

  function applyTheme(i) {
    const t = themes[i],
      style = root.style;
    style.setProperty("--fg", t.fg);
    style.setProperty("--muted", t.muted);
    style.setProperty("--accent", t.accent);
    style.setProperty("--panel", t.panel);
    style.setProperty("--line", t.line);
    style.setProperty("--paper-wash", t.paper);
  }

  let cleanup = () => {};

  async function render3D(initialProgress = 0) {
    const run = generation;
    const isCurrent = () => run === generation && root.isConnected;
    root.dataset.view = "3d";
    const mobile = isMobile();
    app.innerHTML = `${header(false)}
    <main id="home-content" tabindex="-1">
      <h1 class="sr-only">Architect Pro — No more portal.</h1>
      <section class="rail" id="rail" aria-label="ArchitectPro, a six-part scroll story">
        <div class="stage" id="stage" data-act="0">
          <div class="canvas-host" id="canvas-host" role="img" aria-label="A house is drawn, built and documented while its planning and warrant applications are prepared"></div>
          <div class="loading" id="loading"><span class="loading-mark">${mark}</span><span>Drawing the site…</span></div>
          <div class="copy" id="copy"></div>
          <aside class="hud" id="hud"></aside>
          <button type="button" class="scroll-hint" id="scroll-hint">Scroll to begin<svg width="14" height="20" viewBox="0 0 14 20" aria-hidden="true"><path d="M7 1v17M1.5 12.5 7 18l5.5-5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
          <footer class="dock">
            <nav class="acts" aria-label="Jump to part of the story">
              ${acts.map((a, i) => `<button type="button" data-jump="${i}" aria-label="${pad(i)} ${a.name}"><span class="num">${pad(i)}</span><span class="name">${a.name}</span></button>`).join("")}
            </nav>
            <div class="progress" aria-hidden="true"><span id="bar"></span></div>
            <p class="story-disclaimer">Illustrative example. Actual times vary.</p>
          </footer>
        </div>
      </section>
      <p class="sr-only" id="live" aria-live="polite"></p>
    </main>${footer()}`;

    const rail = document.getElementById("rail"),
      stage = document.getElementById("stage"),
      copy = document.getElementById("copy"),
      hudEl = document.getElementById("hud"),
      bar = document.getElementById("bar"),
      live = document.getElementById("live"),
      hint = document.getElementById("scroll-hint"),
      loading = document.getElementById("loading"),
      navButtons = [...stage.querySelectorAll("[data-jump]")];

    let currentAct = -1,
      isFinal = null,
      experience = null;

    const scrollToProgressInstant = (p) => window.scrollTo(0, rail.offsetTop + (rail.offsetHeight - innerHeight) * p);
    const scrollToProgress = (p) => {
      const top = rail.offsetTop + (rail.offsetHeight - innerHeight) * p;
      window.scrollTo({ top, behavior: reducedQuery.matches ? "auto" : "smooth" });
    };

    function setCopy(act, final) {
      const a = acts[act];
      copy.classList.remove("in");
      void copy.offsetWidth; // restart the entrance
      const timeBack = act === 5 && !final;
      copy.innerHTML = final
        ? `<p class="act-index"><span>${pad(act)}</span>${a.name}</p>
           <h2 class="final-title">No more portal.<br />30 minutes down to 3.</h2>
           <div class="final-actions">
             <a class="button primary" href="/register">Create your workspace</a>
             <button type="button" class="button" data-action="replay">Replay</button>
           </div>
           <p class="note">${fictionNote}</p>`
        : timeBack
          ? `<p class="act-index"><span>${pad(act)}</span>${a.name}</p>
             <p class="minutes" aria-label="${MANUAL_MIN} minutes down to ${AUTO_MIN} minutes for both applications">
               <span class="was">${MANUAL_MIN} min</span><span class="now"><b id="big-min">${MANUAL_MIN}</b><small>min</small></span>
             </p>
             <h2 class="time-title">${a.title}</h2><p class="body">${a.body}</p>`
          : `<p class="act-index"><span>${pad(act)}</span>${a.name}</p><h2>${a.title}</h2><p class="body">${a.body}</p>`;
      copy.classList.toggle("time-back", timeBack);
      copy.classList.add("in");
      live.textContent = final ? FINAL_TITLE : `Part ${act + 1} of 6, ${a.name}. ${a.title}`;
    }

    function setHud(act) {
      const h = hud[act];
      hudEl.classList.toggle("show", !!h);
      if (!h) return;
      hudEl.dataset.act = act;
      const clock = h.clock
        ? `<div class="clock ${h.clock.tone}"><span class="digits" id="clock">0:00</span><span class="clock-label">${h.clock.label}</span></div>`
        : "";
      const compare = h.compare
        ? `<div class="compare" aria-hidden="true">
             <p><span>By hand</span><i style="--w:1"></i><b>${MANUAL_MIN} min</b></p>
             <p class="ap"><span>ArchitectPro</span><i id="ap-bar" style="--w:0"></i><b>${AUTO_MIN} min</b></p>
           </div>`
        : "";
      hudEl.innerHTML = `<p class="hud-title">${h.title}</p>${clock}${compare}<ol>${h.lines
        .map(
          (l, i) =>
            `<li data-at="${l.at}" data-i="${i}" class="${l.you ? "you" : ""}"><span class="mark">${tick}</span><span class="text">${l.text}</span>${l.steps || l.detail ? `<span class="detail">${l.detail ?? l.steps[0][1]}</span>` : ""}</li>`,
        )
        .join("")}</ol>`;
    }

    function update(p) {
      activeProgress = p;
      const act = actAt(p),
        final = p >= FINAL_AT;
      if (act !== currentAct) {
        currentAct = act;
        stage.dataset.act = act;
        applyTheme(act);
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themes[act].paper);
        navButtons.forEach((b, i) => (i === act ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current")));
        setHud(act);
        isFinal = null;
      }
      if (final !== isFinal) {
        isFinal = final;
        setCopy(act, final);
        stage.classList.toggle("final", final);
        hudEl.classList.toggle("dim", final);
      }
      const h = hud[act];
      const items = [...hudEl.querySelectorAll("li")];
      const lit = items.filter((li) => p >= Number(li.dataset.at));
      items.forEach((li) => li.classList.toggle("recent", lit.slice(-3).includes(li)));
      items.forEach((li) => {
        li.classList.toggle("on", p >= Number(li.dataset.at));
        const steps = h?.lines[li.dataset.i]?.steps;
        if (steps) {
          const step = steps.filter(([at]) => p >= at).at(-1) ?? steps[0];
          const detail = li.querySelector(".detail");
          if (detail.textContent !== step[1]) detail.textContent = step[1];
          li.dataset.state = step[1].toLowerCase();
        }
      });
      if (h?.clock) {
        const el = document.getElementById("clock");
        const t = lin(p, h.clock.a, h.clock.b);
        el.textContent = clockText(h.clock.to * t);
        el.parentElement.classList.toggle("stopped", t >= 1);
      }
      if (h?.compare) document.getElementById("ap-bar").style.setProperty("--w", (AUTO_MIN / MANUAL_MIN) * lin(p, h.compare.a, h.compare.b));
      if (act === 5 && !final) {
        const big = document.getElementById("big-min");
        const t = win(p, 0.79, 0.86);
        const value = String(Math.round(mix(MANUAL_MIN, AUTO_MIN, t)));
        if (big && big.textContent !== value) big.textContent = value;
        copy.classList.toggle("counted", t >= 1);
      }
      bar.style.transform = `scaleX(${p})`;
      stage.classList.toggle("started", p > 0.01);
      hint.hidden = p > 0.01;
      experience?.setProgress(p);
    }

    // Scroll → progress, smoothed so the camera glides rather than snaps.
    const proxy = { p: 0 };
    const tween = gsap.to(proxy, {
      p: 1,
      ease: "none",
      paused: true,
      onUpdate: () => update(proxy.p),
    });
    const trigger = ScrollTrigger.create({
      trigger: rail,
      start: "top top",
      end: "bottom bottom",
      animation: tween,
      scrub: reducedQuery.matches ? true : 1.1,
    });
    update(initialProgress);
    scrollToProgressInstant(initialProgress);
    tween.progress(initialProgress);

    const onClick = (e) => {
      const jump = e.target.closest("[data-jump]");
      if (jump) scrollToProgress(acts[Number(jump.dataset.jump)].jump);
      if (e.target.closest('[data-action="replay"]')) scrollToProgress(0);
    };
    stage.addEventListener("click", onClick);
    const onHint = () => scrollToProgress(0.06);
    hint.addEventListener("click", onHint);
    const onContextLost = (event) => {
      event.preventDefault();
      generation++;
      cleanup();
      renderSimple("The 3D view was interrupted. You can read the same story here or try 3D again.");
    };

    cleanup = () => {
      stage.removeEventListener("click", onClick);
      hint.removeEventListener("click", onHint);
      stage.querySelector("canvas")?.removeEventListener("webglcontextlost", onContextLost);
      trigger.kill();
      tween.kill();
      experience?.dispose();
      experience = null;
    };

    // Load fonts before drawing canvas textures, then the 3D engine.
    try {
      await Promise.all(["400", "500", "700"].map((w) => document.fonts.load(`${w} 32px "Space Grotesk"`)));
    } catch {}
    if (!isCurrent()) return;
    try {
      const { createExperience } = await import("./scene/index.js");
      if (!isCurrent()) return;
      experience = createExperience(stage.querySelector("#canvas-host"), { mobile });
      stage.querySelector("canvas").addEventListener("webglcontextlost", onContextLost);
      experience.setProgress(proxy.p);
      requestAnimationFrame(() => loading.classList.add("done"));
    } catch (error) {
      if (!isCurrent()) return;
      console.warn("3D unavailable, showing the simple story.", error);
      cleanup();
      renderSimple("3D isn’t available in this browser, so here is the same story as a simple page.");
    }
  }

  const shortScreen = () => innerWidth < 1000 && innerHeight < 700;
  let view = reducedQuery.matches || shortScreen() ? "simple" : "3d";
  function start(progress = 0) {
    generation++;
    cleanup();
    cleanup = () => {};
    if (view === "simple") renderSimple();
    else render3D(progress);
  }
  const onToggle = (event) => {
    if (event.target.closest('[data-action="toggle-view"]')) {
      view = view === "simple" ? "3d" : "simple";
      start();
      app.querySelector('[data-action="toggle-view"]')?.focus({ preventScroll: true });
    }
  };
  root.addEventListener("click", onToggle);
  let lastMobile = isMobile();
  const onResize = () => {
    if (view !== "3d") return;
    if (shortScreen()) {
      view = "simple";
      start();
    } else if (isMobile() !== lastMobile) {
      lastMobile = isMobile();
      start(activeProgress);
    }
  };
  const onMotion = () => {
    if (reducedQuery.matches && view === "3d") {
      view = "simple";
      start();
    }
  };
  window.addEventListener("resize", onResize);
  reducedQuery.addEventListener("change", onMotion);
  const dispose = () => {
    generation++;
    cleanup();
    root.removeEventListener("click", onToggle);
    window.removeEventListener("resize", onResize);
    reducedQuery.removeEventListener("change", onMotion);
    document.removeEventListener("astro:before-swap", dispose);
  };
  document.addEventListener("astro:before-swap", dispose, { once: true });
  start();
  return dispose;
}
