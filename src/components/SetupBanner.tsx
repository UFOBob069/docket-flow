"use client";

import { isFirebaseConfigured } from "@/lib/firebase/config";
import { useHydrated } from "@/hooks/useHydrated";

export function SetupBanner() {
  const hydrated = useHydrated();
  if (!hydrated || isFirebaseConfigured()) return null;
  return (
    <div className="border-b border-pink/20 bg-pink-light px-4 py-2.5 text-center text-xs font-medium text-pink sm:text-sm">
      <strong className="font-semibold">Setup required.</strong>{" "}
      Copy{" "}
      <code className="rounded bg-pink/10 px-1.5 py-0.5 font-mono text-pink">
        .env.example
      </code>{" "}
      to{" "}
      <code className="rounded bg-pink/10 px-1.5 py-0.5 font-mono text-pink">
        .env.local
      </code>{" "}
      and add your Firebase web app keys.
    </div>
  );
}
