import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { createClient } from "@supabase/supabase-js";

const RL_MAX = 5;
const RL_WINDOW_MS = 3600000; // 1 hour

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

type ContentType = "neighborhood" | "tip" | "listing";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`flags:${ip}`, RL_MAX, RL_WINDOW_MS);

  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many reports. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const {
    contentType,
    locality,
    contentId,
    reason,
  } = body as {
    contentType?: unknown;
    locality?: unknown;
    contentId?: unknown;
    reason?: unknown;
  };

  // Validation
  if (
    typeof contentType !== "string" ||
    !["neighborhood", "tip", "listing"].includes(contentType) ||
    typeof locality !== "string" ||
    !locality.trim() ||
    typeof reason !== "string" ||
    reason.trim().length < 10 ||
    reason.trim().length > 500
  ) {
    return NextResponse.json(
      { error: "Invalid input. Reason must be 10-500 characters." },
      { status: 400 }
    );
  }

  if (contentId !== undefined && typeof contentId !== "string") {
    return NextResponse.json({ error: "Invalid content ID" }, { status: 400 });
  }

  try {
    const { error } = await supabase.from("flags").insert({
      content_type: contentType as ContentType,
      locality: locality.trim(),
      content_id: contentId || null,
      reason: reason.trim(),
    });

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json(
        { error: "Failed to submit report. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Failed to submit report. Please try again." },
      { status: 500 }
    );
  }
}
