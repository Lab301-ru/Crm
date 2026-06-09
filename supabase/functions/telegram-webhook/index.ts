/**
 * telegram-webhook — opt-in клиентов на Telegram-уведомления.
 *
 * Telegram не позволяет боту писать клиенту первым, поэтому клиент
 * подключается сам: в квитанции печатается ссылка
 * https://t.me/<bot>?start=<qr_token> — Telegram присылает боту
 * сообщение "/start <qr_token>", мы привязываем chat_id к клиенту заказа.
 *
 * Без verify_jwt (Telegram не умеет наши JWT); подлинность запроса
 * проверяется заголовком X-Telegram-Bot-Api-Secret-Token, который
 * задаётся при setWebhook (secret_token=TELEGRAM_WEBHOOK_SECRET).
 */
import { adminClient, json } from "../_shared/admin.ts";
import { requireEnv } from "../_shared/env.ts";

interface TelegramUpdate {
  message?: {
    chat?: { id: number };
    text?: string;
  };
}

async function reply(chatId: number, text: string): Promise<void> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Метод не поддерживается" }, 405);
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== requireEnv("TELEGRAM_WEBHOOK_SECRET")) {
    return json({ error: "Доступ запрещён" }, 403);
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return json({ ok: true }); // мусор молча подтверждаем, чтобы Telegram не ретраил
  }

  const chatId = update.message?.chat?.id;
  const text = update.message?.text ?? "";
  if (!chatId) {
    return json({ ok: true });
  }

  const startMatch = text.match(/^\/start(?:\s+([a-f0-9]{32}))?\s*$/);
  if (!startMatch) {
    await reply(chatId, "Это бот уведомлений сервисного центра. Чтобы подписаться на статус вашего заказа, отсканируйте QR-код на квитанции.");
    return json({ ok: true });
  }

  const token = startMatch[1];
  if (!token) {
    await reply(chatId, "Здравствуйте! Чтобы подписаться на уведомления по заказу, перейдите по ссылке из квитанции или отсканируйте QR-код на ней.");
    return json({ ok: true });
  }

  const { data: linked, error } = await adminClient().rpc("link_telegram", {
    p_qr_token: token,
    p_chat_id: chatId,
  });

  if (error) {
    console.error(`link_telegram: ${error.message}`);
    await reply(chatId, "Не получилось оформить подписку, попробуйте позже.");
  } else if (linked) {
    await reply(chatId, "Готово! Теперь уведомления о статусе вашего ремонта будут приходить сюда.");
  } else {
    await reply(chatId, "Заказ по этой ссылке не найден. Проверьте квитанцию или свяжитесь с сервисным центром.");
  }

  return json({ ok: true });
});
