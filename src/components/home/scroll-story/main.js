import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { acts, actAt, hud, themes, FINAL_AT, MANUAL_MIN, AUTO_MIN, lin, win, mix } from "./story.js";
import { pad, fictionNote, FINAL_TITLE } from "./markup.js";

gsap.registerPlugin(ScrollTrigger);
// Only a real width change refreshes the rail. Browser toolbars must not move it.
ScrollTrigger.config({ ignoreMobileResize: true, autoRefreshEvents: "none" });
const SAVED = "architectpro-story-progress";
const clampProgress = value => Math.min(1, Math.max(0, value));

export function mountScrollHome() {
  const root = document.getElementById("scroll-home");
  if (!root) return;
  const rail = root.querySelector("#rail"), stage = root.querySelector("#stage"),
    copy = root.querySelector("#copy"), hudEl = root.querySelector("#hud"),
    bar = root.querySelector("#bar"), live = root.querySelector("#live"),
    hint = root.querySelector("#scroll-hint"), loading = root.querySelector("#loading"),
    loadingText = root.querySelector("#loading-text"), host = root.querySelector("#canvas-host"),
    navButtons = [...stage.querySelectorAll("[data-jump]")];
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  // Device classification is fixed for this visit, including when the phone rotates.
  const mobile = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) <= 820;
  const priorRestoration = history.scrollRestoration;
  history.scrollRestoration = "manual";
  let disposed = false, currentAct = -1, isFinal = null, experience = null,
    stableAt = 0, remeasuring = false, lastWidth = innerWidth,
    saveTimer = 0, resizeTimer = 0, recoveryTimer = 0, recoveryCount = 0, recoveryWindow = 0;
  const tick = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const clockText = min => `${Math.floor(min)}:${String(Math.floor((min % 1) * 60)).padStart(2, "0")}`;
  function readSavedProgress() {
    try {
      const saved = sessionStorage.getItem(SAVED);
      if (saved === null) return null;
      const p = Number(saved);
      return Number.isFinite(p) ? clampProgress(p) : null;
    } catch { return null; }
  }
  // Read before the first animation update can save a new value.
  const resumeAt = readSavedProgress();
  function persistProgress() {
    clearTimeout(saveTimer);
    try { sessionStorage.setItem(SAVED, String(stableAt)); } catch {}
  }
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistProgress, 200);
  }
  function applyTheme(i) {
    const t = themes[i];
    for (const key of ["fg", "muted", "accent", "panel", "line"]) root.style.setProperty(`--${key}`, t[key]);
    root.style.setProperty("--paper-wash", t.paper);
  }
  const scrollToProgressInstant = p => scrollTo({ top: trigger.start + (trigger.end - trigger.start) * p, behavior: "instant" });
  const scrollToProgress = p => scrollTo({ top: trigger.start + (trigger.end - trigger.start) * p, behavior: reducedQuery.matches ? "instant" : "smooth" });

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


  const proxy = { p: 0 };
  const tween = gsap.to(proxy, { p: 1, ease: "none", paused: true, onUpdate: () => update(proxy.p) });
  const trigger = ScrollTrigger.create({
    trigger: rail, start: "top top", end: "bottom bottom", animation: tween,
    scrub: reducedQuery.matches ? true : 1.1,
  });
  const positionProgress = () => clampProgress((scrollY - trigger.start) / Math.max(1, trigger.end - trigger.start));
  stableAt = resumeAt ?? positionProgress();
  if (resumeAt !== null) scrollToProgressInstant(stableAt);
  tween.progress(stableAt);
  update(stableAt);
  ScrollTrigger.update();

  function onScroll() {
    if (innerWidth !== lastWidth) { onResize(); return; }
    if (remeasuring) return;
    stableAt = positionProgress();
    queueSave();
  }
  function refreshInPlace() {
    if (disposed) return;
    const p = stableAt;
    trigger.refresh();
    scrollToProgressInstant(p);
    tween.progress(p);
    update(p);
    ScrollTrigger.update();
    // Ignore scroll events caused by reflow, rather than treating them as user input.
    requestAnimationFrame(() => { remeasuring = false; persistProgress(); });
  }
  function onResize() {
    if (innerWidth === lastWidth) return;
    lastWidth = innerWidth;
    remeasuring = true;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refreshInPlace, 120);
  }
  function onMotion() {
    trigger.scrubDuration(reducedQuery.matches ? 0 : 1.1);
  }
  function onPageShow(event) {
    if (!event.persisted) return;
    if (innerWidth !== lastWidth) onResize();
    else { tween.progress(stableAt); update(stableAt); }
  }
  function onVisibility() {
    if (document.hidden) persistProgress();
    else if (innerWidth !== lastWidth) onResize();
  }
  const onClick = event => {
    const jump = event.target.closest("[data-jump]");
    if (jump) scrollToProgress(acts[Number(jump.dataset.jump)].jump);
    if (event.target.closest('[data-action="replay"]')) {
      stableAt = 0;
      persistProgress();
      scrollToProgress(0);
    }
  };
  const onHint = () => scrollToProgress(0.06);
  stage.addEventListener("click", onClick);
  hint.addEventListener("click", onHint);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("pagehide", persistProgress);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibility);
  reducedQuery.addEventListener("change", onMotion);

  function unavailable(error) {
    if (disposed) return;
    console.warn("3D unavailable.", error);
    loadingText.textContent = "3D graphics aren’t available in this browser. Scroll to read the story.";
    loading.classList.remove("done");
    loading.classList.add("failed");
    host.replaceChildren();
  }
  let createExperience;
  function mountScene() {
    if (disposed) return;
    try {
      experience = createExperience(host, { mobile, onContextLost });
      experience.setProgress(proxy.p);
      requestAnimationFrame(() => {
        if (!disposed) { loading.classList.remove("failed"); loading.classList.add("done"); }
      });
    } catch (error) { unavailable(error); }
  }
  function onContextLost() {
    if (disposed || recoveryTimer) return;
    experience?.dispose();
    experience = null;
    // Repeated GPU failure must not create an endless renderer-allocation loop.
    if (performance.now() - recoveryWindow > 60000) { recoveryWindow = performance.now(); recoveryCount = 0; }
    if (++recoveryCount > 2) { unavailable("Repeated graphics resets"); return; }
    loadingText.textContent = "Restoring 3D graphics…";
    loading.classList.remove("done", "failed");
    recoveryTimer = setTimeout(() => { recoveryTimer = 0; mountScene(); }, 250);
  }
  async function loadScene() {
    try { await Promise.all(["400", "500", "700"].map(w => document.fonts.load(`${w} 32px "Space Grotesk"`))); } catch {}
    if (disposed) return;
    try {
      ({ createExperience } = await import("./scene/index.js"));
      if (!disposed) mountScene();
    } catch (error) { unavailable(error); }
  }
  const dispose = () => {
    if (disposed) return;
    persistProgress();
    disposed = true;
    clearTimeout(resizeTimer); clearTimeout(recoveryTimer);
    trigger.kill(); tween.kill(); experience?.dispose();
    stage.removeEventListener("click", onClick);
    hint.removeEventListener("click", onHint);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pagehide", persistProgress);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibility);
    reducedQuery.removeEventListener("change", onMotion);
    document.removeEventListener("astro:before-swap", dispose);
    history.scrollRestoration = priorRestoration;
  };
  document.addEventListener("astro:before-swap", dispose, { once: true });
  loadScene();
  return dispose;
}
