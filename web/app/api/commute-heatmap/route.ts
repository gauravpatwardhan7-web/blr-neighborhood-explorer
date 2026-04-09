import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// Rate limit: 10 requests per IP per minute (each request fans out to ~100 OSRM calls server-side)
const RL_MAX = 10;
const RL_WINDOW_MS = 60_000;

// Loose bounding box around greater Bengaluru region
const BLR_LAT_MIN = 12.7, BLR_LAT_MAX = 13.2;
const BLR_LON_MIN = 77.4, BLR_LON_MAX = 77.9;

function inBounds(lat: number, lon: number): boolean {
  return lat >= BLR_LAT_MIN && lat <= BLR_LAT_MAX &&
         lon >= BLR_LON_MIN && lon <= BLR_LON_MAX;
}

type LocalityInput = { name: string; lat: number; lon: number };

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`commute-heatmap:${ip}`, RL_MAX, RL_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { destLat, destLon, mode, localities } = body as {
    destLat?: unknown;
    destLon?: unknown;
    mode?: unknown;
    localities?: unknown;
  };

  if (
    typeof destLat !== "number" || typeof destLon !== "number" ||
    !Number.isFinite(destLat) || !Number.isFinite(destLon) ||
    !inBounds(destLat, destLon) ||
    (mode !== "drive" && mode !== "walk") ||
    !Array.isArray(localities) || localities.length === 0 || localities.length > 120
  ) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Validate each locality entry
  const validLocalities: LocalityInput[] = [];
  for (const loc of localities as unknown[]) {
    if (
      typeof loc !== "object" || loc === null ||
      typeof (loc as Record<string, unknown>).name !== "string" ||
      typeof (loc as Record<string, unknown>).lat !== "number" ||
      typeof (loc as Record<string, unknown>).lon !== "number" ||
      !Number.isFinite((loc as Record<string, unknown>).lat as number) ||
      !Number.isFinite((loc as Record<string, unknown>).lon as number)
    ) {
      return NextResponse.json({ error: "Invalid locality entry" }, { status: 400 });
    }
    const l = loc as LocalityInput;
    validLocalities.push({ name: l.name, lat: l.lat, lon: l.lon });
  }

  // Build OSRM table request:
  // All locality centroids as sources, destination as the last coordinate.
  // Single HTTP request returns an N×1 duration+distance matrix.
  const n = validLocalities.length;
  const coordStr = [
    ...validLocalities.map((l) => `${l.lon},${l.lat}`),
    `${destLon},${destLat}`,
  ].join(";");
  const sourcesStr = Array.from({ length: n }, (_, i) => i).join(";");
  const destIdx = n; // destination is the last coordinate (index n)
  const url =
    `https://router.project-osrm.org/table/v1/driving/${coordStr}` +
    `?sources=${sourcesStr}&destinations=${destIdx}&annotations=duration,distance`;

  try {
    const osrmRes = await fetch(url, {
      headers: { "User-Agent": "blr-neighbourhood-explorer/1.0" },
      signal: AbortSignal.timeout(15_000), // longer timeout for bulk request
    });

    if (!osrmRes.ok) {
      return NextResponse.json({ error: "Routing service unavailable" }, { status: 502 });
    }

    const data = await osrmRes.json() as {
      code: string;
      durations?: (number | null)[][];
      distances?: (number | null)[][];
    };

    if (data.code !== "Ok") {
      return NextResponse.json({ error: "Routing service error" }, { status: 502 });
    }

    const durations = data.durations ?? [];
    const distances = data.distances ?? [];

    const results = validLocalities.map((loc, i) => {
      const durSec = durations[i]?.[0];
      const distM  = distances[i]?.[0];

      let durationMin: number;
      if (durSec == null || durSec < 0) {
        durationMin = 99; // unreachable / no route
      } else if (mode === "walk") {
        // Walking: use road distance at 5 km/h with the same safety buffer as route-time.
        // Fall back to estimating distance from OSRM free-flow duration if distances unavailable.
        const distKm = distM != null && distM >= 0
          ? distM / 1000
          : (durSec / 3600) * 50; // rough fallback: assume 50 km/h free-flow average
        durationMin = Math.round((distKm / 5.0) * 60 * 1.25);
      } else {
        // Driving: OSRM free-flow × Bengaluru congestion factor × safety buffer
        // (same multipliers as /api/route-time)
        durationMin = Math.round((durSec * 2.2 / 60) * 1.25);
      }

      return { name: loc.name, durationMin };
    });

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Routing service unavailable" }, { status: 502 });
  }
}
