import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png", "icons/icon.svg"],
      manifest: {
        name: "CRM сервисного центра",
        short_name: "СЦ CRM",
        description: "Приёмка, ремонт и выдача устройств: заказы, клиенты, статусы, документы",
        lang: "ru",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0b0f17",
        theme_color: "#0b0f17",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Кешируем только оболочку приложения (app shell). Данные Supabase
        // service worker не трогает: офлайн-чтение и очередь мутаций живут
        // в персистентном кеше React Query — там есть инвалидация и роли.
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
