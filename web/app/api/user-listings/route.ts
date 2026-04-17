import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// Setup SQL (run once in Supabase SQL editor):
//   create table user_listings (
//     id bigint generated always as identity primary key,
//     locality text not null,
//     bhk int check (bhk between 1 and 10),
//     price int not null check (price between 1000 and 5000000),
//     deposit int check (deposit >= 0 and deposit <= 10000000),
//     area_sqft int check (area_sqft between 100 and 20000),
//     furnishing text check (furnishing in ('furnished','semi-furnished','unfurnished')),
//     address text check (char_length(address) <= 200),
//     contact text check (char_length(contact) <= 100),
//     lat double precision check (lat between 12.7 and 13.2),
//     lon double precision check (lon between 77.4 and 77.9),
//     created_at timestamptz default now()
//   );
//   alter table user_listings enable row level security;
//   create policy "allow anon select" on user_listings for select to anon using (true);
//   create policy "allow anon insert" on user_listings for insert to anon
//     with check (price between 1000 and 5000000);

const MAX_LOCALITY_LEN = 80;
const VALID_FURNISHING = new Set(["furnished", "semi-furnished", "unfurnished"]);
const BLR_LAT_MIN = 12.7, BLR_LAT_MAX = 13.2;
const BLR_LON_MIN = 77.4, BLR_LON_MAX = 77.9;
const RL_READ_MAX = 60;
const RL_WRITE_MAX = 2;
const RL_WINDOW_MS = 60_000;
const RL_WRITE_WINDOW_MS = 10 * 60_000;

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`ul-get:${ip}`, RL_READ_MAX, RL_WINDOW_MS);
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
    return NextResponse.json({ listings: [] });
  }

  const db = getSupabaseServer();
  const { data, error } = await db
    .from("user_listings")
    .select("id, locality, bhk, price, deposit, area_sqft, furnishing, address, contact, lat, lon, created_at")
    .eq("locality", locality)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("user_listings fetch error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ listings: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`ul-post:${ip}`, RL_WRITE_MAX, RL_WRITE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { locality, bhk, price, deposit, area_sqft, furnishing, address, contact, lat, lon } = body as {
    locality?: unknown; bhk?: unknown; price?: unknown; deposit?: unknown;
    area_sqft?: unknown; furnishing?: unknown; address?: unknown; contact?: unknown;
    lat?: unknown; lon?: unknown;
  };

  if (
    typeof locality !== "string" || !locality.trim() ||
    locality.trim().length > MAX_LOCALITY_LEN || !/^[\w\s\-'.]+$/.test(locality.trim()) ||
    typeof price !== "number" || !Number.isInteger(price) || price < 1000 || price > 5_000_000
  ) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  if (bhk !== undefined && bhk !== null &&
    (typeof bhk !== "number" || !Number.isInteger(bhk) || bhk < 1 || bhk > 10))
    return NextResponse.json({ error: "Invalid BHK" }, { status: 400 });
  if (deposit !== undefined && deposit !== null &&
    (typeof deposit !== "number" || !Number.isInteger(deposit) || deposit < 0 || deposit > 10_000_000))
    return NextResponse.json({ error: "Invalid deposit" }, { status: 400 });
  if (area_sqft !== undefined && area_sqft !== null &&
    (typeof area_sqft !== "number" || !Number.isInteger(area_sqft) || area_sqft < 100 || area_sqft > 20_000))
    return NextResponse.json({ error: "Invalid area" }, { status: 400 });
  if (furnishing !== undefined && furnishing !== null &&
    (typeof furnishing !== "string" || !VALID_FURNISHING.has(furnishing)))
    return NextResponse.json({ error: "Invalid furnishing" }, { status: 400 });
  if (address !== undefined && address !== null &&
    (typeof address !== "string" || address.length > 200))
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  if (contact !== undefined && contact !== null &&
    (typeof contact !== "string" || contact.length > 100))
    return NextResponse.json({ error: "Invalid contact" }, { status: 400 });
  const hasLat = lat !== undefined && lat !== null;
  const hasLon = lon !== undefined && lon !== null;
  if (hasLat !== hasLon) return NextResponse.json({ error: "lat/lon must be provided together" }, { status: 400 });
  if (hasLat && (
    typeof lat !== "number" || typeof lon !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < BLR_LAT_MIN || lat > BLR_LAT_MAX ||
    lon < BLR_LON_MIN || lon > BLR_LON_MAX
  )) return NextResponse.json({ error: "Pin must be within Bengaluru" }, { status: 400 });

  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return NextResponse.json({ ok: true });
  }

  const db = getSupabaseServer();
  const { error } = await db.from("user_listings").insert({
    locality: (locality as string).trim(),
    bhk: (bhk as number | undefined) ?? null,
    price: price as number,
    deposit: (deposit as number | undefined) ?? null,
    area_sqft: (area_sqft as number | undefined) ?? null,
    furnishing: (furnishing as string | undefined) ?? null,
    address: address ? (address as string).trim().slice(0, 200) : null,
    contact: contact ? (contact as string).trim().slice(0, 100) : null,
    lat: hasLat ? (lat as number) : null,
    lon: hasLon ? (lon as number) : null,
  });

  if (error) {
    console.error("user_listing insert error:", error.message);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
