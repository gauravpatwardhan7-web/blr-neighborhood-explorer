"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Locality = {
  name: string;
  overall_score: number;
  factors: { air_quality: number; amenities: number; metro_access: number; restaurants: number };
  raw: { aqi: number; temperature_c: number; hospitals: number; schools: number; supermarkets: number; restaurants: number; metro_stations: number };
};

type LocalityFull = Locality & { lat: number; lon: number };
type LocalityFeature = { properties: LocalityFull };

type Weights = { air_quality: number; amenities: number; metro_access: number; restaurants: number };
type RegionRating = { region: string; score: number; count: number; representative: string | null; centerLat: number; centerLon: number };
type RegionName =
  | "Central Bangalore"
  | "North Bangalore"
  | "North-East Bangalore"
  | "East Bangalore"
  | "South-East Bangalore"
  | "South Bangalore"
  | "South-West Bangalore"
  | "West Bangalore"
  | "North-West Bangalore";

const DEFAULT_WEIGHTS: Weights = { air_quality: 0.15, amenities: 0.45, metro_access: 0.25, restaurants: 0.15 };
const REGION_ORDER: RegionName[] = [
  "Central Bangalore",
  "North Bangalore",
  "North-East Bangalore",
  "East Bangalore",
  "South-East Bangalore",
  "South Bangalore",
  "South-West Bangalore",
  "West Bangalore",
  "North-West Bangalore",
];
const DETAIL_ZOOM = 12;

function recomputeScore(factors: Locality["factors"], weights: Weights): number {
  const raw =
    factors.air_quality  * weights.air_quality +
    factors.amenities    * weights.amenities +
    factors.metro_access * weights.metro_access +
    factors.restaurants  * weights.restaurants;
  return Math.min(10, Math.round(raw * 10) / 10);
}

function scoreColor(score: number) {
  if (score >= 6) return "#4ade80";  // soft green
  if (score >= 4) return "#fbbf24";  // soft amber
  return "#f87171";                   // soft red
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getRegionName(lat: number, lon: number, centerLat: number, centerLon: number, centralRadiusKm: number): RegionName {
  const distanceKm = haversineKm(lat, lon, centerLat, centerLon);
  if (distanceKm <= centralRadiusKm) return "Central Bangalore";

  const dy = lat - centerLat;
  const dx = (lon - centerLon) * Math.cos((centerLat * Math.PI) / 180);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  if (angle >= -22.5 && angle < 22.5) return "East Bangalore";
  if (angle >= 22.5 && angle < 67.5) return "North-East Bangalore";
  if (angle >= 67.5 && angle < 112.5) return "North Bangalore";
  if (angle >= 112.5 && angle < 157.5) return "North-West Bangalore";
  if (angle >= 157.5 || angle < -157.5) return "West Bangalore";
  if (angle >= -157.5 && angle < -112.5) return "South-West Bangalore";
  if (angle >= -112.5 && angle < -67.5) return "South Bangalore";
  return "South-East Bangalore";
}

function getCentralRadiusKm(localities: Pick<LocalityFull, "lat" | "lon">[], centerLat: number, centerLon: number): number {
  const dists = localities
    .map((l) => haversineKm(l.lat, l.lon, centerLat, centerLon))
    .sort((a, b) => a - b);
  if (!dists.length) return 0;
  const p20 = dists[Math.floor(dists.length * 0.2)];
  return Math.max(2, Math.min(6, p20));
}

function computeRegionRatings(localities: LocalityFull[], weights: Weights): RegionRating[] {
  if (!localities.length) return [];

  const centerLat = localities.reduce((sum, l) => sum + l.lat, 0) / localities.length;
  const centerLon = localities.reduce((sum, l) => sum + l.lon, 0) / localities.length;
  const centralRadiusKm = getCentralRadiusKm(localities, centerLat, centerLon);

  const grouped = new Map<RegionName, LocalityFull[]>();
  REGION_ORDER.forEach((r) => grouped.set(r, []));

  localities.forEach((loc) => {
    const region = getRegionName(loc.lat, loc.lon, centerLat, centerLon, centralRadiusKm);
    grouped.get(region)?.push(loc);
  });

  return REGION_ORDER.map((region) => {
    const group = grouped.get(region) ?? [];
    if (!group.length) return { region, score: 0, count: 0, representative: null, centerLat: 0, centerLon: 0 };

    const scored = group.map((l) => ({ ...l, liveScore: recomputeScore(l.factors, weights) }));
    const avg = scored.reduce((sum, l) => sum + l.liveScore, 0) / scored.length;
    const representative = scored.reduce((best, l) => (l.liveScore > best.liveScore ? l : best), scored[0]);
    const rCenterLat = group.reduce((sum, l) => sum + l.lat, 0) / group.length;
    const rCenterLon = group.reduce((sum, l) => sum + l.lon, 0) / group.length;

    return {
      region,
      score: Math.round(avg * 10) / 10,
      count: group.length,
      representative: representative.name,
      centerLat: rCenterLat,
      centerLon: rCenterLon,
    };
  }).filter((r) => r.count > 0);
}

function getRegionCircleFeatures(localities: LocalityFull[]) {
  if (!localities.length) return [];
  const ratings = computeRegionRatings(localities, DEFAULT_WEIGHTS);
  return ratings
    .filter((r) => r.count > 0)
    .map((r) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [r.centerLon, r.centerLat] },
      properties: { name: r.region, overall_score: r.score },
    }));
}

function FactorBars({ factors }: { factors: Locality["factors"] }) {
  return (
    <>
      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#111827" }}>Factor scores</h3>
      {Object.entries(factors).map(([k, v]) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
            <span style={{ color: "#374151", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span>
            <span style={{ fontWeight: 600, color: "#111827" }}>{v}/10</span>
          </div>
          <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3 }}>
            <div style={{ height: 6, width: `${v * 10}%`, background: scoreColor(v), borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </>
  );
}

function RawData({ raw }: { raw: Locality["raw"] }) {
  return (
    <>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 8px", color: "#111827" }}>Raw data</h3>
      {Object.entries(raw).map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid #e5e7eb" }}>
          <span style={{ color: "#374151", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span>
          <span style={{ fontWeight: 600, color: "#111827" }}>{v ?? "—"}</span>
        </div>
      ))}
    </>
  );
}

type ScoreFilter = "all" | "great" | "good" | "low";

const FILTER_OPTIONS: { value: ScoreFilter; label: string; color: string; bg: string; activeBg: string }[] = [
  { value: "all",   label: "All",   color: "#111827", bg: "white",   activeBg: "#111827" },
  { value: "great", label: "Great", color: "#065f46", bg: "#ecfdf5", activeBg: "#4ade80" },
  { value: "good",  label: "Good",  color: "#78350f", bg: "#fffbeb", activeBg: "#fbbf24" },
  { value: "low",   label: "Low",   color: "#7f1d1d", bg: "#fef2f2", activeBg: "#f87171" },
];

function FilterChips({ value, onChange, vertical }: { value: ScoreFilter; onChange: (v: ScoreFilter) => void; vertical?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: vertical ? "column" : "row", gap: 6 }}>
      {FILTER_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: active ? 700 : 500,
              background: active ? opt.activeBg : opt.bg,
              color: active ? (opt.value === "all" ? "white" : opt.color) : opt.color,
              border: active ? "1.5px solid transparent" : "1.5px solid #e5e7eb",
              cursor: "pointer", boxShadow: active ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
              transition: "all 0.15s",
            }}
          >{opt.label}</button>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ fontSize: 13, color: "#374151" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#4ade80", display: "inline-block", flexShrink: 0 }} /> Score 6–10 (Great)
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#fbbf24", display: "inline-block", flexShrink: 0 }} /> Score 4–6 (Good)
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#f87171", display: "inline-block", flexShrink: 0 }} /> Score 0–4 (Low)
      </div>
    </div>
  );
}

function RegionRatings({ ratings }: { ratings: RegionRating[] }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>Regional ratings</h3>
      {ratings.map((r) => (
        <div key={r.region} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", marginBottom: 8, background: "white" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12.5, color: "#111827", fontWeight: 600 }}>{r.region}</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: scoreColor(r.score) }}>{r.score}/10</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 3 }}>
            Based on {r.count} locality{r.count === 1 ? "" : "ies"}{r.representative ? ` • representative: ${r.representative}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

const SLIDER_LABELS: Record<keyof Weights, string> = {
  air_quality:  "Air Quality",
  amenities:    "Amenities",
  metro_access: "Metro Access",
  restaurants:  "Restaurants",
};

function WeightSliders({ weights, onChange }: { weights: Weights; onChange: (w: Weights) => void }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#111827", margin: 0 }}>Personalise weights</h3>
        <button
          onClick={() => onChange(DEFAULT_WEIGHTS)}
          style={{ fontSize: 11, color: "#111827", background: "white", border: "1.5px solid #374151", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontWeight: 600 }}
        >Reset</button>
      </div>
      {(Object.keys(weights) as (keyof Weights)[]).map((k) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 4, color: "#374151", fontWeight: 500 }}>{SLIDER_LABELS[k]}</div>
          <input
            type="range" min={0} max={100} step={5}
            value={Math.round(weights[k] * 100)}
            onChange={(e) => {
              const newVal = Number(e.target.value) / 100;
              const delta = newVal - weights[k];
              const others = (Object.keys(weights) as (keyof Weights)[]).filter((key) => key !== k);
              const othersSum = others.reduce((s, key) => s + weights[key], 0);
              const next = { ...weights, [k]: newVal };
              if (othersSum > 0) {
                // Scale others down proportionally so total stays at 1
                others.forEach((key) => {
                  next[key] = Math.max(0, weights[key] - delta * (weights[key] / othersSum));
                });
              } else {
                // All others are 0 — distribute remaining equally
                others.forEach((key) => { next[key] = Math.max(0, (1 - newVal) / others.length); });
              }
              // Normalise to exactly 1.0 to absorb floating-point drift
              const sum = Object.values(next).reduce((a, b) => a + b, 0);
              if (sum > 0) others.forEach((key) => { next[key] = next[key] / sum * (1 - next[k]); }); // re-anchor
              const total = Object.values(next).reduce((a, b) => a + b, 0);
              if (total > 0) (Object.keys(next) as (keyof Weights)[]).forEach((key) => { next[key] = next[key] / total; });
              onChange(next);
            }}
            style={{ width: "100%", accentColor: "#4ade80" }}
          />
        </div>
      ))}
      <p style={{ fontSize: 12, color: "#374151", margin: "4px 0 0" }}>
        Drag to prioritise what matters to you
      </p>
    </div>
  );
}

export default function Home() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const highlightedRef = useRef<string | null>(null);
  const localitiesRef = useRef<LocalityFull[]>([]);
  const [selected, setSelected] = useState<Locality | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [allLocalities, setAllLocalities] = useState<LocalityFull[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const [gateEmail, setGateEmail] = useState("");
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const markersRef = useRef<{ el: HTMLDivElement; factors: Locality["factors"]; score: number }[]>([]);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<"all" | "great" | "good" | "low">("all");
  const weightsRef = useRef(weights);
  const scoreFilterRef = useRef<ScoreFilter>(scoreFilter);
  const regionRatings = useMemo(() => computeRegionRatings(allLocalities, weights), [allLocalities, weights]);

  const updateMarkerVisibility = () => {
    const zoom = mapInstanceRef.current?.getZoom() ?? 0;
    const showDetailedMarkers = zoom >= DETAIL_ZOOM;
    markersRef.current.forEach(({ el, factors }) => {
      const score = recomputeScore(factors, weightsRef.current);
      const visibleByFilter =
        scoreFilterRef.current === "all" ||
        (scoreFilterRef.current === "great" && score >= 6) ||
        (scoreFilterRef.current === "good"  && score >= 4 && score < 6) ||
        (scoreFilterRef.current === "low"   && score < 4);
      el.style.display = showDetailedMarkers && visibleByFilter ? "flex" : "none";
      if (showDetailedMarkers && visibleByFilter) el.style.alignItems = "center";
    });
  };

  const updateMajorCircleFilter = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const f = scoreFilterRef.current;
    const layerFilter: maplibregl.FilterSpecification =
      f === "great" ? [">",  ["get", "overall_score"], 5.9] as unknown as maplibregl.FilterSpecification :
      f === "good"  ? ["all", [">=", ["get", "overall_score"], 4], ["<",  ["get", "overall_score"], 6]] as unknown as maplibregl.FilterSpecification :
      f === "low"   ? ["<",  ["get", "overall_score"], 4] as unknown as maplibregl.FilterSpecification :
      null as unknown as maplibregl.FilterSpecification; // "all" — remove filter
    const MAJOR_LAYERS = ["localities-major-circle", "localities-major-score", "localities-major-labels"];
    MAJOR_LAYERS.forEach((id) => {
      if (!map.getLayer(id)) return;
      if (layerFilter) {
        map.setFilter(id, layerFilter);
      } else {
        map.setFilter(id, null);
      }
    });
  };

  // Request browser geolocation and fly to nearest locality
  const locateUser = () => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        const locs = localitiesRef.current;
        if (!locs.length) return;
        const nearest = locs.reduce((best, loc) => {
          const d = haversineKm(pos.coords.latitude, pos.coords.longitude, loc.lat, loc.lon);
          return d < haversineKm(pos.coords.latitude, pos.coords.longitude, best.lat, best.lon) ? loc : best;
        });
        flyToLocality(nearest);
      },
      () => setGeoLoading(false),
      { timeout: 8000, maximumAge: 60000 }
    );
  };

  // Clear polygon highlight and deselect
  const dismiss = () => {
    if (mapInstanceRef.current && highlightedRef.current) {
      mapInstanceRef.current.setFeatureState(
        { source: "localities", id: highlightedRef.current },
        { hover: false }
      );
      highlightedRef.current = null;
    }
    history.replaceState(null, "", window.location.pathname);
    setSelected(null);
    setSheetExpanded(false);
  };

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Show email gate on first visit
  useEffect(() => {
    if (!localStorage.getItem("blr_visited")) setShowGate(true);
  }, []);

  // Sync URL when a locality is selected
  useEffect(() => {
    if (selected) {
      history.replaceState(null, "", `?locality=${encodeURIComponent(selected.name)}`);
    }
  }, [selected]);

  // Fly to + highlight a locality (used by search dropdown and URL deep-link)
  const flyToLocality = (loc: LocalityFull) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (highlightedRef.current && highlightedRef.current !== loc.name) {
      map.setFeatureState({ source: "localities", id: highlightedRef.current }, { hover: false });
    }
    highlightedRef.current = loc.name;
    map.setFeatureState({ source: "localities", id: loc.name }, { hover: true });
    map.flyTo({ center: [loc.lon, loc.lat], zoom: 13, duration: 1000 });
    setSelected(loc);
    setSheetExpanded(true);
    setSearchQuery("");
    setShowDropdown(false);
  };

  // Submit email to API (email is optional — skip just closes the gate)
  const handleGateSubmit = async (email: string) => {
    setGateSubmitting(true);
    try {
      if (email) {
        await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
      }
    } finally {
      localStorage.setItem("blr_visited", "1");
      setShowGate(false);
      setGateSubmitting(false);
    }
  };

  // Re-colour all marker bubbles whenever weights change
  useEffect(() => {
    weightsRef.current = weights;
    markersRef.current.forEach(({ el, factors }) => {
      const score = recomputeScore(factors, weights);
      el.style.background = scoreColor(score);
      el.innerText = String(score);
    });
    updateMarkerVisibility();
  }, [weights]);

  // Show/hide markers and major circles based on the active score filter
  useEffect(() => {
    scoreFilterRef.current = scoreFilter;
    updateMarkerVisibility();
    updateMajorCircleFilter();
  }, [scoreFilter, weights]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [77.6, 12.97],
      zoom: 11,
      preserveDrawingBuffer: true,  // keeps WebGL buffer alive on iOS (must be set at context creation)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    mapInstanceRef.current = map;

    // ── iOS black-map fix ──────────────────────────────────────────────────
    // WebGL canvases go blank on iOS when: the page is restored from bfcache,
    // the screen wakes, the tab becomes visible again, or the viewport resizes.
    // We need map.resize() to run in all those cases.
    const resizeMap = () => { mapInstanceRef.current?.resize(); };

    // 1. Immediate + staggered resize on first paint
    requestAnimationFrame(resizeMap);
    setTimeout(resizeMap, 100);
    setTimeout(resizeMap, 500);

    // 2. bfcache restore (iOS back/forward swipe, pull-to-refresh)
    const onPageShow = (e: PageTransitionEvent) => {
      resizeMap();
      if (e.persisted) {
        // Page came from bfcache — force a few more resizes
        setTimeout(resizeMap, 50);
        setTimeout(resizeMap, 300);
      }
    };
    window.addEventListener("pageshow", onPageShow);

    // 3. Tab becomes visible after switching apps or locking screen
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        resizeMap();
        setTimeout(resizeMap, 200);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // 4. Device rotation
    const onOrient = () => setTimeout(resizeMap, 300);
    window.addEventListener("orientationchange", onOrient);

    // 5. ResizeObserver on the container — catches any CSS-driven size change
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && mapRef.current) {
      ro = new ResizeObserver(() => resizeMap());
      ro.observe(mapRef.current);
    }

    map.on("load", async () => {
      const [res, smallRes] = await Promise.all([
        fetch("/localities_scored.geojson"),
        fetch("/localities_small.geojson"),
      ]);
      const data = await res.json();
      const smallData = await smallRes.json();
      const mapLocalities: LocalityFull[] = (data.features as LocalityFeature[]).map((f) => ({
        name: f.properties.name,
        lat: f.properties.lat,
        lon: f.properties.lon,
        overall_score: f.properties.overall_score,
        factors: f.properties.factors,
        raw: f.properties.raw,
      }));
      // Zoomed-out view: only show major Bengaluru areas
      // Add both sources upfront
      map.addSource("localities", { type: "geojson", data, promoteId: "name" });
      map.addSource("localities-small", { type: "geojson", data: smallData });

      // Build a Point source for region circles positioned at each region's centroid
      const majorPointFeatures = getRegionCircleFeatures(mapLocalities);
      map.addSource("localities-major-points", {
        type: "geojson",
        data: { type: "FeatureCollection", features: majorPointFeatures },
      });

      // Zoomed-out view: major localities as large coloured circles (dissolve at DETAIL_ZOOM)
      map.addLayer({
        id: "localities-major-circle",
        type: "circle",
        source: "localities-major-points",
        maxzoom: DETAIL_ZOOM,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 60, 10, 90, 11, 130] as maplibregl.DataDrivenPropertyValueSpecification<number>,
          "circle-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 6, "#4ade80"] as maplibregl.DataDrivenPropertyValueSpecification<string>,
          "circle-opacity": 0.45,
          "circle-stroke-color": "rgba(255,255,255,0.7)",
          "circle-stroke-width": 1.5,
        },
      });
      // Score number rendered inside the circle
      map.addLayer({
        id: "localities-major-score",
        type: "symbol",
        source: "localities-major-points",
        maxzoom: DETAIL_ZOOM,
        layout: {
          "text-field": ["to-string", ["get", "overall_score"]],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
          "text-anchor": "center",
          "text-offset": [0, 0],
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.2)",
          "text-halo-width": 0.5,
        },
      });
      // Locality name label below each circle
      map.addLayer({
        id: "localities-major-labels",
        type: "symbol",
        source: "localities-major-points",
        maxzoom: DETAIL_ZOOM,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"],
          "text-anchor": "top",
          "text-offset": [0, 2.6],
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#1f2937",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      // Zoomed-in view: reveal all locality circles/details
      map.addLayer({
        id: "localities-small-fill",
        type: "fill",
        source: "localities-small",
        minzoom: DETAIL_ZOOM,
        paint: {
          "fill-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 6, "#4ade80"],
          "fill-opacity": 0.08,
        },
      });
      map.addLayer({
        id: "localities-small-outline",
        type: "line",
        source: "localities-small",
        minzoom: DETAIL_ZOOM,
        paint: {
          "line-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 6, "#4ade80"],
          "line-width": 0.8,
        },
      });

      // Fill — only visible on hover/click (amenity-based radius)
      map.addLayer({
        id: "localities-fill",
        type: "fill",
        source: "localities",
        minzoom: DETAIL_ZOOM,
        paint: {
          "fill-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 6, "#4ade80"],
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.22, 0],
        },
      });

      // Outline — thin always, thicker on hover
      map.addLayer({
        id: "localities-outline",
        type: "line",
        source: "localities",
        minzoom: DETAIL_ZOOM,
        paint: {
          "line-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 6, "#4ade80"],
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0],
        },
      });

      map.addLayer({
        id: "localities-labels",
        type: "symbol",
        source: "localities",
        minzoom: DETAIL_ZOOM,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
          "text-anchor": "top",
          "text-offset": [0, 1.8],
          "text-max-width": 8,
        },
        paint: {
          "text-color": "#1f2937",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      // Hover state management
      let hoveredName: string | null = null;

      map.on("mousemove", "localities-small-fill", (e) => {
        if (!e.features?.length) return;
        const name = e.features[0].properties?.name;
        if (name === hoveredName) return;
        if (hoveredName) map.setFeatureState({ source: "localities", id: hoveredName }, { hover: false });
        hoveredName = name;
        map.setFeatureState({ source: "localities", id: name }, { hover: true });
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "localities-small-fill", () => {
        if (hoveredName) map.setFeatureState({ source: "localities", id: hoveredName }, { hover: false });
        hoveredName = null;
        map.getCanvas().style.cursor = "";
      });

      (data.features as LocalityFeature[]).forEach((f) => {
        const { name, overall_score, factors, raw } = f.properties;
        const color = scoreColor(overall_score);

        const el = document.createElement("div");
        el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${color};opacity:0.55;border:1.5px solid rgba(255,255,255,0.8);display:none;align-items:center;justify-content:center;font-weight:700;font-size:10px;color:white;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15)`;
        el.innerText = String(overall_score);
        markersRef.current.push({ el, factors, score: overall_score });

        // Bubble hover also triggers polygon highlight
        el.addEventListener("mouseenter", () => {
          if (hoveredName) map.setFeatureState({ source: "localities", id: hoveredName }, { hover: false });
          hoveredName = name;
          map.setFeatureState({ source: "localities", id: name }, { hover: true });
        });
        el.addEventListener("mouseleave", () => {
          // Only clear hover if this feature isn't the tapped/selected one
          if (highlightedRef.current !== name) {
            map.setFeatureState({ source: "localities", id: name }, { hover: false });
          }
          hoveredName = null;
        });

        el.onclick = () => {
          // On tap (mobile) or click: show polygon for selected locality
          if (highlightedRef.current && highlightedRef.current !== name) {
            map.setFeatureState({ source: "localities", id: highlightedRef.current }, { hover: false });
          }
          highlightedRef.current = name;
          map.setFeatureState({ source: "localities", id: name }, { hover: true });
          setSelected({ name, overall_score, factors, raw });
          setSheetExpanded(true);
        };

        new maplibregl.Marker({ element: el })
          .setLngLat([f.properties.lon, f.properties.lat])
          .addTo(map);
      });

      updateMarkerVisibility();
      map.on("zoom", updateMarkerVisibility);
      map.on("zoomend", updateMarkerVisibility);

      // Populate locality list for search and URL deep-links
      const allLocs: LocalityFull[] = (data.features as LocalityFeature[]).map((f) => ({
        name: f.properties.name,
        lat: f.properties.lat,
        lon: f.properties.lon,
        overall_score: f.properties.overall_score,
        factors: f.properties.factors,
        raw: f.properties.raw,
      }));
      setAllLocalities(allLocs);
      localitiesRef.current = allLocs;

      // Auto-select from ?locality= URL param
      const paramLocality = new URLSearchParams(window.location.search).get("locality");
      if (paramLocality) {
        const match = allLocs.find((l) => l.name === paramLocality);
        if (match) {
          highlightedRef.current = match.name;
          map.setFeatureState({ source: "localities", id: match.name }, { hover: true });
          map.flyTo({ center: [match.lon, match.lat], zoom: 13 });
          setSelected(match);
          setSheetExpanded(true);
        }
      }
    });

    return () => {
      ro?.disconnect();
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("orientationchange", onOrient);
      map.remove();
    };
  }, []);

  const sheetOpen = selected !== null;

  const searchResults =
    searchQuery.length > 1
      ? allLocalities
          .filter((l) => l.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .slice(0, 8)
      : [];

  const searchBar = (
    <div style={{ position: "absolute", top: 16, left: 16, zIndex: 10, width: isMobile ? "calc(100% - 32px)" : 260, display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}>
        <input
          type="text"
          placeholder="Search neighbourhood…"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ width: "100%", padding: "9px 14px", borderRadius: 8, border: "1.5px solid rgba(0,0,0,0.15)", boxShadow: "0 2px 12px rgba(0,0,0,0.22)", fontSize: 16, outline: "none", boxSizing: "border-box", background: "white", color: "#111827" }}
        />
        {showDropdown && searchResults.length > 0 && (
          <div style={{ background: "white", borderRadius: 8, marginTop: 4, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", overflow: "hidden" }}>
            {searchResults.map((loc) => (
              <div
                key={loc.name}
                onMouseDown={() => flyToLocality(loc)}
                style={{ padding: "9px 14px", fontSize: 14, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f3f4f6", color: "#111827", background: "white" }}
              >
                <span>{loc.name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(loc.overall_score) }}>{loc.overall_score}/10</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={locateUser}
        disabled={geoLoading}
        title="Find nearest neighbourhood"
        style={{
          flexShrink: 0, width: 40, height: 40, borderRadius: 8,
          background: "white", border: "1.5px solid rgba(0,0,0,0.15)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.22)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: geoLoading ? "default" : "pointer", padding: 0,
        }}
      >
        {geoLoading ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ animation: "spin 1s linear infinite" }}>
            <circle cx="9" cy="9" r="7" stroke="#9ca3af" strokeWidth="2" strokeDasharray="22 12" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="6.5" stroke="#374151" strokeWidth="1.8" />
            <circle cx="9" cy="9" r="2" fill="#111827" />
            <line x1="9" y1="1" x2="9" y2="3.5" stroke="#374151" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="9" y1="14.5" x2="9" y2="17" stroke="#374151" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="1" y1="9" x2="3.5" y2="9" stroke="#374151" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="14.5" y1="9" x2="17" y2="9" stroke="#374151" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  );

  return (
    <>
      {/* Email gate — shown on first visit */}
      {showGate && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(17,24,39,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "white", borderRadius: 16, padding: "36px 32px", maxWidth: 400, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗺️</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, color: "#111827" }}>Bengaluru Neighborhood Explorer</h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 28, lineHeight: 1.6 }}>
              Explore 100 Bengaluru neighbourhoods scored by air quality, amenities, metro access, and restaurants.
            </p>
            <input
              type="email"
              placeholder="your@email.com"
              value={gateEmail}
              onChange={(e) => setGateEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleGateSubmit(gateEmail); }}
              style={{ width: "100%", padding: "11px 14px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 14, outline: "none", marginBottom: 12, boxSizing: "border-box" }}
            />
            <button
              onClick={() => handleGateSubmit(gateEmail)}
              disabled={gateSubmitting}
              style={{ width: "100%", padding: "12px 0", borderRadius: 8, background: "#111827", color: "white", fontSize: 14, fontWeight: 700, border: "none", cursor: "pointer", marginBottom: 12, opacity: gateSubmitting ? 0.7 : 1 }}
            >
              {gateSubmitting ? "Saving…" : "Explore Map →"}
            </button>
            <button
              onClick={() => handleGateSubmit("")}
              style={{ background: "none", border: "none", fontSize: 13, color: "#374151", cursor: "pointer" }}
            >
              Skip for now →
            </button>
          </div>
        </div>
      )}

      {!isMobile ? (
        /* ── Desktop layout ── */
        <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif", position: "relative" }}>
          {searchBar}
          {/* Filter chips — float on the map below the search bar */}
          <div style={{ position: "absolute", top: 68, left: 16, zIndex: 10, display: "flex", gap: 6 }}>
            <FilterChips value={scoreFilter} onChange={setScoreFilter} />
          </div>
          <div ref={mapRef} style={{ flex: 1 }} />
          <div style={{ width: 300, padding: 20, overflowY: "auto", borderLeft: "1px solid #e5e7eb", background: "#f9fafb" }}>
            {!selected ? (
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Bengaluru Neighborhoods</h2>
                <p style={{ fontSize: 13, color: "#374151", marginBottom: 16 }}>Click any dot on the map to see details.</p>
                <Legend />
                <div style={{ margin: "20px 0", borderTop: "1px solid #e5e7eb" }} />
                <WeightSliders weights={weights} onChange={setWeights} />
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <button onClick={dismiss} style={{ fontSize: 13, color: "#111827", background: "white", border: "1.5px solid #374151", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontWeight: 600 }}>← Back</button>
                  <button
                    onClick={() => { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    style={{ fontSize: 11, color: copied ? "#059669" : "#374151", background: "white", border: "1.5px solid #9ca3af", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontWeight: 500 }}
                  >{copied ? "✓ Copied!" : "🔗 Copy link"}</button>
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{selected.name}</h2>
                <div style={{ fontSize: 32, fontWeight: 800, color: scoreColor(recomputeScore(selected.factors, weights)), marginBottom: 16 }}>
                  {recomputeScore(selected.factors, weights)}<span style={{ fontSize: 14, color: "#6b7280" }}>/10</span>
                </div>
                <FactorBars factors={selected.factors} />
                <RawData raw={selected.raw} />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Mobile layout: full-screen map + bottom sheet ── */
        <div style={{ position: "relative", height: "100dvh", fontFamily: "sans-serif", paddingTop: "max(0px, env(safe-area-inset-top, 0px))" }}>
          {searchBar}
          {/* Filter chips — vertical stack on right side */}
          <div style={{ position: "fixed", top: 80, right: 16, zIndex: 10, display: "flex", flexDirection: "column", gap: 6, paddingBottom: 2, pointerEvents: "auto" }}>
            <FilterChips value={scoreFilter} onChange={setScoreFilter} vertical={true} />
          </div>
          {/* Map — fixed to viewport so it is never inside overflow:hidden, preventing iOS WebGL blank */}
          <div ref={mapRef} style={{ position: "fixed", inset: 0, top: "max(0px, env(safe-area-inset-top, 0px))", zIndex: 0, background: "#e8e0d5" }} />

          {!sheetOpen && (
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0,
              background: "white", borderRadius: "16px 16px 0 0",
              boxShadow: "0 -2px 12px rgba(0,0,0,0.12)",
              color: "#111827",
              maxHeight: sheetExpanded ? "55dvh" : "52px",
              overflow: "hidden",
              transition: "max-height 0.3s ease",
              zIndex: 10,
            }}>
              {/* Drag handle — always visible, tap to toggle */}
              <div
                onClick={() => setSheetExpanded((v) => !v)}
                style={{ padding: "12px 20px 8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 4, background: "#d1d5db", borderRadius: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>Bengaluru Neighborhoods</span>
                </div>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: "#6b7280", transform: sheetExpanded ? "rotate(180deg)" : "none", transition: "transform 0.25s", flexShrink: 0, display: "block" }}>
                  <path d="M4.5 11.5L9 6.5L13.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              {/* Expanded content */}
              <div style={{ padding: "4px 20px 20px", overflowY: "auto", maxHeight: "calc(55dvh - 52px)" }}>
                <p style={{ fontSize: 12, color: "#374151", marginBottom: 12 }}>Tap any circle on the map.</p>
                <Legend />
                <div style={{ margin: "14px 0", borderTop: "1px solid #e5e7eb" }} />
                <WeightSliders weights={weights} onChange={setWeights} />
              </div>
            </div>
          )}

          {sheetOpen && (
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0,
              background: "white", borderRadius: "16px 16px 0 0",
              boxShadow: "0 -2px 12px rgba(0,0,0,0.15)",
              maxHeight: sheetExpanded ? "60dvh" : "52px",
              overflow: "hidden",
              transition: "max-height 0.3s ease",
              color: "#111827",
              zIndex: 10,
            }}>
              {/* Header — tap to toggle, always visible */}
              <div
                onClick={() => setSheetExpanded((v) => !v)}
                style={{ padding: "12px 20px 8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 4, background: "#d1d5db", borderRadius: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{selected!.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: scoreColor(recomputeScore(selected!.factors, weights)) }}>
                    {recomputeScore(selected!.factors, weights)}<span style={{ fontSize: 11, fontWeight: 400, color: "#6b7280" }}>/10</span>
                  </span>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: "#6b7280", transform: sheetExpanded ? "rotate(180deg)" : "none", transition: "transform 0.25s", flexShrink: 0, display: "block" }}>
                    <path d="M4.5 11.5L9 6.5L13.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
              {/* Scrollable body */}
              <div style={{ padding: "4px 20px 32px", overflowY: "auto", maxHeight: "calc(60dvh - 52px)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <button onClick={(e) => { e.stopPropagation(); dismiss(); }} style={{ fontSize: 13, color: "#111827", background: "white", border: "1.5px solid #374151", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontWeight: 600 }}>← Back</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    style={{ fontSize: 11, color: copied ? "#059669" : "#374151", background: "white", border: "1.5px solid #9ca3af", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontWeight: 500 }}
                  >{copied ? "✓ Copied!" : "🔗 Copy link"}</button>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700 }}>{selected!.name}</h2>
                  <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor(recomputeScore(selected!.factors, weights)) }}>
                    {recomputeScore(selected!.factors, weights)}<span style={{ fontSize: 12, color: "#6b7280" }}>/10</span>
                  </div>
                </div>
                <FactorBars factors={selected!.factors} />
                <RawData raw={selected!.raw} />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

