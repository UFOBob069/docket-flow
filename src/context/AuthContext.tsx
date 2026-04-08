"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  type User,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { isFirebaseConfigured } from "@/lib/firebase/config";

const ALLOWED_DOMAIN = "ramosjames.com";

type AuthState = {
  user: User | null;
  idToken: string | null;
  loading: boolean;
  firebaseReady: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function emailDomain(email: string | null): string {
  return email?.split("@")[1]?.toLowerCase() ?? "";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => isFirebaseConfigured());
  const firebaseReady = isFirebaseConfigured();

  useEffect(() => {
    if (!firebaseReady) return;
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, async (u) => {
      if (u && emailDomain(u.email) !== ALLOWED_DOMAIN) {
        await signOut(auth);
        setUser(null);
        setIdToken(null);
        setLoading(false);
        return;
      }
      setUser(u);
      if (u) {
        const t = await u.getIdToken();
        setIdToken(t);
      } else {
        setIdToken(null);
      }
      setLoading(false);
    });
  }, [firebaseReady]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      idToken,
      loading,
      firebaseReady,
      signInWithGoogle: async () => {
        if (!isFirebaseConfigured()) {
          throw new Error("Firebase is not configured");
        }
        const auth = getFirebaseAuth();
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ hd: ALLOWED_DOMAIN });
        const result = await signInWithPopup(auth, provider);
        if (emailDomain(result.user.email) !== ALLOWED_DOMAIN) {
          await signOut(auth);
          throw new Error(
            `Only @${ALLOWED_DOMAIN} accounts can access DocketFlow.`
          );
        }
      },
      logout: async () => {
        if (!isFirebaseConfigured()) return;
        const auth = getFirebaseAuth();
        await signOut(auth);
      },
    }),
    [user, idToken, loading, firebaseReady]
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
