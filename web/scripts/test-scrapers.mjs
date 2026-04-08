// Smoke-test for NoBroker + Housing.com scrapers (no build step needed)
// Run from: web/  →  node scripts/test-scrapers.mjs

const LOCALITIES = [
  { name: "HSR Layout",     nbSlug: "hsr-layout",     hcSlug: "hsr-layout" },
  { name: "Koramangala",    nbSlug: "koramangala",    hcSlug: "koramangala" },
  { name: "Kasavanahalli",  nbSlug: "kasavanahalli",  hcSlug: "kasavanahalli" },
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-IN,en;q=0.9",
};

// ── NoBroker ──────────────────────────────────────────────────────────────────
function extractJsonArray(html, key) {
  const marker = `"${key}":[`;
  const start = html.indexOf(marker);
  if (start === -1) return [];
  let depth = 0, i = start + marker.length - 1;
  const limit = Math.min(html.length, start + 600_000);
  for (; i < limit; i++) {
    if (html[i] === "[") depth++;
    else if (html[i] === "]") { depth--; if (depth === 0) break; }
  }
  try { return JSON.parse(html.slice(start + marker.length - 1, i + 1)); }
  catch { return []; }
}

function mapNoBroker(p) {
  const id = String(p.id ?? p.propertyCode ?? "");
  if (!id) return null;
  const price = Number(p.rent ?? 0);
  if (!price) return null;
  const bhkMatch = String(p.type ?? "").match(/\d+/);
  const bhk = bhkMatch ? Number(bhkMatch[0]) : undefined;
  const f = String(p.furnishing ?? "").toLowerCase();
  const furnishing = f.includes("full") ? "furnished" : f.includes("semi") ? "semi-furnished" : f.includes("unfurnish") ? "unfurnished" : undefined;
  return {
    source: "nobroker", id, price, bhk, furnishing,
    area_sqft: p.propertySize ?? undefined,
    lat: p.latitude ? Number(p.latitude) : undefined,
    lon: p.longitude ? Number(p.longitude) : undefined,
    title: (p.title ?? p.propertyTitle ?? `${bhk ?? ""}BHK`).slice(0, 70),
  };
}

async function fetchNoBroker({ name, nbSlug }) {
  const url = `https://www.nobroker.in/flats-for-rent-in-${nbSlug}-bangalore/`;
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(14000) });
    if (!r.ok) return { name, source: "nobroker", ok: false, status: r.status, listings: [] };
    const html = await r.text();
    const props = extractJsonArray(html, "listPageProperties");
    const listings = props.map(mapNoBroker).filter(Boolean);
    return { name, source: "nobroker", ok: true, status: r.status, count: listings.length, listings };
  } catch (e) {
    return { name, source: "nobroker", ok: false, status: 0, error: e.message, listings: [] };
  }
}

// ── Housing.com ───────────────────────────────────────────────────────────────
function extractNextData(html) {
  // <script id="__NEXT_DATA__" type="application/json">...</script>
  const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function mapHousing(p) {
  const id = String(p.id ?? p.listingId ?? p.property_id ?? "");
  if (!id) return null;
  const priceData = p.pricingDetails ?? p.price ?? {};
  const price = Number(priceData.expectedPrice ?? priceData.rentPrice ?? priceData.rent ?? p.price ?? 0);
  if (!price) return null;
  const bhkRaw = String(p.bedrooms ?? p.bedroomCount ?? p.noOfBedrooms ?? "");
  const bhkMatch = bhkRaw.match(/\d+/);
  const bhk = bhkMatch ? Number(bhkMatch[0]) : undefined;
  const f = String(p.furnishing ?? p.furnishingType ?? "").toLowerCase();
  const furnishing = f.includes("full") ? "furnished" : f.includes("semi") ? "semi-furnished" : f.includes("unfurnish") ? "unfurnished" : undefined;
  const loc = p.geo ?? p.coordinates ?? p.location ?? {};
  const rawLat = loc.lat ?? loc.latitude;
  const rawLon = loc.lng ?? loc.longitude;
  const rawDeposit = (p.pricingDetails ?? p.price ?? {}).security ?? (p.pricingDetails ?? p.price ?? {}).deposit;
  const rawArea = p.builtupArea ?? p.carpetArea;
  return {
    source: "housing", id,
    price, bhk, furnishing,
    deposit: rawDeposit != null ? Number(rawDeposit) : undefined,
    area_sqft: rawArea != null ? Number(rawArea) : undefined,
    lat: rawLat != null ? Number(rawLat) : undefined,
    lon: rawLon != null ? Number(rawLon) : undefined,
    title: (p.title ?? p.name ?? `${bhk ?? ""}BHK for rent`).slice(0, 70),
  };
}

async function fetchHousing({ name, hcSlug }) {
  const url = `https://housing.com/rent/flats-for-rent-in-${hcSlug}-bangalore`;
  try {
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(14000) });
    if (!r.ok) return { name, source: "housing", ok: false, status: r.status, listings: [] };
    const html = await r.text();
    const nextData = extractNextData(html);
    if (!nextData) return { name, source: "housing", ok: false, status: r.status, error: "no __NEXT_DATA__", listings: [] };
    const props = nextData?.props?.pageProps ?? {};
    const raw =
      props?.listingData?.data?.listings ??
      props?.listings ??
      props?.searchResults?.listings ??
      props?.data?.listings ??
      [];
    const listings = raw.map(p => mapHousing(p)).filter(Boolean);
    // Debug: show what keys are available in pageProps if 0 listings
    if (listings.length === 0) {
      console.log(`  [debug] Housing ${name} pageProps keys:`, Object.keys(props).join(", ").slice(0, 200));
    }
    return { name, source: "housing", ok: true, status: r.status, count: listings.length, listings };
  } catch (e) {
    return { name, source: "housing", ok: false, status: 0, error: e.message, listings: [] };
  }
}

// ── Output ────────────────────────────────────────────────────────────────────
function printResult({ name, source, ok, status, count, error, listings }) {
  const icon = ok && count > 0 ? "✓" : ok ? "?" : "✗";
  const label = source === "nobroker" ? "NoBroker" : "Housing.com";
  console.log(`\n${icon} ${name} — ${label}  [HTTP ${status}]  ${ok ? `${count} listing(s)` : `FAILED: ${error ?? ""}`}`);
  if (!ok || !listings?.length) return;
  for (const l of listings.slice(0, 3)) {
    const bhk = l.bhk ? `${l.bhk}BHK` : "?BHK";
    const area = l.area_sqft ? ` ${l.area_sqft}sqft` : "";
    const furn = l.furnishing ? ` · ${l.furnishing}` : "";
    const geo = (l.lat && l.lon) ? ` 📍${l.lat.toFixed(4)},${l.lon.toFixed(4)}` : " no-geo";
    console.log(`  ₹${l.price.toLocaleString("en-IN")}/mo  ${bhk}${area}${furn}${geo}  ${l.title}`);
  }
  if (count > 3) console.log(`  … and ${count - 3} more`);
}

console.log("Scraper test — NoBroker + Housing.com — 3 localities\n");
const t0 = Date.now();

// Run all 6 fetches in parallel (3 localities × 2 sources)
const jobs = LOCALITIES.flatMap(loc => [fetchNoBroker(loc), fetchHousing(loc)]);
const results = await Promise.allSettled(jobs);

for (const r of results) {
  if (r.status === "fulfilled") printResult(r.value);
  else console.log(`\n✗ [rejected] ${r.reason}`);
}

const total = results.reduce((s, r) => s + (r.status === "fulfilled" ? (r.value.count ?? 0) : 0), 0);
console.log(`\n─────────────────────────────────────────`);
console.log(`Total: ${total} listings  (${Date.now() - t0}ms)`);
