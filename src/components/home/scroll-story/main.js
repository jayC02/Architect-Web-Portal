import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { acts, actAt, beatAt, themes, FINAL_AT } from "./story.js";
import { createOverlay } from "./overlay.js";
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
    copy = root.querySelector("#copy"),
    bar = root.querySelector("#bar"), live = root.querySelector("#live"),
    hint = root.querySelector("#scroll-hint"), loading = root.querySelector("#loading"),
    loadingText = root.querySelector("#loading-text"), host = root.querySelector("#canvas-host"),
    navButtons = [...stage.querySelectorAll("[data-jump]")];
  const overlay = createOverlay(root);
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  // Device classification is fixed for this visit, including when the phone rotates.
  const mobile = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) <= 820;
  const priorRestoration = history.scrollRestoration;
  history.scrollRestoration = "manual";
  let disposed = false, currentAct = -1, currentBeat = null, experience = null,
    stableAt = 0, remeasuring = false, lastWidth = innerWidth,
    saveTimer = 0, resizeTimer = 0, recoveryTimer = 0, recoveryCount = 0, recoveryWindow = 0;
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

  function setCopy(act, beat, final) {
    const a = acts[act];
    copy.classList.remove("in");
    void copy.offsetWidth; // restart the entrance
    copy.innerHTML = final
      ? `<p class="act-index"><span>${pad(act)}</span>${a.name}</p>
         <h2 class="final-title">${beat.headline}</h2>
         <p class="body final-line">${beat.line}</p>
         <div class="final-actions">
           <a class="button primary" href="/demo">Book a demo</a>
           <button type="button" class="button" data-action="replay">Replay</button>
         </div>
         <p class="note">${fictionNote}</p>`
      : `<p class="act-index"><span>${pad(act)}</span>${a.name}</p><h2>${beat.headline}</h2><p class="body">${beat.line}</p>`;
    copy.dataset.kind = beat.kind;
    copy.classList.add("in");
    live.textContent = final ? FINAL_TITLE : `Part ${act + 1} of ${acts.length}, ${a.name}. ${beat.headline}`;
  }

  function update(p) {
    const act = actAt(p),
      beat = beatAt(p),
      final = p >= FINAL_AT;
    if (act !== currentAct) {
      currentAct = act;
      stage.dataset.act = act;
      applyTheme(act);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themes[act].paper);
      navButtons.forEach((b, i) => (i === act ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current")));
    }
    if (beat !== currentBeat) {
      currentBeat = beat;
      setCopy(act, beat, final);
      stage.classList.toggle("final", final);
    }
    overlay.update(p);
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
  const onHint = () => scrollToProgress(0.04);
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
      experience = createExperience(host, { mobile, onContextLost, getAnchorRect: () => overlay.rect() });
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
