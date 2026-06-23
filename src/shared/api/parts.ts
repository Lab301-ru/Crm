import { supabase, throwIfError } from "./supabase";
import type { OrderPart, PartFileKind, PartOverviewRow, PartStatus } from "./types";

const DOCS_BUCKET = "documents";

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  need_order: "Нужно заказать",
  ordered:    "Заказана",
  in_transit: "В пути",
  received:   "Получена",
  installed:  "Установлена",
};

export const PART_STATUS_COLORS: Record<PartStatus, string> = {
  need_order: "#F97316",
  ordered:    "#3B82F6",
  in_transit: "#8B5CF6",
  received:   "#22C55E",
  installed:  "#14B8A6",
};

export const PART_STATUSES_ORDER: PartStatus[] = [
  "need_order", "ordered", "in_transit", "received", "installed",
];

export const PART_FILE_LABELS: Record<PartFileKind, string> = {
  screenshot: "Скриншот заказа",
  receipt:    "Чек",
  invoice:    "Накладная",
};

/** Свойства таблицы order_parts, в которых хранится путь и имя файла данного типа. */
function fileColumns(kind: PartFileKind): { path: keyof OrderPart; name: keyof OrderPart } {
  return { path: `${kind}_path` as keyof OrderPart, name: `${kind}_name` as keyof OrderPart };
}

/* ---------------------------- Запросы по заказу ---------------------------- */

export async function fetchOrderParts(orderId: string): Promise<OrderPart[]> {
  const { data, error } = await supabase
    .from("order_parts").select("*")
    .eq("order_id", orderId).is("deleted_at", null).order("created_at");
  throwIfError(error);
  return (data ?? []) as OrderPart[];
}

/* ---------------------------- Дашборд закупщика ---------------------------- */

export interface PartsOverviewFilters {
  statuses?: PartStatus[];
  q?: string;
  masterId?: string;
}

/**
 * Дашборд «Запчасти»: все позиции по всем заказам с контекстом
 * (заказ/клиент/устройство/мастер). Источник — view parts_overview.
 */
export async function fetchPartsOverview(filters: PartsOverviewFilters = {}): Promise<PartOverviewRow[]> {
  let q = supabase.from("parts_overview").select("*").order("created_at", { ascending: false });
  if (filters.statuses?.length) q = q.in("status", filters.statuses);
  if (filters.masterId) q = q.eq("master_id", filters.masterId);
  if (filters.q?.trim()) {
    const v = filters.q.trim();
    q = q.or(`name.ilike.%${v}%,supplier.ilike.%${v}%,order_number.ilike.%${v}%,client_name.ilike.%${v}%`);
  }
  const { data, error } = await q;
  throwIfError(error);
  return (data ?? []) as PartOverviewRow[];
}

/* ---------------------------- Запись ---------------------------- */

export interface NewPart {
  name: string;
  qty?: number;
  master_comment?: string | null;
  shop_url?: string | null;
  cost?: number;
  supplier?: string | null;
  status?: PartStatus;
  note?: string | null;
}

export async function createPart(orderId: string, part: NewPart): Promise<OrderPart> {
  const { data, error } = await supabase
    .from("order_parts")
    .insert({
      order_id: orderId,
      name: part.name,
      qty: part.qty ?? 1,
      master_comment: part.master_comment || null,
      shop_url: part.shop_url || null,
      cost: part.cost ?? 0,
      supplier: part.supplier || null,
      status: part.status ?? "need_order",
      note: part.note || null,
    })
    .select("*").single();
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

/* ---------------------------- Файлы (3 типа) ---------------------------- */

/**
 * Загрузка файла запчасти в приватный бакет documents.
 * Путь: '<order_id>/parts/<uuid>.<ext>' — RLS заказа применяется по первому
 * сегменту пути (как для фото и PDF). Файл не сжимаем — может быть PDF/скан.
 */
export async function uploadPartFile(part: OrderPart, kind: PartFileKind, file: File): Promise<void> {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${part.order_id}/parts/${crypto.randomUUID()}.${ext}`;
  const mime = file.type || "application/octet-stream";

  const { error: uploadError } = await supabase.storage
    .from(DOCS_BUCKET).upload(path, file, { contentType: mime });
  throwIfError(uploadError);

  const cols = fileColumns(kind);
  const patch = { [cols.path]: path, [cols.name]: file.name } as Partial<OrderPart>;

  const { error } = await supabase.from("order_parts").update(patch).eq("id", part.id);
  if (error) {
    // запись не обновилась — не оставляем файл-сироту в бакете
    await supabase.storage.from(DOCS_BUCKET).remove([path]);
    throw new Error(error.message);
  }
}

export async function removePartFile(part: OrderPart, kind: PartFileKind): Promise<void> {
  const cols = fileColumns(kind);
  const path = part[cols.path] as string | null;
  if (path) await supabase.storage.from(DOCS_BUCKET).remove([path]);
  const patch = { [cols.path]: null, [cols.name]: null } as Partial<OrderPart>;
  const { error } = await supabase.from("order_parts").update(patch).eq("id", part.id);
  throwIfError(error);
}

export async function signedReceiptUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, expiresIn);
  throwIfError(error);
  return data?.signedUrl ?? null;
}

/** Пакетно подписанные ссылки на файлы запчастей: { path → url }. */
export async function signedPartFileUrls(paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrls(paths, expiresIn);
  throwIfError(error);
  const map: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
  return map;
}
