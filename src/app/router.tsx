import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { Layout } from "./Layout";
import { Button, Spinner } from "@/shared/ui";
import { LoginPage } from "@/features/auth/LoginPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { AnalyticsPage } from "@/features/analytics/AnalyticsPage";
import { OrdersPage } from "@/features/orders/OrdersPage";
import { OrderPage } from "@/features/orders/OrderPage";
import { NewOrderPage } from "@/features/orders/NewOrderPage";
import { ClientsPage } from "@/features/clients/ClientsPage";
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { PrintDocumentPage } from "@/features/orders/PrintDocumentPage";
import { PublicStatusPage } from "@/features/public/PublicStatusPage";
import { ErrorBoundary } from "./ErrorBoundary";

function Protected() {
  const { session, profile, loading, profileLoading, signOut } = useAuth();
  if (loading || (session && profileLoading)) {
    return <Spinner className="min-h-dvh items-center" />;
  }
  if (!session) return <Navigate to="/login" replace />;

  // Сессия есть, но профиля нет: сотрудник деактивирован (RLS не отдаёт
  // строку) либо профиль ещё не создан администратором.
  if (!profile || !profile.is_active) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 rounded-2xl bg-surface border border-border p-6 text-center">
          <p className="text-lg font-semibold">Доступ отключён</p>
          <p className="text-sm text-muted">
            Ваша учётная запись деактивирована или профиль ещё не создан.
            Обратитесь к администратору сервисного центра.
          </p>
          <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
            Выйти
          </Button>
        </div>
      </div>
    );
  }
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/status/:token", element: <PublicStatusPage /> },
  {
    element: <Protected />,
    children: [
      // Печатная форма — без Layout: на бумаге не место сайдбору
      { path: "/orders/:id/print/:docType", element: <ErrorBoundary><PrintDocumentPage /></ErrorBoundary> },
      {
        element: <Layout />,
        children: [
          { path: "/", element: <DashboardPage /> },
          { path: "/analytics", element: <AnalyticsPage /> },
          { path: "/orders", element: <OrdersPage /> },
          { path: "/orders/new", element: <NewOrderPage /> },
          { path: "/orders/:id", element: <OrderPage /> },
          { path: "/clients", element: <ClientsPage /> },
          { path: "/catalog", element: <CatalogPage /> },
          { path: "/settings", element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
