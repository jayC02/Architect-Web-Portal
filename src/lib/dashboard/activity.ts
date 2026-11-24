// Application activity for the dashboard charts: submissions over time and how the
// council's decisions have gone. Pure, so it can be tested without a database.
import { dashboardDayKey } from '@/lib/dashboard/overview';

type When = string | Date | null | undefined;
export type ActivityApplication = { status: string; submissionDate?: When; decisionDate?: When };
export type ActivityInput = { planning: ActivityApplication[]; warrant: ActivityApplication[] };
export type ActivityPoint = { label: string; planning: number; warrant: number };
type YearMonth = { year: number; month: number };

const approvedStatuses = new Set(['APPROVED', 'GRANTED', 'COMPLETED']);
const refusedStatuses = new Set(['REFUSED', 'REJECTED']);
const planningWithCouncil = new Set(['SUBMITTED', 'VALIDATED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED']);
const warrantWithCouncil = new Set(['SUBMITTED', 'IN_REVIEW', 'FURTHER_INFORMATION_REQUESTED']);
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Year and month (1-12) of a date in UK time.
const yearMonth = (value: When): YearMonth | null => {
  if (!value) return null;
  const key = dashboardDayKey(value instanceof Date ? value : String(value));
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
};

const countBy = (items: ActivityApplication[], match: (at: YearMonth) => boolean) =>
  items.filter(item => { const at = yearMonth(item.submissionDate); return Boolean(at && match(at)); }).length;

export const buildDashboardActivity = (input: ActivityInput, now: Date = new Date()) => {
  const today = yearMonth(now) as YearMonth;
  const monthsBack = (back: number): YearMonth => {
    const index = today.year * 12 + (today.month - 1) - back;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  };
  const point = (label: string, match: (at: YearMonth) => boolean): ActivityPoint =>
    ({ label, planning: countBy(input.planning, match), warrant: countBy(input.warrant, match) });

  const months = Array.from({ length: 12 }, (_, offset) => {
    const at = monthsBack(11 - offset);
    return point(monthNames[at.month - 1], item => item.year === at.year && item.month === at.month);
  });
  const quarterOf = (at: YearMonth) => at.year * 4 + Math.floor((at.month - 1) / 3);
  const quarters = Array.from({ length: 8 }, (_, offset) => {
    const quarter = quarterOf(today) - (7 - offset);
    return point(`Q${(quarter % 4) + 1} ${String(Math.floor(quarter / 4)).slice(2)}`, item => quarterOf(item) === quarter);
  });
  const years = Array.from({ length: 5 }, (_, offset) => {
    const year = today.year - (4 - offset);
    return point(String(year), item => item.year === year);
  });

  const all = [...input.planning, ...input.warrant];
  const decided = all.filter(item => approvedStatuses.has(item.status) || refusedStatuses.has(item.status));
  const approved = decided.filter(item => approvedStatuses.has(item.status));
  const lastMonth = monthsBack(1);
  const inThisMonth = (value: When) => { const at = yearMonth(value); return Boolean(at && at.year === today.year && at.month === today.month); };

  return {
    months,
    quarters,
    years,
    submittedThisMonth: months[11].planning + months[11].warrant,
    submittedLastMonth: countBy(all, at => at.year === lastMonth.year && at.month === lastMonth.month),
    decisions: {
      approved: approved.length,
      refused: decided.length - approved.length,
      // Share of decided applications that were approved or granted; null until there is a decision.
      approvalRate: decided.length ? Math.round((approved.length / decided.length) * 1000) / 10 : null,
      approvedThisMonth: approved.filter(item => inThisMonth(item.decisionDate)).length,
      withCouncil: input.planning.filter(item => planningWithCouncil.has(item.status)).length
        + input.warrant.filter(item => warrantWithCouncil.has(item.status)).length,
    },
  };
};

export type DashboardActivity = ReturnType<typeof buildDashboardActivity>;
