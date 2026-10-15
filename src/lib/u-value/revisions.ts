/** Nullable series IDs belong to reports saved before revision tracking. */
export function latestCalculations<T extends { id: string; seriesId: string | null; revision: number }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = row.seriesId || row.id;
    if (!latest.has(key) || latest.get(key)!.revision < row.revision) latest.set(key, row);
  }
  return [...latest.values()];
}
