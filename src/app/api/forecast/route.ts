import { NextResponse } from "next/server";
import { getForecast, type GetForecastOptions } from "@/lib/forecast";
import { getPoeForecastCommentary } from "@/lib/poe";
import { initDatabase, saveForecastRun } from "@/lib/db";
import type { ForecastResult, HkoWeatherSnapshot, MarketState } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Forecast = Awaited<ReturnType<typeof getForecast>>;
type AiCommentary =
  | Awaited<ReturnType<typeof getPoeForecastCommentary>>
  | null;

type HistorySaveResult = {
  saved: boolean;
  reason: string | null;
};

type RunForecastOptions = GetForecastOptions & {
  ai?: boolean;
  saveHistory?: boolean;
  state?: MarketState | null;
};

let databaseInitPromise: Promise<void> | null = null;

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return fallback;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parseMarketState(value: unknown): MarketState | null {
  if (!isRecord(value)) {
    return null;
  }

  return value as MarketState;
}

function getStringField(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = asString(value);

    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const cleaned = value.trim().replace(/%/g, "");

    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = toFiniteNumber(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function getAt(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);

      if (!Number.isInteger(index)) {
        return undefined;
      }

      current = current[index];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function probabilityFromValue(value: unknown): number | null {
  const parsed = toFiniteNumber(value);

  if (parsed === null) {
    return null;
  }

  /*
    Accept both formats:

      0.81 -> 0.81
      81   -> 0.81
      81%  -> 0.81

    page.tsx formatPercent() expects probability in 0..1 format.
  */
  if (parsed >= 0 && parsed <= 1) {
    return parsed;
  }

  if (parsed > 1 && parsed <= 100) {
    return parsed / 100;
  }

  return null;
}

function firstProbability(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = probabilityFromValue(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== ""
  );
}

function formatHktDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";

  return `${year}-${month}-${day}`;
}

function getForecastHktDate(forecast: Forecast) {
  const forecastRecord = forecast as unknown as Record<string, unknown>;

  const explicitForecastDate = getStringField(forecastRecord, [
    "hktDate",
    "hkt_date",
    "forecastDate",
    "date"
  ]);

  if (explicitForecastDate) {
    return explicitForecastDate;
  }

  const weather = forecastRecord.weather;

  if (isRecord(weather)) {
    const explicitWeatherDate = getStringField(weather, [
      "hktDate",
      "hkt_date",
      "forecastDate",
      "date"
    ]);

    if (explicitWeatherDate) {
      return explicitWeatherDate;
    }
  }

  const generatedAt = getStringField(forecastRecord, ["generatedAt"]);

  if (generatedAt) {
    const generatedAtDate = new Date(generatedAt);

    if (Number.isFinite(generatedAtDate.getTime())) {
      return formatHktDate(generatedAtDate);
    }
  }

  return formatHktDate(new Date());
}

function getAiExplanationText(aiCommentary: unknown): string | null {
  if (!aiCommentary) {
    return null;
  }

  if (typeof aiCommentary === "string") {
    return aiCommentary.trim() ? aiCommentary : null;
  }

  if (isRecord(aiCommentary)) {
    const directText = firstString(
      aiCommentary.aiExplanation,
      aiCommentary.text,
      aiCommentary.summary,
      aiCommentary.explanation,
      aiCommentary.commentary,
      aiCommentary.content,
      aiCommentary.message,

      /*
        Common nested response shapes.
      */
      getAt(aiCommentary, ["data", "aiExplanation"]),
      getAt(aiCommentary, ["data", "text"]),
      getAt(aiCommentary, ["data", "summary"]),
      getAt(aiCommentary, ["data", "explanation"]),
      getAt(aiCommentary, ["data", "commentary"]),
      getAt(aiCommentary, ["data", "content"]),
      getAt(aiCommentary, ["result", "aiExplanation"]),
      getAt(aiCommentary, ["result", "text"]),
      getAt(aiCommentary, ["result", "summary"]),
      getAt(aiCommentary, ["result", "explanation"]),
      getAt(aiCommentary, ["result", "commentary"]),
      getAt(aiCommentary, ["result", "content"]),
      getAt(aiCommentary, ["choices", "0", "message", "content"]),
      getAt(aiCommentary, ["message", "content"])
    );

    if (directText) {
      return directText;
    }
  }

  /*
    If Poe returns an unexpected object, show it rather than silently
    displaying "AI explanation disabled or not available."
  */
  try {
    const serialized = JSON.stringify(aiCommentary, null, 2);

    if (serialized && serialized !== "{}" && serialized !== "null") {
      return serialized;
    }
  } catch {
    const fallback = String(aiCommentary);

    if (fallback && fallback !== "[object Object]") {
      return fallback;
    }
  }

  return null;
}

function normalizeOutcomeForPage(
  value: unknown,
  index: number
): Record<string, unknown> {
  const row = recordOrEmpty(value);

  const name =
    firstString(row.name, row.outcome, row.label, row.title) ??
    `Outcome ${index + 1}`;

  const lower = firstNumber(row.lower, row.min, row.from);
  const upper = firstNumber(row.upper, row.max, row.to);

  /*
    IMPORTANT:
    page.tsx expects forecast.outcomeProbabilities[].probability to be
    model/weather probability in 0..1 format.

    Prefer model/weather fields first. Only fall back to generic probability.
  */
  const modelProbability = firstProbability(
    row.weatherProbability,
    row.modelProbability,
    row.forecastProbability,
    row.weatherProbabilityPct,
    row.modelProbabilityPct,
    row.forecastProbabilityPct,
    getAt(row, ["model", "probability"]),
    getAt(row, ["model", "probabilityPct"]),
    getAt(row, ["model", "weatherProbability"]),
    getAt(row, ["model", "weatherProbabilityPct"]),
    row.probability,
    row.probabilityPct
  );

  const marketProbability = firstProbability(
    row.marketProbability,
    row.polymarketProbability,
    row.marketPrice,
    row.price,
    row.clobMidpoint,
    row.marketProbabilityPct,
    row.polymarketProbabilityPct,
    row.marketPct,
    row.polymarketPct
  );

  const edge =
    modelProbability !== null && marketProbability !== null
      ? modelProbability - marketProbability
      : null;

  return {
    ...row,

    name,
    lower,
    upper,

    /*
      Shape expected by page.tsx.
    */
    probability: modelProbability,
    probabilityPct:
      modelProbability === null ? null : Math.round(modelProbability * 10000) / 100,

    /*
      Aliases for other UI / future code.
    */
    modelProbability,
    modelProbabilityPct:
      modelProbability === null ? null : Math.round(modelProbability * 10000) / 100,
    weatherProbability: modelProbability,
    weatherProbabilityPct:
      modelProbability === null ? null : Math.round(modelProbability * 10000) / 100,
    forecastProbability: modelProbability,
    forecastProbabilityPct:
      modelProbability === null ? null : Math.round(modelProbability * 10000) / 100,

    marketProbability,
    marketProbabilityPct:
      marketProbability === null
        ? null
        : Math.round(marketProbability * 10000) / 100,
    polymarketProbability: marketProbability,
    polymarketProbabilityPct:
      marketProbability === null
        ? null
        : Math.round(marketProbability * 10000) / 100,

    edge,
    edgePct: edge === null ? null : Math.round(edge * 10000) / 100
  };
}

function getOutcomePoint(row: Record<string, unknown>): number | null {
  const lower = firstNumber(row.lower);
  const upper = firstNumber(row.upper);

  if (lower !== null && upper !== null) {
    return (lower + upper) / 2;
  }

  if (lower !== null && upper === null) {
    return lower + 0.5;
  }

  if (lower === null && upper !== null) {
    return upper - 0.5;
  }

  return null;
}

function deriveEstimatedFinalMaxCFromOutcomes(
  outcomeProbabilities: Record<string, unknown>[]
) {
  const weightedPoints = outcomeProbabilities
    .map((row) => {
      const point = getOutcomePoint(row);
      const probability = probabilityFromValue(row.probability);

      return {
        point,
        probability
      };
    })
    .filter(
      (
        item
      ): item is {
        point: number;
        probability: number;
      } => item.point !== null && item.probability !== null
    )
    .sort((a, b) => a.point - b.point);

  const total = weightedPoints.reduce(
    (sum, item) => sum + Math.max(0, item.probability),
    0
  );

  if (!weightedPoints.length || total <= 0) {
    return {
      p10: null,
      p25: null,
      median: null,
      p50: null,
      p75: null,
      p90: null
    };
  }

  function quantile(q: number): number | null {
    const target = q * total;
    let cumulative = 0;

    for (const item of weightedPoints) {
      cumulative += Math.max(0, item.probability);

      if (cumulative >= target) {
        return item.point;
      }
    }

    return weightedPoints[weightedPoints.length - 1]?.point ?? null;
  }

  const p10 = quantile(0.1);
  const p25 = quantile(0.25);
  const median = quantile(0.5);
  const p75 = quantile(0.75);
  const p90 = quantile(0.9);

  return {
    p10,
    p25,
    median,
    p50: median,
    p75,
    p90
  };
}

function buildEstimatedFinalMaxCForPage(
  forecastRecord: Record<string, unknown>,
  outcomeProbabilities: Record<string, unknown>[]
) {
  const derived = deriveEstimatedFinalMaxCFromOutcomes(outcomeProbabilities);

  const p10 =
    firstNumber(
      getAt(forecastRecord, ["estimatedFinalMaxC", "p10"]),
      getAt(forecastRecord, ["estimatedFinalDailyMaxC", "p10"]),
      getAt(forecastRecord, ["estimatedFinalDailyMax", "p10"]),
      getAt(forecastRecord, ["estimatedFinalMax", "p10"]),
      getAt(forecastRecord, ["finalDailyMax", "p10"]),
      getAt(forecastRecord, ["percentiles", "p10"]),
      getAt(forecastRecord, ["quantiles", "p10"]),
      getAt(forecastRecord, ["model", "estimatedFinalMaxC", "p10"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMaxC", "p10"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMax", "p10"]),
      getAt(forecastRecord, ["model", "estimatedFinalMax", "p10"]),
      getAt(forecastRecord, ["model", "percentiles", "p10"]),
      getAt(forecastRecord, ["model", "quantiles", "p10"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMaxC", "p10"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMaxC", "p10"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMax", "p10"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMax", "p10"]),
      getAt(forecastRecord, ["diagnostics", "percentiles", "p10"]),
      getAt(forecastRecord, ["diagnostics", "quantiles", "p10"])
    ) ?? derived.p10;

  const p25 =
    firstNumber(
      getAt(forecastRecord, ["estimatedFinalMaxC", "p25"]),
      getAt(forecastRecord, ["estimatedFinalDailyMaxC", "p25"]),
      getAt(forecastRecord, ["estimatedFinalDailyMax", "p25"]),
      getAt(forecastRecord, ["estimatedFinalMax", "p25"]),
      getAt(forecastRecord, ["finalDailyMax", "p25"]),
      getAt(forecastRecord, ["percentiles", "p25"]),
      getAt(forecastRecord, ["quantiles", "p25"]),
      getAt(forecastRecord, ["model", "estimatedFinalMaxC", "p25"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMaxC", "p25"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMax", "p25"]),
      getAt(forecastRecord, ["model", "estimatedFinalMax", "p25"]),
      getAt(forecastRecord, ["model", "percentiles", "p25"]),
      getAt(forecastRecord, ["model", "quantiles", "p25"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMaxC", "p25"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMaxC", "p25"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMax", "p25"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMax", "p25"]),
      getAt(forecastRecord, ["diagnostics", "percentiles", "p25"]),
      getAt(forecastRecord, ["diagnostics", "quantiles", "p25"])
    ) ?? derived.p25;

  const median =
    firstNumber(
      getAt(forecastRecord, ["estimatedFinalMaxC", "median"]),
      getAt(forecastRecord, ["estimatedFinalMaxC", "p50"]),
      getAt(forecastRecord, ["estimatedFinalDailyMaxC", "median"]),
      getAt(forecastRecord, ["estimatedFinalDailyMaxC", "p50"]),
      getAt(forecastRecord, ["estimatedFinalDailyMax", "median"]),
      getAt(forecastRecord, ["estimatedFinalDailyMax", "p50"]),
      getAt(forecastRecord, ["estimatedFinalMax", "median"]),
      getAt(forecastRecord, ["estimatedFinalMax", "p50"]),
      getAt(forecastRecord, ["finalDailyMax", "median"]),
      getAt(forecastRecord, ["finalDailyMax", "p50"]),
      getAt(forecastRecord, ["percentiles", "median"]),
      getAt(forecastRecord, ["percentiles", "p50"]),
      getAt(forecastRecord, ["quantiles", "median"]),
      getAt(forecastRecord, ["quantiles", "p50"]),
      getAt(forecastRecord, ["model", "estimatedFinalMaxC", "median"]),
      getAt(forecastRecord, ["model", "estimatedFinalMaxC", "p50"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMaxC", "median"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMaxC", "p50"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMax", "median"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMax", "p50"]),
      getAt(forecastRecord, ["model", "estimatedFinalMax", "median"]),
      getAt(forecastRecord, ["model", "estimatedFinalMax", "p50"]),
      getAt(forecastRecord, ["model", "percentiles", "median"]),
      getAt(forecastRecord, ["model", "percentiles", "p50"]),
      getAt(forecastRecord, ["model", "quantiles", "median"]),
      getAt(forecastRecord, ["model", "quantiles", "p50"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMaxC", "median"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMaxC", "p50"]),
      getAt(forecastRecord, [
        "diagnostics",
        "estimatedFinalDailyMaxC",
        "median"
      ]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMaxC", "p50"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMax", "median"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMax", "p50"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMax", "median"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMax", "p50"]),
      getAt(forecastRecord, ["diagnostics", "percentiles", "median"]),
      getAt(forecastRecord, ["diagnostics", "percentiles", "p50"]),
      getAt(forecastRecord, ["diagnostics", "quantiles", "median"]),
      getAt(forecastRecord, ["diagnostics", "quantiles", "p50"])
    ) ?? derived.median;

  const p75 =
    firstNumber(
      getAt(forecastRecord, ["estimatedFinalMaxC", "p75"]),
      getAt(forecastRecord, ["estimatedFinalDailyMaxC", "p75"]),
      getAt(forecastRecord, ["estimatedFinalDailyMax", "p75"]),
      getAt(forecastRecord, ["estimatedFinalMax", "p75"]),
      getAt(forecastRecord, ["finalDailyMax", "p75"]),
      getAt(forecastRecord, ["percentiles", "p75"]),
      getAt(forecastRecord, ["quantiles", "p75"]),
      getAt(forecastRecord, ["model", "estimatedFinalMaxC", "p75"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMaxC", "p75"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMax", "p75"]),
      getAt(forecastRecord, ["model", "estimatedFinalMax", "p75"]),
      getAt(forecastRecord, ["model", "percentiles", "p75"]),
      getAt(forecastRecord, ["model", "quantiles", "p75"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMaxC", "p75"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMaxC", "p75"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMax", "p75"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMax", "p75"]),
      getAt(forecastRecord, ["diagnostics", "percentiles", "p75"]),
      getAt(forecastRecord, ["diagnostics", "quantiles", "p75"])
    ) ?? derived.p75;

  const p90 =
    firstNumber(
      getAt(forecastRecord, ["estimatedFinalMaxC", "p90"]),
      getAt(forecastRecord, ["estimatedFinalDailyMaxC", "p90"]),
      getAt(forecastRecord, ["estimatedFinalDailyMax", "p90"]),
      getAt(forecastRecord, ["estimatedFinalMax", "p90"]),
      getAt(forecastRecord, ["finalDailyMax", "p90"]),
      getAt(forecastRecord, ["percentiles", "p90"]),
      getAt(forecastRecord, ["quantiles", "p90"]),
      getAt(forecastRecord, ["model", "estimatedFinalMaxC", "p90"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMaxC", "p90"]),
      getAt(forecastRecord, ["model", "estimatedFinalDailyMax", "p90"]),
      getAt(forecastRecord, ["model", "estimatedFinalMax", "p90"]),
      getAt(forecastRecord, ["model", "percentiles", "p90"]),
      getAt(forecastRecord, ["model", "quantiles", "p90"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMaxC", "p90"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMaxC", "p90"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalDailyMax", "p90"]),
      getAt(forecastRecord, ["diagnostics", "estimatedFinalMax", "p90"]),
      getAt(forecastRecord, ["diagnostics", "percentiles", "p90"]),
      getAt(forecastRecord, ["diagnostics", "quantiles", "p90"])
    ) ?? derived.p90;

  return {
    p10,
    p25,
    median,
    p50: median,
    p75,
    p90
  };
}

function normalizeForecastResultForPage(
  forecast: Forecast,
  aiCommentary: AiCommentary
): ForecastResult {
  const forecastRecord = recordOrEmpty(forecast);

  const rawOutcomes = Array.isArray(forecastRecord.outcomes)
    ? forecastRecord.outcomes
    : Array.isArray(forecastRecord.probabilities)
      ? forecastRecord.probabilities
      : Array.isArray(forecastRecord.outcomeProbabilities)
        ? forecastRecord.outcomeProbabilities
        : [];

  const outcomeProbabilities = rawOutcomes.map(normalizeOutcomeForPage);

  const estimatedFinalMaxC = buildEstimatedFinalMaxCForPage(
    forecastRecord,
    outcomeProbabilities
  );

  const generatedAt =
    firstString(forecastRecord.generatedAt) ?? new Date().toISOString();

  const maxSoFarC = firstNumber(
    forecastRecord.maxSoFarC,
    forecastRecord.maxSoFar,
    forecastRecord.observedMaxSoFarC,
    forecastRecord.observedMaxSoFar,
    getAt(forecastRecord, ["weather", "sinceMidnight", "maxTempC"]),
    getAt(forecastRecord, ["weather", "current", "maxSoFarC"]),
    getAt(forecastRecord, ["weather", "current", "maxSoFar"]),
    getAt(forecastRecord, ["weather", "current", "todayMax"]),
    getAt(forecastRecord, ["weather", "current", "maxTemperature"]),
    getAt(forecastRecord, ["diagnostics", "maxSoFarC"]),
    getAt(forecastRecord, ["diagnostics", "maxSoFar"]),
    getAt(forecastRecord, ["diagnostics", "observedMaxSoFarC"]),
    getAt(forecastRecord, ["diagnostics", "observedMaxSoFar"])
  );

  const maxSoFarSource =
    firstString(
      forecastRecord.maxSoFarSource,
      forecastRecord.observedMaxSoFarSource,
      getAt(forecastRecord, ["weather", "maxSoFarSource"]),
      getAt(forecastRecord, ["weather", "observedMaxSoFarSource"]),
      getAt(forecastRecord, ["weather", "source"]),
      getAt(forecastRecord, ["weather", "sinceMidnight", "source"]),
      getAt(forecastRecord, ["weather", "current", "maxSoFarSource"]),
      getAt(forecastRecord, ["weather", "current", "observedMaxSoFarSource"]),
      getAt(forecastRecord, ["weather", "current", "source"]),
      getAt(forecastRecord, ["diagnostics", "maxSoFarSource"]),
      getAt(forecastRecord, ["diagnostics", "observedMaxSoFarSource"])
    ) ?? (maxSoFarC !== null ? "HKO since-midnight observation" : null);

  const calculatedTopOutcome =
    [...outcomeProbabilities].sort(
      (a, b) =>
        (probabilityFromValue(b.probability) ?? -Infinity) -
        (probabilityFromValue(a.probability) ?? -Infinity)
    )[0] ?? null;

  const topOutcome = forecastRecord.topOutcome ?? calculatedTopOutcome;

  const keyDrivers =
    stringArray(forecastRecord.keyDrivers) ??
    stringArray(getAt(forecastRecord, ["summary", "keyDrivers"])) ??
    stringArray(getAt(forecastRecord, ["diagnostics", "keyDrivers"])) ??
    [];

  const warnings =
    stringArray(forecastRecord.warnings) ??
    stringArray(getAt(forecastRecord, ["summary", "warnings"])) ??
    stringArray(getAt(forecastRecord, ["diagnostics", "warnings"])) ??
    [];

  const aiExplanation = getAiExplanationText(aiCommentary);

  const model = {
    ...recordOrEmpty(forecastRecord.model),
    estimatedFinalMaxC,
    estimatedFinalDailyMaxC: estimatedFinalMaxC,
    estimatedFinalDailyMax: estimatedFinalMaxC,
    percentiles: estimatedFinalMaxC,
    quantiles: estimatedFinalMaxC
  };

  const diagnostics = {
    ...recordOrEmpty(forecastRecord.diagnostics),
    estimatedFinalMaxC,
    estimatedFinalDailyMaxC: estimatedFinalMaxC,
    estimatedFinalDailyMax: estimatedFinalMaxC,
    percentiles: estimatedFinalMaxC,
    quantiles: estimatedFinalMaxC,
    maxSoFarC,
    maxSoFarSource
  };

  return {
    ...forecastRecord,

    generatedAt,

    /*
      Fields that page.tsx currently reads.
    */
    outcomeProbabilities,
    estimatedFinalMaxC,
    maxSoFarC,
    maxSoFarSource,
    aiExplanation,
    keyDrivers,
    warnings,

    /*
      Compatibility aliases.
    */
    outcomes: rawOutcomes,
    probabilities: outcomeProbabilities,
    estimatedFinalDailyMaxC: estimatedFinalMaxC,
    estimatedFinalDailyMax: estimatedFinalMaxC,
    estimatedFinalMax: estimatedFinalMaxC,
    percentiles: estimatedFinalMaxC,
    quantiles: estimatedFinalMaxC,

    /*
      Preserve / enrich existing fields.
    */
    topOutcome,
    weather: forecastRecord.weather,
    model,
    diagnostics
  } as unknown as ForecastResult;
}

function buildResultForHistory(
  forecast: Forecast,
  aiCommentary: AiCommentary
): ForecastResult {
  /*
    Save the normalized result shape too, so history display can use:
      row.result.outcomeProbabilities
      row.result.estimatedFinalMaxC
      row.result.maxSoFarC
  */
  return normalizeForecastResultForPage(forecast, aiCommentary);
}

async function ensureDatabaseInitialized() {
  if (!databaseInitPromise) {
    databaseInitPromise = initDatabase().catch((error) => {
      databaseInitPromise = null;
      throw error;
    });
  }

  return databaseInitPromise;
}

async function saveHistoryIfRequested(params: {
  saveHistory: boolean;
  state: MarketState | null;
  forecast: Forecast;
  aiCommentary: AiCommentary;
}): Promise<HistorySaveResult> {
  if (!params.saveHistory) {
    return {
      saved: false,
      reason: "History save was not requested."
    };
  }

  if (!params.state) {
    return {
      saved: false,
      reason: "Market state was not provided, so history was not saved."
    };
  }

  try {
    /*
      Make this route self-healing.

      If forecast_runs table does not exist yet, initDatabase() will create it.
      If DATABASE_URL is missing, initDatabase() will throw and we return a clean reason.
    */
    await ensureDatabaseInitialized();

    const resultForHistory = buildResultForHistory(
      params.forecast,
      params.aiCommentary
    );

    return await saveForecastRun({
      hktDate: getForecastHktDate(params.forecast),
      state: params.state,
      weather: params.forecast.weather as unknown as HkoWeatherSnapshot,
      result: resultForHistory
    });
  } catch (error) {
    console.error("Forecast history save error:", error);

    return {
      saved: false,
      reason:
        error instanceof Error
          ? error.message
          : "Failed to save forecast history."
    };
  }
}

function buildForecastPayload(params: {
  forecast: Forecast;
  aiCommentary: AiCommentary;
  historySave: HistorySaveResult;
}) {
  /*
    Normalize into the exact shape page.tsx expects.
  */
  const resultForDisplay = normalizeForecastResultForPage(
    params.forecast,
    params.aiCommentary
  );

  const resultRecord = resultForDisplay as unknown as Record<string, unknown>;

  const generatedAt =
    firstString(resultRecord.generatedAt) ?? new Date().toISOString();

  const aiExplanation =
    firstString(resultRecord.aiExplanation) ??
    getAiExplanationText(params.aiCommentary);

  const weatherForDisplay = (resultRecord.weather ??
    params.forecast.weather) as HkoWeatherSnapshot;

  const data = {
    ...resultRecord,

    /*
      Main aliases expected by page.tsx.
    */
    result: resultForDisplay,
    forecast: resultForDisplay,
    weather: weatherForDisplay,

    /*
      Poe AI aliases.
    */
    ai: params.aiCommentary,
    aiCommentary: params.aiCommentary,
    aiExplanation,

    /*
      History save status.
    */
    historySave: params.historySave
  };

  return {
    ok: true,
    generatedAt,

    /*
      Main response shape used by page.tsx.
    */
    data,

    /*
      Top-level aliases for compatibility.
    */
    forecast: resultForDisplay,
    result: resultForDisplay,

    /*
      Forecast top-level fields for debugging / older clients.
    */
    outcomes: resultRecord.outcomes ?? [],
    probabilities:
      resultRecord.outcomeProbabilities ?? resultRecord.probabilities ?? [],
    outcomeProbabilities: resultRecord.outcomeProbabilities ?? [],
    topOutcome: resultRecord.topOutcome ?? null,
    summary: resultRecord.summary ?? null,
    weather: weatherForDisplay,
    model: resultRecord.model ?? null,
    diagnostics: resultRecord.diagnostics ?? null,
    estimatedFinalMaxC: resultRecord.estimatedFinalMaxC ?? null,
    estimatedFinalDailyMaxC: resultRecord.estimatedFinalDailyMaxC ?? null,
    estimatedFinalDailyMax: resultRecord.estimatedFinalDailyMax ?? null,
    maxSoFarC: resultRecord.maxSoFarC ?? null,
    maxSoFarSource: resultRecord.maxSoFarSource ?? null,

    /*
      Poe AI top-level aliases.
    */
    ai: params.aiCommentary,
    aiCommentary: params.aiCommentary,
    aiExplanation,

    /*
      History save top-level alias.
    */
    historySave: params.historySave
  };
}

async function runForecast(options: RunForecastOptions) {
  const forecast = await getForecast(options);

  let aiCommentary: AiCommentary = null;

  if (options.ai) {
    try {
      aiCommentary = await getPoeForecastCommentary(forecast);

      /*
        If poe.ts returns null / empty instead of throwing,
        show a useful diagnostic rather than silently showing:
        "AI explanation disabled or not available."
      */
      if (!getAiExplanationText(aiCommentary)) {
        aiCommentary = {
          explanation:
            "Poe AI explanation returned no content. Check your Poe environment variable and src/lib/poe.ts return shape."
        } as Awaited<ReturnType<typeof getPoeForecastCommentary>>;
      }
    } catch (error) {
      console.error("Poe AI commentary error:", error);

      aiCommentary = {
        explanation:
          error instanceof Error
            ? `Poe AI explanation failed: ${error.message}`
            : "Poe AI explanation failed."
      } as Awaited<ReturnType<typeof getPoeForecastCommentary>>;
    }
  }

  const historySave = await saveHistoryIfRequested({
    saveHistory: Boolean(options.saveHistory),
    state: options.state ?? null,
    forecast,
    aiCommentary
  });

  return buildForecastPayload({
    forecast,
    aiCommentary,
    historySave
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const includeClob = parseBoolean(url.searchParams.get("includeClob"), true);
    const blendMarket = parseBoolean(url.searchParams.get("blendMarket"), true);
    const debug = parseBoolean(url.searchParams.get("debug"), false);

    /*
      Keep AI always enabled for now because the UI is expecting explanation.
      If you later want the checkbox to fully control Poe usage, change this
      to parseBoolean(url.searchParams.get("ai"), false).
    */
    const ai = true;

    const marketWeightOverride = parseNumber(
      url.searchParams.get("marketWeight")
    );

    const payload = await runForecast({
      includeClob,
      blendMarket,
      includeRawSnapshot: debug,
      marketWeightOverride,
      ai,
      saveHistory: false,
      state: null
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0"
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
            : "Failed to generate multi-channel forecast."
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown> = {};

    try {
      const parsed = await request.json();

      body =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      body = {};
    }

    const includeClob = parseBoolean(body.includeClob, true);
    const blendMarket = parseBoolean(body.blendMarket, true);
    const debug = parseBoolean(body.debug, false);

    /*
      Keep AI always enabled for now.

      Your page.tsx sends forceAI, but the previous route was already hardcoded
      to true. This keeps behaviour consistent and avoids the UI silently saying
      "AI explanation disabled or not available."
    */
    const ai = true;

    const state = parseMarketState(body.state);
    const saveHistory = parseBoolean(body.saveHistory, false);

    const marketWeightOverride = parseNumber(body.marketWeight);

    const payload = await runForecast({
      includeClob,
      blendMarket,
      includeRawSnapshot: debug,
      marketWeightOverride,
      ai,
      saveHistory,
      state
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    console.error("Forecast API POST error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate multi-channel forecast."
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
}
