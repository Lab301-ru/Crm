import { supabase, throwIfError } from "./supabase";
import { fetchOrder, fetchOrderItems } from "./orders";
import { fetchClient } from "./clients";
import { fetchFieldTemplates } from "./catalog";
import { fetchOrgSettings, fetchProfiles } from "./settings";
import type { PaymentMethod, PaymentStatus } from "./types";

export type DocType = "intake_receipt" | "work_act" | "issue_act" | "warranty_card";

export const DOC_LABELS: Record<DocType, string> = {
  intake_receipt: "Квитанция о приёме в ремонт",
  work_act: "Акт выполненных работ + гарантийный талон",
  issue_act: "Акт выдачи устройства",
  warranty_card: "Гарантийный талон",
};

/**
 * Снимок заказа на момент создания документа. Документ печатается
 * только из снимка: повторная печать квитанции через месяц даст
 * тот же текст, даже если заказ, клиент или прайс изменились.
 */
export interface DocSnapshot {
  doc_type: DocType;
  generated_at: string;
  org: {
    name: string;
    inn: string | null;
    address: string | null;
    phone: string | null;
    working_hours: string | null;
    receipt_disclaimer: string | null;
    default_warranty_days: number;
    signer_name: string;
    signer_signature: string;
  };
  order: {
    display_number: string;
    status: string;
    accepted_at: string | null;
    due_date: string | null;
    claimed_defect: string;
    diagnostic_result: string | null;
    public_comment: string | null;
    prepayment: number;
    works_total: number;
    parts_total: number;
    grand_total: number;
    due_amount: number;
    payment_status: PaymentStatus;
    payment_method: PaymentMethod | null;
    warranty_days: number | null;
    qr_token: string;
  };
  client: { name: string; phone: string; email: string | null };
  device: {
    label: string;
    serial_number: string | null;
    completeness: string | null;
    appearance: string | null;
    is_warranty_case: boolean;
    custom_fields: { label: string; value: string }[];
  };
  items: { item_type: "work" | "part"; name: string; price: number; qty: number }[];
  manager_name: string | null;
  master_name: string | null;
}

export interface OrderDocument {
  id: string;
  order_id: string;
  doc_type: DocType;
  snapshot: DocSnapshot;
  created_by: string | null;
  created_at: string;
}

export async function fetchOrderDocuments(orderId: string): Promise<OrderDocument[]> {
  const { data, error } = await supabase
    .from("order_documents")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as OrderDocument[];
}

async function fetchDocumentById(id: string): Promise<OrderDocument> {
  const { data, error } = await supabase.from("order_documents").select("*").eq("id", id).single();
  throwIfError(error);
  return data as OrderDocument;
}

async function buildSnapshot(orderId: string, docType: DocType): Promise<DocSnapshot> {
  const order = await fetchOrder(orderId);
  const [items, client, org, profiles, deviceRes] = await Promise.all([
    fetchOrderItems(orderId),
    fetchClient(order.client_id),
    fetchOrgSettings(),
    fetchProfiles(),
    supabase
      .from("devices")
      .select("*, categories(name), brands(name), models(name)")
      .eq("id", order.device_id)
      .single(),
  ]);
  throwIfError(deviceRes.error);
  const device = deviceRes.data as {
    category_id: string;
    serial_number: string | null;
    completeness: string | null;
    appearance: string | null;
    is_warranty_case: boolean;
    custom_fields: Record<string, unknown>;
    categories: { name: string } | null;
    brands: { name: string } | null;
    models: { name: string } | null;
  };
  const templates = await fetchFieldTemplates(device.category_id);

  const byId = new Map(profiles.map((p) => [p.id, p.full_name]));
  return {
    doc_type: docType,
    generated_at: new Date().toISOString(),
    org: {
      name: org.name,
      inn: org.inn,
      address: org.address,
      phone: org.phone,
      working_hours: org.working_hours,
      receipt_disclaimer: org.receipt_disclaimer,
      default_warranty_days: org.default_warranty_days,
      signer_name: org.receipt_signer_name,
      signer_signature: org.receipt_signer_signature,
    },
    order: {
      display_number: order.display_number,
      status: order.status,
      accepted_at: order.accepted_at,
      due_date: order.due_date,
      claimed_defect: order.claimed_defect,
      diagnostic_result: order.diagnostic_result,
      public_comment: order.public_comment,
      prepayment: order.prepayment,
      works_total: order.works_total,
      parts_total: order.parts_total,
      grand_total: order.grand_total,
      due_amount: order.due_amount,
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      warranty_days: order.warranty_days,
      qr_token: order.qr_token,
    },
    client: {
      name: client.name,
      phone: client.phone_display ?? client.phone,
      email: client.email,
    },
    device: {
      label: [device.categories?.name, device.brands?.name, device.models?.name]
        .filter(Boolean)
        .join(" "),
      serial_number: device.serial_number,
      completeness: device.completeness,
      appearance: device.appearance,
      is_warranty_case: device.is_warranty_case,
      custom_fields: templates
        .filter((t) => device.custom_fields[t.key] != null && device.custom_fields[t.key] !== "")
        .map((t) => ({
          label: t.label,
          value: Array.isArray(device.custom_fields[t.key])
            ? (device.custom_fields[t.key] as string[]).join(", ")
            : String(device.custom_fields[t.key]),
        })),
    },
    items: items.map((i) => ({ item_type: i.item_type, name: i.name, price: i.price, qty: i.qty })),
    manager_name: byId.get(order.manager_id) ?? null,
    master_name: order.master_id ? (byId.get(order.master_id) ?? null) : null,
  };
}

/**
 * Документ для печати: конкретный по id, иначе последний этого типа,
 * иначе (или при refresh) — новый снимок с актуальными данными заказа.
 */
export async function getPrintDocument(
  orderId: string,
  docType: DocType,
  opts: { docId?: string; refresh?: boolean; createdBy: string },
): Promise<OrderDocument> {
  if (opts.docId) return fetchDocumentById(opts.docId);

  if (!opts.refresh) {
    const { data, error } = await supabase
      .from("order_documents")
      .select("*")
      .eq("order_id", orderId)
      .eq("doc_type", docType)
      .order("created_at", { ascending: false })
      .limit(1);
    throwIfError(error);
    if (data && data.length > 0) return data[0] as OrderDocument;
  }

  const snapshot = await buildSnapshot(orderId, docType);
  const { data, error } = await supabase
    .from("order_documents")
    .insert({ order_id: orderId, doc_type: docType, snapshot, created_by: opts.createdBy })
    .select("*")
    .single();
  throwIfError(error);
  return data as OrderDocument;
}
