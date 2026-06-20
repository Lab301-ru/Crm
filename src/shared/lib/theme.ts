import { useEffect, useReducer } from "react";

/** Тема оформления: тёмная (по умолчанию) и светлая (светлый фон + оранжевые кнопки). */
export type Theme = "dark" | "light";

const KEY = "crm-theme";

function readStored(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Применяет тему к <html> и обновляет цвет статус-бара; сохраняет выбор. */
function applyTheme(theme: Theme): void {
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

// Общий стор, чтобы все подписчики (переключатель, логотип) обновлялись разом.
let current: Theme = readStored();
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  if (theme === current) return;
  current = theme;
  applyTheme(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme(): void {
  setTheme(current === "light" ? "dark" : "light");
}

// Синхронизируем DOM/meta с сохранённым значением на старте (атрибут уже
// выставлен инлайн-скриптом в index.html — это страхует meta/localStorage).
applyTheme(current);

/** Реактивная тема + переключатель (общее состояние на всё приложение). */
export function useTheme() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return { theme: current, toggle: toggleTheme };
}
