/** Payload уведомления из notification_outbox (кладёт fn_enqueue_notifications). */
export interface NotificationPayload {
  order_number?: string;
  client_name?: string;
  status_label?: string;
  due_date?: string | null;
  qr_token?: string;
  template?: string;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "уточняется";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "уточняется";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Подстановка плейсхолдеров {order_number} {client_name} {status_label} {due_date} {tracking_url}. */
export function renderTemplate(payload: NotificationPayload, appUrl: string): string {
  const template = payload.template ?? "{order_number}: {status_label}";
  const values: Record<string, string> = {
    order_number: payload.order_number ?? "",
    client_name: payload.client_name ?? "",
    status_label: payload.status_label ?? "",
    due_date: formatDate(payload.due_date),
    tracking_url: payload.qr_token ? `${appUrl.replace(/\/$/, "")}/status/${payload.qr_token}` : "",
  };
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? "");
}
