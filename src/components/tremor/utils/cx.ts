// From Tremor (https://github.com/tremorlabs/tremor), Apache License 2.0.
// Adapted for this app: Tailwind 3 class names, no dark mode, local import paths.
// Tremor cx [v0.0.0]

import clsx, { type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cx(...args: ClassValue[]) {
  return twMerge(clsx(...args))
}
