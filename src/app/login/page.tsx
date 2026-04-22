"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { NarrowPageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import Link from "next/link";
import { Button, Card, CardBody, Input, Label } from "@/components/ui";

type Mode = "signin" | "signup" | "forgot";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useHydrated();
  const {
    signInWithEmailPassword,
    signUpWithNameEmailPassword,
    sendPasswordResetEmail,
    user,
    loading,
    supabaseReady,
  } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signupNotice, setSignupNotice] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);

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

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithEmailPassword(email, password);
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSignupNotice(null);
    if (password !== password2) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUpWithNameEmailPassword(
        fullName,
        email,
        password
      );
      if (needsEmailConfirmation) {
        setSignupNotice(
          "Check your email to confirm your account, then sign in here."
        );
        setMode("signin");
        setPassword("");
        setPassword2("");
      } else {
        router.replace("/");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await sendPasswordResetEmail(email);
      setForgotSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send reset email");
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
            @ramosjames.com accounts only
          </p>
        </div>

        <Card>
          <CardBody className="space-y-5">
            {signupNotice && (
              <div className="rounded-lg border border-success/20 bg-success-light px-4 py-3 text-sm text-text">
                {signupNotice}
              </div>
            )}

            {mode === "forgot" ? (
              forgotSent ? (
                <div className="rounded-lg border border-success/20 bg-success-light px-4 py-4 text-center text-sm text-text">
                  If <span className="font-medium">{email.trim().toLowerCase()}</span>{" "}
                  has an account, we sent a reset link. Check your inbox.
                </div>
              ) : (
                <form onSubmit={(e) => void handleForgot(e)} className="space-y-4">
                  <div>
                    <Label required>Work email</Label>
                    <Input
                      className="mt-1.5"
                      type="email"
                      autoComplete="email"
                      placeholder="you@ramosjames.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={busy || loading}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy || loading}>
                    {busy ? "Sending…" : "Send reset link"}
                  </Button>
                </form>
              )
            ) : mode === "signup" ? (
              <form onSubmit={(e) => void handleSignUp(e)} className="space-y-4">
                <div>
                  <Label required>Your name</Label>
                  <Input
                    className="mt-1.5"
                    type="text"
                    autoComplete="name"
                    placeholder="Jane Smith"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    disabled={busy || loading}
                  />
                </div>
                <div>
                  <Label required>Work email</Label>
                  <Input
                    className="mt-1.5"
                    type="email"
                    autoComplete="email"
                    placeholder="you@ramosjames.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={busy || loading}
                  />
                </div>
                <div>
                  <Label required>Password</Label>
                  <Input
                    className="mt-1.5"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    disabled={busy || loading}
                  />
                </div>
                <div>
                  <Label required>Confirm password</Label>
                  <Input
                    className="mt-1.5"
                    type="password"
                    autoComplete="new-password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    required
                    disabled={busy || loading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy || loading}>
                  {busy ? "Creating account…" : "Create account"}
                </Button>
              </form>
            ) : (
              <form onSubmit={(e) => void handleSignIn(e)} className="space-y-4">
                <div>
                  <Label required>Work email</Label>
                  <Input
                    className="mt-1.5"
                    type="email"
                    autoComplete="email"
                    placeholder="you@ramosjames.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={busy || loading}
                  />
                </div>
                <div>
                  <Label required>Password</Label>
                  <Input
                    className="mt-1.5"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={busy || loading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy || loading}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            )}

            {error && (
              <div className="rounded-lg border border-danger/20 bg-danger-light px-4 py-3" role="alert">
                <p className="text-center text-sm text-danger">{error}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-border pt-4 text-xs font-medium">
              {mode === "signin" && (
                <>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                      setSignupNotice(null);
                    }}
                  >
                    Create an account
                  </button>
                  <span className="text-text-dim">·</span>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setForgotSent(false);
                    }}
                  >
                    Forgot password?
                  </button>
                </>
              )}
              {mode === "signup" && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                  }}
                >
                  Already have an account? Sign in
                </button>
              )}
              {mode === "forgot" && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                    setForgotSent(false);
                  }}
                >
                  Back to sign in
                </button>
              )}
            </div>

            <p className="text-center text-xs text-text-dim">
              Enable <strong className="font-semibold text-text-secondary">Email</strong> with{" "}
              <strong className="font-semibold text-text-secondary">password</strong> in Supabase →
              Authentication → Providers. Add <code className="rounded bg-surface-alt px-1 font-mono text-[10px]">/auth/update-password</code> to redirect URLs if you use reset password.
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
