import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DOC_LABELS, getPrintDocument, type DocSnapshot, type DocType } from "@/shared/api/documents";
import { formatDate, formatDateTime, formatMoney } from "@/shared/lib/format";
import { ErrorText, Spinner } from "@/shared/ui";
import { useAuth } from "@/app/AuthProvider";

const PAYMENT_STATUS: Record<string, string> = { unpaid: "не оплачен", prepaid: "внесена предоплата", paid: "оплачен полностью" };
const PAYMENT_METHOD: Record<string, string> = { cash: "наличные", card: "банковская карта", transfer: "перевод" };

/**
 * Печатная форма документа (A4, светлая — это бумага, а не экран).
 * Рендерится из снимка order_documents: повторная печать всегда
 * идентична первой. «Сохранить как PDF» делает сам браузер.
 */
export function PrintDocumentPage() {
  const { id = "", docType = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const printed = useRef(false);

  const valid = (Object.keys(DOC_LABELS) as DocType[]).includes(docType as DocType);
  const doc = useQuery({
    queryKey: ["print-document", id, docType, params.get("doc"), params.get("refresh")],
    queryFn: () =>
      getPrintDocument(id, docType as DocType, {
        docId: params.get("doc") ?? undefined,
        refresh: params.get("refresh") === "1",
        createdBy: profile!.id,
      }),
    enabled: valid && !!profile,
    staleTime: Infinity,
    retry: false,
  });

  // QR со ссылкой отслеживания — только на квитанции
  const [qr, setQr] = useState<string | null>(null);
  const snapshot = doc.data?.snapshot;
  useEffect(() => {
    if (!snapshot || snapshot.doc_type !== "intake_receipt") return;
    const url = `${window.location.origin}/status/${snapshot.order.qr_token}`;
    void import("qrcode").then((m) =>
      m.default.toDataURL(url, { margin: 0, width: 192 }).then(setQr),
    );
  }, [snapshot]);

  // Автопечать: один раз, когда форма (и QR для квитанции) готовы
  const ready = !!snapshot && (snapshot.doc_type !== "intake_receipt" || !!qr);
  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [ready]);

  // Документы — задача менеджера/админа; у мастера и кнопок таких нет
  if (profile?.role === "master") return <Navigate to={`/orders/${id}`} replace />;
  if (!valid) return <Navigate to={`/orders/${id}`} replace />;
  if (doc.isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (doc.error || !snapshot) {
    return (
      <div className="p-8">
        <ErrorText error={doc.error ?? "Документ не найден"} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-neutral-300 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-1 print:hidden">
        <button
          onClick={() => navigate(`/orders/${id}`)}
          className="rounded-lg bg-neutral-700 px-4 py-2 text-sm text-white hover:bg-neutral-600"
        >
          ← К заказу
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Печать / Сохранить в PDF
        </button>
      </div>

      <div className="mx-auto max-w-[210mm] bg-white p-[14mm] text-[13px] leading-relaxed text-black shadow-xl print:shadow-none">
        <OrgHeader snapshot={snapshot} />
        {snapshot.doc_type === "intake_receipt" && <IntakeReceipt s={snapshot} qr={qr} />}
        {snapshot.doc_type === "work_act" && <WorkAct s={snapshot} />}
        {snapshot.doc_type === "issue_act" && <IssueAct s={snapshot} />}
        {snapshot.doc_type === "warranty_card" && <WarrantyCard s={snapshot} />}
      </div>
    </div>
  );
}

/* ---------------- Общие блоки ---------------- */

function OrgHeader({ snapshot: s }: { snapshot: DocSnapshot }) {
  const parts = [
    s.org.inn ? `ИНН ${s.org.inn}` : null,
    s.org.address,
    s.org.phone,
    s.org.working_hours,
  ].filter(Boolean);
  return (
    <header className="mb-4 border-b-2 border-black pb-2">
      <p className="text-lg font-bold">{s.org.name}</p>
      {parts.length > 0 && <p className="text-[11px] text-neutral-700">{parts.join(" · ")}</p>}
    </header>
  );
}

function DocTitle({ s }: { s: DocSnapshot }) {
  return (
    <h1 className="mb-4 text-center text-[15px] font-bold">
      {DOC_LABELS[s.doc_type]} № {s.order.display_number}
      <span className="font-normal"> от {formatDate(s.generated_at)}</span>
    </h1>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-44 shrink-0 text-neutral-600">{k}:</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function DeviceBlock({ s }: { s: DocSnapshot }) {
  return (
    <section className="mb-3">
      <InfoRow k="Устройство" v={s.device.label} />
      {s.device.serial_number && <InfoRow k="Серийный № / IMEI" v={s.device.serial_number} />}
      {s.device.custom_fields.map((f) => <InfoRow key={f.label} k={f.label} v={f.value} />)}
      {s.device.completeness && <InfoRow k="Комплектация" v={s.device.completeness} />}
      {s.device.appearance && <InfoRow k="Внешнее состояние" v={s.device.appearance} />}
      {s.device.is_warranty_case && <InfoRow k="Тип обращения" v="гарантийный случай" />}
    </section>
  );
}

function ItemsTable({ s, withTotals }: { s: DocSnapshot; withTotals: boolean }) {
  return (
    <table className="mb-3 w-full border-collapse text-[12px]">
      <thead>
        <tr className="border-y border-black text-left">
          <th className="py-1 pr-2 font-semibold">№</th>
          <th className="py-1 pr-2 font-semibold">Наименование</th>
          <th className="py-1 pr-2 font-semibold">Тип</th>
          <th className="py-1 pr-2 text-right font-semibold">Кол-во</th>
          <th className="py-1 pr-2 text-right font-semibold">Цена</th>
          <th className="py-1 text-right font-semibold">Сумма</th>
        </tr>
      </thead>
      <tbody>
        {s.items.map((i, idx) => (
          <tr key={idx} className="border-b border-neutral-300">
            <td className="py-1 pr-2">{idx + 1}</td>
            <td className="py-1 pr-2">{i.name}</td>
            <td className="py-1 pr-2">{i.item_type === "work" ? "работа" : "запчасть"}</td>
            <td className="py-1 pr-2 text-right">{i.qty}</td>
            <td className="py-1 pr-2 text-right">{formatMoney(i.price)}</td>
            <td className="py-1 text-right">{formatMoney(i.price * i.qty)}</td>
          </tr>
        ))}
      </tbody>
      {withTotals && (
        <tfoot>
          <tr>
            <td colSpan={5} className="py-1 pr-2 text-right">Итого:</td>
            <td className="py-1 text-right font-semibold">{formatMoney(s.order.grand_total)}</td>
          </tr>
          {s.order.prepayment > 0 && (
            <>
              <tr>
                <td colSpan={5} className="py-0.5 pr-2 text-right">Предоплата:</td>
                <td className="py-0.5 text-right">− {formatMoney(s.order.prepayment)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="py-0.5 pr-2 text-right font-semibold">К оплате:</td>
                <td className="py-0.5 text-right font-bold">{formatMoney(s.order.due_amount)}</td>
              </tr>
            </>
          )}
        </tfoot>
      )}
    </table>
  );
}

/**
 * Подписи. Слева — сторона сервиса: автоподстановка факсимиле-подписи
 * и расшифровки (по умолчанию подпись «Б.Ю.Г.», имя «Юрий» — из
 * org_settings). Справа — сторона клиента, остаётся пустой для подписи
 * от руки.
 */
function Signatures({ left, right, signer }: {
  left: string;
  right: string;
  signer?: { name: string; signature: string };
}) {
  return (
    <div className="mt-8 grid grid-cols-2 gap-8">
      <div>
        <p className="mb-6 text-[12px] text-neutral-600">{left}</p>
        <div className="relative border-b border-black">
          {signer?.signature && (
            <span className="absolute bottom-1 left-2 font-[cursive] text-[18px] italic text-neutral-800">
              {signer.signature}
            </span>
          )}
        </div>
        <p className="mt-1 text-[10px] text-neutral-500">
          подпись / расшифровка{signer?.name ? ` — ${signer.name}` : ""}
        </p>
      </div>
      <div>
        <p className="mb-6 text-[12px] text-neutral-600">{right}</p>
        <div className="border-b border-black" />
        <p className="mt-1 text-[10px] text-neutral-500">подпись / расшифровка</p>
      </div>
    </div>
  );
}

/* ---------------- Квитанция о приёме ---------------- */

function IntakeReceipt({ s, qr }: { s: DocSnapshot; qr: string | null }) {
  return (
    <>
      <DocTitle s={s} />
      <section className="mb-3">
        <InfoRow k="Дата приёма" v={s.order.accepted_at ? formatDateTime(s.order.accepted_at) : "—"} />
        <InfoRow k="Клиент" v={s.client.name} />
        <InfoRow k="Телефон" v={s.client.phone} />
        {s.client.email && <InfoRow k="Email" v={s.client.email} />}
      </section>
      <DeviceBlock s={s} />
      <section className="mb-3">
        <InfoRow k="Заявленная неисправность" v={s.order.claimed_defect} />
        {s.order.due_date && <InfoRow k="Плановая готовность" v={formatDate(s.order.due_date)} />}
        {s.order.prepayment > 0 && <InfoRow k="Предоплата" v={formatMoney(s.order.prepayment)} />}
        {s.manager_name && <InfoRow k="Принял" v={s.manager_name} />}
      </section>

      {qr && (
        <section className="mb-3 flex items-center gap-4 rounded border border-neutral-400 p-3">
          <img src={qr} alt="QR-код отслеживания" className="h-24 w-24" />
          <div className="text-[11px]">
            <p className="font-semibold">Статус ремонта онлайн</p>
            <p>Отсканируйте QR-код или откройте ссылку:</p>
            <p className="break-all text-neutral-700">{window.location.origin}/status/{s.order.qr_token}</p>
          </div>
        </section>
      )}

      {s.org.receipt_disclaimer && (
        <p className="mb-3 whitespace-pre-line text-[10px] leading-snug text-neutral-600">
          {s.org.receipt_disclaimer}
        </p>
      )}
      <p className="text-[11px]">
        С условиями ремонта согласен. Устройство передал, с описанием состояния и комплектации согласен.
      </p>
      <Signatures
        left="Устройство принял (сотрудник)"
        right="Устройство сдал (клиент)"
        signer={{ name: s.org.signer_name, signature: s.org.signer_signature }}
      />
    </>
  );
}

/* ---------------- Акт выполненных работ ---------------- */

function WorkAct({ s }: { s: DocSnapshot }) {
  return (
    <>
      <DocTitle s={s} />
      <section className="mb-3">
        <InfoRow k="Заказчик" v={`${s.client.name}, ${s.client.phone}`} />
      </section>
      <DeviceBlock s={s} />
      {s.order.diagnostic_result && (
        <section className="mb-3">
          <InfoRow k="Результат диагностики" v={s.order.diagnostic_result} />
        </section>
      )}
      {s.items.length > 0 ? <ItemsTable s={s} withTotals /> : (
        <p className="mb-3 text-[12px]">Работы не выполнялись.</p>
      )}
      <p className="text-[11px]">
        Перечисленные работы выполнены полностью. Заказчик по объёму, качеству и срокам
        выполнения работ претензий не имеет.
      </p>

      {/* Гарантийный талон на том же бланке (2-в-1) */}
      <div className="my-4 border-t-2 border-dashed border-neutral-400 pt-3">
        <h2 className="mb-2 text-center text-[14px] font-bold">Гарантийный талон</h2>
        <WarrantyBlock s={s} />
      </div>

      <Signatures
        left={`Исполнитель${s.master_name ? ` (${s.master_name})` : ""}`}
        right="Заказчик"
        signer={{ name: s.org.signer_name, signature: s.org.signer_signature }}
      />
    </>
  );
}

/** Содержимое гарантии (без заголовка/подписей) — общий блок для 2-в-1 и талона. */
function WarrantyBlock({ s }: { s: DocSnapshot }) {
  const works = s.items.filter((i) => i.item_type === "work");
  const days = s.order.warranty_days ?? s.org.default_warranty_days;
  const warrantyUntil = days
    ? new Date(new Date(s.generated_at).getTime() + days * 86_400_000)
    : null;
  return (
    <>
      {works.length > 0 && (
        <section className="mb-2">
          <p className="mb-1 font-semibold">Работы, на которые распространяется гарантия:</p>
          <ul className="list-disc pl-5">
            {works.map((w, i) => <li key={i}>{w.name}</li>)}
          </ul>
        </section>
      )}
      <section className="mb-2">
        <InfoRow
          k="Гарантийный срок"
          v={days && warrantyUntil
            ? `${days} дн. с даты выдачи, до ${formatDate(warrantyUntil.toISOString())}`
            : "не предоставляется"}
        />
      </section>
      <div className="text-[10px] leading-snug text-neutral-600">
        <p className="mb-1 font-semibold text-black">Условия гарантии:</p>
        <p>
          Гарантия распространяется только на перечисленные выше работы и установленные запчасти.
          Гарантия не распространяется на иные узлы устройства, на повреждения, возникшие в результате
          ударов, попадания влаги, скачков напряжения, вмешательства третьих лиц, нарушения условий
          эксплуатации, а также на программное обеспечение и данные. Гарантийное обслуживание
          производится при предъявлении настоящего талона.
        </p>
      </div>
    </>
  );
}

/* ---------------- Акт выдачи ---------------- */

function IssueAct({ s }: { s: DocSnapshot }) {
  const warrantyUntil = s.order.warranty_days
    ? new Date(new Date(s.generated_at).getTime() + s.order.warranty_days * 86_400_000)
    : null;
  return (
    <>
      <DocTitle s={s} />
      <section className="mb-3">
        <InfoRow k="Клиент" v={`${s.client.name}, ${s.client.phone}`} />
      </section>
      <DeviceBlock s={s} />
      {s.items.length > 0 && <ItemsTable s={s} withTotals />}
      <section className="mb-3">
        <InfoRow k="Оплата" v={`${PAYMENT_STATUS[s.order.payment_status] ?? s.order.payment_status}${s.order.payment_method ? `, ${PAYMENT_METHOD[s.order.payment_method]}` : ""}`} />
        {s.order.warranty_days != null && s.order.warranty_days > 0 && warrantyUntil && (
          <InfoRow k="Гарантия" v={`${s.order.warranty_days} дн., до ${formatDate(warrantyUntil.toISOString())}`} />
        )}
      </section>
      <p className="text-[11px]">
        Устройство получено в рабочем состоянии, внешний вид и комплектация проверены.
        Претензий к выполненным работам и состоянию устройства не имею.
      </p>
      <Signatures
        left="Устройство выдал (сотрудник)"
        right="Устройство получил (клиент)"
        signer={{ name: s.org.signer_name, signature: s.org.signer_signature }}
      />
    </>
  );
}

/* ---------------- Гарантийный талон ---------------- */

function WarrantyCard({ s }: { s: DocSnapshot }) {
  return (
    <>
      <DocTitle s={s} />
      <section className="mb-3">
        <InfoRow k="Клиент" v={`${s.client.name}, ${s.client.phone}`} />
      </section>
      <DeviceBlock s={s} />
      <WarrantyBlock s={s} />
      <Signatures
        left="Исполнитель (подпись, печать)"
        right="Клиент"
        signer={{ name: s.org.signer_name, signature: s.org.signer_signature }}
      />
    </>
  );
}
