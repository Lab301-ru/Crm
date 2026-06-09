import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addCategory, fetchCategories, importCatalogBatch, searchModels, type ImportRow } from "@/shared/api/catalog";
import { useAuth } from "@/app/AuthProvider";
import { useDebounced } from "@/shared/lib/useDebounced";
import { Button, Card, EmptyState, ErrorText, Input, Spinner } from "@/shared/ui";

const BATCH_SIZE = 500;

export function CatalogPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();

  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories, staleTime: 60_000 });
  const [categoryId, setCategoryId] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const debouncedModel = useDebounced(modelQuery, 300);

  const models = useQuery({
    queryKey: ["models-browse", categoryId, debouncedModel],
    queryFn: () => searchModels(categoryId, null, debouncedModel),
    enabled: !!categoryId,
  });

  const [newCategory, setNewCategory] = useState("");
  const addCat = useMutation({
    mutationFn: () => addCategory(newCategory.trim()),
    onSuccess: () => {
      setNewCategory("");
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-bold">Справочник техники</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Категории">
          {categories.isLoading ? (
            <Spinner />
          ) : (
            <ul className="space-y-1">
              {categories.data?.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setCategoryId(c.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${categoryId === c.id ? "bg-primary/15 text-primary" : "hover:bg-surface-2"}`}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {isAdmin && (
            <div className="mt-3 flex gap-2 border-t border-border pt-3">
              <Input placeholder="Новая категория" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
              <Button variant="secondary" disabled={!newCategory.trim() || addCat.isPending} onClick={() => addCat.mutate()}>
                Добавить
              </Button>
            </div>
          )}
          <ErrorText error={addCat.error} />
        </Card>

        <Card title="Модели">
          {categoryId ? (
            <div className="space-y-3">
              <Input placeholder="Поиск модели…" value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} />
              {models.isLoading ? (
                <Spinner />
              ) : models.data && models.data.length > 0 ? (
                <ul className="divide-y divide-border text-sm">
                  {models.data.map((m) => (
                    <li key={m.id} className="py-2">
                      <span className="text-muted">{m.brands?.name}</span> {m.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState text={modelQuery ? "Не найдено" : "Введите название модели для поиска"} />
              )}
            </div>
          ) : (
            <EmptyState text="Выберите категорию слева" />
          )}
        </Card>
      </div>

      {isAdmin && <ImportCard />}
    </div>
  );
}

/* ---------------- Импорт Excel / CSV ---------------- */

interface ImportProgress {
  total: number;
  processed: number;
  inserted: number;
  skipped: number;
  errors: { row: number; error: string }[];
}

function ImportCard() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function parseFile(file: File): Promise<ImportRow[]> {
    const normalize = (rows: Record<string, unknown>[]): ImportRow[] =>
      rows
        .map((r) => {
          const keys = Object.keys(r);
          const get = (names: string[]) => {
            const k = keys.find((key) => names.includes(key.trim().toLowerCase()));
            return k ? String(r[k] ?? "").trim() : "";
          };
          return {
            category: get(["категория", "category"]),
            brand: get(["бренд", "brand", "марка"]),
            model: get(["модель", "model"]),
          };
        })
        .filter((r) => r.category || r.brand || r.model);

    // Парсеры тяжёлые — грузим только когда админ реально импортирует файл
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return normalize(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet));
    }
    const Papa = (await import("papaparse")).default;
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(normalize(res.data)),
        error: (err) => reject(new Error(err.message)),
      });
    });
  }

  async function runImport(file: File) {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) {
        throw new Error("В файле не найдены колонки «Категория», «Бренд», «Модель»");
      }
      const state: ImportProgress = { total: rows.length, processed: 0, inserted: 0, skipped: 0, errors: [] };
      setProgress({ ...state });

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const result = await importCatalogBatch(batch);
        state.processed += batch.length;
        state.inserted += result.inserted;
        state.skipped += result.skipped;
        state.errors.push(...result.errors.map((e) => ({ row: i + e.row, error: e.error })));
        setProgress({ ...state });
      }
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      void queryClient.invalidateQueries({ queryKey: ["models-browse"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card title="Импорт справочника (Excel / CSV)">
      <p className="mb-3 text-xs text-muted">
        Колонки: <b>Категория · Бренд · Модель</b> (первая строка — заголовки).
        Дубли пропускаются, недостающие категории и бренды создаются автоматически.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void runImport(file);
        }}
        className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-primary-hover"
      />
      {progress && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.round((progress.processed / progress.total) * 100)}%` }}
            />
          </div>
          <p className="text-muted">
            Обработано {progress.processed} из {progress.total} · добавлено {progress.inserted} · дублей {progress.skipped}
          </p>
          {progress.errors.length > 0 && (
            <details className="text-xs text-danger">
              <summary>Ошибки: {progress.errors.length}</summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {progress.errors.map((e, i) => (
                  <li key={i}>Строка {e.row}: {e.error}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
