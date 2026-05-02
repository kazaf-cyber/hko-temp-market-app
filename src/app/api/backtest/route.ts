import { NextResponse } from "next/server";
import { getSignalSnapshots, isDatabaseEnabled } from "@/lib/db";
import { buildBacktestReport } from "@/lib/trading/backtest";

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

  return Math.max(1, Math.min(Math.round(parsed), 5000));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"), 1000);

    const snapshots = await getSignalSnapshots(limit);
    const report = buildBacktestReport(snapshots);

    return NextResponse.json({
      ok: true,
      data: {
        databaseEnabled: isDatabaseEnabled(),
        rowsAnalyzed: snapshots.length,
        report
      }
    });
  } catch (error) {
    console.error("Backtest API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to build backtest."
      },
      { status: 500 }
    );
  }
}
