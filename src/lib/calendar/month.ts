const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthValue = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

export const normaliseCalendarMonth = (value: string | null | undefined, now = new Date()) =>
  value && MONTH_PATTERN.test(value) ? value : monthValue(now);

export const getCalendarGridRange = (month: string) => {
  const normalisedMonth = normaliseCalendarMonth(month);
  const monthStart = new Date(`${normalisedMonth}-01T00:00:00.000Z`);
  const gridStart = new Date(monthStart);
  const mondayOffset = (monthStart.getUTCDay() + 6) % 7;
  gridStart.setUTCDate(gridStart.getUTCDate() - mondayOffset);
  const gridEnd = new Date(gridStart);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + 42);

  return { month: normalisedMonth, monthStart, gridStart, gridEnd };
};
