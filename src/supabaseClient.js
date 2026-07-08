import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// anon key is safe to expose client-side — access is controlled by Row Level Security
function init() {
  if (!url || !key) return null;
  try {
    return createClient(url, key);
  } catch (e) {
    // misconfigured env (e.g. key pasted into VITE_SUPABASE_URL) — run without
    // cloud sync instead of white-screening the whole app
    console.error("Supabase disabled — bad config:", e.message);
    return null;
  }
}

export const supabase = init();
