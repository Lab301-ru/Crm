import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPartsOverview, PART_STATUS_COLORS, PART_STATUS_LABELS,
  PART_STATUSES_ORDER, updatePart,
} from "@/shared/api/parts";
import { fetchProfiles } from "@/shared/api/settings";
import type { PartOverviewRow, PartStatus } from "@/shared/api/types";
import { formatDate, formatMoney, formatPhone } from "@/shared/lib/format";
import { Card, EmptyState, ErrorText, Input, Select, Spinner, StatusBadge } from "@/shared/ui";
import { PartFiles } from "./PartFiles";

const DEFAULT_STATUSES: PartStatus[] = ["need_order", "ordered", "in_transit"];

/**
 * Дашборд закупщика «Запчасти».
 * Назначение: ежедневный обзор — какую запчасть на какой заказ нужно
 * заказать и где, что мастер уже купил сам (с чеками и накладными).
 * По умолчанию показываются «активные» закупки: нужно заказать,
 * заказана, в пути. Установленные/полученные — по фильтру.
 */
export function PartsPage() {
  const [statuses, setStatuses] = useState<PartStatus[]>(DEFAULT_STATUSES);
  const [q, setQ] = useState("");
  const [masterId, setMasterId] = useState<string>("");

  const queryClient = useQueryClient();
  const rows = useQuery({
    queryKey: ["parts-overview", statuses, q, masterId],
    queryFn: () => fetchPartsOverview({ statuses, q: q || undefined, masterId: masterId || undefined }),
  });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles, staleTime: 300_000 });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["parts-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["order-parts"] });
  };

  // Группировка по заказу для удобного просмотра «что заказать по этому заказу»
  const grouped = useMemo(() => {
    const map = new Map<string, { row: PartOverviewRow; parts: PartOverviewRow[] }>();
    for (const p of rows.data ?? []) {
      const entry = map.get(p.order_id);
      if (entry) entry.parts.push(p);
      else map.set(p.order_id, { row: p, parts: [p] });
    }
    return Array.from(map.values());
  }, [rows.data]);

  const counts = useMemo(() => {
    const c: Record<PartStatus, number> = { need_order: 0, ordered: 0, in_transit: 0, received: 0, installed: 0 };
    for (const p of rows.data ?? []) c[p.status]++;
    return c;
  }, [rows.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Запчасти</h1>
        <p className="text-xs text-muted">Дашборд закупщика — что заказать и где, чеки, накладные</p>
      </div>

      {/* Фильтр по статусам — табы с лайв-счётчиками */}
      <div className="flex flex-wrap items-center gap-2">
        {PART_STATUSES_ORDER.map((s) => {
          const on = statuses.includes(s);
          const color = PART_STATUS_COLORS[s];
          return (
            <button
              key={s}
              onClick={() => setStatuses(on ? statuses.filter((x) => x !== s) : [...statuses, s])}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                color: on ? "#fff" : color,
                backgroundColor: on ? color : `${color}1a`,
                borderColor: on ? color : `${color}55`,
              }}
            >
              {PART_STATUS_LABELS[s]}
              <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">{counts[s]}</span>
            </button>
          );
        })}
      </div>

      {/* Поиск + фильтр по мастеру */}
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-60 flex-1"
          placeholder="Поиск: запчасть, поставщик, номер заказа, клиент…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="w-56" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
          <option value="">Все мастера</option>
          {(profiles.data ?? []).filter((p) => p.role === "master").map((p) => (
            <option key={p.id} value={p.id}>{p.full_name}</option>
          ))}
        </Select>
      </div>

      {rows.isLoading ? <Spinner /> :
       rows.error ? <ErrorText error={rows.error} /> :
       grouped.length === 0 ? (
        <Card>
          <EmptyState text="По текущим фильтрам запчастей нет" />
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ row, parts }) => (
            <OrderGroup key={row.order_id} head={row} parts={parts} onChanged={invalidate} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Группа по заказу ----------------------------- */

function OrderGroup({ head, parts, onChanged }: {
  head: PartOverviewRow; parts: PartOverviewRow[]; onChanged: () => void;
}) {
  const totalCost = parts.reduce((s, p) => s + p.cost * p.qty, 0);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/orders/${head.order_id}`} className="font-semibold text-primary hover:underline">
            {head.order_number}
          </Link>
          <span className="ml-2"><StatusBadge label={head.order_status_label} color={head.order_status_color} /></span>
          <p className="text-xs text-muted">
            {head.client_name} · <a href={`tel:${head.client_phone}`} className="hover:underline">{formatPhone(head.client_phone)}</a>
            {" · "}{head.device_label}
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          {parts.length} {plural(parts.length, "позиция", "позиции", "позиций")} · итого {formatMoney(totalCost)}
        </div>
      </div>

      <div className="space-y-2">
        {parts.map((p) => <PartLine key={p.id} part={p} onChanged={onChanged} />)}
      </div>
    </Card>
  );
}

/* ----------------------------- Строка запчасти в дашборде ----------------------------- */

function PartLine({ part, onChanged }: { part: PartOverviewRow; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const setStatus = useMutation({
    mutationFn: (status: PartStatus) => updatePart(part.id, { status }),
    onSuccess: onChanged,
  });
  const color = PART_STATUS_COLORS[part.status];

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="min-w-0">
          <p className="font-medium">
            {part.name}
            {part.qty !== 1 && <span className="text-xs text-muted"> × {part.qty}</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatMoney(part.cost * part.qty)}
            {part.supplier && <> · поставщик: <span className="text-text">{part.supplier}</span></>}
            {part.shop_url && (
              <>
                {" · "}
                <a href={part.shop_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  магазин ↗
                </a>
              </>
            )}
          </p>
          {part.master_comment && (
            <p className="mt-1 text-xs italic text-muted">мастер: «{part.master_comment}»</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={part.status}
            onChange={(e) => setStatus.mutate(e.target.value as PartStatus)}
            className="w-44"
            style={{ color, borderColor: `${color}99` }}
          >
            {PART_STATUSES_ORDER.map((s) => (
              <option key={s} value={s}>{PART_STATUS_LABELS[s]}</option>
            ))}
          </Select>
          <button onClick={() => setExpanded(!expanded)} className="text-sm font-medium text-primary hover:underline">
            {expanded ? "скрыть файлы" : "файлы"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <PartFiles part={part} closed={false} onChanged={onChanged} />
          {(part.ordered_at || part.received_at || part.installed_at) && (
            <p className="pt-1 text-xs text-muted">
              {part.ordered_at && <>заказана: {formatDate(part.ordered_at)} · </>}
              {part.received_at && <>получена: {formatDate(part.received_at)} · </>}
              {part.installed_at && <>установлена: {formatDate(part.installed_at)}</>}
            </p>
          )}
        </div>
      )}
      <ErrorText error={setStatus.error} />
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
