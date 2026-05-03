import { getHkoWeatherSnapshot } from "@/lib/hko";
import { getMarketState } from "@/lib/state";
import { getOpenMeteoForecast } from "@/lib/openmeteo";
import { getWindyForecast } from "@/lib/windy";
import { getPolymarketClobSnapshot } from "@/lib/polymarketClob";
import { getPolymarketOutcomesFromInput } from "@/lib/polymarket";

import type { HkoWeatherSnapshot, OutcomeRange } from "@/types";
import type { OpenMeteoForecast } from "@/lib/openmeteo";
import type { WindyForecast } from "@/lib/windy";
import type { PolymarketClobSnapshot } from "@/lib/polymarketClob";

export type MultiChannelDerivedSignals = {
  // Existing / compatibility fields.
  hkoCurrentTempC: number | null;
  hkoMaxSoFarC: number | null;
  openMeteoCurrentTempC: number | null;
  openMeteoFutureMaxC: number | null;
  windyFutureMaxC: number | null;
  multiModelFutureMaxC: number | null;
  rainProbabilityNext2hPct: number | null;
  cloudCoverNowPct: number | null;
  observedHourlyRainfallMm: number | null;

  // PR-5 richer temperature guidance.
  hkoMinSinceMidnightC: number | null;
  hkoMaxSinceMidnightC: number | null;

  openMeteoNext2hMaxC: number | null;
  openMeteoNext6hMaxC: number | null;
  openMeteoRemainingDayMaxC: number | null;

  windyNext2hMaxC: number | null;
  windyNext6hMaxC: number | null;
  windyRemainingDayMaxC: number | null;

  // PR-5 rain / precipitation evidence.
  rainProbabilityNext6hPct: number | null;
  precipitationNext2hMm: number | null;
  precipitationNext6hMm: number | null;
  precipitationRemainingDayMm: number | null;
  rainNext2hMm: number | null;
  rainNext6hMm: number | null;
  rainRemainingDayMm: number | null;

  // PR-5 solar / cloud evidence.
  shortwaveNowWm2: number | null;
  shortwaveRemainingMeanWm2: number | null;
  shortwaveRemainingMaxWm2: number | null;
  shortwaveRemainingEnergyMjM2: number | null;

  lowCloudNowPct: number | null;
  midCloudNowPct: number | null;
  highCloudNowPct: number | null;

  // PR-5 air mass / ventilation.
  dewPointNowC: number | null;
  apparentTemperatureNowC: number | null;
  relativeHumidityNowPct: number | null;
  pressureMslNowHpa: number | null;
  surfacePressureNowHpa: number | null;
  visibilityNowM: number | null;
  windSpeedNowKmh: number | null;
  windGustNowKmh: number | null;
  windDirectionNowDeg: number | null;

  // PR-5 uncertainty.
  modelDisagreementC: number | null;
  sourceCount: number;

  clobMidpoints: Array<{
    outcomeName: string;

    /**
     * Preferred market probability from CLOB.
     */
    midpoint: number | null;

    /**
     * CLOB spread.
     */
    spread: number | null;

    /**
     * Backward-compatible alias for Gamma YES price.
     */
    gammaPrice: number | null;
    gammaYesPrice: number | null;
    gammaNoPrice: number | null;
    yesAsk: number | null;
    noAsk: number | null;
    yesBid: number | null;
  }>;
};

export type MultiChannelSnapshot = {
  generatedAt: string;
  hko: HkoWeatherSnapshot;
  openMeteo: OpenMeteoForecast | null;
  windy: WindyForecast | null;
  polymarketClob: PolymarketClobSnapshot | null;
  derived: MultiChannelDerivedSignals;
  errors: Array<{ source: string; message: string }>;
};

function maxNumber(values: Array<number | null | undefined>) {
  const nums = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  return nums.length > 0 ? Math.max(...nums) : null;
}

function sumNumber(values: Array<number | null | undefined>) {
  const nums = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  if (nums.length === 0) return null;

  return nums.reduce((acc, value) => acc + value, 0);
}

function meanNumber(values: Array<number | null | undefined>) {
  const nums = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  if (nums.length === 0) return null;

  return nums.reduce((acc, value) => acc + value, 0) / nums.length;
}

function firstNumber(values: Array<number | null | undefined>) {
  return (
    values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) ??
    null
  );
}

function roundNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

function parseHktTimeMs(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  const timestamp = hasTimezone ? Date.parse(normalized) : Date.parse(`${normalized}+08:00`);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function openMeteoWindow(openMeteo: OpenMeteoForecast | null, hours: number | null, now: Date) {
  if (!openMeteo) return [];

  const bounds = getHongKongDayBounds(now);
  const nowMs = now.getTime();

  const lowerBoundMs = Math.max(bounds.startMs, nowMs - 60 * 60 * 1000);
  const upperBoundMs =
    typeof hours === "number"
      ? Math.min(bounds.endMs, nowMs + hours * 60 * 60 * 1000)
      : bounds.endMs;

  return openMeteo.hourly.filter((point) => {
    const time = parseHktTimeMs(point.time);
    return time !== null && time >= lowerBoundMs && time <= upperBoundMs;
  });
}

function windyWindow(windy: WindyForecast | null, hours: number | null, now: Date) {
  if (!windy || !windy.enabled) return [];

  const bounds = getHongKongDayBounds(now);
  const nowMs = now.getTime();

  const lowerBoundMs = Math.max(bounds.startMs, nowMs - 90 * 60 * 1000);
  const upperBoundMs =
    typeof hours === "number"
      ? Math.min(bounds.endMs, nowMs + hours * 60 * 60 * 1000)
      : bounds.endMs;

  return windy.hourly.filter((point) => {
    return point.timestamp >= lowerBoundMs && point.timestamp <= upperBoundMs;
  });
}

function deriveSignals(params: {
  hko: HkoWeatherSnapshot;
  openMeteo: OpenMeteoForecast | null;
  windy: WindyForecast | null;
  polymarketClob: PolymarketClobSnapshot | null;
}): MultiChannelDerivedSignals {
  const now = new Date();

  const openMeteoNext2h = openMeteoWindow(params.openMeteo, 2, now);
  const openMeteoNext6h = openMeteoWindow(params.openMeteo, 6, now);
  const openMeteoRemaining = openMeteoWindow(params.openMeteo, null, now);

  const windyNext2h = windyWindow(params.windy, 2, now);
  const windyNext6h = windyWindow(params.windy, 6, now);
  const windyRemaining = windyWindow(params.windy, null, now);

  const openMeteoFutureMaxC = maxNumber(openMeteoRemaining.map((point) => point.temperature2mC));
  const windyFutureMaxC = maxNumber(windyRemaining.map((point) => point.tempC));

  const openMeteoNext2hMaxC = maxNumber(openMeteoNext2h.map((point) => point.temperature2mC));
  const openMeteoNext6hMaxC = maxNumber(openMeteoNext6h.map((point) => point.temperature2mC));
  const openMeteoRemainingDayMaxC = openMeteoFutureMaxC;

  const windyNext2hMaxC = maxNumber(windyNext2h.map((point) => point.tempC));
  const windyNext6hMaxC = maxNumber(windyNext6h.map((point) => point.tempC));
  const windyRemainingDayMaxC = windyFutureMaxC;

  const rainProbabilityNext2hPct = maxNumber(
    openMeteoNext2h.map((point) => point.precipitationProbabilityPct)
  );

  const rainProbabilityNext6hPct = maxNumber(
    openMeteoNext6h.map((point) => point.precipitationProbabilityPct)
  );

  const precipitationNext2hMm = sumNumber(openMeteoNext2h.map((point) => point.precipitationMm));
  const precipitationNext6hMm = sumNumber(openMeteoNext6h.map((point) => point.precipitationMm));
  const precipitationRemainingDayMm = sumNumber(
    openMeteoRemaining.map((point) => point.precipitationMm)
  );

  const rainNext2hMm = sumNumber(openMeteoNext2h.map((point) => point.rainMm));
  const rainNext6hMm = sumNumber(openMeteoNext6h.map((point) => point.rainMm));
  const rainRemainingDayMm = sumNumber(openMeteoRemaining.map((point) => point.rainMm));

  const cloudCoverNowPct = firstNumber([
    params.openMeteo?.current?.cloudCoverPct,
    openMeteoNext2h[0]?.cloudCoverPct
  ]);

  const lowCloudNowPct = firstNumber([openMeteoNext2h[0]?.cloudCoverLowPct]);
  const midCloudNowPct = firstNumber([openMeteoNext2h[0]?.cloudCoverMidPct]);
  const highCloudNowPct = firstNumber([openMeteoNext2h[0]?.cloudCoverHighPct]);

  const shortwaveNowWm2 = firstNumber([
    params.openMeteo?.current?.shortwaveRadiationWm2,
    openMeteoNext2h[0]?.shortwaveRadiationWm2
  ]);

  const shortwaveRemainingMeanWm2 = meanNumber(
    openMeteoRemaining.map((point) => point.shortwaveRadiationWm2)
  );

  const shortwaveRemainingMaxWm2 = maxNumber(
    openMeteoRemaining.map((point) => point.shortwaveRadiationWm2)
  );

  const shortwaveRemainingEnergyMjM2 =
    sumNumber(openMeteoRemaining.map((point) => point.shortwaveRadiationWm2)) === null
      ? null
      : (sumNumber(openMeteoRemaining.map((point) => point.shortwaveRadiationWm2)) ?? 0) * 0.0036;

  const dewPointNowC = firstNumber([
    params.openMeteo?.current?.dewPoint2mC,
    openMeteoNext2h[0]?.dewPoint2mC
  ]);

  const apparentTemperatureNowC = firstNumber([
    params.openMeteo?.current?.apparentTemperatureC,
    openMeteoNext2h[0]?.apparentTemperatureC
  ]);

  const relativeHumidityNowPct = firstNumber([
    params.openMeteo?.current?.relativeHumidity2mPct,
    openMeteoNext2h[0]?.relativeHumidity2mPct
  ]);

  const pressureMslNowHpa = firstNumber([
    params.openMeteo?.current?.pressureMslHpa,
    openMeteoNext2h[0]?.pressureMslHpa
  ]);

  const surfacePressureNowHpa = firstNumber([
    params.openMeteo?.current?.surfacePressureHpa,
    openMeteoNext2h[0]?.surfacePressureHpa
  ]);

  const visibilityNowM = firstNumber([
    params.openMeteo?.current?.visibilityM,
    openMeteoNext2h[0]?.visibilityM
  ]);

  const windSpeedNowKmh = firstNumber([
    params.openMeteo?.current?.windSpeed10mKmh,
    openMeteoNext2h[0]?.windSpeed10mKmh
  ]);

  const windGustNowKmh = firstNumber([
    params.openMeteo?.current?.windGusts10mKmh,
    openMeteoNext2h[0]?.windGusts10mKmh
  ]);

  const windDirectionNowDeg = firstNumber([
    params.openMeteo?.current?.windDirection10mDeg,
    openMeteoNext2h[0]?.windDirection10mDeg
  ]);

  const clobMidpoints =
    params.polymarketClob?.outcomes.map((item) => ({
      outcomeName: item.outcomeName,

      /**
       * Preferred Polymarket probability.
       */
      midpoint: item.midpoint,
      spread: item.spread,

      /**
       * Compatibility alias:
       * old code may expect gammaPrice, but new CLOB parser separates
       * Gamma YES and Gamma NO prices.
       */
      gammaPrice: item.gammaYesPrice,
      gammaYesPrice: item.gammaYesPrice,
      gammaNoPrice: item.gammaNoPrice,
      yesAsk: item.yesAsk,
      noAsk: item.noAsk,
      yesBid: item.yesBid
    })) ?? [];

  const hkoCurrentTempC = params.hko.current.hkoCurrentTempC ?? null;
  const hkoMaxSinceMidnightC = params.hko.sinceMidnight?.maxTempC ?? null;
  const hkoMinSinceMidnightC = params.hko.sinceMidnight?.minTempC ?? null;
  const hkoMaxSoFarC = hkoMaxSinceMidnightC ?? hkoCurrentTempC;

  const modelDisagreementC =
    openMeteoRemainingDayMaxC !== null && windyRemainingDayMaxC !== null
      ? Math.abs(openMeteoRemainingDayMaxC - windyRemainingDayMaxC)
      : null;

  const hkoSourceAvailable =
    hkoCurrentTempC !== null ||
    hkoMaxSoFarC !== null ||
    hkoMinSinceMidnightC !== null ||
    params.hko.forecast.days.length > 0 ||
    params.hko.hourlyRainfall?.rainfallMm !== null;

  const sourceCount =
    (hkoSourceAvailable ? 1 : 0) +
    (params.openMeteo !== null ? 1 : 0) +
    (params.windy?.enabled ? 1 : 0);

  return {
    hkoCurrentTempC,
    hkoMaxSoFarC,
    hkoMinSinceMidnightC,
    hkoMaxSinceMidnightC,

    openMeteoCurrentTempC: params.openMeteo?.current?.temperature2mC ?? null,
    openMeteoFutureMaxC,
    openMeteoNext2hMaxC,
    openMeteoNext6hMaxC,
    openMeteoRemainingDayMaxC,

    windyFutureMaxC,
    windyNext2hMaxC,
    windyNext6hMaxC,
    windyRemainingDayMaxC,

    /**
     * Important:
     * Future/daily max estimate must never ignore already observed HKO current temp.
     * If since-midnight max feed is unavailable, fall back to HKO current temp.
     */
    multiModelFutureMaxC: maxNumber([
      hkoMaxSoFarC,
      hkoCurrentTempC,
      openMeteoFutureMaxC,
      windyFutureMaxC
    ]),

    rainProbabilityNext2hPct,
    rainProbabilityNext6hPct,

    precipitationNext2hMm: roundNumber(precipitationNext2hMm, 3),
    precipitationNext6hMm: roundNumber(precipitationNext6hMm, 3),
    precipitationRemainingDayMm: roundNumber(precipitationRemainingDayMm, 3),

    rainNext2hMm: roundNumber(rainNext2hMm, 3),
    rainNext6hMm: roundNumber(rainNext6hMm, 3),
    rainRemainingDayMm: roundNumber(rainRemainingDayMm, 3),

    cloudCoverNowPct,
    lowCloudNowPct,
    midCloudNowPct,
    highCloudNowPct,

    shortwaveNowWm2,
    shortwaveRemainingMeanWm2: roundNumber(shortwaveRemainingMeanWm2, 3),
    shortwaveRemainingMaxWm2,
    shortwaveRemainingEnergyMjM2: roundNumber(shortwaveRemainingEnergyMjM2, 3),

    dewPointNowC,
    apparentTemperatureNowC,
    relativeHumidityNowPct,
    pressureMslNowHpa,
    surfacePressureNowHpa,
    visibilityNowM,
    windSpeedNowKmh,
    windGustNowKmh,
    windDirectionNowDeg,

    modelDisagreementC: roundNumber(modelDisagreementC, 3),
    sourceCount,

    observedHourlyRainfallMm: params.hko.hourlyRainfall?.rainfallMm ?? null,
    clobMidpoints
  };
}

export async function getMultiChannelSnapshot(params?: {
  outcomes?: OutcomeRange[];
  includeClob?: boolean;
  polymarketUrl?: string | null;
}): Promise<MultiChannelSnapshot> {
  const errors: MultiChannelSnapshot["errors"] = [];

  const hko = await getHkoWeatherSnapshot();

  const [openMeteoResult, windyResult] = await Promise.allSettled([
    getOpenMeteoForecast(),
    getWindyForecast()
  ]);

  const openMeteo = openMeteoResult.status === "fulfilled" ? openMeteoResult.value : null;

  if (openMeteoResult.status === "rejected") {
    errors.push({
      source: "open-meteo",
      message:
        openMeteoResult.reason instanceof Error
          ? openMeteoResult.reason.message
          : "Unknown Open-Meteo error"
    });
  }

  const windy = windyResult.status === "fulfilled" ? windyResult.value : null;

  if (windyResult.status === "rejected") {
    errors.push({
      source: "windy",
      message: windyResult.reason instanceof Error ? windyResult.reason.message : "Unknown Windy error"
    });
  }

  let polymarketClob: PolymarketClobSnapshot | null = null;

  if (params?.includeClob) {
    try {
      let outcomes = params.outcomes ?? [];

      /**
       * If a Polymarket URL / slug is provided, treat it as the source of truth
       * for the current event.
       *
       * This is important for daily markets like:
       * "Highest temperature in Hong Kong on May 3?"
       *
       * The Admin / DB state may still contain token IDs from older daily markets.
       * If we reuse those stale token IDs, labels can look correct but prices
       * may come from the wrong event.
       */
      if (params.polymarketUrl) {
        const polymarket = await getPolymarketOutcomesFromInput(params.polymarketUrl);
        outcomes = polymarket.outcomes;
      } else if (!outcomes.length) {
        outcomes = (await getMarketState()).state.outcomes;
      }

      if (!outcomes.length) {
        throw new Error("No Polymarket outcomes are available for CLOB lookup.");
      }

      polymarketClob = await getPolymarketClobSnapshot(outcomes);
    } catch (error) {
      errors.push({
        source: "polymarket-clob",
        message: error instanceof Error ? error.message : "Unknown Polymarket CLOB error"
      });
    }
  }

  const derived = deriveSignals({ hko, openMeteo, windy, polymarketClob });

  return {
    generatedAt: new Date().toISOString(),
    hko,
    openMeteo,
    windy,
    polymarketClob,
    derived,
    errors
  };
}
