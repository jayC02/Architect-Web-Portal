import { acts, hud, MANUAL_MIN, AUTO_MIN, PLANNING_MIN, WARRANT_MIN } from './story.js';

export const pad = (n) => String(n + 1).padStart(2, '0');
export const fictionNote = '14 Harbour Lane is a fictional project and the portal shown is a generic illustration. The 30-minute versus 3-minute comparison is illustrative; actual times vary. Decisions rest with the planning authority and building standards verifier.';
export const FINAL_TITLE = 'No more portal. 30 minutes down to 3.';
export const mark = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4 27h24M7 27V14l9-8 9 8v13" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12.5 27v-7h7v7" stroke="currentColor" stroke-width="2.2"/><circle cx="25" cy="7" r="3" fill="var(--accent)"/></svg>';

export function header(simple, interactive = true) {
  return `<header class="top">
    <a href="/" class="brand" aria-label="Architect Pro home"><img src="/brand/architect-pro-logo.png" width="800" height="280" alt="Architect Pro" /></a>
    <nav class="account-links" aria-label="Homepage navigation">
      <button type="button" class="view-switch" data-action="toggle-view" aria-pressed="${simple}" ${interactive ? '' : 'hidden'}>${simple ? 'Explore in 3D' : 'Simple view'}</button>
      <a class="sign-in" href="/login">Sign in</a>
      <a class="button primary account-create" href="/register">Create workspace</a>
    </nav>
  </header>`;
}

export function footer() {
  return `<footer class="site-footer" id="home-footer"><span>&copy; ${new Date().getFullYear()} Architect Pro</span><nav aria-label="Footer navigation"><a href="/login">Sign in</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></footer>`;
}

const elevation = `<svg class="elevation" viewBox="0 0 640 360" role="img" aria-label="Line drawing of the fictional three-storey house at 14 Harbour Lane">
  <g fill="none" stroke="currentColor" stroke-width="2">
    <path d="M40 320h560" stroke-width="3"/>
    <path d="M140 320V140h360v180M260 140V80l120-56 120 56v60" stroke-width="3"/>
    <path d="M160 300v-80h120v80M300 250h60v70h-60zM390 250h50v50h-50zM160 200v-44h50v44zM230 200v-44h60v44zM330 200v-44h150v44zM280 128V92h80v36z"/>
    <path d="M140 140h120M140 132h120" opacity=".6"/>
  </g><path d="M100 340h440" stroke="var(--accent)" stroke-width="4"/>
</svg>`;

// Shared with Astro: the complete story and real account links work before JavaScript.
export function simpleMarkup(message = '', interactive = true) {
  return `<div class="simple">
    ${header(true, interactive)}
    <main id="home-content" tabindex="-1">
      <section class="simple-intro">
        <h1>No more portal.</h1>
        <p>ArchitectPro fills in the eDevelopment portal, uploads your drawings and submits your planning permission and building warrant applications in the background, then tracks every submission and approval and keeps every project detail in one place.</p>
        <div class="final-actions"><a class="button primary" href="/register">Create your workspace</a><a class="button" href="/login">Sign in</a></div>
        <div class="simple-compare" aria-label="Illustrative time for planning permission and a building warrant application">
          <p><span>By hand</span><i style="--w:1"></i><b>about ${MANUAL_MIN} min</b></p>
          <p class="ap"><span>ArchitectPro</span><i style="--w:${AUTO_MIN / MANUAL_MIN}"></i><b>about ${AUTO_MIN} min</b></p>
        </div>
        <p class="simple-breakdown">Planning permission: about ${PLANNING_MIN} minutes by hand, about 1:30 with ArchitectPro. Building warrant: about ${WARRANT_MIN} minutes by hand, about 1:30 with ArchitectPro. Illustrative comparison; actual times vary.</p>
        ${message ? `<p class="simple-message" role="status">${message}</p>` : ''}
        ${elevation}
      </section>
      <ol class="simple-acts">
        ${acts.map((a, i) => `<li>
          <p class="act-index"><span>${pad(i)}</span>${a.name}</p>
          <h2>${a.title}</h2><p>${a.body}</p>
          ${hud[i] ? `<ul class="simple-hud">${hud[i].lines.map(l => `<li>${l.text}${l.steps ? `: ${l.steps.at(-1)[1].toLowerCase()}` : l.detail ? `: ${l.detail.toLowerCase()}` : ''}</li>`).join('')}</ul>` : ''}
        </li>`).join('')}
      </ol>
      <section class="simple-end">
        <h2>${FINAL_TITLE}</h2>
        <div class="final-actions"><a class="button primary" href="/register">Create your workspace</a><a class="button" href="/login">Sign in</a></div>
        <p class="note">${fictionNote}</p>
      </section>
    </main>
    ${footer()}
  </div>`;
}
