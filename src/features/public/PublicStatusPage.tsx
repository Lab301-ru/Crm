import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/shared/lib/format";
import { Spinner } from "@/shared/ui";

interface PublicStatus {
  order_number: string;
  status: string;
  status_color: string;
  accepted_at: string | null;
  due_date: string | null;
  service_comment: string | null;
  org: {
    name: string;
    phone: string | null;
    address: string | null;
    working_hours: string | null;
    contacts: string | null;
  };
}

async function fetchPublicStatus(token: string): Promise<PublicStatus> {
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-status?token=${encodeURIComponent(token)}`,
  );
  const body = (await resp.json()) as PublicStatus & { error?: string };
  if (!resp.ok) throw new Error(body.error ?? "Не удалось получить статус заказа");
  return body;
}

/** Публичная страница по QR-коду: без авторизации, без персональных данных. */
export function PublicStatusPage() {
  const { token = "" } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-status", token],
    queryFn: () => fetchPublicStatus(token),
    retry: 1,
  });

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md">
        {isLoading ? (
          <Spinner />
        ) : error || !data ? (
          <div className="rounded-2xl bg-surface border border-border p-6 text-center">
            <p className="text-lg font-semibold">Заказ не найден</p>
            <p className="mt-2 text-sm text-muted">
              Проверьте ссылку на квитанции или свяжитесь с сервисным центром.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-surface border border-border">
            <div className="border-b border-border p-6 text-center">
              <p className="text-xs uppercase tracking-wide text-muted">Заказ</p>
              <p className="mt-1 text-2xl font-bold">{data.order_number}</p>
              <span
                className="mt-3 inline-flex rounded-lg border px-4 py-1.5 text-sm font-semibold"
                style={{
                  color: data.status_color,
                  backgroundColor: `${data.status_color}1f`,
                  borderColor: `${data.status_color}55`,
                }}
              >
                {data.status}
              </span>
            </div>
            <dl className="space-y-2 p-6 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Принят</dt>
                <dd>{formatDate(data.accepted_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Плановая готовность</dt>
                <dd>{formatDate(data.due_date)}</dd>
              </div>
              {data.service_comment && (
                <div className="pt-2">
                  <dt className="text-muted">Комментарий сервиса</dt>
                  <dd className="mt-1">{data.service_comment}</dd>
                </div>
              )}
            </dl>
            <div className="border-t border-border bg-surface-2/50 p-6 text-sm">
              <p className="font-semibold">{data.org.name}</p>
              {data.org.address && <p className="mt-1 text-muted">{data.org.address}</p>}
              {data.org.working_hours && <p className="text-muted">{data.org.working_hours}</p>}
              {data.org.phone && (
                <a href={`tel:${data.org.phone}`} className="mt-2 block font-medium text-primary">
                  {data.org.phone}
                </a>
              )}
              {data.org.contacts && <p className="mt-1 text-muted">{data.org.contacts}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
