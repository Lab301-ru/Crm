import { supabase, throwIfError } from "./supabase";
import type { StockItem, StockKind, StockSale, StockStatus } from "./types";

const STOCK_BUCKET = "stock";

export const STOCK_KIND_LABELS: Record<StockKind, string> = {
  used_device: "Б/у аппарат",
  board: "Плата",
  part: "Запчасть",
  accessory: "Аксессуар",
  other: "Прочее",
};
export const STOCK_KINDS = Object.keys(STOCK_KIND_LABELS) as StockKind[];

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  in_stock: "В наличии",
  reserved: "Бронь",
  sold: "Продано",
  archived: "Архив",
};
export const STOCK_STATUS_COLORS: Record<StockStatus, string> = {
  in_stock: "#22C55E",
  reserved: "#F59E0B",
  sold: "#6B7280",
  archived: "#9CA3AF",
};

export interface StockFilters {
  status?: StockStatus;
  kind?: StockKind;
  q?: string;
}

export async function fetchStockItems(filters: StockFilters = {}): Promise<StockItem[]> {
  let q = supabase
    .from("stock_items").select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.kind) q = q.eq("kind", filters.kind);
  if (filters.q?.trim()) {
    const v = filters.q.trim();
    q = q.or(`name.ilike.%${v}%,description.ilike.%${v}%,supplier.ilike.%${v}%`);
  }
  const { data, error } = await q;
  throwIfError(error);
  return (data ?? []) as StockItem[];
}

export interface NewStockItem {
  name: string;
  kind: StockKind;
  description?: string | null;
  quantity?: number;
  cost_price?: number;
  price?: number;
  supplier?: string | null;
  note?: string | null;
}

export async function createStockItem(item: NewStockItem, createdBy: string): Promise<StockItem> {
  const { data, error } = await supabase
    .from("stock_items")
    .insert({
      name: item.name,
      kind: item.kind,
      description: item.description || null,
      quantity: item.quantity ?? 1,
      cost_price: item.cost_price ?? 0,
      price: item.price ?? 0,
      supplier: item.supplier || null,
      note: item.note || null,
      created_by: createdBy,
    })
    .select("*").single();
  throwIfError(error);
  return data as StockItem;
}

export async function updateStockItem(id: string, patch: Partial<StockItem>): Promise<void> {
  const { error } = await supabase.from("stock_items").update(patch).eq("id", id);
  throwIfError(error);
}

export async function softDeleteStockItem(id: string, byUserId: string): Promise<void> {
  const { error } = await supabase
    .from("stock_items")
    .update({ deleted_at: new Date().toISOString(), deleted_by: byUserId })
    .eq("id", id);
  throwIfError(error);
}

/** Фото товара в приватный бакет 'stock'. Путь '<itemId>/<uuid>.<ext>'. */
export async function uploadStockPhoto(item: StockItem, file: File): Promise<void> {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${item.id}/${crypto.randomUUID()}.${ext}`;
  const mime = file.type || "application/octet-stream";

  const { error: upErr } = await supabase.storage.from(STOCK_BUCKET).upload(path, file, { contentType: mime });
  throwIfError(upErr);

  const { error } = await supabase.from("stock_items").update({ photo_path: path, photo_name: file.name }).eq("id", item.id);
  if (error) {
    await supabase.storage.from(STOCK_BUCKET).remove([path]);
    throw new Error(error.message);
  }
}

export async function signedStockPhotoUrls(paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(STOCK_BUCKET).createSignedUrls(paths, expiresIn);
  throwIfError(error);
  const map: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
  return map;
}

export interface SellArgs {
  itemId: string;
  qty: number;
  unitPrice: number;
  buyerClientId?: string | null;
  buyerName?: string | null;
  note?: string | null;
}

export async function sellStockItem(args: SellArgs): Promise<string> {
  const { data, error } = await supabase.rpc("sell_stock_item", {
    p_item_id: args.itemId,
    p_qty: args.qty,
    p_unit_price: args.unitPrice,
    p_buyer_client_id: args.buyerClientId || null,
    p_buyer_name: args.buyerName || null,
    p_note: args.note || null,
  });
  throwIfError(error);
  return data as string;
}

export async function fetchStockSales(itemId: string): Promise<StockSale[]> {
  const { data, error } = await supabase
    .from("stock_sales").select("*").eq("item_id", itemId).order("sold_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as StockSale[];
}
