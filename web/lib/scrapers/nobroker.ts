import type { Listing } from "./types";

// NoBroker internal listing search API (undocumented but stable)
// Returns JSON directly — no HTML parsing needed.
const BASE = "https://www.nobroker.in/api/v5/property/list/";

function localitySlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProperty(locality: string, p: any): Listing | null {
  const id = String(p.id ?? p.postId ?? "");
  if (!id) return null;

  const price = Number(p.rent ?? p.expectedRent ?? p.price ?? 0);
  if (!price) return null;

  const bhkRaw = p.bhk ?? p.bedroomCount ?? p.noOfBedrooms ?? "";
  const bhkMatch = String(bhkRaw).match(/\d+/);
  const bhk = bhkMatch ? Number(bhkMatch[0]) : undefined;

  const furnishing = (() => {
    const f = String(p.furnishingStatus ?? p.furnishing ?? "").toLowerCase();
    if (f.includes("full")) return "furnished";
    if (f.includes("semi")) return "semi-furnished";
    if (f.includes("unfurnish") || f.includes("none")) return "unfurnished";
    return undefined;
  })();

  const lat = p.latitude ? Number(p.latitude) : undefined;
  const lon = p.longitude ? Number(p.longitude) : undefined;

  const images: string[] = [];
  if (Array.isArray(p.images)) {
    p.images.slice(0, 4).forEach((img: unknown) => {
      const url = typeof img === "string" ? img : (img as Record<string, string>)?.url;
      if (url) images.push(url);
    });
  }

  return {
    locality,
    source: "nobroker",
    source_id: id,
    source_url: `https://www.nobroker.in/property/residential/rent/bangalore/${localitySlug(locality)}?propertyId=${id}`,
    title: p.buildingName ?? p.societyName ?? `${bhk ?? ""}BHK in ${locality}`,
    price,
    deposit: p.deposit ? Number(p.deposit) : undefined,
    area_sqft: p.carpetArea ? Number(p.carpetArea) : (p.superBuiltUpArea ? Number(p.superBuiltUpArea) : undefined),
    bhk,
    property_type: p.propertyType ? String(p.propertyType).toLowerCase() : undefined,
    furnishing,
    lat,
    lon,
    address: p.address ?? p.locality ?? undefined,
    images,
  };
}

export async function scrapeNoBroker(locality: string): Promise<Listing[]> {
  const slug = localitySlug(locality);
  const url =
    `${BASE}?localityName=${encodeURIComponent(slug)}&city=bangalore` +
    `&listingType=RENT&pageNo=0&pageSize=20&sector=residential`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "application/json",
      "Referer": "https://www.nobroker.in/",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`NoBroker HTTP ${res.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;

  // NoBroker wraps results in various shapes depending on version
  const properties: unknown[] =
    data?.data?.dropDownPostData ??
    data?.data?.propertyList ??
    data?.propertyList ??
    data?.results ??
    [];

  const listings: Listing[] = [];
  for (const p of properties) {
    const l = mapProperty(locality, p);
    if (l) listings.push(l);
  }
  return listings;
}
