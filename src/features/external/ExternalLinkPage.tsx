import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchOrgSettings } from "@/shared/api/settings";
import type { OrgSettings } from "@/shared/api/types";
import { Button, Card, ErrorText, Spinner } from "@/shared/ui";

type UrlKey = keyof Pick<
  OrgSettings,
  | "website_admin_url" | "cctv_url" | "telephony_url"
  | "map_2gis_url" | "map_yandex_url"
  | "messenger_telegram_url" | "messenger_whatsapp_url"
  | "invoice_schet_url" | "invoice_akt_url" | "invoice_kp_url"
>;

interface SubLink { label: string; urlKey: UrlKey }

interface Props {
  title: string;
  iconPath: string;
  links: SubLink[];
  hint: string;
}

/** Универсальная страница «открыть внешний сервис».
 *  Берёт URL(ы) из org_settings. Несколько ссылок → переключатель-вкладки.
 *  Всегда показывает кнопку «Открыть в новой вкладке» — большинство сторонних
 *  сервисов блокируют встраивание (X-Frame-Options/CSP), и iframe будет пустым. */
export function ExternalHubPage({ title, iconPath, links, hint }: Props) {
  const settings = useQuery({ queryKey: ["org-settings"], queryFn: fetchOrgSettings });
  const [active, setActive] = useState(0);

  if (settings.isLoading) return <Spinner className="pt-20" />;
  if (settings.error) return <ErrorText error={settings.error} />;

  const s = settings.data as OrgSettings | undefined;
  const available = links
    .map((l) => ({ label: l.label, url: (s?.[l.urlKey] ?? null) as string | null }))
    .filter((l): l is { label: string; url: string } => !!l.url && l.url.trim().length > 0);

  const current = available[Math.min(active, available.length - 1)] ?? null;

  return (
    <div className="flex h-[calc(100dvh-64px)] flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" className="text-primary">
            <path d={iconPath} />
          </svg>
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
        {current && (
          <a href={current.url} target="_blank" rel="noopener noreferrer">
            <Button>Открыть в новой вкладке ↗</Button>
          </a>
        )}
      </div>

      {available.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {available.map((l, i) => {
            const on = i === Math.min(active, available.length - 1);
            return (
              <button
                key={l.label}
                onClick={() => setActive(i)}
                className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      )}

      {!current ? (
        <Card>
          <p className="text-sm text-muted">{hint}</p>
          <p className="mt-2 text-sm">
            Перейдите в <Link to="/settings" className="text-primary hover:underline">Настройки → Организация → Внешние сервисы</Link> и впишите ссылку.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex-1 overflow-hidden rounded-xl border border-border bg-surface">
            <iframe
              key={current.url}
              src={current.url}
              title={`${title}: ${current.label}`}
              className="h-full w-full"
              allow="camera; microphone; autoplay; fullscreen; clipboard-read; clipboard-write; geolocation"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Если внутри окна пусто — сервис запрещает встраивание. Откройте по кнопке выше.
          </p>
        </>
      )}
    </div>
  );
}

export function WebsiteAdminPage() {
  return (
    <ExternalHubPage
      title="Управление сайтом"
      hint="Адрес админ-панели сайта не задан."
      iconPath="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9z"
      links={[{ label: "Админка сайта", urlKey: "website_admin_url" }]}
    />
  );
}

export function CctvPage() {
  return (
    <ExternalHubPage
      title="Видеонаблюдение"
      hint="Ссылка на видеонаблюдение не задана."
      iconPath="M23 7l-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"
      links={[{ label: "Камеры", urlKey: "cctv_url" }]}
    />
  );
}

export function TelephonyPage() {
  return (
    <ExternalHubPage
      title="Телефония"
      hint="Ссылка на телефонию (звонки/записи) не задана."
      iconPath="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"
      links={[{ label: "Телефония", urlKey: "telephony_url" }]}
    />
  );
}

export function MapsPage() {
  return (
    <ExternalHubPage
      title="Карты"
      hint="Ссылки на карты (2ГИС / Яндекс) не заданы."
      iconPath="M9 20l-5.5 2.5v-15L9 5m0 15l6-2.5M9 20V5m6 12.5L20.5 20v-15L15 7.5m0 10V7.5m0 0L9 5"
      links={[
        { label: "2ГИС", urlKey: "map_2gis_url" },
        { label: "Яндекс Карты", urlKey: "map_yandex_url" },
      ]}
    />
  );
}

export function MessengersPage() {
  return (
    <ExternalHubPage
      title="Мессенджеры"
      hint="Ссылки на мессенджеры (Telegram / WhatsApp) не заданы."
      iconPath="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
      links={[
        { label: "Telegram", urlKey: "messenger_telegram_url" },
        { label: "WhatsApp", urlKey: "messenger_whatsapp_url" },
      ]}
    />
  );
}

export function InvoicesPage() {
  return (
    <ExternalHubPage
      title="Счёт онлайн"
      hint="Ссылки на онлайн-формы документов не заданы."
      iconPath="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8"
      links={[
        { label: "Счёт на оплату", urlKey: "invoice_schet_url" },
        { label: "Акт выполненных работ", urlKey: "invoice_akt_url" },
        { label: "Коммерческое предложение", urlKey: "invoice_kp_url" },
      ]}
    />
  );
}
