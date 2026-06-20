import { useCallback, useEffect, useState } from "react";

/** Тема оформления: тёмная (по умолчанию) и светлая (светлый фон + оранжевые кнопки). */
export type Theme = "dark" | "light";

const KEY = "crm-theme";

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Применяет тему к <html> и обновляет цвет статус-бара; сохраняет выбор. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f4f6fa" : "#0B0F17");

  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

/** Реактивная тема + переключатель. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);

  return { theme, toggle };
}
