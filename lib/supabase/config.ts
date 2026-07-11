// Single switch for "cloud mode". When the Supabase env vars are absent
// (e.g. plain local dev), the app runs exactly like v1: no auth, JSON file.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
