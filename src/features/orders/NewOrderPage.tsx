import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOrder } from "@/shared/api/orders";
import { searchClients } from "@/shared/api/clients";
import { addCategory, fetchCategories, fetchFieldTemplates, quickAddBrand, quickAddModel, searchBrands, searchModels } from "@/shared/api/catalog";
import { fetchProfiles } from "@/shared/api/settings";
import type { Client, FieldTemplate } from "@/shared/api/types";
import { formatPhone, phoneInput } from "@/shared/lib/format";
import { useDebounced } from "@/shared/lib/useDebounced";
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from "@/shared/ui";
import { CustomFieldInput } from "./CustomFieldInput";

// Черновик формы приёмки. Хранится в localStorage, чтобы введённое не
// терялось, когда мобильный браузер выгружает свёрнутую вкладку или при
// переходе между страницами SPA.
const DRAFT_KEY = "draft:new-order";
interface Draft {
  clientQuery: string;
  client: Client | null;
  clientName: string;
  categoryId: string;
  categoryQuery: string;
  brandQuery: string;
  brandId: string;
  modelQuery: string;
  modelId: string;
  serial: string;
  completeness: string;
  appearance: string;
  warrantyCase: boolean;
  customFields: Record<string, unknown>;
  defect: string;
  dueDate: string;
  masterId: string;
  prepayment: string;
}

/**
 * Приёмка устройства < 60 секунд (Workpan-флоу):
 * телефон → клиент найден/создан → категория → бренд/модель из
 * автодополнения (или быстрое добавление) → неисправность → Принять.
 * Всё на одном экране, обязательного — минимум.
 */
export function NewOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Восстанавливаем черновик один раз на входе.
  const draft = useMemo<Partial<Draft>>(() => {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") as Partial<Draft>; }
    catch { return {}; }
  }, []);

  // — клиент —
  const [clientQuery, setClientQuery] = useState(draft.clientQuery ?? "+7 ");
  const [client, setClient] = useState<Client | null>(draft.client ?? null);
  const [clientName, setClientName] = useState(draft.clientName ?? "");
  const debouncedClient = useDebounced(clientQuery, 300);
  const foundClients = useQuery({
    queryKey: ["client-search", debouncedClient],
    queryFn: () => searchClients(debouncedClient, 5),
    enabled: !client && debouncedClient.replace(/\D/g, "").length >= 4,
  });

  // — устройство —
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? "");
  const [categoryQuery, setCategoryQuery] = useState(draft.categoryQuery ?? "");
  const [brandQuery, setBrandQuery] = useState(draft.brandQuery ?? "");
  const [brandId, setBrandId] = useState(draft.brandId ?? "");
  const [modelQuery, setModelQuery] = useState(draft.modelQuery ?? "");
  const [modelId, setModelId] = useState(draft.modelId ?? "");
  const [serial, setSerial] = useState(draft.serial ?? "");
  const [completeness, setCompleteness] = useState(draft.completeness ?? "");
  const [appearance, setAppearance] = useState(draft.appearance ?? "");
  const [warrantyCase, setWarrantyCase] = useState(draft.warrantyCase ?? false);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(draft.customFields ?? {});

  // — заказ —
  const [defect, setDefect] = useState(draft.defect ?? "");
  const [dueDate, setDueDate] = useState(draft.dueDate ?? "");
  const [masterId, setMasterId] = useState(draft.masterId ?? "");
  const [prepayment, setPrepayment] = useState(draft.prepayment ?? "");

  // Автосохранение черновика при любом изменении полей.
  const draftJson = JSON.stringify({
    clientQuery, client, clientName, categoryId, categoryQuery, brandQuery, brandId, modelQuery,
    modelId, serial, completeness, appearance, warrantyCase, customFields,
    defect, dueDate, masterId, prepayment,
  });
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, draftJson);
  }, [draftJson]);

  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 300_000 });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles, staleTime: 300_000 });

  // Категория как поиск: фильтруем имеющиеся и предлагаем создать новую.
  const catQ = categoryQuery.trim().toLowerCase();
  const matchedCategories = useMemo(() => {
    const all = categories.data ?? [];
    return (catQ ? all.filter((c) => c.name.toLowerCase().includes(catQ)) : all).slice(0, 8);
  }, [categories.data, catQ]);
  const exactCategory = (categories.data ?? []).find((c) => c.name.trim().toLowerCase() === catQ);
  const addCat = useMutation({
    mutationFn: (name: string) => addCategory(name.trim()),
    onSuccess: (res, name) => {
      setCategoryId(res.id);
      setCategoryQuery(name.trim());
      setCustomFields({}); setModelId(""); setModelQuery("");
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
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
    mutationFn: async () => {
      // Категория: выбрана из справочника либо введена вручную — создаём на лету.
      let resolvedCategoryId = categoryId;
      if (!resolvedCategoryId && categoryQuery.trim()) {
        const existing = (categories.data ?? []).find(
          (c) => c.name.trim().toLowerCase() === categoryQuery.trim().toLowerCase(),
        );
        resolvedCategoryId = existing ? existing.id : (await addCategory(categoryQuery.trim())).id;
      }
      // Бренд (и модель) могут быть введены вручную и отсутствовать в
      // справочнике — создаём их на лету, чтобы приёмка не вставала.
      let resolvedBrandId = brandId;
      let resolvedModelId: string | undefined = modelId || undefined;
      if (!resolvedBrandId) {
        if (modelQuery.trim()) {
          const r = await quickAddModel(resolvedCategoryId, brandQuery.trim(), modelQuery.trim());
          resolvedBrandId = r.brand_id;
          resolvedModelId = r.model_id;
        } else {
          const r = await quickAddBrand(brandQuery.trim());
          resolvedBrandId = r.brand_id;
        }
      }
      return createOrder({
        client: client
          ? { id: client.id }
          : { name: clientName.trim(), phone: clientQuery.trim() },
        device: {
          category_id: resolvedCategoryId,
          brand_id: resolvedBrandId,
          model_id: resolvedModelId,
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
      });
    },
    onSuccess: (res) => {
      localStorage.removeItem(DRAFT_KEY);  // заказ создан — черновик больше не нужен
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate(`/orders/${res.id}`);
    },
  });

  // Бренд можно либо выбрать из справочника (brandId), либо ввести вручную
  // (brandQuery) — во втором случае он создастся при отправке.
  const canSubmit =
    (client || (clientName.trim() && clientQuery.replace(/\D/g, "").length >= 10)) &&
    (categoryId || categoryQuery.trim()) && (brandId || brandQuery.trim()) && defect.trim();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) submit.mutate();
  };

  const masters = profiles.data?.filter((p) => p.is_active && p.role !== "manager") ?? [];

  // Полный сброс формы и черновика — начать новую заявку с чистого листа.
  const resetForm = () => {
    localStorage.removeItem(DRAFT_KEY);
    setClientQuery("+7 "); setClient(null); setClientName("");
    setCategoryId(""); setCategoryQuery(""); setBrandQuery(""); setBrandId(""); setModelQuery(""); setModelId("");
    setSerial(""); setCompleteness(""); setAppearance(""); setWarrantyCase(false); setCustomFields({});
    setDefect(""); setDueDate(""); setMasterId(""); setPrepayment("");
  };

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Новый заказ</h1>
        <Button type="button" variant="ghost" onClick={resetForm}>Очистить</Button>
      </div>

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
                onChange={(e) => setClientQuery(phoneInput(e.target.value))}
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
          <Field label="Категория (тип устройства)" required>
            <div className="relative">
              <Input
                value={categoryQuery}
                onChange={(e) => { setCategoryQuery(e.target.value); setCategoryId(""); setCustomFields({}); setModelId(""); setModelQuery(""); }}
                placeholder="Смартфон, Телевизор, Кофемашина…"
              />
              {!categoryId && categoryQuery.trim() && matchedCategories.length > 0 && (
                <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  {matchedCategories.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => { setCategoryId(c.id); setCategoryQuery(c.name); }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!categoryId && categoryQuery.trim() && !exactCategory && (
              <Button
                type="button"
                variant="secondary"
                className="mt-2 w-full"
                disabled={addCat.isPending}
                onClick={() => addCat.mutate(categoryQuery)}
              >
                + Создать категорию «{categoryQuery.trim()}» в справочнике
              </Button>
            )}
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
              {!brandId && brandQuery.trim() && (!brands.data || brands.data.length === 0) && (
                <p className="mt-1 text-xs text-muted">Новый бренд — добавим в справочник при приёме</p>
              )}
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
