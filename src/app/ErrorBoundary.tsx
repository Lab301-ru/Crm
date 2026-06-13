import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/shared/ui";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Ловит ошибки рендера внутри роута, чтобы один сбойный экран (например
 * битая карточка заказа) не ронял всё приложение белым экраном.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[60dvh] items-center justify-center p-4">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-surface p-6 text-center">
            <p className="text-lg font-semibold">Что-то пошло не так</p>
            <p className="text-sm text-muted">
              Не удалось отобразить эту страницу. Попробуйте обновить или вернуться назад.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => window.location.reload()}>Обновить</Button>
              <Button variant="secondary" className="flex-1" onClick={this.reset}>Назад</Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
