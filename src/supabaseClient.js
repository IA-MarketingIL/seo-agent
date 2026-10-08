import { createClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

// Why cloud sync is off, in words the user can act on. Misconfigurations here
// used to fail silently — the app kept working on localStorage alone and
// nobody noticed for months — so the reason is surfaced in the UI.
function diagnose() {
  if (!url) return "VITE_SUPABASE_URL חסר בבנייה";
  if (!key) return "VITE_SUPABASE_ANON_KEY חסר בבנייה";
  if (!/^https:\/\/.+\.supabase\.co$/i.test(url.replace(/\/$/, ""))) {
    return "VITE_SUPABASE_URL אינו כתובת Supabase (מתחיל ב: " + url.slice(0, 16) + "...)";
  }
  if (key.startsWith("sb_secret_")) return "VITE_SUPABASE_ANON_KEY מכיל מפתח סודי — יש לשים שם את ה-Publishable key";
  return null;
}

// anon/publishable key is safe to expose client-side — access is controlled by RLS
function init() {
  const problem = diagnose();
  if (problem) return { client: null, error: problem };
  try {
    return { client: createClient(url, key), error: null };
  } catch (e) {
    return { client: null, error: "הגדרות Supabase שגויות: " + e.message };
  }
}

const { client, error } = init();
if (error) console.error("Supabase disabled —", error);

export const supabase = client;
export const supabaseError = error;
