"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Listing } from "@/lib/scrapers/types";

// ── Types ─────────────────────────────────────────────────────────────────────
type FactorKey = "air_quality" | "amenities" | "metro_access" | "restaurants";

type Locality = {
  name: string;
  overall_score: number;
  factors: Record<FactorKey, number>;
  raw: {
    aqi: number;
    temperature_c: number;
    hospitals: number;
    schools: number;
    supermarkets: number;
    restaurants: number;
    metro_stations: number;
    bus_stops: number;
  };
};

type LocalityFull = Locality & { lat: number; lon: number };
type LocalityFeature = { properties: LocalityFull };
type Weights = Record<FactorKey, number>;
type ScoreFilter = "all" | "great" | "good" | "low";
type SentimentEntry = {
  name: string;
  compound: number;
  label: "Positive" | "Neutral" | "Negative";
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  summary: string;
  quotes: string[];
};

type CommuteResult = { name: string; durationMin: number };

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_WEIGHTS: Weights = {
  air_quality: 0.15,
  amenities: 0.45,
  metro_access: 0.25,
  restaurants: 0.15,
};

// Raw composite range from the scoring pipeline — used to normalise recomputeScore
// to the same 1.0–9.5 scale as the stored overall_score values.
const SCORE_RAW_MIN = 1.3;
const SCORE_RAW_MAX = 7.4;
const SCORE_NORM_MIN = 1.0;
const SCORE_NORM_MAX = 9.5;

const SLIDER_LABELS: Record<FactorKey, string> = {
  air_quality:  "Air Quality",
  amenities:    "Amenities",
  metro_access: "Transit Access",
  restaurants:  "Restaurants",
};

// Raw data keys → human-readable labels (override the default key→words fallback)
const RAW_LABELS: Partial<Record<keyof Locality["raw"], string>> = {
  metro_stations: "transit stations (metro + rail)",
  bus_stops:      "bus stops",
  aqi:            "AQI (US)",
  temperature_c:  "temperature (°C)",
};

// Commute heatmap colour scale
function commuteColor(min: number): string {
  if (min <= 20) return "#22c55e";
  if (min <= 35) return "#fde68a";
  if (min <= 50) return "#fb923c";
  return "#ef4444";
}

const SENTIMENT_COLORS = {
  Positive: { bg: "#ecfdf5", text: "#065f46", bar: "#4ade80" },
  Neutral:  { bg: "#f3f4f6", text: "#374151", bar: "#9ca3af" },
  Negative: { bg: "#fef2f2", text: "#7f1d1d", bar: "#f87171" },
} as const;

const FILTER_OPTIONS: {
  value: ScoreFilter;
  label: string;
  color: string;
  bg: string;
  activeBg: string;
}[] = [
  { value: "all",   label: "All",   color: "#111827", bg: "white",   activeBg: "#111827" },
  { value: "great", label: "Great", color: "#065f46", bg: "#ecfdf5", activeBg: "#4ade80" },
  { value: "good",  label: "Good",  color: "#78350f", bg: "#fffbeb", activeBg: "#fbbf24" },
  { value: "low",   label: "Low",   color: "#7f1d1d", bg: "#fef2f2", activeBg: "#f87171" },
];

// ── Tech park destinations ───────────────────────────────────────────────────
const TECH_PARKS: { name: string; lat: number; lon: number }[] = [
  { name: "Electronic City",           lat: 12.8399, lon: 77.6770 },
  { name: "ITPL / Whitefield",         lat: 12.9698, lon: 77.7499 },
  { name: "Manyata Tech Park",         lat: 13.0475, lon: 77.6220 },
  { name: "Bagmane Tech Park",         lat: 12.9784, lon: 77.6408 },
  { name: "Embassy Tech Village",      lat: 12.9020, lon: 77.7010 },
  { name: "RMZ Ecospace",              lat: 12.9406, lon: 77.6969 },
  { name: "Global Village Tech Park",  lat: 12.9113, lon: 77.5081 },
  { name: "Prestige Tech Park",        lat: 12.9350, lon: 77.6860 },
  // ── Transit hubs ──
  { name: "✈️ KIA Airport",            lat: 13.1979, lon: 77.7063 },
  { name: "🚉 KSR City Station",       lat: 12.9774, lon: 77.5713 },
  { name: "🚉 Yeshwanthpur Station",   lat: 13.0219, lon: 77.5512 },
  { name: "🚉 KR Puram Station",       lat: 12.9959, lon: 77.6942 },
];

// ── Pure helpers ──────────────────────────────────────────────────────────────
function recomputeScore(factors: Locality["factors"], weights: Weights): number {
  const raw =
    factors.air_quality  * weights.air_quality +
    factors.amenities    * weights.amenities +
    factors.metro_access * weights.metro_access +
    factors.restaurants  * weights.restaurants;
  const norm =
    SCORE_NORM_MIN +
    ((raw - SCORE_RAW_MIN) / (SCORE_RAW_MAX - SCORE_RAW_MIN)) *
      (SCORE_NORM_MAX - SCORE_NORM_MIN);
  return Math.round(Math.max(SCORE_NORM_MIN, Math.min(SCORE_NORM_MAX, norm)) * 10) / 10;
}

function scoreColor(score: number): string {
  if (score >= 7) return "#4ade80";
  if (score >= 4) return "#fbbf24";
  return "#f87171";
}

// Allow only http/https URLs in anchor hrefs — rejects javascript: and other schemes.
function safeHref(url: string | undefined): string {
  if (!url) return "#";
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : "#";
  } catch {
    return "#";
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type TravelMode = "drive" | "walk";

function estimateTravel(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
  mode: TravelMode
): { distanceKm: number; durationMin: number } {
  const straight = haversineKm(lat1, lon1, lat2, lon2);
  const roadFactor = mode === "drive" ? 1.4 : 1.2;
  const avgSpeedKmh = mode === "drive" ? 22 : 5;
  const distanceKm = Math.round(straight * roadFactor * 10) / 10;
  const durationMin = Math.round((distanceKm / avgSpeedKmh) * 60);
  return { distanceKm, durationMin };
}

// ── Commute map pin (SVG drop-pin for origin A / destination B) ───────────────
function createCommutePin(label: string, color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "display:flex;flex-direction:column;align-items:center;pointer-events:none;";

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "34");
  svg.setAttribute("height", "44");
  svg.setAttribute("viewBox", "0 0 34 44");

  // Drop-pin shape: circle body + pointed base
  const path = document.createElementNS(ns, "path");
  path.setAttribute(
    "d",
    "M17 0C7.61 0 0 7.61 0 17c0 10.73 17 27 17 27S34 27.73 34 17C34 7.61 26.39 0 17 0z"
  );
  path.setAttribute("fill", color);
  path.setAttribute("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.4))");
  svg.appendChild(path);

  // White inner circle
  const circle = document.createElementNS(ns, "circle");
  circle.setAttribute("cx", "17");
  circle.setAttribute("cy", "17");
  circle.setAttribute("r", "9");
  circle.setAttribute("fill", "white");
  svg.appendChild(circle);

  // Label
  const text = document.createElementNS(ns, "text");
  text.setAttribute("x", "17");
  text.setAttribute("y", "21");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "11");
  text.setAttribute("font-weight", "800");
  text.setAttribute("fill", color);
  text.setAttribute("font-family", "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif");
  text.textContent = label;
  svg.appendChild(text);

  el.appendChild(svg);
  return el;
}

// ── Listing house-pin marker ──────────────────────────────────────────────────
function createListingPin(price: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "display:flex;flex-direction:column;align-items:center;cursor:pointer;";

  const label = price >= 100000
    ? `₹${(price / 100000).toFixed(1)}L`
    : `₹${Math.round(price / 1000)}k`;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "36");
  svg.setAttribute("viewBox", "0 0 28 36");

  const bg = document.createElementNS(ns, "path");
  bg.setAttribute("d", "M14 0C6.27 0 0 6.27 0 14c0 8.84 14 22 14 22S28 22.84 28 14C28 6.27 21.73 0 14 0z");
  bg.setAttribute("fill", "#3b82f6"); // blue house pins
  bg.setAttribute("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.35))");
  svg.appendChild(bg);

  // House icon
  const house = document.createElementNS(ns, "path");
  house.setAttribute("d", "M14 6L7 12v9h4v-5h6v5h4V12z");
  house.setAttribute("fill", "white");
  svg.appendChild(house);

  el.appendChild(svg);

  // Price label below pin
  const tag = document.createElement("div");
  tag.style.cssText = [
    "font-size:9px", "font-weight:800", "color:#111827",
    "background:white", "border:1px solid #e5e7eb",
    "padding:1px 4px", "border-radius:4px",
    "margin-top:1px", "white-space:nowrap",
    "box-shadow:0 1px 3px rgba(0,0,0,0.15)",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "pointer-events:none",
  ].join(";");
  tag.textContent = label;
  el.appendChild(tag);

  return el;
}

// ── Shared locate icon ────────────────────────────────────────────────────────
function LocateIcon({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <svg
        width="18" height="18" viewBox="0 0 18 18" fill="none"
        style={{ animation: "spin 1s linear infinite" }}
      >
        <circle cx="9" cy="9" r="7" stroke="#9ca3af" strokeWidth="2" strokeDasharray="22 12" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="6.5" stroke="#374151" strokeWidth="1.8" />
      <circle cx="9" cy="9" r="2" fill="#111827" />
      <line x1="9" y1="1"    x2="9"   y2="3.5"  stroke="#374151" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="9" y1="14.5" x2="9"   y2="17"   stroke="#374151" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="1" y1="9"    x2="3.5" y2="9"    stroke="#374151" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14.5" y1="9" x2="17"  y2="9"    stroke="#374151" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// ── Search box: input + dropdown + locate button (desktop & mobile) ───────────
function SearchBox({
  query,
  onChange,
  results,
  onSelect,
  onLocate,
  geoLoading,
  compact = false,
}: {
  query: string;
  onChange: (q: string) => void;
  results: LocalityFull[];
  onSelect: (loc: LocalityFull) => void;
  onLocate: () => void;
  geoLoading: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <input
          type="text"
          placeholder="Search neighbourhood..."
          value={query}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{
            width: "100%",
            padding: compact ? "9px 12px" : "9px 14px",
            borderRadius: 8,
            border: compact ? "1.5px solid #e5e7eb" : "1.5px solid rgba(0,0,0,0.15)",
            boxShadow: compact ? "none" : "0 2px 12px rgba(0,0,0,0.22)",
            fontSize: 16,
            outline: "none",
            boxSizing: "border-box",
            background: "white",
            color: "#111827",
          }}
        />
        {open && results.length > 0 && (
          <div style={{
            position: "absolute", left: 0, right: 0, zIndex: 20,
            background: "white", borderRadius: 8, marginTop: 4,
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)", overflow: "hidden",
          }}>
            {results.map((loc) => (
              <div
                key={loc.name}
                onMouseDown={() => onSelect(loc)}
                style={{
                  padding: "9px 14px", fontSize: 14, cursor: "pointer",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  borderBottom: "1px solid #f3f4f6", color: "#111827", background: "white",
                }}
              >
                <span>{loc.name}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor(loc.overall_score) }}>
                  {loc.overall_score}/10
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onLocate}
        disabled={geoLoading}
        title="Find nearest neighbourhood"
        style={{
          flexShrink: 0, width: 40, height: 40, borderRadius: 8,
          background: "white",
          border: compact ? "1.5px solid #64748b" : "1.5px solid rgba(0,0,0,0.22)",
          boxShadow: compact ? "0 1px 4px rgba(0,0,0,0.14)" : "0 2px 12px rgba(0,0,0,0.22)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: geoLoading ? "default" : "pointer", padding: 0,
        }}
      >
        <LocateIcon loading={geoLoading} />
      </button>
    </div>
  );
}

// ── Filter chips ──────────────────────────────────────────────────────────────
function FilterChips({ value, onChange }: { value: ScoreFilter; onChange: (v: ScoreFilter) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {FILTER_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "5px 12px", borderRadius: 20, fontSize: 12,
              fontWeight: active ? 700 : 500,
              background: active ? opt.activeBg : opt.bg,
              color: active ? (opt.value === "all" ? "white" : opt.color) : opt.color,
              border: active ? "1.5px solid transparent" : "1.5px solid #94a3b8",
              cursor: "pointer",
              boxShadow: active ? "0 2px 6px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.10)",
              transition: "all 0.15s",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div style={{ fontSize: 14, color: "#374151" }}>
      {[
        { color: "#4ade80", label: "Score 7–10 (Great)" },
        { color: "#fbbf24", label: "Score 4–7 (Good)"  },
        { color: "#f87171", label: "Score 1–4 (Low)"   },
      ].map(({ color, label }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
          {label}
        </div>
      ))}
    </div>
  );
}

// ── Weight sliders ────────────────────────────────────────────────────────────
function WeightSliders({ weights, onChange }: { weights: Weights; onChange: (w: Weights) => void }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#111827", margin: 0 }}>Personalise weights</h3>
        <button
          onClick={() => onChange(DEFAULT_WEIGHTS)}
          style={{ fontSize: 11, color: "#111827", background: "white", border: "1.5px solid #374151", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontWeight: 600 }}
        >
          Reset
        </button>
      </div>
      {(Object.keys(weights) as FactorKey[]).map((k) => (
        <div key={k} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, marginBottom: 4, color: "#374151", fontWeight: 500 }}>{SLIDER_LABELS[k]}</div>
          <input
            type="range" min={0} max={100} step={5}
            value={Math.round(weights[k] * 100)}
            onChange={(e) => {
              const newVal = Number(e.target.value) / 100;
              const delta = newVal - weights[k];
              const others = (Object.keys(weights) as FactorKey[]).filter((key) => key !== k);
              const othersSum = others.reduce((s, key) => s + weights[key], 0);
              const next = { ...weights, [k]: newVal };
              if (othersSum > 0) {
                others.forEach((key) => {
                  next[key] = Math.max(0, weights[key] - delta * (weights[key] / othersSum));
                });
              } else {
                others.forEach((key) => { next[key] = Math.max(0, (1 - newVal) / others.length); });
              }
              const total = Object.values(next).reduce((a, b) => a + b, 0);
              if (total > 0) (Object.keys(next) as FactorKey[]).forEach((key) => { next[key] = next[key] / total; });
              onChange(next);
            }}
            style={{ width: "100%", accentColor: "#4ade80" }}
          />
        </div>
      ))}
      <p style={{ fontSize: 13, color: "#374151", margin: "4px 0 0" }}>Drag to prioritise what matters to you</p>
    </div>
  );
}

// ── Factor bars ───────────────────────────────────────────────────────────────
function FactorBars({ factors }: { factors: Locality["factors"] }) {
  return (
    <>
      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Factor scores
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
        {Object.entries(factors).map(([k, v]) => (
          <div key={k}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
              <span style={{ color: "#374151", textTransform: "capitalize" }}>{SLIDER_LABELS[k as FactorKey] ?? k.replace(/_/g, " ")}</span>
              <span style={{ fontWeight: 700, color: "#111827" }}>{v}/10</span>
            </div>
            <div style={{ height: 5, background: "#e5e7eb", borderRadius: 3 }}>
              <div style={{ height: 5, width: `${v * 10}%`, background: scoreColor(v), borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Raw data accordion ────────────────────────────────────────────────────────
function RawData({ raw }: { raw: Locality["raw"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ fontSize: 12, color: "#6b7280", background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 500 }}
      >
        {open ? "▲ Hide raw data" : "▼ Show raw data"}
      </button>
      {open && (
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
          {Object.entries(raw).map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #f3f4f6" }}>
              <span style={{ color: "#374151", textTransform: "capitalize" }}>{RAW_LABELS[k as keyof Locality["raw"]] ?? k.replace(/_/g, " ")}</span>
              <span style={{ fontWeight: 600, color: "#111827" }}>{v ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sentiment card ────────────────────────────────────────────────────────────
function SentimentCard({ data }: { data: SentimentEntry }) {
  const c = SENTIMENT_COLORS[data.label];
  const pct = Math.round(((data.compound + 1) / 2) * 100);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#111827", margin: 0 }}>Reddit sentiment</h3>
        <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 12, background: c.bg, color: c.text }}>
          {data.label}
        </span>
      </div>
      <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3, marginBottom: 8 }}>
        <div style={{ height: 6, width: `${pct}%`, background: c.bar, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 13, color: "#6b7280", marginBottom: 10 }}>
        <span>👍 {data.positive}</span>
        <span>😐 {data.neutral}</span>
        <span>👎 {data.negative}</span>
        <span style={{ marginLeft: "auto" }}>from {data.total} posts</span>
      </div>
      {data.summary && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{data.summary}</p>
      )}
      {data.quotes && data.quotes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 8px" }}>
            What Redditors say
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {data.quotes.map((q, i) => (
              <li key={i} style={{
                borderLeft: `3px solid ${c.bar}`, paddingLeft: 10, marginBottom: 8,
                fontSize: 12, color: "#4b5563", fontStyle: "italic", lineHeight: 1.55,
              }}>
                &ldquo;{q}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Commute estimate panel ────────────────────────────────────────────────────
type RouteResult = { durationMin: number; distanceKm: number };

// ── Listings panel ────────────────────────────────────────────────────────────
// DB row extends the shared Listing type with an auto-generated pk and timestamp.
type ListingRow = Listing & { id: string; fetched_at?: string };

type SourceStatus = { source: string; ok: boolean; count: number; error?: string };

const SOURCE_LABELS: Record<string, string> = {
  nobroker: "NoBroker",
  housing: "Housing.com",
};

const MAX_PRICE_OPTIONS = [
  { label: "Any price", value: 0 },
  { label: "< ₹20k/mo", value: 20000 },
  { label: "< ₹30k/mo", value: 30000 },
  { label: "< ₹50k/mo", value: 50000 },
];

function ListingsPanel({
  locality,
  onListingsLoaded,
}: {
  locality: string;
  onListingsLoaded?: (listings: ListingRow[]) => void;
}) {
  const [enabled,    setEnabled]    = useState(false);
  const [listings,   setListings]   = useState<ListingRow[]>([]);
  const [sources,    setSources]    = useState<SourceStatus[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [fetchedAt,  setFetchedAt]  = useState<string | null>(null);
  const [bhkFilter,  setBhkFilter]  = useState<number | null>(null);
  const [maxPrice,   setMaxPrice]   = useState(0);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Reset when locality changes
  useEffect(() => {
    setEnabled(false);
    setListings([]);
    setSources([]);
    setError(null);
    setFetchedAt(null);
    setBhkFilter(null);
    setMaxPrice(0);
  }, [locality]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch when enabled
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    fetch(`/api/listings?locality=${encodeURIComponent(locality)}`)
      .then((r) => r.json())
      .then((data: { listings: ListingRow[]; cached: boolean; fetchedAt: string | null; sources: SourceStatus[] }) => {
        setListings(data.listings ?? []);
        setSources(data.sources ?? []);
        const ts = data.fetchedAt ?? new Date().toISOString();
        setFetchedAt(new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
      })
      .catch(() => setError("Could not reach listing service"))
      .finally(() => setLoading(false));
  }, [enabled, locality]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = listings.filter((l) => {
    if (bhkFilter !== null && l.bhk !== bhkFilter) return false;
    if (maxPrice > 0 && l.price > maxPrice) return false;
    return true;
  });

  // Sync map markers whenever filters or listings change
  useEffect(() => {
    onListingsLoaded?.(enabled ? filtered : []);
  }, [filtered, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const failedSources = sources.filter((s) => !s.ok);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
          🏠 Rental listings
        </h3>
        {/* Toggle */}
        <button
          onClick={() => setEnabled((v) => !v)}
          style={{
            width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
            background: enabled ? "#4ade80" : "#d1d5db",
            position: "relative", flexShrink: 0, transition: "background 0.2s",
          }}
        >
          <span style={{
            position: "absolute", top: 3, left: enabled ? 21 : 3,
            width: 16, height: 16, borderRadius: "50%", background: "white",
            transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }} />
        </button>
      </div>

      {!enabled && (
        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>
          Toggle on to load live rental listings from NoBroker &amp; Housing.com
        </p>
      )}

      {enabled && loading && (
        <div>
          {[1,2,3].map((i) => (
            <div key={i} style={{
              height: 90, borderRadius: 8, background: "linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 50%,#f3f4f6 75%)",
              marginBottom: 8, animation: "shimmer 1.4s infinite",
            }} />
          ))}
          <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", marginTop: 4 }}>
            Fetching from 3 sources…
          </p>
        </div>
      )}

      {enabled && !loading && error && (
        <div style={{ fontSize: 13, color: "#ef4444", padding: "8px 0" }}>{error}</div>
      )}

      {enabled && !loading && !error && listings.length > 0 && (
        <>
          {/* Failed sources warning */}
          {failedSources.length > 0 && (
            <div style={{
              fontSize: 11, color: "#92400e", background: "#fffbeb",
              border: "1px solid #fde68a", borderRadius: 6, padding: "5px 8px", marginBottom: 8,
            }}>
              ⚠️ {failedSources.map((s) => SOURCE_LABELS[s.source] ?? s.source).join(", ")} didn&apos;t respond
            </div>
          )}

          {/* Filters */}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
            {[null, 1, 2, 3].map((b) => (
              <button
                key={b ?? "all"}
                onClick={() => setBhkFilter(b === bhkFilter ? null : b)}
                style={{
                  padding: "3px 9px", borderRadius: 12, fontSize: 11,
                  fontWeight: bhkFilter === b ? 700 : 500,
                  background: bhkFilter === b ? "#111827" : "#f1f5f9",
                  color: bhkFilter === b ? "white" : "#374151",
                  border: bhkFilter === b ? "1.5px solid transparent" : "1.5px solid #94a3b8",
                  cursor: "pointer",
                  boxShadow: bhkFilter === b ? "0 2px 6px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.10)",
                }}
              >
                {b === null ? "All BHK" : b === 3 ? "3BHK+" : `${b}BHK`}
              </button>
            ))}
            <select
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              style={{
                padding: "3px 8px", borderRadius: 12, fontSize: 11, border: "1.5px solid #94a3b8",
                background: "#f1f5f9", color: "#374151", cursor: "pointer", outline: "none",
                boxShadow: "0 1px 3px rgba(0,0,0,0.10)",
              }}
            >
              {MAX_PRICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Listing cards */}
          {filtered.length === 0 ? (
            <p style={{ fontSize: 13, color: "#9ca3af" }}>No listings match your filters.</p>
          ) : (
            filtered.map((l) => (
              <div
                key={`${l.source}-${l.source_id}`}
                ref={(el) => { if (el) cardRefs.current.set(`${l.source}-${l.source_id}`, el); }}
                style={{
                  border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px",
                  marginBottom: 8, background: "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>
                    ₹{l.price.toLocaleString("en-IN")}<span style={{ fontSize: 11, fontWeight: 400, color: "#6b7280" }}>/mo</span>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 8,
                    background: l.source === "nobroker" ? "#f0fdf4" : "#fdf4ff",
                    color: l.source === "nobroker" ? "#166534" : "#7e22ce",
                  }}>
                    {SOURCE_LABELS[l.source] ?? l.source}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#374151", marginBottom: 6, lineHeight: 1.4 }}>
                  {[
                    l.bhk ? `${l.bhk}BHK` : null,
                    l.area_sqft ? `${l.area_sqft} sqft` : null,
                    l.furnishing ?? null,
                  ].filter(Boolean).join(" · ")}
                </div>
                {l.deposit && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                    Deposit: ₹{l.deposit.toLocaleString("en-IN")}
                  </div>
                )}
                {l.address && (
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.address}
                  </div>
                )}
                <a
                  href={safeHref(l.source_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11, fontWeight: 600, color: "#3b82f6",
                    textDecoration: "none", display: "inline-block",
                  }}
                >
                  View listing →
                </a>
              </div>
            ))
          )}

          {fetchedAt && (
            <p style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
              Last refreshed {fetchedAt} · Cached 24 h
            </p>
          )}
        </>
      )}

      {enabled && !loading && !error && listings.length === 0 && (
        <div style={{ fontSize: 13, color: "#9ca3af", padding: "8px 0" }}>
          No listings found for {locality}. Try a nearby area.
        </div>
      )}

      <style>{`
        @keyframes shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
      `}</style>
    </div>
  );
}

// ── Heatmap Panel ─────────────────────────────────────────────────────────────
function HeatmapPanel({
  active,
  onToggle,
  dest,
  onDestChange,
  mode,
  onModeChange,
  loading,
  commuteData,
  localities,
}: {
  active: boolean;
  onToggle: (v: boolean) => void;
  dest: { name: string; lat: number; lon: number } | null;
  onDestChange: (d: { name: string; lat: number; lon: number } | null) => void;
  mode: "drive" | "walk";
  onModeChange: (m: "drive" | "walk") => void;
  loading: boolean;
  commuteData: Record<string, number>;
  localities: LocalityFull[];
}) {
  const [tab, setTab] = useState<"techpark" | "locality">("techpark");
  const sortedLocalities = [...localities].sort((a, b) => a.name.localeCompare(b.name));
  const hasData = Object.keys(commuteData).length > 0;

  return (
    <div style={{ marginTop: 4 }}>
      {/* Toggle header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: active ? 12 : 0 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
          Commute Heatmap
        </h3>
        <button
          onClick={() => onToggle(!active)}
          style={{
            padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
            background: active ? "#4ade80" : "#f1f5f9",
            color: active ? "#065f46" : "#374151",
            border: active ? "1.5px solid transparent" : "1.5px solid #94a3b8",
            cursor: "pointer",
            boxShadow: active ? "0 2px 6px rgba(74,222,128,0.4)" : "0 1px 3px rgba(0,0,0,0.10)",
          }}
        >
          {active ? "On" : "Off"}
        </button>
      </div>

      {active && (
        <>
          {/* Tab toggle: tech parks vs locality */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["techpark", "locality"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); onDestChange(null); }}
                style={{
                  padding: "5px 11px", borderRadius: 20, fontSize: 12,
                  fontWeight: tab === t ? 700 : 500,
                  background: tab === t ? "#111827" : "#f1f5f9",
                  color: tab === t ? "white" : "#374151",
                  border: tab === t ? "1.5px solid transparent" : "1.5px solid #94a3b8",
                  cursor: "pointer",
                  boxShadow: tab === t ? "0 2px 6px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.10)",
                }}
              >
                {t === "techpark" ? "📍 Tech Parks" : "🏘️ Locality"}
              </button>
            ))}
          </div>

          {/* Destination picker */}
          {tab === "techpark" ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {TECH_PARKS.map((tp) => {
                const active2 = dest?.name === tp.name;
                return (
                  <button
                    key={tp.name}
                    onClick={() => onDestChange(active2 ? null : tp)}
                    style={{
                      padding: "5px 10px", borderRadius: 20, fontSize: 11,
                      fontWeight: active2 ? 700 : 500,
                      background: active2 ? "#818cf8" : "#f1f5f9",
                      color: active2 ? "white" : "#374151",
                      border: active2 ? "1.5px solid transparent" : "1.5px solid #94a3b8",
                      cursor: "pointer",
                      boxShadow: active2 ? "0 2px 6px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.10)",
                    }}
                  >
                    {tp.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <select
              value={dest?.name ?? ""}
              onChange={(e) => {
                const loc = sortedLocalities.find((l) => l.name === e.target.value);
                onDestChange(loc ? { name: loc.name, lat: loc.lat, lon: loc.lon } : null);
              }}
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 8, marginBottom: 10,
                border: "1.5px solid #e5e7eb", fontSize: 13, color: "#111827",
                background: "white", outline: "none", cursor: "pointer",
              }}
            >
              <option value="">Select a neighbourhood…</option>
              {sortedLocalities.map((l) => (
                <option key={l.name} value={l.name}>{l.name}</option>
              ))}
            </select>
          )}

          {/* Drive / Walk toggle */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["drive", "walk"] as const).map((m) => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                style={{
                  padding: "5px 14px", borderRadius: 20, fontSize: 12,
                  fontWeight: mode === m ? 700 : 500,
                  background: mode === m ? "#111827" : "#f1f5f9",
                  color: mode === m ? "white" : "#374151",
                  border: mode === m ? "1.5px solid transparent" : "1.5px solid #94a3b8",
                  cursor: "pointer",
                  boxShadow: mode === m ? "0 2px 6px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.10)",
                }}
              >
                {m === "drive" ? "🚗 Drive" : "🚶 Walk"}
              </button>
            ))}
          </div>

          {/* Status */}
          {!dest && (
            <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 8px" }}>
              Pick a destination above to paint the map by commute time.
            </p>
          )}
          {dest && loading && (
            <div style={{ fontSize: 13, color: "#6b7280", padding: "8px 0" }}>
              Calculating commute times…
            </div>
          )}

          {/* Legend — shown only once data is available */}
          {dest && hasData && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
              {[
                { color: "#22c55e", label: "≤ 20 min" },
                { color: "#fde68a", label: "20–35 min" },
                { color: "#fb923c", label: "35–50 min" },
                { color: "#ef4444", label: "> 50 min" },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: "#374151" }}>{label}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CommutePanel({
  originLat,
  originLon,
  localities,
  onDestinationChange,
}: {
  originLat: number;
  originLon: number;
  localities: LocalityFull[];
  onDestinationChange?: (dest: { name: string; lat: number; lon: number } | null) => void;
}) {
  const [tab, setTab]               = useState<"techpark" | "locality">("techpark");
  const [selectedDest, setSelectedDest] = useState<{ name: string; lat: number; lon: number } | null>(null);
  const [mode, setMode]             = useState<TravelMode>("drive");
  const [result,  setResult]        = useState<RouteResult | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error,   setError]         = useState<string | null>(null);

  // Reset when origin neighbourhood changes
  useEffect(() => {
    setSelectedDest(null);
    setResult(null);
    setError(null);
  }, [originLat, originLon]);

  // Notify parent when destination changes (for map pin rendering)
  useEffect(() => {
    onDestinationChange?.(selectedDest);
  }, [selectedDest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch from OSRM proxy whenever dest or mode changes
  useEffect(() => {
    if (!selectedDest) { setResult(null); setError(null); return; }
    const profile = mode === "drive" ? "driving" : "foot";
    let cancelled = false;
    setLoading(true);
    setResult(null);
    setError(null);
    fetch("/api/route-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originLat, originLon,
        destLat: selectedDest.lat, destLon: selectedDest.lon,
        profile,
      }),
    })
      .then((r) => r.json())
      .then((data: RouteResult & { error?: string }) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); }
        else { setResult(data); }
      })
      .catch(() => { if (!cancelled) setError("Could not reach routing service"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDest, mode, originLat, originLon]);

  const sortedLocalities = [...localities].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Commute estimate
      </h3>

      {/* Tab toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["techpark", "locality"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSelectedDest(null); }}
            style={{
              padding: "5px 11px", borderRadius: 20, fontSize: 12,
              fontWeight: tab === t ? 700 : 500,
              background: tab === t ? "#111827" : "#f1f5f9",
              color: tab === t ? "white" : "#374151",
              border: tab === t ? "1.5px solid transparent" : "1.5px solid #94a3b8",
              cursor: "pointer",
              boxShadow: tab === t ? "0 2px 6px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.10)",
            }}
          >
            {t === "techpark" ? "📍 Destinations" : "🏘️ Neighbourhood"}
          </button>
        ))}
      </div>

      {/* Destination picker */}
      {tab === "techpark" ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {TECH_PARKS.map((tp) => {
            const active = selectedDest?.name === tp.name;
            return (
              <button
                key={tp.name}
                onClick={() => setSelectedDest(active ? null : tp)}
                style={{
                  padding: "5px 10px", borderRadius: 20, fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  background: active ? "#4ade80" : "#f1f5f9",
                  color: active ? "#065f46" : "#374151",
                  border: active ? "1.5px solid transparent" : "1.5px solid #94a3b8",
                  cursor: "pointer",
                  boxShadow: active ? "0 2px 6px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.10)",
                }}
              >
                {tp.name}
              </button>
            );
          })}
        </div>
      ) : (
        <select
          value={selectedDest?.name ?? ""}
          onChange={(e) => {
            const loc = sortedLocalities.find((l) => l.name === e.target.value);
            setSelectedDest(loc ? { name: loc.name, lat: loc.lat, lon: loc.lon } : null);
          }}
          style={{
            width: "100%", padding: "8px 10px", borderRadius: 8, marginBottom: 10,
            border: "1.5px solid #e5e7eb", fontSize: 13, color: "#111827",
            background: "white", outline: "none", cursor: "pointer",
          }}
        >
          <option value="">Select a neighbourhood…</option>
          {sortedLocalities.map((l) => (
            <option key={l.name} value={l.name}>{l.name}</option>
          ))}
        </select>
      )}

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["drive", "walk"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: "5px 14px", borderRadius: 20, fontSize: 12,
              fontWeight: mode === m ? 700 : 500,
              background: mode === m ? "#111827" : "#f1f5f9",
              color: mode === m ? "white" : "#374151",
              border: mode === m ? "1.5px solid transparent" : "1.5px solid #94a3b8",
              cursor: "pointer",
              boxShadow: mode === m ? "0 2px 6px rgba(0,0,0,0.18)" : "0 1px 3px rgba(0,0,0,0.10)",
            }}
          >
            {m === "drive" ? "🚗 Drive" : "🚶 Walk"}
          </button>
        ))}
      </div>

      {/* Result / loading / error */}
      {loading && (
        <div style={{ fontSize: 13, color: "#6b7280", padding: "10px 0" }}>
          Calculating route…
        </div>
      )}
      {!loading && error && (
        <div style={{ fontSize: 13, color: "#ef4444", padding: "10px 0" }}>
          {error}
        </div>
      )}
      {!loading && result && selectedDest && (
        <div style={{
          background: "#f9fafb", borderRadius: 8, padding: "10px 12px",
          border: "1px solid #e5e7eb",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 2 }}>
              {result.durationMin} min · {result.distanceKm} km
            </div>
            <button
              onClick={() => setSelectedDest(null)}
              title="Clear commute"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#9ca3af", fontSize: 16, lineHeight: 1, padding: "0 0 0 8px",
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            to {selectedDest.name} by {mode === "drive" ? "driving" : "walking"} · via road
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
            {mode === "drive"
              ? "Includes Bengaluru traffic estimate · no live data"
              : "Based on road distance at 5 km/h · includes safety buffer"}
          </div>
        </div>
      )}
    </>
  );
}

// ── Locality detail — shared by desktop sidebar and mobile sheet ──────────────
function LocalityDetail({
  selected,
  score,
  sentimentData,
  onDismiss,
  onCopy,
  copied,
  originLat,
  originLon,
  localities,
  onDestinationChange,
  onListingsLoaded,
}: {
  selected: Locality;
  score: number;
  sentimentData: Record<string, SentimentEntry>;
  onDismiss: () => void;
  onCopy: () => void;
  copied: boolean;
  originLat: number;
  originLon: number;
  localities: LocalityFull[];
  onDestinationChange?: (dest: { name: string; lat: number; lon: number } | null) => void;
  onListingsLoaded?: (listings: ListingRow[]) => void;
}) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button
          onClick={onDismiss}
          style={{ fontSize: 13, color: "#111827", background: "white", border: "1.5px solid #374151", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontWeight: 600 }}
        >
          ← Back
        </button>
        <button
          onClick={onCopy}
          style={{ fontSize: 11, color: copied ? "#059669" : "#374151", background: copied ? "#f0fdf4" : "#f1f5f9", border: copied ? "1.5px solid #059669" : "1.5px solid #64748b", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontWeight: 600, boxShadow: "0 1px 3px rgba(0,0,0,0.10)" }}
        >
          {copied ? "\u2713 Copied!" : "🔗 Copy link"}
        </button>
      </div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{selected.name}</h2>
      <div style={{ fontSize: 36, fontWeight: 800, color: scoreColor(score), marginBottom: 16 }}>
        {score}<span style={{ fontSize: 14, color: "#6b7280" }}>/10</span>
      </div>
      {sentimentData[selected.name] && <SentimentCard data={sentimentData[selected.name]} />}
      <div style={{ margin: "16px 0 12px", borderTop: "1px solid #e5e7eb" }} />
      <FactorBars factors={selected.factors} />
      <div style={{ margin: "16px 0 12px", borderTop: "1px solid #e5e7eb" }} />
      <CommutePanel originLat={originLat} originLon={originLon} localities={localities} onDestinationChange={onDestinationChange} />
      <div style={{ margin: "16px 0 12px", borderTop: "1px solid #e5e7eb" }} />
      <ListingsPanel locality={selected.name} onListingsLoaded={onListingsLoaded} />
      <div style={{ margin: "16px 0 12px", borderTop: "1px solid #e5e7eb" }} />
      <RawData raw={selected.raw} />
    </>
  );
}

// ── Email gate ────────────────────────────────────────────────────────────────
function EmailGate({ onSubmit, submitting }: { onSubmit: (email: string) => void; submitting: boolean }) {
  const [email, setEmail] = useState("");
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999, background: "rgba(17,24,39,0.75)",
      backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ background: "white", borderRadius: 16, padding: "36px 32px", maxWidth: 400, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🗺️</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, color: "#111827" }}>Bengaluru Neighborhood Explorer</h1>
        <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 28, lineHeight: 1.6 }}>
          Explore 100 Bengaluru neighbourhoods scored by air quality, amenities, metro access, and restaurants.
        </p>
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          maxLength={254}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSubmit(email); }}
          style={{
            width: "100%", padding: "11px 14px", borderRadius: 8,
            border: "1.5px solid #e5e7eb", fontSize: 14, outline: "none",
            marginBottom: 12, boxSizing: "border-box",
          }}
        />
        <button
          onClick={() => onSubmit(email)}
          disabled={submitting}
          style={{
            width: "100%", padding: "12px 0", borderRadius: 8,
            background: "#111827", color: "white", fontSize: 14, fontWeight: 700,
            border: "none", cursor: "pointer", marginBottom: 12, opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Saving…" : "Explore Map →"}
        </button>
        <button
          onClick={() => onSubmit("")}
          style={{ background: "none", border: "none", fontSize: 13, color: "#374151", cursor: "pointer" }}
        >
          Skip for now →
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Home() {
  const mapRef            = useRef<HTMLDivElement>(null);
  const mapInstanceRef    = useRef<maplibregl.Map | null>(null);
  const highlightedRef    = useRef<string | null>(null);
  const localitiesRef     = useRef<LocalityFull[]>([]);
  const markersRef        = useRef<{ el: HTMLDivElement; circle: HTMLDivElement; factors: Locality["factors"]; name: string }[]>([]);
  const weightsRef        = useRef<Weights>(DEFAULT_WEIGHTS);
  const scoreFilterRef    = useRef<ScoreFilter>("all");
  const isMobileRef       = useRef(false);
  const commuteMarkersRef  = useRef<{ origin: maplibregl.Marker | null; dest: maplibregl.Marker | null }>({ origin: null, dest: null });
  const listingMarkersRef  = useRef<maplibregl.Marker[]>([]);
  const heatmapMarkerRef   = useRef<maplibregl.Marker | null>(null);
  const heatmapActiveRef   = useRef(false);
  const commuteDataRef     = useRef<Record<string, number>>({});
  const savedViewRef      = useRef<{ center: [number, number]; zoom: number } | null>(null);

  const [selected,      setSelected]      = useState<Locality | null>(null);
  const [isMobile,      setIsMobile]      = useState(false);
  const [allLocalities, setAllLocalities] = useState<LocalityFull[]>([]);
  const [searchQuery,   setSearchQuery]   = useState("");
  const [showGate,      setShowGate]      = useState(false);
  const [gateSubmitting,setGateSubmitting]= useState(false);
  const [copied,        setCopied]        = useState(false);
  const [weights,       setWeights]       = useState<Weights>(DEFAULT_WEIGHTS);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [geoLoading,    setGeoLoading]    = useState(false);
  const [sidebarWidth,  setSidebarWidth]  = useState(360);
  const isDragging = useRef(false);
  const [scoreFilter,     setScoreFilter]     = useState<ScoreFilter>("all");
  const [sentimentData,   setSentimentData]   = useState<Record<string, SentimentEntry>>({});
  const [heatmapActive,   setHeatmapActive]   = useState(false);
  const [heatmapDest,     setHeatmapDest]     = useState<{ name: string; lat: number; lon: number } | null>(null);
  const [heatmapMode,     setHeatmapMode]     = useState<"drive" | "walk">("drive");
  const [commuteData,     setCommuteData]     = useState<Record<string, number>>({});
  const [heatmapLoading,  setHeatmapLoading]  = useState(false);

  const sheetOpen = selected !== null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const updateMarkerVisibility = useCallback(() => {
    markersRef.current.forEach(({ el, factors }) => {
      const score = recomputeScore(factors, weightsRef.current);
      const f = scoreFilterRef.current;
      const visible =
        f === "all" ||
        (f === "great" && score >= 7) ||
        (f === "good"  && score >= 4 && score < 7) ||
        (f === "low"   && score < 4);
      if (visible) {
        el.style.display  = "flex";
        el.style.alignItems = "center";
        el.style.opacity  = "0.85";
      } else {
        el.style.display  = "none";
      }
    });
  }, []);

  const dismiss = useCallback(() => {
    const map = mapInstanceRef.current;
    if (map && highlightedRef.current) {
      map.setFeatureState({ source: "localities", id: highlightedRef.current }, { hover: false });
      highlightedRef.current = null;
    }
    // Fly back to pre-selection view
    if (map && savedViewRef.current) {
      map.flyTo({ center: savedViewRef.current.center, zoom: savedViewRef.current.zoom, duration: 800 });
      savedViewRef.current = null;
    }
    commuteMarkersRef.current.origin?.remove();
    commuteMarkersRef.current.dest?.remove();
    commuteMarkersRef.current = { origin: null, dest: null };
    listingMarkersRef.current.forEach((m) => m.remove());
    listingMarkersRef.current = [];
    history.replaceState(null, "", window.location.pathname);
    setSelected(null);
    setSheetExpanded(false);
  }, []);

  const flyToLocality = useCallback((loc: LocalityFull) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    // Save current view before zooming in (only once — switching localities keeps original)
    if (!savedViewRef.current) {
      const c = map.getCenter();
      savedViewRef.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
    }
    if (highlightedRef.current && highlightedRef.current !== loc.name) {
      map.setFeatureState({ source: "localities", id: highlightedRef.current }, { hover: false });
    }
    highlightedRef.current = loc.name;
    map.setFeatureState({ source: "localities", id: loc.name }, { hover: true });

    // On mobile the bottom sheet expands to ~60dvh — shift the centre point up
    // so the selected locality is visible in the portion above the sheet.
    const bottomPad = isMobileRef.current ? Math.round(window.innerHeight * 0.62) : 0;
    map.flyTo({
      center: [loc.lon, loc.lat],
      zoom: 15,
      duration: 1000,
      ...(bottomPad > 0 && { padding: { top: 80, bottom: bottomPad, left: 0, right: 0 } }),
    });

    setSelected(loc);
    setSheetExpanded(true);
    setSearchQuery("");
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const locateUser = useCallback(() => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        const locs = localitiesRef.current;
        if (!locs.length) return;
        const nearest = locs.reduce((best, loc) =>
          haversineKm(pos.coords.latitude, pos.coords.longitude, loc.lat, loc.lon) <
          haversineKm(pos.coords.latitude, pos.coords.longitude, best.lat, best.lon)
            ? loc : best
        );
        flyToLocality(nearest);
      },
      () => setGeoLoading(false),
      { timeout: 8000, maximumAge: 60000 }
    );
  }, [flyToLocality]);

  const handleCommuteDestChange = useCallback((dest: { name: string; lat: number; lon: number } | null) => {
    const map = mapInstanceRef.current;
    // Always clear the old commute markers first
    commuteMarkersRef.current.origin?.remove();
    commuteMarkersRef.current.dest?.remove();
    commuteMarkersRef.current = { origin: null, dest: null };
    if (!dest || !map) return;
    const origin = localitiesRef.current.find((l) => l.name === highlightedRef.current);
    if (!origin) return;

    const originEl = createCommutePin("A", "#3b82f6"); // blue
    const destEl   = createCommutePin("B", "#8b5cf6"); // purple

    commuteMarkersRef.current.origin = new maplibregl.Marker({ element: originEl, anchor: "bottom" })
      .setLngLat([origin.lon, origin.lat])
      .addTo(map);
    commuteMarkersRef.current.dest = new maplibregl.Marker({ element: destEl, anchor: "bottom" })
      .setLngLat([dest.lon, dest.lat])
      .addTo(map);

    // Fit map to show both pins
    const bounds = new maplibregl.LngLatBounds(
      [Math.min(origin.lon, dest.lon), Math.min(origin.lat, dest.lat)],
      [Math.max(origin.lon, dest.lon), Math.max(origin.lat, dest.lat)],
    );
    const bottomPad = isMobileRef.current ? 320 : 100;
    const rightPad  = isMobileRef.current ? 60 : 400;
    map.fitBounds(bounds, {
      padding: { top: 100, bottom: bottomPad, left: 60, right: rightPad },
      maxZoom: 14,
      duration: 900,
    });
  }, []);

  const handleListingsLoaded = useCallback((listings: ListingRow[]) => {
    const map = mapInstanceRef.current;
    // Clear existing listing markers
    listingMarkersRef.current.forEach((m) => m.remove());
    listingMarkersRef.current = [];
    if (!map) return;
    for (const l of listings) {
      if (!l.lat || !l.lon) continue;
      const el = createListingPin(l.price);
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([l.lon, l.lat])
        .addTo(map);
      listingMarkersRef.current.push(marker);
    }
  }, []);

  // ── Commute heatmap ───────────────────────────────────────────────────────
  const fetchHeatmap = useCallback(async (
    dest: { name: string; lat: number; lon: number },
    mode: "drive" | "walk",
  ) => {
    const locs = localitiesRef.current;
    if (!locs.length) return;
    setHeatmapLoading(true);
    setCommuteData({});
    commuteDataRef.current = {};
    try {
      const res = await fetch("/api/commute-heatmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destLat: dest.lat,
          destLon: dest.lon,
          mode,
          localities: locs.map((l) => ({ name: l.name, lat: l.lat, lon: l.lon })),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const data: { results: CommuteResult[] } = await res.json();
      const map: Record<string, number> = {};
      for (const r of data.results) map[r.name] = r.durationMin;
      setCommuteData(map);
      commuteDataRef.current = map;
    } catch {
      // silent — heatmap stays in loading state; user can retry
    } finally {
      setHeatmapLoading(false);
    }
  }, []);

  const handleGateSubmit = useCallback(async (email: string) => {    setGateSubmitting(true);
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
  }, []);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    isMobileRef.current = mq.matches;
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => {
      isMobileRef.current = e.matches;
      setIsMobile(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("blr_visited")) setShowGate(true);
  }, []);

  useEffect(() => {
    if (selected) {
      history.replaceState(null, "", `?locality=${encodeURIComponent(selected.name)}`);
    }
  }, [selected]);

  // Re-colour markers when weights change
  useEffect(() => {
    weightsRef.current = weights;
    markersRef.current.forEach(({ circle, factors }) => {
      const score = recomputeScore(factors, weights);
      circle.style.background = scoreColor(score);
      circle.textContent = String(score);
    });
    updateMarkerVisibility();
  }, [weights, updateMarkerVisibility]);

  // Show/hide markers when filter changes
  useEffect(() => {
    scoreFilterRef.current = scoreFilter;
    updateMarkerVisibility();
  }, [scoreFilter, updateMarkerVisibility]);

  // Fetch heatmap data whenever dest / mode changes while heatmap is active
  useEffect(() => {
    if (heatmapActive && heatmapDest) {
      heatmapActiveRef.current = true;
      fetchHeatmap(heatmapDest, heatmapMode);
    } else {
      heatmapActiveRef.current = false;
      commuteDataRef.current = {};
      setCommuteData({});
      setHeatmapLoading(false);
    }
  }, [heatmapActive, heatmapDest, heatmapMode, fetchHeatmap]);

  // Re-paint map layers and DOM markers whenever heatmap data updates
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const colorExpr = (useHeatmap: boolean) => useHeatmap
      ? [
          "case",
          ["<=", ["number", ["feature-state", "commuteMin"], -1], 0], "#9ca3af",
          ["<=", ["feature-state", "commuteMin"], 20], "#22c55e",
          ["<=", ["feature-state", "commuteMin"], 35], "#fde68a",
          ["<=", ["feature-state", "commuteMin"], 50], "#fb923c",
          "#ef4444",
        ]
      : ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 7, "#4ade80"];

    const hasData = Object.keys(commuteData).length > 0;

    if (heatmapActive && hasData) {
      // Paint each locality by commute time via feature-state
      localitiesRef.current.forEach(({ name }) => {
        const min = commuteData[name] ?? -1;
        map.setFeatureState({ source: "localities", id: name }, { commuteMin: min });
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.setPaintProperty("localities-fill", "fill-color", colorExpr(true) as any);
      map.setPaintProperty("localities-fill", "fill-opacity", [
        "case", ["boolean", ["feature-state", "hover"], false], 0.90, 0.65,
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.setPaintProperty("localities-outline", "line-color", colorExpr(true) as any);

      // Destination marker
      heatmapMarkerRef.current?.remove();
      if (heatmapDest) {
        const el = createCommutePin("🏢", "#8b5cf6");
        heatmapMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([heatmapDest.lon, heatmapDest.lat])
          .addTo(map);
      }

      // DOM circles: show "23m" instead of score
      markersRef.current.forEach(({ circle, name: mName }) => {
        const min = commuteData[mName];
        if (min != null) {
          circle.style.background = commuteColor(min);
          circle.textContent = `${min}m`;
          circle.style.fontSize = "9px";
        } else {
          circle.style.background = "#9ca3af";
          circle.textContent = "–";
          circle.style.fontSize = "11px";
        }
      });
    } else if (!heatmapActive) {
      // Restore score-based colouring
      localitiesRef.current.forEach(({ name }) => {
        map.removeFeatureState({ source: "localities", id: name }, "commuteMin");
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.setPaintProperty("localities-fill", "fill-color", colorExpr(false) as any);
      map.setPaintProperty("localities-fill", "fill-opacity", [
        "case", ["boolean", ["feature-state", "hover"], false], 0.22, 0.01,
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.setPaintProperty("localities-outline", "line-color", colorExpr(false) as any);

      heatmapMarkerRef.current?.remove();
      heatmapMarkerRef.current = null;

      // DOM circles: restore score display
      markersRef.current.forEach(({ circle, factors }) => {
        const score = recomputeScore(factors, weightsRef.current);
        circle.style.background = scoreColor(score);
        circle.textContent = String(score);
        circle.style.fontSize = "11px";
      });
      updateMarkerVisibility();
    }
  }, [heatmapActive, commuteData, heatmapDest, updateMarkerVisibility]);


  useEffect(() => {
    if (!mapRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "04bSXwUhzSopi5O4VlUz"}`,
      center: [77.6, 12.97],
      zoom: 11,
      pitch: 45,
      bearing: -10,
      preserveDrawingBuffer: true, // keeps WebGL buffer alive on iOS
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    mapInstanceRef.current = map;

    // iOS WebGL blank-map fixes: resize on all events that can blank the canvas
    const resizeMap = () => mapInstanceRef.current?.resize();
    requestAnimationFrame(resizeMap);
    setTimeout(resizeMap, 100);
    setTimeout(resizeMap, 500);

    const onPageShow = (e: PageTransitionEvent) => {
      resizeMap();
      if (e.persisted) { setTimeout(resizeMap, 50); setTimeout(resizeMap, 300); }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { resizeMap(); setTimeout(resizeMap, 200); }
    };
    const onOrient = () => setTimeout(resizeMap, 300);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("orientationchange", onOrient);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && mapRef.current) {
      ro = new ResizeObserver(resizeMap);
      ro.observe(mapRef.current);
    }

    map.on("load", async () => {
      const [res, sentRes] = await Promise.all([
        fetch("/localities_scored.geojson"),
        fetch("/sentiment.json"),
      ]);
      const data = await res.json();
      const sentimentList: SentimentEntry[] = sentRes.ok ? await sentRes.json() : [];
      const sentMap: Record<string, SentimentEntry> = Object.fromEntries(
        sentimentList.map((s) => [s.name, s])
      );
      setSentimentData(sentMap);

      const mapLocalities: LocalityFull[] = (data.features as LocalityFeature[]).map((f) => ({
        name:          f.properties.name,
        lat:           f.properties.lat,
        lon:           f.properties.lon,
        overall_score: f.properties.overall_score,
        factors:       f.properties.factors,
        raw:           f.properties.raw,
      }));

      map.addSource("localities", { type: "geojson", data, promoteId: "name" });

      // Fill: tiny non-zero opacity so queryRenderedFeatures registers clicks on polygons
      map.addLayer({
        id: "localities-fill",
        type: "fill",
        source: "localities",
        paint: {
          "fill-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 7, "#4ade80"],
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.22, 0.01],
        },
      });

      // Outline: visible only on hover/click
      map.addLayer({
        id: "localities-outline",
        type: "line",
        source: "localities",
        paint: {
          "line-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 7, "#4ade80"],
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0],
        },
      });

      // Click on empty map space → dismiss any active selection
      map.on("click", () => {
        if (highlightedRef.current) {
          map.setFeatureState({ source: "localities", id: highlightedRef.current }, { hover: false });
          highlightedRef.current = null;
          history.replaceState(null, "", window.location.pathname);
          if (savedViewRef.current) {
            map.flyTo({ center: savedViewRef.current.center, zoom: savedViewRef.current.zoom, duration: 800 });
            savedViewRef.current = null;
          }
          setSelected(null);
          setSheetExpanded(false);
        }
      });

      // Bubble markers
      // LANDMARK_AREAS get a pill-shaped marker: score circle + name label below.
      // Rendered as DOM, so always visible above the WebGL canvas.
      const LANDMARK_AREAS = new Set([
        "Koramangala", "Indiranagar", "Whitefield", "Malleshwaram",
        "MG Road", "Jayanagar", "JP Nagar", "HSR Layout",
        "Bellandur", "Sarjapur", "Electronic City", "Hebbal",
        "Marathahalli", "Rajajinagar", "Basavanagudi",
      ]);

      (data.features as LocalityFeature[]).forEach((f) => {
        const { name, overall_score, factors, raw } = f.properties;
        const isLandmark = LANDMARK_AREAS.has(name);

        const el = document.createElement("div");
        el.style.cssText = [
          "display:none", "flex-direction:column",
          "align-items:center", "cursor:pointer",
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          "gap:2px",
        ].join(";");

        // Score circle
        const circle = document.createElement("div");
        circle.style.cssText = [
          "width:34px", "height:34px", "border-radius:50%",
          `background:${scoreColor(recomputeScore(factors, weightsRef.current))}`,
          "border:2.5px solid white",
          "display:flex", "align-items:center", "justify-content:center",
          "font-weight:800", "font-size:11px", "color:white",
          "box-shadow:0 2px 8px rgba(0,0,0,0.25)",
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          "flex-shrink:0",
        ].join(";");
        circle.textContent = String(recomputeScore(factors, weightsRef.current));
        el.appendChild(circle);

        // Name label — only for landmark areas
        if (isLandmark) {
          const label = document.createElement("div");
          label.style.cssText = [
            "font-size:10px", "font-weight:700",
            "color:#111827", "white-space:nowrap",
            "background:rgba(255,255,255,0.92)",
            "padding:1px 5px", "border-radius:4px",
            "line-height:1.4",
            "box-shadow:0 1px 3px rgba(0,0,0,0.15)",
            "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
            "pointer-events:none",
          ].join(";");
          label.textContent = name;
          el.appendChild(label);
        }

        markersRef.current.push({ el, circle, factors, name });

        el.addEventListener("mouseenter", () => {
          circle.style.border     = "2.5px solid rgba(0,0,0,0.35)";
          circle.style.boxShadow  = "0 4px 16px rgba(0,0,0,0.32)";
          el.style.zIndex         = "999";
        });
        el.addEventListener("mouseleave", () => {
          circle.style.border    = "2.5px solid white";
          circle.style.boxShadow = "0 2px 8px rgba(0,0,0,0.25)";
          el.style.zIndex        = "";
        });
        el.addEventListener("click", (e) => {
          e.stopPropagation(); // prevent bubbling to map → avoids wrong polygon highlight
          flyToLocality({ name, overall_score, factors, raw, lat: f.properties.lat, lon: f.properties.lon });
        });

        new maplibregl.Marker({ element: el })
          .setLngLat([f.properties.lon, f.properties.lat])
          .addTo(map);
      });

      updateMarkerVisibility();
      setAllLocalities(mapLocalities);
      localitiesRef.current = mapLocalities;

      // Deep-link: ?locality=NAME
      const paramLocality = new URLSearchParams(window.location.search).get("locality");
      if (paramLocality) {
        const match = mapLocalities.find((l) => l.name === paramLocality);
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
  }, [updateMarkerVisibility]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const searchResults =
    searchQuery.length > 1
      ? allLocalities
          .filter((l) => l.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .slice(0, 8)
      : [];

  // Computed once per render — avoids calling recomputeScore 3–4x in JSX
  const currentScore = selected ? recomputeScore(selected.factors, weights) : null;
  const selectedFull = selected ? allLocalities.find((l) => l.name === selected.name) ?? null : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {showGate && <EmailGate onSubmit={handleGateSubmit} submitting={gateSubmitting} />}

      {!isMobile ? (
        /* ── Desktop layout ── */
        <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
          <div ref={mapRef} style={{ flex: 1, overflow: "hidden" }} />

          {/* Drag handle */}
          <div
            style={{
              width: 5, cursor: "col-resize", flexShrink: 0,
              background: "transparent", position: "relative", zIndex: 10,
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              isDragging.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
              const onMove = (ev: MouseEvent) => {
                if (!isDragging.current) return;
                const newWidth = window.innerWidth - ev.clientX;
                setSidebarWidth(Math.min(600, Math.max(280, newWidth)));
              };
              const onUp = () => {
                isDragging.current = false;
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}
          >
            {/* Visual grip dots */}
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              {[0,1,2].map(i => (
                <div key={i} style={{ width: 3, height: 3, borderRadius: "50%", background: "#d1d5db" }} />
              ))}
            </div>
          </div>

          <div style={{ width: sidebarWidth, display: "flex", flexDirection: "column", borderLeft: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0 }}>
            {/* Header: search + filters */}
            <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, background: "white" }}>
              <div style={{ marginBottom: 10 }}>
                <SearchBox
                  query={searchQuery}
                  onChange={setSearchQuery}
                  results={searchResults}
                  onSelect={flyToLocality}
                  onLocate={locateUser}
                  geoLoading={geoLoading}
                  compact
                />
              </div>
              <FilterChips value={scoreFilter} onChange={setScoreFilter} />
            </div>
            {/* Scrollable body */}
            <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
              {!selected ? (
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Bengaluru Neighborhoods</h2>
                  <p style={{ fontSize: 14, color: "#374151", marginBottom: 16 }}>Click any dot on the map to see details.</p>
                  <Legend />
                  <div style={{ margin: "20px 0", borderTop: "1px solid #e5e7eb" }} />
                  <WeightSliders weights={weights} onChange={setWeights} />
                  <div style={{ margin: "20px 0", borderTop: "1px solid #e5e7eb" }} />
                  <HeatmapPanel
                    active={heatmapActive}
                    onToggle={setHeatmapActive}
                    dest={heatmapDest}
                    onDestChange={setHeatmapDest}
                    mode={heatmapMode}
                    onModeChange={setHeatmapMode}
                    loading={heatmapLoading}
                    commuteData={commuteData}
                    localities={allLocalities}
                  />
                </div>
              ) : (
                <LocalityDetail
                  selected={selected}
                  score={currentScore!}
                  sentimentData={sentimentData}
                  onDismiss={dismiss}
                  onCopy={handleCopy}
                  copied={copied}
                  originLat={selectedFull?.lat ?? 0}
                  originLon={selectedFull?.lon ?? 0}
                  localities={allLocalities}
                  onDestinationChange={handleCommuteDestChange}
                  onListingsLoaded={handleListingsLoaded}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── Mobile layout: full-screen map + single bottom sheet ── */
        <div style={{ position: "relative", height: "100dvh", fontFamily: "sans-serif" }}>
          {/* Map fixed to full viewport — never clipped by overflow:hidden (iOS WebGL fix) */}
          <div
            ref={mapRef}
            style={{ position: "fixed", inset: 0, zIndex: 0, background: "#e8e0d5", overflow: "hidden" }}
          />

          {/* Floating search bar — fixed so it sits above the map regardless of flex layout */}
          <div style={{
            position: "fixed",
            top: "calc(16px + env(safe-area-inset-top, 0px))",
            left: 16,
            right: 16,
            zIndex: 20,
          }}>
            <SearchBox
              query={searchQuery}
              onChange={setSearchQuery}
              results={searchResults}
              onSelect={flyToLocality}
              onLocate={locateUser}
              geoLoading={geoLoading}
            />
          </div>

          {/* Single bottom sheet — content swaps based on whether a locality is selected */}
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            background: "white", borderRadius: "16px 16px 0 0",
            boxShadow: "0 -2px 12px rgba(0,0,0,0.12)",
            maxHeight: sheetExpanded ? (sheetOpen ? "60dvh" : "55dvh") : "52px",
            overflow: "hidden",
            transition: "max-height 0.3s ease",
            color: "#111827",
            zIndex: 10,
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}>
            {/* Drag handle + title — always visible, tap to toggle */}
            <div
              onClick={() => setSheetExpanded((v) => !v)}
              style={{ padding: "12px 20px 8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 4, background: "#d1d5db", borderRadius: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>
                  {sheetOpen ? selected!.name : "Bengaluru Neighborhoods"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {sheetOpen && currentScore !== null && (
                  <span style={{ fontSize: 16, fontWeight: 800, color: scoreColor(currentScore) }}>
                    {currentScore}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "#6b7280" }}>/10</span>
                  </span>
                )}
                {sheetOpen ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); dismiss(); }}
                    style={{
                      width: 28, height: 28, borderRadius: "50%", border: "none",
                      background: "#f3f4f6", cursor: "pointer", display: "flex",
                      alignItems: "center", justifyContent: "center", flexShrink: 0,
                      fontSize: 16, color: "#6b7280", lineHeight: 1,
                    }}
                    aria-label="Close locality panel"
                  >
                    ✕
                  </button>
                ) : (
                  <svg
                    width="18" height="18" viewBox="0 0 18 18" fill="none"
                    style={{ color: "#6b7280", transform: sheetExpanded ? "rotate(180deg)" : "none", transition: "transform 0.25s", flexShrink: 0 }}
                  >
                    <path d="M4.5 11.5L9 6.5L13.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </div>

            {/* Sheet body */}
            <div style={{ padding: "4px 20px 32px", overflowY: "auto", maxHeight: `calc(${sheetOpen ? "60" : "55"}dvh - 52px)` }}>
              {sheetOpen ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <LocalityDetail
                    selected={selected!}
                    score={currentScore!}
                    sentimentData={sentimentData}
                    onDismiss={dismiss}
                    onCopy={handleCopy}
                    copied={copied}
                    originLat={selectedFull?.lat ?? 0}
                    originLon={selectedFull?.lon ?? 0}
                    localities={allLocalities}
                    onDestinationChange={handleCommuteDestChange}
                    onListingsLoaded={handleListingsLoaded}
                  />
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: "#374151", marginBottom: 12 }}>Tap any circle on the map.</p>
                  <FilterChips value={scoreFilter} onChange={setScoreFilter} />
                  <div style={{ margin: "12px 0 10px", borderTop: "1px solid #e5e7eb" }} />
                  <Legend />
                  <div style={{ margin: "14px 0", borderTop: "1px solid #e5e7eb" }} />
                  <WeightSliders weights={weights} onChange={setWeights} />
                  <div style={{ margin: "14px 0", borderTop: "1px solid #e5e7eb" }} />
                  <HeatmapPanel
                    active={heatmapActive}
                    onToggle={setHeatmapActive}
                    dest={heatmapDest}
                    onDestChange={setHeatmapDest}
                    mode={heatmapMode}
                    onModeChange={setHeatmapMode}
                    loading={heatmapLoading}
                    commuteData={commuteData}
                    localities={allLocalities}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
