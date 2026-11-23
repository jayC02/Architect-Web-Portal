import { Ellipsis } from 'lucide-react';

type Props = { label: string; items: { label: string; href: string }[] };

// A native <details> menu so it works before hydration; ApplicationSummaryCard
// closes it on outside clicks and Escape.
export default function ApplicationMoreMenu({ label, items }: Props) {
  if (!items.length) return null;
  return (
    <details className="app-more-menu" data-more-menu>
      <summary className="btn btn-secondary min-h-10 w-10 cursor-pointer px-0" aria-label={label} title={label}>
        <Ellipsis size={20} strokeWidth={2.25} className="shrink-0" aria-hidden="true" />
      </summary>
      <div role="menu">
        {items.map((item) => <a key={item.href} role="menuitem" href={item.href}>{item.label}</a>)}
      </div>
    </details>
  );
}
