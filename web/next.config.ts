import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent clickjacking
          { key: "X-Frame-Options", value: "DENY" },
          // Stop MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Force HTTPS
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Restrict referrer info leakage
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Permissions policy — disable unused browser features
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          // Content Security Policy
          // Allows the map tile CDN (cartocdn.com) and MapLibre GL assets
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",   // Next.js needs unsafe-inline for hydration
              "style-src 'self' 'unsafe-inline'",    // MapLibre injects inline styles
              "img-src 'self' data: blob: https://*.cartocdn.com https://*.openstreetmap.org",
              "connect-src 'self' https://*.cartocdn.com https://*.basemaps.cartocdn.com",
              "font-src 'self' data:",
              "worker-src blob:",                    // MapLibre web worker
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
