import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { AuthProvider } from "./app/AuthProvider";
import { router } from "./app/router";
import { changeStatus, saveOrderPayment, updateOrder, type SavePaymentInput } from "./shared/api/orders";
import type { Order } from "./shared/api/types";
import "./index.css";
import "./theme-light.css";

const DAY_MS = 24 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      // сутки в персисте: открытые вчера заказы читаются без сети
      gcTime: DAY_MS,
      refetchOnWindowFocus: false,
    },
  },
});

// Офлайн-очередь: мутации с этими ключами создаются в компонентах,
// но fn задан и здесь — иначе восстановленную из персиста мутацию
// после перезагрузки нечем доотправить.
queryClient.setMutationDefaults(["change-status"], {
  mutationFn: (v: { orderId: string; to: string; comment: string | null }) =>
    changeStatus(v.orderId, v.to, v.comment),
});
queryClient.setMutationDefaults(["update-order"], {
  mutationFn: (v: { orderId: string; patch: Partial<Order> }) => updateOrder(v.orderId, v.patch),
});
queryClient.setMutationDefaults(["update-payment"], {
  mutationFn: (v: SavePaymentInput) => saveOrderPayment(v),
});

export const queryPersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "crm-cache",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister, maxAge: DAY_MS, buster: "v2" }}
      onSuccess={() => {
        // кеш восстановлен: доотправляем отложенное и освежаем данные
        void queryClient.resumePausedMutations().then(() => queryClient.invalidateQueries());
      }}
    >
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
