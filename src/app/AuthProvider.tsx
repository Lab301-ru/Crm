import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/shared/api/supabase";
import type { Profile } from "@/shared/api/types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /** true, пока неизвестно, есть ли сессия */
  loading: boolean;
  /** true, пока после входа грузится профиль (роль) */
  profileLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  profileLoading: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    // supabase-js сам обновляет access token; здесь ловим вход/выход/смену токена
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    supabase
      .from("profiles").select("*").eq("id", session.user.id).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        // null = профиль не создан или сотрудник деактивирован (RLS не отдаёт строку)
        setProfile((data as Profile | null) ?? null);
        setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, profile, loading, profileLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
