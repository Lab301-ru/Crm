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
  cost_price: number;
}

export type AttachmentKind = "device_photo" | "serial_photo" | "document" | "receipt" | "warranty_doc";

export interface Attachment {
  id: string;
  order_id: string;
  kind: AttachmentKind;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
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
  issued_total: number;
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
  owner_telegram_chat_id: number | null;
  owner_email: string | null;
  owner_notify_channel: "off" | "telegram" | "email";
  owner_notify_events: string[];
  receipt_signer_name: string;
  receipt_signer_signature: string;
}

export type PartStatus = "need_order" | "ordered" | "in_transit" | "received" | "installed";
export type PartFileKind = "screenshot" | "receipt" | "invoice";

export interface OrderPart {
  id: string;
  order_id: string;
  name: string;
  qty: number;
  master_comment: string | null;
  shop_url: string | null;
  cost: number;
  supplier: string | null;
  status: PartStatus;
  screenshot_path: string | null; screenshot_name: string | null;
  receipt_path: string | null;    receipt_name: string | null;
  invoice_path: string | null;    invoice_name: string | null;
  note: string | null;
  ordered_at: string | null;
  received_at: string | null;
  installed_at: string | null;
  created_at: string;
}

/** Строка дашборда закупщика: запчасть + контекст заказа/клиента. */
export interface PartOverviewRow extends OrderPart {
  order_number: string;
  order_status: string;
  order_status_label: string;
  order_status_color: string;
  master_id: string | null;
  client_name: string;
  client_phone: string;
  device_label: string;
}

export type ExpenseCategory =
  | "parts" | "salary" | "rent" | "ads" | "courier" | "outsource" | "digital" | "other";

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amount: number;
  spent_on: string;
  description: string | null;
  order_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AnalyticsStats {
  period: "all" | "month" | "year";
  orders_count: number;
  revenue: number;
  avg_check: number;
  max_check: number;
  top_repairs: { name: string; count: number; sum: number }[];
  top_clients: { client_id: string; name: string; phone: string | null; orders_count: number; total: number }[];
}

export interface AnalyticsSeriesPoint {
  month: string;          // 'YYYY-MM'
  revenue: number;
  profit: number;
  orders_count: number;
  avg_check: number;
}

export interface FinanceOverview {
  period: "today" | "month" | "year" | "all";
  revenue: number;
  expenses: number;
  net_profit: number;
  margin: number;
  expenses_by_category: Partial<Record<ExpenseCategory, number>>;
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
  payload: {
    order_number?: string;
    client_name?: string;
    template?: string;
    status_label?: string;
    due_date?: string | null;
    qr_token?: string;
  };
  status: string;
  created_at: string;
}
