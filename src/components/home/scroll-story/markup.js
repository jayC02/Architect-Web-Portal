import { acts } from './story.js';

export const pad = (n) => String(n + 1).padStart(2, '0');
export const fictionNote = '14 Harbour Lane is a fictional project and the portal shown is a generic illustration. The 30-minute versus 3-minute comparison is illustrative; actual times vary. Decisions rest with the planning authority and building standards verifier.';
export const FINAL_TITLE = 'No more portal. 30 minutes down to 3.';
export const mark = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4 27h24M7 27V14l9-8 9 8v13" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12.5 27v-7h7v7" stroke="currentColor" stroke-width="2.2"/><circle cx="25" cy="7" r="3" fill="var(--accent)"/></svg>';

export function header() {
  return `<header class="top">
    <a href="/" class="brand" aria-label="Architect Pro home"><img src="/brand/architect-pro-logo.png" width="800" height="280" alt="Architect Pro" /></a>
    <nav class="account-links" aria-label="Homepage navigation">
      <a class="sign-in" href="/login">Sign in</a>
      <a class="button primary account-create" href="/register">Create workspace</a>
    </nav>
  </header>`;
}

export function footer() {
  return `<footer class="site-footer" id="home-footer"><span>&copy; ${new Date().getFullYear()} Architect Pro</span><nav aria-label="Footer navigation"><a href="/login">Sign in</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></footer>`;
}

// The rail exists in the server response, before scroll restoration or graphics loading.
export function storyMarkup() {
  return `${header()}
    <main id="home-content" tabindex="-1">
      <h1 class="sr-only">Architect Pro — No more portal.</h1>
      <section class="rail" id="rail" aria-label="ArchitectPro, a six-part scroll story">
        <div class="stage" id="stage" data-act="0">
          <div class="canvas-host" id="canvas-host" role="img" aria-label="A house is drawn, built and documented while its planning and warrant applications are prepared"></div>
          <div class="loading" id="loading" role="status"><span class="loading-mark">${mark}</span><span id="loading-text">Drawing the site…</span></div>
          <div class="copy" id="copy"><p class="act-index"><span>01</span>Site</p><h2>${acts[0].title}</h2><p class="body">${acts[0].body}</p></div>
          <aside class="hud" id="hud"></aside>
          <button type="button" class="scroll-hint" id="scroll-hint">Scroll to begin<svg width="14" height="20" viewBox="0 0 14 20" aria-hidden="true"><path d="M7 1v17M1.5 12.5 7 18l5.5-5.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
          <footer class="dock">
            <nav class="acts" aria-label="Jump to part of the story">${acts.map((a,i)=>`<button type="button" data-jump="${i}" aria-label="${pad(i)} ${a.name}" ${i === 0 ? 'aria-current="step"' : ''}><span class="num">${pad(i)}</span><span class="name">${a.name}</span></button>`).join('')}</nav>
            <div class="progress" aria-hidden="true"><span id="bar"></span></div>
            <p class="story-disclaimer">Illustrative example. Actual times vary.</p>
          </footer>
        </div>
      </section>
      <p class="sr-only" id="live" aria-live="polite"></p>
      <noscript><style>.scroll-home .rail { display:none; }</style><article class="story-transcript">
        <h2>No more portal.</h2><p>Architect Pro prepares planning permission and building warrant applications and keeps your project together.</p>
        ${acts.map(a=>`<section><h2>${a.title}</h2><p>${a.body}</p></section>`).join('')}
        <p>${fictionNote}</p><a class="button primary" href="/register">Create your workspace</a>
      </article></noscript>
    </main>${footer()}`;
}
