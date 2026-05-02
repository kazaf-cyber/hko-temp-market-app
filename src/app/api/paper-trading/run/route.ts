import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { runAutoPaperTrading } from "@/lib/paperTradingDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return undefined;
}

export async function POST(request: Request) {
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
    const body: unknown = await request.json().catch(() => ({}));
    const record = isRecord(body) ? body : {};

    const result = await runAutoPaperTrading({
      snapshotKey: stringOrNull(record.snapshotKey),
      dryRun: booleanOrDefault(record.dryRun, false),
      force: booleanOrDefault(record.force, false),
      limit: numberOrUndefined(record.limit),
      configOverrides: {
        bankrollUsd: numberOrUndefined(record.bankrollUsd),
        minStakeFraction: numberOrUndefined(record.minStakeFraction),
        maxStakeFraction: numberOrUndefined(record.maxStakeFraction),
        minNotionalUsd: numberOrUndefined(record.minNotionalUsd),
        maxNotionalUsdPerTrade: numberOrUndefined(
          record.maxNotionalUsdPerTrade
        ),
        maxDailyNotionalUsd: numberOrUndefined(record.maxDailyNotionalUsd),
        maxOpenTrades: numberOrUndefined(record.maxOpenTrades),
        minResolutionConfidence: numberOrUndefined(
          record.minResolutionConfidence
        ),
        minBestEdge: numberOrUndefined(record.minBestEdge),
        maxPriceAgeSeconds: numberOrUndefined(record.maxPriceAgeSeconds),
        allowedPriceQualities: parseStringArray(record.allowedPriceQualities),
        allowedStrengths: parseStringArray(record.allowedStrengths)
      }
    });

    return NextResponse.json(
      {
        ok: result.ok,
        data: result,
        error: result.ok ? null : result.reason
      },
      {
        status: result.ok ? 200 : result.databaseEnabled ? 400 : 503
      }
    );
  } catch (error) {
    console.error("Paper trading run API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to run paper trading."
      },
      { status: 500 }
    );
  }
}
