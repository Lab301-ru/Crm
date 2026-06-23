import { supabase, throwIfError } from "./supabase";
import type {
  AnalyticsSeriesPoint, AnalyticsStats, Expense, ExpenseCategory, FinanceOverview,
} from "./types";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  parts: "Запчасти",
  salary: "Зарплаты",
  rent: "Аренда",
  ads: "Реклама",
  courier: "Курьер",
  outsource: "Аутсорс",
  digital: "Цифровые услуги",
  other: "Прочее",
};

export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

export async function fetchAnalyticsStats(period: "all" | "month" | "year"): Promise<AnalyticsStats> {
  const { data, error } = await supabase.rpc("analytics_stats", { p_period: period });
  throwIfError(error);
  return data as AnalyticsStats;
}

export async function fetchAnalyticsSeries(months = 12): Promise<AnalyticsSeriesPoint[]> {
  const { data, error } = await supabase.rpc("analytics_series", { p_months: months });
  throwIfError(error);
  return (data ?? []) as AnalyticsSeriesPoint[];
}

export async function fetchFinanceOverview(
  period: "today" | "month" | "year" | "all",
): Promise<FinanceOverview> {
  const { data, error } = await supabase.rpc("finance_overview", { p_period: period });
  throwIfError(error);
  return data as FinanceOverview;
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  category?: ExpenseCategory;
}

export async function fetchExpenses(filters: ExpenseFilters = {}): Promise<Expense[]> {
  let q = supabase
    .from("expenses")
    .select("*")
    .is("deleted_at", null)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (filters.from) q = q.gte("spent_on", filters.from);
  if (filters.to) q = q.lte("spent_on", filters.to);
  if (filters.category) q = q.eq("category", filters.category);
  const { data, error } = await q;
  throwIfError(error);
  return (data ?? []) as Expense[];
}

export interface NewExpense {
  category: ExpenseCategory;
  amount: number;
  spent_on: string;
  description?: string | null;
  order_id?: string | null;
}

export async function createExpense(expense: NewExpense, createdBy: string): Promise<void> {
  const { error } = await supabase.from("expenses").insert({
    category: expense.category,
    amount: expense.amount,
    spent_on: expense.spent_on,
    description: expense.description || null,
    order_id: expense.order_id || null,
    created_by: createdBy,
  });
  throwIfError(error);
}

export async function softDeleteExpense(id: string, byUserId: string): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .update({ deleted_at: new Date().toISOString(), deleted_by: byUserId })
    .eq("id", id);
  throwIfError(error);
}
