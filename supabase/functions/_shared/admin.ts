import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireEnv } from "./env.ts";

/**
 * Клиент с service_role: минует RLS.
 * Использовать только в Edge Functions, никогда не отдавать ключ наружу.
 */
export function adminClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Проверка, что вызов пришёл с service_role-ключом (pg_cron / внутренние вызовы). */
export function isServiceRoleRequest(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return token.length > 0 && token === requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}
