import type { FieldTemplate } from "@/shared/api/types";
import { Field, Input, Select } from "@/shared/ui";

/** Рендер динамического поля по шаблону категории. */
export function CustomFieldInput({ template, value, onChange }: {
  template: FieldTemplate;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { label, field_type, options, is_required } = template;

  switch (field_type) {
    case "text":
      return (
        <Field label={label} required={is_required}>
          <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
        </Field>
      );
    case "number":
      return (
        <Field label={label} required={is_required}>
          <Input
            type="number"
            inputMode="decimal"
            value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
        </Field>
      );
    case "date":
      return (
        <Field label={label} required={is_required}>
          <Input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
        </Field>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {label}
        </label>
      );
    case "select":
      return (
        <Field label={label} required={is_required}>
          <Select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">—</option>
            {(options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </Select>
        </Field>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (opt: string) => {
        const next = selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt];
        onChange(next.length ? next : undefined);
      };
      return (
        <Field label={label} required={is_required}>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(options ?? []).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  selected.includes(opt)
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-surface-2 text-muted hover:text-text"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </Field>
      );
    }
  }
}
