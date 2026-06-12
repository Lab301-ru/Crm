import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchDashboardStats, fetchPhoneTasks, markPhoneCallDone } from "@/shared/api/settings";
import { fetchOrderList } from "@/shared/api/orders";
import { formatMoney, formatPhone } from "@/shared/lib/format";
import { Card, EmptyState, Spinner } from "@/shared/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/app/AuthProvider";
import { OrdersTable } from "@/features/orders/OrdersTable";

function Widget({ label, value, to, accent }: { label: string; value: string | number; to?: string; accent?: string }) {
  const body = (
    <div className="rounded-xl bg-surface border border-border p-4 transition-colors hover:border-primary/50">
      <p className="text-2xl font-bold" style={accent ? { color: accent } : undefined}>{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const stats = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboardStats, refetchInterval: 60_000 });
  const recent = useQuery({
    queryKey: ["orders", "recent"],
    queryFn: () => fetchOrderList({}, 0, 10),
  });
  const phoneTasks = useQuery({
    queryKey: ["phone-tasks"],
    queryFn: fetchPhoneTasks,
    refetchInterval: 60_000,
    enabled: profile?.role !== "master",
  });
  const closeTask = useMutation({
    mutationFn: markPhoneCallDone,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["phone-tasks"] }),
  });

  const s = stats.data;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-bold">Дашборд</h1>

      {stats.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Widget label="Принято сегодня" value={s?.accepted_today ?? 0} to="/orders" />
          <Widget label="В ремонте" value={s?.in_repair ?? 0} to="/orders?status=in_repair" accent="#06B6D4" />
          <Widget label="Ожидают запчасти" value={s?.awaiting_parts ?? 0} to="/orders?status=awaiting_parts" accent="#F97316" />
          <Widget label="Готовы к выдаче" value={s?.ready ?? 0} to="/orders?status=ready" accent="#22C55E" />
          <Widget label="Выдано сегодня" value={s?.issued_today ?? 0} />
          {s?.revenue_today != null && (
            <Widget label="Выручка за сегодня" value={formatMoney(s.revenue_today)} accent="#22C55E" />
          )}
        </div>
      )}

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
                    {task.payload.client_name} · {task.payload.template}
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
