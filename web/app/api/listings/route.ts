import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
import { scrapeNoBroker } from "@/lib/scrapers/nobroker";
import { scrape99Acres } from "@/lib/scrapers/99acres";
import { scrapeHousing } from "@/lib/scrapers/housing";
import type { Listing } from "@/lib/scrapers/types";

const CACHE_HOURS = 24;
const MAX_LOCALITY_LEN = 80;

export const runtime = "nodejs";
// Allow up to 30 s for scraping — Vercel Hobby plan limit
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const locality = req.nextUrl.searchParams.get("locality")?.trim() ?? "";

  if (!locality || locality.length > MAX_LOCALITY_LEN || !/^[\w\s\-'.]+$/.test(locality)) {
    return NextResponse.json({ error: "Invalid locality" }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - CACHE_HOURS * 60 * 60 * 1000).toISOString();
  const db = getSupabaseServer();

  // ── 1. Return cached results if still fresh ──────────────────────────────
  const { data: cached, error: cacheErr } = await db
    .from("listings")
    .select("*")
    .eq("locality", locality)
    .gte("fetched_at", cutoff)
    .order("price", { ascending: true })
    .limit(60);

  if (!cacheErr && cached && cached.length > 0) {
    return NextResponse.json({ listings: cached, cached: true, sources: [] });
  }

  // ── 2. Scrape all three sources in parallel ──────────────────────────────
  const [nbRes, a99Res, houRes] = await Promise.allSettled([
    scrapeNoBroker(locality),
    scrape99Acres(locality),
    scrapeHousing(locality),
  ]);

  const sourceStatus: { source: string; ok: boolean; count: number; error?: string }[] = [
    {
      source: "nobroker",
      ok: nbRes.status === "fulfilled",
      count: nbRes.status === "fulfilled" ? nbRes.value.length : 0,
      error: nbRes.status === "rejected" ? String(nbRes.reason) : undefined,
    },
    {
      source: "99acres",
      ok: a99Res.status === "fulfilled",
      count: a99Res.status === "fulfilled" ? a99Res.value.length : 0,
      error: a99Res.status === "rejected" ? String(a99Res.reason) : undefined,
    },
    {
      source: "housing",
      ok: houRes.status === "fulfilled",
      count: houRes.status === "fulfilled" ? houRes.value.length : 0,
      error: houRes.status === "rejected" ? String(houRes.reason) : undefined,
    },
  ];

  const allListings: Listing[] = [
    ...(nbRes.status === "fulfilled" ? nbRes.value : []),
    ...(a99Res.status === "fulfilled" ? a99Res.value : []),
    ...(houRes.status === "fulfilled" ? houRes.value : []),
  ];

  // ── 3. Upsert to Supabase (best-effort — don't fail the response) ────────
  if (allListings.length > 0) {
    const now = new Date().toISOString();
    const rows = allListings.map((l) => ({ ...l, fetched_at: now }));
    // upsert on (source, source_id) — ignore conflicts
    await db
      .from("listings")
      .upsert(rows, { onConflict: "source,source_id", ignoreDuplicates: false })
      .then(({ error }) => {
        if (error) console.error("listings upsert error:", error.message);
      });
  }

  // Sort by price asc
  allListings.sort((a, b) => a.price - b.price);

  return NextResponse.json({ listings: allListings, cached: false, sources: sourceStatus });
}
