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
  return {
    lower: firstNumber(row.lower),
    upper: firstNumber(row.upper)
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
  const modelProbability =
    probability === null ? null : roundProbability(probability);

  const modelProbabilityPct = probabilityToPct(modelProbability);

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

  const marketProbabilityPct = probabilityToPct(marketProbability);

  const edge =
    modelProbability !== null && marketProbability !== null
      ? modelProbability - marketProbability
      : null;

  const edgePct = edge === null ? null : Math.round(edge * 10000) / 100;

  return {
    ...row,
    ...extra,

    /*
      page.tsx model probability shape.
    */
    probability: modelProbability,
    probabilityPct: modelProbabilityPct,

    /*
      Explicit aliases.
    */
    modelProbability,
    modelProbabilityPct,
    weatherProbability: modelProbability,
    weatherProbabilityPct: modelProbabilityPct,
    forecastProbability: modelProbability,
    forecastProbabilityPct: modelProbabilityPct,

    /*
      Preserve / normalize market side too.
    */
    marketProbability,
    marketProbabilityPct,
    polymarketProbability: marketProbability,
    polymarketProbabilityPct: marketProbabilityPct,

    edge,
    edgePct
  };
}

function repairOutcomeProbabilitiesForObservedMax(
  rows: Record<string, unknown>[],
  observedMaxC: number | null
): Record<string, unknown>[] {
  if (observedMaxC === null) {
    return rows.map((row) => {
      const probability = probabilityFromValue(row.probability);

      return probability === null
        ? row
        : setModelProbabilityOnRow(row, probability);
    });
  }

  const observedBucketIndex = rows.findIndex((row) =>
    outcomeContainsObservedMax(row, observedMaxC)
  );

  let movedImpossibleMass = 0;

  const repaired = rows.map((row) => {
    const probability = probabilityFromValue(row.probability);
    const impossibleByObservedMax = isOutcomeImpossibleByObservedMax(
      row,
      observedMaxC
    );

    if (impossibleByObservedMax) {
      if (probability !== null) {
        movedImpossibleMass += Math.max(0, probability);
      }

      return setModelProbabilityOnRow(row, 0, {
        impossibleByObservedMax: true,
        observedMaxLowerBoundC: observedMaxC,
        modelProbabilityRepair:
          "Set to 0 because observed max already exceeds this bucket."
      });
    }

    return {
      ...row,
      impossibleByObservedMax: false,
      observedMaxLowerBoundC: observedMaxC
    };
  });

  if (
    movedImpossibleMass > PROBABILITY_EPSILON &&
    observedBucketIndex >= 0
  ) {
    const currentObservedBucketProbability =
      probabilityFromValue(repaired[observedBucketIndex].probability) ?? 0;

    repaired[observedBucketIndex] = setModelProbabilityOnRow(
      repaired[observedBucketIndex],
      currentObservedBucketProbability + movedImpossibleMass,
      {
        modelProbabilityRepair:
          "Received probability mass from buckets made impossible by observed max."
      }
    );
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
    return repaired.map((row, index) => {
      if (row.impossibleByObservedMax === true) {
        return row;
      }

      return setModelProbabilityOnRow(row, index === observedBucketIndex ? 1 : 0, {
        modelProbabilityRepair:
          index === observedBucketIndex
            ? "Fallback 100% to bucket containing observed max because model probabilities were missing."
            : "Fallback 0% because model probabilities were missing."
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
  const sinceMidnightRecord = recordOrEmpty(weatherRecord.sinceMidnight);

  const existingSinceMidnightMaxC = firstNumber(
    sinceMidnightRecord.maxTempC,
    sinceMidnightRecord.maxTemperatureC,
    sinceMidnightRecord.maxTemp,
    sinceMidnightRecord.maxTemperature
  );

  const existingSinceMidnightMinC = firstNumber(
    sinceMidnightRecord.minTempC,
    sinceMidnightRecord.minTemperatureC,
    sinceMidnightRecord.minTemp,
    sinceMidnightRecord.minTemperature
  );

  const displaySinceMidnightMaxC = existingSinceMidnightMaxC ?? maxSoFarC;

  const sinceMidnightMaxSource =
    existingSinceMidnightMaxC !== null
      ? firstString(
          sinceMidnightRecord.maxTempSource,
          sinceMidnightRecord.source
        ) ?? "HKO max since midnight"
      : maxSoFarC !== null
        ? `${maxSoFarSource ?? "observed temperature"} fallback`
        : null;

  return {
    ...weatherRecord,

    maxSoFarC,
    maxSoFarSource,
    observedMaxSoFarC: maxSoFarC,
    observedMaxSoFarSource: maxSoFarSource,

    /*
      These aliases help frontend cards even if original weather shape differs.
    */
    hkoMaxSinceMidnightC: displaySinceMidnightMaxC,
    hkoMinSinceMidnightC: existingSinceMidnightMinC,

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
      }
    }
  };
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

  return {
    p10,
    p25,
    median,
    p50: median,
    p75,
    p90
 },
    observedMaxLowerBoundC
  );
}

function normalizeForecastResultForPage(
  forecast: Forecast,
  aiCommentary: AiCommentary
): ForecastResult {
  const forecastRecord = recordOrEmpty(forecast);

  const observedMaxCandidate =
    getObservedMaxLowerBoundCandidate(forecastRecord);

  const observedMaxLowerBoundC = observedMaxCandidate?.value ?? null;

  const rawOutcomes = Array.isArray(forecastRecord.outcomes)
    ? forecastRecord.outcomes
    : Array.isArray(forecastRecord.probabilities)
      ? forecastRecord.probabilities
      : Array.isArray(forecastRecord.outcomeProbabilities)
        ? forecastRecord.outcomeProbabilities
        : [];

  const normalizedOutcomeRows = rawOutcomes.map(normalizeOutcomeForPage);

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
    observedFinalMaxLowerBoundC: maxSoFarC,
    observedFinalMaxLowerBoundSource: maxSoFarSource,
    aiExplanation,
    keyDrivers,
    warnings,

    /*
      Compatibility aliases.
      IMPORTANT:
      Do not expose rawOutcomes as outcomes, because page.tsx may read
      forecast.outcomes directly. Expose repaired normalized rows instead.
    */
    rawOutcomes,
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
    (params.forecast as Forecast & { weather?: unknown }).weather ??
    {}) as HkoWeatherSnapshot;

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
      /*
        Give Poe the same normalized / repaired data that the UI sees.
        Otherwise Poe may analyse raw missing / impossible probabilities.
      */
      const forecastForAi = normalizeForecastResultForPage(
        forecast,
        null
      ) as unknown as Forecast;

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
