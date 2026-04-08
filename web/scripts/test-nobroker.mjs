// Quick smoke-test for the NoBroker HTML-embedded scraper.
// Run from: web/  →  node scripts/test-nobroker.mjs

const LOCALITIES = [
  { name: "Koramangala", slug: "koramangala" },
  { name: "Indiranagar",  slug: "indiranagar" },
  { name: "HSR Layout",   slug: "hsr-layout" },
  { name: "Whitefield",   slug: "whitefield" },
  { name: "Bellandur",    slug: "bellandur" },
];

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

function mapProperty(name, p) {
  const id = String(p.id ?? p.propertyCode ?? "");
  if (!id) return null;
  const price = Number(p.rent ?? 0);
  if (!price) return null;
  const bhkMatch = String(p.type ?? "").match(/\d+/);
  const bhk = bhkMatch ? Number(bhkMatch[0]) : undefined;
  const f = String(p.furnishing ?? "").toLowerCase();
  const furnishing = f.includes("full") ? "furnished" : f.includes("semi") ? "semi-furnished" : f.includes("unfurnish") ? "unfurnished" : undefined;
  return {
    id, price, bhk, furnishing,
    area_sqft: p.propertySize ?? undefined,
    lat: p.latitude ? Number(p.latitude) : undefined,
    lon: p.longitude ? Number(p.longitude) : undefined,
    title: (p.title ?? p.propertyTitle ?? `${bhk ?? ""}BHK in ${name}`).slice(0, 70),
  };
}

async function fetchLocality({ name, slug }) {
  const url = `https://www.nobroker.in/flats-for-rent-in-${slug}-bangalore/`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html",
      "Accept-Language": "en-IN,en;q=0.9",
    },
    signal: AbortSignal.timeout(14000),
  });
  if (!r.ok) return { name, ok: false, status: r.status, listings: [] };
  const html = await r.text();
  const props = extractJsonArray(html, "listPageProperties");
  const listings = props.map(p => mapProperty(name, p)).filter(Boolean);
  return { name, ok: true, status: r.status, count: listings.length, listings };
}

function printResult({ name, ok, status, count, listings }) {
  const icon = ok ? "✓" : "✗";
  console.log(`\n${icon} ${name}  [HTTP ${status}]  ${ok ? `${count} listing(s)` : "FAILED"}`);
  if (!ok || !listings.length) return;
  for (const l of listings.slice(0, 4)) {
    const bhk = l.bhk ? `${l.bhk}BHK` : "?BHK";
    const area = l.area_sqft ? ` ${l.area_sqft}sqft` : "";
    const furn = l.furnishing ? ` · ${l.furnishing}` : "";
    const geo  = (l.lat && l.lon) ? ` 📍${l.lat.toFixed(4)},${l.lon.toFixed(4)}` : " no-geo";
    console.log(`  ₹${l.price.toLocaleString("en-IN")}/mo  ${bhk}${area}${furn}${geo}  ${l.title}`);
  }
  if (count > 4) console.log(`  … and ${count - 4} more`);
}

console.log("NoBroker HTML-scraper test —", LOCALITIES.length, "localities\n");
const t0 = Date.now();
const results = await Promise.allSettled(LOCALITIES.map(fetchLocality));
for (const r of results) {
  if (r.status === "fulfilled") printResult(r.value);
  else console.log(`\n✗ [rejected] ${r.reason}`);
}
const total = results.filter(r => r.status === "fulfilled").reduce((s, r) => s + (r.value.count ?? 0), 0);
console.log(`\n─────────────────────────────────────────`);
console.log(`Total: ${total} listings  (${Date.now() - t0}ms)`);
