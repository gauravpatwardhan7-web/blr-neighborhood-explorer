import { NextRequest, NextResponse } from "next/server";

// Setup: create a Supabase project, run this SQL:
//   create table signups (
//     id bigint generated always as identity primary key,
//     email text unique not null,
//     created_at timestamptz default now()
//   );
//   -- Allow anonymous inserts only (no reads/updates/deletes from the outside)
//   alter table signups enable row level security;
//   create policy "allow anon insert" on signups for insert to anon with check (true);
//
// Uses the ANON key (not service_role) — anon key is safe to use server-side
// because RLS above restricts it to insert-only on this one table.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email } = body as { email?: string };

  // Validate: must be a plausible email, max 254 chars (RFC 5321)
  if (
    !email ||
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY; // anon key + RLS, not service_role

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
