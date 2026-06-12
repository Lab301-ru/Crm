import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAttachments, signedPhotoUrls, softDeleteAttachment, uploadOrderPhoto } from "@/shared/api/storage";
import type { Attachment } from "@/shared/api/types";
import { formatDateTime } from "@/shared/lib/format";
import { Button, Card, ErrorText, Modal, Spinner } from "@/shared/ui";
import { useAuth } from "@/app/AuthProvider";

/**
 * Фото устройства: съёмка/загрузка с телефона при приёмке и диагностике,
 * галерея с просмотром. Загружать может любой сотрудник с доступом к заказу
 * (мастер фотографирует свою диагностику), удалять — менеджер/админ
 * (soft delete, RLS на attachments это же и гарантирует).
 */
export function PhotosCard({ orderId, closed }: { orderId: string; closed: boolean }) {
  const { profile } = useAuth();
  const canDelete = profile?.role !== "master";
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const attachments = useQuery({
    queryKey: ["attachments", orderId],
    queryFn: () => fetchAttachments(orderId),
  });
  const photos = (attachments.data ?? []).filter((a) => a.mime_type?.startsWith("image/"));
  const paths = photos.map((a) => a.storage_path);
  const urls = useQuery({
    queryKey: ["attachment-urls", paths],
    queryFn: () => signedPhotoUrls(paths),
    enabled: paths.length > 0,
    staleTime: 30 * 60_000, // подпись живёт час — обновляем заранее
  });

  const [pending, setPending] = useState(0);
  const [uploadError, setUploadError] = useState<Error | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !profile) return;
    setUploadError(null);
    setPending(files.length);
    try {
      for (const file of Array.from(files)) {
        await uploadOrderPhoto(orderId, file, profile.id);
        setPending((n) => n - 1);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e : new Error(String(e)));
      setPending(0);
    }
    void queryClient.invalidateQueries({ queryKey: ["attachments", orderId] });
  };

  const remove = useMutation({
    mutationFn: (att: Attachment) => softDeleteAttachment(att.id, profile!.id),
    onSuccess: () => {
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ["attachments", orderId] });
    },
  });

  return (
    <Card
      title={`Фото устройства${photos.length > 0 ? ` (${photos.length})` : ""}`}
      actions={!closed && (
        <Button variant="secondary" type="button" disabled={pending > 0} onClick={() => inputRef.current?.click()}>
          {pending > 0 ? `Загрузка… (${pending})` : "+ Фото"}
        </Button>
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }}
      />

      {attachments.isLoading ? (
        <Spinner />
      ) : photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map((a) => {
            const url = urls.data?.get(a.storage_path);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setPreview(a)}
                className="aspect-square overflow-hidden rounded-lg border border-border bg-surface-2"
              >
                {url ? (
                  <img src={url} alt={a.file_name} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <Spinner className="h-full" />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Фото пока нет. Снимите внешний вид при приёмке — меньше споров при выдаче.
        </p>
      )}
      <ErrorText error={uploadError} />

      {/* Просмотр */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.file_name ?? ""}>
        {preview && (
          <div className="space-y-3">
            <img
              src={urls.data?.get(preview.storage_path)}
              alt={preview.file_name}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
            <p className="text-xs text-muted">загружено {formatDateTime(preview.created_at)}</p>
            <ErrorText error={remove.error} />
            {canDelete && (
              <Button
                variant="danger"
                className="w-full"
                disabled={remove.isPending}
                onClick={() => remove.mutate(preview)}
              >
                Удалить фото
              </Button>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
