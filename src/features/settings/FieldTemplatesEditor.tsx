import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCategories, fetchFieldTemplates } from "@/shared/api/catalog";
import { createFieldTemplate, updateFieldTemplate } from "@/shared/api/settings";
import type { FieldType } from "@/shared/api/types";
import { Button, Card, EmptyState, ErrorText, Field, Input, Select, Spinner } from "@/shared/ui";

const typeLabels: Record<FieldType, string> = {
  text: "Текст",
  number: "Число",
  select: "Список (один)",
  multiselect: "Список (несколько)",
  boolean: "Да / нет",
  date: "Дата",
};

/** Конструктор доп-полей категории: новое поле = строка в БД, без миграций. */
export function FieldTemplatesEditor() {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const [categoryId, setCategoryId] = useState("");

  const templates = useQuery({
    queryKey: ["field-templates", categoryId],
    queryFn: () => fetchFieldTemplates(categoryId),
    enabled: !!categoryId,
  });

  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["field-templates", categoryId] });

  const create = useMutation({
    mutationFn: () =>
      createFieldTemplate({
        category_id: categoryId,
        key: key.trim(),
        label: label.trim(),
        field_type: fieldType,
        options: fieldType === "select" || fieldType === "multiselect"
          ? options.split(",").map((o) => o.trim()).filter(Boolean)
          : null,
        is_required: required,
        sort: ((templates.data?.length ?? 0) + 1) * 10,
      }),
    onSuccess: () => {
      setLabel(""); setKey(""); setOptions(""); setRequired(false);
      invalidate();
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => updateFieldTemplate(id, { is_active }),
    onSuccess: invalidate,
  });

  return (
    <Card title="Дополнительные поля по категориям">
      <div className="space-y-4">
        <Field label="Категория">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Выберите категорию…</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>

        {categoryId && (
          <>
            {templates.isLoading ? (
              <Spinner />
            ) : templates.data && templates.data.length > 0 ? (
              <ul className="divide-y divide-border">
                {templates.data.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className={`text-sm ${t.is_active ? "" : "text-muted line-through"}`}>
                        {t.label}
                        {t.is_required && <span className="text-danger"> *</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {t.key} · {typeLabels[t.field_type]}
                        {t.options && t.options.length > 0 && ` · ${t.options.join(", ")}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => toggleActive.mutate({ id: t.id, is_active: !t.is_active })}
                    >
                      {t.is_active ? "Отключить" : "Включить"}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text="У этой категории пока нет доп-полей" />
            )}

            <div className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-3">
              <p className="text-xs font-semibold text-muted">Новое поле</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Заголовок" required>
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="IMEI" />
                </Field>
                <Field label="Ключ (латиницей, навсегда)" required>
                  <Input
                    value={key}
                    onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                    placeholder="imei"
                  />
                </Field>
                <Field label="Тип поля">
                  <Select value={fieldType} onChange={(e) => setFieldType(e.target.value as FieldType)}>
                    {(Object.keys(typeLabels) as FieldType[]).map((t) => (
                      <option key={t} value={t}>{typeLabels[t]}</option>
                    ))}
                  </Select>
                </Field>
                {(fieldType === "select" || fieldType === "multiselect") && (
                  <Field label="Варианты (через запятую)" required>
                    <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="вкл, выкл, не проверен" />
                  </Field>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 accent-primary" />
                Обязательное при приёмке
              </label>
              <ErrorText error={create.error} />
              <Button
                disabled={!label.trim() || !key.trim() || create.isPending ||
                  ((fieldType === "select" || fieldType === "multiselect") && !options.trim())}
                onClick={() => create.mutate()}
              >
                Добавить поле
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
