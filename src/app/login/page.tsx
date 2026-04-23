"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { NarrowPageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import Link from "next/link";
import { Button } from "@/components/ui";

const FIRM_LOGO_PATH = "/firm-logo.webp";

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const { signInWithGoogle, user, loading, supabaseReady } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [logoError, setLogoError] = useState(false);

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
      <div className="relative flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-navy-deep via-navy to-navy-light px-6 py-16">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-pink/25 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 left-1/2 h-64 w-[120%] -translate-x-1/2 bg-primary/10 blur-3xl"
          aria-hidden
        />
        <div className="relative z-10 max-w-md text-center">
          <h1 className="font-serif text-2xl font-semibold tracking-tight !text-white">Sign in</h1>
          <p className="mt-3 text-sm text-white/65">
            Configure Supabase in{" "}
            <code className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs text-pink-light">
              .env.local
            </code>{" "}
            first, then reload this page.
          </p>
          <Link
            href="/"
            className="mt-8 inline-block text-sm font-medium text-white/70 transition hover:text-pink-light"
          >
            ← Back home
          </Link>
        </div>
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
    <div className="relative flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-navy-deep via-navy to-navy-light px-6 py-16">
      <div
        className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-pink/30 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-0 left-0 h-48 w-48 rounded-full bg-primary/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black,transparent)]"
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-xl shadow-black/20 ring-1 ring-white/10 backdrop-blur-sm">
            {!logoError ? (
              <Image
                src={FIRM_LOGO_PATH}
                alt="Firm logo"
                width={56}
                height={56}
                className="h-14 w-14 rounded-xl object-contain"
                onError={() => setLogoError(true)}
                unoptimized
              />
            ) : (
              <span className="font-serif text-3xl font-semibold text-white">D</span>
            )}
          </div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
            <span className="!text-white">Docket</span>
            <span className="text-pink">Flow</span>
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/70">
            Case deadlines, synced to your calendar. Sign in with your firm Google account.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-8 shadow-2xl shadow-black/30 ring-1 ring-white/5 backdrop-blur-md">
          <Button
            type="button"
            variant="secondary"
            className="group relative w-full overflow-hidden border-0 bg-white py-3.5 text-sm font-semibold text-navy shadow-lg shadow-black/15 transition hover:bg-surface-alt hover:shadow-xl"
            disabled={loading || googleBusy}
            onClick={() => void handleGoogleSignIn()}
          >
            <span className="flex w-full items-center justify-center gap-3">
              <GoogleMark className="h-5 w-5 shrink-0" />
              {googleBusy ? "Redirecting…" : "Continue with Google"}
            </span>
          </Button>

          {error && (
            <div
              className="mt-5 rounded-xl border border-danger/30 bg-danger/15 px-4 py-3 backdrop-blur-sm"
              role="alert"
            >
              <p className="text-center text-sm text-red-100">{error}</p>
            </div>
          )}
        </div>

        <div className="mt-10 flex justify-center">
          <Link
            href="/"
            className="text-sm font-medium text-white/55 transition hover:text-pink-light"
          >
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
