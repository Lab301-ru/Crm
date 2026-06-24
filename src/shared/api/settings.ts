import { supabase, throwIfError } from "./supabase";
import type { DashboardStats, FieldTemplate, NotificationRule, OrgSettings, PhoneTask, Profile } from "./types";

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc("dashboard_stats");
  throwIfError(error);
  return data as DashboardStats;
}

export interface FinancePeriods {
  today: number;
  month: number;
  year: number;
  all: number;
}
export interface FinanceStats {
  revenue: FinancePeriods;
  profit: FinancePeriods;
}

export async function fetchFinanceStats(): Promise<FinanceStats> {
  const { data, error } = await supabase.rpc("finance_stats");
  throwIfError(error);
  return data as FinanceStats;
}

export interface StatusSlice {
  code: string;
  label: string;
  color: string;
  count: number;
}
export interface DayPoint {
  date: string;
  revenue: number;
  profit: number;
}
export interface DashboardAnalytics {
  by_status: StatusSlice[];
  revenue_by_day: DayPoint[];
}

export async function fetchDashboardAnalytics(): Promise<DashboardAnalytics> {
  const { data, error } = await supabase.rpc("dashboard_analytics");
  throwIfError(error);
  return data as DashboardAnalytics;
}

export interface MonthRevenue {
  month: string;            // 'YYYY-MM'
  revenue_total: number;
  profit_total: number;
  days: DayPoint[];
}

/** Выручка/прибыль по дням за выбранный месяц. month — 'YYYY-MM'. */
export async function fetchRevenueByMonth(month: string): Promise<MonthRevenue> {
  const { data, error } = await supabase.rpc("dashboard_revenue_by_month", { p_month: `${month}-01` });
  throwIfError(error);
  return data as MonthRevenue;
}

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from("profiles").select("*").order("full_name");
  throwIfError(error);
  return (data ?? []) as Profile[];
}

export async function updateProfile(id: string, patch: Partial<Profile>): Promise<void> {
  const { error } = await supabase.from("profiles").update(patch).eq("id", id);
  throwIfError(error);
}

/** Дефолт на случай, если строки org_settings ещё нет (свежий проект). */
const DEFAULT_ORG_SETTINGS: OrgSettings = {
  id: 1,
  name: "Сервисный центр",
  inn: null,
  address: null,
  phone: null,
  working_hours: null,
  public_contacts: null,
  order_prefix: "L",
  default_warranty_days: 30,
  receipt_disclaimer: null,
  photo_retention_days: null,
  timezone: "Europe/Moscow",
  owner_telegram_chat_id: null,
  owner_email: null,
  owner_notify_channel: "off",
  owner_notify_events: ["order_accepted", "order_issued"],
  receipt_signer_name: "Юрий",
  receipt_signer_signature: "Б.Ю.Г.",
  website_admin_url: null,
  cctv_url: null,
  telephony_url: null,
  map_2gis_url: null,
  map_yandex_url: null,
  messenger_telegram_url: null,
  messenger_whatsapp_url: null,
  invoice_schet_url: "https://service-online.su/forms/buh/schet/",
  invoice_akt_url: "https://service-online.su/forms/buh/akt_vyipolnennyih_rabot/",
  invoice_kp_url: "https://service-online.su/forms/buh/kp/",
  payment_link_url: "https://www.tinkoff.ru/rm/r_rBdRxFbmge.kJtBBjrvLh/vaVYo35413",
  sbp_phone: "+79996708772",
  sbp_name: "Юрий Б.",
  sbp_bank: "Т-Банк",
};

export async function fetchOrgSettings(): Promise<OrgSettings> {
  // maybeSingle: при отсутствии строки вернёт null (а не 406), и интерфейс
  // не падает — показываем дефолт, пока админ не заполнит реквизиты.
  const { data, error } = await supabase.from("org_settings").select("*").eq("id", 1).maybeSingle();
  throwIfError(error);
  return (data as OrgSettings | null) ?? DEFAULT_ORG_SETTINGS;
}

export async function updateOrgSettings(patch: Partial<OrgSettings>): Promise<void> {
  const { error } = await supabase.from("org_settings").update(patch).eq("id", 1);
  throwIfError(error);
}

export async function fetchNotificationRules(): Promise<NotificationRule[]> {
  const { data, error } = await supabase
    .from("notification_rules").select("*").order("event_type").order("channel");
  throwIfError(error);
  return (data ?? []) as NotificationRule[];
}

export async function updateNotificationRule(id: string, patch: Partial<NotificationRule>): Promise<void> {
  const { error } = await supabase.from("notification_rules").update(patch).eq("id", id);
  throwIfError(error);
}

export async function createFieldTemplate(tpl: Omit<FieldTemplate, "id" | "is_active">): Promise<void> {
  const { error } = await supabase.from("field_templates").insert(tpl);
  throwIfError(error);
}

export async function updateFieldTemplate(id: string, patch: Partial<FieldTemplate>): Promise<void> {
  const { error } = await supabase.from("field_templates").update(patch).eq("id", id);
  throwIfError(error);
}

export async function fetchPhoneTasks(): Promise<PhoneTask[]> {
  const { data, error } = await supabase
    .from("notification_outbox").select("id,order_id,event_type,recipient,payload,status,created_at")
    .eq("channel", "phone_call").eq("status", "pending")
    .order("created_at");
  throwIfError(error);
  return (data ?? []) as PhoneTask[];
}

export async function markPhoneCallDone(id: string): Promise<void> {
  const { error } = await supabase.rpc("mark_phone_call_done", { p_outbox_id: id });
  throwIfError(error);
}
