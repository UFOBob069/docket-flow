"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { FederalHolidayIndex } from "@/lib/federal-holidays";
import { getBrowserSupabase } from "@/lib/supabase/singleton";

export function useFederalHolidays(): {
  holidays: FederalHolidayIndex | null;
  ready: boolean;
  error: string | null;
} {
  const { user, supabaseReady } = useAuth();
  const [holidays, setHolidays] = useState<FederalHolidayIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseReady || !user || !isSupabaseConfigured()) {
      setHolidays(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const supabase = getBrowserSupabase();
    void (async () => {
      const { data, error: qErr } = await supabase
        .from("federal_holidays")
        .select("observed_date, name");
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setHolidays(null);
        return;
      }
      const index = new Map<string, string>();
      for (const row of data ?? []) {
        const d = String(row.observed_date).slice(0, 10);
        if (d && row.name) index.set(d, String(row.name));
      }
      setHolidays(index);
      setError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, supabaseReady]);

  return { holidays, ready: holidays !== null, error };
}
