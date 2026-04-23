"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const ALLOWED_DOMAIN = "ramosjames.com";

type AuthState = {
  user: User | null;
  idToken: string | null;
  loading: boolean;
  supabaseReady: boolean;
  /** Opens Google OAuth; session returns via /auth/callback (PKCE). */
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function emailDomain(email: string | null | undefined): string {
  return email?.split("@")[1]?.toLowerCase() ?? "";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const supabaseReady = isSupabaseConfigured();
  const [loading, setLoading] = useState(() => supabaseReady);

  useEffect(() => {
    if (!supabaseReady) {
      setLoading(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();

    const applySession = async (u: User | null, accessToken: string | null) => {
      if (u && emailDomain(u.email) !== ALLOWED_DOMAIN) {
        await supabase.auth.signOut();
        setUser(null);
        setIdToken(null);
        setLoading(false);
        return;
      }
      setUser(u);
      setIdToken(accessToken);
      setLoading(false);
    };

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void applySession(session?.user ?? null, session?.access_token ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.user ?? null, session?.access_token ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabaseReady]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      idToken,
      loading,
      supabaseReady,
      signInWithGoogle: async () => {
        if (!isSupabaseConfigured()) {
          throw new Error("Supabase is not configured");
        }
        const supabase = createSupabaseBrowserClient();
        const redirectTo = `${window.location.origin}/auth/callback`;
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo,
            queryParams: {
              hd: ALLOWED_DOMAIN,
              prompt: "select_account",
            },
          },
        });
        if (error) {
          const raw = `${error.message ?? ""} ${(error as { code?: string }).code ?? ""}`.toLowerCase();
          if (
            raw.includes("not enabled") ||
            raw.includes("unsupported provider") ||
            raw.includes("validation_failed")
          ) {
            throw new Error(
              "Google sign-in is not turned on for this Supabase project. Open Supabase Dashboard → Authentication → Providers → enable Google, then paste your Google Cloud OAuth client ID and client secret. Save, wait a few seconds, and try again."
            );
          }
          throw error;
        }
        if (data.url) {
          window.location.assign(data.url);
          return;
        }
        throw new Error(
          "Google sign-in did not return a redirect URL. Enable the Google provider in Supabase and confirm redirect URLs include /auth/callback for this app."
        );
      },
      logout: async () => {
        if (!isSupabaseConfigured()) return;
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
      },
    }),
    [user, idToken, loading, supabaseReady]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function userAvatarUrl(user: User | null): string | undefined {
  if (!user?.user_metadata) return undefined;
  const m = user.user_metadata as Record<string, string | undefined>;
  return m.avatar_url ?? m.picture;
}

export function userDisplayName(user: User | null): string {
  if (!user) return "";
  const m = user.user_metadata as Record<string, string | undefined>;
  return m.full_name ?? m.name ?? user.email ?? "";
}
