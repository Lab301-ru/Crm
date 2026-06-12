import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Мастерская в подвале — сеть пропадает. PWA продолжает показывать
 * сохранённые данные, а смена статусов и диагностика встают в очередь;
 * баннер объясняет, что происходит, чтобы «зависшая» кнопка не пугала.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine);
  if (online) return null;
  return (
    <div className="sticky top-0 z-50 border-b border-warning/40 bg-warning/15 px-4 py-2 text-center text-xs font-medium text-warning">
      Нет сети — показаны сохранённые данные. Смена статусов и диагностика отправятся при подключении.
    </div>
  );
}
