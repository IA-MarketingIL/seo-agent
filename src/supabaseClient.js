import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// anon key is safe to expose client-side — access is controlled by Row Level Security
export const supabase = url && key ? createClient(url, key) : null;
