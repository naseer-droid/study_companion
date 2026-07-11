import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, supabaseEnabled } from "@/lib/supabase/config";

// Hit by a Vercel cron so the free Supabase project never reaches its
// 7-days-idle pause. Uses the secret key (server-only) because no user
// session exists on a cron request; it only counts rows in the allowlist.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseEnabled || !process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ ok: true, skipped: "supabase not configured" });
  }
  const supabase = createSupabaseClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const { error, count } = await supabase
    .from("allowed_emails")
    .select("email", { count: "exact", head: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, allowedEmails: count });
}
