/**
 * public-status — публичная страница статуса заказа по QR-токену.
 *
 * GET /functions/v1/public-status?token=<32 hex>
 * Без аутентификации (verify_jwt = false в config.toml).
 *
 * Защита:
 *  - токен 128 бит, перебор бессмыслен; формат проверяется до запроса в БД;
 *  - rate limiting по IP (token bucket в памяти изолята — best effort,
 *    при перезапуске изолята счётчик обнуляется, это осознанный компромисс);
 *  - public_order_status() в БД возвращает строго белый список полей.
 */
import { adminClient, json } from "../_shared/admin.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Принимаем оба формата токена: 32-символьный hex (старые заказы) и
// UUID (новый default qr_token = gen_random_uuid()::text).
const TOKEN_RE = /^[a-f0-9]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  if (hits.size > 10_000) hits.clear(); // защита памяти изолята
  return entry.count > MAX_PER_WINDOW;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return json({ error: "Метод не поддерживается" }, 405, corsHeaders);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return json({ error: "Слишком много запросов, попробуйте через минуту" }, 429, corsHeaders);
  }

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) {
    return json({ error: "Некорректный токен" }, 400, corsHeaders);
  }

  const { data, error } = await adminClient().rpc("public_order_status", { p_token: token });
  if (error) {
    console.error(`public_order_status: ${error.message}`);
    return json({ error: "Внутренняя ошибка" }, 500, corsHeaders);
  }
  if (!data) {
    return json({ error: "Заказ не найден" }, 404, corsHeaders);
  }

  return json(data, 200, { ...corsHeaders, "Cache-Control": "no-store" });
});
