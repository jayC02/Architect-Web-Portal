// Display-only progress for the preparation pages. It reads the validity the page's own
// scripts already maintain and never changes a field's value, name or required state.
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Gap = { label: string; target: HTMLElement; blocksSave: boolean };

const isMissing = (control: Control) => control.willValidate && !control.validity.valid;

const controlLabel = (control: Control) => {
  const group = control.closest<HTMLElement>('[data-prep-field-label]');
  if (group?.dataset.prepFieldLabel) return group.dataset.prepFieldLabel;
  const text = control.labels?.[0]?.querySelector('.label, .prep-field-question, .prep-question-text')?.textContent ?? '';
  return text.replace(/\s*\*\s*$/, '').trim() || 'An answer';
};

const namedList = (labels: string[]) => {
  const unique = [...new Set(labels)];
  const shown = unique.slice(0, 4).join(', ');
  return unique.length > 4 ? `${shown} and ${unique.length - 4} more` : shown;
};

export function initPreparationProgress() {
  const form = document.querySelector<HTMLFormElement>('form[data-api-form]');
  if (!form) return;
  const sections = Array.from(form.querySelectorAll<HTMLElement>('[data-prep-section]')).filter(section => !section.hidden);
  const summary = form.querySelector<HTMLElement>('[data-prep-summary]');
  const summaryTitle = summary?.querySelector<HTMLElement>('[data-prep-summary-title]');
  const summaryList = summary?.querySelector<HTMLElement>('[data-prep-summary-list]');
  const saveHint = form.querySelector<HTMLAnchorElement>('[data-prep-save-hint]');
  const progress = document.querySelector<HTMLElement>('[data-prep-progress]');
  const linkTargets = new WeakMap<Element, HTMLElement>();
  let attempted = false;
  let submitClick = false;
  let lastSummary = '';

  const gapsIn = (section: HTMLElement): Gap[] => {
    const gaps: Gap[] = [];
    section.querySelectorAll<Control>('input, select, textarea').forEach(control => {
      if (isMissing(control)) gaps.push({ label: controlLabel(control), target: control, blocksSave: true });
    });
    section.querySelectorAll<HTMLInputElement>('input[data-prep-required-tick]:not(:checked)').forEach(control => {
      gaps.push({ label: control.dataset.prepRequiredTick ?? 'An answer', target: control, blocksSave: false });
    });
    section.querySelectorAll<HTMLElement>('[data-prep-static-missing]').forEach(element => {
      gaps.push({ label: element.dataset.prepStaticMissing ?? 'An answer', target: element, blocksSave: false });
    });
    return gaps;
  };

  const setStatus = (element: Element | null | undefined, needsInfo: boolean) => {
    if (element) element.textContent = needsInfo ? 'Needs info' : 'Done';
  };

  const renderSummary = (rows: Array<{ section: HTMLElement; gaps: Gap[] }>, blocked: boolean) => {
    if (!summary || !summaryList) return;
    const signature = JSON.stringify([blocked, rows.map(({ section, gaps }) => [section.id, gaps.map(gap => gap.label)])]);
    rows.forEach(({ section, gaps }) => { linkTargets.set(section, gaps[0].target); });
    if (signature === lastSummary) return;
    lastSummary = signature;
    summary.hidden = rows.length === 0;
    summary.dataset.attempted = blocked ? 'true' : 'false';
    if (blocked) summary.setAttribute('role', 'alert');
    else summary.removeAttribute('role');
    if (summaryTitle) summaryTitle.textContent = blocked ? 'Complete these answers before saving' : 'Still needed';
    summaryList.replaceChildren(...rows.map(({ section, gaps }) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${section.id}`;
      link.dataset.prepSummaryLink = section.id;
      link.className = 'font-semibold text-ink underline';
      link.textContent = `${section.dataset.prepNumber}. ${section.dataset.prepTitle}`;
      item.append(link, `: ${namedList(gaps.map(gap => gap.label))}`);
      return item;
    }));
  };

  const refresh = () => {
    form.querySelectorAll<Control>('input, select, textarea').forEach(control => {
      if (attempted && isMissing(control)) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    });
    const rows = sections.map(section => ({ section, gaps: gapsIn(section) }));
    let incomplete = 0;
    rows.forEach(({ section, gaps }) => {
      const needsInfo = gaps.length > 0 || section.hasAttribute('data-prep-server-missing');
      if (needsInfo) incomplete += 1;
      const state = needsInfo ? 'needs' : 'done';
      section.dataset.state = state;
      setStatus(section.querySelector('[data-prep-section-status]'), needsInfo);
      const nav = document.querySelector<HTMLElement>(`[data-prep-nav="${section.id}"]`);
      if (nav) {
        nav.dataset.state = state;
        setStatus(nav.querySelector('[data-prep-nav-status]'), needsInfo);
      }
    });
    const withGaps = rows.filter(row => row.gaps.length > 0);
    if (attempted && !withGaps.some(row => row.gaps.some(gap => gap.blocksSave))) attempted = false;
    renderSummary(withGaps, attempted);
    if (progress) progress.textContent = `${sections.length - incomplete} of ${sections.length} sections complete`;
    if (saveHint) {
      saveHint.hidden = incomplete === 0;
      saveHint.textContent = `${incomplete} section${incomplete === 1 ? ' needs' : 's need'} information`;
    }
  };

  const scheduleRefresh = () => { window.setTimeout(refresh, 0); };

  const showBlockedSave = () => {
    attempted = true;
    refresh();
    if (!summary || summary.hidden) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    summary.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    summary.focus({ preventScroll: true });
  };

  // A save blocked by the browser reports through the summary. Enter also arrives here as a click.
  form.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const summaryLink = event.target.closest<HTMLElement>('[data-prep-summary-link]');
    if (summaryLink) {
      const section = form.querySelector(`#${summaryLink.dataset.prepSummaryLink}`);
      const target = section && linkTargets.get(section);
      if (target) {
        event.preventDefault();
        target.focus();
        target.scrollIntoView({ block: 'center' });
      }
      return;
    }
    if (event.target.closest('button[type="submit"], button:not([type])')) {
      submitClick = true;
      window.setTimeout(() => {
        submitClick = false;
        if (Array.from(form.elements).some(element => (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && isMissing(element))) showBlockedSave();
      }, 0);
    }
    scheduleRefresh();
  });
  form.addEventListener('invalid', event => { if (submitClick) event.preventDefault(); }, true);

  const clearServerFlag = (event: Event) => {
    if (event.target instanceof Element) event.target.closest('[data-prep-section]')?.removeAttribute('data-prep-server-missing');
    scheduleRefresh();
  };
  form.addEventListener('input', clearServerFlag);
  form.addEventListener('change', clearServerFlag);

  scheduleRefresh();
  window.addEventListener('load', refresh);
}
