import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  fetchDashboardAnalytics, fetchDashboardStats, fetchFinanceStats,
  fetchPhoneTasks, markPhoneCallDone, type FinancePeriods,
} from "@/shared/api/settings";
import { fetchOrderList } from "@/shared/api/orders";
import { formatMoney, formatPhone } from "@/shared/lib/format";
import { renderNotification } from "@/shared/lib/notifications";
import { Card, EmptyState, Spinner } from "@/shared/ui";
import { OrdersTable } from "@/features/orders/OrdersTable";
import { MonthlyRevenueChart, StatusDonut } from "./Charts";

/** Ссылки на список заказов, выданных за период (по issued_at). */
function issuedLinks() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = ymd(now);
  const month = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const year = ymd(new Date(now.getFullYear(), 0, 1));
  return {
    today: `/orders?issued_from=${today}&issued_to=${today}`,
    month: `/orders?issued_from=${month}&issued_to=${today}`,
    year: `/orders?issued_from=${year}&issued_to=${today}`,
    all: "/orders?status=issued",
    acceptedToday: `/orders?from=${today}&to=${today}`,
  };
}

function Widget({ label, value, to, accent }: { label: string; value: string | number; to?: string; accent?: string }) {
  const body = (
    <div className="rounded-xl bg-surface border border-border p-4 transition-colors hover:border-primary/50">
      <p className="text-2xl font-bold" style={accent ? { color: accent } : undefined}>{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function FinanceCard({ title, data, accent, links }: { title: string; data: FinancePeriods; accent: string; links: string[] }) {
  const cells = [
    { label: "Сегодня", value: data.today, to: links[0] },
    { label: "Месяц", value: data.month, to: links[1] },
    { label: "Год", value: data.year, to: links[2] },
    { label: "Всё время", value: data.all, to: links[3] },
  ];
  return (
    <Card title={title}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((c) => (
          <Link key={c.label} to={c.to} className="-m-1 rounded-lg p-1 transition-colors hover:bg-surface-2">
            <p className="text-lg font-bold" style={{ color: accent }}>{formatMoney(c.value)}</p>
            <p className="mt-0.5 text-xs text-muted">{c.label}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const stats = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboardStats, refetchInterval: 60_000 });
  const finance = useQuery({ queryKey: ["finance"], queryFn: fetchFinanceStats, refetchInterval: 60_000 });
  const analytics = useQuery({ queryKey: ["analytics"], queryFn: fetchDashboardAnalytics, refetchInterval: 60_000 });
  const recent = useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () => fetchOrderList({}, 0, 10),
  });
  const phoneTasks = useQuery({
    queryKey: ["phone-tasks"],
    queryFn: fetchPhoneTasks,
    refetchInterval: 60_000,
  });
  const closeTask = useMutation({
    mutationFn: markPhoneCallDone,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["phone-tasks"] }),
  });

  const s = stats.data;
  const links = issuedLinks();
  const financeLinks = [links.today, links.month, links.year, links.all];

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-bold">Дашборд</h1>

      {stats.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Widget label="Принято сегодня" value={s?.accepted_today ?? 0} to={links.acceptedToday} accent="#3B82F6" />
          <Widget label="В ремонте" value={s?.in_repair ?? 0} to="/orders?status=in_repair" accent="#06B6D4" />
          <Widget label="Ожидают запчасти" value={s?.awaiting_parts ?? 0} to="/orders?status=awaiting_parts" accent="#F97316" />
          <Widget label="Готовы к выдаче" value={s?.ready ?? 0} to="/orders?status=ready" accent="#22C55E" />
          <Widget label="Выдано сегодня" value={s?.issued_today ?? 0} to={links.today} accent="#EC4899" />
          <Widget label="Выдано за всё время" value={s?.issued_total ?? 0} to={links.all} accent="#F472B6" />
        </div>
      )}

      {/* Финансы: выручка и чистая прибыль за периоды (клик — список выданных за период) */}
      {finance.data && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <FinanceCard title="Выручка" data={finance.data.revenue} accent="#22C55E" links={financeLinks} />
          <FinanceCard title="Чистая прибыль" data={finance.data.profit} accent="#3B82F6" links={financeLinks} />
        </div>
      )}

      {/* Графики: кликабельное распределение по статусам и помесячная выручка */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {analytics.data ? <StatusDonut slices={analytics.data.by_status} /> : <Card title="Заказы по статусам"><Spinner /></Card>}
        <MonthlyRevenueChart />
      </div>

      {phoneTasks.data && phoneTasks.data.length > 0 && (
        <Card title={`Позвонить клиентам (${phoneTasks.data.length})`}>
          <ul className="divide-y divide-border">
            {phoneTasks.data.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link to={`/orders/${task.order_id}`} className="text-sm font-medium text-primary hover:underline">
                    {task.payload.order_number}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {renderNotification(task)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    href={`tel:${task.recipient ?? ""}`}
                    className="rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25"
                  >
                    {formatPhone(task.recipient)}
                  </a>
                  <button
                    onClick={() => closeTask.mutate(task.id)}
                    className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-muted hover:text-text border border-border"
                  >
                    Готово
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Последние заказы">
        {recent.isLoading ? (
          <Spinner />
        ) : recent.data && recent.data.rows.length > 0 ? (
          <OrdersTable rows={recent.data.rows} />
        ) : (
          <EmptyState text="Заказов пока нет — создайте первый" />
        )}
      </Card>
    </div>
  );
}
