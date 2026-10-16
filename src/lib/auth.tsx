import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, PROFILE_COLS, urlAuthError } from "./supabase";
import type { Profile } from "./types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  authError: string | null;
  clearAuthError: () => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(urlAuthError);
  const uidRef = useRef<string | undefined>(undefined);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    uidRef.current = uid;
    if (!uid) { setProfile(null); return; }
    const own = async () => {
      const r = await supabase.rpc("my_profile");
      // Before the privacy migration, my_profile() doesn't exist yet: read the table.
      if (r.error?.code === "PGRST202") return (await supabase.from("profiles").select(PROFILE_COLS + ", city").eq("id", uid).maybeSingle()).data;
      return ((r.data as Profile[] | null) || [])[0] ?? null;
    };
    let data = await own();
    if (!data) {
      // Users who signed up through another app on the same Supabase project have no profile yet.
      await supabase.rpc("ensure_profile");
      data = await own();
    }
    if (uidRef.current !== uid) return; // signed out or switched account meanwhile
    setProfile((data as Profile) ?? { id: uid, display_name: "", avatar_path: null, city: null, role: "user", created_at: new Date().toISOString() });
  }, []);

  useEffect(() => {
    let alive = true;
    // getSession waits for the client to finish reading a sign-in redirect from the URL.
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!alive) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!alive) return;
      setSession(s);
      if (event === "SIGNED_IN") setAuthError(null);
      // Only refetch the profile when the user changes, and outside the auth callback.
      if (s?.user.id !== uidRef.current) setTimeout(() => loadProfile(s?.user.id), 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value: AuthState = {
    session,
    profile,
    loading,
    isAdmin: profile?.role === "admin",
    authError,
    clearAuthError: () => setAuthError(null),
    refreshProfile: () => loadProfile(session?.user.id),
    signOut: async () => { await supabase.auth.signOut(); setSession(null); setProfile(null); uidRef.current = undefined; },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
