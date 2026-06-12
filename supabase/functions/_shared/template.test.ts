// Юнит-тесты рендера шаблонов уведомлений.
// Запуск: deno test supabase/functions/_shared/template.test.ts
// Без внешних зависимостей — работает офлайн и в CI без доступа к jsr.io.
import { renderTemplate } from "./template.ts";

function assertEquals(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`не совпало:\n  получено: ${actual}\n  ожидалось: ${expected}`);
  }
}

Deno.test("подставляет все плейсхолдеры, формирует tracking_url", () => {
  const out = renderTemplate(
    {
      template: "Заказ {order_number} для {client_name}: {status_label}. Готовность: {due_date}. {tracking_url}",
      order_number: "L-10001",
      client_name: "Иван Петров",
      status_label: "Готов",
      due_date: "2026-06-15",
      qr_token: "abc123def456",
    },
    "https://crm.example.com/", // конечный слэш должен схлопнуться
  );
  assertEquals(
    out,
    "Заказ L-10001 для Иван Петров: Готов. Готовность: 15.06.2026. https://crm.example.com/status/abc123def456",
  );
});

Deno.test("без due_date пишет «уточняется», без токена — пустая ссылка", () => {
  const out = renderTemplate(
    { template: "{order_number}: срок {due_date}.{tracking_url}", order_number: "L-1", due_date: null },
    "https://crm.example.com",
  );
  assertEquals(out, "L-1: срок уточняется.");
});

Deno.test("неизвестный плейсхолдер заменяется пустотой, а не падает", () => {
  const out = renderTemplate(
    { template: "до {nonexistent} после", order_number: "L-1" },
    "https://crm.example.com",
  );
  assertEquals(out, "до  после");
});

Deno.test("шаблон по умолчанию, если в правиле он не задан", () => {
  const out = renderTemplate(
    { order_number: "L-7", status_label: "В ремонте" },
    "https://crm.example.com",
  );
  assertEquals(out, "L-7: В ремонте");
});

Deno.test("кривая дата не роняет рендер", () => {
  const out = renderTemplate(
    { template: "{due_date}", due_date: "не-дата" },
    "https://crm.example.com",
  );
  assertEquals(out, "уточняется");
});
