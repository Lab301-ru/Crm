import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchOrderList, fetchStatuses, globalSearch, type OrderFilters } from "@/shared/api/orders";
import { fetchProfiles } from "@/shared/api/settings";
import { fetchCategories } from "@/shared/api/catalog";
import { Button, EmptyState, Input, Select, Spinner, StatusBadge } from "@/shared/ui";
import { OrdersTable } from "./OrdersTable";
import { useDebounced } from "@/shared/lib/useDebounced";

const PAGE_SIZE = 25;

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);

  const filters: OrderFilters = {
    status: params.get("status") ?? undefined,
    master_id: params.get("master") ?? undefined,
    manager_id: params.get("manager") ?? undefined,
    category_id: params.get("category") ?? undefined,
    date_from: params.get("from") ?? undefined,
    date_to: params.get("to") ?? undefined,
    client_id: params.get("client") ?? undefined,
    issued_from: params.get("issued_from") ?? undefined,
    issued_to: params.get("issued_to") ?? undefined,
  };

  const issuedActive = filters.issued_from || filters.issued_to;
  const clearIssued = () => {
    setPage(0);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("issued_from"); next.delete("issued_to");
      return next;
    });
  };

  const acceptedActive = filters.date_from || filters.date_to;
  const clearAccepted = () => {
    setPage(0);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("from"); next.delete("to");
      return next;
    });
  };

  const setFilter = (key: string, value: string) => {
    setPage(0);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  const statuses = useQuery({ queryKey: ["statuses"], queryFn: fetchStatuses, staleTime: Infinity });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles, staleTime: 300_000 });
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 300_000 });
  const orders = useQuery({
    queryKey: ["orders", filters, page],
    queryFn: () => fetchOrderList(filters, page, PAGE_SIZE),
  });
  const searchResults = useQuery({
    queryKey: ["search", debouncedSearch],
    queryFn: () => globalSearch(debouncedSearch),
    enabled: debouncedSearch.trim().length >= 2,
  });

  const masters = profiles.data?.filter((p) => p.role !== "manager") ?? [];
  const managers = profiles.data?.filter((p) => p.role !== "master") ?? [];
  const totalPages = Math.ceil((orders.data?.count ?? 0) / PAGE_SIZE);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">Заказы</h1>
        <Link to="/orders/new">
          <Button>+ Новый заказ</Button>
        </Link>
      </div>

      {issuedActive && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
          <span>
            Выданы за период
            {filters.issued_from && filters.issued_to && filters.issued_from === filters.issued_to
              ? `: ${filters.issued_from}`
              : `: ${filters.issued_from ?? "…"} — ${filters.issued_to ?? "…"}`}
          </span>
          <button onClick={clearIssued} className="ml-auto text-muted hover:text-text" aria-label="Сбросить">✕</button>
        </div>
      )}

      {acceptedActive && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
          <span>
            Приняты за период
            {filters.date_from && filters.date_to && filters.date_from === filters.date_to
              ? `: ${filters.date_from}`
              : `: ${filters.date_from ?? "…"} — ${filters.date_to ?? "…"}`}
          </span>
          <button onClick={clearAccepted} className="ml-auto text-muted hover:text-text" aria-label="Сбросить">✕</button>
        </div>
      )}

      {/* Поиск: номер, телефон, имя, серийник, IMEI, бренд, модель */}
      <div className="relative">
        <Input
          placeholder="Поиск: № заказа, телефон, клиент, серийник, IMEI, модель…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {debouncedSearch.trim().length >= 2 && searchResults.data && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
            {searchResults.data.length === 0 ? (
              <p className="p-3 text-sm text-muted">Ничего не найдено</p>
            ) : (
              searchResults.data.map((r) => (
                <Link
                  key={r.order_id}
                  to={`/orders/${r.order_id}`}
                  onClick={() => setSearch("")}
                  className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 last:border-0 hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {r.display_number} <span className="font-normal text-muted">· {r.client_name}</span>
                    </p>
                    <p className="truncate text-xs text-muted">{r.device_label} · найдено по: {r.matched}</p>
                  </div>
                  <StatusBadge label={r.status_label} color={r.status_color} />
                </Link>
              ))
            )}
          </div>
        )}
      </div>

      {/* Статусы-чипы (как в Workpan) */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setFilter("status", "")}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${!filters.status ? "border-primary bg-primary/15 text-primary" : "border-border bg-surface text-muted hover:text-text"}`}
        >
          Все
        </button>
        {statuses.data?.map((s) => (
          <button
            key={s.code}
            onClick={() => setFilter("status", filters.status === s.code ? "" : s.code)}
            className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={
              filters.status === s.code
                ? { color: s.color, backgroundColor: `${s.color}1f`, borderColor: s.color }
                : { color: "var(--color-muted)", borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Фильтры */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Select value={filters.master_id ?? ""} onChange={(e) => setFilter("master", e.target.value)}>
          <option value="">Мастер: все</option>
          {masters.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </Select>
        <Select value={filters.manager_id ?? ""} onChange={(e) => setFilter("manager", e.target.value)}>
          <option value="">Менеджер: все</option>
          {managers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </Select>
        <Select value={filters.category_id ?? ""} onChange={(e) => setFilter("category", e.target.value)}>
          <option value="">Категория: все</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Дата приёма: с
          <Input type="date" value={params.get("from") ?? ""} onChange={(e) => setFilter("from", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Дата приёма: по
          <Input type="date" value={params.get("to") ?? ""} onChange={(e) => setFilter("to", e.target.value)} />
        </label>
      </div>

      {/* Список */}
      {orders.isLoading ? (
        <Spinner />
      ) : orders.data && orders.data.rows.length > 0 ? (
        <>
          <OrdersTable rows={orders.data.rows} />
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted">
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>← Назад</Button>
              <span>Стр. {page + 1} из {totalPages} · всего {orders.data.count}</span>
              <Button variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>Вперёд →</Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState text="Заказы не найдены — измените фильтры или создайте новый" />
      )}
    </div>
  );
}
