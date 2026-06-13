import { supabase, throwIfError } from "./supabase";
import type { Attachment, AttachmentKind } from "./types";
import { compressImage } from "@/shared/lib/compressImage";

const PHOTOS_BUCKET = "device-photos";

export async function fetchAttachments(orderId: string): Promise<Attachment[]> {
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("order_id", orderId)
    .is("deleted_at", null)
    .order("created_at");
  throwIfError(error);
  return (data ?? []) as Attachment[];
}

export async function uploadOrderPhoto(
  orderId: string,
  file: File,
  uploadedBy: string,
  kind: AttachmentKind = "device_photo",
): Promise<void> {
  const blob = await compressImage(file);
  const mime = blob.type || file.type || "application/octet-stream";
  const ext = mime === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `${orderId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(path, blob, { contentType: mime });
  throwIfError(uploadError);

  const { error } = await supabase.from("attachments").insert({
    order_id: orderId,
    kind,
    storage_path: path,
    file_name: file.name,
    mime_type: mime,
    size_bytes: blob.size,
    uploaded_by: uploadedBy,
  });
  if (error) {
    // запись не создалась — не оставляем файл-сироту в бакете
    await supabase.storage.from(PHOTOS_BUCKET).remove([path]);
    throw new Error(error.message);
  }
}

/**
 * Бакет приватный: для показа фото берём signed URL пачкой на час.
 * Возвращаем обычный объект (а не Map): результат кэшируется React Query
 * и persist'ится в localStorage (PWA), а Map при JSON-сериализации
 * превращается в {} и теряет .get() — отсюда падал просмотр фото.
 */
export async function signedPhotoUrls(paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrls(paths, expiresIn);
  throwIfError(error);
  const map: Record<string, string> = {};
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
  }
  return map;
}

/** Soft delete: файл остаётся в бакете, но исчезает из галереи и выборок. */
export async function softDeleteAttachment(id: string, byUserId: string): Promise<void> {
  const { error } = await supabase
    .from("attachments")
    .update({ deleted_at: new Date().toISOString(), deleted_by: byUserId })
    .eq("id", id);
  throwIfError(error);
}
