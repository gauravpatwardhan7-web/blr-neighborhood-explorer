import { NextRequest, NextResponse } from "next/server";

// Setup: create a Supabase project, run this SQL:
//   create table signups (
//     id bigint generated always as identity primary key,
//     email text unique not null,
//     created_at timestamptz default now()
//   );
// Then add SUPABASE_URL and SUPABASE_SERVICE_KEY to Vercel env vars.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email } = body as { email?: string };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Supabase not configured yet — silently succeed so the gate still works
    return NextResponse.json({ ok: true });
  }

  const res = await fetch(`${supabaseUrl}/rest/v1/signups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    console.error("Supabase insert failed", await res.text());
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
