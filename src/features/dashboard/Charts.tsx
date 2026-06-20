import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatMoney } from "@/shared/lib/format";
import { fetchRevenueByMonth, type DayPoint, type StatusSlice } from "@/shared/api/settings";
import { Card, EmptyState, Select, Spinner } from "@/shared/ui";

/** Круговая (donut) диаграмма распределения заказов по статусам. Клик по
 *  сегменту или строке легенды открывает заказы, отфильтрованные по статусу. */
export function StatusDonut({ slices }: { slices: StatusSlice[] }) {
  const navigate = useNavigate();
  const data = slices.filter((s) => s.count > 0);
  const total = data.reduce((a, s) => a + s.count, 0);
  const R = 52, STROKE = 18, C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <Card title="Заказы по статусам">
      {total === 0 ? (
        <EmptyState text="Пока нет заказов" />
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0 -rotate-90">
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth={STROKE} />
            {data.map((s) => {
              const len = (s.count / total) * C;
              const el = (
                <circle
                  key={s.code}
                  cx="70" cy="70" r={R} fill="none"
                  stroke={s.color} strokeWidth={STROKE}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                  className="cursor-pointer"
                  onClick={() => navigate(`/orders?status=${s.code}`)}
                >
                  <title>{s.label}: {s.count} — открыть</title>
                </circle>
              );
              offset += len;
              return el;
            })}
            <text x="70" y="68" textAnchor="middle" className="rotate-90" transform="rotate(90 70 70)"
              fontSize="22" fontWeight="700" fill="var(--color-text)">{total}</text>
            <text x="70" y="86" textAnchor="middle" transform="rotate(90 70 70)"
              fontSize="9" fill="var(--color-muted)">заказов</text>
          </svg>
          <ul className="flex-1 space-y-0.5 text-sm">
            {data.map((s) => (
              <li key={s.code}>
                <Link
                  to={`/orders?status=${s.code}`}
                  className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-surface-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-semibold">{s.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** Список последних N месяцев для выпадающего выбора. */
function monthOptions(count = 12): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
}

/** Столбики выручки и прибыли по дням за выбранный месяц. */
export function MonthlyRevenueChart() {
  const options = useMemo(() => monthOptions(12), []);
  const [month, setMonth] = useState(options[0].value);
  const q = useQuery({
    queryKey: ["revenue-month", month],
    queryFn: () => fetchRevenueByMonth(month),
  });

  const days: DayPoint[] = q.data?.days ?? [];
  const max = Math.max(1, ...days.map((d) => Math.max(d.revenue, d.profit)));
  const W = 320, H = 120, n = days.length, gap = 3;
  const slot = n > 0 ? (W - gap * (n - 1)) / n : W;
  const barW = slot / 2;
  const empty = days.length === 0 || days.every((d) => d.revenue === 0 && d.profit === 0);

  const selector = (
    <Select
      value={month}
      onChange={(e) => setMonth(e.target.value)}
      className="w-auto px-2 py-1 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  );

  return (
    <Card title="Выручка и прибыль" actions={selector}>
      {q.isLoading ? (
        <Spinner />
      ) : empty ? (
        <EmptyState text="За выбранный месяц выдач не было" />
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" preserveAspectRatio="none">
            {days.map((d, i) => {
              const x = i * (slot + gap);
              const rh = (d.revenue / max) * H;
              const ph = (Math.max(d.profit, 0) / max) * H;
              const day = d.date.slice(8, 10);
              return (
                <g key={d.date}>
                  <rect x={x} y={H - rh} width={barW} height={rh} rx="1.5" fill="#22C55E">
                    <title>{d.date}: выручка {formatMoney(d.revenue)}</title>
                  </rect>
                  <rect x={x + barW} y={H - ph} width={barW} height={ph} rx="1.5" fill="#3B82F6">
                    <title>{d.date}: прибыль {formatMoney(d.profit)}</title>
                  </rect>
                  {(i % 3 === 0 || i === n - 1) && (
                    <text x={x + slot / 2} y={H + 12} textAnchor="middle" fontSize="8" fill="var(--color-muted)">{day}</text>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-success" /> Выручка: <b>{formatMoney(q.data?.revenue_total ?? 0)}</b>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-primary" /> Прибыль: <b>{formatMoney(q.data?.profit_total ?? 0)}</b>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
