import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelReservation, createStockItem, fetchStockItems, reserveStockItem, sellStockItem,
  signedStockPhotoUrls, softDeleteStockItem, STOCK_KIND_LABELS, STOCK_KINDS,
  STOCK_STATUS_COLORS, STOCK_STATUS_LABELS, uploadStockPhoto,
} from "@/shared/api/stock";
import { searchClients } from "@/shared/api/clients";
import { useDebounced } from "@/shared/lib/useDebounced";
import type { Client, StockItem, StockKind, StockStatus } from "@/shared/api/types";
import { formatMoney } from "@/shared/lib/format";
import { useAuth } from "@/app/AuthProvider";
import { Button, Card, EmptyState, ErrorText, Field, Input, Modal, Select, Spinner, Textarea } from "@/shared/ui";

const STATUS_TABS: StockStatus[] = ["in_stock", "reserved", "sold", "archived"];

export function StockPage() {
  const { profile } = useAuth();
  const isManager = profile?.role === "admin" || profile?.role === "manager";
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StockStatus | "">("in_stock");
  const [kind, setKind] = useState<StockKind | "">("");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 300);

  const items = useQuery({
    queryKey: ["stock", status, kind, debouncedQ],
    queryFn: () => fetchStockItems({
      status: status || undefined,
      kind: kind || undefined,
      q: debouncedQ || undefined,
    }),
  });

  const paths = (items.data ?? []).map((i) => i.photo_path).filter((p): p is string => !!p);
  const photos = useQuery({
    queryKey: ["stock-photos", paths.join(",")],
    queryFn: () => signedStockPhotoUrls(paths),
    enabled: paths.length > 0,
    staleTime: 50 * 60 * 1000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["stock"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-overview"] });
  };

  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Склад / Продажи</h1>
        <p className="text-xs text-muted">Товары на реализацию: б/у аппараты, платы, запчасти, аксессуары</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((s) => {
          const on = status === s;
          const color = STOCK_STATUS_COLORS[s];
          return (
            <button
              key={s}
              onClick={() => setStatus(on ? "" : s)}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
              style={{ color: on ? "#fff" : color, backgroundColor: on ? color : `${color}1a`, borderColor: on ? color : `${color}55` }}
            >
              {STOCK_STATUS_LABELS[s]}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input className="min-w-56 flex-1" placeholder="Поиск: название, описание, поставщик…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-48" value={kind} onChange={(e) => setKind(e.target.value as StockKind | "")}>
          <option value="">Все типы</option>
          {STOCK_KINDS.map((k) => <option key={k} value={k}>{STOCK_KIND_LABELS[k]}</option>)}
        </Select>
      </div>

      <AddStockForm onAdded={invalidate} />

      {items.isLoading ? <Spinner /> : items.error ? <ErrorText error={items.error} /> :
       (items.data ?? []).length === 0 ? (
        <Card><EmptyState text="По текущим фильтрам товаров нет" /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(items.data ?? []).map((it) => (
            <StockCard
              key={it.id}
              item={it}
              photoUrl={it.photo_path ? (photos.data?.[it.photo_path] ?? null) : null}
              isManager={isManager}
              userId={profile!.id}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Добавление ----------------------------- */

function AddStockForm({ onAdded }: { onAdded: () => void }) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StockKind>("used_device");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [description, setDescription] = useState("");

  const add = useMutation({
    mutationFn: () => createStockItem({
      name: name.trim(), kind, quantity: Number(qty) || 1,
      cost_price: Number(cost) || 0, price: Number(price) || 0,
      supplier: supplier.trim() || null, description: description.trim() || null,
    }, profile!.id),
    onSuccess: () => {
      setName(""); setKind("used_device"); setQty("1"); setCost(""); setPrice(""); setSupplier(""); setDescription("");
      setOpen(false); onAdded();
    },
  });

  if (!open) {
    return <Button variant="secondary" onClick={() => setOpen(true)}>+ Добавить товар</Button>;
  }

  return (
    <Card title="Новый товар">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Название" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Тип">
          <Select value={kind} onChange={(e) => setKind(e.target.value as StockKind)}>
            {STOCK_KINDS.map((k) => <option key={k} value={k}>{STOCK_KIND_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label="Количество"><Input type="number" inputMode="numeric" min={0} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Закупка, ₽"><Input type="number" inputMode="numeric" min={0} value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        <Field label="Цена продажи, ₽"><Input type="number" inputMode="numeric" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Поставщик / источник"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
      </div>
      <div className="mt-2">
        <Field label="Описание"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <ErrorText error={add.error} />
      <div className="mt-2 flex gap-2">
        <Button disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>Добавить</Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Отмена</Button>
      </div>
    </Card>
  );
}

/* ----------------------------- Карточка товара ----------------------------- */

function StockCard({ item, photoUrl, isManager, userId, onChanged }: {
  item: StockItem; photoUrl: string | null; isManager: boolean; userId: string; onChanged: () => void;
}) {
  const [sell, setSell] = useState(false);
  const [reserve, setReserve] = useState(false);
  const color = STOCK_STATUS_COLORS[item.status];

  const upload = useMutation({ mutationFn: (f: File) => uploadStockPhoto(item, f), onSuccess: onChanged });
  const remove = useMutation({ mutationFn: () => softDeleteStockItem(item.id, userId), onSuccess: onChanged });
  const unreserve = useMutation({ mutationFn: () => cancelReservation(item.id), onSuccess: onChanged });
  const margin = item.price - item.cost_price;
  const sellable = item.quantity > 0 && item.status !== "sold" && item.status !== "archived";

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {photoUrl ? (
        <a href={photoUrl} target="_blank" rel="noopener noreferrer">
          <img src={photoUrl} alt={item.name} loading="lazy" className="h-40 w-full object-cover" />
        </a>
      ) : (
        <label className="flex h-40 w-full cursor-pointer items-center justify-center bg-surface-2 text-sm text-muted hover:text-text">
          {upload.isPending ? "Загрузка…" : "+ фото"}
          <input
            type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }}
          />
        </label>
      )}

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium">{item.name}</p>
          <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold"
            style={{ color, backgroundColor: `${color}33`, borderColor: `${color}99` }}>
            {STOCK_STATUS_LABELS[item.status]}
          </span>
        </div>
        <p className="text-xs text-muted">{STOCK_KIND_LABELS[item.kind]} · остаток {item.quantity} шт.</p>
        {item.description && <p className="text-xs text-muted">{item.description}</p>}
        {item.supplier && <p className="text-xs text-muted">источник: {item.supplier}</p>}

        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-lg font-bold" style={{ color: "#22C55E" }}>{formatMoney(item.price)}</span>
          {isManager && item.cost_price > 0 && (
            <span className="text-xs text-muted">закупка {formatMoney(item.cost_price)} · маржа {formatMoney(margin)}</span>
          )}
        </div>

        {item.status === "reserved" && (item.reserved_name || item.reserved_phone) && (
          <div className="mt-1 rounded-lg border px-2 py-1 text-xs"
            style={{ color: STOCK_STATUS_COLORS.reserved, borderColor: `${STOCK_STATUS_COLORS.reserved}66`, backgroundColor: `${STOCK_STATUS_COLORS.reserved}14` }}>
            Бронь: {item.reserved_name || "—"}{item.reserved_phone ? ` · ${item.reserved_phone}` : ""}
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {isManager && sellable && (
            <Button className="px-3 py-1.5 text-xs" onClick={() => setSell(true)}>Продать</Button>
          )}
          {sellable && item.status === "in_stock" && (
            <button onClick={() => setReserve(true)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ color: STOCK_STATUS_COLORS.reserved, borderColor: `${STOCK_STATUS_COLORS.reserved}99`, backgroundColor: `${STOCK_STATUS_COLORS.reserved}1a` }}>
              Бронь
            </button>
          )}
          {item.status === "reserved" && (
            <button onClick={() => unreserve.mutate()} disabled={unreserve.isPending}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-text">
              {unreserve.isPending ? "…" : "Снять бронь"}
            </button>
          )}
          {isManager && (
            <button onClick={() => { if (confirm(`Удалить «${item.name}» со склада?`)) remove.mutate(); }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-danger">
              Удалить
            </button>
          )}
        </div>
        <ErrorText error={upload.error ?? remove.error ?? unreserve.error} />
      </div>

      {reserve && <ReserveModal item={item} onClose={() => setReserve(false)} onDone={() => { setReserve(false); onChanged(); }} />}
      {sell && <SellModal item={item} onClose={() => setSell(false)} onSold={() => { setSell(false); onChanged(); }} />}
    </div>
  );
}

/* ----------------------------- Бронь ----------------------------- */

function ReserveModal({ item, onClose, onDone }: { item: StockItem; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(item.reserved_name ?? "");
  const [phone, setPhone] = useState(item.reserved_phone ?? "");

  const save = useMutation({
    mutationFn: () => reserveStockItem(item.id, name, phone),
    onSuccess: onDone,
  });

  return (
    <Modal open onClose={onClose} title={`Бронь: ${item.name}`}>
      <div className="space-y-3">
        <Field label="Имя покупателя" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Телефон"><Input inputMode="tel" placeholder="+7 …" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <ErrorText error={save.error} />
        <div className="flex gap-2">
          <Button className="flex-1" disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
            {save.isPending ? "Сохранение…" : "Забронировать"}
          </Button>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ----------------------------- Продажа ----------------------------- */

function SellModal({ item, onClose, onSold }: { item: StockItem; onClose: () => void; onSold: () => void }) {
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState(String(item.price));
  const [buyerName, setBuyerName] = useState(item.reserved_name ?? "");
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const [note, setNote] = useState(item.reserved_phone ? `Бронь, тел.: ${item.reserved_phone}` : "");

  const debouncedBuyer = useDebounced(buyerName, 300);
  const matches = useQuery({
    queryKey: ["clients-search", debouncedBuyer],
    queryFn: () => searchClients(debouncedBuyer, 5),
    enabled: !buyerId && debouncedBuyer.trim().length >= 2,
  });

  const sell = useMutation({
    mutationFn: () => sellStockItem({
      itemId: item.id,
      qty: Number(qty) || 1,
      unitPrice: Number(price) || 0,
      buyerClientId: buyerId,
      buyerName: buyerId ? null : (buyerName.trim() || null),
      note: note.trim() || null,
    }),
    onSuccess: onSold,
  });

  const pickClient = (c: Client) => { setBuyerId(c.id); setBuyerName(c.name); };
  const total = (Number(qty) || 0) * (Number(price) || 0);

  return (
    <Modal open onClose={onClose} title={`Продажа: ${item.name}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Количество (в наличии ${item.quantity})`}>
            <Input type="number" inputMode="numeric" min={1} max={item.quantity} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Цена за шт., ₽">
            <Input type="number" inputMode="numeric" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>

        <Field label="Покупатель">
          <Input
            placeholder="Имя или телефон клиента"
            value={buyerName}
            onChange={(e) => { setBuyerName(e.target.value); setBuyerId(null); }}
          />
        </Field>
        {buyerId ? (
          <p className="text-xs text-primary">✓ Выбран клиент из базы (выручка привяжется к нему)</p>
        ) : (matches.data && matches.data.length > 0) ? (
          <div className="space-y-1 rounded-lg border border-border bg-surface-2 p-2">
            <p className="text-xs text-muted">Найдено в базе — нажмите, чтобы привязать:</p>
            {matches.data.map((c) => (
              <button key={c.id} onClick={() => pickClient(c)}
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-surface">
                {c.name} · {c.phone}
              </button>
            ))}
          </div>
        ) : null}

        <Field label="Комментарий"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>

        <p className="text-sm">Итого к оплате: <b>{formatMoney(total)}</b></p>
        <ErrorText error={sell.error} />
        <div className="flex gap-2">
          <Button className="flex-1" disabled={sell.isPending || !price || Number(qty) < 1} onClick={() => sell.mutate()}>
            {sell.isPending ? "Оформление…" : "Продать"}
          </Button>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
        </div>
      </div>
    </Modal>
  );
}
