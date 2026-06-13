import { formatDate } from "./format";
import type { PhoneTask } from "@/shared/api/types";

/**
 * Человекочитаемый текст уведомления: подставляет переменные шаблона
 * ({client_name}, {order_number}, {status_label}, {due_date}, {tracking_url})
 * из payload и убирает любые незаполненные плейсхолдеры — чтобы в UI не
 * висели технические коды и сырые {...}.
 */
export function renderNotification(task: Pick<PhoneTask, "payload">): string {
  const p = task.payload ?? {};
  const template = p.template?.trim();
  const values: Record<string, string> = {
    order_number: p.order_number ?? "",
    client_name: p.client_name ?? "",
    status_label: p.status_label ?? "",
    due_date: p.due_date ? formatDate(p.due_date) : "",
    tracking_url: p.qr_token ? `${window.location.origin}/status/${p.qr_token}` : "",
  };
  if (!template) {
    // нет шаблона — собираем осмысленную строку из того, что есть
    return [values.client_name, values.order_number && `заказ ${values.order_number}`]
      .filter(Boolean)
      .join(" · ");
  }
  return template
    .replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
