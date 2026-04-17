import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// Setup SQL (run once in Supabase SQL editor):
//   create table reviews (
//     id bigint generated always as identity primary key,
//     locality text not null,
//     content text not null check (char_length(content) between 20 and 400),
//     helpful int not null default 0,
//     created_at timestamptz default now()
//   );
//   alter table reviews enable row level security;
//   create policy "allow anon select" on reviews for select to anon using (true);
//   create policy "allow anon insert" on reviews for insert to anon
//     with check (char_length(content) between 20 and 400);

const MAX_LOCALITY_LEN = 80;
const MIN_CONTENT = 20;
const MAX_CONTENT = 400;
const RL_READ_MAX = 60;
const RL_WRITE_MAX = 3;
const RL_WINDOW_MS = 60_000;
const RL_WRITE_WINDOW_MS = 10 * 60_000;

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`reviews-get:${ip}`, RL_READ_MAX, RL_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const locality = req.nextUrl.searchParams.get("locality")?.trim() ?? "";
  if (!locality || locality.length > MAX_LOCALITY_LEN || !/^[\w\s\-'.]+$/.test(locality)) {
    return NextResponse.json({ error: "Invalid locality" }, { status: 400 });
  }

  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return NextResponse.json({ reviews: [] });
  }

  const db = getSupabaseServer();
  const { data, error } = await db
    .from("reviews")
    .select("id, locality, content, helpful, created_at")
    .eq("locality", locality)
    .order("helpful", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("reviews fetch error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ reviews: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`reviews-post:${ip}`, RL_WRITE_MAX, RL_WRITE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { locality, content } = body as { locality?: unknown; content?: unknown };

  if (
    typeof locality !== "string" || !locality.trim() ||
    locality.trim().length > MAX_LOCALITY_LEN || !/^[\w\s\-'.]+$/.test(locality.trim()) ||
    typeof content !== "string" ||
    content.trim().length < MIN_CONTENT || content.trim().length > MAX_CONTENT
  ) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return NextResponse.json({ ok: true });
  }

  const db = getSupabaseServer();
  const { error } = await db
    .from("reviews")
    .insert({ locality: locality.trim(), content: content.trim() });

  if (error) {
    console.error("review insert error:", error.message);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
