/**
 * admin-users — управление сотрудниками (только администратор).
 *
 * Создание auth-пользователя, смена роли, смена пароля и
 * активация/деактивация требуют service_role (Admin API),
 * поэтому живут в Edge Function, а не в браузере.
 *
 * Роль хранится в двух местах и здесь синхронизируется атомарно
 * по смыслу: app_metadata.role (читают RLS-политики из JWT,
 * клиент изменить не может) + profiles.role (для UI).
 *
 * POST { action: "create" | "set_role" | "set_password" | "set_active", ... }
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { json } from "../_shared/admin.ts";
import { requireEnv } from "../_shared/env.ts";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROLES = ["admin", "manager", "master"] as const;
type Role = (typeof ROLES)[number];

interface CreatePayload {
  action: "create";
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  role: Role;
}
interface SetRolePayload {
  action: "set_role";
  user_id: string;
  role: Role;
}
interface SetPasswordPayload {
  action: "set_password";
  user_id: string;
  password: string;
}
interface SetActivePayload {
  action: "set_active";
  user_id: string;
  active: boolean;
}
type Payload = CreatePayload | SetRolePayload | SetPasswordPayload | SetActivePayload;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405, cors);

  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- кто вызывает: валидный JWT + роль admin + активен ---
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller, error: jwtError } = await admin.auth.getUser(jwt);
  if (jwtError || !caller.user) return json({ error: "Не авторизован" }, 401, cors);

  const { data: callerProfile } = await admin
    .from("profiles").select("role,is_active").eq("id", caller.user.id).single();
  if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.is_active) {
    return json({ error: "Доступно только администратору" }, 403, cors);
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Некорректный JSON" }, 400, cors);
  }

  try {
    switch (body.action) {
      case "create": {
        const { email, password, full_name, phone, role } = body;
        if (!email || !password || !full_name?.trim() || !ROLES.includes(role)) {
          return json({ error: "Заполните email, пароль, имя и роль" }, 400, cors);
        }
        if (password.length < 8) {
          return json({ error: "Пароль не короче 8 символов" }, 400, cors);
        }
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: { role },
        });
        if (error) return json({ error: error.message }, 400, cors);

        const { error: profileError } = await admin.from("profiles").insert({
          id: data.user.id,
          full_name: full_name.trim(),
          phone: phone?.trim() || null,
          role,
        });
        if (profileError) {
          // не оставляем auth-пользователя без профиля
          await admin.auth.admin.deleteUser(data.user.id);
          return json({ error: `Профиль не создан: ${profileError.message}` }, 400, cors);
        }
        return json({ ok: true, user_id: data.user.id }, 200, cors);
      }

      case "set_role": {
        if (!ROLES.includes(body.role)) return json({ error: "Неизвестная роль" }, 400, cors);
        if (body.user_id === caller.user.id && body.role !== "admin") {
          return json({ error: "Нельзя снять роль администратора с самого себя" }, 400, cors);
        }
        const { error } = await admin.auth.admin.updateUserById(body.user_id, {
          app_metadata: { role: body.role },
        });
        if (error) return json({ error: error.message }, 400, cors);
        const { error: profileError } = await admin
          .from("profiles").update({ role: body.role }).eq("id", body.user_id);
        if (profileError) return json({ error: profileError.message }, 400, cors);
        return json({ ok: true }, 200, cors);
      }

      case "set_password": {
        if (!body.password || body.password.length < 8) {
          return json({ error: "Пароль не короче 8 символов" }, 400, cors);
        }
        const { error } = await admin.auth.admin.updateUserById(body.user_id, {
          password: body.password,
        });
        if (error) return json({ error: error.message }, 400, cors);
        return json({ ok: true }, 200, cors);
      }

      case "set_active": {
        if (body.user_id === caller.user.id && !body.active) {
          return json({ error: "Нельзя деактивировать самого себя" }, 400, cors);
        }
        // ban закрывает вход; is_active отрезает данные через RLS
        const { error } = await admin.auth.admin.updateUserById(body.user_id, {
          ban_duration: body.active ? "none" : "876000h",
        });
        if (error) return json({ error: error.message }, 400, cors);
        const { error: profileError } = await admin
          .from("profiles").update({ is_active: body.active }).eq("id", body.user_id);
        if (profileError) return json({ error: profileError.message }, 400, cors);
        return json({ ok: true }, 200, cors);
      }

      default:
        return json({ error: "Неизвестное действие" }, 400, cors);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "Внутренняя ошибка" }, 500, cors);
  }
});
