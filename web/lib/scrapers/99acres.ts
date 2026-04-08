import * as cheerio from "cheerio";
import type { Listing } from "./types";

// 99acres search page embeds listing data in window.__INITIAL_DATA__ or window.INITIAL_STATE
// We fetch the HTML and extract it.

function buildUrl(locality: string): string {
  const slug = locality.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `https://www.99acres.com/flats-for-rent-in-${slug}-bengaluru-ffid/?preference=S&area=38&city=38&prop_type=10&res_com=R`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractJson(html: string): any {
  const $ = cheerio.load(html);

  // Pattern 1: __INITIAL_DATA__
  let json: unknown = null;
  $("script").each((_, el) => {
    const src = $(el).html() ?? "";
    const m = src.match(/window\.__INITIAL_DATA__\s*=\s*(\{[\s\S]+?\});?\s*(?:window|var|\n|$)/);
    if (m) {
      try { json = JSON.parse(m[1]); } catch { /* continue */ }
    }
    if (!json) {
      const m2 = src.match(/window\.INITIAL_STATE\s*=\s*(\{[\s\S]+?\});?\s*(?:window|var|\n|$)/);
      if (m2) {
        try { json = JSON.parse(m2[1]); } catch { /* continue */ }
      }
    }
  });
  return json;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProperty(locality: string, p: any): Listing | null {
  const id = String(p.PROP_ID ?? p.id ?? p.propId ?? "");
  if (!id) return null;

  const price = Number(p.PROP_RENT ?? p.rent ?? p.price ?? p.expectedRent ?? 0);
  if (!price) return null;

  const bhkRaw = String(p.BEDROOM_NUM ?? p.bedrooms ?? p.bhk ?? "");
  const bhkMatch = bhkRaw.match(/\d+/);
  const bhk = bhkMatch ? Number(bhkMatch[0]) : undefined;

  const furnishing = (() => {
    const f = String(p.FURNISH_STATUS ?? p.furnishing ?? "").toLowerCase();
    if (f.includes("full")) return "furnished";
    if (f.includes("semi")) return "semi-furnished";
    if (f.includes("unfurnish") || f.includes("un-furnish")) return "unfurnished";
    return undefined;
  })();

  const lat = p.LATITUDE ? Number(p.LATITUDE) : (p.latitude ? Number(p.latitude) : undefined);
  const lon = p.LONGITUDE ? Number(p.LONGITUDE) : (p.longitude ? Number(p.longitude) : undefined);

  const images: string[] = [];
  const imgArr: unknown[] = p.PROP_IMAGES ?? p.images ?? [];
  imgArr.slice(0, 4).forEach((img: unknown) => {
    const url = typeof img === "string" ? img : (img as Record<string, string>)?.IMAGE_FILENAME;
    if (url && url.startsWith("http")) images.push(url);
  });

  const slug = id;
  return {
    locality,
    source: "99acres",
    source_id: id,
    source_url: `https://www.99acres.com/property-${slug}-ffid`,
    title: p.PROP_NAME ?? p.title ?? `${bhk ?? ""}BHK for rent in ${locality}`,
    price,
    deposit: p.PROP_DEPOSIT ? Number(p.PROP_DEPOSIT) : undefined,
    area_sqft: p.BUILTUP_AREA ? Number(p.BUILTUP_AREA) : (p.CARPET_AREA ? Number(p.CARPET_AREA) : undefined),
    bhk,
    property_type: p.PROP_TYPE_LABEL ? String(p.PROP_TYPE_LABEL).toLowerCase() : undefined,
    furnishing,
    lat,
    lon,
    address: p.PROP_HEADING ?? p.address ?? undefined,
    images,
  };
}

export async function scrape99Acres(locality: string): Promise<Listing[]> {
  const url = buildUrl(locality);

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`99acres HTTP ${res.status}`);

  const html = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state: any = extractJson(html);
  if (!state) throw new Error("99acres: could not extract JSON from page");

  // Properties can be nested at different paths
  const listings: unknown[] =
    state?.propertyData?.PROPERTY_DATA?.RESULTS?.RESULT ??
    state?.listingData?.PROPERTY_DATA?.RESULTS?.RESULT ??
    state?.PROPERTY_DATA?.RESULTS?.RESULT ??
    [];

  const results: Listing[] = [];
  for (const p of listings) {
    const l = mapProperty(locality, p);
    if (l) results.push(l);
  }
  return results;
}
