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
  signInWithEmailPassword: (email: string, password: string) => Promise<void>;
  signUpWithNameEmailPassword: (
    fullName: string,
    email: string,
    password: string
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function emailDomain(email: string | null | undefined): string {
  return email?.split("@")[1]?.toLowerCase() ?? "";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertAllowedEmail(email: string): void {
  const e = normalizeEmail(email);
  if (!e || !e.includes("@")) {
    throw new Error("Enter a valid email address.");
  }
  if (emailDomain(e) !== ALLOWED_DOMAIN) {
    throw new Error(`Only @${ALLOWED_DOMAIN} addresses can access DocketFlow.`);
  }
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
      signInWithEmailPassword: async (rawEmail: string, password: string) => {
        if (!isSupabaseConfigured()) {
          throw new Error("Supabase is not configured");
        }
        assertAllowedEmail(rawEmail);
        const email = normalizeEmail(rawEmail);
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      },
      signUpWithNameEmailPassword: async (
        fullName: string,
        rawEmail: string,
        password: string
      ) => {
        if (!isSupabaseConfigured()) {
          throw new Error("Supabase is not configured");
        }
        const name = fullName.trim();
        if (!name) throw new Error("Enter your name.");
        assertAllowedEmail(rawEmail);
        const email = normalizeEmail(rawEmail);
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }
        const supabase = createSupabaseBrowserClient();
        const emailRedirectTo = `${window.location.origin}/auth/callback`;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        const needsEmailConfirmation = !data.session;
        return { needsEmailConfirmation };
      },
      sendPasswordResetEmail: async (rawEmail: string) => {
        if (!isSupabaseConfigured()) {
          throw new Error("Supabase is not configured");
        }
        assertAllowedEmail(rawEmail);
        const email = normalizeEmail(rawEmail);
        const supabase = createSupabaseBrowserClient();
        const redirectTo = `${window.location.origin}/auth/update-password`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (error) throw error;
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
