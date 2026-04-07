import { NextRequest, NextResponse } from "next/server";

const ALLOWED_PROFILES = new Set(["driving", "foot"]);

// Loose bounding box around greater Bengaluru region
const BLR_LAT_MIN = 12.7, BLR_LAT_MAX = 13.2;
const BLR_LON_MIN = 77.4, BLR_LON_MAX = 77.9;

function inBounds(lat: number, lon: number): boolean {
  return lat >= BLR_LAT_MIN && lat <= BLR_LAT_MAX &&
         lon >= BLR_LON_MIN && lon <= BLR_LON_MAX;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { originLat, originLon, destLat, destLon, profile } = body as {
    originLat?: unknown;
    originLon?: unknown;
    destLat?: unknown;
    destLon?: unknown;
    profile?: unknown;
  };

  if (
    typeof originLat !== "number" || typeof originLon !== "number" ||
    typeof destLat   !== "number" || typeof destLon   !== "number" ||
    !Number.isFinite(originLat)  || !Number.isFinite(originLon)  ||
    !Number.isFinite(destLat)    || !Number.isFinite(destLon)    ||
    !inBounds(originLat, originLon) || !inBounds(destLat, destLon) ||
    typeof profile !== "string"  || !ALLOWED_PROFILES.has(profile)
  ) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // The public OSRM demo server only reliably supports the "driving" profile.
  // We always fetch driving road distance, then compute walking time manually.
  const url =
    `https://router.project-osrm.org/route/v1/driving` +
    `/${originLon},${originLat};${destLon},${destLat}?overview=false`;

  try {
    const osrmRes = await fetch(url, {
      headers: { "User-Agent": "blr-neighborhood-explorer/1.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!osrmRes.ok) {
      return NextResponse.json({ error: "Routing service unavailable" }, { status: 502 });
    }

    const data = await osrmRes.json() as {
      code: string;
      routes?: { duration: number; distance: number }[];
    };

    if (data.code !== "Ok" || !data.routes?.length) {
      return NextResponse.json({ error: "No route found" }, { status: 404 });
    }

    const route = data.routes[0];
    const distanceKm = Math.round(route.distance / 100) / 10;

    let durationMin: number;
    if (profile === "foot") {
      // Walking at ~5 km/h along road distance
      durationMin = Math.round((distanceKm / 5.0) * 60);
    } else {
      // Driving: OSRM free-flow × 2.2 for Bengaluru congestion
      durationMin = Math.round((route.duration * 2.2) / 60);
    }

    // +25% safety buffer for all modes (traffic uncertainty, signal delays, etc.)
    durationMin = Math.round(durationMin * 1.25);

    return NextResponse.json({ durationMin, distanceKm });
  } catch {
    return NextResponse.json({ error: "Routing service unavailable" }, { status: 502 });
  }
}
