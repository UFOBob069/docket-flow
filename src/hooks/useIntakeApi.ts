"use client";

import { useCallback } from "react";
import { useAuth } from "@/context/AuthContext";

export function useIntakeApi() {
  const { idToken } = useAuth();

  const authHeaders = useCallback((): HeadersInit => {
    const h: HeadersInit = { "Content-Type": "application/json" };
    if (idToken) h.Authorization = `Bearer ${idToken}`;
    return h;
  }, [idToken]);

  const get = useCallback(
    async <T,>(path: string): Promise<T> => {
      const res = await fetch(path, { headers: authHeaders() });
      const json = (await res.json()) as T & { error?: string };
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed");
      return json;
    },
    [authHeaders]
  );

  const patch = useCallback(
    async <T,>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(path, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as T & { error?: string };
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed");
      return json;
    },
    [authHeaders]
  );

  const post = useCallback(
    async <T,>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(path, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as T & { error?: string };
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed");
      return json;
    },
    [authHeaders]
  );

  return { get, patch, post, ready: Boolean(idToken) };
}
