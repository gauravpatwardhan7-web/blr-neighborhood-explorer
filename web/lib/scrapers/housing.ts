import * as cheerio from "cheerio";
import type { Listing } from "./types";

// Housing.com is a Next.js app — listing data lives in __NEXT_DATA__ JSON
// embedded in a <script id="__NEXT_DATA__"> tag.

function buildUrl(locality: string): string {
  const slug = locality.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `https://housing.com/rent/flats-for-rent-in-${slug}-bangalore`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractNextData(html: string): any {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").html();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProperty(locality: string, p: any): Listing | null {
  const id = String(p.id ?? p.listingId ?? p.property_id ?? "");
  if (!id) return null;

  const priceData = p.pricingDetails ?? p.price ?? {};
  const price = Number(priceData.expectedPrice ?? priceData.rentPrice ?? priceData.rent ?? p.price ?? 0);
  if (!price) return null;

  const bhkRaw = String(p.bedrooms ?? p.bedroomCount ?? p.noOfBedrooms ?? "");
  const bhkMatch = bhkRaw.match(/\d+/);
  const bhk = bhkMatch ? Number(bhkMatch[0]) : undefined;

  const furnishing = (() => {
    const f = String(p.furnishing ?? p.furnishingType ?? "").toLowerCase();
    if (f.includes("full")) return "furnished";
    if (f.includes("semi")) return "semi-furnished";
    if (f.includes("unfurnish")) return "unfurnished";
    return undefined;
  })();

  const loc = p.geo ?? p.coordinates ?? p.location ?? {};
  const rawLat = loc.lat ?? loc.latitude;
  const lat = rawLat != null ? Number(rawLat) : undefined;
  const rawLon = loc.lng ?? loc.longitude;
  const lon = rawLon != null ? Number(rawLon) : undefined;

  const images: string[] = [];
  const imgArr = p.images ?? p.photos ?? [];
  imgArr.slice(0, 4).forEach((img: unknown) => {
    const url = typeof img === "string" ? img : (img as Record<string, string>)?.url ?? (img as Record<string, string>)?.src;
    if (url && url.startsWith("http")) images.push(url);
  });

  const rawDeposit = priceData.security ?? priceData.deposit;
  const rawArea = p.builtupArea ?? p.carpetArea;
  const rawType = p.type ?? p.propertyType;

  return {
    locality,
    source: "housing",
    source_id: id,
    source_url: `https://housing.com/in/rent/${id}`,
    title: p.title ?? p.name ?? `${bhk ?? ""}BHK for rent in ${locality}`,
    price,
    deposit: rawDeposit != null ? Number(rawDeposit) : undefined,
    area_sqft: rawArea != null ? Number(rawArea) : undefined,
    bhk,
    property_type: rawType != null ? String(rawType).toLowerCase() : undefined,
    furnishing,
    lat,
    lon,
    address: p.address ?? p.displayAddress ?? undefined,
    images,
  };
}

export async function scrapeHousing(locality: string): Promise<Listing[]> {
  const url = buildUrl(locality);

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`Housing.com HTTP ${res.status}`);

  const html = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextData: any = extractNextData(html);
  if (!nextData) throw new Error("Housing: could not find __NEXT_DATA__");

  // Walk common paths in housing.com's page props
  const props = nextData?.props?.pageProps ?? {};
  const listings: unknown[] =
    props?.listingData?.data?.listings ??
    props?.listings ??
    props?.searchResults?.listings ??
    props?.data?.listings ??
    [];

  const results: Listing[] = [];
  for (const p of listings) {
    const l = mapProperty(locality, p);
    if (l) results.push(l);
  }
  return results;
}
