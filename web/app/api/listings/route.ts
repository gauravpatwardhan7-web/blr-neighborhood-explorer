import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import type { Listing } from "@/lib/scrapers/types";

const MAX_LOCALITY_LEN = 80;
// Rate limit: 30 requests per IP per minute
const RL_MAX = 30;
const RL_WINDOW_MS = 60_000;

export const runtime = "nodejs";

// ── Test fixtures ─────────────────────────────────────────────────────────────
// Use locality="_test_" to get deterministic mock listings without DB access.
// Useful for verifying the listings UI in any environment.
const TEST_LOCALITY = "_test_";
type TestRow = Listing & { id: string; fetched_at: string };
const TEST_LISTINGS: TestRow[] = [
  {
    id: "test-1",
    locality: TEST_LOCALITY,
    source: "nobroker",
    source_id: "test-nb-001",
    source_url: "https://www.nobroker.in",
    title: "2BHK Semi-furnished near Metro",
    price: 28000,
    deposit: 84000,
    area_sqft: 1100,
    bhk: 2,
    property_type: "apartment",
    furnishing: "semi-furnished",
    lat: 12.9716,
    lon: 77.5946,
    address: "2nd Cross, Malleswaram, Bengaluru",
    images: [],
    fetched_at: new Date().toISOString(),
  },
  {
    id: "test-2",
    locality: TEST_LOCALITY,
    source: "housing",
    source_id: "test-hc-002",
    source_url: "https://housing.com",
    title: "1BHK Furnished Studio",
    price: 18000,
    deposit: 36000,
    area_sqft: 580,
    bhk: 1,
    property_type: "apartment",
    furnishing: "furnished",
    lat: 12.9352,
    lon: 77.6245,
    address: "Koramangala 4th Block, Bengaluru",
    images: [],
    fetched_at: new Date().toISOString(),
  },
  {
    id: "test-3",
    locality: TEST_LOCALITY,
    source: "housing",
    source_id: "test-hc-003",
    source_url: "https://housing.com",
    title: "3BHK Unfurnished Family Flat",
    price: 45000,
    deposit: 135000,
    area_sqft: 1650,
    bhk: 3,
    property_type: "apartment",
    furnishing: "unfurnished",
    lat: 12.9784,
    lon: 77.6408,
    address: "Bagmane Tech Park Road, CV Raman Nagar, Bengaluru",
    images: [],
    fetched_at: new Date().toISOString(),
  },
  {
    id: "test-4",
    locality: TEST_LOCALITY,
    source: "nobroker",
    source_id: "test-nb-004",
    source_url: "https://www.nobroker.in",
    title: "2BHK Furnished — no geo",
    price: 32000,
    deposit: 96000,
    area_sqft: 1000,
    bhk: 2,
    property_type: "apartment",
    furnishing: "furnished",
    address: "HSR Layout Sector 2, Bengaluru",
    images: [],
    fetched_at: new Date().toISOString(),
  },
  {
    id: "test-5",
    locality: TEST_LOCALITY,
    source: "housing",
    source_id: "test-hc-005",
    source_url: "https://housing.com",
    title: "4BHK Independent Villa",
    price: 120000,
    deposit: 360000,
    area_sqft: 3200,
    bhk: 3,
    property_type: "villa",
    furnishing: "semi-furnished",
    lat: 12.9406,
    lon: 77.6969,
    address: "RMZ Ecospace, Bellandur, Bengaluru",
    images: [],
    fetched_at: new Date().toISOString(),
  },
];

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`listings:${ip}`, RL_MAX, RL_WINDOW_MS);
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

  // Return test fixtures without touching the DB
  if (locality === TEST_LOCALITY) {
    return NextResponse.json({
      listings: TEST_LISTINGS,
      cached: false,
      fetchedAt: new Date().toISOString(),
      sources: [],
    });
  }

  const db = getSupabaseServer();

  // Explicit column list — never expose internal or future columns added to the table.
  const COLUMNS = [
    "id", "locality", "source", "source_id", "source_url",
    "title", "price", "deposit", "area_sqft", "bhk",
    "property_type", "furnishing", "lat", "lon",
    "address", "images", "fetched_at",
  ].join(", ");

  type ListingRow = { fetched_at: string | null; [key: string]: unknown };
  const { data: rawListings, error } = await db
    .from("listings")
    .select(COLUMNS)
    .eq("locality", locality)
    .order("price", { ascending: true })
    .limit(60);

  if (error) {
    console.error("listings fetch error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const listings = (rawListings ?? []) as unknown as ListingRow[];

  const fetchedAt = listings.length > 0
    ? listings.reduce((latest, l) => {
        const t = l.fetched_at ?? "";
        return t > latest ? t : latest;
      }, listings[0].fetched_at ?? "")
    : null;

  return NextResponse.json({
    listings: listings ?? [],
    cached: true,
    fetchedAt,
    sources: [],
  });
}
