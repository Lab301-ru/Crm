import { useMemo, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOrder } from "@/shared/api/orders";
import { searchClients } from "@/shared/api/clients";
import { fetchCategories, fetchFieldTemplates, quickAddModel, searchBrands, searchModels } from "@/shared/api/catalog";
import { fetchProfiles } from "@/shared/api/settings";
import type { Client, FieldTemplate } from "@/shared/api/types";
import { formatPhone } from "@/shared/lib/format";
import { useDebounced } from "@/shared/lib/useDebounced";
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from "@/shared/ui";
import { useAuth } from "@/app/AuthProvider";
import { CustomFieldInput } from "./CustomFieldInput";

/**
 * Приёмка устройства < 60 секунд (Workpan-флоу):
 * телефон → клиент найден/создан → категория → бренд/модель из
 * автодополнения (или быстрое добавление) → неисправность → Принять.
 * Всё на одном экране, обязательного — минимум.
 */
export function NewOrderPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // — клиент —
  const [clientQuery, setClientQuery] = useState("");
  const [client, setClient] = useState<Client | null>(null);
  const [clientName, setClientName] = useState("");
  const debouncedClient = useDebounced(clientQuery, 300);
  const foundClients = useQuery({
    queryKey: ["client-search", debouncedClient],
    queryFn: () => searchClients(debouncedClient, 5),
    enabled: !client && debouncedClient.replace(/\D/g, "").length >= 4,
  });

  // — устройство —
  const [categoryId, setCategoryId] = useState("");
  const [brandQuery, setBrandQuery] = useState("");
  const [brandId, setBrandId] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [modelId, setModelId] = useState("");
  const [serial, setSerial] = useState("");
  const [completeness, setCompleteness] = useState("");
  const [appearance, setAppearance] = useState("");
  const [warrantyCase, setWarrantyCase] = useState(false);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  // — заказ —
  const [defect, setDefect] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [masterId, setMasterId] = useState("");
  const [prepayment, setPrepayment] = useState("");

  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 300_000 });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles, staleTime: 300_000 });
  const templates = useQuery({
    queryKey: ["field-templates", categoryId],
    queryFn: () => fetchFieldTemplates(categoryId),
    enabled: !!categoryId,
  });

  const debouncedBrand = useDebounced(brandQuery, 250);
  const brands = useQuery({
    queryKey: ["brands", debouncedBrand],
    queryFn: () => searchBrands(debouncedBrand),
    enabled: !brandId && debouncedBrand.trim().length >= 1,
  });
  const debouncedModel = useDebounced(modelQuery, 250);
  const models = useQuery({
    queryKey: ["models", categoryId, brandId, debouncedModel],
    queryFn: () => searchModels(categoryId, brandId || null, debouncedModel),
    enabled: !!categoryId && !modelId && debouncedModel.trim().length >= 1,
  });

  const activeTemplates = useMemo(
    () => (templates.data ?? []).filter((t) => t.is_active),
    [templates.data],
  );

  const quickAdd = useMutation({
    mutationFn: () => quickAddModel(categoryId, brandQuery, modelQuery),
    onSuccess: (res) => {
      setBrandId(res.brand_id);
      setModelId(res.model_id);
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      createOrder({
        client: client
          ? { id: client.id }
          : { name: clientName.trim(), phone: clientQuery.trim() },
        device: {
          category_id: categoryId,
          brand_id: brandId,
          model_id: modelId || undefined,
          serial_number: serial.trim() || undefined,
          completeness: completeness.trim() || undefined,
          appearance: appearance.trim() || undefined,
          is_warranty_case: warrantyCase,
          custom_fields: customFields,
        },
        order: {
          claimed_defect: defect.trim(),
          due_date: dueDate || undefined,
          master_id: masterId || undefined,
          prepayment: prepayment ? Number(prepayment) : 0,
        },
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate(`/orders/${res.id}`);
    },
  });

  const canSubmit =
    (client || (clientName.trim() && clientQuery.replace(/\D/g, "").length >= 10)) &&
    categoryId && brandId && defect.trim();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) submit.mutate();
  };

  const masters = profiles.data?.filter((p) => p.is_active && p.role !== "manager") ?? [];

  // Приёмка — менеджер и админ (RPC create_order на сервере тоже это проверяет)
  if (profile?.role === "master") return <Navigate to="/orders" replace />;

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-lg font-bold">Новый заказ</h1>

      {/* ШАГ 1: клиент по телефону */}
      <Card title="Клиент">
        {client ? (
          <div className="flex items-center justify-between rounded-lg bg-primary/10 border border-primary/30 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">{client.name}</p>
              <p className="text-xs text-muted">{formatPhone(client.phone)}</p>
            </div>
            <Button variant="ghost" type="button" onClick={() => setClient(null)}>Сменить</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Телефон" required>
              <Input
                type="tel"
                inputMode="tel"
                placeholder="+7 999 123-45-67"
                value={clientQuery}
                onChange={(e) => setClientQuery(e.target.value)}
                autoFocus
              />
            </Field>
            {foundClients.data && foundClients.data.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                {foundClients.data.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setClient(c)}
                    className="flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-surface-2"
                  >
                    <span className="text-sm">{c.name}</span>
                    <span className="text-xs text-muted">{formatPhone(c.phone)}</span>
                  </button>
                ))}
              </div>
            )}
            <Field label="Имя клиента" required>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Иванов Иван" />
            </Field>
          </div>
        )}
      </Card>

      {/* ШАГ 2: устройство */}
      <Card title="Устройство">
        <div className="space-y-3">
          <Field label="Категория" required>
            <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setCustomFields({}); setModelId(""); setModelQuery(""); }}>
              <option value="">Выберите категорию…</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Бренд" required>
              <div className="relative">
                <Input
                  value={brandQuery}
                  onChange={(e) => { setBrandQuery(e.target.value); setBrandId(""); }}
                  placeholder="Apple, Samsung…"
                />
                {!brandId && brands.data && brands.data.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                    {brands.data.map((b) => (
                      <button
                        type="button"
                        key={b.id}
                        onClick={() => { setBrandId(b.id); setBrandQuery(b.name); }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <Field label="Модель">
              <div className="relative">
                <Input
                  value={modelQuery}
                  onChange={(e) => { setModelQuery(e.target.value); setModelId(""); }}
                  placeholder="iPhone 14 Pro…"
                  disabled={!categoryId}
                />
                {!modelId && models.data && models.data.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                    {models.data.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => { setModelId(m.id); setBrandId(m.brand_id); setModelQuery(m.name); if (m.brands) setBrandQuery(m.brands.name); }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                      >
                        {m.brands ? `${m.brands.name} ` : ""}{m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          </div>

          {/* Модели нет в справочнике — добавляем на лету, не теряя 60 секунд */}
          {categoryId && brandQuery.trim() && modelQuery.trim() && !modelId &&
            models.data && models.data.length === 0 && (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={quickAdd.isPending}
              onClick={() => quickAdd.mutate()}
            >
              + Добавить «{brandQuery} {modelQuery}» в справочник
            </Button>
          )}

          <Field label="Серийный номер">
            <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </Field>

          {/* Динамические поля категории */}
          {activeTemplates.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {activeTemplates.map((tpl: FieldTemplate) => (
                <CustomFieldInput
                  key={tpl.id}
                  template={tpl}
                  value={customFields[tpl.key]}
                  onChange={(v) => setCustomFields((prev) => ({ ...prev, [tpl.key]: v }))}
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Комплектация">
              <Input value={completeness} onChange={(e) => setCompleteness(e.target.value)} placeholder="устройство, чехол" />
            </Field>
            <Field label="Внешнее состояние">
              <Input value={appearance} onChange={(e) => setAppearance(e.target.value)} placeholder="царапины на корпусе" />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={warrantyCase} onChange={(e) => setWarrantyCase(e.target.checked)} className="h-4 w-4 accent-primary" />
            Гарантийный случай
          </label>
        </div>
      </Card>

      {/* ШАГ 3: неисправность и условия */}
      <Card title="Неисправность и условия">
        <div className="space-y-3">
          <Field label="Заявленная неисправность" required>
            <Textarea value={defect} onChange={(e) => setDefect(e.target.value)} placeholder="Не включается, не заряжается…" />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Готовность к">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Мастер">
              <Select value={masterId} onChange={(e) => setMasterId(e.target.value)}>
                <option value="">Не назначен</option>
                {masters.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </Select>
            </Field>
            <Field label="Предоплата, ₽">
              <Input type="number" inputMode="numeric" min={0} value={prepayment} onChange={(e) => setPrepayment(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <ErrorText error={submit.error} />
      <Button type="submit" className="w-full py-3 text-base" disabled={!canSubmit || submit.isPending}>
        {submit.isPending ? "Создаём…" : "Принять в ремонт"}
      </Button>
    </form>
  );
}
