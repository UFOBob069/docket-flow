"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { NarrowPageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import Link from "next/link";
import { Button, Card, CardBody } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const { signInWithGoogle, user, loading, supabaseReady } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    if (searchParams.get("error") === "auth") {
      setError("That sign-in link was invalid or expired.");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  if (!hydrated) return <NarrowPageSkeleton />;

  if (!supabaseReady) {
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <h1 className="text-xl font-semibold text-text">Sign in</h1>
        <p className="mt-2 text-sm text-text-muted">
          Configure Supabase in{" "}
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
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setGoogleBusy(false);
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
            Sign in with your firm Google account (@ramosjames.com)
          </p>
        </div>

        <Card>
          <CardBody className="space-y-5">
            <Button
              type="button"
              variant="secondary"
              className="w-full border border-border bg-white py-2.5 text-sm font-semibold text-text shadow-sm hover:bg-surface-alt"
              disabled={loading || googleBusy}
              onClick={() => void handleGoogleSignIn()}
            >
              {googleBusy ? "Redirecting…" : "Continue with Google"}
            </Button>

            {error && (
              <div
                className="rounded-lg border border-danger/20 bg-danger-light px-4 py-3"
                role="alert"
              >
                <p className="text-center text-sm text-danger">{error}</p>
              </div>
            )}

            <p className="text-center text-xs text-text-dim">
              In Supabase → Authentication → Providers: enable{" "}
              <strong className="font-semibold text-text-secondary">Google</strong>{" "}
              (Client ID and secret from Google Cloud Console → OAuth consent). Add redirect URL{" "}
              <code className="rounded bg-surface-alt px-1 font-mono text-[10px]">
                /auth/callback
              </code>{" "}
              for your site URL and production domain.
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

export default function LoginPage() {
  return (
    <Suspense fallback={<NarrowPageSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
