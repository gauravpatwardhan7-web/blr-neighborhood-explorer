import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Bengaluru Neighbourhood Explorer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "linear-gradient(135deg, #0f2942 0%, #1e3a5f 50%, #0d1f33 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Subtle grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Vidhana Soudha silhouette */}
        <svg
          width="320"
          height="200"
          viewBox="0 0 320 200"
          style={{ marginBottom: "32px" }}
        >
          {/* Left wing */}
          <rect x="10" y="120" width="70" height="80" fill="#f59e0b" />
          {/* Right wing */}
          <rect x="240" y="120" width="70" height="80" fill="#f59e0b" />
          {/* Central block */}
          <rect x="70" y="80" width="180" height="120" fill="#f59e0b" />
          {/* Main dome */}
          <path d="M72 80 Q160 10 248 80Z" fill="#f59e0b" />
          {/* Left mini-dome */}
          <path d="M10 120 Q45 80 80 120Z" fill="#fbbf24" />
          {/* Right mini-dome */}
          <path d="M240 120 Q275 80 310 120Z" fill="#fbbf24" />
          {/* Flagstaff */}
          <rect x="157" y="8" width="6" height="30" fill="#fcd34d" />
          <circle cx="160" cy="8" r="7" fill="#fcd34d" />
          {/* Columns */}
          {[90, 112, 134, 156, 178, 200, 222].map((x, i) => (
            <rect key={i} x={x} y="130" width="5" height="70" fill="#0f2942" opacity="0.35" />
          ))}
          {/* Ground line */}
          <rect x="0" y="198" width="320" height="2" fill="#fcd34d" />
        </svg>

        {/* Title */}
        <div
          style={{
            fontSize: "64px",
            fontWeight: "800",
            color: "#ffffff",
            letterSpacing: "-1px",
            textAlign: "center",
            lineHeight: 1.1,
            marginBottom: "16px",
          }}
        >
          Bengaluru
          <br />
          <span style={{ color: "#f59e0b" }}>Neighbourhood Explorer</span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: "26px",
            color: "#94a3b8",
            textAlign: "center",
            maxWidth: "800px",
          }}
        >
          Air quality · Amenities · Metro access · Liveability scores
        </div>

        {/* Domain badge */}
        <div
          style={{
            position: "absolute",
            bottom: "36px",
            right: "48px",
            fontSize: "22px",
            color: "#fcd34d",
            opacity: 0.8,
          }}
        >
          blrexplorer.littlemadcow.xyz
        </div>
      </div>
    ),
    { ...size }
  );
}
