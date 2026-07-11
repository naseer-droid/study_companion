import { supabaseEnabled } from "./supabase/config";
import { createClient } from "./supabase/server";

// The single-user id used when running without Supabase (v1-style local dev).
export const LOCAL_USER_ID = "local";

// Returns the signed-in user's id, LOCAL_USER_ID in local mode,
// or null when the request is unauthenticated in cloud mode.
export async function getUserId(): Promise<string | null> {
  if (!supabaseEnabled) return LOCAL_USER_ID;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
}
