import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchOrgSettings } from "@/shared/api/settings";
import type { OrgSettings } from "@/shared/api/types";
import { copyText } from "@/shared/lib/clipboard";
import { Button, Card, ErrorText, Spinner } from "@/shared/ui";

export function PaymentPage() {
  const settings = useQuery({ queryKey: ["org-settings"], queryFn: fetchOrgSettings });

  if (settings.isLoading) return <Spinner className="pt-20" />;
  if (settings.error) return <ErrorText error={settings.error} />;

  const s = settings.data as OrgSettings;
  const link = s.payment_link_url?.trim() || null;
  const phone = s.sbp_phone?.trim() || null;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Оплата</h1>

      {/* Оплата по ссылке / QR */}
      <Card title="Оплата по ссылке или QR-коду">
        {!link ? (
          <p className="text-sm text-muted">
            Ссылка оплаты не задана. Укажите её в{" "}
            <Link to="/settings" className="text-primary hover:underline">Настройках → Внешние сервисы</Link>.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <QrImage url={link} />
            <div className="flex-1 space-y-3">
              <p className="text-sm text-muted">
                Покажите клиенту QR-код или отправьте ссылку — оплата картой через Т-Банк.
              </p>
              <p className="break-all rounded-lg bg-surface-2 px-3 py-2 text-xs">{link}</p>
              <div className="flex flex-wrap gap-2">
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <Button>Открыть ссылку оплаты ↗</Button>
                </a>
                <CopyButton text={link} label="Скопировать ссылку" />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* СБП по номеру телефона */}
      <Card title="СБП — перевод по номеру телефона">
        {!phone ? (
          <p className="text-sm text-muted">Реквизиты СБП не заданы.</p>
        ) : (
          <div className="space-y-2">
            <Row k="Телефон" v={phone} />
            {s.sbp_name && <Row k="Получатель" v={s.sbp_name} />}
            {s.sbp_bank && <Row k="Банк" v={s.sbp_bank} />}
            <div className="flex flex-wrap gap-2 pt-1">
              <CopyButton text={phone} label="Скопировать номер" />
            </div>
            <p className="text-xs text-muted">
              В приложении банка выберите «Перевод по СБП», вставьте номер телефона и банк-получатель «{s.sbp_bank ?? "Т-Банк"}».
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      }}
    >
      {copied ? "Скопировано ✓" : label}
    </Button>
  );
}

/** QR на белой подложке — иначе сканеры не читают с тёмного экрана. */
function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode")
      .then((m) => m.default.toDataURL(url, { margin: 1, width: 256 }))
      .then((s) => { if (alive) setSrc(s); });
    return () => { alive = false; };
  }, [url]);
  if (!src) return <div className="h-44 w-44 shrink-0 rounded-lg bg-surface-2" aria-hidden />;
  return <img src={src} alt="QR-код оплаты" className="h-44 w-44 shrink-0 rounded-lg bg-white p-2" />;
}
