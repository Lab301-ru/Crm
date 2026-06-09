import { supabase, throwIfError } from "./supabase";
import type { Client } from "./types";

export async function searchClients(q: string, limit = 20): Promise<Client[]> {
  let query = supabase.from("clients").select("*").is("deleted_at", null).limit(limit);
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4) {
    query = query.like("phone", `%${digits}%`);
  } else if (q.trim()) {
    query = query.ilike("name", `%${q.trim()}%`);
  }
  const { data, error } = await query.order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as Client[];
}

export async function fetchClient(id: string): Promise<Client> {
  const { data, error } = await supabase.from("clients").select("*").eq("id", id).single();
  throwIfError(error);
  return data as Client;
}

export async function updateClient(id: string, patch: Partial<Client>): Promise<void> {
  const { error } = await supabase.from("clients").update(patch).eq("id", id);
  throwIfError(error);
}
