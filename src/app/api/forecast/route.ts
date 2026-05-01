import { NextResponse } from "next/server";
import { estimateForecast } from "@/lib/forecast";
import { getHkoWeatherSnapshot } from "@/lib/hko";
import { generatePoeExplanation } from "@/lib/poe";
import { saveForecastRun } from "@/lib/db";
import { getMarketState } from "@/lib/state";
import { forecastApiRequestSchema } from "@/lib/validation";
import type {
  ForecastResult,
  MarketState,
  OutcomeRange,
  RainIntensity
} from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HistorySaveResult = {
  saved: boolean;
  reason: string | null;
};

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

function toRainIntensity(
  value: unknown,
  fallback: RainIntensity
): RainIntensity {
  if (typeof value === "string" && value.trim().length > 0) {
    return value as RainIntensity;
  }

  return fallback;
}

function normalizeOutcome(value: unknown): OutcomeRange | null {
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

    marketPriceSource:
      typeof value.marketPriceSource === "string"
        ? value.marketPriceSource
        : null,

    yesPrice: toNullableNumber(value.yesPrice, null),
    noPrice: toNullableNumber(value.noPrice, null),

    tokenId:
      typeof value.tokenId === "string" ? value.tokenId : null,

    clobTokenId:
      typeof value.clobTokenId === "string" ? value.clobTokenId : null,

    yesTokenId:
      typeof value.yesTokenId === "string" ? value.yesTokenId : null,

    noTokenId:
      typeof value.noTokenId === "string" ? value.noTokenId : null,

    clobMidpoint: toNullableNumber(value.clobMidpoint, null),
    yesAsk: toNullableNumber(value.yesAsk, null),
    noAsk: toNullableNumber(value.noAsk, null),
    yesBid: toNullableNumber(value.yesBid, null),
    clobSpread: toNullableNumber(value.clobSpread, null)
  };
}

function normalizeOutcomes(
  value: unknown,
  fallback: OutcomeRange[]
): OutcomeRange[] {
  const source = Array.isArray(value) ? value : fallback;

  const outcomes = source
    .map((item) => normalizeOutcome(item))
    .filter((item): item is OutcomeRange => item !== null);

  return outcomes.length > 0 ? outcomes : fallback;
}

/**
 * Zod schema is intentionally flexible / passthrough,
 * so parsed.state may have optional fields.
 *
 * estimateForecast() requires a complete MarketState.
 * This function fills missing fields from persisted state/default state.
 */
function normalizeMarketState(
  value: unknown,
  fallback: MarketState
): MarketState {
  const record = isRecord(value) ? value : {};

  const outcomes = normalizeOutcomes(record.outcomes, fallback.outcomes);

  const normalized: MarketState = {
    ...fallback,
    ...record,

    useAI:
      typeof record.useAI === "boolean" ? record.useAI : fallback.useAI,

    outcomes,

    manualMaxOverrideC: toNullableNumber(
      record.manualMaxOverrideC,
      fallback.manualMaxOverrideC ?? null
    ),

    rainEtaMinutes: toNullableNonNegativeInt(
      record.rainEtaMinutes,
      fallback.rainEtaMinutes ?? null
    ),

    cloudCoverPct: toCloudCover(
      record.cloudCoverPct,
      fallback.cloudCoverPct
    ),

    rainProbability60m: toProbability(
      record.rainProbability60m,
      fallback.rainProbability60m
    ),

    rainProbability120m: toProbability(
      record.rainProbability120m,
      fallback.rainProbability120m
    ),

    expectedRainIntensity: toRainIntensity(
      record.expectedRainIntensity,
      fallback.expectedRainIntensity
    )
  };

  return normalized;
}

function getHktDateCompact() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";

  return `${year}${month}${day}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = forecastApiRequestSchema.parse(body);

    const persistedState = await getMarketState();

    const state = normalizeMarketState(
      parsed.state,
      persistedState.state
    );

    const snapshot = await getHkoWeatherSnapshot();

    const forecastWithoutAI = estimateForecast(snapshot, state);

    let aiExplanation: string | null = null;

    const shouldUseAI = parsed.forceAI ?? state.useAI;

    if (shouldUseAI) {
      aiExplanation = await generatePoeExplanation({
        snapshot,
        state,
        forecast: forecastWithoutAI
      });
    }

    const result: ForecastResult = {
      ...forecastWithoutAI,
      aiExplanation
    };

    let historySave: HistorySaveResult = {
      saved: false,
      reason: "saveHistory was false."
    };

    if (parsed.saveHistory) {
      const hktDate =
        typeof result.hktDate === "string" && result.hktDate.length > 0
          ? result.hktDate
          : getHktDateCompact();

      historySave = await saveForecastRun({
        hktDate,
        state,
        weather: snapshot,
        result
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        result,
        weather: snapshot,
        historySave
      }
    });
  } catch (error) {
    console.error("Forecast API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate forecast."
      },
      { status: 500 }
    );
  }
}
