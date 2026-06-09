import { Link } from "react-router-dom";
import type { OrderListRow } from "@/shared/api/types";
import { formatDate, formatMoney, formatPhone } from "@/shared/lib/format";
import { OverdueBadge, StatusBadge } from "@/shared/ui";

/** Таблица на ПК, карточки на телефоне — один компонент. */
export function OrdersTable({ rows }: { rows: OrderListRow[] }) {
  return (
    <>
      {/* Десктоп */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="pb-2 pr-3 font-medium">Заказ</th>
            <th className="pb-2 pr-3 font-medium">Клиент</th>
            <th className="pb-2 pr-3 font-medium">Устройство</th>
            <th className="pb-2 pr-3 font-medium">Статус</th>
            <th className="pb-2 pr-3 font-medium">Готовность</th>
            <th className="pb-2 text-right font-medium">Сумма</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="group">
              <td className="py-2.5 pr-3">
                <Link to={`/orders/${row.id}`} className="font-medium text-primary hover:underline">
                  {row.display_number}
                </Link>
              </td>
              <td className="py-2.5 pr-3">
                <p>{row.client_name}</p>
                <p className="text-xs text-muted">{formatPhone(row.client_phone)}</p>
              </td>
              <td className="max-w-56 truncate py-2.5 pr-3">{row.device_label}</td>
              <td className="py-2.5 pr-3">
                <StatusBadge label={row.status_label} color={row.status_color} />
              </td>
              <td className="py-2.5 pr-3 whitespace-nowrap">
                {formatDate(row.due_date)} {row.is_overdue && <OverdueBadge />}
              </td>
              <td className="py-2.5 text-right font-medium whitespace-nowrap">{formatMoney(row.grand_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Мобильные карточки */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              to={`/orders/${row.id}`}
              className="block rounded-xl bg-surface-2/50 border border-border p-3 active:bg-surface-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{row.display_number}</span>
                <StatusBadge label={row.status_label} color={row.status_color} />
              </div>
              <p className="mt-1 truncate text-sm">{row.device_label}</p>
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span>{row.client_name}</span>
                <span className="flex items-center gap-1.5">
                  {row.is_overdue && <OverdueBadge />}
                  {formatDate(row.due_date)} · {formatMoney(row.grand_total)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
