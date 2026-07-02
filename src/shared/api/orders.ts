import { supabase, throwIfError } from "./supabase";
import type {
  HistoryRow, Order, OrderItem, OrderListRow, PaymentMethod, SearchResult, Status, Transition,
} from "./types";

export interface OrderFilters {
  status?: string;
  statusNotIn?: string[];
  master_id?: string;
  manager_id?: string;
  category_id?: string;
  brand_id?: string;
  client_id?: string;
  date_from?: string;
  date_to?: string;
  issued_from?: string;
  issued_to?: string;
}

export async function fetchOrderList(
  filters: OrderFilters,
  page = 0,
  pageSize = 25,
): Promise<{ rows: OrderListRow[]; count: number }> {
  let q = supabase
    .from("order_list")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  if (filters.status) q = q.eq("status", filters.status);
  if (filters.statusNotIn?.length) q = q.not("status", "in", `(${filters.statusNotIn.join(",")})`);
  if (filters.master_id) q = q.eq("master_id", filters.master_id);
  if (filters.manager_id) q = q.eq("manager_id", filters.manager_id);
  if (filters.category_id) q = q.eq("category_id", filters.category_id);
  if (filters.brand_id) q = q.eq("brand_id", filters.brand_id);
  if (filters.client_id) q = q.eq("client_id", filters.client_id);
  if (filters.date_from) q = q.gte("accepted_at", filters.date_from);
  if (filters.date_to) q = q.lte("accepted_at", `${filters.date_to}T23:59:59`);
  if (filters.issued_from) q = q.gte("issued_at", filters.issued_from);
  if (filters.issued_to) q = q.lte("issued_at", `${filters.issued_to}T23:59:59`);

  const { data, error, count } = await q;
  throwIfError(error);
  return { rows: (data ?? []) as OrderListRow[], count: count ?? 0 };
}

export async function fetchOrder(id: string): Promise<Order> {
  const { data, error } = await supabase
    .from("orders_with_totals").select("*").eq("id", id).single();
  throwIfError(error);
  return data as Order;
}

export async function fetchOrderItems(orderId: string): Promise<OrderItem[]> {
  const { data, error } = await supabase
    .from("order_items").select("*")
    .eq("order_id", orderId).is("deleted_at", null)
    .order("created_at");
  throwIfError(error);
  return (data ?? []) as OrderItem[];
}

export type NewOrderItem = Omit<OrderItem, "id">;

export async function fetchOrderHistory(orderId: string): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from("order_status_history").select("*")
    .eq("order_id", orderId).order("created_at");
  throwIfError(error);
  return (data ?? []) as HistoryRow[];
}

export async function fetchStatuses(): Promise<Status[]> {
  const { data, error } = await supabase.from("statuses").select("*").order("sort");
  throwIfError(error);
  return (data ?? []) as Status[];
}

export async function fetchTransitions(): Promise<Transition[]> {
  const { data, error } = await supabase.from("status_transitions").select("*");
  throwIfError(error);
  return (data ?? []) as Transition[];
}

export async function changeStatus(orderId: string, to: string, comment: string | null, executor?: string | null): Promise<void> {
  const { error } = await supabase.rpc("change_status", {
    p_order_id: orderId, p_to: to, p_comment: comment, p_executor: executor ?? null,
  });
  throwIfError(error);
}

export interface CreateOrderInput {
  client: { id?: string; name?: string; phone?: string; messenger?: string; email?: string; comment?: string };
  device: {
    category_id: string; brand_id: string; model_id?: string;
    serial_number?: string; completeness?: string; appearance?: string;
    is_warranty_case?: boolean; custom_fields?: Record<string, unknown>;
  };
  order: {
    initial_status?: "new" | "accepted"; master_id?: string; due_date?: string;
    claimed_defect: string; prepayment?: number; warranty_days?: number;
    linked_order_id?: string;
    items?: { item_type: "work" | "part"; name: string; price: number; qty?: number }[];
    // Доп-аппараты того же клиента: заводятся одним заказом (у каждого свой claimed_defect).
    devices?: Array<{
      category_id: string; brand_id: string; model_id?: string | null;
      serial_number?: string | null; completeness?: string | null; appearance?: string | null;
      is_warranty_case?: boolean; custom_fields?: Record<string, unknown>;
      claimed_defect?: string; warranty_days?: number | null;
    }>;
  };
}

export async function createOrder(input: CreateOrderInput): Promise<{ id: string; display_number: string; qr_token: string }> {
  const { data, error } = await supabase.rpc("create_order", {
    p_client: input.client, p_device: input.device, p_order: input.order,
  });
  throwIfError(error);
  return data as { id: string; display_number: string; qr_token: string };
}

export async function updateOrder(id: string, patch: Partial<Order>): Promise<void> {
  const { error } = await supabase.from("orders").update(patch).eq("id", id);
  throwIfError(error);
}

/** Идемпотентно устанавливает сумму предоплаты по заказу.
 *  Событие регистрируется в журнале платежей текущим временем — благодаря
 *  этому предоплата, принятая сегодня, попадает в сегодняшнюю выручку. */
export async function setOrderPrepayment(orderId: string, amount: number, method?: PaymentMethod | null): Promise<void> {
  const { error } = await supabase.rpc("set_order_prepayment", {
    p_order_id: orderId, p_amount: amount, p_method: method ?? null,
  });
  throwIfError(error);
}

export async function addOrderItem(item: Omit<OrderItem, "id">): Promise<void> {
  const { error } = await supabase.from("order_items").insert(item);
  throwIfError(error);
}

export async function deleteOrderItem(id: string): Promise<void> {
  const { error } = await supabase
    .from("order_items").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  throwIfError(error);
}

export async function globalSearch(q: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc("global_search", { p_q: q, p_limit: 10 });
  throwIfError(error);
  return (data ?? []) as SearchResult[];
}
