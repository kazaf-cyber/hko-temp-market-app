import { NextResponse } from "next/server";
import { getForecast, type GetForecastOptions } from "@/lib/forecast";
import { getPoeForecastCommentary } from "@/lib/poe";
import { initDatabase, saveForecastRun } from "@/lib/db";
import type { ForecastResult, HkoWeatherSnapshot, MarketState } from "@/types";
import { enrichForecastWithTradeSignals } from "@/lib/trading/enrichForecast";
import {
  applyPoeStructuredAdjustment,
  getPoeStructuredAdjustment,
  type PoeStructuredAdjustmentRun,
} from "@/lib/poeStructuredAdjustment";

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

  /**
   * Phase 4:
   * Let Poe produce a strict-ish structured probability adjustment.
   * Default false to avoid unexpected Poe point usage.
   */
  structuredAdjustment?: boolean;
};

type NumericCandidate = {
  value: number;
  source: string;
  path: string;
};

type OutcomeRange = {
  lower: number | null;
  upper: number | null;
};

type ProbabilityContext = {
  marketBlendEnabled: boolean;
  marketWeight: number | null;
};

const PROBABILITY_EPSILON = 1e-9;

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

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "y", "on", "enabled"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "n", "off", "disabled"].includes(normalized)) {
      return false;
    }
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return null;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    const parsed = toBoolean(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (isRecord(value)) {
      return value;
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

function firstNumberAtPaths(
  record: Record<string, unknown>,
  paths: string[][]
): number | null {
  return firstNumber(...paths.map((path) => getAt(record, path)));
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

function complementProbability(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return roundProbability(1 - value);
}

function getEffectiveMarketWeight(
  probabilityContext: ProbabilityContext
): number {
  /*
    Route layer should not invent a default market weight.

    The forecast engine is the source of truth for whether CLOB/Gamma prices are
    sufficient. If the engine did not provide a positive marketWeight, treat
    the effective blend weight as 0.

    This prevents route.ts from silently applying a 35% market blend when
    src/lib/forecast.ts has already disabled market blending because market
    prices are insufficient.
  */
  if (!probabilityContext.marketBlendEnabled) {
    return 0;
  }

  if (probabilityContext.marketWeight === null) {
    return 0;
  }

  return clampProbability(probabilityContext.marketWeight);
}
function roundTemperatureC(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function getClobBidAskFromRow(row: Record<string, unknown>): {
  bid: number | null;
  ask: number | null;
  midpoint: number | null;
  spread: number | null;
} {
  /*
    Polymarket UI often shows:
      Buy Yes = YES ask
      Buy No  = NO ask

    For a binary market:
      YES bid ≈ 1 - NO ask

    So if yesBid is unavailable but noAsk exists, synthesize a YES bid from
    noAsk. This makes the app's midpoint line up with Polymarket's displayed
    bold percentage much more closely.
  */
  const noAsk = firstProbability(
    row.noAsk,
    row.noBestAsk,
    row.noBestAskPrice,
    row.noAskPrice,
    row.clobNoAsk,
    row.clobNoBestAsk,
    getAt(row, ["clob", "noAsk"]),
    getAt(row, ["clob", "noBestAsk"]),
    getAt(row, ["clob", "noBestAskPrice"]),
    getAt(row, ["market", "noAsk"]),
    getAt(row, ["market", "noBestAsk"]),
    getAt(row, ["polymarket", "noAsk"]),
    getAt(row, ["polymarket", "noBestAsk"])
  );

  const directBid = firstProbability(
    row.clobBestBid,
    row.bestBid,
    row.bid,
    row.yesBid,
    row.yesBestBid,
    row.yesBestBidPrice,
    row.yesBidPrice,
    getAt(row, ["clob", "bestBid"]),
    getAt(row, ["clob", "bid"]),
    getAt(row, ["clob", "yesBid"]),
    getAt(row, ["clob", "yesBestBid"]),
    getAt(row, ["market", "clobBestBid"]),
    getAt(row, ["market", "bestBid"]),
    getAt(row, ["market", "bid"]),
    getAt(row, ["market", "yesBid"]),
    getAt(row, ["polymarket", "clobBestBid"]),
    getAt(row, ["polymarket", "bestBid"]),
    getAt(row, ["polymarket", "bid"]),
    getAt(row, ["polymarket", "yesBid"])
  );

  const bid = directBid ?? complementProbability(noAsk);

  const ask = firstProbability(
    row.clobBestAsk,
    row.bestAsk,
    row.ask,
    row.yesAsk,
    row.yesBestAsk,
    row.yesBestAskPrice,
    row.yesAskPrice,
    getAt(row, ["clob", "bestAsk"]),
    getAt(row, ["clob", "ask"]),
    getAt(row, ["clob", "yesAsk"]),
    getAt(row, ["clob", "yesBestAsk"]),
    getAt(row, ["market", "clobBestAsk"]),
    getAt(row, ["market", "bestAsk"]),
    getAt(row, ["market", "ask"]),
    getAt(row, ["market", "yesAsk"]),
    getAt(row, ["polymarket", "clobBestAsk"]),
    getAt(row, ["polymarket", "bestAsk"]),
    getAt(row, ["polymarket", "ask"]),
    getAt(row, ["polymarket", "yesAsk"])
  );

  const explicitMidpoint = firstProbability(
    row.clobMidpoint,
    row.clobMid,
    row.midpoint,
    row.mid,
    getAt(row, ["clob", "midpoint"]),
    getAt(row, ["clob", "mid"]),
    getAt(row, ["market", "clobMidpoint"]),
    getAt(row, ["market", "clobMid"]),
    getAt(row, ["polymarket", "clobMidpoint"]),
    getAt(row, ["polymarket", "clobMid"])
  );

  const midpoint =
    explicitMidpoint ??
    (bid !== null && ask !== null ? roundProbability((bid + ask) / 2) : null);

  const explicitSpread = firstProbability(
    row.clobSpread,
    row.spread,
    row.bidAskSpread,
    getAt(row, ["clob", "spread"]),
    getAt(row, ["clob", "bidAskSpread"]),
    getAt(row, ["market", "clobSpread"]),
    getAt(row, ["market", "spread"]),
    getAt(row, ["market", "bidAskSpread"]),
    getAt(row, ["polymarket", "clobSpread"]),
    getAt(row, ["polymarket", "spread"]),
    getAt(row, ["polymarket", "bidAskSpread"])
  );

  const spread =
    explicitSpread ??
    (bid !== null && ask !== null
      ? roundProbability(Math.max(0, ask - bid))
      : null);

  return {
    bid,
    ask,
    midpoint,
    spread
  };
}

function getGammaProbabilityFromRow(
  row: Record<string, unknown>
): number | null {
  return firstProbability(
    row.gammaProbability,
    row.gammaProbabilityPct,
    row.gammaPrice,
    row.gammaMidpoint,
    row.gammaMid,
    row.gammaYesPrice,
    row.gammaLastPrice,
    getAt(row, ["gamma", "probability"]),
    getAt(row, ["gamma", "probabilityPct"]),
    getAt(row, ["gamma", "price"]),
    getAt(row, ["gamma", "yesPrice"]),
    getAt(row, ["gamma", "lastPrice"]),
    getAt(row, ["market", "gammaProbability"]),
    getAt(row, ["market", "gammaProbabilityPct"]),
    getAt(row, ["market", "gammaPrice"]),
    getAt(row, ["polymarket", "gammaProbability"]),
    getAt(row, ["polymarket", "gammaProbabilityPct"]),
    getAt(row, ["polymarket", "gammaPrice"])
  );
}

function getMarketProbabilityFromRow(
  row: Record<string, unknown>
): number | null {
  const clob = getClobBidAskFromRow(row);
  const gammaProbability = getGammaProbabilityFromRow(row);

  /*
    IMPORTANT:

    The UI's "Polymarket" column should show the current market-implied price,
    not the normalized internal market distribution used for blending.

    Therefore priority should be:

      1. Live CLOB midpoint / synthetic bid-ask midpoint.
      2. Direct raw market price from forecast.ts, usually marketRawPrice.
      3. Gamma / YES price fallback.
      4. Explicit marketProbability aliases as a last fallback only.

    This avoids showing stale Admin state prices or normalized blend weights as
    if they were Polymarket prices.
  */
  return firstProbability(
    /*
      1. Live CLOB.
    */
    clob.midpoint,
    row.clobMidpoint,
    row.clobMid,
    getAt(row, ["clob", "midpoint"]),
    getAt(row, ["clob", "mid"]),
    getAt(row, ["market", "clobMidpoint"]),
    getAt(row, ["market", "clobMid"]),
    getAt(row, ["polymarket", "clobMidpoint"]),
    getAt(row, ["polymarket", "clobMid"]),

    /*
      2. Forecast engine direct raw market price.
      This is the value that should match Polymarket's displayed percentage.
    */
    row.marketRawPrice,
    row.rawMarketPrice,
    row.polymarketRawPrice,
    getAt(row, ["market", "rawPrice"]),
    getAt(row, ["market", "marketRawPrice"]),
    getAt(row, ["polymarket", "rawPrice"]),
    getAt(row, ["polymarket", "marketRawPrice"]),

    /*
      3. Gamma / YES price fallback.
    */
    gammaProbability,
    row.gammaProbability,
    row.gammaProbabilityPct,
    row.gammaPrice,
    row.gammaMidpoint,
    row.gammaMid,
    row.gammaYesPrice,
    row.gammaLastPrice,
    getAt(row, ["gamma", "probability"]),
    getAt(row, ["gamma", "probabilityPct"]),
    getAt(row, ["gamma", "price"]),
    getAt(row, ["gamma", "yesPrice"]),
    getAt(row, ["gamma", "lastPrice"]),

    /*
      4. Generic market price aliases.
    */
    row.marketPrice,
    row.price,
    row.yesPrice,
    row.lastPrice,
    getAt(row, ["market", "price"]),
    getAt(row, ["market", "yesPrice"]),
    getAt(row, ["polymarket", "price"]),
    getAt(row, ["polymarket", "yesPrice"]),

    /*
      5. Explicit market probability aliases.
      Keep these late because forecast.ts previously used marketProbability as
      a normalized distribution for blending, not as a direct Polymarket price.
    */
    row.marketProbability,
    row.polymarketProbability,
    row.marketProbabilityPct,
    row.polymarketProbabilityPct,
    row.marketPct,
    row.polymarketPct,
    getAt(row, ["market", "probability"]),
    getAt(row, ["market", "probabilityPct"]),
    getAt(row, ["polymarket", "probability"]),
    getAt(row, ["polymarket", "probabilityPct"]),

    /*
      6. Last-resort bid / ask.
    */
    clob.ask,
    clob.bid,
    row.bestAsk,
    row.bestBid,
    row.clobBestAsk,
    row.clobBestBid
  );
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

function pickFirstCandidate(
  candidates: Array<NumericCandidate | null>
): NumericCandidate | null {
  return (
    candidates.find(
      (candidate): candidate is NumericCandidate => candidate !== null
    ) ?? null
  );
}

function pickMinCandidate(
  candidates: Array<NumericCandidate | null>
): NumericCandidate | null {
  const valid = candidates.filter(
    (candidate): candidate is NumericCandidate => candidate !== null
  );

  if (!valid.length) {
    return null;
  }

  return valid.reduce((best, candidate) =>
    candidate.value < best.value ? candidate : best
  );
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
        firstString(
          item.place,
          item.station,
          item.name,
          item.automaticWeatherStation,
          item.automatic_weather_station
        )
      )
    ) ?? null;

  if (hkoRecord) {
    const hkoRainfall = firstNumber(
      hkoRecord.value,
      hkoRecord.amount,
      hkoRecord.rainfall,
      hkoRecord.rainfallMm,
      hkoRecord.hourlyRainfallMm,
      hkoRecord.max,
      hkoRecord.min
    );

    if (hkoRainfall !== null) {
      return hkoRainfall;
    }
  }

  const values = records
    .map((item) =>
      firstNumber(
        item.max,
        item.value,
        item.amount,
        item.rainfall,
        item.rainfallMm,
        item.hourlyRainfallMm,
        item.min
      )
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

function getObservedMinSinceMidnightCandidate(
  forecastRecord: Record<string, unknown>
): NumericCandidate | null {
  const directCandidates: Array<[string, unknown, string]> = [
    [
      "hkoMinSinceMidnightC",
      forecastRecord.hkoMinSinceMidnightC,
      "HKO min since midnight"
    ],
    [
      "minSinceMidnightC",
      forecastRecord.minSinceMidnightC,
      "HKO min since midnight"
    ],
    ["observedMinC", forecastRecord.observedMinC, "Observed min so far"],
    ["observedMin", forecastRecord.observedMin, "Observed min so far"],
    [
      "observedMinSoFarC",
      forecastRecord.observedMinSoFarC,
      "Observed min so far"
    ],
    [
      "observedMinSoFar",
      forecastRecord.observedMinSoFar,
      "Observed min so far"
    ],
    ["minSoFarC", forecastRecord.minSoFarC, "Observed min so far"],
    ["minSoFar", forecastRecord.minSoFar, "Observed min so far"],
    ["todayMinC", forecastRecord.todayMinC, "Observed min so far"],
    ["todayMin", forecastRecord.todayMin, "Observed min so far"]
  ];

  const pathCandidates: Array<[string, string[], string]> = [
    [
      "weather.sinceMidnight.minTempC",
      ["weather", "sinceMidnight", "minTempC"],
      "HKO min since midnight"
    ],
    [
      "weather.sinceMidnight.minTemperatureC",
      ["weather", "sinceMidnight", "minTemperatureC"],
      "HKO min since midnight"
    ],
    [
      "weather.sinceMidnight.minTemp",
      ["weather", "sinceMidnight", "minTemp"],
      "HKO min since midnight"
    ],
    [
      "weather.sinceMidnight.minTemperature",
      ["weather", "sinceMidnight", "minTemperature"],
      "HKO min since midnight"
    ],
    [
      "weather.hkoMinSinceMidnightC",
      ["weather", "hkoMinSinceMidnightC"],
      "HKO min since midnight"
    ],
    [
      "weather.minSinceMidnightC",
      ["weather", "minSinceMidnightC"],
      "HKO min since midnight"
    ],
    [
      "weather.minSoFarC",
      ["weather", "minSoFarC"],
      "Observed min so far"
    ],
    [
      "weather.observedMinSoFarC",
      ["weather", "observedMinSoFarC"],
      "Observed min so far"
    ],
    [
      "weather.observedMinC",
      ["weather", "observedMinC"],
      "Observed min so far"
    ],
    [
      "weather.todayMinC",
      ["weather", "todayMinC"],
      "Observed min so far"
    ],
    [
      "weather.current.minSoFarC",
      ["weather", "current", "minSoFarC"],
      "Observed min so far"
    ],
    [
      "weather.current.todayMin",
      ["weather", "current", "todayMin"],
      "Observed min so far"
    ],
    [
      "weather.current.minTemperature",
      ["weather", "current", "minTemperature"],
      "Observed min so far"
    ],
    [
      "weather.current.minTemperatureC",
      ["weather", "current", "minTemperatureC"],
      "Observed min so far"
    ],
    [
      "hko.minSinceMidnightC",
      ["hko", "minSinceMidnightC"],
      "HKO min since midnight"
    ],
    [
      "hko.hkoMinSinceMidnightC",
      ["hko", "hkoMinSinceMidnightC"],
      "HKO min since midnight"
    ],
    [
      "weatherSnapshot.minSinceMidnightC",
      ["weatherSnapshot", "minSinceMidnightC"],
      "HKO min since midnight"
    ],
    [
      "hkoWeatherSnapshot.minSinceMidnightC",
      ["hkoWeatherSnapshot", "minSinceMidnightC"],
      "HKO min since midnight"
    ],
    [
      "diagnostics.minSoFarC",
      ["diagnostics", "minSoFarC"],
      "Observed min so far"
    ],
    [
      "diagnostics.observedMinSoFarC",
      ["diagnostics", "observedMinSoFarC"],
      "Observed min so far"
    ],
    [
      "diagnostics.hkoMinSinceMidnightC",
      ["diagnostics", "hkoMinSinceMidnightC"],
      "HKO min since midnight"
    ]
  ];

  return pickMinCandidate([
    ...directCandidates.map(([path, value, source]) =>
      numberCandidate(path, value, source)
    ),
    ...pathCandidates.map(([label, path, source]) =>
      numberCandidate(label, getAt(forecastRecord, path), source)
    )
  ]);
}

function getOfficialForecastMaxCandidate(
  forecastRecord: Record<string, unknown>
): NumericCandidate | null {
  const directCandidates: Array<[string, unknown, string]> = [
    [
      "officialForecastMaxC",
      forecastRecord.officialForecastMaxC,
      "HKO official forecast max"
    ],
    [
      "hkoOfficialForecastMaxC",
      forecastRecord.hkoOfficialForecastMaxC,
      "HKO official forecast max"
    ],
    [
      "forecastMaxC",
      forecastRecord.forecastMaxC,
      "HKO official forecast max"
    ],
    [
      "hkoForecastMaxC",
      forecastRecord.hkoForecastMaxC,
      "HKO official forecast max"
    ],
    [
      "officialForecastMax",
      forecastRecord.officialForecastMax,
      "HKO official forecast max"
    ],
    [
      "forecastMax",
      forecastRecord.forecastMax,
      "HKO official forecast max"
    ]
  ];

  const pathCandidates: Array<[string, string[], string]> = [
    [
      "weather.officialForecastMaxC",
      ["weather", "officialForecastMaxC"],
      "HKO official forecast max"
    ],
    [
      "weather.hkoOfficialForecastMaxC",
      ["weather", "hkoOfficialForecastMaxC"],
      "HKO official forecast max"
    ],
    [
      "weather.forecastMaxC",
      ["weather", "forecastMaxC"],
      "HKO official forecast max"
    ],
    [
      "weather.hkoForecastMaxC",
      ["weather", "hkoForecastMaxC"],
      "HKO official forecast max"
    ],
    [
      "weather.forecastMax",
      ["weather", "forecastMax"],
      "HKO official forecast max"
    ],
    [
      "weather.forecastMaxtemp.value",
      ["weather", "forecastMaxtemp", "value"],
      "HKO official forecast max"
    ],
    [
      "weather.forecastMaxtemp",
      ["weather", "forecastMaxtemp"],
      "HKO official forecast max"
    ],
    [
      "weather.forecastMaxTemp.value",
      ["weather", "forecastMaxTemp", "value"],
      "HKO official forecast max"
    ],
    [
      "weather.forecastMaxTemperature.value",
      ["weather", "forecastMaxTemperature", "value"],
      "HKO official forecast max"
    ],
    [
      "weather.forecast.maxTempC",
      ["weather", "forecast", "maxTempC"],
      "HKO official forecast max"
    ],
    [
      "weather.forecast.maxTemperatureC",
      ["weather", "forecast", "maxTemperatureC"],
      "HKO official forecast max"
    ],
    [
      "weather.forecast.forecastMaxtemp.value",
      ["weather", "forecast", "forecastMaxtemp", "value"],
      "HKO official forecast max"
    ],
    [
      "weather.localForecast.forecastMaxC",
      ["weather", "localForecast", "forecastMaxC"],
      "HKO official forecast max"
    ],
    [
      "weather.localForecast.forecastMaxtemp.value",
      ["weather", "localForecast", "forecastMaxtemp", "value"],
      "HKO official forecast max"
    ],
    [
      "weather.nineDayWeatherForecast.0.forecastMaxtemp.value",
      ["weather", "nineDayWeatherForecast", "0", "forecastMaxtemp", "value"],
      "HKO official forecast max"
    ],
    [
      "weather.weatherForecast.0.forecastMaxtemp.value",
      ["weather", "weatherForecast", "0", "forecastMaxtemp", "value"],
      "HKO official forecast max"
    ],
    [
      "weather.raw.nineDayWeatherForecast.0.forecastMaxtemp.value",
      [
        "weather",
        "raw",
        "nineDayWeatherForecast",
        "0",
        "forecastMaxtemp",
        "value"
      ],
      "HKO official forecast max"
    ],
    [
      "weather.raw.weatherForecast.0.forecastMaxtemp.value",
      ["weather", "raw", "weatherForecast", "0", "forecastMaxtemp", "value"],
      "HKO official forecast max"
    ],
    [
      "hko.officialForecastMaxC",
      ["hko", "officialForecastMaxC"],
      "HKO official forecast max"
    ],
    [
      "hko.hkoOfficialForecastMaxC",
      ["hko", "hkoOfficialForecastMaxC"],
      "HKO official forecast max"
    ],
    [
      "hko.forecastMaxC",
      ["hko", "forecastMaxC"],
      "HKO official forecast max"
    ],
    [
      "hko.forecastMaxtemp.value",
      ["hko", "forecastMaxtemp", "value"],
      "HKO official forecast max"
    ],
    [
      "diagnostics.officialForecastMaxC",
      ["diagnostics", "officialForecastMaxC"],
      "HKO official forecast max"
    ],
    [
      "diagnostics.hkoOfficialForecastMaxC",
      ["diagnostics", "hkoOfficialForecastMaxC"],
      "HKO official forecast max"
    ]
  ];

  return pickFirstCandidate([
    ...directCandidates.map(([path, value, source]) =>
      numberCandidate(path, value, source)
    ),
    ...pathCandidates.map(([label, path, source]) =>
      numberCandidate(label, getAt(forecastRecord, path), source)
    )
  ]);
}

function getHourlyRainfallCandidate(
  forecastRecord: Record<string, unknown>
): NumericCandidate | null {
  const directCandidates: Array<[string, unknown, string]> = [
    [
      "hourlyRainfallMm",
      forecastRecord.hourlyRainfallMm,
      "HKO hourly rainfall"
    ],
    [
      "rainfallLastHourMm",
      forecastRecord.rainfallLastHourMm,
      "HKO hourly rainfall"
    ],
    [
      "rainfallPastHourMm",
      forecastRecord.rainfallPastHourMm,
      "HKO hourly rainfall"
    ],
    [
      "rainHourlyMm",
      forecastRecord.rainHourlyMm,
      "HKO hourly rainfall"
    ],
    [
      "rainfallMm",
      forecastRecord.rainfallMm,
      "HKO hourly rainfall"
    ],
    ["rainfall", forecastRecord.rainfall, "HKO hourly rainfall"]
  ];

  const pathCandidates: Array<[string, string[], string]> = [
    [
      "weather.hourlyRainfallMm",
      ["weather", "hourlyRainfallMm"],
      "HKO hourly rainfall"
    ],
    [
      "weather.rainfallLastHourMm",
      ["weather", "rainfallLastHourMm"],
      "HKO hourly rainfall"
    ],
    [
      "weather.rainfallPastHourMm",
      ["weather", "rainfallPastHourMm"],
      "HKO hourly rainfall"
    ],
    [
      "weather.rainHourlyMm",
      ["weather", "rainHourlyMm"],
      "HKO hourly rainfall"
    ],
    [
      "weather.rainfallMm",
      ["weather", "rainfallMm"],
      "HKO hourly rainfall"
    ],
    ["weather.rainfall", ["weather", "rainfall"], "HKO hourly rainfall"],
    [
      "weather.rainfall.value",
      ["weather", "rainfall", "value"],
      "HKO hourly rainfall"
    ],
    [
      "weather.rain.hourlyRainfallMm",
      ["weather", "rain", "hourlyRainfallMm"],
      "HKO hourly rainfall"
    ],
    [
      "weather.rain.rainfallLastHourMm",
      ["weather", "rain", "rainfallLastHourMm"],
      "HKO hourly rainfall"
    ],
    [
      "weather.rain.rainfallMm",
      ["weather", "rain", "rainfallMm"],
      "HKO hourly rainfall"
    ],
    [
      "weather.current.hourlyRainfallMm",
      ["weather", "current", "hourlyRainfallMm"],
      "HKO hourly rainfall"
    ],
    [
      "weather.current.rainfallLastHourMm",
      ["weather", "current", "rainfallLastHourMm"],
      "HKO hourly rainfall"
    ],
    [
      "hko.hourlyRainfallMm",
      ["hko", "hourlyRainfallMm"],
      "HKO hourly rainfall"
    ],
    [
      "hko.rainfallLastHourMm",
      ["hko", "rainfallLastHourMm"],
      "HKO hourly rainfall"
    ],
    [
      "diagnostics.hourlyRainfallMm",
      ["diagnostics", "hourlyRainfallMm"],
      "HKO hourly rainfall"
    ]
  ];

  const arrayCandidates = [
    numberCandidate(
      "weather.rainfall.data[max]",
      getRainfallMmFromObservationArray(
        getAt(forecastRecord, ["weather", "rainfall", "data"])
      ),
      "HKO hourly rainfall"
    ),
    numberCandidate(
      "weather.current.rainfall.data[max]",
      getRainfallMmFromObservationArray(
        getAt(forecastRecord, ["weather", "current", "rainfall", "data"])
      ),
      "HKO hourly rainfall"
    ),
    numberCandidate(
      "weather.raw.rainfall.data[max]",
      getRainfallMmFromObservationArray(
        getAt(forecastRecord, ["weather", "raw", "rainfall", "data"])
      ),
      "HKO hourly rainfall"
    )
  ];

  return pickFirstCandidate([
    ...directCandidates.map(([path, value, source]) =>
      numberCandidate(path, value, source)
    ),
    ...pathCandidates.map(([label, path, source]) =>
      numberCandidate(label, getAt(forecastRecord, path), source)
    ),
    ...arrayCandidates
  ]);
}

/*
  Critical lower-bound rule:

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
  const directCandidates: Array<[string, unknown, string]> = [
    [
      "observedMaxLowerBoundC",
      forecastRecord.observedMaxLowerBoundC,
      "Observed max lower bound"
    ],
    [
      "observedFinalMaxLowerBoundC",
      forecastRecord.observedFinalMaxLowerBoundC,
      "Observed max lower bound"
    ],
    ["observedMaxC", forecastRecord.observedMaxC, "Observed max so far"],
    ["observedMax", forecastRecord.observedMax, "Observed max so far"],
    ["hkoObservedMaxC", forecastRecord.hkoObservedMaxC, "HKO observed max"],
    [
      "hkoMaxSinceMidnightC",
      forecastRecord.hkoMaxSinceMidnightC,
      "HKO max since midnight"
    ],
    [
      "maxSinceMidnightC",
      forecastRecord.maxSinceMidnightC,
      "HKO max since midnight"
    ],
    ["maxSoFarC", forecastRecord.maxSoFarC, "Observed max so far"],
    ["maxSoFar", forecastRecord.maxSoFar, "Observed max so far"],
    [
      "observedMaxSoFarC",
      forecastRecord.observedMaxSoFarC,
      "Observed max so far"
    ],
    [
      "observedMaxSoFar",
      forecastRecord.observedMaxSoFar,
      "Observed max so far"
    ],
    [
      "hkoCurrentTempC",
      forecastRecord.hkoCurrentTempC,
      "HKO current temperature fallback"
    ],
    [
      "currentTempC",
      forecastRecord.currentTempC,
      "HKO current temperature fallback"
    ],
    [
      "currentTemperatureC",
      forecastRecord.currentTemperatureC,
      "HKO current temperature fallback"
    ]
  ];

  const pathCandidates: Array<[string, string[], string]> = [
    [
      "weather.sinceMidnight.maxTempC",
      ["weather", "sinceMidnight", "maxTempC"],
      "HKO max since midnight"
    ],
    [
      "weather.sinceMidnight.maxTemperatureC",
      ["weather", "sinceMidnight", "maxTemperatureC"],
      "HKO max since midnight"
    ],
    [
      "weather.sinceMidnight.maxTemp",
      ["weather", "sinceMidnight", "maxTemp"],
      "HKO max since midnight"
    ],
    [
      "weather.sinceMidnight.maxTemperature",
      ["weather", "sinceMidnight", "maxTemperature"],
      "HKO max since midnight"
    ],
    [
      "weather.observedMaxLowerBoundC",
      ["weather", "observedMaxLowerBoundC"],
      "Observed max lower bound"
    ],
    [
      "weather.observedFinalMaxLowerBoundC",
      ["weather", "observedFinalMaxLowerBoundC"],
      "Observed max lower bound"
    ],
    [
      "weather.observedMaxC",
      ["weather", "observedMaxC"],
      "Observed max so far"
    ],
    ["weather.observedMax", ["weather", "observedMax"], "Observed max so far"],
    ["weather.maxSoFarC", ["weather", "maxSoFarC"], "Observed max so far"],
    [
      "weather.observedMaxSoFarC",
      ["weather", "observedMaxSoFarC"],
      "Observed max so far"
    ],
    [
      "weather.hkoMaxSinceMidnightC",
      ["weather", "hkoMaxSinceMidnightC"],
      "HKO max since midnight"
    ],
    [
      "weather.maxSinceMidnightC",
      ["weather", "maxSinceMidnightC"],
      "HKO max since midnight"
    ],
    [
      "weather.hkoCurrentTempC",
      ["weather", "hkoCurrentTempC"],
      "HKO current temperature fallback"
    ],
    [
      "weather.current.hkoCurrentTempC",
      ["weather", "current", "hkoCurrentTempC"],
      "HKO current temperature fallback"
    ],
    [
      "weather.current.currentTempC",
      ["weather", "current", "currentTempC"],
      "HKO current temperature fallback"
    ],
    [
      "weather.current.tempC",
      ["weather", "current", "tempC"],
      "HKO current temperature fallback"
    ],
    [
      "weather.current.temperatureC",
      ["weather", "current", "temperatureC"],
      "HKO current temperature fallback"
    ],
    [
      "weather.current.temperature",
      ["weather", "current", "temperature"],
      "HKO current temperature fallback"
    ],
    [
      "weather.current.temperature.value",
      ["weather", "current", "temperature", "value"],
      "HKO current temperature fallback"
    ],
    [
      "weather.current.airTemperatureC",
      ["weather", "current", "airTemperatureC"],
      "HKO current temperature fallback"
    ],
    [
      "weather.current.maxSoFarC",
      ["weather", "current", "maxSoFarC"],
      "Observed max so far"
    ],
    [
      "weather.current.todayMax",
      ["weather", "current", "todayMax"],
      "Observed max so far"
    ],
    [
      "weather.current.maxTemperature",
      ["weather", "current", "maxTemperature"],
      "Observed max so far"
    ],
    [
      "weather.currentTempC",
      ["weather", "currentTempC"],
      "HKO current temperature fallback"
    ],
    [
      "weather.currentTemperatureC",
      ["weather", "currentTemperatureC"],
      "HKO current temperature fallback"
    ],
    [
      "weather.temperatureC",
      ["weather", "temperatureC"],
      "HKO current temperature fallback"
    ],
    [
      "weather.temperature",
      ["weather", "temperature"],
      "HKO current temperature fallback"
    ],
    [
      "hko.currentTempC",
      ["hko", "currentTempC"],
      "HKO current temperature fallback"
    ],
    [
      "hko.maxSinceMidnightC",
      ["hko", "maxSinceMidnightC"],
      "HKO max since midnight"
    ],
    [
      "weatherSnapshot.observedMaxC",
      ["weatherSnapshot", "observedMaxC"],
      "Observed max so far"
    ],
    [
      "weatherSnapshot.maxSinceMidnightC",
      ["weatherSnapshot", "maxSinceMidnightC"],
      "HKO max since midnight"
    ],
    [
      "weatherSnapshot.currentTempC",
      ["weatherSnapshot", "currentTempC"],
      "HKO current temperature fallback"
    ],
    [
      "hkoWeatherSnapshot.observedMaxC",
      ["hkoWeatherSnapshot", "observedMaxC"],
      "Observed max so far"
    ],
    [
      "hkoWeatherSnapshot.maxSinceMidnightC",
      ["hkoWeatherSnapshot", "maxSinceMidnightC"],
      "HKO max since midnight"
    ],
    [
      "hkoWeatherSnapshot.currentTempC",
      ["hkoWeatherSnapshot", "currentTempC"],
      "HKO current temperature fallback"
    ],
    [
      "diagnostics.maxSoFarC",
      ["diagnostics", "maxSoFarC"],
      "Observed max so far"
    ],
    [
      "diagnostics.observedMaxSoFarC",
      ["diagnostics", "observedMaxSoFarC"],
      "Observed max so far"
    ],
    [
      "diagnostics.hkoCurrentTempC",
      ["diagnostics", "hkoCurrentTempC"],
      "HKO current temperature fallback"
    ]
  ];

  const hkoObservationCandidates = [
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
    )
  ];

  return pickMaxCandidate([
    ...directCandidates.map(([path, value, source]) =>
      numberCandidate(path, value, source)
    ),
    ...pathCandidates.map(([label, path, source]) =>
      numberCandidate(label, getAt(forecastRecord, path), source)
    ),
    ...hkoObservationCandidates
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
      4. only if both model and market are missing, fallback to one possible bucket.
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
              "Final/weather probabilities were missing or stale after observed max repair, so normalized Polymarket probabilities were used across buckets still possible after observed max lower bound."
          }
        );
      });
    }

    const fallbackBucketIndex =
      observedBucketIndex >= 0
        ? observedBucketIndex
        : repaired.findIndex((row) => row.impossibleByObservedMax !== true);

    return repaired.map((row, index) => {
      if (row.impossibleByObservedMax === true) {
        return row;
      }

      const isFallbackBucket = index === fallbackBucketIndex;

      return setModelProbabilityOnRow(row, isFallbackBucket ? 1 : 0, {
        modelProbabilityRepair: isFallbackBucket
          ? "Fallback 100% to one still-possible bucket because final/weather and market probabilities were missing."
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
      firstProbability(
        row.finalProbability,
        row.blendedProbability,
        row.probability
      ) ?? 0;

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

  const observedMinCandidate =
    getObservedMinSinceMidnightCandidate(forecastRecord);

  const officialForecastMaxCandidate =
    getOfficialForecastMaxCandidate(forecastRecord);

  const hourlyRainfallCandidate = getHourlyRainfallCandidate(forecastRecord);

  const officialForecastMaxC = officialForecastMaxCandidate?.value ?? null;
  const hourlyRainfallMm = hourlyRainfallCandidate?.value ?? null;

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

  const existingSinceMidnightMinCandidate = pickMinCandidate([
    observedMinCandidate,
    numberCandidate(
      "weather.sinceMidnight.minTempC",
      sinceMidnightRecord.minTempC,
      "HKO min since midnight"
    ),
    numberCandidate(
      "weather.sinceMidnight.minTemperatureC",
      sinceMidnightRecord.minTemperatureC,
      "HKO min since midnight"
    ),
    numberCandidate(
      "weather.sinceMidnight.minTemp",
      sinceMidnightRecord.minTemp,
      "HKO min since midnight"
    ),
    numberCandidate(
      "weather.sinceMidnight.minTemperature",
      sinceMidnightRecord.minTemperature,
      "HKO min since midnight"
    ),
    numberCandidate(
      "weather.hkoMinSinceMidnightC",
      weatherRecord.hkoMinSinceMidnightC,
      "HKO min since midnight"
    ),
    numberCandidate(
      "weather.minSinceMidnightC",
      weatherRecord.minSinceMidnightC,
      "HKO min since midnight"
    ),
    numberCandidate(
      "hkoMinSinceMidnightC",
      forecastRecord.hkoMinSinceMidnightC,
      "HKO min since midnight"
    ),
    numberCandidate(
      "minSinceMidnightC",
      forecastRecord.minSinceMidnightC,
      "HKO min since midnight"
    )
  ]);

  const existingSinceMidnightMinC =
    existingSinceMidnightMinCandidate?.value ?? null;

  const sinceMidnightMinSource =
    existingSinceMidnightMinCandidate?.source ?? null;

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
    hkoMinSinceMidnightSource: sinceMidnightMinSource,
    minSinceMidnightSource: sinceMidnightMinSource,

    officialForecastMaxC,
    hkoOfficialForecastMaxC: officialForecastMaxC,
    forecastMaxC: officialForecastMaxC,
    officialForecastMaxSource: officialForecastMaxCandidate?.source ?? null,

    hourlyRainfallMm,
    rainfallLastHourMm: hourlyRainfallMm,
    rainfallPastHourMm: hourlyRainfallMm,
    rainHourlyMm: hourlyRainfallMm,
    hourlyRainfallSource: hourlyRainfallCandidate?.source ?? null,

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
      minSinceMidnightC: existingSinceMidnightMinC,
      hkoMinSinceMidnightC: existingSinceMidnightMinC,
      officialForecastMaxC,
      hkoOfficialForecastMaxC: officialForecastMaxC,
      forecastMaxC: officialForecastMaxC,
      hourlyRainfallMm,
      rainfallLastHourMm: hourlyRainfallMm,
      rainfallPastHourMm: hourlyRainfallMm,
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
      minTempSource: sinceMidnightMinSource,

      source:
        firstString(sinceMidnightRecord.source) ??
        sinceMidnightMaxSource ??
        sinceMidnightMinSource ??
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
        source: sinceMidnightMaxSource,
        path: displaySinceMidnightMaxCandidate?.path ?? null
      },
      hkoMinSinceMidnight: {
        valueC: existingSinceMidnightMinC,
        source: sinceMidnightMinSource,
        path: existingSinceMidnightMinCandidate?.path ?? null
      },
      officialForecastMax: {
        valueC: officialForecastMaxC,
        source: officialForecastMaxCandidate?.source ?? null,
        path: officialForecastMaxCandidate?.path ?? null
      },
      hourlyRainfall: {
        valueMm: hourlyRainfallMm,
        source: hourlyRainfallCandidate?.source ?? null,
        path: hourlyRainfallCandidate?.path ?? null
      }
    }
  };
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
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

function addDriver(drivers: string[], driver: string | null) {
  if (!driver) {
    return;
  }

  const trimmed = driver.trim();

  if (!trimmed) {
    return;
  }

  if (!drivers.includes(trimmed)) {
    drivers.push(trimmed);
  }
}

function formatTemperatureForDriver(value: unknown): string | null {
  const parsed = toFiniteNumber(value);

  if (parsed === null) {
    return null;
  }

  return `${Math.round(parsed * 10) / 10}°C`;
}

function formatRainfallForDriver(value: unknown): string | null {
  const parsed = toFiniteNumber(value);

  if (parsed === null) {
    return null;
  }

  return `${Math.round(parsed * 10) / 10} mm`;
}

function formatProbabilityForDriver(value: unknown): string | null {
  const parsed = probabilityFromValue(value);

  if (parsed === null) {
    return null;
  }

  return `${Math.round(parsed * 1000) / 10}%`;
}

function buildKeyDriversFallback(params: {
  forecastRecord: Record<string, unknown>;
  outcomeProbabilities: Record<string, unknown>[];
  weatherForDisplay: Record<string, unknown>;
  warnings: string[];
  probabilityContext: ProbabilityContext;
  maxSoFarC: number | null;
  maxSoFarSource: string | null;
  hkoCurrentTempC: number | null;
  hkoMaxSinceMidnightC: number | null;
  hkoMinSinceMidnightC: number | null;
  officialForecastMaxC: number | null;
  hourlyRainfallMm: number | null;
}): string[] {
  const drivers: string[] = [];

  const topOutcome =
    [...params.outcomeProbabilities].sort(
      (a, b) =>
        (firstProbability(
          b.finalProbability,
          b.blendedProbability,
          b.probability
        ) ?? -Infinity) -
        (firstProbability(
          a.finalProbability,
          a.blendedProbability,
          a.probability
        ) ?? -Infinity)
    )[0] ?? null;

  if (topOutcome) {
    const topName =
      firstString(topOutcome.name, topOutcome.outcome, topOutcome.label) ??
      "top bucket";

    const topProbability = formatProbabilityForDriver(
      firstProbability(
        topOutcome.finalProbability,
        topOutcome.blendedProbability,
        topOutcome.probability
      )
    );

    addDriver(
      drivers,
      topProbability
        ? `Top outcome is ${topName} at ${topProbability} final probability.`
        : `Top outcome is ${topName}.`
    );
  }

  const maxSoFarText = formatTemperatureForDriver(params.maxSoFarC);

  if (maxSoFarText) {
    addDriver(
      drivers,
      `Observed max lower bound is ${maxSoFarText}${
        params.maxSoFarSource ? ` from ${params.maxSoFarSource}` : ""
      }.`
    );
  }

  const currentText = formatTemperatureForDriver(params.hkoCurrentTempC);
  const maxText = formatTemperatureForDriver(params.hkoMaxSinceMidnightC);
  const minText = formatTemperatureForDriver(params.hkoMinSinceMidnightC);

  if (currentText || maxText || minText) {
    addDriver(
      drivers,
      [
        currentText ? `current HKO temperature ${currentText}` : null,
        maxText ? `max since midnight ${maxText}` : null,
        minText ? `min since midnight ${minText}` : null
      ]
        .filter(Boolean)
        .join("; ") + "."
    );
  }

  const officialMaxText = formatTemperatureForDriver(
    params.officialForecastMaxC
  );

  if (officialMaxText) {
    addDriver(drivers, `Official HKO forecast max is ${officialMaxText}.`);
  }

  const rainfallText = formatRainfallForDriver(params.hourlyRainfallMm);

  if (rainfallText) {
    addDriver(drivers, `Hourly rainfall is ${rainfallText}.`);
  } else if (params.hourlyRainfallMm === 0) {
    addDriver(drivers, "Hourly rainfall is 0 mm.");
  }

  const effectiveMarketWeight = getEffectiveMarketWeight(
  params.probabilityContext
);

if (
  !params.probabilityContext.marketBlendEnabled ||
  effectiveMarketWeight <= PROBABILITY_EPSILON
) {
  addDriver(
    drivers,
    "CLOB / Gamma market prices are unavailable or insufficient, so market blending is disabled and final probabilities are weather-only or fallback-normalized."
  );
} else {
  addDriver(
    drivers,
    `Market blend weight is ${formatProbabilityForDriver(
      effectiveMarketWeight
    )}.`
  );
}

  if (params.warnings.length > 0) {
    addDriver(drivers, `Active warning: ${params.warnings[0]}`);
  }

  return drivers.slice(0, 6);
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
  addWarning(
    warnings,
    sourceStatusWarning("Polymarket Gamma", sourceStatus.gamma)
  );
  addWarning(
    warnings,
    sourceStatusWarning("Polymarket CLOB", sourceStatus.clob)
  );

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
  getAt(forecastRecord, ["diagnostics", "marketBlendEnabled"]),
  getAt(forecastRecord, ["diagnostics", "marketBlend", "enabled"])
);

const marketWeight = firstProbability(
  forecastRecord.marketWeight,
  forecastRecord.marketWeightUsed,
  getAt(forecastRecord, ["model", "marketWeight"]),
  getAt(forecastRecord, ["model", "marketWeightUsed"]),
  getAt(forecastRecord, ["diagnostics", "marketWeight"]),
  getAt(forecastRecord, ["diagnostics", "marketWeightUsed"]),
  getAt(forecastRecord, ["diagnostics", "marketBlend", "weight"])
);

if (marketBlendEnabled === false || marketWeight === 0) {
  addWarning(
    warnings,
    "CLOB / Gamma：市場價格不足，blend 已停用（marketWeight=0）。Final probabilities are weather-only or fallback-normalized."
  );
}

  return warnings;
}

function getStateOutcomeRows(state: MarketState | null | undefined): unknown[] {
  if (!state) {
    return [];
  }

  const stateRecord = recordOrEmpty(state);

  const candidates = [
    stateRecord.outcomes,
    stateRecord.probabilities,
    stateRecord.outcomeProbabilities,
    getAt(stateRecord, ["market", "outcomes"]),
    getAt(stateRecord, ["market", "probabilities"]),
    getAt(stateRecord, ["polymarket", "outcomes"]),
    getAt(stateRecord, ["polymarket", "probabilities"])
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

function getForecastOutcomeRows(
  forecastRecord: Record<string, unknown>
): unknown[] {
  /*
    Prefer the forecast engine's explicit probability rows over raw outcomes.
    Raw outcomes often contain only labels/prices.
  */
  if (Array.isArray(forecastRecord.outcomeProbabilities)) {
    return forecastRecord.outcomeProbabilities;
  }

  if (Array.isArray(forecastRecord.probabilities)) {
    return forecastRecord.probabilities;
  }

  if (Array.isArray(forecastRecord.outcomes)) {
    return forecastRecord.outcomes;
  }

  return [];
}

function normalizeOutcomeNameKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/℃/g, "°c")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9°+\-. ]/g, "");
}

function outcomeNameKey(row: Record<string, unknown>): string | null {
  const name = firstString(row.name, row.outcome, row.label, row.title);

  if (!name) {
    return null;
  }

  const key = normalizeOutcomeNameKey(name);

  return key ? `name:${key}` : null;
}

function outcomeRangeKey(row: Record<string, unknown>): string | null {
  const range = getOutcomeRange(row);

  if (range.lower === null && range.upper === null) {
    return null;
  }

  return `range:${range.lower ?? ""}:${range.upper ?? ""}`;
}

const FORECAST_MARKET_FIELD_KEYS = [
  "marketProbability",
  "marketProbabilityPct",
  "polymarketProbability",
  "polymarketProbabilityPct",
  "marketPct",
  "polymarketPct",

  "marketRawPrice",
  "rawMarketPrice",
  "polymarketRawPrice",
  "marketPrice",
  "price",
  "yesPrice",
  "noPrice",
  "lastPrice",

  "gammaProbability",
  "gammaProbabilityPct",
  "gammaPrice",
  "gammaMidpoint",
  "gammaMid",
  "gammaYesPrice",
  "gammaNoPrice",
  "gammaLastPrice",

  "clobBestBid",
  "clobBestAsk",
  "clobMidpoint",
  "clobMid",
  "clobSpread",
  "bestBid",
  "bestAsk",
  "bid",
  "ask",
  "mid",
  "midpoint",
  "spread",
  "bidAskSpread",

  "yesAsk",
  "noAsk",
  "yesBid",

  "marketPriceSource",
  "marketProbabilitySource",
  "clobSource",
  "gammaSource",

  "market",
  "polymarket",
  "clob",
  "gamma",

  /*
    Event-specific identifiers.
    If forecastRow has current-event identifiers, they should not be overwritten
    by old Admin state token IDs.
  */
  "tokenId",
  "clobTokenId",
  "yesTokenId",
  "noTokenId",
  "assetId",
  "yesAssetId",
  "conditionId",
  "question",
  "marketSlug"
] as const;

function hasUsableValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

function mergeStateOutcomeWithForecastOutcome(params: {
  stateRow: Record<string, unknown>;
  forecastRow: Record<string, unknown> | null;
}): Record<string, unknown> {
  const { stateRow, forecastRow } = params;

  if (!forecastRow) {
    return {
      ...stateRow,
      outcomeUniverseSource: "state.outcomes",
      forecastOutcomeMatched: false
    };
  }

  /*
    Start with forecast row so source/model fields exist, then overlay state row
    because Admin state is the outcome universe source of truth.
  */
  const merged: Record<string, unknown> = {
    ...forecastRow,
    ...stateRow,
    outcomeUniverseSource: "state.outcomes",
    forecastOutcomeMatched: true
  };

  /*
    But probability fields from the engine should not be overwritten by Admin
    price-only state rows.
  */
  for (const key of [
    "probability",
    "probabilityPct",
    "modelProbability",
    "modelProbabilityPct",
    "weatherProbability",
    "weatherProbabilityPct",
    "weatherFairProbability",
    "weatherFairProbabilityPct",
    "forecastProbability",
    "forecastProbabilityPct",
    "finalProbability",
    "finalProbabilityPct",
    "blendedProbability",
    "blendedProbabilityPct"
  ]) {
    if (forecastRow[key] !== undefined) {
      merged[key] = forecastRow[key];
    }
  }
/*
    Protect fresh market data too.

    State rows define the outcome universe, but they must not overwrite fresh
    CLOB/Gamma data fetched by the forecast engine. Otherwise the UI can show
    stale Polymarket prices from Admin JSON / DB state.
  */
  for (const key of FORECAST_MARKET_FIELD_KEYS) {
    const value = forecastRow[key];

    if (hasUsableValue(value)) {
      merged[key] = value;
    }
  }
  const stateName = firstString(
    stateRow.name,
    stateRow.outcome,
    stateRow.label,
    stateRow.title
  );

  if (stateName) {
    merged.name = stateName;
  }

  const stateRange = getOutcomeRange(stateRow);

  if (stateRange.lower !== null) {
    merged.lower = stateRange.lower;
  }

  if (stateRange.upper !== null) {
    merged.upper = stateRange.upper;
  }

  return merged;
}

function buildRawOutcomeRows(params: {
  forecastRecord: Record<string, unknown>;
  state: MarketState | null | undefined;
}): {
  rows: unknown[];
  source: string;
} {
  const forecastRows = getForecastOutcomeRows(params.forecastRecord).map(
    (row) => recordOrEmpty(row)
  );

  const stateRows = getStateOutcomeRows(params.state).map((row) =>
    recordOrEmpty(row)
  );

  if (!stateRows.length) {
    return {
      rows: forecastRows,
      source:
        Array.isArray(params.forecastRecord.outcomeProbabilities)
          ? "forecast.outcomeProbabilities"
          : Array.isArray(params.forecastRecord.probabilities)
            ? "forecast.probabilities"
            : Array.isArray(params.forecastRecord.outcomes)
              ? "forecast.outcomes"
              : "none"
    };
  }

  const usedForecastIndexes = new Set<number>();

  const rows = stateRows.map((stateRow, index) => {
    const stateNameKey = outcomeNameKey(stateRow);
    const stateRangeKey = outcomeRangeKey(stateRow);

    let matchIndex = forecastRows.findIndex((forecastRow, forecastIndex) => {
      if (usedForecastIndexes.has(forecastIndex)) {
        return false;
      }

      return (
        (stateNameKey !== null &&
          outcomeNameKey(forecastRow) === stateNameKey) ||
        (stateRangeKey !== null &&
          outcomeRangeKey(forecastRow) === stateRangeKey)
      );
    });

    /*
      Fallback by index if labels changed but the row count/order is the same.
    */
    if (
      matchIndex < 0 &&
      forecastRows.length === stateRows.length &&
      !usedForecastIndexes.has(index)
    ) {
      matchIndex = index;
    }

    const forecastRow = matchIndex >= 0 ? forecastRows[matchIndex] : null;

    if (matchIndex >= 0) {
      usedForecastIndexes.add(matchIndex);
    }

    return mergeStateOutcomeWithForecastOutcome({
      stateRow,
      forecastRow
    });
  });

  return {
    rows,
    source: "state.outcomes"
  };
}

function getProbabilityContext(
  forecastRecord: Record<string, unknown>
): ProbabilityContext {
  const explicitBlendEnabled = firstBoolean(
    forecastRecord.marketBlendEnabled,
    getAt(forecastRecord, ["model", "marketBlendEnabled"]),
    getAt(forecastRecord, ["diagnostics", "marketBlendEnabled"]),
    getAt(forecastRecord, ["diagnostics", "marketBlend", "enabled"])
  );

  const marketBlendEnabled = explicitBlendEnabled ?? true;

  const marketWeight =
    firstProbability(
      forecastRecord.marketWeight,
      forecastRecord.marketWeightUsed,
      getAt(forecastRecord, ["model", "marketWeight"]),
      getAt(forecastRecord, ["model", "marketWeightUsed"]),
      getAt(forecastRecord, ["diagnostics", "marketWeight"]),
      getAt(forecastRecord, ["diagnostics", "marketWeightUsed"]),
      getAt(forecastRecord, ["diagnostics", "marketBlend", "weight"])
    ) ?? null;

  return {
    marketBlendEnabled,
    marketWeight
  };
}

function getDisplayConfidence(params: {
  forecastRecord: Record<string, unknown>;
  outcomeProbabilities: Record<string, unknown>[];
  warnings: string[];
}): number | null {
  const explicitConfidence = firstProbability(
    params.forecastRecord.confidence,
    getAt(params.forecastRecord, ["summary", "confidence"]),
    getAt(params.forecastRecord, ["model", "confidence"]),
    getAt(params.forecastRecord, ["diagnostics", "confidence"])
  );

  if (explicitConfidence !== null) {
    return roundProbability(explicitConfidence);
  }

  const hasWeatherProbability = params.outcomeProbabilities.some(
    (row) =>
      firstProbability(row.weatherProbability, row.weatherFairProbability) !==
      null
  );

  const hasMarketProbability = params.outcomeProbabilities.some(
    (row) => getMarketProbabilityFromRow(row) !== null
  );

  const hasFinalProbability = params.outcomeProbabilities.some(
    (row) =>
      firstProbability(
        row.finalProbability,
        row.blendedProbability,
        row.probability
      ) !== null
  );

  if (!hasWeatherProbability && !hasMarketProbability && !hasFinalProbability) {
    return null;
  }

  const warningPenalty = Math.min(0.25, params.warnings.length * 0.05);

  const derived =
    0.25 +
    (hasWeatherProbability ? 0.25 : 0) +
    (hasMarketProbability ? 0.25 : 0) +
    (hasFinalProbability ? 0.15 : 0) -
    warningPenalty;

  return roundProbability(Math.max(0.1, Math.min(0.9, derived)));
}

function buildMultiChannelForecastJson(
  result: ForecastResult
): Record<string, unknown> {
  const resultRecord = recordOrEmpty(result);
  const weatherRecord = recordOrEmpty(resultRecord.weather);
  const marketRecord = recordOrEmpty(resultRecord.market);
  const polymarketRecord = recordOrEmpty(resultRecord.polymarket);
  const diagnosticsRecord = recordOrEmpty(resultRecord.diagnostics);

  const rows = Array.isArray(resultRecord.outcomeProbabilities)
    ? resultRecord.outcomeProbabilities.map((row) => recordOrEmpty(row))
    : [];

  return {
    schemaVersion: "phase2.multi_channel_forecast_json.v1",
    generatedAt: resultRecord.generatedAt ?? null,
    hktDate:
      firstString(
        resultRecord.hktDate,
        resultRecord.forecastDate,
        resultRecord.date
      ) ?? null,

    outcomeUniverse: rows.map((row) => ({
      name: row.name ?? null,
      lower: row.lower ?? null,
      upper: row.upper ?? null
    })),

    weatherChannels: {
      hko: {
        currentTempC:
          resultRecord.hkoCurrentTempC ??
          getAt(weatherRecord, ["current", "hkoCurrentTempC"]) ??
          getAt(weatherRecord, ["currentTempC"]) ??
          null,
        maxSoFarC:
          resultRecord.maxSoFarC ??
          resultRecord.observedMaxSoFarC ??
          resultRecord.observedFinalMaxLowerBoundC ??
          null,
        maxSinceMidnightC:
          resultRecord.hkoMaxSinceMidnightC ??
          getAt(weatherRecord, ["sinceMidnight", "maxTempC"]) ??
          getAt(weatherRecord, ["maxSinceMidnightC"]) ??
          null,
        minSinceMidnightC:
          resultRecord.hkoMinSinceMidnightC ??
          resultRecord.minSinceMidnightC ??
          getAt(weatherRecord, ["sinceMidnight", "minTempC"]) ??
          getAt(weatherRecord, ["minSinceMidnightC"]) ??
          null,
        officialForecastMaxC:
          resultRecord.officialForecastMaxC ??
          resultRecord.hkoOfficialForecastMaxC ??
          resultRecord.forecastMaxC ??
          getAt(weatherRecord, ["officialForecastMaxC"]) ??
          getAt(weatherRecord, ["forecastMaxC"]) ??
          null,
        hourlyRainfallMm:
          resultRecord.hourlyRainfallMm ??
          resultRecord.rainfallLastHourMm ??
          getAt(weatherRecord, ["hourlyRainfallMm"]) ??
          getAt(weatherRecord, ["rainfallLastHourMm"]) ??
          null
      },
      openMeteo:
        firstRecord(
          weatherRecord.openMeteo,
          weatherRecord.open_meteo,
          resultRecord.openMeteo,
          resultRecord.open_meteo,
          getAt(diagnosticsRecord, ["sourceStatus", "openMeteo"])
        ) ?? null,
      windy:
        firstRecord(
          weatherRecord.windy,
          resultRecord.windy,
          getAt(diagnosticsRecord, ["sourceStatus", "windy"])
        ) ?? null,
      rain: {
        rainfallMm:
          weatherRecord.rainfallMm ??
          weatherRecord.hourlyRainfallMm ??
          weatherRecord.rainfallLastHourMm ??
          weatherRecord.rainfall ??
          getAt(weatherRecord, ["rain", "rainfallMm"]) ??
          null,
        cloudCover:
          weatherRecord.cloudCover ??
          weatherRecord.cloudCoverPct ??
          getAt(weatherRecord, ["cloud", "cover"]) ??
          getAt(weatherRecord, ["cloud", "coverPct"]) ??
          null,
        rainProbability:
          weatherRecord.rainProbability ??
          weatherRecord.rainProbabilityPct ??
          getAt(weatherRecord, ["rain", "probability"]) ??
          getAt(weatherRecord, ["rain", "probabilityPct"]) ??
          null
      }
    },

    marketChannels: {
      gamma:
        firstRecord(
          marketRecord.gamma,
          polymarketRecord.gamma,
          resultRecord.gamma,
          getAt(diagnosticsRecord, ["sourceStatus", "gamma"])
        ) ?? null,
      clob:
        firstRecord(
          marketRecord.clob,
          polymarketRecord.clob,
          resultRecord.clob,
          getAt(diagnosticsRecord, ["sourceStatus", "clob"])
        ) ?? null
    },

    outcomeProbabilities: rows.map((row) => ({
      name: row.name ?? null,
      lower: row.lower ?? null,
      upper: row.upper ?? null,
      weatherProbability:
        firstProbability(row.weatherProbability, row.weatherFairProbability) ??
        null,
      marketProbability: getMarketProbabilityFromRow(row),
      finalProbability:
        firstProbability(
          row.finalProbability,
          row.blendedProbability,
          row.probability
        ) ?? null,
      gammaProbability: getGammaProbabilityFromRow(row),
      clobBestBid: row.clobBestBid ?? null,
      clobBestAsk: row.clobBestAsk ?? null,
      clobMidpoint: row.clobMidpoint ?? null,
      clobSpread: row.clobSpread ?? null,
      edge: row.edge ?? null,
      finalEdge: row.finalEdge ?? null
    })),

    topOutcome: resultRecord.topOutcome ?? null,
    confidence: resultRecord.confidence ?? null,
    warnings: resultRecord.warnings ?? [],
    diagnostics: diagnosticsRecord
  };
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

  const marketWeight = getEffectiveMarketWeight(probabilityContext);

  let finalProbability = explicitFinalProbability;
  let finalProbabilitySource = "explicit_final_probability";

 if (finalProbability === null) {
  if (
    probabilityContext.marketBlendEnabled &&
    marketWeight > PROBABILITY_EPSILON &&
    weatherProbability !== null &&
    marketProbability !== null
  ) {
    finalProbability = roundProbability(
      (1 - marketWeight) * weatherProbability +
        marketWeight * marketProbability
    );
    finalProbabilitySource = "route_computed_weather_market_blend";
  } else {
    finalProbability =
      weatherProbability ?? marketProbability ?? genericProbability;

    finalProbabilitySource =
      weatherProbability !== null && marketProbability !== null && marketWeight <= PROBABILITY_EPSILON
        ? "weather_probability_market_blend_weight_zero"
        : weatherProbability !== null
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

function getOutcomeIntervalForQuantile(
  row: Record<string, unknown>
): {
  lower: number;
  upper: number;
} | null {
  const lower = firstNumber(row.lower);
  const upper = firstNumber(row.upper);

  if (lower !== null && upper !== null && upper > lower) {
    return {
      lower,
      upper
    };
  }

  if (lower !== null && upper === null) {
    return {
      lower,
      upper: lower + 1
    };
  }

  if (lower === null && upper !== null) {
    return {
      lower: upper - 1,
      upper
    };
  }

  const point = getOutcomePoint(row);

  if (point !== null) {
    return {
      lower: point,
      upper: point
    };
  }

  return null;
}

function deriveEstimatedFinalMaxCFromOutcomes(
  outcomeProbabilities: Record<string, unknown>[]
) {
  const buckets = outcomeProbabilities
    .map((row) => {
      const interval = getOutcomeIntervalForQuantile(row);
      const probability = firstProbability(
        row.finalProbability,
        row.blendedProbability,
        row.probability
      );

      return {
        interval,
        probability
      };
    })
    .filter(
      (
        item
      ): item is {
        interval: {
          lower: number;
          upper: number;
        };
        probability: number;
      } => item.interval !== null && item.probability !== null
    )
    .map((item) => ({
      lower: item.interval.lower,
      upper: item.interval.upper,
      probability: Math.max(0, item.probability)
    }))
    .filter((item) => item.probability > 0)
    .sort((a, b) => a.lower - b.lower);

  const total = buckets.reduce((sum, item) => sum + item.probability, 0);

  if (!buckets.length || total <= PROBABILITY_EPSILON) {
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

    for (const bucket of buckets) {
      const previousCumulative = cumulative;
      cumulative += bucket.probability;

      if (cumulative + PROBABILITY_EPSILON >= target) {
        const width = bucket.upper - bucket.lower;

        if (width <= PROBABILITY_EPSILON) {
          return bucket.lower;
        }

        /*
          Instead of returning the bucket midpoint for every quantile,
          interpolate within the bucket. Example:
            26.0°C to <27.0°C with 99% mass
            P10 -> around 26.1°C
            P50 -> around 26.5°C
            P90 -> around 26.9°C
        */
        const withinBucketProbability =
          (target - previousCumulative) / bucket.probability;

        const fraction = clampProbability(withinBucketProbability);

        return bucket.lower + width * fraction;
      }
    }

    const last = buckets[buckets.length - 1];

    return last ? last.upper : null;
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
    firstNumberAtPaths(forecastRecord, [
      ["estimatedFinalMaxC", "p10"],
      ["estimatedFinalDailyMaxC", "p10"],
      ["estimatedFinalDailyMax", "p10"],
      ["estimatedFinalMax", "p10"],
      ["finalDailyMax", "p10"],
      ["percentiles", "p10"],
      ["quantiles", "p10"],
      ["model", "estimatedFinalMaxC", "p10"],
      ["model", "estimatedFinalDailyMaxC", "p10"],
      ["model", "estimatedFinalDailyMax", "p10"],
      ["model", "estimatedFinalMax", "p10"],
      ["model", "percentiles", "p10"],
      ["model", "quantiles", "p10"],
      ["diagnostics", "estimatedFinalMaxC", "p10"],
      ["diagnostics", "estimatedFinalDailyMaxC", "p10"],
      ["diagnostics", "estimatedFinalDailyMax", "p10"],
      ["diagnostics", "estimatedFinalMax", "p10"],
      ["diagnostics", "percentiles", "p10"],
      ["diagnostics", "quantiles", "p10"]
    ]) ?? derived.p10;

  const p25 =
    firstNumberAtPaths(forecastRecord, [
      ["estimatedFinalMaxC", "p25"],
      ["estimatedFinalDailyMaxC", "p25"],
      ["estimatedFinalDailyMax", "p25"],
      ["estimatedFinalMax", "p25"],
      ["finalDailyMax", "p25"],
      ["percentiles", "p25"],
      ["quantiles", "p25"],
      ["model", "estimatedFinalMaxC", "p25"],
      ["model", "estimatedFinalDailyMaxC", "p25"],
      ["model", "estimatedFinalDailyMax", "p25"],
      ["model", "estimatedFinalMax", "p25"],
      ["model", "percentiles", "p25"],
      ["model", "quantiles", "p25"],
      ["diagnostics", "estimatedFinalMaxC", "p25"],
      ["diagnostics", "estimatedFinalDailyMaxC", "p25"],
      ["diagnostics", "estimatedFinalDailyMax", "p25"],
      ["diagnostics", "estimatedFinalMax", "p25"],
      ["diagnostics", "percentiles", "p25"],
      ["diagnostics", "quantiles", "p25"]
    ]) ?? derived.p25;

  const median =
    firstNumberAtPaths(forecastRecord, [
      ["estimatedFinalMaxC", "median"],
      ["estimatedFinalMaxC", "p50"],
      ["estimatedFinalDailyMaxC", "median"],
      ["estimatedFinalDailyMaxC", "p50"],
      ["estimatedFinalDailyMax", "median"],
      ["estimatedFinalDailyMax", "p50"],
      ["estimatedFinalMax", "median"],
      ["estimatedFinalMax", "p50"],
      ["finalDailyMax", "median"],
      ["finalDailyMax", "p50"],
      ["percentiles", "median"],
      ["percentiles", "p50"],
      ["quantiles", "median"],
      ["quantiles", "p50"],
      ["model", "estimatedFinalMaxC", "median"],
      ["model", "estimatedFinalMaxC", "p50"],
      ["model", "estimatedFinalDailyMaxC", "median"],
      ["model", "estimatedFinalDailyMaxC", "p50"],
      ["model", "estimatedFinalDailyMax", "median"],
      ["model", "estimatedFinalDailyMax", "p50"],
      ["model", "estimatedFinalMax", "median"],
      ["model", "estimatedFinalMax", "p50"],
      ["model", "percentiles", "median"],
      ["model", "percentiles", "p50"],
      ["model", "quantiles", "median"],
      ["model", "quantiles", "p50"],
      ["diagnostics", "estimatedFinalMaxC", "median"],
      ["diagnostics", "estimatedFinalMaxC", "p50"],
      ["diagnostics", "estimatedFinalDailyMaxC", "median"],
      ["diagnostics", "estimatedFinalDailyMaxC", "p50"],
      ["diagnostics", "estimatedFinalDailyMax", "median"],
      ["diagnostics", "estimatedFinalDailyMax", "p50"],
      ["diagnostics", "estimatedFinalMax", "median"],
      ["diagnostics", "estimatedFinalMax", "p50"],
      ["diagnostics", "percentiles", "median"],
      ["diagnostics", "percentiles", "p50"],
      ["diagnostics", "quantiles", "median"],
      ["diagnostics", "quantiles", "p50"]
    ]) ?? derived.median;

  const p75 =
    firstNumberAtPaths(forecastRecord, [
      ["estimatedFinalMaxC", "p75"],
      ["estimatedFinalDailyMaxC", "p75"],
      ["estimatedFinalDailyMax", "p75"],
      ["estimatedFinalMax", "p75"],
      ["finalDailyMax", "p75"],
      ["percentiles", "p75"],
      ["quantiles", "p75"],
      ["model", "estimatedFinalMaxC", "p75"],
      ["model", "estimatedFinalDailyMaxC", "p75"],
      ["model", "estimatedFinalDailyMax", "p75"],
      ["model", "estimatedFinalMax", "p75"],
      ["model", "percentiles", "p75"],
      ["model", "quantiles", "p75"],
      ["diagnostics", "estimatedFinalMaxC", "p75"],
      ["diagnostics", "estimatedFinalDailyMaxC", "p75"],
      ["diagnostics", "estimatedFinalDailyMax", "p75"],
      ["diagnostics", "estimatedFinalMax", "p75"],
      ["diagnostics", "percentiles", "p75"],
      ["diagnostics", "quantiles", "p75"]
    ]) ?? derived.p75;

  const p90 =
    firstNumberAtPaths(forecastRecord, [
      ["estimatedFinalMaxC", "p90"],
      ["estimatedFinalDailyMaxC", "p90"],
      ["estimatedFinalDailyMax", "p90"],
      ["estimatedFinalMax", "p90"],
      ["finalDailyMax", "p90"],
      ["percentiles", "p90"],
      ["quantiles", "p90"],
      ["model", "estimatedFinalMaxC", "p90"],
      ["model", "estimatedFinalDailyMaxC", "p90"],
      ["model", "estimatedFinalDailyMax", "p90"],
      ["model", "estimatedFinalMax", "p90"],
      ["model", "percentiles", "p90"],
      ["model", "quantiles", "p90"],
      ["diagnostics", "estimatedFinalMaxC", "p90"],
      ["diagnostics", "estimatedFinalDailyMaxC", "p90"],
      ["diagnostics", "estimatedFinalDailyMax", "p90"],
      ["diagnostics", "estimatedFinalMax", "p90"],
      ["diagnostics", "percentiles", "p90"],
      ["diagnostics", "quantiles", "p90"]
    ]) ?? derived.p90;

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

  const hkoMinSinceMidnightC = firstNumber(
    getAt(weatherForDisplay, ["sinceMidnight", "minTempC"]),
    getAt(weatherForDisplay, ["sinceMidnight", "minTemperatureC"]),
    getAt(weatherForDisplay, ["sinceMidnight", "minTemp"]),
    getAt(weatherForDisplay, ["sinceMidnight", "minTemperature"]),

    getAt(weatherForDisplay, ["hkoMinSinceMidnightC"]),
    getAt(weatherForDisplay, ["minSinceMidnightC"]),

    getAt(weatherForDisplay, ["hko", "minSinceMidnightC"]),
    getAt(weatherForDisplay, ["hko", "hkoMinSinceMidnightC"]),

    forecastRecord.hkoMinSinceMidnightC,
    forecastRecord.minSinceMidnightC,
    forecastRecord.observedMinSoFarC,
    forecastRecord.observedMinC,
    forecastRecord.minSoFarC
  );

  const officialForecastMaxC = firstNumber(
    getAt(weatherForDisplay, ["officialForecastMaxC"]),
    getAt(weatherForDisplay, ["hkoOfficialForecastMaxC"]),
    getAt(weatherForDisplay, ["forecastMaxC"]),
    getAt(weatherForDisplay, ["hko", "officialForecastMaxC"]),
    getAt(weatherForDisplay, ["hko", "hkoOfficialForecastMaxC"]),
    getAt(weatherForDisplay, ["hko", "forecastMaxC"]),

    forecastRecord.officialForecastMaxC,
    forecastRecord.hkoOfficialForecastMaxC,
    forecastRecord.forecastMaxC,
    forecastRecord.hkoForecastMaxC
  );

  const hourlyRainfallMm = firstNumber(
    getAt(weatherForDisplay, ["hourlyRainfallMm"]),
    getAt(weatherForDisplay, ["rainfallLastHourMm"]),
    getAt(weatherForDisplay, ["rainfallPastHourMm"]),
    getAt(weatherForDisplay, ["rainHourlyMm"]),
    getAt(weatherForDisplay, ["hko", "hourlyRainfallMm"]),
    getAt(weatherForDisplay, ["hko", "rainfallLastHourMm"]),

    forecastRecord.hourlyRainfallMm,
    forecastRecord.rainfallLastHourMm,
    forecastRecord.rainfallPastHourMm,
    forecastRecord.rainHourlyMm,
    forecastRecord.rainfallMm
  );

  const calculatedTopOutcome =
    [...outcomeProbabilities].sort(
      (a, b) =>
        (firstProbability(
          b.finalProbability,
          b.blendedProbability,
          b.probability
        ) ?? -Infinity) -
        (firstProbability(
          a.finalProbability,
          a.blendedProbability,
          a.probability
        ) ?? -Infinity)
    )[0] ?? null;

  const topOutcome = calculatedTopOutcome ?? forecastRecord.topOutcome ?? null;

  const explicitKeyDrivers =
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

  const keyDrivers =
    explicitKeyDrivers.length > 0
      ? explicitKeyDrivers
      : buildKeyDriversFallback({
          forecastRecord,
          outcomeProbabilities,
          weatherForDisplay,
          warnings,
          probabilityContext,
          maxSoFarC,
          maxSoFarSource,
          hkoCurrentTempC,
          hkoMaxSinceMidnightC,
          hkoMinSinceMidnightC,
          officialForecastMaxC,
          hourlyRainfallMm
        });

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
    keyDrivers,
    sourceStatus,
    estimatedFinalMaxC,
    estimatedFinalDailyMaxC: estimatedFinalMaxC,
    estimatedFinalDailyMax: estimatedFinalMaxC,
    percentiles: estimatedFinalMaxC,
    quantiles: estimatedFinalMaxC,
    maxSoFarC,
    maxSoFarSource,
    hkoCurrentTempC,
    hkoMaxSinceMidnightC,
    hkoMinSinceMidnightC,
    officialForecastMaxC,
    hourlyRainfallMm,
    observedMaxSoFarC: maxSoFarC,
    observedMaxSoFarSource: maxSoFarSource,
    observedFinalMaxLowerBoundC: maxSoFarC,
    observedFinalMaxLowerBoundSource: maxSoFarSource,
    observedFinalMaxLowerBoundPath: observedMaxCandidate?.path ?? null,
    sourceDiagnostics: {
      ...recordOrEmpty(
        getAt(forecastRecord, ["diagnostics", "sourceDiagnostics"])
      ),
      ...recordOrEmpty(getAt(weatherForDisplay, ["sourceDiagnostics"])),
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

    hkoMinSinceMidnightC,
    minSinceMidnightC: hkoMinSinceMidnightC,

    officialForecastMaxC,
    hkoOfficialForecastMaxC: officialForecastMaxC,
    forecastMaxC: officialForecastMaxC,

    hourlyRainfallMm,
    rainfallLastHourMm: hourlyRainfallMm,
    rainfallPastHourMm: hourlyRainfallMm,
    rainHourlyMm: hourlyRainfallMm,

    hko: {
      ...recordOrEmpty(forecastRecord.hko),
      ...recordOrEmpty(getAt(weatherForDisplay, ["hko"])),
      currentTempC: hkoCurrentTempC,
      hkoCurrentTempC,
      maxSinceMidnightC: hkoMaxSinceMidnightC,
      hkoMaxSinceMidnightC,
      minSinceMidnightC: hkoMinSinceMidnightC,
      hkoMinSinceMidnightC,
      officialForecastMaxC,
      hkoOfficialForecastMaxC: officialForecastMaxC,
      forecastMaxC: officialForecastMaxC,
      hourlyRainfallMm,
      rainfallLastHourMm: hourlyRainfallMm,
      rainfallPastHourMm: hourlyRainfallMm,
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
  state: MarketState | null = null,
  structuredAdjustment: PoeStructuredAdjustmentRun | null = null,
): ForecastResult {
  const normalized = normalizeForecastResultForPage(
    forecast,
    aiCommentary,
    state,
  );

  const adjusted = applyPoeStructuredAdjustment(
    normalized,
    structuredAdjustment,
  );

  return enrichForecastWithTradeSignals(adjusted) as unknown as ForecastResult;
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
  structuredAdjustment: PoeStructuredAdjustmentRun | null;
}): Promise<HistorySaveResult> {
  if (!params.saveHistory) {
    return {
      saved: false,
      reason: "History save was not requested.",
    };
  }

  if (!params.state) {
    return {
      saved: false,
      reason: "Market state was not provided, so history was not saved.",
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
      params.state,
      params.structuredAdjustment,
    );

    return await saveForecastRun({
      hktDate: getForecastHktDate(params.forecast),
      state: params.state,
      weather: getAt(
        params.forecast,
        ["weather"],
      ) as unknown as HkoWeatherSnapshot,
      result: resultForHistory,
    });
  } catch (error) {
    console.error("Forecast history save error:", error);

    return {
      saved: false,
      reason:
        error instanceof Error
          ? error.message
          : "Failed to save forecast history.",
    };
  }
}

async function runForecast(options: RunForecastOptions) {
  const forecast = await getForecast(options);

  let structuredAdjustment: PoeStructuredAdjustmentRun | null = null;

  if (options.structuredAdjustment) {
    try {
      /**
       * Phase 4 should read the same normalized / repaired data
       * that the UI sees.
       */
      const normalizedForAdjustment = normalizeForecastResultForPage(
        forecast,
        null,
        options.state ?? null,
      );

      structuredAdjustment = await getPoeStructuredAdjustment(
        normalizedForAdjustment,
      );
    } catch (error) {
      console.error("Poe structured adjustment error:", error);

      structuredAdjustment = {
        enabled: true,
        applied: false,
        model:
          process.env.POE_STRUCTURED_ADJUSTMENT_MODEL ??
          process.env.POE_MODEL ??
          null,
        adjustment: null,
        error:
          error instanceof Error
            ? error.message
            : "Poe structured adjustment failed.",
        rawText: null,
      };
    }
  }

  let aiCommentary: AiCommentary = null;

  if (options.ai) {
    try {
      /**
       * Give Poe commentary the same normalized / repaired / Phase-4-adjusted data
       * that the UI sees. Otherwise commentary may explain pre-adjusted probabilities.
       */
      const normalizedForAiBase = normalizeForecastResultForPage(
        forecast,
        null,
        options.state ?? null,
      );

      const normalizedForAi = applyPoeStructuredAdjustment(
        normalizedForAiBase,
        structuredAdjustment,
      );

      const forecastForAi = {
        ...(normalizedForAi as unknown as Record<string, unknown>),
        aiInputMode: "multi_channel_forecast_json",
        multiChannelForecastJson: buildMultiChannelForecastJson(
          normalizedForAi,
        ),
        diagnostics: {
          ...recordOrEmpty(
            (normalizedForAi as unknown as Record<string, unknown>).diagnostics,
          ),
          aiInputMode: "multi_channel_forecast_json",
          poeInstruction:
            "Use only the supplied outcomeUniverse and outcomeProbabilities. Do not invent buckets such as '22°C or higher' unless it appears in outcomeUniverse.",
        },
      } as unknown as Forecast;

      aiCommentary = await getPoeForecastCommentary(forecastForAi);

      if (!getAiExplanationText(aiCommentary)) {
        aiCommentary = {
          explanation:
            "Poe AI explanation returned no content. Check your Poe environment variable and src/lib/poe.ts return shape.",
        };
      }
    } catch (error) {
      console.error("Poe AI commentary error:", error);

      aiCommentary = {
        explanation:
          error instanceof Error
            ? `Poe AI explanation failed: ${error.message}`
            : "Poe AI explanation failed.",
      };
    }
  

  const historySave = await saveHistoryIfRequested({
    saveHistory: Boolean(options.saveHistory),
    state: options.state ?? null,
    forecast,
    aiCommentary,
    structuredAdjustment,
  });

  return buildForecastPayload({
    forecast,
    aiCommentary,
    historySave,
    state: options.state ?? null,
    structuredAdjustment,
  });
}

  let aiCommentary: AiCommentary = null;

  if (options.ai) {
    try {
      /**
       * Give Poe the same normalized / repaired / Phase-4-adjusted data
       * that the UI sees. Otherwise Poe may explain pre-adjusted probabilities.
       */
      const normalizedForAiBase = normalizeForecastResultForPage(
        forecast,
        null,
        options.state ?? null,
      );

     const normalizedForAi = applyPoeStructuredAdjustment(
     normalizedForAiBase,
     structuredAdjustment,
    );

      const forecastForAi = {
        ...(normalizedForAi as unknown as Record<string, unknown>),
        aiInputMode: "multi_channel_forecast_json",
        multiChannelForecastJson: buildMultiChannelForecastJson(
          normalizedForAi,
        ),
        diagnostics: {
          ...recordOrEmpty(
            (normalizedForAi as unknown as Record<string, unknown>).diagnostics,
          ),
          aiInputMode: "multi_channel_forecast_json",
          poeInstruction:
            "Use only the supplied outcomeUniverse and outcomeProbabilities. Do not invent buckets such as '22°C or higher' unless it appears in outcomeUniverse.",
        },
      } as unknown as Forecast;

      aiCommentary = await getPoeForecastCommentary(forecastForAi);

      if (!getAiExplanationText(aiCommentary)) {
        aiCommentary = {
          explanation:
            "Poe AI explanation returned no content. Check your Poe environment variable and src/lib/poe.ts return shape.",
        };
      }
    } catch (error) {
      console.error("Poe AI commentary error:", error);

      aiCommentary = {
        explanation:
          error instanceof Error
            ? `Poe AI explanation failed: ${error.message}`
            : "Poe AI explanation failed.",
      };
    }
  

  const historySave = await saveHistoryIfRequested({
    saveHistory: Boolean(options.saveHistory),
    state: options.state ?? null,
    forecast,
    aiCommentary,
    structuredAdjustment,
  });

  return buildForecastPayload({
    forecast,
    aiCommentary,
    historySave,
    state: options.state ?? null,
    structuredAdjustment,
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const includeClob = parseBoolean(url.searchParams.get("includeClob"), true);
    const blendMarket = parseBoolean(url.searchParams.get("blendMarket"), true);
    const debug = parseBoolean(url.searchParams.get("debug"), false);

    /*
      Keep AI enabled by default because the UI expects an explanation.
      You can disable with ?ai=false.
    */
    const ai = parseBoolean(
      url.searchParams.get("ai") ?? url.searchParams.get("forceAI"),
      true,
    );

    const structuredAdjustment = parseBoolean(
      url.searchParams.get("structuredAdjustment") ??
        url.searchParams.get("poeStructuredAdjustment") ??
        url.searchParams.get("llmAdjustment") ??
        url.searchParams.get("phase4"),
      false,
    );

    const marketWeightOverride =
      parseNumber(url.searchParams.get("marketWeight")) ??
      parseNumber(url.searchParams.get("marketWeightOverride"));

    const payload = await runForecast({
      includeClob,
      blendMarket,
      includeRawSnapshot: debug,
      marketWeightOverride,
      ai,
      structuredAdjustment,
      saveHistory: false,
      state: null,
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Forecast API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate multi-channel forecast.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);

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
      Keep AI enabled by default because the UI expects an explanation.
      Body takes priority, query string is fallback.
    */
    const ai = parseBoolean(
      body.ai ??
        body.forceAI ??
        url.searchParams.get("ai") ??
        url.searchParams.get("forceAI"),
      true,
    );

    const structuredAdjustment = parseBoolean(
      body.structuredAdjustment ??
        body.poeStructuredAdjustment ??
        body.llmAdjustment ??
        body.phase4 ??
        url.searchParams.get("structuredAdjustment") ??
        url.searchParams.get("poeStructuredAdjustment") ??
        url.searchParams.get("llmAdjustment") ??
        url.searchParams.get("phase4"),
      false,
    );

    const state = parseMarketState(body.state);
    const saveHistory = parseBoolean(body.saveHistory, false);

    const marketWeightOverride =
      parseNumber(body.marketWeight) ??
      parseNumber(body.marketWeightOverride) ??
      parseNumber(url.searchParams.get("marketWeight")) ??
      parseNumber(url.searchParams.get("marketWeightOverride"));

    const payload = await runForecast({
      includeClob,
      blendMarket,
      includeRawSnapshot: debug,
      marketWeightOverride,
      ai,
      structuredAdjustment,
      saveHistory,
      state,
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Forecast API POST error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate multi-channel forecast.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
