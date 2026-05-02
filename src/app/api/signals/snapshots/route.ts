import { NextResponse } from "next/server";
import { getSignalSnapshots, isDatabaseEnabled } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseLimit(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.round(parsed), 1000));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"), 200);

    const snapshots = await getSignalSnapshots(limit);

    return NextResponse.json({
      ok: true,
      data: {
        databaseEnabled: isDatabaseEnabled(),
        count: snapshots.length,
        snapshots
      }
    });
  } catch (error) {
    console.error("Signal snapshots API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load signal snapshots."
      },
      { status: 500 }
    );
  }
}
