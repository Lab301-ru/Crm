import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotificationRules, fetchOrgSettings,
  updateNotificationRule, updateOrgSettings,
} from "@/shared/api/settings";
import { useAuth } from "@/app/AuthProvider";
import type { OrgSettings } from "@/shared/api/types";
import { Button, Card, ErrorText, Field, Input, Spinner, Textarea } from "@/shared/ui";
import { FieldTemplatesEditor } from "./FieldTemplatesEditor";
import { UsersCard } from "./UsersCard";

type Tab = "org" | "fields" | "notifications" | "users";

const tabs: { id: Tab; label: string }[] = [
  { id: "org", label: "Организация" },
  { id: "fields", label: "Поля устройств" },
  { id: "notifications", label: "Уведомления" },
  { id: "users", label: "Сотрудники" },
];

export function SettingsPage() {
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [tab, setTab] = useState<Tab>("org");

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Настройки</h1>
        <button onClick={() => void signOut()} className="text-sm text-muted hover:text-danger md:hidden">
          Выйти
        </button>
      </div>

      <Link to="/catalog" className="block rounded-xl bg-surface border border-border p-4 text-sm md:hidden">
        Справочник техники →
      </Link>

      {!isAdmin ? (
        <Card>
          <p className="text-sm text-muted">Настройки доступны администратору.</p>
        </Card>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  tab === t.id ? "border-primary bg-primary/15 text-primary" : "border-border bg-surface text-muted hover:text-text"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "org" && <OrgSettingsCard />}
          {tab === "fields" && <FieldTemplatesEditor />}
          {tab === "notifications" && <NotificationRulesCard />}
          {tab === "users" && <UsersCard />}
        </>
      )}
    </div>
  );
}

/* ---------------- Организация ---------------- */

function OrgSettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["org-settings"], queryFn: fetchOrgSettings });
  const [form, setForm] = useState<Partial<OrgSettings> | null>(null);

  const save = useMutation({
    mutationFn: () => updateOrgSettings(form ?? {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["org-settings"] }),
  });

  if (settings.isLoading) return <Spinner />;
  if (!settings.data) return <ErrorText error={settings.error} />;

  const s = { ...settings.data, ...form };
  const set = (key: keyof OrgSettings, value: string | number | null) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Card
      title="Реквизиты и параметры"
      actions={<Button variant="secondary" disabled={save.isPending || !form} onClick={() => save.mutate()}>Сохранить</Button>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Название"><Input value={s.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="ИНН"><Input value={s.inn ?? ""} onChange={(e) => set("inn", e.target.value || null)} /></Field>
        <Field label="Адрес"><Input value={s.address ?? ""} onChange={(e) => set("address", e.target.value || null)} /></Field>
        <Field label="Телефон"><Input value={s.phone ?? ""} onChange={(e) => set("phone", e.target.value || null)} /></Field>
        <Field label="Режим работы"><Input value={s.working_hours ?? ""} onChange={(e) => set("working_hours", e.target.value || null)} /></Field>
        <Field label="Контакты на публичной странице"><Input value={s.public_contacts ?? ""} onChange={(e) => set("public_contacts", e.target.value || null)} /></Field>
        <Field label="Префикс номера заказа"><Input value={s.order_prefix} onChange={(e) => set("order_prefix", e.target.value)} /></Field>
        <Field label="Гарантия по умолчанию, дней">
          <Input type="number" min={0} value={s.default_warranty_days} onChange={(e) => set("default_warranty_days", Number(e.target.value))} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Оговорка на квитанции">
          <Textarea value={s.receipt_disclaimer ?? ""} onChange={(e) => set("receipt_disclaimer", e.target.value || null)} />
        </Field>
      </div>
      <ErrorText error={save.error} />
    </Card>
  );
}

/* ---------------- Уведомления ---------------- */

const eventLabels: Record<string, string> = {
  order_accepted: "Заказ принят",
  cost_approval: "Согласование стоимости",
  awaiting_parts: "Ожидание запчастей",
  order_ready: "Заказ готов",
  order_issued: "Заказ выдан",
};

const channelLabels: Record<string, string> = {
  telegram: "Telegram",
  email: "Email",
  phone_call: "Звонок",
};

function NotificationRulesCard() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ["notification-rules"], queryFn: fetchNotificationRules });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateNotificationRule(id, { enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
  const [editingTemplate, setEditingTemplate] = useState<{ id: string; template: string } | null>(null);
  const saveTemplate = useMutation({
    mutationFn: () => updateNotificationRule(editingTemplate!.id, { template: editingTemplate!.template }),
    onSuccess: () => {
      setEditingTemplate(null);
      void queryClient.invalidateQueries({ queryKey: ["notification-rules"] });
    },
  });

  if (rules.isLoading) return <Spinner />;

  return (
    <Card title="События и каналы">
      <p className="mb-3 text-xs text-muted">
        Плейсхолдеры шаблонов: {"{order_number} {client_name} {status_label} {due_date} {tracking_url}"}
      </p>
      <ul className="divide-y divide-border">
        {rules.data?.map((rule) => (
          <li key={rule.id} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm">
                  {eventLabels[rule.event_type] ?? rule.event_type}
                  <span className="text-muted"> · {channelLabels[rule.channel] ?? rule.channel}</span>
                </p>
                {editingTemplate?.id === rule.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={editingTemplate.template}
                      onChange={(e) => setEditingTemplate({ id: rule.id, template: e.target.value })}
                    />
                    <div className="flex gap-2">
                      <Button variant="secondary" disabled={saveTemplate.isPending} onClick={() => saveTemplate.mutate()}>Сохранить</Button>
                      <Button variant="ghost" onClick={() => setEditingTemplate(null)}>Отмена</Button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="mt-0.5 text-left text-xs text-muted hover:text-text"
                    onClick={() => setEditingTemplate({ id: rule.id, template: rule.template })}
                  >
                    {rule.template}
                  </button>
                )}
              </div>
              <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => toggle.mutate({ id: rule.id, enabled: e.target.checked })}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-surface-2 border border-border peer-checked:bg-primary/40 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-muted after:transition-all peer-checked:after:translate-x-5 peer-checked:after:bg-primary" />
              </label>
            </div>
          </li>
        ))}
      </ul>
      <ErrorText error={toggle.error ?? saveTemplate.error} />
    </Card>
  );
}

