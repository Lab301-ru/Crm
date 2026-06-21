import { supabase, throwIfError } from "./supabase";
import type { OrderPart, PartStatus } from "./types";

const DOCS_BUCKET = "documents";

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  need_order: "Нужно заказать",
  ordered: "Заказано / ожидаем",
  received: "Получено",
};

export const PART_STATUS_COLORS: Record<PartStatus, string> = {
  need_order: "#F97316",
  ordered: "#3B82F6",
  received: "#22C55E",
};

export async function fetchOrderParts(orderId: string): Promise<OrderPart[]> {
  const { data, error } = await supabase
    .from("order_parts")
    .select("*")
    .eq("order_id", orderId)
    .is("deleted_at", null)
    .order("created_at");
  throwIfError(error);
  return (data ?? []) as OrderPart[];
}

export interface NewPart {
  name: string;
  shop_url?: string | null;
  cost?: number;
  qty?: number;
  status?: PartStatus;
  note?: string | null;
}

export async function createPart(orderId: string, part: NewPart): Promise<OrderPart> {
  const { data, error } = await supabase
    .from("order_parts")
    .insert({
      order_id: orderId,
      name: part.name,
      shop_url: part.shop_url || null,
      cost: part.cost ?? 0,
      qty: part.qty ?? 1,
      status: part.status ?? "need_order",
      note: part.note || null,
    })
    .select("*")
    .single();
  throwIfError(error);
  return data as OrderPart;
}

export async function updatePart(id: string, patch: Partial<OrderPart>): Promise<void> {
  const { error } = await supabase.from("order_parts").update(patch).eq("id", id);
  throwIfError(error);
}

export async function softDeletePart(id: string, byUserId: string): Promise<void> {
  const { error } = await supabase
    .from("order_parts")
    .update({ deleted_at: new Date().toISOString(), deleted_by: byUserId })
    .eq("id", id);
  throwIfError(error);
}

/**
 * Квитанция поставщика хранится в приватном бакете documents по пути
 * '<order_id>/parts/<uuid>.<ext>'. RLS заказа применяется по первому
 * сегменту пути. Файл не сжимаем — это может быть PDF или скан.
 */
export async function uploadPartReceipt(part: OrderPart, file: File): Promise<void> {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${part.order_id}/parts/${crypto.randomUUID()}.${ext}`;
  const mime = file.type || "application/octet-stream";

  const { error: uploadError } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { contentType: mime });
  throwIfError(uploadError);

  const { error } = await supabase
    .from("order_parts")
    .update({ receipt_path: path, receipt_name: file.name })
    .eq("id", part.id);
  if (error) {
    await supabase.storage.from(DOCS_BUCKET).remove([path]);
    throw new Error(error.message);
  }
}

export async function signedReceiptUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, expiresIn);
  throwIfError(error);
  return data?.signedUrl ?? null;
}
