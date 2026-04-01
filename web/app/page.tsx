"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Locality = {
  name: string;
  overall_score: number;
  factors: { air_quality: number; amenities: number; metro_access: number; restaurants: number };
  raw: { aqi: number; temperature_c: number; hospitals: number; schools: number; supermarkets: number; restaurants: number; metro_stations: number };
};

function scoreColor(score: number) {
  if (score >= 6) return "#4ade80";  // soft green
  if (score >= 4) return "#fbbf24";  // soft amber
  return "#f87171";                   // soft red
}

function FactorBars({ factors }: { factors: Locality["factors"] }) {
  return (
    <>
      <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#374151" }}>Factor scores</h3>
      {Object.entries(factors).map(([k, v]) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
            <span style={{ color: "#6b7280", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span>
            <span style={{ fontWeight: 600 }}>{v}/10</span>
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
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 8px", color: "#374151" }}>Raw data</h3>
      {Object.entries(raw).map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f3f4f6" }}>
          <span style={{ color: "#6b7280", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span>
          <span style={{ fontWeight: 500 }}>{v ?? "—"}</span>
        </div>
      ))}
    </>
  );
}

function Legend() {
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} /> Score 6–10 (Great)
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#fbbf24", display: "inline-block" }} /> Score 4–6 (Good)
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#f87171", display: "inline-block" }} /> Score 0–4 (Low)
      </div>
    </div>
  );
}

export default function Home() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const highlightedRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<Locality | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Clear polygon highlight and deselect
  const dismiss = () => {
    if (mapInstanceRef.current && highlightedRef.current) {
      mapInstanceRef.current.setFeatureState(
        { source: "localities", id: highlightedRef.current },
        { hover: false }
      );
      highlightedRef.current = null;
    }
    setSelected(null);
  };

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [77.6, 12.97],
      zoom: 11,
    });
    mapInstanceRef.current = map;

    map.on("load", async () => {
      const [res, smallRes] = await Promise.all([
        fetch("/localities_scored.geojson"),
        fetch("/localities_small.geojson"),
      ]);
      const data = await res.json();
      const smallData = await smallRes.json();

      // Small 500m circles — always faintly visible as default
      map.addSource("localities-small", { type: "geojson", data: smallData });
      map.addLayer({
        id: "localities-small-fill",
        type: "fill",
        source: "localities-small",
        paint: {
          "fill-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 6, "#4ade80"],
          "fill-opacity": 0.08,
        },
      });
      map.addLayer({
        id: "localities-small-outline",
        type: "line",
        source: "localities-small",
        paint: {
          "line-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 6, "#4ade80"],
          "line-width": 0.8,
        },
      });

      map.addSource("localities", { type: "geojson", data, promoteId: "name" });

      // Fill — only visible on hover/click (amenity-based radius)
      map.addLayer({
        id: "localities-fill",
        type: "fill",
        source: "localities",
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
        paint: {
          "line-color": ["step", ["get", "overall_score"], "#f87171", 4, "#fbbf24", 6, "#4ade80"],
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0],
        },
      });

      map.addLayer({
        id: "localities-labels",
        type: "symbol",
        source: "localities",
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

      data.features.forEach((f: any) => {
        const { name, overall_score, factors, raw } = f.properties;
        const color = scoreColor(overall_score);

        const el = document.createElement("div");
        el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${color};opacity:0.55;border:1.5px solid rgba(255,255,255,0.8);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px;color:white;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.15)`;
        el.innerText = String(overall_score);

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
        };

        new maplibregl.Marker({ element: el })
          .setLngLat([f.properties.lon, f.properties.lat])
          .addTo(map);
      });
    });

    return () => map.remove();
  }, []);

  /* ── Desktop layout ── */
  if (!isMobile) {
    return (
      <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
        <div ref={mapRef} style={{ flex: 1 }} />
        <div style={{ width: 300, padding: 20, overflowY: "auto", borderLeft: "1px solid #e5e7eb", background: "#f9fafb" }}>
          {!selected ? (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Bengaluru Neighborhoods</h2>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>Click any dot on the map to see details.</p>
              <Legend />
            </div>
          ) : (
            <div>
              <button onClick={dismiss} style={{ fontSize: 12, color: "#6b7280", marginBottom: 12, background: "none", border: "none", cursor: "pointer" }}>← Back</button>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{selected.name}</h2>
              <div style={{ fontSize: 32, fontWeight: 800, color: scoreColor(selected.overall_score), marginBottom: 16 }}>
                {selected.overall_score}<span style={{ fontSize: 14, color: "#9ca3af" }}>/10</span>
              </div>
              <FactorBars factors={selected.factors} />
              <RawData raw={selected.raw} />
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Mobile layout: full-screen map + bottom sheet ── */
  const sheetOpen = selected !== null;
  return (
    <div style={{ position: "relative", height: "100dvh", fontFamily: "sans-serif", overflow: "hidden" }}>
      {/* Map fills the whole screen */}
      <div ref={mapRef} style={{ position: "absolute", inset: 0 }} />

      {/* Collapsed hint bar when nothing selected */}
      {!sheetOpen && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "white", borderRadius: "16px 16px 0 0",
          boxShadow: "0 -2px 12px rgba(0,0,0,0.12)",
          padding: "12px 20px 20px",
          color: "#111827",
        }}>
          <div style={{ width: 36, height: 4, background: "#d1d5db", borderRadius: 2, margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Bengaluru Neighborhoods</h2>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>Tap any circle on the map.</p>
          <Legend />
        </div>
      )}

      {/* Bottom sheet when a locality is selected */}
      {sheetOpen && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          background: "white", borderRadius: "16px 16px 0 0",
          boxShadow: "0 -2px 12px rgba(0,0,0,0.15)",
          maxHeight: "60dvh", overflowY: "auto",
          padding: "12px 20px 32px",
          transition: "transform 0.3s ease",
          color: "#111827",
        }}>
          <div style={{ width: 36, height: 4, background: "#d1d5db", borderRadius: 2, margin: "0 auto 12px" }} />
          <button onClick={dismiss} style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, background: "none", border: "none", cursor: "pointer", padding: 0 }}>← Back</button>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>{selected!.name}</h2>
            <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor(selected!.overall_score) }}>
              {selected!.overall_score}<span style={{ fontSize: 12, color: "#9ca3af" }}>/10</span>
            </div>
          </div>
          <FactorBars factors={selected!.factors} />
          <RawData raw={selected!.raw} />
        </div>
      )}
    </div>
  );
}

