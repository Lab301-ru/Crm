import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchPayments } from "@/shared/api/orders";
import type { PaymentListRow } from "@/shared/api/types";
import { formatDateTime, formatMoney } from "@/shared/lib/format";
import { Card, EmptyState, ErrorText, Spinner } from "@/shared/ui";

const KIND_LABEL: Record<PaymentListRow["kind"], string> = {
  prepayment: "Предоплата",
  final: "Оплата при выдаче",
};
const KIND_COLOR: Record<PaymentListRow["kind"], string> = {
  prepayment: "#F59E0B",
  final: "#14B8A6",
};
const METHOD_LABEL: Record<string, string> = {
  cash: "наличные",
  card: "карта",
  transfer: "перевод",
};

/** Журнал платежей: из чего сложилась выручка периода.
 *  Открывается по клику на суммы «Выручка»/«Прибыль» на дашборде. */
export function PaymentsPage() {
  const [params] = useSearchParams();
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;

  const payments = useQuery({
    queryKey: ["payments", from, to],
    queryFn: () => fetchPayments(from, to),
  });

  const rows = payments.data ?? [];
  const total = rows.reduce((s, p) => s + Number(p.amount), 0);

  const periodLabel = from && to
    ? (from === to ? `за ${from}` : `${from} — ${to}`)
    : from ? `с ${from}` : "за всё время";

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">Платежи {periodLabel}</h1>
        {payments.data && (
          <p className="text-lg font-bold" style={{ color: "#22C55E" }}>{formatMoney(total)}</p>
        )}
      </div>
      <p className="text-xs text-muted">
        Каждая строка — поступление денег: предоплата в день внесения или оплата при выдаче заказа.
        Сумма совпадает с выручкой на дашборде за этот период.
      </p>

      {payments.isLoading ? <Spinner className="pt-10" /> : payments.error ? <ErrorText error={payments.error} /> :
       rows.length === 0 ? (
        <Card><EmptyState text="Платежей за период нет" /></Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                to={`/orders/${p.order_id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{p.display_number}</p>
                  <p className="truncate text-xs text-muted">{p.client_name}</p>
                  <p className="text-xs text-muted">{formatDateTime(p.paid_at)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-bold" style={{ color: KIND_COLOR[p.kind] }}>{formatMoney(Number(p.amount))}</p>
                  <span
                    className="inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{
                      color: KIND_COLOR[p.kind],
                      borderColor: `${KIND_COLOR[p.kind]}66`,
                      backgroundColor: `${KIND_COLOR[p.kind]}14`,
                    }}
                  >
                    {KIND_LABEL[p.kind]}{p.method ? ` · ${METHOD_LABEL[p.method]}` : ""}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
