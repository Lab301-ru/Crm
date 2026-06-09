import { supabase, throwIfError } from "./supabase";
import type { DashboardStats, FieldTemplate, NotificationRule, OrgSettings, PhoneTask, Profile } from "./types";

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc("dashboard_stats");
  throwIfError(error);
  return data as DashboardStats;
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

export async function fetchOrgSettings(): Promise<OrgSettings> {
  const { data, error } = await supabase.from("org_settings").select("*").eq("id", 1).single();
  throwIfError(error);
  return data as OrgSettings;
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
