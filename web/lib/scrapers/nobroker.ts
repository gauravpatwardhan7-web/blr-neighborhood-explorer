import type { Listing } from "./types";

// NoBroker no longer exposes a public JSON API.
// Listings are now embedded as "listPageProperties":[...] in the search HTML page.
// URL format: https://www.nobroker.in/flats-for-rent-in-{slug}-bangalore/

function localitySlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// Extract the JSON array value of a given key from an HTML blob without a full parse.
// Uses bracket counting so it handles arbitrarily nested objects inside the array.
function extractJsonArray(html: string, key: string): unknown[] {
  const marker = `"${key}":[`;
  const start = html.indexOf(marker);
  if (start === -1) return [];

  let depth = 0;
  let i = start + marker.length - 1; // points at the opening '['
  const limit = Math.min(html.length, start + 600_000); // safety cap

  for (; i < limit; i++) {
    if (html[i] === "[") depth++;
    else if (html[i] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }

  try {
    return JSON.parse(html.slice(start + marker.length - 1, i + 1)) as unknown[];
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProperty(locality: string, p: any): Listing | null {
  const id = String(p.id ?? p.propertyCode ?? "");
  if (!id) return null;

  const price = Number(p.rent ?? 0);
  if (!price) return null;

  // type field is "BHK2", "BHK1", "BHK3", "RK", etc.
  const bhkMatch = String(p.type ?? p.typeDesc ?? "").match(/\d+/);
  const bhk = bhkMatch ? Number(bhkMatch[0]) : undefined;

  const furnishing = (() => {
    const f = String(p.furnishing ?? p.furnishingDesc ?? "").toLowerCase();
    if (f.includes("full") || f === "fully_furnished") return "furnished";
    if (f.includes("semi") || f === "semi_furnished")   return "semi-furnished";
    if (f.includes("unfurnish") || f === "unfurnished") return "unfurnished";
    return undefined;
  })();

  const lat = p.latitude  ? Number(p.latitude)  : undefined;
  const lon = p.longitude ? Number(p.longitude) : undefined;

  // Photos are objects with imagesMap.medium; fallback to originalImageUrl (protocol-relative)
  const images: string[] = [];
  const photoArr: unknown[] = Array.isArray(p.photos) ? p.photos : [];
  for (const ph of photoArr.slice(0, 4)) {
    const medium = (ph as Record<string, Record<string, string>>)?.imagesMap?.medium;
    if (medium) {
      images.push(`https://assets.nobroker.in/${medium}`);
    }
  }
  if (images.length === 0 && p.originalImageUrl) {
    const raw = String(p.originalImageUrl);
    images.push(raw.startsWith("//") ? `https:${raw}` : raw);
  }

  // detailUrl is an absolute path like /property/...<id>/detail
  const detailPath = String(p.detailUrl ?? "");
  const sourceUrl = detailPath
    ? `https://www.nobroker.in${detailPath}`
    : `https://www.nobroker.in/flats-for-rent-in-${localitySlug(locality)}-bangalore/`;

  return {
    locality,
    source: "nobroker",
    source_id: id,
    source_url: sourceUrl,
    title: p.title ?? p.propertyTitle ?? `${bhk ?? ""}BHK in ${locality}`,
    price,
    deposit: p.deposit ? Number(p.deposit) : undefined,
    area_sqft: p.propertySize ? Number(p.propertySize) : undefined,
    bhk,
    property_type: p.buildingType ? String(p.buildingType).toLowerCase() : undefined,
    furnishing,
    lat,
    lon,
    address: p.address ?? p.completeStreetName ?? p.localityTruncated ?? undefined,
    images,
  };
}

export async function scrapeNoBroker(locality: string): Promise<Listing[]> {
  const slug = localitySlug(locality);
  const url = `https://www.nobroker.in/flats-for-rent-in-${slug}-bangalore/`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) throw new Error(`NoBroker HTTP ${res.status}`);

  const html = await res.text();
  const properties = extractJsonArray(html, "listPageProperties");

  const listings: Listing[] = [];
  for (const p of properties) {
    const l = mapProperty(locality, p);
    if (l) listings.push(l);
  }
  return listings;
}

