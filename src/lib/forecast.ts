import { getMultiChannelSnapshot, type MultiChannelSnapshot } from "@/lib/multichannel";
import { getMarketState } from "@/lib/state";
import type { OutcomeRange } from "@/types";

export const FORECAST_ENGINE_VERSION = "multi-channel-v2.0.0";

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

type ClobRow = NonNullable<MultiChannelSnapshot["polymarketClob"]>["outcomes"][number];

export type ForecastWeatherInputs = {
  forecastTargetDate: string;
  hongKongHour: number;
  timeBand: "overnight" | "morning" | "midday" | "afternoon" | "evening";
  remainingSettlementHours: number;

  hkoCurrentTempC: number | null;
  observedMaxC: number | null;

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
  observedHourlyRainfallMm: number | null;

  modelDisagreementC: number | null;
  sourceCount: number;
  adjustmentReasons: string[];
};

export type ForecastOutcome = OutcomeRange & {
  index: number;
  rank: number;

  lower: number | null;
  upper: number | null;

  probability: number;
  probabilityPct: number;

  weatherProbability: number;
  weatherProbabilityPct: number;

  marketProbability: number | null;
  marketProbabilityPct: number | null;

  marketRawPrice: number | null;
  clobMidpoint: number | null;
  clobSpread: number | null;
  clobBuyPrice: number | null;
  clobSellPrice: number | null;
  gammaPrice: number | null;

  isImpossibleByObservedMax: boolean;
  explanationFactors: string[];
};

export type ForecastResult = {
  version: typeof FORECAST_ENGINE_VERSION;
  generatedAt: string;

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

  outcomes: ForecastOutcome[];
  topOutcome: ForecastOutcome | null;

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
    assumptions: string[];
  };

  multiChannel?: MultiChannelSnapshot;
};

export type GetForecastOptions = {
  includeClob?: boolean;
  blendMarket?: boolean;
  includeRawSnapshot?: boolean;
  marketWeightOverride?: number;
  now?: Date;
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

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsed = Number(trimmed);
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

function roundNumber(value: number | null | undefined, digits = 2): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function maxNumber(values: unknown[]): number | null {
  const nums = values
    .map(asNumber)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return nums.length > 0 ? Math.max(...nums) : null;
}

function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null) return parsed;
  }

  return null;
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

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

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

function getOpenMeteoRemainingDayMaxC(snapshot: MultiChannelSnapshot, now: Date): number | null {
  const openMeteo = snapshot.openMeteo;
  if (!openMeteo) return null;

  const bounds = getHongKongDayBounds(now);
  const nowMs = now.getTime();

  /*
    Include the current hourly bucket by allowing one hour of look-back.
    Example: if now is 13:45, Open-Meteo's 13:00 point is still relevant.
  */
  const lowerBoundMs = Math.max(bounds.startMs, nowMs - 60 * 60 * 1000);

  const values = openMeteo.hourly
    .filter((point) => {
      const timestamp = parseOpenMeteoTimeMs(point.time);
      if (timestamp === null) return false;

      return timestamp >= lowerBoundMs && timestamp <= bounds.endMs;
    })
    .map((point) => point.temperature2mC);

  values.push(openMeteo.current?.temperature2mC ?? null);

  return maxNumber(values);
}

function getWindyRemainingDayMaxC(snapshot: MultiChannelSnapshot, now: Date): number | null {
  const windy = snapshot.windy;
  if (!windy || !windy.enabled) return null;

  const bounds = getHongKongDayBounds(now);
  const nowMs = now.getTime();
  const lowerBoundMs = Math.max(bounds.startMs, nowMs - 90 * 60 * 1000);

  const values = windy.hourly
    .filter((point) => point.timestamp >= lowerBoundMs && point.timestamp <= bounds.endMs)
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
      reasons.push("Very high near-term rain probability suppresses upside temperature risk.");
    } else if (rainProbability >= 60) {
      cooling += 0.25;
      reasons.push("High near-term rain probability slightly lowers expected remaining-day maximum.");
    } else if (rainProbability >= 40) {
      cooling += 0.1;
      reasons.push("Moderate near-term rain probability adds mild cooling pressure.");
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
      reasons.push("Recent heavy observed rainfall supports a cooler near-term profile.");
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

  if (params.openMeteoRemainingDayMaxC === null && params.windyRemainingDayMaxC === null) {
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
  openMeteoRemainingDayMaxC: number | null;
  windyRemainingDayMaxC: number | null;
  modelDisagreementC: number | null;
  sourceErrors: SourceError[];
  hour: number;
}) {
  let score = 0.35;

  if (params.observedMaxC !== null) score += 0.18;
  if (params.hkoCurrentTempC !== null) score += 0.08;
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
    confidenceScore >= 0.72 ? "high" : confidenceScore >= 0.5 ? "medium" : "low";

  return {
    confidenceScore,
    confidenceLabel
  };
}

function computeWeatherInputs(snapshot: MultiChannelSnapshot, now: Date): ForecastWeatherInputs {
  const bounds = getHongKongDayBounds(now);
  const hongKongHour = bounds.hour;
  const remainingSettlementHours = Math.max(0, (bounds.endMs - now.getTime()) / (60 * 60 * 1000));

  const hkoCurrentTempC = asNumber(snapshot.derived.hkoCurrentTempC);
  const observedMaxC = asNumber(snapshot.derived.hkoMaxSoFarC);

  const openMeteoCurrentTempC = asNumber(snapshot.derived.openMeteoCurrentTempC);
  const openMeteoRemainingDayMaxC = getOpenMeteoRemainingDayMaxC(snapshot, now);
  const windyRemainingDayMaxC = getWindyRemainingDayMaxC(snapshot, now);

  const rainProbabilityNext2hPct = asNumber(snapshot.derived.rainProbabilityNext2hPct);
  const cloudCoverNowPct = asNumber(snapshot.derived.cloudCoverNowPct);
  const observedHourlyRainfallMm = asNumber(snapshot.derived.observedHourlyRainfallMm);

  const modelDisagreementC =
    openMeteoRemainingDayMaxC !== null && windyRemainingDayMaxC !== null
      ? Math.abs(openMeteoRemainingDayMaxC - windyRemainingDayMaxC)
      : null;

  const modelFutureMeanC = weightedAverage([
    {
      value: openMeteoRemainingDayMaxC,
      weight: 0.58
    },
    {
      value: windyRemainingDayMaxC,
      weight: 0.42
    }
  ]);

  const cooling = estimateCoolingAdjustment({
    rainProbabilityNext2hPct,
    cloudCoverNowPct,
    observedHourlyRainfallMm
  });

  let adjustedFutureMeanC =
    modelFutureMeanC ??
    firstNumber([hkoCurrentTempC, openMeteoCurrentTempC, observedMaxC]);

  if (adjustedFutureMeanC !== null && modelFutureMeanC !== null) {
    adjustedFutureMeanC -= cooling.coolingAdjustmentC;
  }

  /*
    Late-day cap:
    If HKO has already observed a maximum and it is late in the day,
    avoid letting a model point from the edge of the settlement window overstate remaining upside.
  */
  if (observedMaxC !== null && adjustedFutureMeanC !== null && adjustedFutureMeanC > observedMaxC) {
    let lateDayUpsideCapC: number | null = null;

    if (hongKongHour >= 21) {
      lateDayUpsideCapC = 0.1;
    } else if (hongKongHour >= 18) {
      lateDayUpsideCapC = 0.22;
    } else if (hongKongHour >= 16) {
      lateDayUpsideCapC = 0.45;
    }

    if (lateDayUpsideCapC !== null) {
      adjustedFutureMeanC = Math.min(adjustedFutureMeanC, observedMaxC + lateDayUpsideCapC);
    }
  }

  const forecastFinalMaxMeanC =
    observedMaxC !== null && adjustedFutureMeanC !== null
      ? Math.max(observedMaxC, adjustedFutureMeanC)
      : adjustedFutureMeanC ?? observedMaxC ?? hkoCurrentTempC ?? openMeteoCurrentTempC ?? null;

  const sourceCount =
    1 +
    (openMeteoRemainingDayMaxC !== null ? 1 : 0) +
    (windyRemainingDayMaxC !== null ? 1 : 0);

  const forecastFinalMaxStdDevC = estimateStdDevC({
    hour: hongKongHour,
    remainingSettlementHours,
    observedMaxC,
    openMeteoRemainingDayMaxC,
    windyRemainingDayMaxC,
    modelDisagreementC,
    rainProbabilityNext2hPct
  });

  return {
    forecastTargetDate: bounds.ymd,
    hongKongHour,
    timeBand: getTimeBand(hongKongHour),
    remainingSettlementHours: roundNumber(remainingSettlementHours, 2) ?? 0,

    hkoCurrentTempC: roundNumber(hkoCurrentTempC, 2),
    observedMaxC: roundNumber(observedMaxC, 2),

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
    observedHourlyRainfallMm: roundNumber(observedHourlyRainfallMm, 2),

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
    byName.set(normalizeName(item.outcomeName), item);
    byToken.set(item.tokenId, item);
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
  const tokenId = outcome.clobTokenId ?? outcome.tokenId;

  if (tokenId) {
    const byToken = lookups.byToken.get(tokenId);
    if (byToken) return byToken;
  }

  return lookups.byName.get(normalizeName(outcome.name)) ?? null;
}

function getMarketRawPrice(outcome: OutcomeRange, clob: ClobRow | null) {
  const midpoint = normalizePrice(clob?.midpoint);

  const syntheticMidpoint =
    clob?.buyPrice !== null &&
    clob?.buyPrice !== undefined &&
    clob?.sellPrice !== null &&
    clob?.sellPrice !== undefined
      ? normalizePrice((clob.buyPrice + clob.sellPrice) / 2)
      : null;

  const gammaFromClob = normalizePrice(clob?.gammaPrice);
  const gammaFromOutcome = normalizePrice(outcome.marketPrice);
  const priceFromOutcome = normalizePrice(outcome.price);

  return midpoint ?? syntheticMidpoint ?? gammaFromClob ?? gammaFromOutcome ?? priceFromOutcome;
}

function getAverageClobSpread(prepared: PreparedOutcome[]) {
  const spreads = prepared
    .map((item) => normalizePrice(item.clob?.spread))
    .filter((value): value is number => value !== null);

  if (spreads.length === 0) return null;

  return spreads.reduce((acc, value) => acc + value, 0) / spreads.length;
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

  if (
    typeof params.marketWeightOverride === "number" &&
    Number.isFinite(params.marketWeightOverride)
  ) {
    return clamp(params.marketWeightOverride, 0, 0.6);
  }

  const validMarketCount = params.prepared.filter((item) => item.marketRawPrice !== null).length;
  const coverage =
    params.prepared.length > 0 ? validMarketCount / params.prepared.length : 0;

  if (validMarketCount < 2 || coverage < 0.5) {
    return 0;
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

  weight *= clamp(coverage, 0.5, 1);

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
    factors.push("Observed HKO maximum has already reached or exceeded this range's upper bound.");
  }

  if (params.weather.observedMaxC !== null) {
    factors.push(`Observed max so far: ${params.weather.observedMaxC.toFixed(1)}°C.`);
  }

  if (params.weather.forecastFinalMaxMeanC !== null) {
    factors.push(
      `Forecast final daily max mean: ${params.weather.forecastFinalMaxMeanC.toFixed(2)}°C.`
    );
  }

  if (params.weather.modelDisagreementC !== null && params.weather.modelDisagreementC >= 0.8) {
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

  if (params.clob?.midpoint !== null && params.clob?.midpoint !== undefined) {
    factors.push(`CLOB midpoint available: ${params.clob.midpoint.toFixed(3)}.`);
  }

  return factors;
}

function formatPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
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
    pieces.push("No outcome probabilities available because no market outcomes are loaded.");
  }

  if (params.weather.observedMaxC !== null) {
    pieces.push(`HKO max so far is ${params.weather.observedMaxC.toFixed(1)}°C.`);
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
    pieces.push(`Market blend weight is ${(params.marketWeight * 100).toFixed(0)}%.`);
  } else {
    pieces.push("Market blend is disabled or insufficient market prices are available.");
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

  const noEligibleOutcomes = prepared.length > 0 && eligible.every((value) => !value);

  const weatherProbabilities = normalizeScores(
    prepared.map((item) => item.weatherScore),
    eligible
  );

  const marketValidCount = prepared.filter((item) => item.marketRawPrice !== null).length;
  const marketProbabilitiesAvailable =
    prepared.length > 0 &&
    marketValidCount >= 2 &&
    marketValidCount / prepared.length >= 0.5;

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
      return weatherProbability * (1 - marketWeight) + marketProbability * marketWeight;
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

    return {
      ...item.outcome,

      index: item.index,
      rank: rankByIndex.get(index) ?? index + 1,

      lower: item.lower,
      upper: item.upper,

      probability: roundNumber(probability, 8) ?? 0,
      probabilityPct: roundNumber(probability * 100, 4) ?? 0,

      weatherProbability: roundNumber(weatherProbability, 8) ?? 0,
      weatherProbabilityPct: roundNumber(weatherProbability * 100, 4) ?? 0,

      marketProbability: roundNumber(marketProbability, 8),
      marketProbabilityPct:
        marketProbability === null ? null : roundNumber(marketProbability * 100, 4),

      marketRawPrice: roundNumber(item.marketRawPrice, 8),

      clobMidpoint: roundNumber(item.clob?.midpoint, 8),
      clobSpread: roundNumber(item.clob?.spread, 8),
      clobBuyPrice: roundNumber(item.clob?.buyPrice, 8),
      clobSellPrice: roundNumber(item.clob?.sellPrice, 8),
      gammaPrice: roundNumber(item.clob?.gammaPrice ?? item.outcome.marketPrice ?? item.outcome.price, 8),

      isImpossibleByObservedMax: item.impossible,
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
  const marketCoverage =
    prepared.length > 0 ? marketValidCount / prepared.length : 0;

  const result: ForecastResult = {
    version: FORECAST_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),

    market: {
      loaded: params.outcomes.length > 0 && !params.marketStateError,
      title: asString(params.marketState.title) ?? asString(params.marketState.question),
      slug: asString(params.marketState.slug),
      eventSlug: asString(params.marketState.eventSlug),
      conditionId: asString(params.marketState.conditionId),
      marketId: asString(params.marketState.marketId),
      outcomeCount: params.outcomes.length,
      updatedAt: asString(params.marketState.updatedAt),
      fetchedAt: asString(params.marketState.fetchedAt),
      error: params.marketStateError ?? null
    },

    weather,

    model: {
      method: "same-day-temperature-distribution-with-market-blend",
      rangeConvention: "lower-inclusive-upper-exclusive",
      marketBlendEnabled: marketWeight > 0,
      marketWeight: roundNumber(marketWeight, 4) ?? 0,
      marketCoverage: roundNumber(marketCoverage, 4) ?? 0,
      averageClobSpread: roundNumber(averageClobSpread, 6),
      confidenceScore: roundNumber(confidence.confidenceScore, 4) ?? confidence.confidenceScore,
      confidenceLabel: confidence.confidenceLabel
    },

    outcomes,
    topOutcome,

    summary: buildSummary({
      weather,
      topOutcome,
      confidenceLabel: confidence.confidenceLabel,
      marketWeight
    }),

    diagnostics: {
      sourceStatus: {
        hko: true,
        openMeteo: params.snapshot.openMeteo !== null,
        windy: Boolean(params.snapshot.windy?.enabled),
        polymarketClob: Boolean(params.snapshot.polymarketClob?.enabled)
      },
      sourceErrors: params.snapshot.errors,
      marketStateError: params.marketStateError ?? null,
      noEligibleOutcomes,
      assumptions: [
        "Outcome ranges are treated as lower-inclusive and upper-exclusive.",
        "The forecast horizon is restricted to the remaining part of the current Hong Kong calendar day.",
        "The daily maximum cannot finish below the maximum already observed by HKO.",
        "Weather fair probabilities come from a normal distribution around the same-day final maximum estimate.",
        "When sufficient market prices are available, final probabilities blend weather fair probabilities with CLOB/Gamma-implied probabilities."
      ]
    }
  };

  if (includeRawSnapshot) {
    result.multiChannel = params.snapshot;
  }

  return result;
}

export async function getForecast(options: GetForecastOptions = {}): Promise<ForecastResult> {
  const includeClob = options.includeClob ?? true;

  let marketState: MarketStateLike = {};
  let marketStateError: string | null = null;

  try {
    const rawMarketState = await getMarketState();
    marketState = unwrapMarketState(rawMarketState);
  } catch (error) {
    marketStateError =
      error instanceof Error ? error.message : "Failed to load market state.";
  }

  const outcomes = extractOutcomes(marketState);

  const snapshot = await getMultiChannelSnapshot({
    outcomes,
    includeClob: includeClob && outcomes.length > 0
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
    market: forecast.market,
    weather: forecast.weather,
    model: forecast.model,
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
