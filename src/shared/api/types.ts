export type Role = "admin" | "manager" | "master";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
}

export interface Status {
  code: string;
  label: string;
  color: string;
  sort: number;
  is_terminal: boolean;
}

export interface Transition {
  from_code: string;
  to_code: string;
}

export interface Category {
  id: string;
  name: string;
  sort: number;
}

export interface Brand {
  id: string;
  name: string;
}

export interface Model {
  id: string;
  category_id: string;
  brand_id: string;
  name: string;
  brands?: { name: string } | null;
}

export type FieldType = "text" | "number" | "select" | "multiselect" | "boolean" | "date";

export interface FieldTemplate {
  id: string;
  category_id: string;
  key: string;
  label: string;
  field_type: FieldType;
  options: string[] | null;
  is_required: boolean;
  sort: number;
  is_active: boolean;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  phone_display: string | null;
  messenger: string | null;
  email: string | null;
  comment: string | null;
  telegram_chat_id: number | null;
  created_at: string;
}

export interface Device {
  id: string;
  category_id: string;
  brand_id: string;
  model_id: string | null;
  serial_number: string | null;
  completeness: string | null;
  appearance: string | null;
  is_warranty_case: boolean;
  custom_fields: Record<string, unknown>;
}

export type PaymentStatus = "unpaid" | "prepaid" | "paid";
export type PaymentMethod = "cash" | "card" | "transfer";

export interface OrderListRow {
  id: string;
  display_number: string;
  status: string;
  status_label: string;
  status_color: string;
  accepted_at: string | null;
  due_date: string | null;
  is_overdue: boolean;
  grand_total: number;
  prepayment: number;
  due_amount: number;
  payment_status: PaymentStatus;
  manager_id: string;
  master_id: string | null;
  created_at: string;
  client_id: string;
  client_name: string;
  client_phone: string;
  category_name: string;
  brand_name: string;
  model_name: string | null;
  device_label: string;
  serial_number: string | null;
  category_id: string;
  brand_id: string;
}

export interface Order {
  id: string;
  number: number;
  display_number: string;
  client_id: string;
  device_id: string;
  status: string;
  manager_id: string;
  master_id: string | null;
  accepted_at: string | null;
  due_date: string | null;
  claimed_defect: string;
  diagnostic_result: string | null;
  master_comment: string | null;
  public_comment: string | null;
  prepayment: number;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  warranty_days: number | null;
  qr_token: string;
  linked_order_id: string | null;
  created_at: string;
  works_total: number;
  parts_total: number;
  grand_total: number;
  due_amount: number;
  is_overdue: boolean;
}

export interface OrderItem {
  id: string;
  order_id: string;
  item_type: "work" | "part";
  name: string;
  price: number;
  qty: number;
}

export interface HistoryRow {
  id: string;
  order_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  comment: string | null;
  created_at: string;
}

export interface SearchResult {
  order_id: string;
  display_number: string;
  client_name: string;
  device_label: string;
  status_code: string;
  status_label: string;
  status_color: string;
  matched: string;
  rank: number;
}

export interface DashboardStats {
  accepted_today: number;
  in_repair: number;
  awaiting_parts: number;
  ready: number;
  issued_today: number;
  revenue_today: number | null;
  revenue_total: number | null;
}

export interface OrgSettings {
  id: number;
  name: string;
  inn: string | null;
  address: string | null;
  phone: string | null;
  working_hours: string | null;
  public_contacts: string | null;
  order_prefix: string;
  default_warranty_days: number;
  receipt_disclaimer: string | null;
  photo_retention_days: number | null;
  timezone: string;
}

export interface NotificationRule {
  id: string;
  event_type: string;
  channel: "telegram" | "email" | "phone_call";
  enabled: boolean;
  template: string;
}

export interface PhoneTask {
  id: string;
  order_id: string;
  event_type: string;
  recipient: string | null;
  payload: { order_number?: string; client_name?: string; template?: string };
  status: string;
  created_at: string;
}
