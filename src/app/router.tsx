import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { Layout } from "./Layout";
import { Spinner } from "@/shared/ui";
import { LoginPage } from "@/features/auth/LoginPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { OrdersPage } from "@/features/orders/OrdersPage";
import { OrderPage } from "@/features/orders/OrderPage";
import { NewOrderPage } from "@/features/orders/NewOrderPage";
import { ClientsPage } from "@/features/clients/ClientsPage";
import { CatalogPage } from "@/features/catalog/CatalogPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { PublicStatusPage } from "@/features/public/PublicStatusPage";

function Protected() {
  const { session, loading } = useAuth();
  if (loading) return <Spinner className="min-h-dvh items-center" />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/status/:token", element: <PublicStatusPage /> },
  {
    element: <Protected />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: "/", element: <DashboardPage /> },
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
