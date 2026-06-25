import { supabase, throwIfError } from "./supabase";
import type { OrderDeviceTotals } from "./types";

/** Описание аппарата для create_order / add_order_device. */
export interface DevicePayload {
  category_id: string;
  brand_id: string;
  model_id?: string | null;
  serial_number?: string | null;
  completeness?: string | null;
  appearance?: string | null;
  is_warranty_case?: boolean;
  custom_fields?: Record<string, unknown>;
  claimed_defect?: string;
  warranty_days?: number | null;
}

export async function fetchOrderDevices(orderId: string): Promise<OrderDeviceTotals[]> {
  const { data, error } = await supabase
    .from("order_device_totals").select("*")
    .eq("order_id", orderId)
    .order("position");
  throwIfError(error);
  return (data ?? []) as OrderDeviceTotals[];
}

export async function addOrderDevice(orderId: string, device: DevicePayload, defect: string): Promise<string> {
  const { data, error } = await supabase.rpc("add_order_device", {
    p_order_id: orderId,
    p_device: device,
    p_defect: defect || null,
  });
  throwIfError(error);
  return data as string;
}

/** Правка полей аппарата в заказе (неисправность, гарантия, диагноз, комментарий). */
export async function updateOrderDevice(
  orderDeviceId: string,
  patch: { claimed_defect?: string | null; warranty_days?: number | null; diagnostic_result?: string | null; master_comment?: string | null },
): Promise<void> {
  const { error } = await supabase.from("order_devices").update(patch).eq("id", orderDeviceId);
  throwIfError(error);
}

/** Выдать (issued) или вернуть без ремонта (returned) аппарат.
 *  Когда все аппараты заказа обработаны — заказ закрывается автоматически. */
export async function issueOrderDevice(
  orderDeviceId: string,
  outcome: "issued" | "returned" = "issued",
  comment?: string | null,
): Promise<{ finalized: boolean; done: number; total: number }> {
  const { data, error } = await supabase.rpc("issue_order_device", {
    p_order_device_id: orderDeviceId,
    p_outcome: outcome,
    p_comment: comment ?? null,
  });
  throwIfError(error);
  return data as { finalized: boolean; done: number; total: number };
}
