/** Чтение переменных окружения с понятной ошибкой при отсутствии. */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Переменная окружения ${name} не задана (supabase secrets set ${name}=...)`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return Deno.env.get(name) || undefined;
}
