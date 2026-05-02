import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { isDatabaseEnabled } from "@/lib/db";
import {
  getPaperTrades,
  getPaperTradingConfig,
  getPaperTradingRiskState,
  getPaperTradingSummary
} from "@/lib/paperTradingDb";

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

function stringOrNull(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function GET(request: Request) {
  const auth = checkAdminSecret(request);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.message
      },
      { status: auth.status }
    );
  }

  try {
    const url = new URL(request.url);

    const limit = parseLimit(url.searchParams.get("limit"), 200);
    const status = stringOrNull(url.searchParams.get("status"));
    const snapshotKey = stringOrNull(url.searchParams.get("snapshotKey"));

    const config = getPaperTradingConfig();

    const [trades, summary, risk] = await Promise.all([
      getPaperTrades({
        limit,
        status,
        snapshotKey
      }),
      getPaperTradingSummary(config),
      getPaperTradingRiskState(config)
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        databaseEnabled: isDatabaseEnabled(),
        count: trades.length,
        config,
        summary,
        risk,
        trades
      }
    });
  } catch (error) {
    console.error("Paper trading trades API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load paper trades."
      },
      { status: 500 }
    );
  }
}
