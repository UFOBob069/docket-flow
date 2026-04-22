"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { NarrowPageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import { Button, Card, CardBody, Input, Label, PageWrapper } from "@/components/ui";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createSupabaseBrowserClient();
    void (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) {
          setError(exErr.message);
          setReady(false);
          return;
        }
        url.searchParams.delete("code");
        window.history.replaceState({}, "", `${url.pathname}${url.hash}`);
      }
      const { data: { session } } = await supabase.auth.getSession();
      setReady(Boolean(session));
    })();
  }, []);

  if (!hydrated) return <NarrowPageSkeleton />;

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase.</p>
      </PageWrapper>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) throw upErr;
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <PageWrapper className="mx-auto max-w-md py-16">
        <Card>
          <CardBody className="space-y-3 text-center text-sm text-text-muted">
            {error ? (
              <p className="text-danger">{error}</p>
            ) : (
              <>
                <p>Open the password reset link from your email in this browser tab.</p>
                <p>If the link expired, request a new one from the login page.</p>
              </>
            )}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </CardBody>
        </Card>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="mx-auto max-w-md py-16">
      <h1 className="text-xl font-semibold text-text">Set a new password</h1>
      <Card className="mt-6">
        <CardBody>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <Label required>New password</Label>
              <Input
                className="mt-1.5"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={busy}
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
                disabled={busy}
              />
            </div>
            {error && (
              <p className="text-sm text-danger">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Update password"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </PageWrapper>
  );
}
