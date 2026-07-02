import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addOrderItem, changeStatus, deleteOrderItem, fetchOrder, fetchOrderHistory,
  fetchOrderItems, fetchStatuses, fetchTransitions, setOrderPrepayment, updateOrder,
} from "@/shared/api/orders";
import { addOrderDevice, fetchOrderDevices, issueOrderDevice, updateOrderDevice, type DevicePayload } from "@/shared/api/orderDevices";
import { fetchClient, updateClient } from "@/shared/api/clients";
import {
  addCategory, fetchCategories, fetchDevice, fetchFieldTemplates, quickAddModel, searchBrands, searchModels, updateDevice,
} from "@/shared/api/catalog";
import { fetchProfiles } from "@/shared/api/settings";
import type { Client, Device, Order, OrderDeviceTotals, OrderItem, PaymentMethod, PaymentStatus, Status } from "@/shared/api/types";
import { formatDateTime, formatMoney, formatPhone, phoneInput } from "@/shared/lib/format";
import { useAuth } from "@/app/AuthProvider";
import { copyText } from "@/shared/lib/clipboard";
import { clearDraft, useDraftLoad, useDraftSave } from "@/shared/lib/useFormDraft";
import { Button, Card, ErrorText, Field, Input, Modal, OverdueBadge, Select, Spinner, StatusBadge, Textarea } from "@/shared/ui";
import { DOC_LABELS, fetchOrderDocuments, type DocType } from "@/shared/api/documents";
import { PhotosCard } from "./PhotosCard";
import { PartsCard } from "./PartsCard";

export function OrderPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const isManager = profile?.role === "admin" || profile?.role === "manager";
  const [editClient, setEditClient] = useState(false);
  const [editDevice, setEditDevice] = useState(false);

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
  const orderDevices = useQuery({
    queryKey: ["order-devices", id],
    queryFn: () => fetchOrderDevices(id),
  });
  const templates = useQuery({
    queryKey: ["field-templates", device.data?.category_id],
    queryFn: () => fetchFieldTemplates(device.data!.category_id),
    enabled: !!device.data,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["order", id] });
    void queryClient.invalidateQueries({ queryKey: ["order-items", id] });
    void queryClient.invalidateQueries({ queryKey: ["order-devices", id] });
    void queryClient.invalidateQueries({ queryKey: ["order-history", id] });
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const statusMutation = useMutation({
    // ключ + переменные (не замыкание): мутация попадает в офлайн-очередь
    // и доотправляется после перезагрузки (defaults в main.tsx)
    mutationKey: ["change-status"],
    mutationFn: (v: { orderId: string; to: string; comment: string | null; executor?: string | null }) =>
      changeStatus(v.orderId, v.to, v.comment, v.executor),
    onSuccess: () => { invalidate(); setStatusTarget(null); setStatusExecutor(""); },
  });

  const [statusTarget, setStatusTarget] = useState<Status | null>(null);
  const [statusComment, setStatusComment] = useState("");
  const [statusExecutor, setStatusExecutor] = useState("");

  if (order.isLoading) return <Spinner className="pt-20" />;
  if (order.error || !order.data) return <ErrorText error={order.error ?? "Заказ не найден"} />;

  const o = order.data;
  const devices = orderDevices.data ?? [];
  const multiDevice = devices.length > 1;
  const closed = ["issued", "scrapped"].includes(o.status);
  const statusByCode = new Map((statuses.data ?? []).map((s) => [s.code, s]));
  const current = statusByCode.get(o.status);
  // «Выдан» исключаем из ручных переходов — выдача идёт поаппаратно
  // (issue_order_device закрывает заказ, когда все аппараты отданы).
  const nextCodes = (transitions.data ?? [])
    .filter((t) => t.from_code === o.status && t.to_code !== "issued")
    .map((t) => statusByCode.get(t.to_code))
    .filter((s): s is Status => !!s)
    .sort((a, b) => a.sort - b.sort);

  const trackingUrl = `${window.location.origin}/status/${o.qr_token}`;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {/* Шапка */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">{o.display_number}</h1>
        {current && (
          <div>
            <StatusBadge label={current.label} color={current.color} />
            {o.status_since && (
              <p className="mt-1 text-xs text-muted">с {formatDateTime(o.status_since)}</p>
            )}
          </div>
        )}
        {o.is_overdue && <OverdueBadge />}
        <span className="ml-auto text-sm text-muted">принят {formatDateTime(o.accepted_at)}</span>
      </div>

      {o.status === "outsource" && o.outsource_executor && (
        <div className="rounded-lg border px-3 py-2 text-sm"
          style={{ color: "#D946EF", borderColor: "#D946EF66", backgroundColor: "#D946EF14" }}>
          Аутсорс — исполнитель: <b>{o.outsource_executor}</b>
        </div>
      )}

      {/* Смена статуса */}
      {nextCodes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nextCodes.map((s) => (
            <button
              key={s.code}
              onClick={() => { setStatusTarget(s); setStatusComment(""); setStatusExecutor(s.code === "outsource" ? (o.outsource_executor ?? "") : ""); }}
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
        <Card
          title="Клиент"
          actions={isManager && client.data && (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setEditClient(true)}>Изменить</Button>
          )}
        >
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

        {/* Устройство (основной аппарат; полный список — в карточке «Аппараты и выдача») */}
        <Card
          title={multiDevice ? "Устройство №1" : "Устройство"}
          actions={device.data && (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setEditDevice(true)}>Изменить</Button>
          )}
        >
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

      {/* Модалки правки клиента/устройства */}
      {editClient && client.data && (
        <EditClientModal
          client={client.data}
          onClose={() => setEditClient(false)}
          onSaved={() => { void client.refetch(); setEditClient(false); }}
        />
      )}
      {editDevice && device.data && (
        <EditDeviceModal
          device={device.data}
          onClose={() => setEditDevice(false)}
          onSaved={() => { void device.refetch(); setEditDevice(false); }}
        />
      )}

      {/* Аппараты и выдача */}
      <DevicesCard
        orderId={id}
        devices={devices}
        orderClosed={closed}
        onChanged={invalidate}
      />

      {/* Неисправность и работа мастера */}
      <DefectCard order={o} profiles={profiles.data ?? []} onSaved={invalidate} />

      {/* Фото устройства */}
      <PhotosCard orderId={id} closed={["issued", "scrapped"].includes(o.status)} />

      {/* Работы и запчасти */}
      <ItemsCard orderId={id} items={items.data ?? []} devices={devices} totals={o} onChanged={invalidate} closed={["issued", "scrapped"].includes(o.status)} />

      {/* Закупка запчастей */}
      <PartsCard orderId={id} closed={["issued", "scrapped"].includes(o.status)} />

      {/* Оплата */}
      <PaymentCard order={o} onSaved={invalidate} />

      {/* Документы */}
      <DocumentsCard order={o} itemsCount={(items.data ?? []).length} />

      {/* QR / отслеживание */}
      <Card title="Отслеживание для клиента">
        <div className="flex flex-wrap items-center gap-4">
          <QrImage url={trackingUrl} />
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <code className="block rounded bg-surface-2 px-2 py-1 text-xs break-all">{trackingUrl}</code>
            <CopyLinkButton url={trackingUrl} />
            <p className="text-xs text-muted">
              Этот же QR печатается на квитанции — клиент может отсканировать прямо с экрана.
              На странице видно только: номер, статус с историей, даты и комментарий сервиса.
            </p>
          </div>
        </div>
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
          {statusTarget?.code === "outsource" && (
            <Field label="Исполнитель (организация / мастер)" required>
              <Input
                placeholder="Кто чинит на аутсорсе"
                value={statusExecutor}
                onChange={(e) => setStatusExecutor(e.target.value)}
              />
            </Field>
          )}
          <Field label="Комментарий (попадёт в историю)">
            <Textarea value={statusComment} onChange={(e) => setStatusComment(e.target.value)} />
          </Field>
          <ErrorText error={statusMutation.error} />
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={statusMutation.isPending || (statusTarget?.code === "outsource" && !statusExecutor.trim())}
              onClick={() => statusMutation.mutate({
                orderId: id,
                to: statusTarget!.code,
                comment: statusComment.trim() || null,
                executor: statusTarget!.code === "outsource" ? statusExecutor.trim() : null,
              })}
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

/** Кнопка копирования ссылки с фолбэком и подтверждением «Скопировано». */
function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const ok = await copyText(url);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="secondary" type="button" onClick={() => void onCopy()}>
      {copied ? "Скопировано ✓" : "Скопировать ссылку"}
    </Button>
  );
}

/** QR на белой подложке — иначе сканеры не читают с тёмного экрана. */
function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode")
      .then((m) => m.default.toDataURL(url, { margin: 1, width: 192 }))
      .then((s) => { if (alive) setSrc(s); });
    return () => { alive = false; };
  }, [url]);
  if (!src) return <div className="h-28 w-28 shrink-0 rounded-lg bg-surface-2" aria-hidden />;
  return <img src={src} alt="QR-код отслеживания" className="h-28 w-28 shrink-0 rounded-lg bg-white p-1.5" />;
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

function DefectCard({ order, profiles, onSaved }: {
  order: Order;
  profiles: { id: string; full_name: string; role: string; is_active: boolean }[];
  onSaved: () => void;
}) {
  // Черновик диагностики на этот заказ — переживает сворачивание вкладки/навигацию.
  const draftKey = `draft:order-defect:${order.id}`;
  const draft = useDraftLoad<{
    defect: string; diagnostic: string; masterComment: string; publicComment: string; masterId: string; dueDate: string;
  }>(draftKey);
  const [defect, setDefect] = useState(draft.defect ?? order.claimed_defect ?? "");
  const [diagnostic, setDiagnostic] = useState(draft.diagnostic ?? order.diagnostic_result ?? "");
  const [masterComment, setMasterComment] = useState(draft.masterComment ?? order.master_comment ?? "");
  const [publicComment, setPublicComment] = useState(draft.publicComment ?? order.public_comment ?? "");
  const [masterId, setMasterId] = useState(draft.masterId ?? order.master_id ?? "");
  const [dueDate, setDueDate] = useState(draft.dueDate ?? order.due_date ?? "");

  useDraftSave(draftKey, { defect, diagnostic, masterComment, publicComment, masterId, dueDate });

  const save = useMutation({
    mutationKey: ["update-order"],
    mutationFn: (v: { orderId: string; patch: Partial<Order> }) => updateOrder(v.orderId, v.patch),
    onSuccess: () => { clearDraft(draftKey); onSaved(); },
  });
  const submitPatch = () => save.mutate({
    orderId: order.id,
    patch: {
      claimed_defect: defect.trim() || order.claimed_defect,
      diagnostic_result: diagnostic.trim() || null,
      master_comment: masterComment.trim() || null,
      public_comment: publicComment.trim() || null,
      master_id: masterId || null,
      due_date: dueDate || null,
    },
  });

  const masters = profiles.filter((p) => p.is_active && p.role !== "manager");

  return (
    <Card
      title="Неисправность и диагностика"
      actions={<Button variant="secondary" disabled={save.isPending} onClick={submitPatch}>Сохранить</Button>}
    >
      <div className="space-y-3">
        <Field label="Заявленная неисправность">
          <Textarea value={defect} onChange={(e) => setDefect(e.target.value)} />
        </Field>
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
          <Field label="Мастер">
            <Select value={masterId} onChange={(e) => setMasterId(e.target.value)}>
              <option value="">Не назначен</option>
              {masters.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </Select>
          </Field>
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

function ItemsCard({ orderId, items, devices, totals, onChanged, closed }: {
  orderId: string;
  items: OrderItem[];
  devices: OrderDeviceTotals[];
  totals: Order;
  onChanged: () => void;
  closed: boolean;
}) {
  const multi = devices.length > 1;
  const [type, setType] = useState<"work" | "part">("work");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [qty, setQty] = useState("1");
  const [deviceId, setDeviceId] = useState<string>(devices[0]?.id ?? "");

  const targetDevice = deviceId || devices[0]?.id || null;
  const deviceLabel = (odId: string | null) => {
    const d = devices.find((x) => x.id === odId);
    return d ? `№${d.position} · ${d.device_label}` : "—";
  };

  const add = useMutation({
    mutationFn: () => addOrderItem({
      order_id: orderId, order_device_id: targetDevice, item_type: type,
      name: name.trim(), price: Number(price), qty: Number(qty) || 1,
      // закупочная цена учитывается только у запчастей (для работ = 0)
      cost_price: type === "part" ? Number(cost) || 0 : 0,
    }),
    onSuccess: () => { setName(""); setPrice(""); setCost(""); setQty("1"); onChanged(); },
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
                <td className="py-2 pr-2">
                  {item.name}
                  {multi && <span className="block text-xs text-muted">{deviceLabel(item.order_device_id)}</span>}
                </td>
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
          {multi && (
            <Select value={targetDevice ?? ""} onChange={(e) => setDeviceId(e.target.value)} className="w-full sm:w-56">
              {devices.map((d) => <option key={d.id} value={d.id}>№{d.position} · {d.device_label}</option>)}
            </Select>
          )}
          <Select value={type} onChange={(e) => setType(e.target.value as "work" | "part")} className="w-32">
            <option value="work">Работа</option>
            <option value="part">Запчасть</option>
          </Select>
          <Input className="min-w-40 flex-1" placeholder="Наименование" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="w-28" type="number" inputMode="numeric" min={0} placeholder="Цена клиенту" value={price} onChange={(e) => setPrice(e.target.value)} />
          {type === "part" && (
            <Input className="w-28" type="number" inputMode="numeric" min={0} placeholder="Закупка" value={cost} onChange={(e) => setCost(e.target.value)} />
          )}
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

/* ---------------- Документы ---------------- */

function DocumentsCard({ order, itemsCount }: { order: Order; itemsCount: number }) {
  const docs = useQuery({
    queryKey: ["order-documents", order.id],
    queryFn: () => fetchOrderDocuments(order.id),
  });

  // Когда какой документ уместен: квитанция — всегда; акт работ (с
  // гарантийным талоном 2-в-1) — есть позиции; акт выдачи — заказ готов/выдан.
  const available: { type: DocType; enabled: boolean; hint: string }[] = [
    { type: "intake_receipt", enabled: true, hint: "" },
    { type: "work_act", enabled: itemsCount > 0, hint: "добавьте работы или запчасти" },
    { type: "issue_act", enabled: ["ready", "issued"].includes(order.status), hint: "доступен для готового или выданного заказа" },
  ];

  return (
    <Card title="Документы">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {available.map(({ type, enabled, hint }) => {
          const existing = docs.data?.find((d) => d.doc_type === type);
          return enabled ? (
            <Link
              key={type}
              to={`/orders/${order.id}/print/${type}`}
              target="_blank"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm hover:border-primary/50"
            >
              <span className="block font-medium">🖨 {DOC_LABELS[type]}</span>
              <span className="block text-xs text-muted">
                {existing ? `создан ${formatDateTime(existing.created_at)}` : "будет создан при печати"}
              </span>
            </Link>
          ) : (
            <div
              key={type}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm opacity-50"
            >
              <span className="block font-medium">🖨 {DOC_LABELS[type]}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        Документ печатается из снимка данных и при повторной печати не меняется. Если заказ
        изменился — откройте печать со свежими данными:{" "}
        {available.filter((a) => a.enabled).map(({ type }, i, arr) => (
          <span key={type}>
            <Link
              to={`/orders/${order.id}/print/${type}?refresh=1`}
              target="_blank"
              className="text-primary hover:underline"
            >
              {DOC_LABELS[type].toLowerCase()}
            </Link>
            {i < arr.length - 1 ? " · " : ""}
          </span>
        ))}
      </p>
    </Card>
  );
}

/* ---------------- Оплата ---------------- */

function PaymentCard({ order, onSaved }: { order: Order; onSaved: () => void }) {
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(order.payment_status);
  const [method, setMethod] = useState<PaymentMethod | "">(order.payment_method ?? "");
  const [prepayment, setPrepayment] = useState(String(order.prepayment));

  const save = useMutation({
    mutationKey: ["update-order"],
    mutationFn: async () => {
      // Предоплата пишется через RPC — событие фиксируется в журнале
      // платежей текущим временем, и попадает в сегодняшнюю выручку.
      await setOrderPrepayment(order.id, Number(prepayment) || 0, method || null);
      await updateOrder(order.id, {
        payment_status: paymentStatus,
        payment_method: method || null,
      });
    },
    onSuccess: onSaved,
  });
  const submitPayment = () => save.mutate();

  return (
    <Card
      title="Оплата"
      actions={<Button variant="secondary" disabled={save.isPending} onClick={submitPayment}>Сохранить</Button>}
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

/* ---------------- Правка клиента ---------------- */

function EditClientModal({ client, onClose, onSaved }: {
  client: Client; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [phone, setPhone] = useState(formatPhone(client.phone_display ?? client.phone));
  const [email, setEmail] = useState(client.email ?? "");
  const [comment, setComment] = useState(client.comment ?? "");

  const save = useMutation({
    mutationFn: () => updateClient(client.id, {
      name: name.trim(),
      phone_display: phone.trim(),
      email: email.trim() || null,
      comment: comment.trim() || null,
    }),
    onSuccess: onSaved,
  });

  return (
    <Modal open onClose={onClose} title="Изменить клиента">
      <div className="space-y-3">
        <Field label="Имя" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Телефон" required>
          <Input value={phone} inputMode="tel" onChange={(e) => setPhone(phoneInput(e.target.value))} />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Комментарий">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <ErrorText error={save.error} />
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!name.trim() || !phone.trim() || save.isPending} onClick={() => save.mutate()}>
            Сохранить
          </Button>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Правка устройства ---------------- */

/* ----------------------- Аппараты и выдача ----------------------- */

const OUTCOME_LABEL: Record<string, string> = { issued: "Выдан", returned: "Возврат без ремонта" };

function DevicesCard({ orderId, devices, orderClosed, onChanged }: {
  orderId: string; devices: OrderDeviceTotals[]; orderClosed: boolean; onChanged: () => void;
}) {
  const multi = devices.length > 1;
  const [add, setAdd] = useState(false);
  const [editDevice, setEditDevice] = useState<OrderDeviceTotals | null>(null);
  const issue = useMutation({
    mutationFn: (v: { id: string; outcome: "issued" | "returned" }) => issueOrderDevice(v.id, v.outcome),
    onSuccess: onChanged,
  });

  return (
    <Card
      title={`Аппараты и выдача${devices.length ? ` · ${devices.length}` : ""}`}
      actions={!orderClosed && (
        <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setAdd(true)}>+ Аппарат</Button>
      )}
    >
      {devices.length === 0 ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          {devices.map((d) => (
            <div key={d.id} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">№{d.position} · {d.device_label}</p>
                  {d.serial_number && <p className="text-xs text-muted">сер. № {d.serial_number}</p>}
                  {d.claimed_defect && <p className="text-xs text-muted">неисправность: {d.claimed_defect}</p>}
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatMoney(d.grand_total)}</p>
                  {d.outcome && (
                    <span className="text-xs font-medium" style={{ color: d.outcome === "issued" ? "#14B8A6" : "#EF4444" }}>
                      {OUTCOME_LABEL[d.outcome]}{d.issued_at ? ` · ${formatDateTime(d.issued_at)}` : ""}
                    </span>
                  )}
                </div>
              </div>
              {!orderClosed && !d.outcome && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    className="px-3 py-1.5 text-xs"
                    disabled={issue.isPending}
                    onClick={() => { if (confirm(`Выдать аппарат №${d.position} клиенту?`)) issue.mutate({ id: d.id, outcome: "issued" }); }}
                  >
                    Выдать
                  </Button>
                  <button
                    onClick={() => setEditDevice(d)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-text"
                  >
                    Изменить
                  </button>
                  <button
                    onClick={() => { if (confirm(`Вернуть аппарат №${d.position} без ремонта?`)) issue.mutate({ id: d.id, outcome: "returned" }); }}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-text"
                  >
                    Вернуть без ремонта
                  </button>
                </div>
              )}
              {multi && (
                <div className="mt-2 flex flex-wrap gap-3 border-t border-border pt-2 text-xs">
                  <Link to={`/orders/${orderId}/print/intake_receipt?device=${d.id}`} target="_blank" className="text-primary hover:underline">🖨 Квитанция</Link>
                  <Link to={`/orders/${orderId}/print/issue_act?device=${d.id}`} target="_blank" className="text-primary hover:underline">🖨 Акт выдачи</Link>
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-muted">
            Заказ закрывается автоматически, когда все аппараты выданы или возвращены.
          </p>
        </div>
      )}
      <ErrorText error={issue.error} />
      {add && <AddDeviceModal orderId={orderId} onClose={() => setAdd(false)} onAdded={() => { setAdd(false); onChanged(); }} />}
      {editDevice && (
        <EditOrderDeviceModal
          orderDevice={editDevice}
          onClose={() => setEditDevice(null)}
          onSaved={() => { setEditDevice(null); onChanged(); }}
        />
      )}
    </Card>
  );
}

/** Правка конкретного аппарата заказа: подгружает устройство и переиспользует
 *  форму спецификаций, добавляя неисправность и гарантию этого аппарата. */
function EditOrderDeviceModal({ orderDevice, onClose, onSaved }: {
  orderDevice: OrderDeviceTotals; onClose: () => void; onSaved: () => void;
}) {
  const device = useQuery({ queryKey: ["device", orderDevice.device_id], queryFn: () => fetchDevice(orderDevice.device_id) });
  if (device.isLoading || !device.data) {
    return <Modal open onClose={onClose} title="Изменить аппарат"><Spinner /></Modal>;
  }
  return <EditDeviceModal device={device.data} orderDevice={orderDevice} onClose={onClose} onSaved={onSaved} />;
}

function AddDeviceModal({ orderId, onClose, onAdded }: {
  orderId: string; onClose: () => void; onAdded: () => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [brandName, setBrandName] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelName, setModelName] = useState("");
  const [serial, setSerial] = useState("");
  const [completeness, setCompleteness] = useState("");
  const [appearance, setAppearance] = useState("");
  const [warranty, setWarranty] = useState(false);
  const [defect, setDefect] = useState("");

  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 60_000 });
  const brands = useQuery({ queryKey: ["brands-search", brandName], queryFn: () => searchBrands(brandName), staleTime: 30_000 });
  const models = useQuery({
    queryKey: ["models-search", categoryId, brandId, modelName],
    queryFn: () => searchModels(categoryId, brandId, modelName),
    enabled: !!categoryId && !!brandId,
  });

  const save = useMutation({
    mutationFn: async () => {
      let finalBrandId = brandId;
      let finalModelId = modelId;
      const typedBrand = brandName.trim();
      const typedModel = modelName.trim();
      if (typedBrand && !finalBrandId) {
        const r = await quickAddModel(categoryId, typedBrand, typedModel || typedBrand);
        finalBrandId = r.brand_id;
        finalModelId = typedModel ? r.model_id : null;
      }
      const device: DevicePayload = {
        category_id: categoryId,
        brand_id: finalBrandId,
        model_id: finalModelId,
        serial_number: serial.trim() || null,
        completeness: completeness.trim() || null,
        appearance: appearance.trim() || null,
        is_warranty_case: warranty,
      };
      return addOrderDevice(orderId, device, defect.trim());
    },
    onSuccess: onAdded,
  });

  const canSave = !!categoryId && (!!brandId || !!brandName.trim()) && !!defect.trim();

  return (
    <Modal open onClose={onClose} title="Добавить аппарат в заказ">
      <div className="space-y-3">
        <Field label="Категория" required>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— выберите —</option>
            {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Бренд" required>
          <Input
            placeholder="Начните вводить…"
            value={brandName}
            onChange={(e) => { setBrandName(e.target.value); setBrandId(""); setModelId(null); }}
          />
          {brandName.trim() && !brandId && (brands.data ?? []).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {(brands.data ?? []).slice(0, 6).map((b) => (
                <button key={b.id} onClick={() => { setBrandId(b.id); setBrandName(b.name); }}
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">{b.name}</button>
              ))}
            </div>
          )}
        </Field>
        <Field label="Модель">
          <Input
            placeholder="Модель (необязательно)"
            value={modelName}
            onChange={(e) => { setModelName(e.target.value); setModelId(null); }}
          />
          {categoryId && brandId && modelName.trim() && !modelId && (models.data ?? []).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {(models.data ?? []).slice(0, 6).map((m) => (
                <button key={m.id} onClick={() => { setModelId(m.id); setModelName(m.name); }}
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">{m.name}</button>
              ))}
            </div>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Серийный №"><Input value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
          <Field label="Комплектация"><Input value={completeness} onChange={(e) => setCompleteness(e.target.value)} /></Field>
        </div>
        <Field label="Внешнее состояние"><Input value={appearance} onChange={(e) => setAppearance(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} />
          Гарантийный случай
        </label>
        <Field label="Неисправность со слов клиента" required>
          <Textarea value={defect} onChange={(e) => setDefect(e.target.value)} />
        </Field>
        <ErrorText error={save.error} />
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Добавление…" : "Добавить аппарат"}
          </Button>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditDeviceModal({ device, orderDevice, onClose, onSaved }: {
  device: Device; orderDevice?: OrderDeviceTotals; onClose: () => void; onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState(device.category_id);
  const [categoryName, setCategoryName] = useState("");
  const [brandId, setBrandId] = useState(device.brand_id);
  const [modelId, setModelId] = useState<string | null>(device.model_id);
  const [brandName, setBrandName] = useState("");
  const [modelName, setModelName] = useState("");
  const [serial, setSerial] = useState(device.serial_number ?? "");
  const [completeness, setCompleteness] = useState(device.completeness ?? "");
  const [appearance, setAppearance] = useState(device.appearance ?? "");
  const [warranty, setWarranty] = useState(device.is_warranty_case);
  const [defect, setDefect] = useState(orderDevice?.claimed_defect ?? "");
  const [warrantyDays, setWarrantyDays] = useState(orderDevice?.warranty_days != null ? String(orderDevice.warranty_days) : "");

  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 60_000 });
  const brands = useQuery({
    queryKey: ["brands-search", brandName],
    queryFn: () => searchBrands(brandName),
    staleTime: 30_000,
  });
  const models = useQuery({
    queryKey: ["models-search", categoryId, brandId, modelName],
    queryFn: () => searchModels(categoryId, brandId, modelName),
    enabled: !!categoryId,
  });

  // Подставить текущие имена в поля ввода при открытии — чтобы было видно, что выбрано
  useEffect(() => {
    const cur = (categories.data ?? []).find((c) => c.id === device.category_id);
    if (cur) setCategoryName(cur.name);
  }, [categories.data, device.category_id]);
  useEffect(() => {
    void (async () => {
      const b = await searchBrands("");
      const cur = b.find((x) => x.id === device.brand_id);
      if (cur) setBrandName(cur.name);
    })();
  }, [device.brand_id]);

  const save = useMutation({
    mutationFn: async () => {
      // Категория введена вручную — либо подбираем существующую, либо создаём.
      let finalCategoryId = categoryId;
      const typedCat = categoryName.trim();
      if (!finalCategoryId && typedCat) {
        const exact = (categories.data ?? []).find((c) => c.name.trim().toLowerCase() === typedCat.toLowerCase());
        finalCategoryId = exact ? exact.id : (await addCategory(typedCat)).id;
      }

      let finalBrandId = brandId;
      let finalModelId = modelId;
      const typedBrand = brandName.trim();
      const typedModel = modelName.trim();
      const modelMatch = models.data?.find((m) => m.name.toLowerCase() === typedModel.toLowerCase());

      if (typedBrand && !finalBrandId) {
        // Бренд введён вручную и не выбран из списка — создаём бренд (и модель, если введена).
        // Без этого при пустой модели в brand_id уходила пустая строка → ошибка uuid.
        const added = await quickAddModel(finalCategoryId, typedBrand, typedModel || typedBrand);
        finalBrandId = added.brand_id;
        finalModelId = typedModel ? added.model_id : null;
      } else if (finalBrandId && typedModel && !modelMatch) {
        // Бренд известен, модель введена вручную и её нет в справочнике — создаём модель.
        const added = await quickAddModel(finalCategoryId, typedBrand || brandName, typedModel);
        finalBrandId = added.brand_id;
        finalModelId = added.model_id;
      }

      await updateDevice(device.id, {
        category_id: finalCategoryId || device.category_id,
        brand_id: finalBrandId || device.brand_id,
        model_id: finalModelId || null,
        serial_number: serial.trim() || null,
        completeness: completeness.trim() || null,
        appearance: appearance.trim() || null,
        is_warranty_case: warranty,
      });
      // Если редактируем конкретный аппарат заказа — пишем его неисправность и гарантию.
      if (orderDevice) {
        await updateOrderDevice(orderDevice.id, {
          claimed_defect: defect.trim() || null,
          warranty_days: warrantyDays.trim() ? Number(warrantyDays) : null,
        });
      }
    },
    onSuccess: onSaved,
  });

  return (
    <Modal open onClose={onClose} title="Изменить устройство">
      <div className="space-y-3">
        <Field label="Категория" required>
          <Input
            placeholder="Начните вводить…"
            value={categoryName}
            onChange={(e) => {
              setCategoryName(e.target.value);
              setCategoryId("");
              setModelId(null);
              setModelName("");
            }}
          />
          {(() => {
            const q = categoryName.trim().toLowerCase();
            if (!q || categoryId) return null;
            const matches = (categories.data ?? []).filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
            if (matches.length === 0) return (
              <p className="mt-1 text-xs text-muted">Категория «{categoryName.trim()}» добавится в справочник при сохранении.</p>
            );
            return (
              <div className="mt-1 flex flex-wrap gap-1">
                {matches.map((c) => (
                  <button type="button" key={c.id} onClick={() => { setCategoryId(c.id); setCategoryName(c.name); }}
                    className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-2">{c.name}</button>
                ))}
              </div>
            );
          })()}
        </Field>

        <Field label="Бренд" required>
          <Input
            value={brandName}
            placeholder="Начните вводить…"
            onChange={(e) => { setBrandName(e.target.value); setBrandId(""); setModelId(null); }}
            list="device-brands"
          />
          <datalist id="device-brands">
            {(brands.data ?? []).map((b) => <option key={b.id} value={b.name} />)}
          </datalist>
          <p className="mt-1 text-xs text-muted">Если бренда нет в списке — введите своё название, оно добавится.</p>
        </Field>

        <Field label="Модель">
          <Input
            value={modelName}
            placeholder="Опционально"
            onChange={(e) => { setModelName(e.target.value); setModelId(null); }}
            list="device-models"
          />
          <datalist id="device-models">
            {(models.data ?? []).map((m) => <option key={m.id} value={m.name} />)}
          </datalist>
        </Field>

        <Field label="Серийный номер">
          <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
        </Field>
        <Field label="Комплектация">
          <Textarea value={completeness} onChange={(e) => setCompleteness(e.target.value)} />
        </Field>
        <Field label="Внешнее состояние">
          <Textarea value={appearance} onChange={(e) => setAppearance(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} className="h-4 w-4" />
          Гарантийный случай
        </label>
        {orderDevice && (
          <>
            <Field label="Заявленная неисправность">
              <Textarea value={defect} onChange={(e) => setDefect(e.target.value)} />
            </Field>
            <Field label="Гарантия на ремонт, дней">
              <Input type="number" inputMode="numeric" min={0} value={warrantyDays} onChange={(e) => setWarrantyDays(e.target.value)} />
            </Field>
          </>
        )}
        <ErrorText error={save.error} />
        <div className="flex gap-2">
          <Button className="flex-1" disabled={save.isPending || !(categoryId || categoryName.trim()) || !brandName.trim()} onClick={() => save.mutate()}>
            {save.isPending ? "Сохранение…" : "Сохранить"}
          </Button>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
        </div>
      </div>
    </Modal>
  );
}
