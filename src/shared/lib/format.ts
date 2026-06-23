const moneyFmt = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function formatMoney(value: number | null | undefined): string {
  return moneyFmt.format(value ?? 0);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const m = phone.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

/**
 * Маска ввода телефона РФ: «+7» стоит по умолчанию, дальше до 10 цифр.
 * Корректно обрабатывает ввод с 8, 7, +7 или сразу с 9 — без дублей.
 * Сервер (normalize_phone) всё равно приводит номер к каноничному виду.
 */
export function phoneInput(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("8")) d = "7" + d.slice(1);
  else if (d.startsWith("9") && d.length <= 10) d = "7" + d;
  if (!d.startsWith("7")) d = "7" + d;
  // Поле предзаполнено «+7 », поэтому первая «7» — код страны. Если после неё
  // вставили полный номер с национальным префиксом (8…/7…), убираем дубль,
  // иначе при копировании 11-значного номера терялась последняя цифра.
  let rest = d.slice(1);
  while (rest.length > 10 && (rest[0] === "8" || rest[0] === "7")) rest = rest.slice(1);
  rest = rest.slice(0, 10);
  let out = "+7";
  if (rest.length) out += " " + rest.slice(0, 3);
  if (rest.length > 3) out += " " + rest.slice(3, 6);
  if (rest.length > 6) out += "-" + rest.slice(6, 8);
  if (rest.length > 8) out += "-" + rest.slice(8, 10);
  return out;
}

/** Простая проверка email для форм (БД дополнительно держит CHECK). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
