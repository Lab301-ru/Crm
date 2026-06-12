#!/usr/bin/env bash
# Локальная разработка одной командой:
#   supabase start (Docker-стек) → миграции + seed → демо-данные → .env.local
# Требования: Docker, Supabase CLI (https://supabase.com/docs/guides/local-development), psql.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v supabase >/dev/null 2>&1 || {
  echo "Не найден Supabase CLI. Установка: https://supabase.com/docs/guides/local-development" >&2
  exit 1
}
command -v psql >/dev/null 2>&1 || {
  echo "Не найден psql (клиент PostgreSQL)" >&2
  exit 1
}

supabase start
# db reset применяет все миграции и supabase/seed.sql на чистую базу
supabase db reset

echo "Загружаем демо-данные…"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f scripts/demo-data.sql

# .env.local для Vite — из ключей локального стека
eval "$(supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
cat > .env.local <<EOF
VITE_SUPABASE_URL=${API_URL}
VITE_SUPABASE_ANON_KEY=${ANON_KEY}
EOF
echo ".env.local записан (${API_URL})"

echo ""
echo "Готово. Фронтенд: npm run dev → http://localhost:5173"
echo "Supabase Studio: http://127.0.0.1:54323"
echo "Вход в CRM: admin@demo.local / manager@demo.local / master@demo.local — пароль demo1234"
