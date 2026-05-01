import { NextResponse } from "next/server";
import { getForecast, type GetForecastOptions } from "@/lib/forecast";
import { getPoeForecastCommentary } from "@/lib/poe";
import { initDatabase, saveForecastRun } from "@/lib/db";
import type { ForecastResult, HkoWeatherSnapshot, MarketState } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Forecast = Awaited<ReturnType<typeof getForecast>>;

type AiFallbackCommentary = {
  explanation: string;
};

type AiCommentary =
  | Awaited<ReturnType<typeof getPoeForecastCommentary>>
  | AiFallbackCommentary
  | string
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
function getMarketProbabilityFromRow(
  row: Record<string, unknown>
): number | null {
  return firstProbability(
    row.marketProbability,
    row.polymarketProbability,
    row.marketPrice,
    row.price,
    row.clobMidpoint,
    row.clobMid,
    row.yesPrice,
    row.lastPrice,
    row.bestAsk,
    row.bestBid,
    row.clobBestAsk,
    row.clobBestBid,
    row.marketProbabilityPct,
    row.polymarketProbabilityPct,
    row.marketPct,
    row.polymarketPct
  );
}
type NumericCandidate = {
  value: number;
  source: string;
  path: string;
};

type OutcomeRange = {
  lower: number | null;
  upper: number | null;
};

const PROBABILITY_EPSILON = 1e-9;

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function probabilityToPct(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.round(clampProbability(value) * 10000) / 100;
}

function roundProbability(value: number): number {
  return Math.round(clampProbability(value) * 10000) / 10000;
}

function roundTemperatureC(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function normalizeStationName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function isHkoStationName(value: unknown): boolean {
  const normalized = normalizeStationName(value);

  return [
    "hko",
    "hkobservatory",
    "hongkongobservatory",
    "香港天文台"
  ].includes(normalized);
}

function getHkoTemperatureFromObservationArray(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const records = value.filter(isRecord);

  const hkoRecord =
    records.find((item) =>
      isHkoStationName(
        firstString(
          item.place,
          item.station,
          item.name,
          item.automaticWeatherStation,
          item.automatic_weather_station
        )
      )
    ) ?? null;

  if (!hkoRecord) {
    return null;
  }

  return firstNumber(
    hkoRecord.value,
    hkoRecord.temp,
    hkoRecord.temperature,
    hkoRecord.temperatureC,
    hkoRecord.airTemperature,
    hkoRecord.airTemperatureC
  );
}

function numberCandidate(
  path: string,
  value: unknown,
  source: string
): NumericCandidate | null {
  const parsed = toFiniteNumber(value);

  if (parsed === null) {
    return null;
  }

  return {
    value: parsed,
    source,
    path
  };
}

function pickMaxCandidate(
  candidates: Array<NumericCandidate | null>
): NumericCandidate | null {
  const valid = candidates.filter(
    (candidate): candidate is NumericCandidate => candidate !== null
  );

  if (!valid.length) {
    return null;
  }

  return valid.reduce((best, candidate) =>
    candidate.value > best.value ? candidate : best
  );
}

/*
  This is the critical lower-bound rule:

    final daily max >= max(
      HKO max since midnight,
      HKO current temp,
      latest observed HKO temp,
      any explicit observed max so far
    )

  Do NOT include official forecast max here. Forecast is not observation.
*/
function getObservedMaxLowerBoundCandidate(
  forecastRecord: Record<string, unknown>
): NumericCandidate | null {
  return pickMaxCandidate([
    numberCandidate(
      "observedMaxLowerBoundC",
      forecastRecord.observedMaxLowerBoundC,
      "Observed max lower bound"
    ),
    numberCandidate(
      "observedFinalMaxLowerBoundC",
      forecastRecord.observedFinalMaxLowerBoundC,
      "Observed max lower bound"
    ),
    numberCandidate(
      "observedMaxC",
      forecastRecord.observedMaxC,
      "Observed max so far"
    ),
    numberCandidate(
      "observedMax",
      forecastRecord.observedMax,
      "Observed max so far"
    ),
    numberCandidate(
      "hkoObservedMaxC",
      forecastRecord.hkoObservedMaxC,
      "HKO observed max"
    ),
    numberCandidate(
      "hkoMaxSinceMidnightC",
      forecastRecord.hkoMaxSinceMidnightC,
      "HKO max since midnight"
    ),
    numberCandidate(
      "maxSinceMidnightC",
      forecastRecord.maxSinceMidnightC,
      "HKO max since midnight"
    ),
    numberCandidate(
      "maxSoFarC",
      forecastRecord.maxSoFarC,
      "Observed max so far"
    ),
    numberCandidate(
      "maxSoFar",
      forecastRecord.maxSoFar,
      "Observed max so far"
    ),
    numberCandidate(
      "observedMaxSoFarC",
      forecastRecord.observedMaxSoFarC,
      "Observed max so far"
    ),
    numberCandidate(
      "observedMaxSoFar",
      forecastRecord.observedMaxSoFar,
      "Observed max so far"
    ),

    numberCandidate(
      "hkoCurrentTempC",
      forecastRecord.hkoCurrentTempC,
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "currentTempC",
      forecastRecord.currentTempC,
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "currentTemperatureC",
      forecastRecord.currentTemperatureC,
      "HKO current temperature fallback"
    ),

    numberCandidate(
      "weather.sinceMidnight.maxTempC",
      getAt(forecastRecord, ["weather", "sinceMidnight", "maxTempC"]),
      "HKO max since midnight"
    ),
    numberCandidate(
      "weather.sinceMidnight.maxTemperatureC",
      getAt(forecastRecord, ["weather", "sinceMidnight", "maxTemperatureC"]),
      "HKO max since midnight"
    ),
    numberCandidate(
      "weather.sinceMidnight.maxTemp",
      getAt(forecastRecord, ["weather", "sinceMidnight", "maxTemp"]),
      "HKO max since midnight"
    ),
    numberCandidate(
      "weather.sinceMidnight.maxTemperature",
      getAt(forecastRecord, ["weather", "sinceMidnight", "maxTemperature"]),
      "HKO max since midnight"
    ),


    numberCandidate(
      "weather.observedMaxLowerBoundC",
      getAt(forecastRecord, ["weather", "observedMaxLowerBoundC"]),
      "Observed max lower bound"
    ),
    numberCandidate(
      "weather.observedFinalMaxLowerBoundC",
      getAt(forecastRecord, ["weather", "observedFinalMaxLowerBoundC"]),
      "Observed max lower bound"
    ),
    numberCandidate(
      "weather.observedMaxC",
      getAt(forecastRecord, ["weather", "observedMaxC"]),
      "Observed max so far"
    ),
    numberCandidate(
      "weather.observedMax",
      getAt(forecastRecord, ["weather", "observedMax"]),
      "Observed max so far"
    ),
    numberCandidate(
      "weather.maxSoFarC",
      getAt(forecastRecord, ["weather", "maxSoFarC"]),
      "Observed max so far"
    ),
    numberCandidate(
      "weather.observedMaxSoFarC",
      getAt(forecastRecord, ["weather", "observedMaxSoFarC"]),
      "Observed max so far"
    ),
    numberCandidate(
      "weather.hkoMaxSinceMidnightC",
      getAt(forecastRecord, ["weather", "hkoMaxSinceMidnightC"]),
      "HKO max since midnight"
    ),
    numberCandidate(
      "weather.maxSinceMidnightC",
      getAt(forecastRecord, ["weather", "maxSinceMidnightC"]),
      "HKO max since midnight"
    ),
    numberCandidate(
      "weather.hkoCurrentTempC",
      getAt(forecastRecord, ["weather", "hkoCurrentTempC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.current.hkoCurrentTempC",
      getAt(forecastRecord, ["weather", "current", "hkoCurrentTempC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.current.currentTempC",
      getAt(forecastRecord, ["weather", "current", "currentTempC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.current.tempC",
      getAt(forecastRecord, ["weather", "current", "tempC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "hko.currentTempC",
      getAt(forecastRecord, ["hko", "currentTempC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "hko.maxSinceMidnightC",
      getAt(forecastRecord, ["hko", "maxSinceMidnightC"]),
      "HKO max since midnight"
    ),
    numberCandidate(
      "weatherSnapshot.observedMaxC",
      getAt(forecastRecord, ["weatherSnapshot", "observedMaxC"]),
      "Observed max so far"
    ),
    numberCandidate(
      "weatherSnapshot.maxSinceMidnightC",
      getAt(forecastRecord, ["weatherSnapshot", "maxSinceMidnightC"]),
      "HKO max since midnight"
    ),
    numberCandidate(
      "weatherSnapshot.currentTempC",
      getAt(forecastRecord, ["weatherSnapshot", "currentTempC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "hkoWeatherSnapshot.observedMaxC",
      getAt(forecastRecord, ["hkoWeatherSnapshot", "observedMaxC"]),
      "Observed max so far"
    ),
    numberCandidate(
      "hkoWeatherSnapshot.maxSinceMidnightC",
      getAt(forecastRecord, ["hkoWeatherSnapshot", "maxSinceMidnightC"]),
      "HKO max since midnight"
    ),
    numberCandidate(
      "hkoWeatherSnapshot.currentTempC",
      getAt(forecastRecord, ["hkoWeatherSnapshot", "currentTempC"]),
      "HKO current temperature fallback"
    ),
    
    numberCandidate(
      "weather.current.maxSoFarC",
      getAt(forecastRecord, ["weather", "current", "maxSoFarC"]),
      "Observed max so far"
    ),
    numberCandidate(
      "weather.current.todayMax",
      getAt(forecastRecord, ["weather", "current", "todayMax"]),
      "Observed max so far"
    ),
    numberCandidate(
      "weather.current.maxTemperature",
      getAt(forecastRecord, ["weather", "current", "maxTemperature"]),
      "Observed max so far"
    ),

    numberCandidate(
      "weather.currentTempC",
      getAt(forecastRecord, ["weather", "currentTempC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.currentTemperatureC",
      getAt(forecastRecord, ["weather", "currentTemperatureC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.temperatureC",
      getAt(forecastRecord, ["weather", "temperatureC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.temperature",
      getAt(forecastRecord, ["weather", "temperature"]),
      "HKO current temperature fallback"
    ),

    numberCandidate(
      "weather.current.tempC",
      getAt(forecastRecord, ["weather", "current", "tempC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.current.temperatureC",
      getAt(forecastRecord, ["weather", "current", "temperatureC"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.current.temperature",
      getAt(forecastRecord, ["weather", "current", "temperature"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.current.temperature.value",
      getAt(forecastRecord, ["weather", "current", "temperature", "value"]),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.current.airTemperatureC",
      getAt(forecastRecord, ["weather", "current", "airTemperatureC"]),
      "HKO current temperature fallback"
    ),

    numberCandidate(
      "weather.temperature.data[HKO].value",
      getHkoTemperatureFromObservationArray(
        getAt(forecastRecord, ["weather", "temperature", "data"])
      ),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.current.temperature.data[HKO].value",
      getHkoTemperatureFromObservationArray(
        getAt(forecastRecord, ["weather", "current", "temperature", "data"])
      ),
      "HKO current temperature fallback"
    ),
    numberCandidate(
      "weather.raw.temperature.data[HKO].value",
      getHkoTemperatureFromObservationArray(
        getAt(forecastRecord, ["weather", "raw", "temperature", "data"])
      ),
      "HKO current temperature fallback"
    ),

    numberCandidate(
      "diagnostics.maxSoFarC",
      getAt(forecastRecord, ["diagnostics", "maxSoFarC"]),
      "Observed max so far"
    ),
    numberCandidate(
      "diagnostics.observedMaxSoFarC",
      getAt(forecastRecord, ["diagnostics", "observedMaxSoFarC"]),
      "Observed max so far"
    ),
    numberCandidate(
      "diagnostics.hkoCurrentTempC",
      getAt(forecastRecord, ["diagnostics", "hkoCurrentTempC"]),
      "HKO current temperature fallback"
    )
  ]);
}

function parseOutcomeRangeFromText(text: string): OutcomeRange {
  const normalized = text
    .replace(/℃/g, "°C")
    .replace(/\s+/g, " ")
    .trim();

  const explicitRange = normalized.match(
    /(-?\d+(?:\.\d+)?)\s*(?:°\s*C|C)?\s*(?:to|至|-|–|—)\s*<?\s*(-?\d+(?:\.\d+)?)/i
  );

  if (explicitRange) {
    return {
      lower: Number(explicitRange[1]),
      upper: Number(explicitRange[2])
    };
  }

  const lessThan = normalized.match(
    /(?:<|below)\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*C|C)?/i
  );

  if (lessThan) {
    return {
      lower: null,
      upper: Number(lessThan[1])
    };
  }

  const greaterThanOrEqual = normalized.match(
    /(?:>=|≥|at least)\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*C|C)?/i
  );

  if (greaterThanOrEqual) {
    return {
      lower: Number(greaterThanOrEqual[1]),
      upper: null
    };
  }

  const orBelow = normalized.match(
    /(-?\d+(?:\.\d+)?)\s*(?:°\s*C|C)?\s*(?:or below|or lower|or less|and below|或以下|以下)$/i
  );

  if (orBelow) {
    /*
      Market label "19°C or below" usually means:
        final max < 20.0°C
    */
    const value = Number(orBelow[1]);

    return {
      lower: null,
      upper: Number.isInteger(value) ? value + 1 : value
    };
  }

  const orHigher = normalized.match(
    /(-?\d+(?:\.\d+)?)\s*(?:°\s*C|C)?\s*(?:or higher|or above|or more|and above|或以上|以上)$/i
  );

  if (orHigher) {
    return {
      lower: Number(orHigher[1]),
      upper: null
    };
  }

  const singleBucket = normalized.match(
    /^(-?\d+(?:\.\d+)?)\s*(?:°\s*C|C)$/i
  );

  if (singleBucket) {
    const lower = Number(singleBucket[1]);

    return {
      lower,
      upper: lower + 1
    };
  }

  return {
    lower: null,
    upper: null
  };
}

function getOutcomeRange(row: Record<string, unknown>): OutcomeRange {
  const parsedRange = parseOutcomeRangeFromText(
    firstString(
      row.range,
      row.description,
      row.name,
      row.outcome,
      row.label,
      row.title
    ) ?? ""
  );

  return {
    lower:
      firstNumber(
        row.lower,
        row.min,
        row.from,
        getAt(row, ["range", "lower"]),
        getAt(row, ["range", "from"])
      ) ?? parsedRange.lower,
    upper:
      firstNumber(
        row.upper,
        row.max,
        row.to,
        getAt(row, ["range", "upper"]),
        getAt(row, ["range", "to"])
      ) ?? parsedRange.upper
  };
}
function isOutcomeImpossibleByObservedMax(
  row: Record<string, unknown>,
  observedMaxC: number
): boolean {
  const { upper } = getOutcomeRange(row);

  /*
    Outcome range is [lower, upper).
    If observed max is already >= upper, final daily max can no longer end
    inside this bucket.
  */
  return upper !== null && upper <= observedMaxC;
}

function outcomeContainsObservedMax(
  row: Record<string, unknown>,
  observedMaxC: number
): boolean {
  const { lower, upper } = getOutcomeRange(row);

  return (
    (lower === null || observedMaxC >= lower) &&
    (upper === null || observedMaxC < upper)
  );
}

function setModelProbabilityOnRow(
  row: Record<string, unknown>,
  probability: number | null,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  /*
    Legacy name note:
    This function is still named setModelProbabilityOnRow because the rest of
    route.ts already calls it, but Phase 2 treats the incoming probability as
    the final display probability after repair / blend.

    We preserve weatherProbability separately when it already exists.
  */
  const finalProbability =
    probability === null ? null : roundProbability(probability);

  const finalProbabilityPct = probabilityToPct(finalProbability);

  const clob = getClobBidAskFromRow(row);
  const gammaProbability = getGammaProbabilityFromRow(row);
  const marketProbability = getMarketProbabilityFromRow(row);
  const marketProbabilityPct = probabilityToPct(marketProbability);

  const existingWeatherProbability = firstProbability(
    row.weatherFairProbability,
    row.weatherProbability,
    row.unblendedWeatherProbability,
    row.weatherModelProbability,
    row.rawWeatherProbability,
    getAt(row, ["weather", "fairProbability"]),
    getAt(row, ["weather", "probability"]),
    getAt(row, ["model", "weatherProbability"]),
    getAt(row, ["model", "fairProbability"])
  );

  const weatherProbability = existingWeatherProbability ?? finalProbability;
  const weatherProbabilityPct = probabilityToPct(weatherProbability);

  const edgeBaseProbability = weatherProbability ?? finalProbability;

  const edge =
    edgeBaseProbability !== null && marketProbability !== null
      ? edgeBaseProbability - marketProbability
      : null;

  const finalEdge =
    finalProbability !== null && marketProbability !== null
      ? finalProbability - marketProbability
      : null;

  const edgePct = edge === null ? null : Math.round(edge * 10000) / 100;
  const finalEdgePct =
    finalEdge === null ? null : Math.round(finalEdge * 10000) / 100;

  return {
    ...row,
    ...extra,

    /*
      page.tsx legacy aliases.
      In Phase 2 these should point at the repaired final probability so old UI
      code does not silently show stale weather-only numbers.
    */
    probability: finalProbability,
    probabilityPct: finalProbabilityPct,
    modelProbability: finalProbability,
    modelProbabilityPct: finalProbabilityPct,
    forecastProbability: finalProbability,
    forecastProbabilityPct: finalProbabilityPct,

    /*
      Phase 2 explicit probabilities.
    */
    weatherProbability,
    weatherFairProbability: weatherProbability,
    weatherProbabilityPct,
    weatherFairProbabilityPct: weatherProbabilityPct,

    finalProbability,
    finalProbabilityPct,
    blendedProbability: finalProbability,
    blendedProbabilityPct: finalProbabilityPct,

    /*
      Market side.
    */
    marketProbability,
    marketProbabilityPct,
    polymarketProbability: marketProbability,
    polymarketProbabilityPct: marketProbabilityPct,

    gammaProbability,
    gammaProbabilityPct: probabilityToPct(gammaProbability),

    clobBestBid: clob.bid,
    clobBestAsk: clob.ask,
    clobMidpoint: clob.midpoint,
    clobSpread: clob.spread,

    edge,
    edgePct,
    fairEdge: edge,
    fairEdgePct: edgePct,
    finalEdge,
    finalEdgePct
  };
}

function repairOutcomeProbabilitiesForObservedMax(
  rows: Record<string, unknown>[],
  observedMaxC: number | null
): Record<string, unknown>[] {
  if (observedMaxC === null) {
    return rows.map((row) => {
      const probability = firstProbability(
        row.finalProbability,
        row.blendedProbability,
        row.probability
      );

      return probability === null
        ? row
        : setModelProbabilityOnRow(row, probability);
    });
  }

  const observedBucketIndex = rows.findIndex((row) =>
    outcomeContainsObservedMax(row, observedMaxC)
  );

  /*
    Critical Phase 2 rule:

      final daily max >= observed max so far

    Buckets below the observed lower bound become impossible.

    IMPORTANT:
    Do NOT move the removed mass into the observed bucket. That was the cause
    of stale distributions collapsing to 25°C after HKO observed 25°C.
    Instead:
      1. zero impossible buckets,
      2. renormalize remaining final/weather probabilities if usable,
      3. if no usable model probabilities remain, normalize market probabilities,
      4. only if both model and market are missing, fallback to observed bucket.
  */
  const repaired = rows.map((row) => {
    const probability = firstProbability(
      row.finalProbability,
      row.blendedProbability,
      row.probability
    );

    const impossibleByObservedMax = isOutcomeImpossibleByObservedMax(
      row,
      observedMaxC
    );

    if (impossibleByObservedMax) {
      return setModelProbabilityOnRow(row, 0, {
        impossibleByObservedMax: true,
        observedMaxLowerBoundC: observedMaxC,
        modelProbabilityRepair:
          probability !== null
            ? "Set to 0 because observed max already exceeds this bucket. Removed mass was not moved to the observed bucket."
            : "Set to 0 because observed max already exceeds this bucket."
      });
    }

    return {
      ...row,
      impossibleByObservedMax: false,
      observedMaxLowerBoundC: observedMaxC
    };
  });

  const possibleTotal = repaired.reduce((sum, row) => {
    if (row.impossibleByObservedMax === true) {
      return sum;
    }

    const probability = firstProbability(
      row.finalProbability,
      row.blendedProbability,
      row.probability
    );

    return sum + (probability === null ? 0 : Math.max(0, probability));
  }, 0);

  if (possibleTotal <= PROBABILITY_EPSILON) {
    const possibleMarketTotal = repaired.reduce((sum, row) => {
      if (row.impossibleByObservedMax === true) {
        return sum;
      }

      const marketProbability = getMarketProbabilityFromRow(row);

      return (
        sum + (marketProbability === null ? 0 : Math.max(0, marketProbability))
      );
    }, 0);

    /*
      If final/weather probabilities are missing or stale, but market
      probabilities exist, use normalized market probabilities across buckets
      still possible after the observed max lower bound.
    */
    if (possibleMarketTotal > PROBABILITY_EPSILON) {
      return repaired.map((row) => {
        if (row.impossibleByObservedMax === true) {
          return row;
        }

        const marketProbability = getMarketProbabilityFromRow(row) ?? 0;

        return setModelProbabilityOnRow(row, marketProbability / possibleMarketTotal, {
          modelProbabilityRepair:
            "Final/weather probabilities were missing or stale after observed max repair, so normalized Polymarket probabilities were used across buckets still possible after observed max lower bound."
        });
      });
    }

    /*
      True last resort only.
    */
    return repaired.map((row, index) => {
      if (row.impossibleByObservedMax === true) {
        return row;
      }

      return setModelProbabilityOnRow(row, index === observedBucketIndex ? 1 : 0, {
        modelProbabilityRepair:
          index === observedBucketIndex
            ? "Fallback 100% to bucket containing observed max because final/weather and market probabilities were missing."
            : "Fallback 0% because final/weather and market probabilities were missing."
      });
    });
  }

  const shouldNormalize = Math.abs(possibleTotal - 1) > 0.005;

  return repaired.map((row) => {
    if (row.impossibleByObservedMax === true) {
      return row;
    }

    const probability =
      firstProbability(row.finalProbability, row.blendedProbability, row.probability) ??
      0;

    return setModelProbabilityOnRow(
      row,
      shouldNormalize ? probability / possibleTotal : probability,
      {
        modelProbabilityRepair: shouldNormalize
          ? "Renormalized remaining possible buckets after applying observed max lower bound."
          : row.modelProbabilityRepair ?? null
      }
    );
  });
}

  const possibleTotal = repaired.reduce((sum, row) => {
    if (row.impossibleByObservedMax === true) {
      return sum;
    }

    const probability = probabilityFromValue(row.probability);

    return sum + (probability === null ? 0 : Math.max(0, probability));
  }, 0);

  /*
    If after removing impossible buckets there is no usable model probability,
    fall back conservatively:

      - observed bucket = 100%
      - other possible buckets = 0%

    This is not a full weather forecast, but it prevents impossible / missing
    output and obeys the hard observed lower bound.
  */
 if (possibleTotal <= PROBABILITY_EPSILON) {
    const possibleMarketTotal = repaired.reduce((sum, row) => {
      if (row.impossibleByObservedMax === true) {
        return sum;
      }

      const marketProbability = getMarketProbabilityFromRow(row);

      return sum + (marketProbability === null ? 0 : Math.max(0, marketProbability));
    }, 0);

    /*
      If model probabilities are missing, but market probabilities exist,
      use normalized market probabilities across still-possible buckets.

      Example:
        observed max = 25.0°C
        26°C market = 96%
        27°C market = 6%
        28°C market = 1%

      Then model distribution should not stay "--".
    */
    if (possibleMarketTotal > PROBABILITY_EPSILON) {
      return repaired.map((row) => {
        if (row.impossibleByObservedMax === true) {
          return row;
        }

        const marketProbability = getMarketProbabilityFromRow(row) ?? 0;

        return setModelProbabilityOnRow(
          row,
          marketProbability / possibleMarketTotal,
          {
            modelProbabilityRepair:
              "Model probabilities were missing, so normalized market probabilities were used across buckets still possible after observed max lower bound."
          }
        );
      });
    }

    return repaired.map((row, index) => {
      if (row.impossibleByObservedMax === true) {
        return row;
      }

      return setModelProbabilityOnRow(row, index === observedBucketIndex ? 1 : 0, {
        modelProbabilityRepair:
          index === observedBucketIndex
            ? "Fallback 100% to bucket containing observed max because both model and market probabilities were missing."
            : "Fallback 0% because both model and market probabilities were missing."
      });
    });
  }

  const shouldNormalize = Math.abs(possibleTotal - 1) > 0.005;

  return repaired.map((row) => {
    if (row.impossibleByObservedMax === true) {
      return row;
    }

    const probability = probabilityFromValue(row.probability) ?? 0;

    return setModelProbabilityOnRow(
      row,
      shouldNormalize ? probability / possibleTotal : probability,
      {
        modelProbabilityRepair: shouldNormalize
          ? "Renormalized after applying observed max lower bound."
          : row.modelProbabilityRepair ?? null
      }
    );
  });
}

function clampEstimatedFinalMaxC(
  estimated: {
    p10: number | null;
    p25: number | null;
    median: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
  },
  observedMaxC: number | null
) {
  function clamp(value: unknown): number | null {
    const parsed = toFiniteNumber(value);

    if (parsed === null) {
      return roundTemperatureC(observedMaxC);
    }

    if (observedMaxC === null) {
      return roundTemperatureC(parsed);
    }

    return roundTemperatureC(Math.max(parsed, observedMaxC));
  }

  const p10 = clamp(estimated.p10);
  const p25 = clamp(estimated.p25);
  const median = clamp(estimated.median ?? estimated.p50);
  const p75 = clamp(estimated.p75);
  const p90 = clamp(estimated.p90);

  return {
    p10,
    p25,
    median,
    p50: median,
    p75,
    p90
  };
}

function buildWeatherForDisplay(params: {
  forecastRecord: Record<string, unknown>;
  observedMaxCandidate: NumericCandidate | null;
  maxSoFarC: number | null;
  maxSoFarSource: string | null;
}): Record<string, unknown> {
  const { forecastRecord, observedMaxCandidate, maxSoFarC, maxSoFarSource } =
    params;

  const weatherRecord = recordOrEmpty(forecastRecord.weather);
  const currentRecord = recordOrEmpty(weatherRecord.current);
  const sinceMidnightRecord = recordOrEmpty(weatherRecord.sinceMidnight);

  const displayCurrentTempC = firstNumber(
    forecastRecord.hkoCurrentTempC,
    forecastRecord.currentTempC,
    forecastRecord.currentTemperatureC,
    getAt(forecastRecord, ["hko", "currentTempC"]),

    weatherRecord.hkoCurrentTempC,
    weatherRecord.currentTempC,
    weatherRecord.currentTemperatureC,
    weatherRecord.temperatureC,
    weatherRecord.temperature,
    getAt(weatherRecord, ["hko", "currentTempC"]),

    currentRecord.hkoCurrentTempC,
    currentRecord.currentTempC,
    currentRecord.tempC,
    currentRecord.temperatureC,
    currentRecord.temperature,
    getAt(currentRecord, ["temperature", "value"]),
    currentRecord.airTemperatureC,
    currentRecord.airTemperature,

    getHkoTemperatureFromObservationArray(
      getAt(forecastRecord, ["weather", "temperature", "data"])
    ),
    getHkoTemperatureFromObservationArray(
      getAt(forecastRecord, ["weather", "current", "temperature", "data"])
    ),
    getHkoTemperatureFromObservationArray(
      getAt(forecastRecord, ["weather", "raw", "temperature", "data"])
    )
  );

  const existingSinceMidnightMaxC = firstNumber(
    sinceMidnightRecord.maxTempC,
    sinceMidnightRecord.maxTemperatureC,
    sinceMidnightRecord.maxTemp,
    sinceMidnightRecord.maxTemperature,

    weatherRecord.hkoMaxSinceMidnightC,
    weatherRecord.maxSinceMidnightC,
    weatherRecord.maxSoFarC,
    weatherRecord.observedMaxSoFarC,
    weatherRecord.observedMaxC,

    forecastRecord.hkoMaxSinceMidnightC,
    forecastRecord.maxSinceMidnightC,
    forecastRecord.maxSoFarC,
    forecastRecord.observedMaxSoFarC,
    forecastRecord.observedMaxC,
    forecastRecord.observedMaxLowerBoundC,
    forecastRecord.observedFinalMaxLowerBoundC
  );

  const displaySinceMidnightMaxCandidate = pickMaxCandidate([
    numberCandidate(
      "existingSinceMidnightMaxC",
      existingSinceMidnightMaxC,
      "HKO max since midnight"
    ),
    numberCandidate(
      "maxSoFarC",
      maxSoFarC,
      maxSoFarSource ?? "Observed max lower bound"
    ),
    numberCandidate(
      "displayCurrentTempC",
      displayCurrentTempC,
      "HKO current temperature fallback"
    )
  ]);

  const displaySinceMidnightMaxC =
    displaySinceMidnightMaxCandidate?.value ?? null;

  const existingSinceMidnightMinC = firstNumber(
    sinceMidnightRecord.minTempC,
    sinceMidnightRecord.minTemperatureC,
    sinceMidnightRecord.minTemp,
    sinceMidnightRecord.minTemperature,
    weatherRecord.hkoMinSinceMidnightC,
    weatherRecord.minSinceMidnightC,
    forecastRecord.hkoMinSinceMidnightC,
    forecastRecord.minSinceMidnightC
  );

  const sinceMidnightMaxSource =
    existingSinceMidnightMaxC !== null
      ? firstString(
          sinceMidnightRecord.maxTempSource,
          sinceMidnightRecord.source
        ) ?? "HKO max since midnight"
      : displaySinceMidnightMaxC !== null
        ? displaySinceMidnightMaxCandidate?.source ??
          maxSoFarSource ??
          "observed temperature fallback"
        : null;

  const currentRecordTime =
    firstString(
      currentRecord.recordTime,
      currentRecord.obsTime,
      currentRecord.time,
      weatherRecord.recordTime,
      weatherRecord.obsTime,
      weatherRecord.updateTime,
      forecastRecord.recordTime,
      forecastRecord.obsTime,
      forecastRecord.generatedAt
    ) ?? null;

  const hkoRecord = recordOrEmpty(weatherRecord.hko);

  return {
    ...weatherRecord,

    maxSoFarC,
    maxSoFarSource,

    /*
      Main observed lower-bound aliases.
    */
    observedMaxLowerBoundC: maxSoFarC,
    observedMaxLowerBoundSource: maxSoFarSource,
    observedFinalMaxLowerBoundC: maxSoFarC,
    observedFinalMaxLowerBoundSource: maxSoFarSource,
    observedMaxSoFarC: maxSoFarC,
    observedMaxSoFarSource: maxSoFarSource,

  

    /*
      Top-level aliases for UI.
    */
    hkoCurrentTempC: displayCurrentTempC,
    currentTempC: displayCurrentTempC,
    currentTemperatureC: displayCurrentTempC,
    temperatureC: displayCurrentTempC,

    hkoMaxSinceMidnightC: displaySinceMidnightMaxC,
    maxSinceMidnightC: displaySinceMidnightMaxC,
    hkoMinSinceMidnightC: existingSinceMidnightMinC,
    minSinceMidnightC: existingSinceMidnightMinC,

    current: {
      ...currentRecord,
      hkoCurrentTempC: displayCurrentTempC,
      currentTempC: displayCurrentTempC,
      currentTemperatureC: displayCurrentTempC,
      tempC: displayCurrentTempC,
      temperatureC: displayCurrentTempC,
      temperature: displayCurrentTempC,
      recordTime: currentRecordTime
    },

    hko: {
      ...recordOrEmpty(forecastRecord.hko),
      ...hkoRecord,
      currentTempC: displayCurrentTempC,
      hkoCurrentTempC: displayCurrentTempC,
      maxSinceMidnightC: displaySinceMidnightMaxC,
      hkoMaxSinceMidnightC: displaySinceMidnightMaxC,
      observedMaxLowerBoundC: maxSoFarC,
      observedFinalMaxLowerBoundC: maxSoFarC
    },

    sinceMidnight: {
      ...sinceMidnightRecord,

      maxTempC: displaySinceMidnightMaxC,
      maxTemperatureC: displaySinceMidnightMaxC,
      maxTemp: displaySinceMidnightMaxC,
      maxTemperature: displaySinceMidnightMaxC,
      maxTempSource: sinceMidnightMaxSource,

      minTempC: existingSinceMidnightMinC,
      minTemperatureC: existingSinceMidnightMinC,
      minTemp: existingSinceMidnightMinC,
      minTemperature: existingSinceMidnightMinC,

      source:
        firstString(sinceMidnightRecord.source) ??
        sinceMidnightMaxSource ??
        null
    },

    sourceDiagnostics: {
      ...recordOrEmpty(weatherRecord.sourceDiagnostics),
      observedFinalMaxLowerBound: {
        valueC: maxSoFarC,
        source: maxSoFarSource,
        path: observedMaxCandidate?.path ?? null
      },
      hkoCurrentTemperature: {
        valueC: displayCurrentTempC,
        source: displayCurrentTempC !== null ? "HKO current temperature" : null
      },
      hkoMaxSinceMidnight: {
        valueC: displaySinceMidnightMaxC,
        source: sinceMidnightMaxSource
      }
    }
  };
}
function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
function warningStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (isRecord(item)) {
        return firstString(
          item.message,
          item.error,
          item.reason,
          item.warning,
          item.text,
          item.detail,
          item.source
        );
      }

      return null;
    })
    .filter((item): item is string => Boolean(item));
}

function addWarning(warnings: string[], warning: string | null) {
  if (!warning) {
    return;
  }

  const trimmed = warning.trim();

  if (!trimmed) {
    return;
  }

  if (!warnings.includes(trimmed)) {
    warnings.push(trimmed);
  }
}

function sourceStatusWarning(
  sourceName: string,
  value: unknown
): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.toLowerCase();

    if (
      normalized.includes("fail") ||
      normalized.includes("error") ||
      normalized.includes("invalid") ||
      normalized.includes("unavailable") ||
      normalized.includes("disabled") ||
      normalized.includes("400") ||
      normalized.includes("401") ||
      normalized.includes("403")
    ) {
      return `${sourceName}: ${value}`;
    }

    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const status = firstString(
    value.status,
    value.state,
    value.result,
    value.sourceStatus
  );

  const error = firstString(
    value.error,
    value.message,
    value.reason,
    value.statusText,
    value.detail,
    value.details
  );

  const ok = firstBoolean(value.ok, value.success, value.enabled);

  const normalizedStatus = status?.toLowerCase() ?? "";

  const failed =
    ok === false ||
    [
      "failed",
      "fail",
      "error",
      "invalid",
      "unavailable",
      "disabled",
      "missing",
      "not_available",
      "not available"
    ].includes(normalizedStatus) ||
    Boolean(
      error &&
        /fail|error|invalid|unavailable|disabled|400|401|403/i.test(error)
    );

  if (!failed) {
    return null;
  }

  return `${sourceName}: ${error ?? status ?? "source unavailable"}`;
}

function buildSourceStatus(params: {
  forecastRecord: Record<string, unknown>;
  weatherForDisplay: Record<string, unknown>;
}): Record<string, unknown> {
  const { forecastRecord, weatherForDisplay } = params;

  const diagnosticsRecord = recordOrEmpty(forecastRecord.diagnostics);
  const diagnosticsSourceStatus = recordOrEmpty(diagnosticsRecord.sourceStatus);
  const diagnosticsSources = recordOrEmpty(diagnosticsRecord.sources);
  const weatherSourceDiagnostics = recordOrEmpty(
    getAt(weatherForDisplay, ["sourceDiagnostics"])
  );

  return {
    ...diagnosticsSourceStatus,

    hko:
      firstRecord(
        diagnosticsSourceStatus.hko,
        diagnosticsSources.hko,
        weatherSourceDiagnostics.hko,
        getAt(weatherForDisplay, ["hko"]),
        getAt(forecastRecord, ["hko"])
      ) ?? null,

    openMeteo:
      firstRecord(
        diagnosticsSourceStatus.openMeteo,
        diagnosticsSourceStatus.open_meteo,
        diagnosticsSources.openMeteo,
        diagnosticsSources.open_meteo,
        weatherSourceDiagnostics.openMeteo,
        weatherSourceDiagnostics.open_meteo,
        getAt(weatherForDisplay, ["openMeteo"]),
        getAt(weatherForDisplay, ["open_meteo"]),
        getAt(forecastRecord, ["openMeteo"]),
        getAt(forecastRecord, ["open_meteo"])
      ) ?? null,

    windy:
      firstRecord(
        diagnosticsSourceStatus.windy,
        diagnosticsSources.windy,
        weatherSourceDiagnostics.windy,
        getAt(weatherForDisplay, ["windy"]),
        getAt(forecastRecord, ["windy"]),
        getAt(forecastRecord, ["weather", "windy"])
      ) ?? null,

    gamma:
      firstRecord(
        diagnosticsSourceStatus.gamma,
        diagnosticsSourceStatus.polymarketGamma,
        diagnosticsSourceStatus.polymarket_gamma,
        diagnosticsSources.gamma,
        diagnosticsSources.polymarketGamma,
        getAt(forecastRecord, ["market", "gamma"]),
        getAt(forecastRecord, ["polymarket", "gamma"]),
        getAt(forecastRecord, ["gamma"])
      ) ?? null,

    clob:
      firstRecord(
        diagnosticsSourceStatus.clob,
        diagnosticsSourceStatus.polymarketClob,
        diagnosticsSourceStatus.polymarket_clob,
        diagnosticsSources.clob,
        diagnosticsSources.polymarketClob,
        getAt(forecastRecord, ["market", "clob"]),
        getAt(forecastRecord, ["polymarket", "clob"]),
        getAt(forecastRecord, ["clob"])
      ) ?? null
  };
}

function collectWarnings(params: {
  forecastRecord: Record<string, unknown>;
  weatherForDisplay: Record<string, unknown>;
  sourceStatus: Record<string, unknown>;
}): string[] {
  const { forecastRecord, weatherForDisplay, sourceStatus } = params;

  const diagnosticsRecord = recordOrEmpty(forecastRecord.diagnostics);
  const summaryRecord = recordOrEmpty(forecastRecord.summary);

  const warnings: string[] = [];

  for (const warning of [
    ...warningStrings(forecastRecord.warnings),
    ...warningStrings(summaryRecord.warnings),
    ...warningStrings(diagnosticsRecord.warnings),
    ...warningStrings(getAt(weatherForDisplay, ["warnings"]))
  ]) {
    addWarning(warnings, warning);
  }

  addWarning(warnings, sourceStatusWarning("HKO", sourceStatus.hko));
  addWarning(warnings, sourceStatusWarning("Open-Meteo", sourceStatus.openMeteo));
  addWarning(warnings, sourceStatusWarning("Windy", sourceStatus.windy));
  addWarning(warnings, sourceStatusWarning("Polymarket Gamma", sourceStatus.gamma));
  addWarning(warnings, sourceStatusWarning("Polymarket CLOB", sourceStatus.clob));

  for (const [sourceName, paths] of Object.entries({
    Windy: [
      ["windyError"],
      ["windy", "error"],
      ["weather", "windyError"],
      ["weather", "windy", "error"],
      ["diagnostics", "windyError"],
      ["diagnostics", "windy", "error"],
      ["diagnostics", "sourceDiagnostics", "windy", "error"]
    ],
    "Polymarket CLOB": [
      ["clobError"],
      ["clob", "error"],
      ["market", "clobError"],
      ["market", "clob", "error"],
      ["polymarket", "clob", "error"],
      ["diagnostics", "clobError"],
      ["diagnostics", "clob", "error"],
      ["diagnostics", "sourceDiagnostics", "clob", "error"]
    ],
    "Polymarket Gamma": [
      ["gammaError"],
      ["gamma", "error"],
      ["market", "gammaError"],
      ["market", "gamma", "error"],
      ["polymarket", "gamma", "error"],
      ["diagnostics", "gammaError"],
      ["diagnostics", "gamma", "error"],
      ["diagnostics", "sourceDiagnostics", "gamma", "error"]
    ],
    "Open-Meteo": [
      ["openMeteoError"],
      ["open_meteo_error"],
      ["openMeteo", "error"],
      ["open_meteo", "error"],
      ["weather", "openMeteo", "error"],
      ["weather", "open_meteo", "error"],
      ["diagnostics", "openMeteoError"],
      ["diagnostics", "open_meteo_error"],
      ["diagnostics", "sourceDiagnostics", "openMeteo", "error"]
    ]
  })) {
    for (const path of paths) {
      const message = firstString(getAt(forecastRecord, path));

      if (message) {
        addWarning(warnings, `${sourceName}: ${message}`);
      }
    }
  }

  const marketBlendEnabled = firstBoolean(
    forecastRecord.marketBlendEnabled,
    getAt(forecastRecord, ["model", "marketBlendEnabled"]),
    getAt(forecastRecord, ["diagnostics", "marketBlendEnabled"])
  );

  if (marketBlendEnabled === false) {
    addWarning(
      warnings,
      "Market blending is disabled or unavailable; final probabilities may be weather-only or fallback-normalized."
    );
  }

  return warnings;
}

function getStateOutcomeRows(state: MarketState | null | undefined): unknown[] {
  if (!state) {
    return [];
  }

+  const stateRecord = recordOrEmpty(state);
+  const candidates = [
+    stateRecord.outcomes,
+    stateRecord.probabilities,
+    stateRecord.outcomeProbabilities,
+    getAt(stateRecord, ["market", "outcomes"]),
+    getAt(stateRecord, ["market", "probabilities"]),
+    getAt(stateRecord, ["polymarket", "outcomes"]),
+    getAt(stateRecord, ["polymarket", "probabilities"])
+  ];
+
+  for (const candidate of candidates) {
+    if (Array.isArray(candidate) && candidate.length > 0) {
+      return candidate;
+    }
+  }
+
+  return [];
+}
+
+function getForecastOutcomeRows(forecastRecord: Record<string, unknown>): unknown[] {
+  /*
+    Prefer the forecast engine's explicit probability rows over raw outcomes.
+    Raw outcomes often contain only labels/prices.
+  */
+  if (Array.isArray(forecastRecord.outcomeProbabilities)) {
+    return forecastRecord.outcomeProbabilities;
+  }
+
+  if (Array.isArray(forecastRecord.probabilities)) {
+    return forecastRecord.probabilities;
+  }
+
+  if (Array.isArray(forecastRecord.outcomes)) {
+    return forecastRecord.outcomes;
+  }
+
+  return [];
+}
+
+function normalizeOutcomeNameKey(value: unknown): string {
+  return String(value ?? "")
+    .trim()
+    .toLowerCase()
+    .replace(/℃/g, "°c")
+    .replace(/\s+/g, " ")
+    .replace(/[^a-z0-9°+\-. ]/g, "");
+}
+
+function outcomeNameKey(row: Record<string, unknown>): string | null {
+  const name = firstString(row.name, row.outcome, row.label, row.title);
+
+  if (!name) {
+    return null;
+  }
+
+  const key = normalizeOutcomeNameKey(name);
+
+  return key ? `name:${key}` : null;
+}
+
+function outcomeRangeKey(row: Record<string, unknown>): string | null {
+  const range = getOutcomeRange(row);
+
+  if (range.lower === null && range.upper === null) {
+    return null;
+  }
+
+  return `range:${range.lower ?? ""}:${range.upper ?? ""}`;
+}
+
+function mergeStateOutcomeWithForecastOutcome(params: {
+  stateRow: Record<string, unknown>;
+  forecastRow: Record<string, unknown> | null;
+}): Record<string, unknown> {
+  const { stateRow, forecastRow } = params;
+
+  if (!forecastRow) {
+    return {
+      ...stateRow,
+      outcomeUniverseSource: "state.outcomes",
+      forecastOutcomeMatched: false
+    };
+  }
+
+  /*
+    Start with forecast row so source/model fields exist, then overlay state row
+    because Admin state is the outcome universe source of truth.
+  */
+  const merged: Record<string, unknown> = {
+    ...forecastRow,
+    ...stateRow,
+    outcomeUniverseSource: "state.outcomes",
+    forecastOutcomeMatched: true
+  };
+
+  /*
+    But probability fields from the engine should not be overwritten by Admin
+    price-only state rows.
+  */
+  for (const key of [
+    "probability",
+    "probabilityPct",
+    "modelProbability",
+    "modelProbabilityPct",
+    "weatherProbability",
+    "weatherProbabilityPct",
+    "weatherFairProbability",
+    "weatherFairProbabilityPct",
+    "forecastProbability",
+    "forecastProbabilityPct",
+    "finalProbability",
+    "finalProbabilityPct",
+    "blendedProbability",
+    "blendedProbabilityPct"
+  ]) {
+    if (forecastRow[key] !== undefined) {
+      merged[key] = forecastRow[key];
+    }
+  }
+
+  const stateName = firstString(
+    stateRow.name,
+    stateRow.outcome,
+    stateRow.label,
+    stateRow.title
+  );
+
+  if (stateName) {
+    merged.name = stateName;
+  }
+
+  const stateRange = getOutcomeRange(stateRow);
+
+  if (stateRange.lower !== null) {
+    merged.lower = stateRange.lower;
+  }
+
+  if (stateRange.upper !== null) {
+    merged.upper = stateRange.upper;
+  }
+
+  return merged;
+}
+
+function buildRawOutcomeRows(params: {
+  forecastRecord: Record<string, unknown>;
+  state: MarketState | null | undefined;
+}): {
+  rows: unknown[];
+  source: string;
+} {
+  const forecastRows = getForecastOutcomeRows(params.forecastRecord).map(
+    (row) => recordOrEmpty(row)
+  );
+
+  const stateRows = getStateOutcomeRows(params.state).map((row) =>
+    recordOrEmpty(row)
+  );
+
+  if (!stateRows.length) {
+    return {
+      rows: forecastRows,
+      source:
+        Array.isArray(params.forecastRecord.outcomeProbabilities)
+          ? "forecast.outcomeProbabilities"
+          : Array.isArray(params.forecastRecord.probabilities)
+            ? "forecast.probabilities"
+            : Array.isArray(params.forecastRecord.outcomes)
+              ? "forecast.outcomes"
+              : "none"
+    };
+  }
+
+  const usedForecastIndexes = new Set<number>();
+
+  const rows = stateRows.map((stateRow, index) => {
+    const stateNameKey = outcomeNameKey(stateRow);
+    const stateRangeKey = outcomeRangeKey(stateRow);
+
+    let matchIndex = forecastRows.findIndex((forecastRow, forecastIndex) => {
+      if (usedForecastIndexes.has(forecastIndex)) {
+        return false;
+      }
+
+      return (
+        (stateNameKey !== null && outcomeNameKey(forecastRow) === stateNameKey) ||
+        (stateRangeKey !== null && outcomeRangeKey(forecastRow) === stateRangeKey)
+      );
+    });
+
+    /*
+      Fallback by index if labels changed but the row count/order is the same.
+    */
+    if (
+      matchIndex < 0 &&
+      forecastRows.length === stateRows.length &&
+      !usedForecastIndexes.has(index)
+    ) {
+      matchIndex = index;
+    }
+
+    const forecastRow = matchIndex >= 0 ? forecastRows[matchIndex] : null;
+
+    if (matchIndex >= 0) {
+      usedForecastIndexes.add(matchIndex);
+    }
+
+    return mergeStateOutcomeWithForecastOutcome({
+      stateRow,
+      forecastRow
+    });
+  });
+
+  return {
+    rows,
+    source: "state.outcomes"
+  };
+}
+
+function getProbabilityContext(
+  forecastRecord: Record<string, unknown>
+): ProbabilityContext {
+  const explicitBlendEnabled = firstBoolean(
+    forecastRecord.marketBlendEnabled,
+    getAt(forecastRecord, ["model", "marketBlendEnabled"]),
+    getAt(forecastRecord, ["diagnostics", "marketBlendEnabled"]),
+    getAt(forecastRecord, ["diagnostics", "marketBlend", "enabled"])
+  );
+
+  const marketBlendEnabled = explicitBlendEnabled ?? true;
+
+  const marketWeight =
+    firstProbability(
+      forecastRecord.marketWeight,
+      forecastRecord.marketWeightUsed,
+      getAt(forecastRecord, ["model", "marketWeight"]),
+      getAt(forecastRecord, ["model", "marketWeightUsed"]),
+      getAt(forecastRecord, ["diagnostics", "marketWeight"]),
+      getAt(forecastRecord, ["diagnostics", "marketWeightUsed"]),
+      getAt(forecastRecord, ["diagnostics", "marketBlend", "weight"])
+    ) ?? null;
+
+  return {
+    marketBlendEnabled,
+    marketWeight
+  };
+}
+
+function getDisplayConfidence(params: {
+  forecastRecord: Record<string, unknown>;
+  outcomeProbabilities: Record<string, unknown>[];
+  warnings: string[];
+}): number | null {
+  const explicitConfidence = firstProbability(
+    params.forecastRecord.confidence,
+    getAt(params.forecastRecord, ["summary", "confidence"]),
+    getAt(params.forecastRecord, ["model", "confidence"]),
+    getAt(params.forecastRecord, ["diagnostics", "confidence"])
+  );
+
+  if (explicitConfidence !== null) {
+    return roundProbability(explicitConfidence);
+  }
+
+  const hasWeatherProbability = params.outcomeProbabilities.some(
+    (row) =>
+      firstProbability(row.weatherProbability, row.weatherFairProbability) !== null
+  );
+
+  const hasMarketProbability = params.outcomeProbabilities.some(
+    (row) => getMarketProbabilityFromRow(row) !== null
+  );
+
+  const hasFinalProbability = params.outcomeProbabilities.some(
+    (row) =>
+      firstProbability(row.finalProbability, row.blendedProbability, row.probability) !==
+      null
+  );
+
+  if (!hasWeatherProbability && !hasMarketProbability && !hasFinalProbability) {
+    return null;
+  }
+
+  const warningPenalty = Math.min(0.25, params.warnings.length * 0.05);
+
+  const derived =
+    0.25 +
+    (hasWeatherProbability ? 0.25 : 0) +
+    (hasMarketProbability ? 0.25 : 0) +
+    (hasFinalProbability ? 0.15 : 0) -
+    warningPenalty;
+
+  return roundProbability(Math.max(0.1, Math.min(0.9, derived)));
+}
+
+function buildMultiChannelForecastJson(
+  result: ForecastResult
+): Record<string, unknown> {
+  const resultRecord = recordOrEmpty(result);
+  const weatherRecord = recordOrEmpty(resultRecord.weather);
+  const marketRecord = recordOrEmpty(resultRecord.market);
+  const polymarketRecord = recordOrEmpty(resultRecord.polymarket);
+  const diagnosticsRecord = recordOrEmpty(resultRecord.diagnostics);
+
+  const rows = Array.isArray(resultRecord.outcomeProbabilities)
+    ? resultRecord.outcomeProbabilities.map((row) => recordOrEmpty(row))
+    : [];
+
+  return {
+    schemaVersion: "phase2.multi_channel_forecast_json.v1",
+    generatedAt: resultRecord.generatedAt ?? null,
+    hktDate:
+      firstString(
+        resultRecord.hktDate,
+        resultRecord.forecastDate,
+        resultRecord.date
+      ) ?? null,
+
+    outcomeUniverse: rows.map((row) => ({
+      name: row.name ?? null,
+      lower: row.lower ?? null,
+      upper: row.upper ?? null
+    })),
+
+    weatherChannels: {
+      hko: {
+        currentTempC:
+          resultRecord.hkoCurrentTempC ??
+          getAt(weatherRecord, ["current", "hkoCurrentTempC"]) ??
+          getAt(weatherRecord, ["currentTempC"]) ??
+          null,
+        maxSoFarC:
+          resultRecord.maxSoFarC ??
+          resultRecord.observedMaxSoFarC ??
+          resultRecord.observedFinalMaxLowerBoundC ??
+          null,
+        maxSinceMidnightC:
+          resultRecord.hkoMaxSinceMidnightC ??
+          getAt(weatherRecord, ["sinceMidnight", "maxTempC"]) ??
+          getAt(weatherRecord, ["maxSinceMidnightC"]) ??
+          null
+      },
+      openMeteo:
+        firstRecord(
+          weatherRecord.openMeteo,
+          weatherRecord.open_meteo,
+          resultRecord.openMeteo,
+          resultRecord.open_meteo,
+          getAt(diagnosticsRecord, ["sourceStatus", "openMeteo"])
+        ) ?? null,
+      windy:
+        firstRecord(
+          weatherRecord.windy,
+          resultRecord.windy,
+          getAt(diagnosticsRecord, ["sourceStatus", "windy"])
+        ) ?? null,
+      rain: {
+        rainfallMm:
+          weatherRecord.rainfallMm ??
+          weatherRecord.rainfall ??
+          getAt(weatherRecord, ["rain", "rainfallMm"]) ??
+          null,
+        cloudCover:
+          weatherRecord.cloudCover ??
+          weatherRecord.cloudCoverPct ??
+          getAt(weatherRecord, ["cloud", "cover"]) ??
+          getAt(weatherRecord, ["cloud", "coverPct"]) ??
+          null,
+        rainProbability:
+          weatherRecord.rainProbability ??
+          weatherRecord.rainProbabilityPct ??
+          getAt(weatherRecord, ["rain", "probability"]) ??
+          getAt(weatherRecord, ["rain", "probabilityPct"]) ??
+          null
+      }
+    },
+
+    marketChannels: {
+      gamma:
+        firstRecord(
+          marketRecord.gamma,
+          polymarketRecord.gamma,
+          resultRecord.gamma,
+          getAt(diagnosticsRecord, ["sourceStatus", "gamma"])
+        ) ?? null,
+      clob:
+        firstRecord(
+          marketRecord.clob,
+          polymarketRecord.clob,
+          resultRecord.clob,
+          getAt(diagnosticsRecord, ["sourceStatus", "clob"])
+        ) ?? null
+    },
+
+    outcomeProbabilities: rows.map((row) => ({
+      name: row.name ?? null,
+      lower: row.lower ?? null,
+      upper: row.upper ?? null,
+      weatherProbability:
+        firstProbability(row.weatherProbability, row.weatherFairProbability) ?? null,
+      marketProbability: getMarketProbabilityFromRow(row),
+      finalProbability:
+        firstProbability(row.finalProbability, row.blendedProbability, row.probability) ??
+        null,
+      gammaProbability: getGammaProbabilityFromRow(row),
+      clobBestBid: row.clobBestBid ?? null,
+      clobBestAsk: row.clobBestAsk ?? null,
+      clobMidpoint: row.clobMidpoint ?? null,
+      clobSpread: row.clobSpread ?? null,
+      edge: row.edge ?? null,
+      finalEdge: row.finalEdge ?? null
+    })),
+
+    topOutcome: resultRecord.topOutcome ?? null,
+    confidence: resultRecord.confidence ?? null,
+    diagnostics: resultRecord.diagnostics ?? null,
+    warnings: resultRecord.warnings ?? [],
+    diagnostics: diagnosticsRecord
+  };
+}
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
  index: number,
  probabilityContext: ProbabilityContext
): Record<string, unknown> {
  const row = recordOrEmpty(value);

  const name =
    firstString(row.name, row.outcome, row.label, row.title) ??
    `Outcome ${index + 1}`;

  const parsedRange = parseOutcomeRangeFromText(
    firstString(row.range, row.description, name) ?? name
  );

  const lower =
    firstNumber(
      row.lower,
      row.min,
      row.from,
      getAt(row, ["range", "lower"]),
      getAt(row, ["range", "from"])
    ) ?? parsedRange.lower;

  const upper =
    firstNumber(
      row.upper,
      row.max,
      row.to,
      getAt(row, ["range", "upper"]),
      getAt(row, ["range", "to"])
    ) ?? parsedRange.upper;

  const clob = getClobBidAskFromRow(row);
  const gammaProbability = getGammaProbabilityFromRow(row);
  const marketProbability = getMarketProbabilityFromRow(row);

  const explicitWeatherProbability = firstProbability(
    row.weatherFairProbability,
    row.weatherProbability,
    row.unblendedWeatherProbability,
    row.weatherModelProbability,
    row.rawWeatherProbability,
    getAt(row, ["weather", "fairProbability"]),
    getAt(row, ["weather", "probability"]),
    getAt(row, ["model", "weatherProbability"]),
    getAt(row, ["model", "fairProbability"])
  );

  const explicitFinalProbability = firstProbability(
    row.finalProbability,
    row.blendedProbability,
    row.combinedProbability,
    row.posteriorProbability,
    row.adjustedProbability,
    row.finalProbabilityPct,
    row.blendedProbabilityPct,
    row.combinedProbabilityPct,
    row.posteriorProbabilityPct,
    getAt(row, ["final", "probability"]),
    getAt(row, ["final", "probabilityPct"]),
    getAt(row, ["blend", "probability"]),
    getAt(row, ["blend", "probabilityPct"]),
    getAt(row, ["blended", "probability"]),
    getAt(row, ["blended", "probabilityPct"])
  );

  const genericProbability = firstProbability(
    row.probability,
    row.probabilityPct,
    row.modelProbability,
    row.modelProbabilityPct,
    row.forecastProbability,
    row.forecastProbabilityPct,
    getAt(row, ["model", "probability"]),
    getAt(row, ["model", "probabilityPct"])
  );

  /*
    Backward compatibility:
    If no explicit final probability exists, old engines usually put weather /
    model probability in row.probability.
  */
  const weatherProbability =
    explicitWeatherProbability ??
    (explicitFinalProbability === null ? genericProbability : null);

  const marketWeight =
    probabilityContext.marketBlendEnabled && probabilityContext.marketWeight !== null
      ? clampProbability(probabilityContext.marketWeight)
      : probabilityContext.marketBlendEnabled
        ? 0.35
        : 0;

  let finalProbability = explicitFinalProbability;
  let finalProbabilitySource = "explicit_final_probability";

  if (finalProbability === null) {
    if (
      probabilityContext.marketBlendEnabled &&
      weatherProbability !== null &&
      marketProbability !== null
    ) {
      finalProbability = roundProbability(
        (1 - marketWeight) * weatherProbability + marketWeight * marketProbability
      );
      finalProbabilitySource = "route_computed_weather_market_blend";
    } else {
      finalProbability = weatherProbability ?? marketProbability ?? genericProbability;
      finalProbabilitySource =
        weatherProbability !== null
          ? "weather_probability"
          : marketProbability !== null
            ? "market_probability"
            : genericProbability !== null
              ? "generic_probability"
              : "missing";
    }
  }

  const finalProbabilityRounded =
    finalProbability === null ? null : roundProbability(finalProbability);

  const weatherProbabilityRounded =
    weatherProbability === null ? null : roundProbability(weatherProbability);

  const marketProbabilityRounded =
    marketProbability === null ? null : roundProbability(marketProbability);

  const edgeBase = weatherProbabilityRounded ?? finalProbabilityRounded;

  const edge =
    edgeBase !== null && marketProbabilityRounded !== null
      ? edgeBase - marketProbabilityRounded
      : null;

  const finalEdge =
    finalProbabilityRounded !== null && marketProbabilityRounded !== null
      ? finalProbabilityRounded - marketProbabilityRounded
      : null;

  return {
    ...row,

    name,
    lower,
    upper,

    /*
      page.tsx legacy probability fields now map to final blended probability.
    */
    probability: finalProbabilityRounded,
    probabilityPct: probabilityToPct(finalProbabilityRounded),
    modelProbability: finalProbabilityRounded,
    modelProbabilityPct: probabilityToPct(finalProbabilityRounded),
    forecastProbability: finalProbabilityRounded,
    forecastProbabilityPct: probabilityToPct(finalProbabilityRounded),

    /*
      Phase 2 explicit probabilities.
    */
    weatherProbability: weatherProbabilityRounded,
    weatherFairProbability: weatherProbabilityRounded,
    weatherProbabilityPct: probabilityToPct(weatherProbabilityRounded),
    weatherFairProbabilityPct: probabilityToPct(weatherProbabilityRounded),

    marketProbability: marketProbabilityRounded,
    marketProbabilityPct: probabilityToPct(marketProbabilityRounded),
    polymarketProbability: marketProbabilityRounded,
    polymarketProbabilityPct: probabilityToPct(marketProbabilityRounded),

    finalProbability: finalProbabilityRounded,
    finalProbabilityPct: probabilityToPct(finalProbabilityRounded),
    blendedProbability: finalProbabilityRounded,
    blendedProbabilityPct: probabilityToPct(finalProbabilityRounded),

    gammaProbability,
    gammaProbabilityPct: probabilityToPct(gammaProbability),

    clobBestBid: clob.bid,
    clobBestAsk: clob.ask,
    clobMidpoint: clob.midpoint,
    clobSpread: clob.spread,

    marketBlendEnabled: probabilityContext.marketBlendEnabled,
    marketWeight,
    finalProbabilitySource,

    edge,
    edgePct: edge === null ? null : Math.round(edge * 10000) / 100,
    fairEdge: edge,
    fairEdgePct: edge === null ? null : Math.round(edge * 10000) / 100,
    finalEdge,
    finalEdgePct:
      finalEdge === null ? null : Math.round(finalEdge * 10000) / 100
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
  outcomeProbabilities: Record<string, unknown>[],
  observedMaxLowerBoundC: number | null
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

   return clampEstimatedFinalMaxC(
    {
      /*
        Prefer repaired outcome-derived distribution.
        This prevents stale raw forecast quantiles such as 22.5°C from winning
        after market/outcome repair has already produced a valid distribution.
      */
      p10: derived.p10 ?? p10,
      p25: derived.p25 ?? p25,
      median: derived.median ?? median,
      p50: derived.p50 ?? derived.median ?? median,
      p75: derived.p75 ?? p75,
      p90: derived.p90 ?? p90
    },
    observedMaxLowerBoundC
  );
}

function normalizeForecastResultForPage(
  forecast: Forecast,
  aiCommentary: AiCommentary,
  state: MarketState | null = null
): ForecastResult {
  
  const forecastRecord = recordOrEmpty(forecast);

  const observedMaxCandidate =
    getObservedMaxLowerBoundCandidate(forecastRecord);

  const observedMaxLowerBoundC = observedMaxCandidate?.value ?? null;

 const rawOutcomeBuild = buildRawOutcomeRows({
    forecastRecord,
    state
  });

  const rawOutcomes = rawOutcomeBuild.rows;

  const probabilityContext = getProbabilityContext(forecastRecord);

  const normalizedOutcomeRows = rawOutcomes.map((row, index) =>
    normalizeOutcomeForPage(row, index, probabilityContext)
  );

  const outcomeProbabilities = repairOutcomeProbabilitiesForObservedMax(
    normalizedOutcomeRows,
    observedMaxLowerBoundC
  );

  const estimatedFinalMaxC = buildEstimatedFinalMaxCForPage(
    forecastRecord,
    outcomeProbabilities,
    observedMaxLowerBoundC
  );

  const generatedAt =
    firstString(forecastRecord.generatedAt) ?? new Date().toISOString();

  const maxSoFarC = observedMaxLowerBoundC;

  const maxSoFarSource =
    observedMaxCandidate?.source ??
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
    ) ??
    (maxSoFarC !== null ? "Observed temperature fallback" : null);

  const weatherForDisplay = buildWeatherForDisplay({
    forecastRecord,
    observedMaxCandidate,
    maxSoFarC,
    maxSoFarSource
  });
  
 const hkoCurrentTempC = firstNumber(
    getAt(weatherForDisplay, ["current", "hkoCurrentTempC"]),
    getAt(weatherForDisplay, ["current", "currentTempC"]),
    getAt(weatherForDisplay, ["current", "currentTemperatureC"]),
    getAt(weatherForDisplay, ["current", "temperatureC"]),
    getAt(weatherForDisplay, ["current", "tempC"]),

    getAt(weatherForDisplay, ["hkoCurrentTempC"]),
    getAt(weatherForDisplay, ["currentTempC"]),
    getAt(weatherForDisplay, ["currentTemperatureC"]),
    getAt(weatherForDisplay, ["temperatureC"]),

    getAt(weatherForDisplay, ["hko", "currentTempC"]),
    getAt(weatherForDisplay, ["hko", "hkoCurrentTempC"]),

    forecastRecord.hkoCurrentTempC,
    forecastRecord.currentTempC,
    forecastRecord.currentTemperatureC,
    getAt(forecastRecord, ["hko", "currentTempC"]),
    getAt(forecastRecord, ["hko", "hkoCurrentTempC"])
  );

  const hkoMaxSinceMidnightC = firstNumber(
    getAt(weatherForDisplay, ["sinceMidnight", "maxTempC"]),
    getAt(weatherForDisplay, ["sinceMidnight", "maxTemperatureC"]),
    getAt(weatherForDisplay, ["sinceMidnight", "maxTemp"]),
    getAt(weatherForDisplay, ["sinceMidnight", "maxTemperature"]),

    getAt(weatherForDisplay, ["hkoMaxSinceMidnightC"]),
    getAt(weatherForDisplay, ["maxSinceMidnightC"]),
    getAt(weatherForDisplay, ["maxSoFarC"]),
    getAt(weatherForDisplay, ["observedMaxSoFarC"]),
    getAt(weatherForDisplay, ["observedMaxLowerBoundC"]),
    getAt(weatherForDisplay, ["observedFinalMaxLowerBoundC"]),

    getAt(weatherForDisplay, ["hko", "maxSinceMidnightC"]),
    getAt(weatherForDisplay, ["hko", "hkoMaxSinceMidnightC"]),

    forecastRecord.hkoMaxSinceMidnightC,
    forecastRecord.maxSinceMidnightC,
    forecastRecord.maxSoFarC,
    forecastRecord.observedMaxSoFarC,
    forecastRecord.observedMaxLowerBoundC,
    forecastRecord.observedFinalMaxLowerBoundC,

    maxSoFarC
  );
 const calculatedTopOutcome =
    [...outcomeProbabilities].sort(
      (a, b) =>
        (firstProbability(b.finalProbability, b.blendedProbability, b.probability) ??
          -Infinity) -
        (firstProbability(a.finalProbability, a.blendedProbability, a.probability) ??
          -Infinity)
    )[0] ?? null;

  const topOutcome = calculatedTopOutcome ?? forecastRecord.topOutcome ?? null;

  const keyDrivers =
    stringArray(forecastRecord.keyDrivers) ??
    stringArray(getAt(forecastRecord, ["summary", "keyDrivers"])) ??
    stringArray(getAt(forecastRecord, ["diagnostics", "keyDrivers"])) ??
    [];

  const sourceStatus = buildSourceStatus({
    forecastRecord,
    weatherForDisplay
  });

  const warnings = collectWarnings({
    forecastRecord,
    weatherForDisplay,
    sourceStatus
  });

  const confidence = getDisplayConfidence({
    forecastRecord,
    outcomeProbabilities,
    warnings
  });

  const aiExplanation = getAiExplanationText(aiCommentary);

  const model = {
    ...recordOrEmpty(forecastRecord.model),
    estimatedFinalMaxC,
    estimatedFinalDailyMaxC: estimatedFinalMaxC,
    estimatedFinalDailyMax: estimatedFinalMaxC,
    percentiles: estimatedFinalMaxC,
    quantiles: estimatedFinalMaxC,
    confidence,
    marketBlendEnabled: probabilityContext.marketBlendEnabled,
    marketWeight: probabilityContext.marketWeight
  };

  const diagnostics = {
    ...recordOrEmpty(forecastRecord.diagnostics),
    phase2RoutePatch: true,
    aiInputMode: "multi_channel_forecast_json",
    outcomeUniverseSource: rawOutcomeBuild.source,
    probabilitySemantics: {
      probability:
        "Legacy page alias for finalProbability / blendedProbability in Phase 2.",
      weatherProbability: "Weather-only fair probability.",
      marketProbability:
        "Polymarket probability, preferring CLOB midpoint over Gamma price when available.",
      finalProbability:
        "Final blended probability after weather/market blend and observed max repair."
    },
    marketBlendEnabled: probabilityContext.marketBlendEnabled,
    marketWeight: probabilityContext.marketWeight,
    confidence,
    warnings,
    sourceStatus,
    estimatedFinalMaxC,
    estimatedFinalDailyMaxC: estimatedFinalMaxC,
    estimatedFinalDailyMax: estimatedFinalMaxC,
    percentiles: estimatedFinalMaxC,
    quantiles: estimatedFinalMaxC,
    maxSoFarC,
    maxSoFarSource,
    observedMaxSoFarC: maxSoFarC,
    observedMaxSoFarSource: maxSoFarSource,
    observedFinalMaxLowerBoundC: maxSoFarC,
    observedFinalMaxLowerBoundSource: maxSoFarSource,
    observedFinalMaxLowerBoundPath: observedMaxCandidate?.path ?? null,
    sourceDiagnostics: {
      ...recordOrEmpty(getAt(forecastRecord, ["diagnostics", "sourceDiagnostics"])),
      observedFinalMaxLowerBound: {
        valueC: maxSoFarC,
        source: maxSoFarSource,
        path: observedMaxCandidate?.path ?? null,
        rule:
          "finalDailyMax >= max(HKO max since midnight, HKO current temperature, observed max so far)"
      }
    }
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

    observedMaxSoFarC: maxSoFarC,
    observedMaxSoFarSource: maxSoFarSource,

    observedMaxLowerBoundC: maxSoFarC,
    observedMaxLowerBoundSource: maxSoFarSource,
    observedFinalMaxLowerBoundC: maxSoFarC,
    observedFinalMaxLowerBoundSource: maxSoFarSource,

    hkoCurrentTempC,
    hkoMaxSinceMidnightC,

    hko: {
      ...recordOrEmpty(forecastRecord.hko),
      ...recordOrEmpty(getAt(weatherForDisplay, ["hko"])),
      currentTempC: hkoCurrentTempC,
      hkoCurrentTempC,
      maxSinceMidnightC: hkoMaxSinceMidnightC,
      hkoMaxSinceMidnightC,
      observedMaxLowerBoundC: maxSoFarC,
      observedFinalMaxLowerBoundC: maxSoFarC
    },

     aiExplanation,
    keyDrivers,
    warnings,
    confidence,

    /*
      Compatibility aliases.
      IMPORTANT:
      Do not expose rawOutcomes as outcomes, because page.tsx may read
      forecast.outcomes directly. Expose repaired normalized rows instead.
    */
    rawOutcomes,
    outcomeUniverseSource: rawOutcomeBuild.source,
    outcomes: outcomeProbabilities,
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
    weather: weatherForDisplay,
    model,
    diagnostics
  } as unknown as ForecastResult;
}

function buildResultForHistory(
  forecast: Forecast,
  aiCommentary: AiCommentary,
  state: MarketState | null = null
): ForecastResult {
  /*
    Save the normalized result shape too, so history display can use:
      row.result.outcomeProbabilities
      row.result.estimatedFinalMaxC
      row.result.maxSoFarC
  */
  return normalizeForecastResultForPage(forecast, aiCommentary, state);
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
      params.aiCommentary,
      params.state
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
  state?: MarketState | null;
}) {
  /*
    Normalize into the exact shape page.tsx expects.
  */
  const resultForDisplay = normalizeForecastResultForPage(
    params.forecast,
    params.aiCommentary,
    params.state ?? null
  );

  const resultRecord = resultForDisplay as unknown as Record<string, unknown>;

  const generatedAt =
    firstString(resultRecord.generatedAt) ?? new Date().toISOString();

  const aiExplanation =
    firstString(resultRecord.aiExplanation) ??
    getAiExplanationText(params.aiCommentary);

  const weatherForDisplay = (resultRecord.weather ??
    (params.forecast as Forecast & { weather?: unknown }).weather ??
    {}) as HkoWeatherSnapshot;

   const multiChannelForecastJson =
    buildMultiChannelForecastJson(resultForDisplay);
  const data = {
    ...resultRecord,

    /*
      Main aliases expected by page.tsx.
    */
    result: resultForDisplay,
    forecast: resultForDisplay,
    weather: weatherForDisplay,
    multiChannelForecastJson,
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

    observedMaxLowerBoundC:
      resultRecord.observedMaxLowerBoundC ??
      resultRecord.observedFinalMaxLowerBoundC ??
      resultRecord.maxSoFarC ??
      null,

    observedFinalMaxLowerBoundC:
      resultRecord.observedFinalMaxLowerBoundC ??
      resultRecord.observedMaxLowerBoundC ??
      resultRecord.maxSoFarC ??
      null,

    hkoCurrentTempC:
      resultRecord.hkoCurrentTempC ??
      getAt(weatherForDisplay, ["current", "hkoCurrentTempC"]) ??
      getAt(weatherForDisplay, ["hkoCurrentTempC"]) ??
      getAt(weatherForDisplay, ["currentTempC"]) ??
      null,

    hkoMaxSinceMidnightC:
      resultRecord.hkoMaxSinceMidnightC ??
      getAt(weatherForDisplay, ["sinceMidnight", "maxTempC"]) ??
      getAt(weatherForDisplay, ["hkoMaxSinceMidnightC"]) ??
      getAt(weatherForDisplay, ["maxSinceMidnightC"]) ??
      resultRecord.maxSoFarC ??
      null,

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
      /*
        Give Poe the same normalized / repaired data that the UI sees.
        Otherwise Poe may analyse raw missing / impossible probabilities.
      */
      const normalizedForAi = normalizeForecastResultForPage(
        forecast,
        null,
        options.state ?? null
      );

      const forecastForAi = {
        ...(normalizedForAi as unknown as Record<string, unknown>),
        aiInputMode: "multi_channel_forecast_json",
        multiChannelForecastJson: buildMultiChannelForecastJson(normalizedForAi),
        diagnostics: {
          ...recordOrEmpty(
            (normalizedForAi as unknown as Record<string, unknown>).diagnostics
          ),
          aiInputMode: "multi_channel_forecast_json",
          poeInstruction:
            "Use only the supplied outcomeUniverse and outcomeProbabilities. Do not invent buckets such as '22°C or higher' unless it appears in outcomeUniverse."
        }
      } as unknown as Forecast;

      aiCommentary = await getPoeForecastCommentary(forecastForAi);

      /*
        If poe.ts returns null / empty instead of throwing,
        show a useful diagnostic rather than silently showing:
        "AI explanation disabled or not available."
      */
      if (!getAiExplanationText(aiCommentary)) {
        aiCommentary = {
          explanation:
            "Poe AI explanation returned no content. Check your Poe environment variable and src/lib/poe.ts return shape."
        };
      }
    } catch (error) {
      console.error("Poe AI commentary error:", error);

      aiCommentary = {
        explanation:
          error instanceof Error
            ? `Poe AI explanation failed: ${error.message}`
            : "Poe AI explanation failed."
      };
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
    historySave,
    state: options.state ?? null
  });

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

    const marketWeightOverride =
      parseNumber(url.searchParams.get("marketWeight")) ??
      parseNumber(url.searchParams.get("marketWeightOverride"));

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
