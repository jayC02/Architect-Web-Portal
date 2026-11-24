import { useEffect, useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Badge } from '@/components/tailadmin/Badge';
import type { DashboardActivity } from '@/lib/dashboard/activity';

// Charts laid out like TailAdmin's dashboard (Monthly Sales, Monthly Target, Statistics),
// drawn with Recharts (MIT) in TailAdmin's colours.

const BRAND = '#465fff';
const BRAND_LIGHT = '#9cb9ff';
const GRID = '#e4e7ec';
const AXIS = '#667085';

export type DashboardFinance = {
  currency: string | null;
  connectedTo: string;
  lastSyncedAt: string | null;
  metrics: { invoicedThisMonth: Record<string, string>; paidThisMonth: Record<string, string>; outstanding: Record<string, string>; overdue: Record<string, string> };
  monthly: { month: string; invoiced: Record<string, string>; paid: Record<string, string> }[];
  overdueInvoices: number;
};

// Finance totals are kept per currency; the dashboard shows the practice's base currency.
export const moneyIn = (finance: DashboardFinance, values: Record<string, string>) => {
  const currency = finance.currency ?? Object.keys(values)[0] ?? 'GBP';
  return { currency, value: Number(values[currency] ?? 0) };
};
export const formatMoney = (value: number, currency: string, compact = false) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(value);

const useMounted = () => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
};

const card = 'rounded-2xl border border-gray-200 bg-white';
const tab = (active: boolean) => `rounded-md px-3 py-2 text-sm font-medium ${active ? 'bg-white text-gray-900 shadow-theme-xs' : 'text-gray-500 hover:text-gray-900'}`;
const axisProps = { tickLine: false, axisLine: false, tick: { fill: AXIS, fontSize: 12 } } as const;

function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; format?: (value: number) => string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-theme-md">
    <p className="mb-1 font-medium text-gray-800">{label}</p>
    {payload.map(item => <p key={item.name} className="flex items-center gap-2 text-gray-500"><span className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.name}<span className="ml-auto pl-3 font-medium text-gray-800">{format ? format(item.value) : item.value}</span></p>)}
  </div>;
}

/* ---------- Metric card (TailAdmin) ---------- */

export function MetricCard({ icon, title, value, change, note, href }: { icon: ReactNode; title: string; value: string; change?: number | null; note?: ReactNode; href?: string }) {
  const body = <>
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-800 [&>svg]:size-6">{icon}</div>
    <div className="mt-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <span className="text-sm text-gray-500">{title}</span>
        <h4 className="mt-2 truncate text-title-md font-bold text-gray-800">{value}</h4>
      </div>
      {change !== undefined && change !== null
        ? <Badge color={change < 0 ? 'error' : 'success'}>{change < 0 ? <ArrowDown /> : <ArrowUp />}{Math.abs(change)}%</Badge>
        : note}
    </div>
  </>;
  const classes = `${card} block p-5 md:p-6`;
  return href ? <a href={href} className={`${classes} transition hover:border-gray-300 hover:shadow-theme-sm`}>{body}</a> : <div className={classes}>{body}</div>;
}

/* ---------- Applications submitted (TailAdmin "Monthly Sales") ---------- */

export function SubmissionsChart({ activity }: { activity: DashboardActivity }) {
  const mounted = useMounted();
  const data = activity.months.map(month => ({ ...month, total: month.planning + month.warrant }));
  const total = data.reduce((sum, month) => sum + month.total, 0);
  return <section className={`${card} overflow-hidden px-5 pt-5 sm:px-6 sm:pt-6`} aria-labelledby="submissions-heading">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 id="submissions-heading" className="text-lg font-semibold text-gray-800">Applications submitted</h3>
        <p className="mt-1 text-sm text-gray-500">{total} sent to the council in the last 12 months</p>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND }} />Planning</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND_LIGHT }} />Warrant</span>
      </div>
    </div>
    <div className="-ml-5 mt-4 h-[200px] sm:h-[220px]" role="img" aria-label={`Applications submitted each month: ${data.map(month => `${month.label} ${month.total}`).join(', ')}`}>
      {mounted && <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="38%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis allowDecimals={false} width={44} {...axisProps} />
          <Tooltip cursor={{ fill: '#f2f4f7' }} content={<ChartTooltip />} />
          <Bar dataKey="planning" name="Planning" stackId="submitted" fill={BRAND} maxBarSize={28} />
          <Bar dataKey="warrant" name="Building warrant" stackId="submitted" fill={BRAND_LIGHT} radius={[5, 5, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>}
    </div>
  </section>;
}

/* ---------- Approval rate (TailAdmin "Monthly Target") ---------- */

export function ApprovalGauge({ activity }: { activity: DashboardActivity }) {
  const mounted = useMounted();
  const { decisions } = activity;
  const rate = decisions.approvalRate;
  return <section className="flex h-full flex-col rounded-2xl border border-gray-200 bg-gray-100" aria-labelledby="approval-heading">
    <div className="flex flex-1 flex-col rounded-2xl bg-white px-5 pb-8 pt-5 shadow-theme-xs sm:px-6 sm:pt-6">
      <h3 id="approval-heading" className="text-lg font-semibold text-gray-800">Approval rate</h3>
      <p className="mt-1 text-sm text-gray-500">Decided applications that were approved or granted</p>
      <div className="flex flex-1 flex-col justify-center">
      <div className="relative mx-auto mt-6 h-[300px] w-full max-w-[400px]" role="img" aria-label={rate === null ? 'No decisions yet' : `${rate}% approved`}>
        {mounted && <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart cx="50%" cy="62%" innerRadius="88%" outerRadius="100%" startAngle={200} endAngle={-20} data={[{ value: rate ?? 0 }]} barSize={18}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" cornerRadius={10} fill={BRAND} background={{ fill: GRID }} isAnimationActive />
          </RadialBarChart>
        </ResponsiveContainer>}
        <div className="pointer-events-none absolute inset-x-0 top-[44%] flex flex-col items-center">
          <span className="text-[44px] font-bold leading-none text-gray-800">{rate === null ? '–' : `${rate}%`}</span>
          {decisions.approvedThisMonth > 0 && <Badge size="sm" color="success" className="mt-3">+{decisions.approvedThisMonth} this month</Badge>}
        </div>
      </div>
      <p className="-mt-8 w-full text-center text-base text-gray-500">
        {rate === null ? 'Approval rates appear once the council decides an application.'
          : decisions.withCouncil ? `${decisions.withCouncil} application${decisions.withCouncil === 1 ? ' is' : 's are'} with the council now.` : 'Nothing is waiting on the council right now.'}
      </p>
      </div>
    </div>
    <dl className="grid grid-cols-3 divide-x divide-gray-200 px-4 py-5 text-center sm:py-6">
      <div><dt className="text-xs text-gray-500 sm:text-sm">Approved</dt><dd className="mt-1 text-base font-semibold text-gray-800 sm:text-lg">{decisions.approved}</dd></div>
      <div><dt className="text-xs text-gray-500 sm:text-sm">Refused</dt><dd className="mt-1 text-base font-semibold text-gray-800 sm:text-lg">{decisions.refused}</dd></div>
      <div><dt className="text-xs text-gray-500 sm:text-sm">With council</dt><dd className="mt-1 text-base font-semibold text-gray-800 sm:text-lg">{decisions.withCouncil}</dd></div>
    </dl>
  </section>;
}

/* ---------- Statistics (TailAdmin "Statistics") ---------- */

type Period = 'months' | 'quarters' | 'years';
const periods: { key: Period; label: string }[] = [{ key: 'months', label: 'Monthly' }, { key: 'quarters', label: 'Quarterly' }, { key: 'years', label: 'Annually' }];
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function StatisticsChart({ activity, finance }: { activity: DashboardActivity; finance: DashboardFinance | null }) {
  const mounted = useMounted();
  const [view, setView] = useState<'revenue' | 'applications'>(finance ? 'revenue' : 'applications');
  const [period, setPeriod] = useState<Period>('months');
  const currency = finance ? moneyIn(finance, finance.metrics.outstanding).currency : 'GBP';
  const revenue = finance?.monthly.map(month => ({
    label: monthNames[Number(month.month.slice(5, 7)) - 1],
    first: moneyIn(finance, month.invoiced).value,
    second: moneyIn(finance, month.paid).value,
  })) ?? [];
  const applications = activity[period].map(point => ({ label: point.label, first: point.planning, second: point.warrant }));
  const showingRevenue = view === 'revenue' && finance;
  const data = showingRevenue ? revenue : applications;
  const names = showingRevenue ? ['Invoiced', 'Paid'] : ['Planning', 'Building warrant'];
  const format = showingRevenue ? (value: number) => formatMoney(value, currency) : undefined;
  return <section className={`${card} px-5 pb-5 pt-5 sm:px-6 sm:pt-6`} aria-labelledby="statistics-heading">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 id="statistics-heading" className="text-lg font-semibold text-gray-800">Statistics</h3>
        <p className="mt-1 text-sm text-gray-500">{showingRevenue ? `Invoiced and paid each month, from Xero (${finance.connectedTo})` : 'Planning and building warrant submissions over time'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {finance && <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Chart data">
          <button type="button" className={tab(view === 'revenue')} aria-pressed={view === 'revenue'} onClick={() => setView('revenue')}>Revenue</button>
          <button type="button" className={tab(view === 'applications')} aria-pressed={view === 'applications'} onClick={() => setView('applications')}>Applications</button>
        </div>}
        {!showingRevenue && <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Time period">
          {periods.map(item => <button key={item.key} type="button" className={tab(period === item.key)} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
        </div>}
      </div>
    </div>
    <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND }} />{names[0]}</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND_LIGHT }} />{names[1]}</span>
    </div>
    <div className="-ml-5 mt-4 h-[290px]" role="img" aria-label={`${names[0]} and ${names[1]} by period`}>
      {mounted && <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="stat-first" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={BRAND} stopOpacity={0.55} /><stop offset="100%" stopColor={BRAND} stopOpacity={0} /></linearGradient>
            <linearGradient id="stat-second" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={BRAND_LIGHT} stopOpacity={0.5} /><stop offset="100%" stopColor={BRAND_LIGHT} stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis allowDecimals={false} width={showingRevenue ? 64 : 44} tickFormatter={showingRevenue ? (value: number) => formatMoney(value, currency, true) : undefined} {...axisProps} />
          <Tooltip content={<ChartTooltip format={format} />} />
          <Area type="monotone" dataKey="first" name={names[0]} stroke={BRAND} strokeWidth={2} fill="url(#stat-first)" />
          <Area type="monotone" dataKey="second" name={names[1]} stroke={BRAND_LIGHT} strokeWidth={2} fill="url(#stat-second)" />
        </AreaChart>
      </ResponsiveContainer>}
    </div>
  </section>;
}
