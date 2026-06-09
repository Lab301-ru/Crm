import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/shared/api/supabase";
import { useAuth } from "@/app/AuthProvider";
import { Button, ErrorText, Field, Input } from "@/shared/ui";

export function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message === "Invalid login credentials" ? "Неверный email или пароль" : authError.message);
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={(e) => void onSubmit(e)} className="w-full max-w-sm space-y-4 rounded-2xl bg-surface border border-border p-6">
        <div className="pb-2 text-center">
          <h1 className="text-xl font-bold">Сервис CRM</h1>
          <p className="mt-1 text-sm text-muted">Вход для сотрудников</p>
        </div>
        <Field label="Email" required>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Пароль" required>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Входим…" : "Войти"}
        </Button>
      </form>
    </div>
  );
}
