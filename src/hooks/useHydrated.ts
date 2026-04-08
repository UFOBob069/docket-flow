"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => {};
}

/**
 * false during SSR and client hydration; true after the client has mounted.
 * Avoid branching on env until this is true so server HTML matches the first client render.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
