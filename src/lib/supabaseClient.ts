"use client";

import { createClient } from "@supabase/supabase-js";

// Browser client (safe: uses the public anon key).
// Fallbacks keep module load from throwing during `next build` when env
// vars aren't present yet; real values are injected at build/runtime.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(url, anon, {
  realtime: { params: { eventsPerSecond: 5 } },
});
