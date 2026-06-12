-- Шим Supabase-окружения для локальных тестов (роли + auth.*)
do $$ begin
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
exception when duplicate_object then null;
end $$;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
