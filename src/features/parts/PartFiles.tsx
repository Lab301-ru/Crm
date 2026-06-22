import { useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PART_FILE_LABELS, removePartFile, signedPartFileUrls, uploadPartFile,
} from "@/shared/api/parts";
import type { OrderPart, PartFileKind } from "@/shared/api/types";
import { Button, ErrorText } from "@/shared/ui";

const FILE_KINDS: PartFileKind[] = ["screenshot", "receipt", "invoice"];
const IMG_RE = /\.(jpe?g|png|webp|gif|heic|heif|bmp|avif)$/i;

/**
 * Файлы запчасти (скриншот заказа / чек / накладная) с просмотром.
 * Ссылки — настоящие <a target="_blank"> с заранее подписанным URL, чтобы
 * открывались по тапу на мобильном (window.open после await там блокируется).
 * Изображения показываются миниатюрой прямо в карточке.
 */
export function PartFiles({ part, closed, onChanged }: {
  part: OrderPart; closed: boolean; onChanged: () => void;
}) {
  const paths = FILE_KINDS
    .map((k) => part[`${k}_path` as const] as string | null)
    .filter((p): p is string => !!p);

  const urls = useQuery({
    queryKey: ["part-file-urls", part.id, paths.join(",")],
    queryFn: () => signedPartFileUrls(paths),
    enabled: paths.length > 0,
    staleTime: 50 * 60 * 1000, // ссылка живёт час — обновляем заранее
  });

  return (
    <div className="space-y-3">
      {FILE_KINDS.map((kind) => {
        const path = part[`${kind}_path` as const] as string | null;
        return (
          <FileRow
            key={kind}
            part={part}
            kind={kind}
            closed={closed}
            url={path ? (urls.data?.[path] ?? null) : null}
            loadingUrl={!!path && urls.isLoading}
            onChanged={onChanged}
          />
        );
      })}
    </div>
  );
}

function FileRow({ part, kind, closed, url, loadingUrl, onChanged }: {
  part: OrderPart; kind: PartFileKind; closed: boolean;
  url: string | null; loadingUrl: boolean; onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const path = part[`${kind}_path` as const] as string | null;
  const name = part[`${kind}_name` as const] as string | null;
  const isImage = IMG_RE.test(name ?? "") || IMG_RE.test(path ?? "");

  const upload = useMutation({ mutationFn: (file: File) => uploadPartFile(part, kind, file), onSuccess: onChanged });
  const remove = useMutation({ mutationFn: () => removePartFile(part, kind), onSuccess: onChanged });

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-base font-semibold">{PART_FILE_LABELS[kind]}</span>
        {path && !closed && (
          <button
            onClick={() => remove.mutate()}
            className="rounded-md px-2 py-1 text-sm text-muted hover:text-danger"
            aria-label="Удалить файл"
          >
            Удалить ✕
          </button>
        )}
      </div>

      {path ? (
        loadingUrl || !url ? (
          <p className="text-base text-muted">Загрузка…</p>
        ) : isImage ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="block">
            <img
              src={url}
              alt={name ?? PART_FILE_LABELS[kind]}
              loading="lazy"
              className="max-h-72 w-auto rounded-lg border border-border"
            />
            <span className="mt-1.5 block text-lg font-medium text-primary underline">
              Открыть на весь экран
            </span>
          </a>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-lg font-medium text-primary"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M9 15h6M9 11h2" />
            </svg>
            Открыть {name ?? "файл"}
          </a>
        )
      ) : closed ? (
        <p className="text-base text-muted">—</p>
      ) : (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }}
          />
          <Button
            variant="secondary"
            className="text-base"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {upload.isPending ? "Загрузка…" : "Загрузить файл"}
          </Button>
        </>
      )}

      <ErrorText error={upload.error ?? remove.error} />
    </div>
  );
}
