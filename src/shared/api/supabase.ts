import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

/** Единый разбор ошибок PostgREST: показываем русские сообщения из БД как есть. */
export function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}
