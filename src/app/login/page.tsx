"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { NarrowPageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import Link from "next/link";
import { Card, CardBody } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { signInWithGoogle, user, loading, firebaseReady } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  if (!hydrated) return <NarrowPageSkeleton />;

  if (!firebaseReady) {
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <h1 className="text-xl font-semibold text-text">Sign in</h1>
        <p className="mt-2 text-sm text-text-muted">
          Configure Firebase in{" "}
          <code className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-sm text-primary">
            .env.local
          </code>{" "}
          first, then reload this page.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
        >
          ← Back home
        </Link>
      </div>
    );
  }

  async function handleGoogleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      router.replace("/");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Authentication failed"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Sign in to DocketFlow
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Internal access — @ramosjames.com accounts only
          </p>
        </div>

        <Card>
          <CardBody className="space-y-6">
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void handleGoogleSignIn()}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold text-text shadow-sm transition-colors hover:bg-surface-alt disabled:opacity-50"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {busy ? "Signing in…" : "Continue with Google"}
            </button>

            {error && (
              <div className="rounded-lg border border-danger/20 bg-danger-light px-4 py-3" role="alert">
                <p className="text-center text-sm text-danger">{error}</p>
              </div>
            )}

            <p className="text-center text-xs text-text-dim">
              Only <strong className="font-semibold text-text-secondary">@ramosjames.com</strong>{" "}
              Google Workspace accounts can sign in.
            </p>
          </CardBody>
        </Card>

        <div className="mt-6 flex justify-center">
          <Link href="/" className="text-sm text-text-muted hover:text-primary">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
