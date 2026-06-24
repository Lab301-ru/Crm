import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchOrgSettings } from "@/shared/api/settings";
import type { OrgSettings } from "@/shared/api/types";
import { Button, Card, ErrorText, Spinner } from "@/shared/ui";

type UrlKey = "website_admin_url" | "cctv_url" | "telephony_url";

interface Props {
  title: string;
  urlKey: UrlKey;
  hint: string;
  iconPath: string;
}

/** Универсальная страница «открыть внешний сервис» (админка сайта, CCTV, телефония).
 *  Берёт URL из org_settings.<urlKey>. Пытается встроить iframe; параллельно даёт
 *  кнопку «Открыть в новой вкладке» — большинство сторонних сервисов блокируют
 *  встраивание (X-Frame-Options/CSP), и тогда iframe останется пустым. */
export function ExternalLinkPage({ title, urlKey, hint, iconPath }: Props) {
  const settings = useQuery({ queryKey: ["org-settings"], queryFn: fetchOrgSettings });

  if (settings.isLoading) return <Spinner className="pt-20" />;
  if (settings.error) return <ErrorText error={settings.error} />;

  const url = (settings.data as OrgSettings | undefined)?.[urlKey] ?? null;

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
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button>Открыть в новой вкладке ↗</Button>
          </a>
        )}
      </div>

      {!url ? (
        <Card>
          <p className="text-sm text-muted">{hint}</p>
          <p className="mt-2 text-sm">
            Перейдите в <Link to="/settings" className="text-primary hover:underline">Настройки → Организация → Внешние сервисы</Link> и впишите ссылку.
          </p>
        </Card>
      ) : (
        <div className="flex-1 overflow-hidden rounded-xl border border-border bg-surface">
          <iframe
            src={url}
            title={title}
            className="h-full w-full"
            allow="camera; microphone; autoplay; fullscreen; clipboard-read; clipboard-write"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <noscript />
        </div>
      )}

      {url && (
        <p className="mt-2 text-xs text-muted">
          Если внутри окна пусто — сервис запрещает встраивание. Откройте по кнопке выше.
        </p>
      )}
    </div>
  );
}

export function WebsiteAdminPage() {
  return (
    <ExternalLinkPage
      title="Управление сайтом"
      urlKey="website_admin_url"
      hint="Адрес админ-панели сайта не задан."
      iconPath="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9z"
    />
  );
}

export function CctvPage() {
  return (
    <ExternalLinkPage
      title="Видеонаблюдение"
      urlKey="cctv_url"
      hint="Ссылка на видеонаблюдение не задана."
      iconPath="M23 7l-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"
    />
  );
}

export function TelephonyPage() {
  return (
    <ExternalLinkPage
      title="Телефония"
      urlKey="telephony_url"
      hint="Ссылка на телефонию (звонки/записи) не задана."
      iconPath="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"
    />
  );
}
