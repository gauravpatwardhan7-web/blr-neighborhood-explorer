import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

const MAX_LOCALITY_LEN = 80;

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const locality = req.nextUrl.searchParams.get("locality")?.trim() ?? "";

  if (!locality || locality.length > MAX_LOCALITY_LEN || !/^[\w\s\-'.]+$/.test(locality)) {
    return NextResponse.json({ error: "Invalid locality" }, { status: 400 });
  }

  const db = getSupabaseServer();

  const { data: listings, error } = await db
    .from("listings")
    .select("*")
    .eq("locality", locality)
    .order("price", { ascending: true })
    .limit(60);

  if (error) {
    console.error("listings fetch error:", error.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const fetchedAt = listings && listings.length > 0
    ? listings.reduce((latest, l) => l.fetched_at > latest ? l.fetched_at : latest, listings[0].fetched_at)
    : null;

  return NextResponse.json({
    listings: listings ?? [],
    cached: true,
    fetchedAt,
    sources: [],
  });
}
