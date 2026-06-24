import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotificationRules, fetchOrgSettings,
  updateNotificationRule, updateOrgSettings,
} from "@/shared/api/settings";
import { useAuth } from "@/app/AuthProvider";
import type { OrgSettings } from "@/shared/api/types";
import { Button, Card, ErrorText, Field, Input, Select, Spinner, Textarea } from "@/shared/ui";
import { FieldTemplatesEditor } from "./FieldTemplatesEditor";
import { UsersCard } from "./UsersCard";

type Tab = "org" | "fields" | "notifications" | "owner" | "users";

const tabs: { id: Tab; label: string }[] = [
  { id: "org", label: "Организация" },
  { id: "fields", label: "Поля устройств" },
  { id: "notifications", label: "Уведомления" },
  { id: "owner", label: "Мои уведомления" },
  { id: "users", label: "Сотрудники" },
];

export function SettingsPage() {
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === "admin";
  // Сотрудникам доступны «Поля устройств» и «Уведомления»;
  // «Организация» и «Сотрудники» — только администратору.
  const visibleTabs = tabs.filter((t) => isAdmin || (t.id !== "org" && t.id !== "users" && t.id !== "owner"));
  const [tab, setTab] = useState<Tab>(isAdmin ? "org" : "fields");

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

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {visibleTabs.map((t) => (
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

      {tab === "org" && isAdmin && (
        <div className="space-y-4">
          <OrgSettingsCard />
          <ExternalServicesCard />
        </div>
      )}
      {tab === "fields" && <FieldTemplatesEditor />}
      {tab === "notifications" && <NotificationRulesCard />}
      {tab === "owner" && isAdmin && <OwnerNotificationsCard />}
      {tab === "users" && isAdmin && <UsersCard />}
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
        <Field label="Подписант в квитанции (имя)">
          <Input value={s.receipt_signer_name ?? ""} onChange={(e) => set("receipt_signer_name", e.target.value)} />
        </Field>
        <Field label="Подпись (факсимиле)">
          <Input value={s.receipt_signer_signature ?? ""} onChange={(e) => set("receipt_signer_signature", e.target.value)} />
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

/* ---------------- Внешние сервисы ---------------- */

function ExternalServicesCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["org-settings"], queryFn: fetchOrgSettings });
  const [form, setForm] = useState<Partial<OrgSettings> | null>(null);

  const save = useMutation({
    mutationFn: () => updateOrgSettings(form ?? {}),
    onSuccess: () => { setForm(null); void queryClient.invalidateQueries({ queryKey: ["org-settings"] }); },
  });

  if (settings.isLoading) return <Spinner />;
  if (!settings.data) return <ErrorText error={settings.error} />;

  const s = { ...settings.data, ...form };
  const set = (key: keyof OrgSettings, value: string | null) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Card
      title="Внешние сервисы"
      actions={<Button variant="secondary" disabled={save.isPending || !form} onClick={() => save.mutate()}>Сохранить</Button>}
    >
      <p className="mb-3 text-xs text-muted">
        Ссылки на внешние сервисы — открываются из одноимённых разделов бокового меню.
      </p>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Адрес админки сайта (Управление сайтом)">
          <Input placeholder="https://example.com/wp-admin" value={s.website_admin_url ?? ""} onChange={(e) => set("website_admin_url", e.target.value || null)} />
        </Field>
        <Field label="Ссылка на видеонаблюдение">
          <Input placeholder="https://cctv.example.com" value={s.cctv_url ?? ""} onChange={(e) => set("cctv_url", e.target.value || null)} />
        </Field>
        <Field label="Ссылка на телефонию (звонки/записи)">
          <Input placeholder="https://lk.megafon.ru / https://my.mango-office.ru / приложение" value={s.telephony_url ?? ""} onChange={(e) => set("telephony_url", e.target.value || null)} />
        </Field>
      </div>

      <p className="mb-2 mt-5 text-sm font-semibold">Карты</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="2ГИС">
          <Input placeholder="https://2gis.ru/..." value={s.map_2gis_url ?? ""} onChange={(e) => set("map_2gis_url", e.target.value || null)} />
        </Field>
        <Field label="Яндекс Карты">
          <Input placeholder="https://yandex.ru/maps/..." value={s.map_yandex_url ?? ""} onChange={(e) => set("map_yandex_url", e.target.value || null)} />
        </Field>
      </div>

      <p className="mb-2 mt-5 text-sm font-semibold">Мессенджеры</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Telegram">
          <Input placeholder="https://web.telegram.org / https://t.me/..." value={s.messenger_telegram_url ?? ""} onChange={(e) => set("messenger_telegram_url", e.target.value || null)} />
        </Field>
        <Field label="WhatsApp">
          <Input placeholder="https://web.whatsapp.com / https://wa.me/..." value={s.messenger_whatsapp_url ?? ""} onChange={(e) => set("messenger_whatsapp_url", e.target.value || null)} />
        </Field>
      </div>

      <p className="mb-2 mt-5 text-sm font-semibold">Счёт онлайн (формы документов)</p>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Счёт на оплату">
          <Input value={s.invoice_schet_url ?? ""} onChange={(e) => set("invoice_schet_url", e.target.value || null)} />
        </Field>
        <Field label="Акт выполненных работ">
          <Input value={s.invoice_akt_url ?? ""} onChange={(e) => set("invoice_akt_url", e.target.value || null)} />
        </Field>
        <Field label="Коммерческое предложение">
          <Input value={s.invoice_kp_url ?? ""} onChange={(e) => set("invoice_kp_url", e.target.value || null)} />
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

// Превью шаблона: подставляем примерные значения, чтобы в списке не висели
// технические {плейсхолдеры} — они остаются только в поле редактирования.
const PREVIEW_VALUES: Record<string, string> = {
  order_number: "L-10042",
  client_name: "Иван Иванов",
  status_label: "Готов",
  due_date: "25.06.2026",
  tracking_url: "(ссылка для клиента)",
};
function previewTemplate(t: string): string {
  return t.replace(/\{(\w+)\}/g, (_m, k: string) => PREVIEW_VALUES[k] ?? "").replace(/\s{2,}/g, " ").trim();
}

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
                    <p className="text-xs text-muted">
                      Подстановки (вставляются автоматически): {"{order_number} {client_name} {status_label} {due_date} {tracking_url}"}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="secondary" disabled={saveTemplate.isPending} onClick={() => saveTemplate.mutate()}>Сохранить</Button>
                      <Button variant="ghost" onClick={() => setEditingTemplate(null)}>Отмена</Button>
                    </div>
                  </div>
                ) : (
                  <button
                    title="Нажмите, чтобы изменить шаблон"
                    className="mt-0.5 text-left text-xs text-muted hover:text-text"
                    onClick={() => setEditingTemplate({ id: rule.id, template: rule.template })}
                  >
                    {previewTemplate(rule.template)}
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

/* ---------------- Мои уведомления (владельцу) ---------------- */

function OwnerNotificationsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["org-settings"], queryFn: fetchOrgSettings });
  const [form, setForm] = useState<Partial<OrgSettings> | null>(null);
  const save = useMutation({
    mutationFn: () => updateOrgSettings(form ?? {}),
    onSuccess: () => {
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ["org-settings"] });
    },
  });

  if (settings.isLoading) return <Spinner />;
  if (!settings.data) return <ErrorText error={settings.error} />;

  const s = { ...settings.data, ...form };
  const set = (patch: Partial<OrgSettings>) => setForm((prev) => ({ ...prev, ...patch }));
  const events = s.owner_notify_events ?? [];
  const toggleEvent = (code: string) =>
    set({ owner_notify_events: events.includes(code) ? events.filter((e) => e !== code) : [...events, code] });

  return (
    <Card
      title="Уведомления мне"
      actions={<Button variant="secondary" disabled={save.isPending || !form} onClick={() => save.mutate()}>Сохранить</Button>}
    >
      <p className="mb-3 text-xs text-muted">
        Получайте уведомления о событиях по заказам (например, «принят» или «выдан») в Telegram или на почту.
      </p>
      <div className="space-y-3">
        <Field label="Куда присылать">
          <Select
            value={s.owner_notify_channel}
            onChange={(e) => set({ owner_notify_channel: e.target.value as OrgSettings["owner_notify_channel"] })}
          >
            <option value="off">Не присылать</option>
            <option value="telegram">Telegram</option>
            <option value="email">Email</option>
          </Select>
        </Field>

        {s.owner_notify_channel === "telegram" && (
          <Field label="Telegram chat ID">
            <Input
              type="number"
              value={s.owner_telegram_chat_id ?? ""}
              onChange={(e) => set({ owner_telegram_chat_id: e.target.value ? Number(e.target.value) : null })}
              placeholder="например, 123456789"
            />
            <p className="mt-1 text-xs text-muted">
              Узнать свой ID — напишите боту @userinfobot. Затем откройте нашего бота и нажмите «Старт», иначе он не сможет вам писать.
            </p>
          </Field>
        )}

        {s.owner_notify_channel === "email" && (
          <Field label="Email для уведомлений">
            <Input
              type="email"
              value={s.owner_email ?? ""}
              onChange={(e) => set({ owner_email: e.target.value || null })}
              placeholder="you@example.com"
            />
          </Field>
        )}

        {s.owner_notify_channel !== "off" && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">О каких событиях уведомлять</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(eventLabels).map(([code, label]) => (
                <label
                  key={code}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${
                    events.includes(code) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted hover:text-text"
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={events.includes(code)} onChange={() => toggleEvent(code)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}

        <ErrorText error={save.error} />
      </div>
    </Card>
  );
}

