import { useEffect, useMemo } from "react";

/**
 * Черновики форм в localStorage — чтобы введённое не терялось при
 * выгрузке свёрнутой вкладки на мобильном или переходе между страницами.
 *
 * useDraftLoad — прочитать сохранённое один раз (на монтировании).
 * useDraftSave — писать значение при каждом изменении.
 * clearDraft   — удалить (после успешного сохранения/отправки).
 */
export function readDraft<T extends object>(key: string): Partial<T> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") as Partial<T>;
  } catch {
    return {};
  }
}

export function useDraftLoad<T extends object>(key: string): Partial<T> {
  return useMemo(() => readDraft<T>(key), [key]);
}

export function useDraftSave(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  useEffect(() => {
    localStorage.setItem(key, json);
  }, [key, json]);
}

export function clearDraft(key: string): void {
  localStorage.removeItem(key);
}
