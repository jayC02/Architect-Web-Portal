// From TailAdmin (https://github.com/TailAdmin/free-react-tailwind-admin-dashboard), MIT License.
// Adapted: the light badge variants only, as plain class maps for Tailwind 3, no dark mode.
import type { ReactNode } from 'react';

export type BadgeColor = 'primary' | 'success' | 'error' | 'warning' | 'info' | 'gray';

const colors: Record<BadgeColor, string> = {
  primary: 'bg-brand-50 text-brand-500',
  success: 'bg-green-50 text-green-600',
  error: 'bg-red-50 text-red-600',
  warning: 'bg-amber-50 text-amber-600',
  info: 'bg-sky-50 text-sky-500',
  gray: 'bg-gray-100 text-gray-700',
};

const sizes = {
  sm: 'h-[22px] rounded-lg px-2 py-0.5 text-xs [&>svg]:size-3',
  md: 'h-6 rounded-lg px-2.5 py-0.5 text-sm [&>svg]:size-3.5',
};

export function Badge({ color = 'primary', size = 'md', className = '', children }: { color?: BadgeColor; size?: keyof typeof sizes; className?: string; children: ReactNode }) {
  return <span className={`inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap font-medium ${sizes[size]} ${colors[color]} ${className}`}>{children}</span>;
}
