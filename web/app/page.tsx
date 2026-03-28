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
  if (score >= 6) return "#22c55e";
  if (score >= 4) return "#f59e0b";
  return "#ef4444";
}

export default function Home() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Locality | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [77.6, 12.97],
      zoom: 11,
    });

    map.on("load", async () => {
      const res = await fetch("/localities_scored.geojson");
      const data = await res.json();

      data.features.forEach((f: any) => {
        const { name, overall_score, factors, raw } = f.properties;
        const [lng, lat] = f.geometry.coordinates;
        const color = scoreColor(overall_score);

        const el = document.createElement("div");
        el.style.cssText = `width:44px;height:44px;border-radius:50%;background:${color};border:3px solid white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:white;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3)`;
        el.innerText = String(overall_score);
        el.onclick = () => setSelected({ name, overall_score, factors, raw });

        new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      });
    });

    return () => map.remove();
  }, []);

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
      <div ref={mapRef} style={{ flex: 1 }} />
      <div style={{ width: 300, padding: 20, overflowY: "auto", borderLeft: "1px solid #e5e7eb", background: "#f9fafb" }}>
        {!selected ? (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Bengaluru Neighborhoods</h2>
            <p style={{ fontSize: 13, color: "#6b7280" }}>Click any dot on the map to see details.</p>
            <div style={{ marginTop: 16, fontSize: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span style={{ width: 12, height: 12, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} /> Score 6–10 (Great)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span style={{ width: 12, height: 12, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} /> Score 4–6 (Good)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} /> Score 0–4 (Low)</div>
            </div>
          </div>
        ) : (
          <div>
            <button onClick={() => setSelected(null)} style={{ fontSize: 12, color: "#6b7280", marginBottom: 12, background: "none", border: "none", cursor: "pointer" }}>← Back</button>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{selected.name}</h2>
            <div style={{ fontSize: 32, fontWeight: 800, color: scoreColor(selected.overall_score), marginBottom: 16 }}>{selected.overall_score}<span style={{ fontSize: 14, color: "#9ca3af" }}>/10</span></div>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#374151" }}>Factor scores</h3>
            {Object.entries(selected.factors).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: "#6b7280", textTransform: "capitalize" }}>{k.replace("_", " ")}</span>
                  <span style={{ fontWeight: 600 }}>{v}/10</span>
                </div>
                <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3 }}>
                  <div style={{ height: 6, width: `${v * 10}%`, background: scoreColor(v), borderRadius: 3 }} />
                </div>
              </div>
            ))}
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 8px", color: "#374151" }}>Raw data</h3>
            {Object.entries(selected.raw).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f3f4f6" }}>
                <span style={{ color: "#6b7280", textTransform: "capitalize" }}>{k.replace("_", " ")}</span>
                <span style={{ fontWeight: 500 }}>{v ?? "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
