import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/shared/api/supabase";
import { useAuth } from "@/app/AuthProvider";
import { Button, ErrorText, Field, Input, Spinner } from "@/shared/ui";

/**
 * Страница из письма восстановления: Supabase сам разбирает токен из URL
 * и создаёт recovery-сессию (detectSessionInUrl), остаётся задать пароль.
 */
export function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner className="min-h-dvh items-center" />;

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-surface border border-border p-6 text-center">
          <p className="text-sm">Ссылка устарела или недействительна.</p>
          <Link to="/login" className="mt-3 block text-sm text-primary hover:underline">
            Запросить новую на странице входа
          </Link>
        </div>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Пароль не короче 8 символов");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={(e) => void onSubmit(e)} className="w-full max-w-sm space-y-4 rounded-2xl bg-surface border border-border p-6">
        <div className="pb-2 text-center">
          <h1 className="text-xl font-bold">Новый пароль</h1>
        </div>
        <Field label="Пароль (мин. 8 символов)" required>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Ещё раз" required>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Сохраняем…" : "Сохранить и войти"}
        </Button>
      </form>
    </div>
  );
}
