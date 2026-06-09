/**
 * notify-dispatch — доставка уведомлений из notification_outbox.
 *
 * Вызывается pg_cron (раз в минуту) и сразу после смены статуса (best effort).
 * Идемпотентность обеспечена на уровне БД: claim_notifications() забирает
 * записи FOR UPDATE SKIP LOCKED, complete_notification() ведёт backoff
 * 1м → 5м → 30м → failed. Каналы: telegram, email. phone_call — ручной,
 * сюда не попадает (фильтр в claim_notifications).
 *
 * Доступ: только service_role (pg_cron шлёт service-ключ в Authorization).
 */
// @ts-types="npm:@types/nodemailer@6"
import nodemailer from "npm:nodemailer@6";
import { adminClient, isServiceRoleRequest, json } from "../_shared/admin.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { renderTemplate, type NotificationPayload } from "../_shared/template.ts";

interface OutboxRow {
  id: string;
  channel: "telegram" | "email";
  recipient: string | null;
  payload: NotificationPayload;
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: Number(chatId), text }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram API ${resp.status}: ${body.slice(0, 300)}`);
  }
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const port = Number(optionalEnv("SMTP_PORT") ?? "465");
  const transporter = nodemailer.createTransport({
    host: requireEnv("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: {
      user: requireEnv("SMTP_USERNAME"),
      pass: requireEnv("SMTP_PASSWORD"),
    },
  });
  try {
    await transporter.sendMail({
      from: optionalEnv("SMTP_FROM") ?? requireEnv("SMTP_USERNAME"),
      to,
      subject,
      text,
    });
  } finally {
    transporter.close();
  }
}

Deno.serve(async (req: Request) => {
  if (!isServiceRoleRequest(req)) {
    return json({ error: "Доступ запрещён" }, 403);
  }

  const supabase = adminClient();
  const appUrl = optionalEnv("PUBLIC_APP_URL") ?? "";

  const { data, error } = await supabase.rpc("claim_notifications", { p_limit: 20 });
  if (error) {
    return json({ error: `claim_notifications: ${error.message}` }, 500);
  }

  const rows = (data ?? []) as OutboxRow[];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    let ok = false;
    let errorText: string | null = null;
    try {
      if (!row.recipient) {
        throw new Error("Пустой получатель");
      }
      const text = renderTemplate(row.payload, appUrl);
      if (row.channel === "telegram") {
        await sendTelegram(row.recipient, text);
      } else {
        const subject = `Заказ ${row.payload.order_number ?? ""} — ${row.payload.status_label ?? "обновление статуса"}`;
        await sendEmail(row.recipient, subject, text);
      }
      ok = true;
      sent++;
    } catch (e) {
      errorText = e instanceof Error ? e.message : String(e);
      failed++;
    }

    const { error: completeError } = await supabase.rpc("complete_notification", {
      p_id: row.id,
      p_ok: ok,
      p_error: errorText,
    });
    if (completeError) {
      console.error(`complete_notification ${row.id}: ${completeError.message}`);
    }
  }

  return json({ claimed: rows.length, sent, failed });
});
