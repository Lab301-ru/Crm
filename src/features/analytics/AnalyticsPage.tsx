import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createExpense, EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, fetchAnalyticsSeries, fetchAnalyticsStats,
  fetchExpenses, fetchFinanceOverview, softDeleteExpense,
} from "@/shared/api/finance";
import type { AnalyticsSeriesPoint, ExpenseCategory } from "@/shared/api/types";
import { formatDate, formatMoney } from "@/shared/lib/format";
import { useAuth } from "@/app/AuthProvider";
import { Button, Card, EmptyState, ErrorText, Field, Input, Select, Spinner } from "@/shared/ui";

type AnalyticsPeriod = "all" | "month" | "year";
type FinancePeriod = "today" | "month" | "year" | "all";

const ANALYTICS_PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "month", label: "Месяц" },
  { value: "year", label: "Год" },
  { value: "all", label: "Всё время" },
];
const FINANCE_PERIODS: { value: FinancePeriod; label: string }[] = [
  { value: "today", label: "Сегодня" },
  { value: "month", label: "Месяц" },
  { value: "year", label: "Год" },
  { value: "all", label: "Всё время" },
];

export function AnalyticsPage() {
  const { profile } = useAuth();
  const isManager = profile?.role === "admin" || profile?.role === "manager";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Аналитика</h1>
      <AnalyticsSection />
      <TrendChart />
      {isManager && <FinanceSection />}
      {isManager && <ExpensesSection />}
    </div>
  );
}

/* ----------------------------- Аналитика ремонтов ----------------------------- */

function AnalyticsSection() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("month");
  const stats = useQuery({
    queryKey: ["analytics-stats", period],
    queryFn: () => fetchAnalyticsStats(period),
  });

  return (
    <div className="space-y-4">
      <PeriodTabs<AnalyticsPeriod> value={period} onChange={setPeriod} options={ANALYTICS_PERIODS} />

      {stats.isLoading ? <Spinner /> : stats.error ? <ErrorText error={stats.error} /> : stats.data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Выдано заказов" value={String(stats.data.orders_count)} />
            <Metric label="Выручка" value={formatMoney(stats.data.revenue)} />
            <Metric label="Средний чек" value={formatMoney(stats.data.avg_check)} />
            <Metric label="Максимальный чек" value={formatMoney(stats.data.max_check)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Топ-10 популярных ремонтов">
              {stats.data.top_repairs.length === 0 ? <EmptyState text="Нет данных за период" /> : (
                <ol className="space-y-1.5 text-sm">
                  {stats.data.top_repairs.map((r, i) => (
                    <li key={r.name} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate"><span className="text-muted">{i + 1}.</span> {r.name}</span>
                      <span className="whitespace-nowrap text-muted">{r.count} × · {formatMoney(r.sum)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title="Топ-10 клиентов по оплатам">
              {stats.data.top_clients.length === 0 ? <EmptyState text="Нет данных за период" /> : (
                <ol className="space-y-1.5 text-sm">
                  {stats.data.top_clients.map((c, i) => (
                    <li key={c.client_id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="text-muted">{i + 1}.</span> {c.name}
                        <span className="text-xs text-muted"> · {c.orders_count} зак.</span>
                      </span>
                      <span className="whitespace-nowrap font-medium">{formatMoney(c.total)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------- Линейный график по месяцам ----------------------------- */

type MetricKey = "revenue" | "profit" | "orders_count" | "avg_check";

const METRICS: { key: MetricKey; label: string; color: string; money: boolean }[] = [
  { key: "revenue", label: "Выручка", color: "#22C55E", money: true },
  { key: "profit", label: "Чистая прибыль", color: "#3B82F6", money: true },
  { key: "orders_count", label: "Заказы", color: "#F59E0B", money: false },
  { key: "avg_check", label: "Средний чек", color: "#8B5CF6", money: true },
];

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function monthLabel(ym: string): string {
  const [, m] = ym.split("-");
  return MONTHS_SHORT[Number(m) - 1] ?? ym;
}

/** Линейный график выбранного показателя по месяцам (последние 12). */
function TrendChart() {
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const series = useQuery({ queryKey: ["analytics-series"], queryFn: () => fetchAnalyticsSeries(12) });

  const cfg = METRICS.find((m) => m.key === metric)!;
  const fmt = (v: number) => (cfg.money ? formatMoney(v) : String(v));

  const selector = (
    <Select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)} className="w-auto px-2 py-1 text-xs">
      {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
    </Select>
  );

  return (
    <Card title="Динамика по месяцам" actions={selector}>
      {series.isLoading ? <Spinner /> :
       series.error ? <ErrorText error={series.error} /> :
       <LineChart points={series.data ?? []} metric={metric} color={cfg.color} fmt={fmt} />}
    </Card>
  );
}

function LineChart({ points, metric, color, fmt }: {
  points: AnalyticsSeriesPoint[];
  metric: MetricKey;
  color: string;
  fmt: (v: number) => string;
}) {
  if (points.length === 0 || points.every((p) => p[metric] === 0)) {
    return <EmptyState text="Нет данных за период" />;
  }

  const W = 640, H = 200, padX = 8, padTop = 12, padBottom = 22;
  const vals = points.map((p) => p[metric]);
  const max = Math.max(1, ...vals);
  const n = points.length;
  const innerW = W - padX * 2;
  const x = (i: number) => (n === 1 ? W / 2 : padX + (i * innerW) / (n - 1));
  const y = (v: number) => padTop + (1 - v / max) * (H - padTop - padBottom);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[metric]).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H - padBottom} L ${x(0).toFixed(1)} ${H - padBottom} Z`;
  const last = points[n - 1][metric];
  const total = vals.reduce((a, v) => a + v, 0);

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* сетка-базис */}
        <line x1={padX} y1={H - padBottom} x2={W - padX} y2={H - padBottom} stroke="var(--color-border)" strokeWidth="1" />
        <path d={area} fill={`url(#grad-${metric})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.month}>
            <circle cx={x(i)} cy={y(p[metric])} r="3" fill={color}>
              <title>{p.month}: {fmt(p[metric])}</title>
            </circle>
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--color-muted)">
              {monthLabel(p.month)}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-3 flex flex-wrap gap-5 text-sm">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} /> Последний месяц: <b>{fmt(last)}</b>
        </span>
        <span className="text-muted">За 12 мес.: <b className="text-text">{fmt(total)}</b></span>
      </div>
    </>
  );
}

/* ----------------------------- Финансы: прибыльность ----------------------------- */

function FinanceSection() {
  const [period, setPeriod] = useState<FinancePeriod>("month");
  const overview = useQuery({
    queryKey: ["finance-overview", period],
    queryFn: () => fetchFinanceOverview(period),
  });

  return (
    <Card title="Финансы">
      <PeriodTabs<FinancePeriod> value={period} onChange={setPeriod} options={FINANCE_PERIODS} />
      {overview.isLoading ? <Spinner /> : overview.error ? <ErrorText error={overview.error} /> : overview.data && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Выручка (заказы)" value={formatMoney(overview.data.revenue)} accent="#22C55E" />
            <Metric label="Продажи склада" value={formatMoney(overview.data.stock_revenue)} accent="#14B8A6" />
            <Metric label="Расходы" value={formatMoney(overview.data.expenses)} accent="#EF4444" />
            <Metric label="Чистая прибыль" value={formatMoney(overview.data.net_profit)} accent="#3B82F6" />
            <Metric label="Прибыль склада" value={formatMoney(overview.data.stock_profit)} accent="#14B8A6" />
            <Metric label="Общая выручка" value={formatMoney(overview.data.total_revenue)} accent="#22C55E" />
            <Metric label="Маржинальность" value={`${overview.data.margin}%`} accent="#8B5CF6" />
          </div>

          {Object.keys(overview.data.expenses_by_category).length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted">Расходы по категориям</p>
              <div className="space-y-1.5 text-sm">
                {(Object.entries(overview.data.expenses_by_category) as [ExpenseCategory, number][])
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, total]) => (
                    <div key={cat} className="flex items-center justify-between gap-2">
                      <span>{EXPENSE_CATEGORY_LABELS[cat]}</span>
                      <span className="text-muted">{formatMoney(total)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ----------------------------- Расходы: учёт ----------------------------- */

function ExpensesSection() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<ExpenseCategory>("parts");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");

  const expenses = useQuery({ queryKey: ["expenses"], queryFn: () => fetchExpenses() });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-overview"] });
  };

  const add = useMutation({
    mutationFn: () => createExpense(
      { category, amount: Number(amount), spent_on: spentOn, description: description.trim() || null },
      profile!.id,
    ),
    onSuccess: () => { setAmount(""); setDescription(""); invalidate(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => softDeleteExpense(id, profile!.id),
    onSuccess: invalidate,
  });

  return (
    <Card title="Расходы">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Категория">
          <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Сумма">
          <Input type="number" inputMode="numeric" min={0.01} step="any" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Дата">
          <Input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
        </Field>
        <Field label="Комментарий">
          <Input placeholder="необязательно" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <div className="mt-2">
        <Button variant="secondary" disabled={!amount || Number(amount) <= 0 || add.isPending} onClick={() => add.mutate()}>
          Добавить расход
        </Button>
      </div>
      <ErrorText error={add.error ?? remove.error} />

      <div className="mt-4">
        {expenses.isLoading ? <Spinner /> : (expenses.data ?? []).length === 0 ? (
          <EmptyState text="Расходов пока нет" />
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {(expenses.data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-2 text-xs text-muted whitespace-nowrap">{formatDate(e.spent_on)}</td>
                  <td className="py-2 pr-2 whitespace-nowrap">{EXPENSE_CATEGORY_LABELS[e.category]}</td>
                  <td className="py-2 pr-2 text-muted">{e.description}</td>
                  <td className="py-2 pr-2 text-right font-medium whitespace-nowrap">{formatMoney(e.amount)}</td>
                  <td className="w-8 py-2 text-right">
                    <button onClick={() => remove.mutate(e.id)} className="text-muted hover:text-danger" aria-label="Удалить">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------- Вспомогательные ----------------------------- */

function PeriodTabs<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === o.value ? "bg-primary text-white" : "text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-bold" style={accent ? { color: accent } : undefined}>{value}</p>
    </div>
  );
}
