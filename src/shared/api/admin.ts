import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Role } from "./types";

type AdminUsersBody =
  | { action: "create"; email: string; password: string; full_name: string; phone?: string; role: Role }
  | { action: "set_role"; user_id: string; role: Role }
  | { action: "set_password"; user_id: string; password: string }
  | { action: "set_active"; user_id: string; active: boolean };

/** Вызов Edge Function admin-users с разбором русских ошибок из ответа. */
export async function adminUsers(body: AdminUsersBody): Promise<{ ok: true; user_id?: string }> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = (await error.context.json()) as { error?: string };
        throw new Error(payload.error ?? error.message);
      } catch (e) {
        if (e instanceof Error && e.message !== error.message) throw e;
      }
    }
    throw new Error(error.message);
  }
  return data as { ok: true; user_id?: string };
}
