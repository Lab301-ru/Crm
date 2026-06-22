import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPart, fetchOrderParts, PART_STATUS_COLORS, PART_STATUS_LABELS,
  PART_STATUSES_ORDER, softDeletePart, updatePart,
} from "@/shared/api/parts";
import type { OrderPart, PartStatus } from "@/shared/api/types";
import { formatMoney } from "@/shared/lib/format";
import { useAuth } from "@/app/AuthProvider";
import { Button, Card, EmptyState, ErrorText, Field, Input, Select, Spinner, Textarea } from "@/shared/ui";
import { PartFiles } from "../parts/PartFiles";

/**
 * Закупка запчастей по заказу: расширенный трекинг — название, кол-во,
 * комментарий мастера; закупка (магазин, цена, поставщик); 3 файла
 * (скриншот, чек, накладная); 5 статусов от «нужно заказать» до
 * «установлена». Отдельно от строк чека (ItemsCard) — это снабжение.
 */
export function PartsCard({ orderId, closed }: { orderId: string; closed: boolean }) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const parts = useQuery({ queryKey: ["order-parts", orderId], queryFn: () => fetchOrderParts(orderId) });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["order-parts", orderId] });
    void queryClient.invalidateQueries({ queryKey: ["parts-overview"] });
  };

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

      {!closed && <AddForm orderId={orderId} onAdded={invalidate} />}

      {(parts.data ?? []).length > 0 && (
        <dl className="mt-4 flex justify-between border-t border-border pt-3 text-sm font-semibold">
          <dt>Итого закупка</dt>
          <dd>{formatMoney(totalCost)}</dd>
        </dl>
      )}
    </Card>
  );
}

/* ----------------------------- Форма добавления ----------------------------- */

function AddForm({ orderId, onAdded }: { orderId: string; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [masterComment, setMasterComment] = useState("");
  const [shopUrl, setShopUrl] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");

  const add = useMutation({
    mutationFn: () => createPart(orderId, {
      name: name.trim(), qty: Number(qty) || 1,
      master_comment: masterComment.trim() || null,
      shop_url: shopUrl.trim() || null,
      cost: Number(cost) || 0,
      supplier: supplier.trim() || null,
    }),
    onSuccess: () => {
      setName(""); setQty("1"); setMasterComment(""); setShopUrl(""); setCost(""); setSupplier("");
      onAdded();
    },
  });

  return (
    <div className="rounded-lg border border-dashed border-border p-3">
      <p className="mb-2 text-xs font-medium text-muted">Добавить запчасть</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Название"><Input placeholder="Название запчасти" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Количество"><Input type="number" inputMode="numeric" min={0.01} step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Цена закупки"><Input type="number" inputMode="numeric" min={0} placeholder="0" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label="Ссылка на магазин"><Input type="url" placeholder="https://…" value={shopUrl} onChange={(e) => setShopUrl(e.target.value)} /></Field>
        <Field label="Поставщик"><Input placeholder="напр. Чип и Дип" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Комментарий мастера"><Input placeholder="заметка от мастера" value={masterComment} onChange={(e) => setMasterComment(e.target.value)} /></Field>
      </div>
      <div className="mt-2">
        <Button variant="secondary" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
          Добавить
        </Button>
      </div>
      <ErrorText error={add.error} />
    </div>
  );
}

/* ----------------------------- Строка запчасти ----------------------------- */

function PartRow({ part, closed, userId, onChanged }: {
  part: OrderPart; closed: boolean; userId: string; onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const setStatus = useMutation({
    mutationFn: (status: PartStatus) => updatePart(part.id, { status }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => softDeletePart(part.id, userId),
    onSuccess: onChanged,
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
            {part.supplier && <> · поставщик: {part.supplier}</>}
            {part.shop_url && (
              <>
                {" · "}
                <a href={part.shop_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  магазин ↗
                </a>
              </>
            )}
          </p>
          {part.master_comment && <p className="mt-1 text-xs italic text-muted">«{part.master_comment}»</p>}
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
            {PART_STATUSES_ORDER.map((s) => (
              <option key={s} value={s}>{PART_STATUS_LABELS[s]}</option>
            ))}
          </Select>
        )}

        <button onClick={() => setExpanded(!expanded)} className="text-sm font-medium text-primary hover:underline">
          {expanded ? "Скрыть файлы" : "Файлы и детали"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <PartFiles part={part} closed={closed} onChanged={onChanged} />
          {!closed && <PartEdit part={part} onSaved={onChanged} />}
        </div>
      )}

      <ErrorText error={setStatus.error ?? remove.error} />
    </div>
  );
}

/* ----------------------------- Редактирование полей ----------------------------- */

function PartEdit({ part, onSaved }: { part: OrderPart; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: part.name,
    qty: String(part.qty),
    master_comment: part.master_comment ?? "",
    shop_url: part.shop_url ?? "",
    cost: String(part.cost),
    supplier: part.supplier ?? "",
    note: part.note ?? "",
  });
  const save = useMutation({
    mutationFn: () => updatePart(part.id, {
      name: form.name.trim(),
      qty: Number(form.qty) || 1,
      master_comment: form.master_comment.trim() || null,
      shop_url: form.shop_url.trim() || null,
      cost: Number(form.cost) || 0,
      supplier: form.supplier.trim() || null,
      note: form.note.trim() || null,
    }),
    onSuccess: onSaved,
  });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Название"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Количество"><Input type="number" inputMode="numeric" min={0.01} step="any" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
      <Field label="Цена закупки"><Input type="number" inputMode="numeric" min={0} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
      <Field label="Поставщик"><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
      <Field label="Ссылка на магазин"><Input type="url" value={form.shop_url} onChange={(e) => setForm({ ...form, shop_url: e.target.value })} /></Field>
      <Field label="Комментарий мастера"><Input value={form.master_comment} onChange={(e) => setForm({ ...form, master_comment: e.target.value })} /></Field>
      <div className="sm:col-span-2">
        <Field label="Заметка"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      </div>
      <div className="sm:col-span-2">
        <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Сохранение…" : "Сохранить"}
        </Button>
        <ErrorText error={save.error} />
      </div>
    </div>
  );
}
