"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
          border: compact ? "1.5px solid #e5e7eb" : "1.5px solid rgba(0,0,0,0.15)",
          boxShadow: compact ? "none" : "0 2px 12px rgba(0,0,0,0.22)",
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
              border: active ? "1.5px solid transparent" : "1.5px solid #e5e7eb",
              cursor: "pointer",
              boxShadow: active ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
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

// ── Locality detail — shared by desktop sidebar and mobile sheet ──────────────
function LocalityDetail({
  selected,
  score,
  sentimentData,
  onDismiss,
  onCopy,
  copied,
}: {
  selected: Locality;
  score: number;
  sentimentData: Record<string, SentimentEntry>;
  onDismiss: () => void;
  onCopy: () => void;
  copied: boolean;
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
          style={{ fontSize: 11, color: copied ? "#059669" : "#374151", background: "white", border: "1.5px solid #9ca3af", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontWeight: 500 }}
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
  const markersRef        = useRef<{ el: HTMLDivElement; factors: Locality["factors"] }[]>([]);
  const weightsRef        = useRef<Weights>(DEFAULT_WEIGHTS);
  const scoreFilterRef    = useRef<ScoreFilter>("all");
  const isMobileRef       = useRef(false);

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
  const [scoreFilter,   setScoreFilter]   = useState<ScoreFilter>("all");
  const [sentimentData, setSentimentData] = useState<Record<string, SentimentEntry>>({});

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
    history.replaceState(null, "", window.location.pathname);
    setSelected(null);
    setSheetExpanded(false);
  }, []);

  const flyToLocality = useCallback((loc: LocalityFull) => {
    const map = mapInstanceRef.current;
    if (!map) return;
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
      zoom: 13,
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

  const handleGateSubmit = useCallback(async (email: string) => {
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
    markersRef.current.forEach(({ el, factors }) => {
      const score = recomputeScore(factors, weights);
      el.style.background = scoreColor(score);
      el.textContent = String(score);
    });
    updateMarkerVisibility();
  }, [weights, updateMarkerVisibility]);

  // Show/hide markers when filter changes
  useEffect(() => {
    scoreFilterRef.current = scoreFilter;
    updateMarkerVisibility();
  }, [scoreFilter, updateMarkerVisibility]);

  // ── Map initialisation ────────────────────────────────────────────────────
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

        markersRef.current.push({ el: circle, factors });

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
          if (highlightedRef.current && highlightedRef.current !== name) {
            map.setFeatureState({ source: "localities", id: highlightedRef.current }, { hover: false });
          }
          highlightedRef.current = name;
          map.setFeatureState({ source: "localities", id: name }, { hover: true });
          setSelected({ name, overall_score, factors, raw });
          setSheetExpanded(true);
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {showGate && <EmailGate onSubmit={handleGateSubmit} submitting={gateSubmitting} />}

      {!isMobile ? (
        /* ── Desktop layout ── */
        <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
          <div ref={mapRef} style={{ flex: 1, overflow: "hidden" }} />
          <div style={{ width: 360, display: "flex", flexDirection: "column", borderLeft: "1px solid #e5e7eb", background: "#f9fafb" }}>
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
                </div>
              ) : (
                <LocalityDetail
                  selected={selected}
                  score={currentScore!}
                  sentimentData={sentimentData}
                  onDismiss={dismiss}
                  onCopy={handleCopy}
                  copied={copied}
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

          {/* Floating search bar — offset accounts for iOS notch/safe-area */}
          <div style={{
            position: "absolute",
            top: "calc(16px + env(safe-area-inset-top, 0px))",
            left: 16,
            right: 16,
            zIndex: 10,
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
                <svg
                  width="18" height="18" viewBox="0 0 18 18" fill="none"
                  style={{ color: "#6b7280", transform: sheetExpanded ? "rotate(180deg)" : "none", transition: "transform 0.25s", flexShrink: 0 }}
                >
                  <path d="M4.5 11.5L9 6.5L13.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
