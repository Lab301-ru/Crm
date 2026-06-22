import { supabase, throwIfError } from "./supabase";
import type { Brand, Category, Device, FieldTemplate, Model } from "./types";

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories").select("id,name,sort").is("deleted_at", null).order("sort");
  throwIfError(error);
  return (data ?? []) as Category[];
}

export async function addCategory(name: string): Promise<{ id: string }> {
  const { data, error } = await supabase.from("categories").insert({ name }).select("id").single();
  throwIfError(error);
  return data as { id: string };
}

/**
 * Мягкое удаление категории (deleted_at). Существующие заказы/устройства
 * хранят category_id и не ломаются — категория просто исчезает из списков
 * и из выбора при новом заказе. Доступно только админу (RLS).
 */
export async function deleteCategory(id: string, byUserId: string): Promise<void> {
  const { error } = await supabase
    .from("categories")
    .update({ deleted_at: new Date().toISOString(), deleted_by: byUserId })
    .eq("id", id);
  throwIfError(error);
}


export async function searchBrands(q: string): Promise<Brand[]> {
  let query = supabase.from("brands").select("id,name").is("deleted_at", null).limit(10);
  if (q.trim()) query = query.ilike("name_normalized", `%${q.trim().toLowerCase()}%`);
  const { data, error } = await query.order("name");
  throwIfError(error);
  return (data ?? []) as Brand[];
}

export async function searchModels(categoryId: string, brandId: string | null, q: string): Promise<Model[]> {
  let query = supabase
    .from("models").select("id,category_id,brand_id,name,brands(name)")
    .eq("category_id", categoryId).is("deleted_at", null).limit(10);
  if (brandId) query = query.eq("brand_id", brandId);
  if (q.trim()) query = query.ilike("name_normalized", `%${q.trim().toLowerCase()}%`);
  const { data, error } = await query.order("name");
  throwIfError(error);
  return (data ?? []) as unknown as Model[];
}

export async function quickAddModel(categoryId: string, brand: string, model: string): Promise<{ brand_id: string; model_id: string }> {
  const { data, error } = await supabase.rpc("quick_add_model", {
    p_category_id: categoryId, p_brand: brand, p_model: model,
  });
  throwIfError(error);
  return data as { brand_id: string; model_id: string };
}

/** Добавить бренд на лету без модели (бренда нет в справочнике). */
export async function quickAddBrand(brand: string): Promise<{ brand_id: string }> {
  const { data, error } = await supabase.rpc("quick_add_brand", { p_brand: brand });
  throwIfError(error);
  return data as { brand_id: string };
}

export interface ImportRow {
  category: string;
  brand: string;
  model: string;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: { row: number; error: string }[];
}

export async function importCatalogBatch(rows: ImportRow[]): Promise<ImportResult> {
  const { data, error } = await supabase.rpc("import_catalog_batch", { p_rows: rows });
  throwIfError(error);
  return data as ImportResult;
}

export async function fetchFieldTemplates(categoryId: string): Promise<FieldTemplate[]> {
  const { data, error } = await supabase
    .from("field_templates").select("*")
    .eq("category_id", categoryId).is("deleted_at", null)
    .order("sort");
  throwIfError(error);
  return (data ?? []) as FieldTemplate[];
}

export async function fetchDevice(id: string): Promise<Device> {
  const { data, error } = await supabase.from("devices").select("*").eq("id", id).single();
  throwIfError(error);
  return data as Device;
}

export async function updateDevice(id: string, patch: Partial<Device>): Promise<void> {
  const { error } = await supabase.from("devices").update(patch).eq("id", id);
  throwIfError(error);
}
