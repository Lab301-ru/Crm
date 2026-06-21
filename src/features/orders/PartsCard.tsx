import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPart, fetchOrderParts, PART_STATUS_COLORS, PART_STATUS_LABELS,
  signedReceiptUrl, softDeletePart, updatePart, uploadPartReceipt,
} from "@/shared/api/parts";
import type { OrderPart, PartStatus } from "@/shared/api/types";
import { formatMoney } from "@/shared/lib/format";
import { useAuth } from "@/app/AuthProvider";
import { Button, Card, EmptyState, ErrorText, Input, Select, Spinner } from "@/shared/ui";

const STATUSES: PartStatus[] = ["need_order", "ordered", "received"];

/**
 * Закупка запчастей по заказу: трекинг статусов (нужно заказать →
 * заказано → получено), ссылка на магазин, стоимость и квитанция
 * поставщика. Отдельно от строк чека (ItemsCard) — это снабжение.
 */
export function PartsCard({ orderId, closed }: { orderId: string; closed: boolean }) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const parts = useQuery({ queryKey: ["order-parts", orderId], queryFn: () => fetchOrderParts(orderId) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["order-parts", orderId] });

  const [name, setName] = useState("");
  const [shopUrl, setShopUrl] = useState("");
  const [cost, setCost] = useState("");
  const [qty, setQty] = useState("1");

  const add = useMutation({
    mutationFn: () => createPart(orderId, {
      name: name.trim(),
      shop_url: shopUrl.trim() || null,
      cost: Number(cost) || 0,
      qty: Number(qty) || 1,
    }),
    onSuccess: () => { setName(""); setShopUrl(""); setCost(""); setQty("1"); invalidate(); },
  });

  const totalCost = (parts.data ?? []).reduce((s, p) => s + p.cost * p.qty, 0);

  return (
    <Card title="Запчасти (закупка)">
      {parts.isLoading ? <Spinner /> : (parts.data ?? []).length === 0 ? (
        <EmptyState text="Запчасти для заказа ещё не добавлены" />
      ) : (
        <div className="mb-3 space-y-2">
          {(parts.data ?? []).map((p) => (
            <PartRow key={p.id} part={p} closed={closed} userId={profile!.id} onChanged={invalidate} />
          ))}
        </div>
      )}

      {!closed && (
        <div className="flex flex-wrap items-end gap-2">
          <Input className="min-w-40 flex-1" placeholder="Название запчасти" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="min-w-40 flex-1" type="url" placeholder="Ссылка на магазин (https://…)" value={shopUrl} onChange={(e) => setShopUrl(e.target.value)} />
          <Input className="w-28" type="number" inputMode="numeric" min={0} placeholder="Стоимость" value={cost} onChange={(e) => setCost(e.target.value)} />
          <Input className="w-20" type="number" inputMode="numeric" min={0.01} step="any" placeholder="Кол-во" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Button variant="secondary" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
            Добавить
          </Button>
        </div>
      )}
      <ErrorText error={add.error} />

      {(parts.data ?? []).length > 0 && (
        <dl className="mt-4 flex justify-between border-t border-border pt-3 text-sm font-semibold">
          <dt>Итого закупка</dt>
          <dd>{formatMoney(totalCost)}</dd>
        </dl>
      )}
    </Card>
  );
}

function PartRow({ part, closed, userId, onChanged }: {
  part: OrderPart; closed: boolean; userId: string; onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const setStatus = useMutation({
    mutationFn: (status: PartStatus) => updatePart(part.id, { status }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => softDeletePart(part.id, userId),
    onSuccess: onChanged,
  });
  const upload = useMutation({
    mutationFn: (file: File) => uploadPartReceipt(part, file),
    onSuccess: onChanged,
  });
  const openReceipt = useMutation({
    mutationFn: () => signedReceiptUrl(part.receipt_path!),
    onSuccess: (url) => { if (url) window.open(url, "_blank", "noopener"); },
  });

  const color = PART_STATUS_COLORS[part.status];

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {part.name}
            {part.qty !== 1 && <span className="text-xs text-muted"> × {part.qty}</span>}
          </p>
          <p className="text-xs text-muted">
            {formatMoney(part.cost)}
            {part.shop_url && (
              <>
                {" · "}
                <a href={part.shop_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  магазин ↗
                </a>
              </>
            )}
          </p>
        </div>
        {!closed && (
          <button onClick={() => remove.mutate()} className="text-muted hover:text-danger" aria-label="Удалить">✕</button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {closed ? (
          <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold"
            style={{ color, backgroundColor: `${color}33`, borderColor: `${color}99` }}>
            {PART_STATUS_LABELS[part.status]}
          </span>
        ) : (
          <Select
            value={part.status}
            onChange={(e) => setStatus.mutate(e.target.value as PartStatus)}
            className="w-48"
            style={{ color, borderColor: `${color}99` }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{PART_STATUS_LABELS[s]}</option>
            ))}
          </Select>
        )}

        {part.receipt_path ? (
          <button onClick={() => openReceipt.mutate()} className="text-xs text-primary hover:underline">
            квитанция: {part.receipt_name ?? "файл"} ↗
          </button>
        ) : !closed && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }}
            />
            <Button variant="ghost" className="px-2 py-1 text-xs" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
              {upload.isPending ? "Загрузка…" : "+ квитанция"}
            </Button>
          </>
        )}
      </div>
      <ErrorText error={setStatus.error ?? remove.error ?? upload.error ?? openReceipt.error} />
    </div>
  );
}
