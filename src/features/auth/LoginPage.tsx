import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/shared/api/supabase";
import { useAuth } from "@/app/AuthProvider";
import { Button, ErrorText, Field, Input } from "@/shared/ui";

export function LoginPage() {
  const { session } = useAuth();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(
        authError.message === "Invalid login credentials"
          ? "Неверный email или пароль"
          : authError.message.includes("banned")
            ? "Доступ отключён — обратитесь к администратору"
            : authError.message,
      );
    }
    setBusy(false);
  };

  const onForgot = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (resetError) setError(resetError.message);
    else setInfo("Письмо со ссылкой для смены пароля отправлено. Проверьте почту.");
    setBusy(false);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form
        onSubmit={(e) => void (mode === "login" ? onLogin(e) : onForgot(e))}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-surface border border-border p-6"
      >
        <div className="pb-2 text-center">
          <h1 className="text-xl font-bold">ultra<span className="text-primary">CRM</span></h1>
          <p className="mt-1 text-sm text-muted">
            {mode === "login" ? "Вход для сотрудников" : "Восстановление пароля"}
          </p>
        </div>

        <Field label="Email" required>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>

        {mode === "login" && (
          <Field label="Пароль" required>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
        )}

        <ErrorText error={error} />
        {info && <p className="py-2 text-sm text-success">{info}</p>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Подождите…" : mode === "login" ? "Войти" : "Отправить ссылку"}
        </Button>

        <button
          type="button"
          onClick={() => { setMode(mode === "login" ? "forgot" : "login"); setError(null); setInfo(null); }}
          className="block w-full text-center text-xs text-muted hover:text-text"
        >
          {mode === "login" ? "Забыли пароль?" : "← Вернуться ко входу"}
        </button>
      </form>
    </div>
  );
}
