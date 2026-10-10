import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Native modal semantics put the editor above the floating Agent queue. */
export default function EditDrawer({ title, description, children, onClose }: {
  title: string; description: string; children: ReactNode; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const close = () => {
    if (dirty.current && !window.confirm('Discard your unsaved changes?')) return;
    onClose();
  };
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const saved = (event: Event) => {
      const action = (event as CustomEvent).detail?.action;
      if (typeof action !== 'string') return;
      if (Array.from(dialog.current?.querySelectorAll('form') ?? []).some(form => form.dataset.action === action)) dirty.current = false;
    };
    const requestedClose = (event: Event) => { event.stopPropagation(); close(); };
    dialog.current?.addEventListener('portal:drawer-close', requestedClose);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('portal:mutation-success', saved);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('portal:mutation-success', saved);
      dialog.current?.removeEventListener('portal:drawer-close', requestedClose);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    className="edit-drawer" onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="flex min-h-0 flex-col" onChange={() => { dirty.current = true; }}>
      <header className="flex items-start justify-between gap-4 border-b border-stone-200 p-5">
        <div><h2 id={titleId} className="text-xl font-semibold text-ink">{title}</h2><p id={descriptionId} className="mt-2 text-sm text-stone-600">{description}</p></div>
        <button type="button" className="btn btn-secondary shrink-0 px-3" aria-label="Close panel" onClick={close}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="overflow-y-auto p-5">{children}</div>
    </div>
  </dialog>;
}
