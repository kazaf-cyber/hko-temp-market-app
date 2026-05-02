import {
  getMultiChannelSnapshot,
  type MultiChannelSnapshot
} from "@/lib/multichannel";
import { getMarketState } from "@/lib/state";
import type { MarketState, OutcomeRange } from "@/types";

export const FORECAST_ENGINE_VERSION = "multi-channel-v2.1.0";

type SourceError = {
  source: string;
  message: string;
};

type MarketStateLike = {
  title?: unknown;
  question?: unknown;
  slug?: unknown;
  eventSlug?: unknown;
  conditionId?: unknown;
  marketId?: unknown;
  outcomes?: unknown;
  updatedAt?: unknown;
  fetchedAt?: unknown;
  [key: string]: unknown;
};

type ClobRow =
  NonNullable<MultiChannelSnapshot["polymarketClob"]>["outcomes"][number];

export type ForecastWeatherInputs = {
  forecastTargetDate: string;
  hongKongHour: number;
  timeBand: "overnight" | "morning" | "midday" | "afternoon" | "evening";
  remainingSettlementHours: number;

  /*
    HKO observed temperature signals.
  */
  hkoCurrentTempC: number | null;
  currentTempC: number | null;
  currentTemperatureC: number | null;

  observedMaxC: number | null;
  observedMaxSoFarC: number | null;
  observedMaxLowerBoundC: number | null;
  observedFinalMaxLowerBoundC: number | null;

  hkoMaxSoFarC: number | null;
  hkoMaxSinceMidnightC: number | null;
  maxSinceMidnightC: number | null;
  maxSoFarC: number | null;

  hkoMinSinceMidnightC: number | null;
  minSinceMidnightC: number | null;
  observedMinC: number | null;
  observedMinSoFarC: number | null;
  minSoFarC: number | null;

  /*
    HKO official forecast max.
    This is forecast, not observation. It must not be used as an observed lower bound.
  */
  officialForecastMaxC: number | null;
  hkoOfficialForecastMaxC: number | null;
  forecastMaxC: number | null;
  hkoForecastMaxC: number | null;

  /*
    HKO rainfall aliases.
  */
  observedHourlyRainfallMm: number | null;
  hourlyRainfallMm: number | null;
  rainfallLastHourMm: number | null;
  rainfallPastHourMm: number | null;
  rainHourlyMm: number | null;
  rainfallMm: number | null;

  openMeteoCurrentTempC: number | null;
  openMeteoRemainingDayMaxC: number | null;
  windyRemainingDayMaxC: number | null;

  modelFutureMeanC: number | null;
  coolingAdjustmentC: number;
  adjustedFutureMeanC: number | null;

  forecastFinalMaxMeanC: number | null;
  forecastFinalMaxStdDevC: number;

  rainProbabilityNext2hPct: number | null;
  cloudCoverNowPct: number | null;

  modelDisagreementC: number | null;
  sourceCount: number;
  adjustmentReasons: string[];
};

export type ForecastOutcome = OutcomeRange & {
  index: number;
  rank: number;

  lower: number | null;
  upper: number | null;

  /*
    Legacy / final probability aliases.
  */
  probability: number;
  probabilityPct: number;

  modelProbability: number;
  modelProbabilityPct: number;

  forecastProbability: number;
  forecastProbabilityPct: number;

  finalProbability: number;
  finalProbabilityPct: number;

  blendedProbability: number;
  blendedProbabilityPct: number;

  /*
    Weather fair probability.
  */
  weatherProbability: number;
  weatherProbabilityPct: number;
  weatherFairProbability: number;
  weatherFairProbabilityPct: number;

  /*
    Market probability.
  */
  marketProbability: number | null;
  marketProbabilityPct: number | null;
  polymarketProbability: number | null;
  polymarketProbabilityPct: number | null;

  marketRawPrice: number | null;

  clobMidpoint: number | null;
  clobSpread: number | null;
  clobBuyPrice: number | null;
  clobSellPrice: number | null;

  clobBestBid: number | null;
  clobBestAsk: number | null;
  bestBid: number | null;
  bestAsk: number | null;

  gammaPrice: number | null;
  gammaProbability: number | null;
  gammaProbabilityPct: number | null;

  edge: number | null;
  edgePct: number | null;
  fairEdge: number | null;
  fairEdgePct: number | null;
  finalEdge: number | null;
  finalEdgePct: number | null;

  isImpossibleByObservedMax: boolean;
  impossibleByObservedMax: boolean;
  observedMaxLowerBoundC: number | null;

  explanationFactors: string[];
};

export type ForecastResult = {
  version: typeof FORECAST_ENGINE_VERSION;
  generatedAt: string;

  hktDate: string;
  forecastDate: string;
  date: string;

  market: {
    loaded: boolean;
    title: string | null;
    slug: string | null;
    eventSlug: string | null;
    conditionId: string | null;
    marketId: string | null;
    outcomeCount: number;
    updatedAt: string | null;
    fetchedAt: string | null;
    error: string | null;
  };

  /*
    Top-level weather aliases for old UI / route fallback.
  */
  hkoCurrentTempC: number | null;
  currentTempC: number | null;
  currentTemperatureC: number | null;

  observedMaxC: number | null;
  observedMaxSoFarC: number | null;
  observedMaxLowerBoundC: number | null;
  observedFinalMaxLowerBoundC: number | null;

  hkoMaxSoFarC: number | null;
  hkoMaxSinceMidnightC: number | null;
  maxSinceMidnightC: number | null;
  maxSoFarC: number | null;

  hkoMinSinceMidnightC: number | null;
  minSinceMidnightC: number | null;
  observedMinC: number | null;
  observedMinSoFarC: number | null;
  minSoFarC: number | null;

  officialForecastMaxC: number | null;
  hkoOfficialForecastMaxC: number | null;
  forecastMaxC: number | null;
  hkoForecastMaxC: number | null;

  observedHourlyRainfallMm: number | null;
  hourlyRainfallMm: number | null;
  rainfallLastHourMm: number | null;
  rainfallPastHourMm: number | null;
  rainHourlyMm: number | null;
  rainfallMm: number | null;

  weather: ForecastWeatherInputs;

  model: {
    method: "same-day-temperature-distribution-with-market-blend";
    rangeConvention: "lower-inclusive-upper-exclusive";
    marketBlendEnabled: boolean;
    marketWeight: number;
    marketCoverage: number;
    averageClobSpread: number | null;
    confidenceScore: number;
    confidenceLabel: "low" | "medium" | "high";
  };

  confidence: number;
  confidenceLabel: "low" | "medium" | "high";

  outcomes: ForecastOutcome[];
  probabilities: ForecastOutcome[];
  outcomeProbabilities: ForecastOutcome[];
  topOutcome: ForecastOutcome | null;

  keyDrivers: string[];
  warnings: string[];

  summary: string;

  diagnostics: {
  sourceStatus: {
    hko: boolean;
    openMeteo: boolean;
    windy: boolean;
    polymarketClob: boolean;
  };
  sourceErrors: SourceError[];
  marketStateError: string | null;
  noEligibleOutcomes: boolean;

  marketProbabilitiesAvailable: boolean;
  marketEvaluatedOutcomeCount: number;
  marketValidCount: number;
  marketCoverage: number;
  marketWeight: number;
  averageClobSpread: number | null;

  assumptions: string[];

    hkoCurrentTempC: number | null;
    hkoMaxSinceMidnightC: number | null;
    hkoMinSinceMidnightC: number | null;
    officialForecastMaxC: number | null;
    hourlyRainfallMm: number | null;
    observedMaxLowerBoundC: number | null;

    keyDrivers: string[];
    warnings: string[];
  };

  multiChannel?: MultiChannelSnapshot;
};

export type GetForecastOptions = {
  includeClob?: boolean;
  blendMarket?: boolean;
  includeRawSnapshot?: boolean;
  marketWeightOverride?: number;
  now?: Date;

  /*
    Allow route.ts POST body.state to override DB/default state.
    Without this, the forecast engine ignores the state supplied by the UI.
  */
  state?: MarketState | null;

  /*
    Optional Polymarket event URL/slug fallback for hydrating token IDs/prices.
  */
  polymarketUrl?: string | null;
};

type PreparedOutcome = {
  index: number;
  outcome: OutcomeRange;
  lower: number | null;
  upper: number | null;
  impossible: boolean;
  weatherScore: number;
  marketRawPrice: number | null;
  clob: ClobRow | null;
  explanationFactors: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const cleaned = trimmed.replace(/,/g, "").replace(/%$/g, "");
    const parsed = Number(cleaned);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundNumber(
  value: number | null | undefined,
  digits = 2
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function maxNumber(values: unknown[]): number | null {
  const nums = values
    .map(asNumber)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value)
    );

  return nums.length > 0 ? Math.max(...nums) : null;
}

function minNumber(values: unknown[]): number | null {
  const nums = values
    .map(asNumber)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value)
    );

  return nums.length > 0 ? Math.min(...nums) : null;
}

function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function firstNumberAtPaths(value: unknown, paths: string[][]): number | null {
  return firstNumber(paths.map((path) => getAt(value, path)));
}

function weightedAverage(
  values: Array<{
    value: number | null;
    weight: number;
  }>
): number | null {
  let numerator = 0;
  let denominator = 0;

  for (const item of values) {
    if (item.value === null || !Number.isFinite(item.value)) continue;
    if (!Number.isFinite(item.weight) || item.weight <= 0) continue;

    numerator += item.value * item.weight;
    denominator += item.weight;
  }

  if (denominator <= 0) return null;
  return numerator / denominator;
}

function normalizePrice(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  if (parsed < 0) return null;

  if (parsed <= 1) {
    return clamp(parsed, 0, 1);
  }

  if (parsed <= 100) {
    return clamp(parsed / 100, 0, 1);
  }

  return null;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function getStringFields(value: unknown, keys: string[]) {
  if (!isRecord(value)) return [];

  const results: string[] = [];

  for (const key of keys) {
    const parsed = asString(value[key]);

    if (parsed && !results.includes(parsed)) {
      results.push(parsed);
    }
  }

  return results;
}

function getFirstNormalizedPriceField(value: unknown, keys: string[]) {
  if (!isRecord(value)) return null;

  for (const key of keys) {
    const parsed = normalizePrice(value[key]);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function getOutcomeTokenIds(outcome: OutcomeRange) {
  return getStringFields(outcome, [
    "clobTokenId",
    "tokenId",
    "yesTokenId",
    "assetId",
    "yesAssetId"
  ]);
}

function getClobYesTokenIds(item: ClobRow) {
  /*
    Phase 1 CLOB rows may expose yesTokenId/noTokenId instead of tokenId.
    For a temperature-range outcome, we want the YES-side token when available.
    Name matching remains the main fallback, so we intentionally do not map noTokenId
    to avoid accidentally treating a NO token as a YES probability.
  */
  return getStringFields(item, [
    "tokenId",
    "clobTokenId",
    "yesTokenId",
    "assetId",
    "yesAssetId"
  ]);
}

function getOutcomeGammaPrice(outcome: OutcomeRange) {
  return getFirstNormalizedPriceField(outcome, [
    /*
      Normalized market probability aliases.
      Accept both 0..1 and 0..100 because normalizePrice() handles both.
    */
    "marketProbability",
    "marketProbabilityPct",
    "polymarketProbability",
    "polymarketProbabilityPct",

    /*
      Gamma / legacy price aliases.
    */
    "marketPrice",
    "price",
    "yesPrice",
    "lastPrice",
    "gammaProbability",
    "gammaProbabilityPct",
    "gammaPrice",
    "gammaYesPrice",
    "gammaLastPrice"
  ]);
}

function getClobMidpoint(value: unknown) {
  return getFirstNormalizedPriceField(value, [
    /*
      Names used by route.ts / UI normalization.
    */
    "clobMidpoint",
    "clobMid",

    /*
      Generic CLOB aliases.
    */
    "midpoint",
    "mid",
    "midPrice",
    "markPrice"
  ]);
}

function getClobBuyPrice(value: unknown) {
  return getFirstNormalizedPriceField(value, [
    /*
      Names used by route.ts / UI normalization.
    */
    "clobBestBid",

    /*
      Generic bid aliases.
    */
    "bestBid",
    "bestBidPrice",
    "bid",
    "buyPrice",
    "yesBid",
    "yesBestBid",
    "yesBestBidPrice"
  ]);
}

function getClobSellPrice(value: unknown) {
  return getFirstNormalizedPriceField(value, [
    /*
      Names used by route.ts / UI normalization.
    */
    "clobBestAsk",

    /*
      Generic ask aliases.
    */
    "bestAsk",
    "bestAskPrice",
    "ask",
    "sellPrice",
    "yesAsk",
    "yesBestAsk",
    "yesBestAskPrice"
  ]);
}

function getClobSpread(value: unknown) {
  const directSpread = getFirstNormalizedPriceField(value, [
    /*
      Names used by route.ts / UI normalization.
    */
    "clobSpread",

    /*
      Generic spread aliases.
    */
    "spread",
    "bidAskSpread",
    "bestBidAskSpread"
  ]);

  if (directSpread !== null) {
    return directSpread;
  }

  const buyPrice = getClobBuyPrice(value);
  const sellPrice = getClobSellPrice(value);

  if (buyPrice !== null && sellPrice !== null) {
    return Math.max(0, sellPrice - buyPrice);
  }

  return null;
}

function getClobGammaPrice(value: unknown) {
  return getFirstNormalizedPriceField(value, [
    /*
      Gamma aliases.
    */
    "gammaProbability",
    "gammaProbabilityPct",
    "gammaYesPrice",
    "gammaPrice",
    "gammaLastPrice",

    /*
      General Polymarket / market aliases.
    */
    "marketProbability",
    "marketProbabilityPct",
    "polymarketProbability",
    "polymarketProbabilityPct",
    "marketPrice",
    "yesPrice",
    "price",
    "lastPrice"
  ]);
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
        asString(item.place) ??
          asString(item.station) ??
          asString(item.name) ??
          asString(item.automaticWeatherStation) ??
          asString(item.automatic_weather_station)
      )
    ) ?? null;

  if (!hkoRecord) {
    return null;
  }

  return firstNumber([
    hkoRecord.value,
    hkoRecord.temp,
    hkoRecord.temperature,
    hkoRecord.temperatureC,
    hkoRecord.airTemperature,
    hkoRecord.airTemperatureC
  ]);
}

function getRainfallMmFromObservationArray(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const records = value.filter(isRecord);

  if (!records.length) {
    return null;
  }

  const hkoRecord =
    records.find((item) =>
      isHkoStationName(
        asString(item.place) ??
          asString(item.station) ??
          asString(item.name) ??
          asString(item.automaticWeatherStation) ??
          asString(item.automatic_weather_station)
      )
    ) ?? null;

  if (hkoRecord) {
    const hkoRainfall = firstNumber([
      hkoRecord.value,
      hkoRecord.amount,
      hkoRecord.rainfall,
      hkoRecord.rainfallMm,
      hkoRecord.hourlyRainfallMm,
      hkoRecord.max,
      hkoRecord.min
    ]);

    if (hkoRainfall !== null) {
      return hkoRainfall;
    }
  }

  const values = records
    .map((item) =>
      firstNumber([
        item.max,
        item.value,
        item.amount,
        item.rainfall,
        item.rainfallMm,
        item.hourlyRainfallMm,
        item.min
      ])
    )
    .filter((item): item is number => item !== null);

  if (!values.length) {
    return null;
  }

  /*
    HKO rainfall array is often district-based. For a compact dashboard card,
    the most useful fallback is the highest observed hourly rainfall.
  */
  return Math.max(...values);
}

function getHkoCurrentTempC(snapshot: MultiChannelSnapshot): number | null {
  return firstNumber([
    getAt(snapshot, ["derived", "hkoCurrentTempC"]),

    getAt(snapshot, ["hko", "current", "hkoCurrentTempC"]),
    getAt(snapshot, ["hko", "current", "currentTempC"]),
    getAt(snapshot, ["hko", "current", "currentTemperatureC"]),
    getAt(snapshot, ["hko", "current", "tempC"]),
    getAt(snapshot, ["hko", "current", "temperatureC"]),
    getAt(snapshot, ["hko", "current", "temperature"]),
    getAt(snapshot, ["hko", "current", "temperature", "value"]),
    getAt(snapshot, ["hko", "current", "airTemperatureC"]),
    getAt(snapshot, ["hko", "current", "airTemperature"]),

    getAt(snapshot, ["hko", "hkoCurrentTempC"]),
    getAt(snapshot, ["hko", "currentTempC"]),
    getAt(snapshot, ["hko", "currentTemperatureC"]),
    getAt(snapshot, ["hko", "temperatureC"]),
    getAt(snapshot, ["hko", "temperature"]),
    getAt(snapshot, ["hko", "temperature", "value"]),

    getHkoTemperatureFromObservationArray(
      getAt(snapshot, ["hko", "temperature", "data"])
    ),
    getHkoTemperatureFromObservationArray(
      getAt(snapshot, ["hko", "current", "temperature", "data"])
    ),
    getHkoTemperatureFromObservationArray(
      getAt(snapshot, ["hko", "raw", "temperature", "data"])
    )
  ]);
}

function getHkoMaxSinceMidnightC(
  snapshot: MultiChannelSnapshot,
  hkoCurrentTempC: number | null
): number | null {
  /*
    multichannel.ts currently sets derived.hkoMaxSoFarC to:
      hko.sinceMidnight?.maxTempC ?? hkoCurrentTempC

    We still check raw paths first / alongside it to make this robust.
  */
  return maxNumber([
    getAt(snapshot, ["derived", "hkoMaxSoFarC"]),
    getAt(snapshot, ["derived", "hkoMaxSinceMidnightC"]),
    getAt(snapshot, ["derived", "maxSinceMidnightC"]),
    getAt(snapshot, ["derived", "observedMaxC"]),
    getAt(snapshot, ["derived", "observedMaxSoFarC"]),

    getAt(snapshot, ["hko", "sinceMidnight", "maxTempC"]),
    getAt(snapshot, ["hko", "sinceMidnight", "maxTemperatureC"]),
    getAt(snapshot, ["hko", "sinceMidnight", "maxTemp"]),
    getAt(snapshot, ["hko", "sinceMidnight", "maxTemperature"]),

    getAt(snapshot, ["hko", "hkoMaxSinceMidnightC"]),
    getAt(snapshot, ["hko", "maxSinceMidnightC"]),
    getAt(snapshot, ["hko", "hkoMaxSoFarC"]),
    getAt(snapshot, ["hko", "maxSoFarC"]),
    getAt(snapshot, ["hko", "observedMaxC"]),
    getAt(snapshot, ["hko", "observedMaxSoFarC"]),

    getAt(snapshot, ["hko", "current", "maxSoFarC"]),
    getAt(snapshot, ["hko", "current", "todayMax"]),
    getAt(snapshot, ["hko", "current", "maxTemperature"]),
    getAt(snapshot, ["hko", "current", "maxTemperatureC"]),

    hkoCurrentTempC
  ]);
}

function getHkoMinSinceMidnightC(
  snapshot: MultiChannelSnapshot
): number | null {
  return minNumber([
    getAt(snapshot, ["derived", "hkoMinSinceMidnightC"]),
    getAt(snapshot, ["derived", "minSinceMidnightC"]),
    getAt(snapshot, ["derived", "observedMinC"]),
    getAt(snapshot, ["derived", "observedMinSoFarC"]),

    getAt(snapshot, ["hko", "sinceMidnight", "minTempC"]),
    getAt(snapshot, ["hko", "sinceMidnight", "minTemperatureC"]),
    getAt(snapshot, ["hko", "sinceMidnight", "minTemp"]),
    getAt(snapshot, ["hko", "sinceMidnight", "minTemperature"]),

    getAt(snapshot, ["hko", "hkoMinSinceMidnightC"]),
    getAt(snapshot, ["hko", "minSinceMidnightC"]),
    getAt(snapshot, ["hko", "observedMinC"]),
    getAt(snapshot, ["hko", "observedMinSoFarC"]),
    getAt(snapshot, ["hko", "minSoFarC"]),
    getAt(snapshot, ["hko", "todayMinC"]),
    getAt(snapshot, ["hko", "todayMin"]),

    getAt(snapshot, ["hko", "current", "minSoFarC"]),
    getAt(snapshot, ["hko", "current", "todayMin"]),
    getAt(snapshot, ["hko", "current", "minTemperature"]),
    getAt(snapshot, ["hko", "current", "minTemperatureC"])
  ]);
}

function getOfficialForecastMaxC(
  snapshot: MultiChannelSnapshot
): number | null {
  return firstNumberAtPaths(snapshot, [
    ["derived", "officialForecastMaxC"],
    ["derived", "hkoOfficialForecastMaxC"],
    ["derived", "forecastMaxC"],
    ["derived", "hkoForecastMaxC"],

    ["hko", "officialForecastMaxC"],
    ["hko", "hkoOfficialForecastMaxC"],
    ["hko", "forecastMaxC"],
    ["hko", "hkoForecastMaxC"],
    ["hko", "officialForecastMax"],
    ["hko", "forecastMax"],

    ["hko", "forecastMaxtemp", "value"],
    ["hko", "forecastMaxtemp"],
    ["hko", "forecastMaxTemp", "value"],
    ["hko", "forecastMaxTemperature", "value"],

    ["hko", "forecast", "maxTempC"],
    ["hko", "forecast", "maxTemperatureC"],
    ["hko", "forecast", "forecastMaxtemp", "value"],

    ["hko", "localForecast", "forecastMaxC"],
    ["hko", "localForecast", "forecastMaxtemp", "value"],
    ["hko", "localForecast", "forecastMaxTemp", "value"],
    ["hko", "localForecast", "forecastMaxTemperature", "value"],

    ["hko", "nineDayWeatherForecast", "0", "forecastMaxtemp", "value"],
    ["hko", "nineDayWeatherForecast", "0", "forecastMaxTemp", "value"],
    ["hko", "nineDayWeatherForecast", "0", "forecastMaxTemperature", "value"],

    ["hko", "weatherForecast", "0", "forecastMaxtemp", "value"],
    ["hko", "weatherForecast", "0", "forecastMaxTemp", "value"],
    ["hko", "weatherForecast", "0", "forecastMaxTemperature", "value"],

    ["hko", "raw", "nineDayWeatherForecast", "0", "forecastMaxtemp", "value"],
    ["hko", "raw", "nineDayWeatherForecast", "0", "forecastMaxTemp", "value"],
    [
      "hko",
      "raw",
      "nineDayWeatherForecast",
      "0",
      "forecastMaxTemperature",
      "value"
    ],

    ["hko", "raw", "weatherForecast", "0", "forecastMaxtemp", "value"],
    ["hko", "raw", "weatherForecast", "0", "forecastMaxTemp", "value"],
    ["hko", "raw", "weatherForecast", "0", "forecastMaxTemperature", "value"]
  ]);
}

function getHourlyRainfallMm(snapshot: MultiChannelSnapshot): number | null {
  return firstNumber([
    getAt(snapshot, ["derived", "hourlyRainfallMm"]),
    getAt(snapshot, ["derived", "rainfallLastHourMm"]),
    getAt(snapshot, ["derived", "rainfallPastHourMm"]),
    getAt(snapshot, ["derived", "rainHourlyMm"]),
    getAt(snapshot, ["derived", "rainfallMm"]),
    getAt(snapshot, ["derived", "observedHourlyRainfallMm"]),

    getAt(snapshot, ["hko", "hourlyRainfallMm"]),
    getAt(snapshot, ["hko", "rainfallLastHourMm"]),
    getAt(snapshot, ["hko", "rainfallPastHourMm"]),
    getAt(snapshot, ["hko", "rainHourlyMm"]),
    getAt(snapshot, ["hko", "rainfallMm"]),
    getAt(snapshot, ["hko", "rainfall"]),

    getAt(snapshot, ["hko", "hourlyRainfall", "rainfallMm"]),
    getAt(snapshot, ["hko", "hourlyRainfall", "value"]),
    getAt(snapshot, ["hko", "hourlyRainfall", "amount"]),

    getAt(snapshot, ["hko", "rain", "hourlyRainfallMm"]),
    getAt(snapshot, ["hko", "rain", "rainfallLastHourMm"]),
    getAt(snapshot, ["hko", "rain", "rainfallMm"]),

    getAt(snapshot, ["hko", "current", "hourlyRainfallMm"]),
    getAt(snapshot, ["hko", "current", "rainfallLastHourMm"]),

    getRainfallMmFromObservationArray(
      getAt(snapshot, ["hko", "rainfall", "data"])
    ),
    getRainfallMmFromObservationArray(
      getAt(snapshot, ["hko", "current", "rainfall", "data"])
    ),
    getRainfallMmFromObservationArray(
      getAt(snapshot, ["hko", "raw", "rainfall", "data"])
    )
  ]);
}

function unwrapMarketState(raw: unknown): MarketStateLike {
  if (isRecord(raw)) {
    if (isRecord(raw.state)) {
      return raw.state as MarketStateLike;
    }

    if (isRecord(raw.market)) {
      return raw.market as MarketStateLike;
    }

    return raw as MarketStateLike;
  }

  return {};
}

function normalizeOutcome(raw: unknown, index: number): OutcomeRange | null {
  if (!isRecord(raw)) return null;

  const name =
    asString(raw.name) ??
    asString(raw.title) ??
    asString(raw.outcome) ??
    `Outcome ${index + 1}`;

  return {
    ...raw,
    name,
    lower: asNumber(raw.lower),
    upper: asNumber(raw.upper),
    marketPrice: normalizePrice(raw.marketPrice),
    price: normalizePrice(raw.price),
    tokenId: asString(raw.tokenId),
    clobTokenId: asString(raw.clobTokenId)
  } as OutcomeRange;
}

function extractOutcomes(marketState: MarketStateLike): OutcomeRange[] {
  if (!Array.isArray(marketState.outcomes)) return [];

  return marketState.outcomes
    .map((outcome, index) => normalizeOutcome(outcome, index))
    .filter((outcome): outcome is OutcomeRange => outcome !== null);
}

function getHongKongDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const hourRaw = Number(get("hour"));
  const hour = hourRaw === 24 ? 0 : hourRaw;

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number.isFinite(hour) ? hour : 0
  };
}

function getHongKongDayBounds(now: Date) {
  const parts = getHongKongDateParts(now);
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;

  return {
    ymd,
    hour: parts.hour,
    startMs: Date.parse(`${ymd}T00:00:00+08:00`),
    endMs: Date.parse(`${ymd}T23:59:59.999+08:00`)
  };
}

function parseOpenMeteoTimeMs(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);

  const timestamp = hasTimezone
    ? Date.parse(trimmed)
    : Date.parse(`${trimmed.length === 16 ? `${trimmed}:00` : trimmed}+08:00`);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function getTimeBand(hour: number): ForecastWeatherInputs["timeBand"] {
  if (hour < 6) return "overnight";
  if (hour < 11) return "morning";
  if (hour < 15) return "midday";
  if (hour < 18) return "afternoon";
  return "evening";
}

function getOpenMeteoRemainingDayMaxC(
  snapshot: MultiChannelSnapshot,
  now: Date
): number | null {
  const openMeteo = snapshot.openMeteo;
  if (!openMeteo) return null;

  const bounds = getHongKongDayBounds(now);
  const nowMs = now.getTime();

  /*
    Include the current hourly bucket by allowing one hour of look-back.
    Example: if now is 13:45, Open-Meteo's 13:00 point is still relevant.
  */
  const lowerBoundMs = Math.max(bounds.startMs, nowMs - 60 * 60 * 1000);

  const values: unknown[] = openMeteo.hourly
    .filter((point) => {
      const timestamp = parseOpenMeteoTimeMs(point.time);
      if (timestamp === null) return false;

      return timestamp >= lowerBoundMs && timestamp <= bounds.endMs;
    })
    .map((point) => point.temperature2mC);

  values.push(openMeteo.current?.temperature2mC ?? null);

  return maxNumber(values);
}

function getWindyRemainingDayMaxC(
  snapshot: MultiChannelSnapshot,
  now: Date
): number | null {
  const windy = snapshot.windy;
  if (!windy || !windy.enabled) return null;

  const bounds = getHongKongDayBounds(now);
  const nowMs = now.getTime();
  const lowerBoundMs = Math.max(bounds.startMs, nowMs - 90 * 60 * 1000);

  const values: unknown[] = windy.hourly
    .filter(
      (point) =>
        point.timestamp >= lowerBoundMs && point.timestamp <= bounds.endMs
    )
    .map((point) => point.tempC);

  return maxNumber(values);
}

function estimateCoolingAdjustment(params: {
  rainProbabilityNext2hPct: number | null;
  cloudCoverNowPct: number | null;
  observedHourlyRainfallMm: number | null;
}) {
  let cooling = 0;
  const reasons: string[] = [];

  const rainProbability = params.rainProbabilityNext2hPct;
  const cloudCover = params.cloudCoverNowPct;
  const rainfall = params.observedHourlyRainfallMm;

  if (rainProbability !== null) {
    if (rainProbability >= 80) {
      cooling += 0.35;
      reasons.push(
        "Very high near-term rain probability suppresses upside temperature risk."
      );
    } else if (rainProbability >= 60) {
      cooling += 0.25;
      reasons.push(
        "High near-term rain probability slightly lowers expected remaining-day maximum."
      );
    } else if (rainProbability >= 40) {
      cooling += 0.1;
      reasons.push(
        "Moderate near-term rain probability adds mild cooling pressure."
      );
    }
  }

  if (cloudCover !== null) {
    if (cloudCover >= 90) {
      cooling += 0.18;
      reasons.push("Very high cloud cover reduces solar heating potential.");
    } else if (cloudCover >= 75) {
      cooling += 0.08;
      reasons.push("Cloud cover modestly limits additional heating.");
    }
  }

  if (rainfall !== null) {
    if (rainfall >= 10) {
      cooling += 0.25;
      reasons.push(
        "Recent heavy observed rainfall supports a cooler near-term profile."
      );
    } else if (rainfall >= 2) {
      cooling += 0.1;
      reasons.push("Recent observed rainfall adds minor cooling pressure.");
    }
  }

  return {
    coolingAdjustmentC: clamp(cooling, 0, 0.8),
    adjustmentReasons: reasons
  };
}

function estimateStdDevC(params: {
  hour: number;
  remainingSettlementHours: number;
  observedMaxC: number | null;
  openMeteoRemainingDayMaxC: number | null;
  windyRemainingDayMaxC: number | null;
  officialForecastMaxC: number | null;
  modelDisagreementC: number | null;
  rainProbabilityNext2hPct: number | null;
}) {
  let stdDev: number;

  if (params.hour < 8) {
    stdDev = 0.95;
  } else if (params.hour < 12) {
    stdDev = 0.8;
  } else if (params.hour < 15) {
    stdDev = 0.62;
  } else if (params.hour < 18) {
    stdDev = 0.48;
  } else {
    stdDev = 0.36;
  }

  if (params.remainingSettlementHours <= 2 && params.observedMaxC !== null) {
    stdDev = Math.min(stdDev, 0.32);
  }

  if (
    params.openMeteoRemainingDayMaxC === null &&
    params.windyRemainingDayMaxC === null &&
    params.officialForecastMaxC === null
  ) {
    stdDev += 0.25;
  }

  if (params.modelDisagreementC !== null) {
    stdDev += clamp(params.modelDisagreementC * 0.18, 0, 0.35);
  }

  if ((params.rainProbabilityNext2hPct ?? 0) >= 60) {
    stdDev += 0.08;
  }

  return clamp(stdDev, 0.25, 1.35);
}

function estimateConfidence(params: {
  observedMaxC: number | null;
  hkoCurrentTempC: number | null;
  hkoMinSinceMidnightC: number | null;
  officialForecastMaxC: number | null;
  hourlyRainfallMm: number | null;
  openMeteoRemainingDayMaxC: number | null;
  windyRemainingDayMaxC: number | null;
  modelDisagreementC: number | null;
  sourceErrors: SourceError[];
  hour: number;
}) {
  let score = 0.35;

  if (params.observedMaxC !== null) score += 0.18;
  if (params.hkoCurrentTempC !== null) score += 0.08;
  if (params.hkoMinSinceMidnightC !== null) score += 0.03;
  if (params.officialForecastMaxC !== null) score += 0.05;
  if (params.hourlyRainfallMm !== null) score += 0.02;

  if (params.openMeteoRemainingDayMaxC !== null) score += 0.14;
  if (params.windyRemainingDayMaxC !== null) score += 0.1;

  if (params.hour >= 15) score += 0.08;
  if (params.hour >= 18) score += 0.05;

  if (params.modelDisagreementC !== null) {
    if (params.modelDisagreementC >= 1.5) score -= 0.14;
    else if (params.modelDisagreementC >= 0.8) score -= 0.07;
  }

  score -= clamp(params.sourceErrors.length * 0.04, 0, 0.12);

  const confidenceScore = clamp(score, 0.2, 0.9);

  const confidenceLabel: ForecastResult["model"]["confidenceLabel"] =
    confidenceScore >= 0.72
      ? "high"
      : confidenceScore >= 0.5
        ? "medium"
        : "low";

  return {
    confidenceScore,
    confidenceLabel
  };
}

function computeWeatherInputs(
  snapshot: MultiChannelSnapshot,
  now: Date
): ForecastWeatherInputs {
  const bounds = getHongKongDayBounds(now);
  const hongKongHour = bounds.hour;
  const remainingSettlementHours = Math.max(
    0,
    (bounds.endMs - now.getTime()) / (60 * 60 * 1000)
  );

  const hkoCurrentTempC = getHkoCurrentTempC(snapshot);
  const hkoMaxSinceMidnightC = getHkoMaxSinceMidnightC(
    snapshot,
    hkoCurrentTempC
  );

  /*
    Critical observed lower-bound rule:

      final daily max >= max(
        HKO max since midnight,
        HKO current temperature
      )

    Official forecast max is deliberately NOT included here.
  */
  const observedMaxC = maxNumber([hkoMaxSinceMidnightC, hkoCurrentTempC]);

  const hkoMinSinceMidnightC = getHkoMinSinceMidnightC(snapshot);
  const officialForecastMaxC = getOfficialForecastMaxC(snapshot);
  const hourlyRainfallMm = getHourlyRainfallMm(snapshot);

  const openMeteoCurrentTempC = firstNumber([
    getAt(snapshot, ["derived", "openMeteoCurrentTempC"]),
    snapshot.openMeteo?.current?.temperature2mC
  ]);

  const openMeteoRemainingDayMaxC = firstNumber([
    getOpenMeteoRemainingDayMaxC(snapshot, now),
    getAt(snapshot, ["derived", "openMeteoRemainingDayMaxC"]),
    getAt(snapshot, ["derived", "openMeteoFutureMaxC"])
  ]);

  const windyRemainingDayMaxC = firstNumber([
    getWindyRemainingDayMaxC(snapshot, now),
    getAt(snapshot, ["derived", "windyRemainingDayMaxC"]),
    getAt(snapshot, ["derived", "windyFutureMaxC"])
  ]);

  const rainProbabilityNext2hPct = firstNumber([
    getAt(snapshot, ["derived", "rainProbabilityNext2hPct"])
  ]);

  const cloudCoverNowPct = firstNumber([
    getAt(snapshot, ["derived", "cloudCoverNowPct"]),
    snapshot.openMeteo?.current?.cloudCoverPct
  ]);

  const modelDisagreementC =
    openMeteoRemainingDayMaxC !== null && windyRemainingDayMaxC !== null
      ? Math.abs(openMeteoRemainingDayMaxC - windyRemainingDayMaxC)
      : null;

  /*
    HKO official forecast max is a useful forecast channel, but it is not an
    observation. It gets a modest weight as a prior, while observedMaxC remains
    the hard lower bound.
  */
  const modelFutureMeanC = weightedAverage([
    {
      value: openMeteoRemainingDayMaxC,
      weight: 0.48
    },
    {
      value: windyRemainingDayMaxC,
      weight: 0.32
    },
    {
      value: officialForecastMaxC,
      weight: 0.2
    }
  ]);

  const cooling = estimateCoolingAdjustment({
    rainProbabilityNext2hPct,
    cloudCoverNowPct,
    observedHourlyRainfallMm: hourlyRainfallMm
  });

  let adjustedFutureMeanC =
    modelFutureMeanC ??
    firstNumber([
      officialForecastMaxC,
      hkoCurrentTempC,
      openMeteoCurrentTempC,
      observedMaxC
    ]);

  const hasWeatherModelFuture =
    openMeteoRemainingDayMaxC !== null || windyRemainingDayMaxC !== null;

  if (
    adjustedFutureMeanC !== null &&
    modelFutureMeanC !== null &&
    hasWeatherModelFuture
  ) {
    adjustedFutureMeanC -= cooling.coolingAdjustmentC;
  }

  /*
    Late-day cap:
    If HKO has already observed a maximum and it is late in the day,
    avoid letting a model point from the edge of the settlement window overstate remaining upside.
  */
  if (
    observedMaxC !== null &&
    adjustedFutureMeanC !== null &&
    adjustedFutureMeanC > observedMaxC
  ) {
    let lateDayUpsideCapC: number | null = null;

    if (hongKongHour >= 21) {
      lateDayUpsideCapC = 0.1;
    } else if (hongKongHour >= 18) {
      lateDayUpsideCapC = 0.22;
    } else if (hongKongHour >= 16) {
      lateDayUpsideCapC = 0.45;
    }

    if (lateDayUpsideCapC !== null) {
      adjustedFutureMeanC = Math.min(
        adjustedFutureMeanC,
        observedMaxC + lateDayUpsideCapC
      );
    }
  }

  const forecastFinalMaxMeanC =
    observedMaxC !== null && adjustedFutureMeanC !== null
      ? Math.max(observedMaxC, adjustedFutureMeanC)
      : adjustedFutureMeanC ??
        observedMaxC ??
        hkoCurrentTempC ??
        openMeteoCurrentTempC ??
        officialForecastMaxC ??
        null;

  const hkoSourceAvailable =
    hkoCurrentTempC !== null ||
    observedMaxC !== null ||
    hkoMinSinceMidnightC !== null ||
    officialForecastMaxC !== null ||
    hourlyRainfallMm !== null;

  const sourceCount =
    (hkoSourceAvailable ? 1 : 0) +
    (openMeteoRemainingDayMaxC !== null ? 1 : 0) +
    (windyRemainingDayMaxC !== null ? 1 : 0);

  const forecastFinalMaxStdDevC = estimateStdDevC({
    hour: hongKongHour,
    remainingSettlementHours,
    observedMaxC,
    openMeteoRemainingDayMaxC,
    windyRemainingDayMaxC,
    officialForecastMaxC,
    modelDisagreementC,
    rainProbabilityNext2hPct
  });

  return {
    forecastTargetDate: bounds.ymd,
    hongKongHour,
    timeBand: getTimeBand(hongKongHour),
    remainingSettlementHours: roundNumber(remainingSettlementHours, 2) ?? 0,

    hkoCurrentTempC: roundNumber(hkoCurrentTempC, 2),
    currentTempC: roundNumber(hkoCurrentTempC, 2),
    currentTemperatureC: roundNumber(hkoCurrentTempC, 2),

    observedMaxC: roundNumber(observedMaxC, 2),
    observedMaxSoFarC: roundNumber(observedMaxC, 2),
    observedMaxLowerBoundC: roundNumber(observedMaxC, 2),
    observedFinalMaxLowerBoundC: roundNumber(observedMaxC, 2),

    hkoMaxSoFarC: roundNumber(observedMaxC, 2),
    hkoMaxSinceMidnightC: roundNumber(hkoMaxSinceMidnightC, 2),
    maxSinceMidnightC: roundNumber(hkoMaxSinceMidnightC, 2),
    maxSoFarC: roundNumber(observedMaxC, 2),

    hkoMinSinceMidnightC: roundNumber(hkoMinSinceMidnightC, 2),
    minSinceMidnightC: roundNumber(hkoMinSinceMidnightC, 2),
    observedMinC: roundNumber(hkoMinSinceMidnightC, 2),
    observedMinSoFarC: roundNumber(hkoMinSinceMidnightC, 2),
    minSoFarC: roundNumber(hkoMinSinceMidnightC, 2),

    officialForecastMaxC: roundNumber(officialForecastMaxC, 2),
    hkoOfficialForecastMaxC: roundNumber(officialForecastMaxC, 2),
    forecastMaxC: roundNumber(officialForecastMaxC, 2),
    hkoForecastMaxC: roundNumber(officialForecastMaxC, 2),

    observedHourlyRainfallMm: roundNumber(hourlyRainfallMm, 2),
    hourlyRainfallMm: roundNumber(hourlyRainfallMm, 2),
    rainfallLastHourMm: roundNumber(hourlyRainfallMm, 2),
    rainfallPastHourMm: roundNumber(hourlyRainfallMm, 2),
    rainHourlyMm: roundNumber(hourlyRainfallMm, 2),
    rainfallMm: roundNumber(hourlyRainfallMm, 2),

    openMeteoCurrentTempC: roundNumber(openMeteoCurrentTempC, 2),
    openMeteoRemainingDayMaxC: roundNumber(openMeteoRemainingDayMaxC, 2),
    windyRemainingDayMaxC: roundNumber(windyRemainingDayMaxC, 2),

    modelFutureMeanC: roundNumber(modelFutureMeanC, 3),
    coolingAdjustmentC: roundNumber(cooling.coolingAdjustmentC, 3) ?? 0,
    adjustedFutureMeanC: roundNumber(adjustedFutureMeanC, 3),

    forecastFinalMaxMeanC: roundNumber(forecastFinalMaxMeanC, 3),
    forecastFinalMaxStdDevC: roundNumber(forecastFinalMaxStdDevC, 3) ?? 0.6,

    rainProbabilityNext2hPct: roundNumber(rainProbabilityNext2hPct, 1),
    cloudCoverNowPct: roundNumber(cloudCoverNowPct, 1),

    modelDisagreementC: roundNumber(modelDisagreementC, 3),
    sourceCount,
    adjustmentReasons: cooling.adjustmentReasons
  };
}

/*
  Abramowitz-Stegun style approximation.
  Good enough for a smooth temperature distribution over market ranges.
*/
function erfApprox(x: number) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-absX * absX));

  return sign * y;
}

function normalCdf(x: number, mean: number, stdDev: number) {
  if (x === Number.POSITIVE_INFINITY) return 1;
  if (x === Number.NEGATIVE_INFINITY) return 0;

  return 0.5 * (1 + erfApprox((x - mean) / (stdDev * Math.SQRT2)));
}

function rangeMassGivenObserved(params: {
  lower: number | null;
  upper: number | null;
  mean: number | null;
  stdDev: number;
  observedMaxC: number | null;
}) {
  if (params.mean === null) return 0;

  const lower = params.lower ?? Number.NEGATIVE_INFINITY;
  const upper = params.upper ?? Number.POSITIVE_INFINITY;

  if (upper <= lower) return 0;

  /*
    Settlement range convention used internally:
    lower <= final daily max < upper

    If today's observed maximum is already at or above a finite upper bound,
    the final maximum cannot settle in that lower range anymore.
  */
  if (params.observedMaxC !== null) {
    if (params.upper !== null && params.observedMaxC >= params.upper) {
      return 0;
    }

    const observedInsideRange =
      params.observedMaxC >= lower && params.observedMaxC < upper;

    if (observedInsideRange) {
      /*
        The observed max already satisfies this range.
        It remains in this range if future max does not cross the upper bound.
      */
      return normalCdf(upper, params.mean, params.stdDev);
    }
  }

  const lowerMass = normalCdf(lower, params.mean, params.stdDev);
  const upperMass = normalCdf(upper, params.mean, params.stdDev);

  return clamp(upperMass - lowerMass, 0, 1);
}

function normalizeScores(scores: number[], eligible: boolean[]) {
  const adjusted = scores.map((score, index) =>
    eligible[index] ? Math.max(0, Number.isFinite(score) ? score : 0) : 0
  );

  const sum = adjusted.reduce((acc, value) => acc + value, 0);

  if (sum > 0) {
    return adjusted.map((value) => value / sum);
  }

  const eligibleCount = eligible.filter(Boolean).length;

  if (eligibleCount > 0) {
    return eligible.map((isEligible) => (isEligible ? 1 / eligibleCount : 0));
  }

  if (scores.length === 0) return [];

  return scores.map(() => 1 / scores.length);
}

function buildClobLookups(snapshot: MultiChannelSnapshot) {
  const byName = new Map<string, ClobRow>();
  const byToken = new Map<string, ClobRow>();

  for (const item of snapshot.polymarketClob?.outcomes ?? []) {
    const names = getStringFields(item, [
      "outcomeName",
      "name",
      "title",
      "outcome"
    ]);

    for (const name of names) {
      byName.set(normalizeName(name), item);
    }

    for (const tokenId of getClobYesTokenIds(item)) {
      byToken.set(tokenId, item);
    }
  }

  return {
    byName,
    byToken
  };
}

function findClobRow(
  outcome: OutcomeRange,
  lookups: ReturnType<typeof buildClobLookups>
): ClobRow | null {
  for (const tokenId of getOutcomeTokenIds(outcome)) {
    const byToken = lookups.byToken.get(tokenId);

    if (byToken) {
      return byToken;
    }
  }

  return lookups.byName.get(normalizeName(outcome.name)) ?? null;
}

function getMarketRawPrice(outcome: OutcomeRange, clob: ClobRow | null) {
  /*
    Prefer true CLOB midpoint / synthetic bid-ask midpoint.
    Then fall back to outcome-level CLOB aliases.
    Then fall back to Gamma / general market price.
  */

  const clobMidpoint = getClobMidpoint(clob);
  const clobBuyPrice = getClobBuyPrice(clob);
  const clobSellPrice = getClobSellPrice(clob);

  const clobSyntheticMidpoint =
    clobBuyPrice !== null && clobSellPrice !== null
      ? normalizePrice((clobBuyPrice + clobSellPrice) / 2)
      : null;

  /*
    Some rows may carry CLOB fields directly on the Admin/state outcome row,
    not only inside snapshot.polymarketClob.outcomes.
  */
  const outcomeMidpoint = getClobMidpoint(outcome);
  const outcomeBuyPrice = getClobBuyPrice(outcome);
  const outcomeSellPrice = getClobSellPrice(outcome);

  const outcomeSyntheticMidpoint =
    outcomeBuyPrice !== null && outcomeSellPrice !== null
      ? normalizePrice((outcomeBuyPrice + outcomeSellPrice) / 2)
      : null;

  const gammaFromClob = getClobGammaPrice(clob);
  const gammaFromOutcome = getOutcomeGammaPrice(outcome);

  return (
    clobMidpoint ??
    clobSyntheticMidpoint ??
    outcomeMidpoint ??
    outcomeSyntheticMidpoint ??
    gammaFromClob ??
    gammaFromOutcome
  );
}

function getRowsForMarketCoverage(prepared: PreparedOutcome[]) {
  /*
    Phase 3:

    Market coverage should be evaluated on outcomes that are still possible.

    Example:
    - If HKO observed max is already 28.4C,
    - then low buckets like "<26C" or "26-27C" are already impossible.
    - Those impossible buckets should not drag market coverage down.
    - Otherwise the app may incorrectly disable market blending late in the day.

    If every row is impossible for some reason, fall back to the full list so
    diagnostics still remain meaningful instead of dividing by an empty set.
  */
  const eligible = prepared.filter((item) => !item.impossible);

  return eligible.length > 0 ? eligible : prepared;
}

function getAverageClobSpread(prepared: PreparedOutcome[]) {
  const rows = getRowsForMarketCoverage(prepared);

  const spreads = rows
    .map((item) => getClobSpread(item.clob) ?? getClobSpread(item.outcome))
    .filter((value): value is number => value !== null);

  if (spreads.length === 0) return null;

  return spreads.reduce((acc, value) => acc + value, 0) / spreads.length;
}

function getMarketCoverageStats(prepared: PreparedOutcome[]) {
  const rows = getRowsForMarketCoverage(prepared);

  const validMarketCount = rows.filter(
    (item) => item.marketRawPrice !== null
  ).length;

  const coverage = rows.length > 0 ? validMarketCount / rows.length : 0;

  /*
    Normally require at least 2 market-priced outcomes because normalizing a
    market distribution from only one outcome is usually meaningless.

    Exception:
    If only one eligible outcome remains, one valid market price is enough
    because the settlement distribution is effectively determined already.
  */
  const requiredValidCount = rows.length <= 1 ? rows.length : 2;

  const available =
    rows.length > 0 &&
    validMarketCount >= requiredValidCount &&
    coverage >= 0.5;

  return {
    evaluatedOutcomeCount: rows.length,
    validMarketCount,
    coverage,
    available
  };
}

function calculateMarketWeight(params: {
  prepared: PreparedOutcome[];
  marketProbabilitiesAvailable: boolean;
  blendMarket: boolean;
  marketWeightOverride?: number;
}) {
  if (!params.blendMarket || !params.marketProbabilitiesAvailable) {
    return 0;
  }

  const marketCoverage = getMarketCoverageStats(params.prepared);

  if (!marketCoverage.available) {
    return 0;
  }

  if (
    typeof params.marketWeightOverride === "number" &&
    Number.isFinite(params.marketWeightOverride)
  ) {
    return clamp(params.marketWeightOverride, 0, 0.6);
  }

  let weight = 0.22;

  const averageSpread = getAverageClobSpread(params.prepared);

  if (averageSpread !== null) {
    if (averageSpread <= 0.035) {
      weight += 0.08;
    } else if (averageSpread <= 0.07) {
      weight += 0.04;
    } else if (averageSpread >= 0.15) {
      weight -= 0.08;
    } else if (averageSpread >= 0.1) {
      weight -= 0.04;
    }
  }

  weight *= clamp(marketCoverage.coverage, 0.5, 1);

  return clamp(weight, 0, 0.35);
}

function buildExplanationFactors(params: {
  outcome: OutcomeRange;
  lower: number | null;
  upper: number | null;
  weather: ForecastWeatherInputs;
  impossible: boolean;
  clob: ClobRow | null;
}) {
  const factors: string[] = [];

  if (params.impossible) {
    factors.push(
      "Observed HKO maximum has already reached or exceeded this range's upper bound."
    );
  }

  if (params.weather.observedMaxC !== null) {
    factors.push(
      `Observed max so far: ${params.weather.observedMaxC.toFixed(1)}°C.`
    );
  }

  if (params.weather.hkoCurrentTempC !== null) {
    factors.push(
      `Current HKO temperature: ${params.weather.hkoCurrentTempC.toFixed(1)}°C.`
    );
  }

  if (params.weather.hkoMinSinceMidnightC !== null) {
    factors.push(
      `HKO min since midnight: ${params.weather.hkoMinSinceMidnightC.toFixed(
        1
      )}°C.`
    );
  }

  if (params.weather.officialForecastMaxC !== null) {
    factors.push(
      `Official HKO forecast max: ${params.weather.officialForecastMaxC.toFixed(
        1
      )}°C.`
    );
  }

  if (params.weather.hourlyRainfallMm !== null) {
    factors.push(
      `Observed hourly rainfall: ${params.weather.hourlyRainfallMm.toFixed(
        1
      )} mm.`
    );
  }

  if (params.weather.forecastFinalMaxMeanC !== null) {
    factors.push(
      `Forecast final daily max mean: ${params.weather.forecastFinalMaxMeanC.toFixed(
        2
      )}°C.`
    );
  }

  if (
    params.weather.modelDisagreementC !== null &&
    params.weather.modelDisagreementC >= 0.8
  ) {
    factors.push(
      `Open-Meteo and Windy differ by ${params.weather.modelDisagreementC.toFixed(
        2
      )}°C, increasing uncertainty.`
    );
  }

  if ((params.weather.rainProbabilityNext2hPct ?? 0) >= 60) {
    factors.push(
      `Rain probability next 2h is ${params.weather.rainProbabilityNext2hPct?.toFixed(
        0
      )}%, limiting heat upside.`
    );
  }

  if ((params.weather.cloudCoverNowPct ?? 0) >= 75) {
    factors.push(
      `Cloud cover is ${params.weather.cloudCoverNowPct?.toFixed(
        0
      )}%, reducing solar heating potential.`
    );
  }

  const clobMidpoint =   getClobMidpoint(params.clob) ?? getClobMidpoint(params.outcome);

  if (clobMidpoint !== null) {
    factors.push(`CLOB midpoint available: ${clobMidpoint.toFixed(3)}.`);
  }

  return factors;
}

function formatPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatTemperature(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(digits)}°C`;
}

function formatRainfall(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(digits)} mm`;
}

function buildWarnings(params: {
  sourceErrors: SourceError[];
  marketStateError: string | null;
  weather: ForecastWeatherInputs;
  marketWeight: number;
  marketProbabilitiesAvailable: boolean;
}) {
  const warnings: string[] = [];

  for (const error of params.sourceErrors) {
    const message = `${error.source}: ${error.message}`;

    if (!warnings.includes(message)) {
      warnings.push(message);
    }
  }

  if (params.marketStateError) {
    warnings.push(`Market state: ${params.marketStateError}`);
  }

  if (params.weather.hkoCurrentTempC === null) {
    warnings.push("HKO current temperature is unavailable.");
  }

  if (params.weather.observedMaxC === null) {
    warnings.push("Observed HKO max lower bound is unavailable.");
  }

  if (params.weather.officialForecastMaxC === null) {
    warnings.push("Official HKO forecast max is unavailable.");
  }

  if (!params.marketProbabilitiesAvailable) {
    warnings.push(
      "Insufficient market prices are available; final probabilities are weather-only."
    );
  } else if (params.marketWeight <= 0) {
    warnings.push(
      "Market prices are available but market blending is disabled or weighted to zero."
    );
  }

  return warnings;
}

function buildKeyDrivers(params: {
  weather: ForecastWeatherInputs;
  topOutcome: ForecastOutcome | null;
  confidenceLabel: ForecastResult["model"]["confidenceLabel"];
  marketWeight: number;
  marketCoverage: number;
  averageClobSpread: number | null;
  warnings: string[];
}) {
  const drivers: string[] = [];

  if (params.topOutcome) {
    drivers.push(
      `Top outcome is "${params.topOutcome.name}" at ${params.topOutcome.probabilityPct.toFixed(
        1
      )}% final probability.`
    );
  }

  const weatherParts = [
    params.weather.hkoCurrentTempC !== null
      ? `current HKO ${formatTemperature(params.weather.hkoCurrentTempC)}`
      : null,
    params.weather.observedMaxC !== null
      ? `observed max lower bound ${formatTemperature(
          params.weather.observedMaxC
        )}`
      : null,
    params.weather.hkoMinSinceMidnightC !== null
      ? `min since midnight ${formatTemperature(
          params.weather.hkoMinSinceMidnightC
        )}`
      : null
  ].filter(Boolean);

  if (weatherParts.length > 0) {
    drivers.push(`HKO observations: ${weatherParts.join(", ")}.`);
  }

  if (params.weather.officialForecastMaxC !== null) {
    drivers.push(
      `Official HKO forecast max is ${formatTemperature(
        params.weather.officialForecastMaxC
      )}.`
    );
  }

  if (params.weather.hourlyRainfallMm !== null) {
    drivers.push(
      `Observed hourly rainfall is ${formatRainfall(
        params.weather.hourlyRainfallMm
      )}.`
    );
  }

  if (params.weather.forecastFinalMaxMeanC !== null) {
    drivers.push(
      `Forecast final daily max mean is ${formatTemperature(
        params.weather.forecastFinalMaxMeanC,
        2
      )} with σ≈${params.weather.forecastFinalMaxStdDevC.toFixed(2)}°C.`
    );
  }

  if (params.weather.modelDisagreementC !== null) {
    drivers.push(
      `Open-Meteo / Windy model disagreement is ${params.weather.modelDisagreementC.toFixed(
        2
      )}°C.`
    );
  }

  if (params.marketWeight > 0) {
    drivers.push(
      `Market blend weight is ${(params.marketWeight * 100).toFixed(
        0
      )}% with ${(params.marketCoverage * 100).toFixed(0)}% market coverage.`
    );
  } else {
    drivers.push("Final probabilities are weather-only or fallback-normalized.");
  }

  if (params.averageClobSpread !== null) {
    drivers.push(
      `Average CLOB spread is ${(params.averageClobSpread * 100).toFixed(1)} percentage points.`
    );
  }

  if (params.warnings.length > 0) {
    drivers.push(`Main warning: ${params.warnings[0]}`);
  }

  drivers.push(`Confidence is ${params.confidenceLabel}.`);

  return drivers.slice(0, 8);
}

function buildSummary(params: {
  weather: ForecastWeatherInputs;
  topOutcome: ForecastOutcome | null;
  confidenceLabel: ForecastResult["model"]["confidenceLabel"];
  marketWeight: number;
}) {
  const pieces: string[] = [];

  if (params.topOutcome) {
    pieces.push(
      `Top outcome is "${params.topOutcome.name}" at ${params.topOutcome.probabilityPct.toFixed(
        1
      )}%.`
    );
  } else {
    pieces.push(
      "No outcome probabilities available because no market outcomes are loaded."
    );
  }

  if (params.weather.observedMaxC !== null) {
    pieces.push(
      `HKO max lower bound is ${params.weather.observedMaxC.toFixed(1)}°C.`
    );
  }

  if (params.weather.hkoCurrentTempC !== null) {
    pieces.push(
      `Current HKO temperature is ${params.weather.hkoCurrentTempC.toFixed(
        1
      )}°C.`
    );
  }

  if (params.weather.hkoMinSinceMidnightC !== null) {
    pieces.push(
      `HKO min since midnight is ${params.weather.hkoMinSinceMidnightC.toFixed(
        1
      )}°C.`
    );
  }

  if (params.weather.officialForecastMaxC !== null) {
    pieces.push(
      `Official HKO forecast max is ${params.weather.officialForecastMaxC.toFixed(
        1
      )}°C.`
    );
  }

  if (params.weather.hourlyRainfallMm !== null) {
    pieces.push(
      `Observed hourly rainfall is ${params.weather.hourlyRainfallMm.toFixed(
        1
      )} mm.`
    );
  }

  if (params.weather.forecastFinalMaxMeanC !== null) {
    pieces.push(
      `Forecast final daily max mean is ${params.weather.forecastFinalMaxMeanC.toFixed(
        2
      )}°C with σ≈${params.weather.forecastFinalMaxStdDevC.toFixed(2)}°C.`
    );
  }

  if (params.weather.openMeteoRemainingDayMaxC !== null) {
    pieces.push(
      `Open-Meteo same-day remaining max is ${params.weather.openMeteoRemainingDayMaxC.toFixed(
        1
      )}°C.`
    );
  }

  if (params.weather.windyRemainingDayMaxC !== null) {
    pieces.push(
      `Windy same-day remaining max is ${params.weather.windyRemainingDayMaxC.toFixed(
        1
      )}°C.`
    );
  }

  if (params.marketWeight > 0) {
    pieces.push(
      `Market blend weight is ${(params.marketWeight * 100).toFixed(0)}%.`
    );
  } else {
    pieces.push(
      "Market blend is disabled or insufficient market prices are available."
    );
  }

  pieces.push(`Confidence is ${params.confidenceLabel}.`);

  return pieces.join(" ");
}

export function buildForecastFromMultiChannelSnapshot(params: {
  marketState: MarketStateLike;
  outcomes: OutcomeRange[];
  snapshot: MultiChannelSnapshot;
  options?: GetForecastOptions;
  marketStateError?: string | null;
}): ForecastResult {
  const now = params.options?.now ?? new Date();
  const includeRawSnapshot = params.options?.includeRawSnapshot ?? false;
  const blendMarket = params.options?.blendMarket ?? true;

  const weather = computeWeatherInputs(params.snapshot, now);

  const confidence = estimateConfidence({
    observedMaxC: weather.observedMaxC,
    hkoCurrentTempC: weather.hkoCurrentTempC,
    hkoMinSinceMidnightC: weather.hkoMinSinceMidnightC,
    officialForecastMaxC: weather.officialForecastMaxC,
    hourlyRainfallMm: weather.hourlyRainfallMm,
    openMeteoRemainingDayMaxC: weather.openMeteoRemainingDayMaxC,
    windyRemainingDayMaxC: weather.windyRemainingDayMaxC,
    modelDisagreementC: weather.modelDisagreementC,
    sourceErrors: params.snapshot.errors,
    hour: weather.hongKongHour
  });

  const clobLookups = buildClobLookups(params.snapshot);

  const prepared: PreparedOutcome[] = params.outcomes.map((outcome, index) => {
    const lower = asNumber(outcome.lower);
    const upper = asNumber(outcome.upper);
    const clob = findClobRow(outcome, clobLookups);

    const impossible =
      weather.observedMaxC !== null && upper !== null
        ? weather.observedMaxC >= upper
        : false;

    const weatherScore = impossible
      ? 0
      : rangeMassGivenObserved({
          lower,
          upper,
          mean: weather.forecastFinalMaxMeanC,
          stdDev: weather.forecastFinalMaxStdDevC,
          observedMaxC: weather.observedMaxC
        });

    const marketRawPrice = getMarketRawPrice(outcome, clob);

    return {
      index,
      outcome,
      lower,
      upper,
      impossible,
      weatherScore,
      marketRawPrice,
      clob,
      explanationFactors: buildExplanationFactors({
        outcome,
        lower,
        upper,
        weather,
        impossible,
        clob
      })
    };
  });

  const eligible = prepared.map((item) => !item.impossible);

  const noEligibleOutcomes =
    prepared.length > 0 && eligible.every((value) => !value);

 const weatherProbabilities = normalizeScores(
  prepared.map((item) => item.weatherScore),
  eligible
);

const marketCoverageStats = getMarketCoverageStats(prepared);

const marketProbabilitiesAvailable = marketCoverageStats.available;

  const marketProbabilities = marketProbabilitiesAvailable
  ? normalizeScores(
      prepared.map((item) => item.marketRawPrice ?? 0),
      eligible
    )
  : prepared.map(() => null);

  const marketWeight = calculateMarketWeight({
    prepared,
    marketProbabilitiesAvailable,
    blendMarket,
    marketWeightOverride: params.options?.marketWeightOverride
  });

  const finalScores = prepared.map((item, index) => {
  if (item.impossible) return 0;

  const weatherProbability = weatherProbabilities[index] ?? 0;
  const marketProbability =
    typeof marketProbabilities[index] === "number"
      ? (marketProbabilities[index] as number)
      : null;

  if (marketWeight > 0 && marketProbability !== null) {
    return (
      weatherProbability * (1 - marketWeight) +
      marketProbability * marketWeight
    );
  }

  return weatherProbability;
});

  const finalProbabilities = normalizeScores(finalScores, eligible);

  const rankedIndexes = finalProbabilities
    .map((probability, index) => ({
      index,
      probability
    }))
    .sort((a, b) => b.probability - a.probability)
    .map((item) => item.index);

  const rankByIndex = new Map<number, number>();
  rankedIndexes.forEach((index, rankIndex) => {
    rankByIndex.set(index, rankIndex + 1);
  });

  const outcomes: ForecastOutcome[] = prepared.map((item, index) => {
    const probability = finalProbabilities[index] ?? 0;
    const weatherProbability = weatherProbabilities[index] ?? 0;
    const marketProbability =
      typeof marketProbabilities[index] === "number"
        ? (marketProbabilities[index] as number)
        : null;

    const probabilityRounded = roundNumber(probability, 8) ?? 0;
    const probabilityPctRounded = roundNumber(probability * 100, 4) ?? 0;

    const weatherProbabilityRounded =
      roundNumber(weatherProbability, 8) ?? 0;
    const weatherProbabilityPctRounded =
      roundNumber(weatherProbability * 100, 4) ?? 0;

    const marketProbabilityRounded = roundNumber(marketProbability, 8);
    const marketProbabilityPctRounded =
      marketProbability === null
        ? null
        : roundNumber(marketProbability * 100, 4);

    const clobMidpointValue =
  getClobMidpoint(item.clob) ?? getClobMidpoint(item.outcome);

const clobSpreadValue =
  getClobSpread(item.clob) ?? getClobSpread(item.outcome);

const clobBestBid = roundNumber(
  getClobBuyPrice(item.clob) ?? getClobBuyPrice(item.outcome),
  8
);

const clobBestAsk = roundNumber(
  getClobSellPrice(item.clob) ?? getClobSellPrice(item.outcome),
  8
);

const gammaProbability = roundNumber(
  getClobGammaPrice(item.clob) ?? getOutcomeGammaPrice(item.outcome),
  8
);

    const edge =
      marketProbabilityRounded === null
        ? null
        : weatherProbabilityRounded - marketProbabilityRounded;

    const finalEdge =
      marketProbabilityRounded === null
        ? null
        : probabilityRounded - marketProbabilityRounded;

    return {
      ...item.outcome,

      index: item.index,
      rank: rankByIndex.get(index) ?? index + 1,

      lower: item.lower,
      upper: item.upper,

      probability: probabilityRounded,
      probabilityPct: probabilityPctRounded,

      modelProbability: probabilityRounded,
      modelProbabilityPct: probabilityPctRounded,

      forecastProbability: probabilityRounded,
      forecastProbabilityPct: probabilityPctRounded,

      finalProbability: probabilityRounded,
      finalProbabilityPct: probabilityPctRounded,

      blendedProbability: probabilityRounded,
      blendedProbabilityPct: probabilityPctRounded,

      weatherProbability: weatherProbabilityRounded,
      weatherProbabilityPct: weatherProbabilityPctRounded,
      weatherFairProbability: weatherProbabilityRounded,
      weatherFairProbabilityPct: weatherProbabilityPctRounded,

      marketProbability: marketProbabilityRounded,
      marketProbabilityPct: marketProbabilityPctRounded,
      polymarketProbability: marketProbabilityRounded,
      polymarketProbabilityPct: marketProbabilityPctRounded,

      marketRawPrice: roundNumber(item.marketRawPrice, 8),

      clobMidpoint: roundNumber(clobMidpointValue, 8),
      clobSpread: roundNumber(clobSpreadValue, 8),
      clobBuyPrice: clobBestBid,
      clobSellPrice: clobBestAsk,

      clobBestBid,
      clobBestAsk,
      bestBid: clobBestBid,
      bestAsk: clobBestAsk,

      gammaPrice: gammaProbability,
      gammaProbability,
      gammaProbabilityPct:
        gammaProbability === null ? null : roundNumber(gammaProbability * 100, 4),

      edge: roundNumber(edge, 8),
      edgePct: edge === null ? null : roundNumber(edge * 100, 4),
      fairEdge: roundNumber(edge, 8),
      fairEdgePct: edge === null ? null : roundNumber(edge * 100, 4),
      finalEdge: roundNumber(finalEdge, 8),
      finalEdgePct: finalEdge === null ? null : roundNumber(finalEdge * 100, 4),

      isImpossibleByObservedMax: item.impossible,
      impossibleByObservedMax: item.impossible,
      observedMaxLowerBoundC: weather.observedMaxC,

      explanationFactors: item.explanationFactors
    };
  });

  const topOutcome =
    outcomes.length > 0
      ? outcomes.reduce((best, current) =>
          current.probability > best.probability ? current : best
        )
      : null;

  const averageClobSpread = getAverageClobSpread(prepared);
  const marketCoverage = marketCoverageStats.coverage;

  const warnings = buildWarnings({
    sourceErrors: params.snapshot.errors,
    marketStateError: params.marketStateError ?? null,
    weather,
    marketWeight,
    marketProbabilitiesAvailable
  });

  const keyDrivers = buildKeyDrivers({
    weather,
    topOutcome,
    confidenceLabel: confidence.confidenceLabel,
    marketWeight,
    marketCoverage,
    averageClobSpread,
    warnings
  });

  const hkoSourceAvailable =
    weather.hkoCurrentTempC !== null ||
    weather.observedMaxC !== null ||
    weather.hkoMinSinceMidnightC !== null ||
    weather.officialForecastMaxC !== null ||
    weather.hourlyRainfallMm !== null;

  const result: ForecastResult = {
    version: FORECAST_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),

    hktDate: weather.forecastTargetDate,
    forecastDate: weather.forecastTargetDate,
    date: weather.forecastTargetDate,

    market: {
      loaded: params.outcomes.length > 0 && !params.marketStateError,
      title:
        asString(params.marketState.title) ??
        asString(params.marketState.question),
      slug: asString(params.marketState.slug),
      eventSlug: asString(params.marketState.eventSlug),
      conditionId: asString(params.marketState.conditionId),
      marketId: asString(params.marketState.marketId),
      outcomeCount: params.outcomes.length,
      updatedAt: asString(params.marketState.updatedAt),
      fetchedAt: asString(params.marketState.fetchedAt),
      error: params.marketStateError ?? null
    },

    hkoCurrentTempC: weather.hkoCurrentTempC,
    currentTempC: weather.currentTempC,
    currentTemperatureC: weather.currentTemperatureC,

    observedMaxC: weather.observedMaxC,
    observedMaxSoFarC: weather.observedMaxSoFarC,
    observedMaxLowerBoundC: weather.observedMaxLowerBoundC,
    observedFinalMaxLowerBoundC: weather.observedFinalMaxLowerBoundC,

    hkoMaxSoFarC: weather.hkoMaxSoFarC,
    hkoMaxSinceMidnightC: weather.hkoMaxSinceMidnightC,
    maxSinceMidnightC: weather.maxSinceMidnightC,
    maxSoFarC: weather.maxSoFarC,

    hkoMinSinceMidnightC: weather.hkoMinSinceMidnightC,
    minSinceMidnightC: weather.minSinceMidnightC,
    observedMinC: weather.observedMinC,
    observedMinSoFarC: weather.observedMinSoFarC,
    minSoFarC: weather.minSoFarC,

    officialForecastMaxC: weather.officialForecastMaxC,
    hkoOfficialForecastMaxC: weather.hkoOfficialForecastMaxC,
    forecastMaxC: weather.forecastMaxC,
    hkoForecastMaxC: weather.hkoForecastMaxC,

    observedHourlyRainfallMm: weather.observedHourlyRainfallMm,
    hourlyRainfallMm: weather.hourlyRainfallMm,
    rainfallLastHourMm: weather.rainfallLastHourMm,
    rainfallPastHourMm: weather.rainfallPastHourMm,
    rainHourlyMm: weather.rainHourlyMm,
    rainfallMm: weather.rainfallMm,

    weather,

    model: {
      method: "same-day-temperature-distribution-with-market-blend",
      rangeConvention: "lower-inclusive-upper-exclusive",
      marketBlendEnabled: marketWeight > 0,
      marketWeight: roundNumber(marketWeight, 4) ?? 0,
      marketCoverage: roundNumber(marketCoverage, 4) ?? 0,
      averageClobSpread: roundNumber(averageClobSpread, 6),
      confidenceScore:
        roundNumber(confidence.confidenceScore, 4) ?? confidence.confidenceScore,
      confidenceLabel: confidence.confidenceLabel
    },

    confidence:
      roundNumber(confidence.confidenceScore, 4) ?? confidence.confidenceScore,
    confidenceLabel: confidence.confidenceLabel,

    outcomes,
    probabilities: outcomes,
    outcomeProbabilities: outcomes,
    topOutcome,

    keyDrivers,
    warnings,

    summary: buildSummary({
      weather,
      topOutcome,
      confidenceLabel: confidence.confidenceLabel,
      marketWeight
    }),

  diagnostics: {
  sourceStatus: {
  hko: hkoSourceAvailable,
  openMeteo: params.snapshot.openMeteo !== null,
  windy: Boolean(params.snapshot.windy?.enabled),
  polymarketClob: Boolean(params.snapshot.polymarketClob?.enabled)
  },
  sourceErrors: params.snapshot.errors,
  marketStateError: params.marketStateError ?? null,
  noEligibleOutcomes,

  marketProbabilitiesAvailable,
  marketEvaluatedOutcomeCount: marketCoverageStats.evaluatedOutcomeCount,
  marketValidCount: marketCoverageStats.validMarketCount,
  marketCoverage: roundNumber(marketCoverage, 4) ?? 0,
  marketWeight: roundNumber(marketWeight, 4) ?? 0,
  averageClobSpread: roundNumber(averageClobSpread, 6),

        assumptions: [
        "Outcome ranges are treated as lower-inclusive and upper-exclusive.",
        "The forecast horizon is restricted to the remaining part of the current Hong Kong calendar day.",
        "The daily maximum cannot finish below the maximum already observed by HKO.",
        "The observed max lower bound is max(HKO max since midnight, HKO current temperature).",
        "Official HKO forecast max is used as a forecast prior, not as an observed lower bound.",
        "Weather fair probabilities come from a normal distribution around the same-day final maximum estimate.",
        "When sufficient market prices are available, final probabilities blend weather fair probabilities with CLOB/Gamma-implied probabilities."
      ],

      hkoCurrentTempC: weather.hkoCurrentTempC,
      hkoMaxSinceMidnightC: weather.hkoMaxSinceMidnightC,
      hkoMinSinceMidnightC: weather.hkoMinSinceMidnightC,
      officialForecastMaxC: weather.officialForecastMaxC,
      hourlyRainfallMm: weather.hourlyRainfallMm,
      observedMaxLowerBoundC: weather.observedMaxLowerBoundC,

      keyDrivers,
      warnings
    }
  };

  if (includeRawSnapshot) {
    result.multiChannel = params.snapshot;
  }

  return result;
}

export async function getForecast(
  options: GetForecastOptions = {}
): Promise<ForecastResult> {
  const includeClob = options.includeClob ?? true;

  let marketState: MarketStateLike = {};
  let marketStateError: string | null = null;

 if (options.state) {
    marketState = unwrapMarketState(options.state);
  } else {
    try {
      const rawMarketState = await getMarketState();
      marketState = unwrapMarketState(rawMarketState);
    } catch (error) {
      marketStateError =
        error instanceof Error ? error.message : "Failed to load market state.";
    }
  }

  const outcomes = extractOutcomes(marketState);
  const polymarketUrl =
    options.polymarketUrl ??
    asString(marketState.polymarketUrl) ??
    asString(marketState.marketUrl) ??
    asString(marketState.url) ??
    asString(marketState.eventUrl) ??
    asString(marketState.eventSlug) ??
    asString(marketState.slug);
  
  const snapshot = await getMultiChannelSnapshot({
    outcomes,
    includeClob: includeClob && (outcomes.length > 0 || polymarketUrl !== null),
    polymarketUrl
  });

  return buildForecastFromMultiChannelSnapshot({
    marketState,
    outcomes,
    snapshot,
    options,
    marketStateError
  });
}

export function summarizeForecastForPrompt(forecast: ForecastResult) {
  return {
    version: forecast.version,
    generatedAt: forecast.generatedAt,
    hktDate: forecast.hktDate,
    market: forecast.market,
    weather: forecast.weather,
    model: forecast.model,
    confidence: forecast.confidence,
    confidenceLabel: forecast.confidenceLabel,
    keyDrivers: forecast.keyDrivers,
    warnings: forecast.warnings,
    topOutcome: forecast.topOutcome
      ? {
          name: forecast.topOutcome.name,
          probabilityPct: forecast.topOutcome.probabilityPct,
          weatherProbabilityPct: forecast.topOutcome.weatherProbabilityPct,
          marketProbabilityPct: forecast.topOutcome.marketProbabilityPct,
          lower: forecast.topOutcome.lower,
          upper: forecast.topOutcome.upper
        }
      : null,
    outcomes: forecast.outcomes.map((outcome) => ({
      name: outcome.name,
      lower: outcome.lower,
      upper: outcome.upper,
      probabilityPct: outcome.probabilityPct,
      weatherProbabilityPct: outcome.weatherProbabilityPct,
      marketProbabilityPct: outcome.marketProbabilityPct,
      marketRawPrice: outcome.marketRawPrice,
      clobMidpoint: outcome.clobMidpoint,
      clobSpread: outcome.clobSpread,
      isImpossibleByObservedMax: outcome.isImpossibleByObservedMax
    })),
    summary: forecast.summary,
    diagnostics: forecast.diagnostics
  };
}

export function formatForecastDebugTable(forecast: ForecastResult) {
  return forecast.outcomes
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((outcome) => ({
      rank: outcome.rank,
      name: outcome.name,
      range: `${outcome.lower ?? "-∞"} to ${outcome.upper ?? "+∞"}`,
      final: formatPct(outcome.probability),
      weather: formatPct(outcome.weatherProbability),
      market:
        outcome.marketProbability === null
          ? "n/a"
          : formatPct(outcome.marketProbability),
      clobMidpoint: outcome.clobMidpoint,
      clobSpread: outcome.clobSpread,
      impossible: outcome.isImpossibleByObservedMax
    }));
}
