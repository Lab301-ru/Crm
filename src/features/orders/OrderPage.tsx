import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addOrderItem, changeStatus, deleteOrderItem, fetchOrder, fetchOrderHistory,
  fetchOrderItems, fetchStatuses, fetchTransitions, updateOrder,
} from "@/shared/api/orders";
import { fetchClient } from "@/shared/api/clients";
import { fetchDevice, fetchFieldTemplates } from "@/shared/api/catalog";
import { fetchProfiles } from "@/shared/api/settings";
import type { Order, PaymentMethod, PaymentStatus, Status } from "@/shared/api/types";
import { formatDateTime, formatMoney, formatPhone } from "@/shared/lib/format";
import { Button, Card, ErrorText, Field, Input, Modal, OverdueBadge, Select, Spinner, StatusBadge, Textarea } from "@/shared/ui";
import { useAuth } from "@/app/AuthProvider";

export function OrderPage() {
  const { id = "" } = useParams();
  const { profile } = useAuth();
  const isMaster = profile?.role === "master";
  const queryClient = useQueryClient();

  const order = useQuery({ queryKey: ["order", id], queryFn: () => fetchOrder(id) });
  const items = useQuery({ queryKey: ["order-items", id], queryFn: () => fetchOrderItems(id) });
  const history = useQuery({ queryKey: ["order-history", id], queryFn: () => fetchOrderHistory(id) });
  const statuses = useQuery({ queryKey: ["statuses"], queryFn: fetchStatuses, staleTime: Infinity });
  const transitions = useQuery({ queryKey: ["transitions"], queryFn: fetchTransitions, staleTime: Infinity });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles, staleTime: 300_000 });
  const client = useQuery({
    queryKey: ["client", order.data?.client_id],
    queryFn: () => fetchClient(order.data!.client_id),
    enabled: !!order.data,
  });
  const device = useQuery({
    queryKey: ["device", order.data?.device_id],
    queryFn: () => fetchDevice(order.data!.device_id),
    enabled: !!order.data,
  });
  const templates = useQuery({
    queryKey: ["field-templates", device.data?.category_id],
    queryFn: () => fetchFieldTemplates(device.data!.category_id),
    enabled: !!device.data,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["order", id] });
    void queryClient.invalidateQueries({ queryKey: ["order-items", id] });
    void queryClient.invalidateQueries({ queryKey: ["order-history", id] });
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ to, comment }: { to: string; comment: string | null }) => changeStatus(id, to, comment),
    onSuccess: () => { invalidate(); setStatusTarget(null); },
  });

  const [statusTarget, setStatusTarget] = useState<Status | null>(null);
  const [statusComment, setStatusComment] = useState("");

  if (order.isLoading) return <Spinner className="pt-20" />;
  if (order.error || !order.data) return <ErrorText error={order.error ?? "Заказ не найден"} />;

  const o = order.data;
  const statusByCode = new Map((statuses.data ?? []).map((s) => [s.code, s]));
  const current = statusByCode.get(o.status);
  const nextCodes = (transitions.data ?? [])
    .filter((t) => t.from_code === o.status)
    .map((t) => statusByCode.get(t.to_code))
    .filter((s): s is Status => !!s)
    .sort((a, b) => a.sort - b.sort);

  const trackingUrl = `${window.location.origin}/status/${o.qr_token}`;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* Шапка */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">{o.display_number}</h1>
        {current && <StatusBadge label={current.label} color={current.color} />}
        {o.is_overdue && <OverdueBadge />}
        <span className="ml-auto text-sm text-muted">принят {formatDateTime(o.accepted_at)}</span>
      </div>

      {/* Смена статуса */}
      {nextCodes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nextCodes.map((s) => (
            <button
              key={s.code}
              onClick={() => { setStatusTarget(s); setStatusComment(""); }}
              className="rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: s.color, backgroundColor: `${s.color}1a`, borderColor: `${s.color}55` }}
            >
              → {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Клиент */}
        <Card title="Клиент">
          {client.data ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">{client.data.name}</p>
              <p>
                <a href={`tel:${client.data.phone}`} className="text-primary hover:underline">
                  {formatPhone(client.data.phone)}
                </a>
              </p>
              {client.data.email && <p className="text-muted">{client.data.email}</p>}
              {client.data.comment && <p className="text-muted">{client.data.comment}</p>}
              <p className="pt-1 text-xs text-muted">
                Telegram: {client.data.telegram_chat_id ? "подключён ✓" : "не подключён"}
              </p>
            </div>
          ) : <Spinner />}
        </Card>

        {/* Устройство */}
        <Card title="Устройство">
          {device.data ? (
            <dl className="space-y-1.5 text-sm">
              {device.data.serial_number && <Row k="Серийный №" v={device.data.serial_number} />}
              {device.data.completeness && <Row k="Комплектация" v={device.data.completeness} />}
              {device.data.appearance && <Row k="Состояние" v={device.data.appearance} />}
              <Row k="Гарантийный случай" v={device.data.is_warranty_case ? "Да" : "Нет"} />
              {(templates.data ?? [])
                .filter((t) => device.data!.custom_fields[t.key] != null)
                .map((t) => (
                  <Row key={t.key} k={t.label} v={String(
                    Array.isArray(device.data!.custom_fields[t.key])
                      ? (device.data!.custom_fields[t.key] as string[]).join(", ")
                      : device.data!.custom_fields[t.key],
                  )} />
                ))}
            </dl>
          ) : <Spinner />}
        </Card>
      </div>

      {/* Неисправность и работа мастера */}
      <DefectCard order={o} profiles={profiles.data ?? []} onSaved={invalidate} isMaster={isMaster} />

      {/* Работы и запчасти */}
      <ItemsCard orderId={id} items={items.data ?? []} totals={o} onChanged={invalidate} closed={["issued", "scrapped"].includes(o.status)} />

      {/* Оплата — финансы ведёт менеджер/админ */}
      {!isMaster && <PaymentCard order={o} onSaved={invalidate} />}

      {/* QR / отслеживание */}
      <Card title="Отслеживание для клиента">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <code className="rounded bg-surface-2 px-2 py-1 text-xs break-all">{trackingUrl}</code>
          <Button variant="secondary" type="button" onClick={() => void navigator.clipboard.writeText(trackingUrl)}>
            Скопировать ссылку
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          QR-код с этой ссылкой печатается на квитанции. Клиент видит только: номер, статус, даты и комментарий сервиса.
        </p>
      </Card>

      {/* История */}
      <Card title="История статусов">
        {history.data && history.data.length > 0 ? (
          <ol className="space-y-2 text-sm">
            {history.data.map((h) => {
              const from = h.from_status ? statusByCode.get(h.from_status)?.label : null;
              const to = statusByCode.get(h.to_status)?.label ?? h.to_status;
              const who = profiles.data?.find((p) => p.id === h.changed_by)?.full_name ?? "—";
              return (
                <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-border pb-2 last:border-0">
                  <span className="text-xs text-muted">{formatDateTime(h.created_at)}</span>
                  <span>{from ? `${from} → ${to}` : to}</span>
                  <span className="text-xs text-muted">· {who}</span>
                  {h.comment && <span className="w-full text-xs text-muted">{h.comment}</span>}
                </li>
              );
            })}
          </ol>
        ) : <Spinner />}
      </Card>

      {/* Модалка смены статуса */}
      <Modal open={!!statusTarget} onClose={() => setStatusTarget(null)} title={`Перевести в «${statusTarget?.label}»`}>
        <div className="space-y-3">
          <Field label="Комментарий (попадёт в историю)">
            <Textarea value={statusComment} onChange={(e) => setStatusComment(e.target.value)} />
          </Field>
          <ErrorText error={statusMutation.error} />
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ to: statusTarget!.code, comment: statusComment.trim() || null })}
            >
              Подтвердить
            </Button>
            <Button variant="secondary" onClick={() => setStatusTarget(null)}>Отмена</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}

/* ---------------- Неисправность / диагностика ---------------- */

function DefectCard({ order, profiles, onSaved, isMaster }: {
  order: Order;
  profiles: { id: string; full_name: string; role: string; is_active: boolean }[];
  onSaved: () => void;
  isMaster: boolean;
}) {
  const [diagnostic, setDiagnostic] = useState(order.diagnostic_result ?? "");
  const [masterComment, setMasterComment] = useState(order.master_comment ?? "");
  const [publicComment, setPublicComment] = useState(order.public_comment ?? "");
  const [masterId, setMasterId] = useState(order.master_id ?? "");
  const [dueDate, setDueDate] = useState(order.due_date ?? "");

  const save = useMutation({
    // мастеру сервер запретит менять master_id — не отправляем его вовсе
    mutationFn: () => updateOrder(order.id, {
      diagnostic_result: diagnostic.trim() || null,
      master_comment: masterComment.trim() || null,
      public_comment: publicComment.trim() || null,
      ...(isMaster ? {} : { master_id: masterId || null }),
      due_date: dueDate || null,
    }),
    onSuccess: onSaved,
  });

  const masters = profiles.filter((p) => p.is_active && p.role !== "manager");

  return (
    <Card
      title="Неисправность и диагностика"
      actions={<Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>}
    >
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted">Заявленная неисправность</p>
          <p className="mt-1 text-sm">{order.claimed_defect}</p>
        </div>
        <Field label="Результат диагностики">
          <Textarea value={diagnostic} onChange={(e) => setDiagnostic(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Комментарий мастера (внутренний)">
            <Textarea value={masterComment} onChange={(e) => setMasterComment(e.target.value)} />
          </Field>
          <Field label="Комментарий для клиента (виден по QR)">
            <Textarea value={publicComment} onChange={(e) => setPublicComment(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {!isMaster && (
            <Field label="Мастер">
              <Select value={masterId} onChange={(e) => setMasterId(e.target.value)}>
                <option value="">Не назначен</option>
                {masters.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Плановая готовность">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <ErrorText error={save.error} />
      </div>
    </Card>
  );
}

/* ---------------- Работы и запчасти ---------------- */

function ItemsCard({ orderId, items, totals, onChanged, closed }: {
  orderId: string;
  items: { id: string; item_type: "work" | "part"; name: string; price: number; qty: number }[];
  totals: Order;
  onChanged: () => void;
  closed: boolean;
}) {
  const [type, setType] = useState<"work" | "part">("work");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");

  const add = useMutation({
    mutationFn: () => addOrderItem({
      order_id: orderId, item_type: type, name: name.trim(), price: Number(price), qty: Number(qty) || 1,
    }),
    onSuccess: () => { setName(""); setPrice(""); setQty("1"); onChanged(); },
  });
  const remove = useMutation({ mutationFn: deleteOrderItem, onSuccess: onChanged });

  return (
    <Card title="Работы и запчасти">
      {items.length > 0 && (
        <table className="mb-3 w-full text-sm">
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="py-2 pr-2 text-xs text-muted w-16">{item.item_type === "work" ? "Работа" : "Запчасть"}</td>
                <td className="py-2 pr-2">{item.name}</td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">
                  {item.qty !== 1 && <span className="text-xs text-muted">{item.qty} × </span>}
                  {formatMoney(item.price)}
                </td>
                <td className="w-8 py-2 text-right">
                  {!closed && (
                    <button onClick={() => remove.mutate(item.id)} className="text-muted hover:text-danger" aria-label="Удалить">✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!closed && (
        <div className="flex flex-wrap items-end gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value as "work" | "part")} className="w-32">
            <option value="work">Работа</option>
            <option value="part">Запчасть</option>
          </Select>
          <Input className="min-w-40 flex-1" placeholder="Наименование" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="w-28" type="number" inputMode="numeric" min={0} placeholder="Цена" value={price} onChange={(e) => setPrice(e.target.value)} />
          <Input className="w-20" type="number" inputMode="numeric" min={0.01} step="any" placeholder="Кол-во" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Button variant="secondary" disabled={!name.trim() || !price || add.isPending} onClick={() => add.mutate()}>
            Добавить
          </Button>
        </div>
      )}
      <ErrorText error={add.error ?? remove.error} />

      <dl className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
        <Row k="Работы" v={formatMoney(totals.works_total)} />
        <Row k="Запчасти" v={formatMoney(totals.parts_total)} />
        <Row k="Предоплата" v={`− ${formatMoney(totals.prepayment)}`} />
        <div className="flex justify-between gap-3 pt-1 text-base font-bold">
          <dt>К оплате</dt>
          <dd>{formatMoney(totals.due_amount)}</dd>
        </div>
      </dl>
    </Card>
  );
}

/* ---------------- Оплата ---------------- */

function PaymentCard({ order, onSaved }: { order: Order; onSaved: () => void }) {
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status);
  const [method, setMethod] = useState<PaymentMethod | "">(order.payment_method ?? "");
  const [prepayment, setPrepayment] = useState(String(order.prepayment));

  const save = useMutation({
    mutationFn: () => updateOrder(order.id, {
      payment_status: paymentStatus,
      payment_method: method || null,
      prepayment: Number(prepayment) || 0,
    }),
    onSuccess: onSaved,
  });

  return (
    <Card
      title="Оплата"
      actions={<Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>Сохранить</Button>}
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label="Статус оплаты">
          <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}>
            <option value="unpaid">Не оплачен</option>
            <option value="prepaid">Предоплата</option>
            <option value="paid">Оплачен</option>
          </Select>
        </Field>
        <Field label="Способ">
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}>
            <option value="">—</option>
            <option value="cash">Наличные</option>
            <option value="card">Карта</option>
            <option value="transfer">Перевод</option>
          </Select>
        </Field>
        <Field label="Предоплата, ₽">
          <Input type="number" inputMode="numeric" min={0} value={prepayment} onChange={(e) => setPrepayment(e.target.value)} />
        </Field>
      </div>
      <ErrorText error={save.error} />
    </Card>
  );
}
