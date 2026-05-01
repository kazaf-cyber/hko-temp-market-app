import { getHkoWeatherSnapshot } from "@/lib/hko";
import { getMarketState } from "@/lib/state";
import { getOpenMeteoForecast } from "@/lib/openmeteo";
import { getWindyForecast } from "@/lib/windy";
import { getPolymarketClobSnapshot } from "@/lib/polymarketClob";
import type { HkoWeatherSnapshot, OutcomeRange } from "@/types";
import type { OpenMeteoForecast } from "@/lib/openmeteo";
import type { WindyForecast } from "@/lib/windy";
import type { PolymarketClobSnapshot } from "@/lib/polymarketClob";
import { getPolymarketOutcomesFromInput } from "@/lib/polymarket";

export type MultiChannelDerivedSignals = {
  hkoCurrentTempC: number | null;
  hkoMaxSoFarC: number | null;
  openMeteoCurrentTempC: number | null;
  openMeteoFutureMaxC: number | null;
  windyFutureMaxC: number | null;
  multiModelFutureMaxC: number | null;
  rainProbabilityNext2hPct: number | null;
  cloudCoverNowPct: number | null;
  observedHourlyRainfallMm: number | null;
  clobMidpoints: Array<{
    outcomeName: string;
    midpoint: number | null;
    spread: number | null;
    gammaPrice: number | null;
  }>;
};

export type MultiChannelSnapshot = {
  generatedAt: string;
  hko: HkoWeatherSnapshot;
  openMeteo: OpenMeteoForecast | null;
  windy: WindyForecast | null;
  polymarketClob: PolymarketClobSnapshot | null;
  derived: MultiChannelDerivedSignals;
  errors: Array<{
    source: string;
    message: string;
  }>;
};

function maxNumber(values: Array<number | null | undefined>) {
  const nums = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  return nums.length > 0 ? Math.max(...nums) : null;
}

function firstNumber(values: Array<number | null | undefined>) {
  return (
    values.find(
      (value): value is number => typeof value === "number" && Number.isFinite(value)
    ) ?? null
  );
}

function nextHoursOpenMeteo(openMeteo: OpenMeteoForecast | null, hours: number) {
  if (!openMeteo) return [];

  const now = Date.now();

  return openMeteo.hourly.filter((point) => {
    const time = new Date(point.time).getTime();
    return time >= now && time <= now + hours * 60 * 60 * 1000;
  });
}

function nextHoursWindy(windy: WindyForecast | null, hours: number) {
  if (!windy || !windy.enabled) return [];

  const now = Date.now();

  return windy.hourly.filter((point) => {
    return (
      point.timestamp >= now &&
      point.timestamp <= now + hours * 60 * 60 * 1000
    );
  });
}

function deriveSignals(params: {
  hko: HkoWeatherSnapshot;
  openMeteo: OpenMeteoForecast | null;
  windy: WindyForecast | null;
  polymarketClob: PolymarketClobSnapshot | null;
}): MultiChannelDerivedSignals {
  const openMeteoNext18h = nextHoursOpenMeteo(params.openMeteo, 18);
  const openMeteoNext2h = nextHoursOpenMeteo(params.openMeteo, 2);
  const windyNext18h = nextHoursWindy(params.windy, 18);

  const openMeteoFutureMaxC = maxNumber(
    openMeteoNext18h.map((point) => point.temperature2mC)
  );

  const windyFutureMaxC = maxNumber(windyNext18h.map((point) => point.tempC));

  const rainProbabilityNext2hPct = maxNumber(
    openMeteoNext2h.map((point) => point.precipitationProbabilityPct)
  );

  const cloudCoverNowPct = firstNumber([
    params.openMeteo?.current?.cloudCoverPct,
    openMeteoNext2h[0]?.cloudCoverPct
  ]);

  const clobMidpoints =
    params.polymarketClob?.outcomes.map((item) => ({
      outcomeName: item.outcomeName,
      midpoint: item.midpoint,
      spread: item.spread,
      gammaPrice: item.gammaPrice
    })) ?? [];

  const hkoCurrentTempC = params.hko.current.hkoCurrentTempC ?? null;
const hkoMaxSoFarC =
  params.hko.sinceMidnight?.maxTempC ?? hkoCurrentTempC;

return {
  hkoCurrentTempC,
  hkoMaxSoFarC,
  openMeteoCurrentTempC: params.openMeteo?.current?.temperature2mC ?? null,
  openMeteoFutureMaxC,
  windyFutureMaxC,

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
  cloudCoverNowPct,
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

  const openMeteo =
    openMeteoResult.status === "fulfilled" ? openMeteoResult.value : null;

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
      message:
        windyResult.reason instanceof Error
          ? windyResult.reason.message
          : "Unknown Windy error"
    });
  }

  let polymarketClob: PolymarketClobSnapshot | null = null;

  if (params?.includeClob) {
    try {
      const outcomes =
        params.outcomes ?? (await getMarketState()).state.outcomes;

      polymarketClob = await getPolymarketClobSnapshot(outcomes);
    } catch (error) {
      errors.push({
        source: "polymarket-clob",
        message:
          error instanceof Error
            ? error.message
            : "Unknown Polymarket CLOB error"
      });
    }
  }

  const derived = deriveSignals({
    hko,
    openMeteo,
    windy,
    polymarketClob
  });

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
