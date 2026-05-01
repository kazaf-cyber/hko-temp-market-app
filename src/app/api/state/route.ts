import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { getMarketState, saveMarketState } from "@/lib/state";
import { marketStateSchema } from "@/lib/validation";
import type { MarketState } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarketOutcome = MarketState["outcomes"][number];
type RainIntensityValue = MarketState["expectedRainIntensity"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function toNullableNumber(
  value: unknown,
  fallback: number | null
): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function toNullableNonNegativeInt(
  value: unknown,
  fallback: number | null
): number | null {
  const parsed = toNullableNumber(value, fallback);

  if (parsed === null) {
    return null;
  }

  return Math.max(0, Math.round(parsed));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toProbability(value: unknown, fallback: number): number {
  return clamp(toNumber(value, fallback), 0, 1);
}

function toCloudCover(value: unknown, fallback: number): number {
  return clamp(toNumber(value, fallback), 0, 100);
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toRainIntensity(
  value: unknown,
  fallback: RainIntensityValue
): RainIntensityValue {
  if (typeof value === "string" && value.trim().length > 0) {
    return value as RainIntensityValue;
  }

  return fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function normalizeOutcome(value: unknown): MarketOutcome | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = value.name;

  if (typeof name !== "string" || name.trim().length === 0) {
    return null;
  }

  const lower = toNullableNumber(value.lower, null);
  const upper = toNullableNumber(value.upper, null);

  return {
    ...value,

    name,
    lower,
    upper,

    marketPrice: toNullableNumber(value.marketPrice, null),
    price: toNullableNumber(value.price, null),

    marketPriceSource: stringOrNull(value.marketPriceSource),

    yesPrice: toNullableNumber(value.yesPrice, null),
    noPrice: toNullableNumber(value.noPrice, null),

    tokenId: stringOrNull(value.tokenId),
    clobTokenId: stringOrNull(value.clobTokenId),

    yesTokenId: stringOrNull(value.yesTokenId),
    noTokenId: stringOrNull(value.noTokenId),

    clobMidpoint: toNullableNumber(value.clobMidpoint, null),
    yesAsk: toNullableNumber(value.yesAsk, null),
    noAsk: toNullableNumber(value.noAsk, null),
    yesBid: toNullableNumber(value.yesBid, null),
    clobSpread: toNullableNumber(value.clobSpread, null)
  } as MarketOutcome;
}

function normalizeOutcomes(
  value: unknown,
  fallback: MarketOutcome[]
): MarketOutcome[] {
  const source = Array.isArray(value) ? value : fallback;

  const outcomes = source
    .map((item) => normalizeOutcome(item))
    .filter((item): item is MarketOutcome => item !== null);

  return outcomes.length > 0 ? outcomes : fallback;
}

/**
 * The zod schema is flexible / passthrough, so parsed state may contain
 * fields like manualMaxOverrideC?: number | null | undefined.
 *
 * saveMarketState() requires a complete MarketState.
 * This function fills missing fields from the existing persisted state.
 */
function normalizeMarketState(
  value: unknown,
  fallback: MarketState
): MarketState {
  const record = isRecord(value) ? value : {};

  const fallbackUseAI =
    typeof fallback.useAI === "boolean" ? fallback.useAI : true;

  const fallbackOutcomes = Array.isArray(fallback.outcomes)
    ? fallback.outcomes
    : [];

  const fallbackManualMax =
    typeof fallback.manualMaxOverrideC === "number" ||
    fallback.manualMaxOverrideC === null
      ? fallback.manualMaxOverrideC
      : null;

  const fallbackRainEta =
    typeof fallback.rainEtaMinutes === "number" ||
    fallback.rainEtaMinutes === null
      ? fallback.rainEtaMinutes
      : null;

  const fallbackCloudCover =
    typeof fallback.cloudCoverPct === "number" ? fallback.cloudCoverPct : 85;

  const fallbackRain60 =
    typeof fallback.rainProbability60m === "number"
      ? fallback.rainProbability60m
      : 0.65;

  const fallbackRain120 =
    typeof fallback.rainProbability120m === "number"
      ? fallback.rainProbability120m
      : 0.75;

  const fallbackIntensity =
    typeof fallback.expectedRainIntensity === "string"
      ? fallback.expectedRainIntensity
      : ("moderate" as RainIntensityValue);

  const normalized: MarketState = {
    ...fallback,
    ...record,

    useAI: toBoolean(record.useAI, fallbackUseAI),

    outcomes: normalizeOutcomes(record.outcomes, fallbackOutcomes),

    manualMaxOverrideC: toNullableNumber(
      record.manualMaxOverrideC,
      fallbackManualMax
    ),

    rainEtaMinutes: toNullableNonNegativeInt(
      record.rainEtaMinutes,
      fallbackRainEta
    ),

    cloudCoverPct: toCloudCover(record.cloudCoverPct, fallbackCloudCover),

    rainProbability60m: toProbability(
      record.rainProbability60m,
      fallbackRain60
    ),

    rainProbability120m: toProbability(
      record.rainProbability120m,
      fallbackRain120
    ),

    expectedRainIntensity: toRainIntensity(
      record.expectedRainIntensity,
      fallbackIntensity
    )
  };

  return normalized;
}

export async function GET() {
  try {
    const state = await getMarketState();

    return NextResponse.json({
      ok: true,
      data: state
    });
  } catch (error) {
    console.error("State GET error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load market state."
      },
      { status: 500 }
    );
  }
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
    const body = await request.json();

    /**
     * Validate first, then normalize into complete MarketState.
     */
    const parsed = marketStateSchema.parse(body);

    const persistedState = await getMarketState();

    const normalized = normalizeMarketState(
      parsed,
      persistedState.state
    );

    const saved = await saveMarketState(normalized);

    return NextResponse.json({
      ok: true,
      data: saved
    });
  } catch (error) {
    console.error("State POST error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save market state."
      },
      { status: 500 }
    );
  }
}
