import type {
  ForecastPercentiles,
  ForecastResult,
  HkoWeatherSnapshot,
  MarketState,
  OutcomeProbability,
  OutcomeRange,
  RainIntensity
} from "@/types";

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function randomNormal(mean: number, sd: number) {
  let u = 0;
  let v = 0;

  while (u === 0) {
    u = Math.random();
  }

  while (v === 0) {
    v = Math.random();
  }

  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + sd * z;
}

function percentile(sortedValues: number[], p: number) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function getHktParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour"))
  };
}

function getHktDateCompact() {
  const parts = getHktParts();
  return `${parts.year}${parts.month}${parts.day}`;
}

function getHktHour() {
  return getHktParts().hour;
}

function rainCoolingAdjustment(
  intensity: RainIntensity,
  rainProbability: number
) {
  const probabilityFactor = clamp(rainProbability, 0, 1);

  switch (intensity) {
    case "none":
      return 0;
    case "light":
      return -0.25 * probabilityFactor;
    case "moderate":
      return -0.8 * probabilityFactor;
    case "heavy":
      return -1.45 * probabilityFactor;
    case "thunderstorm":
      return -2.2 * probabilityFactor;
    default:
      return 0;
  }
}

function rainfallObservedAdjustment(rainfallMm: number | null) {
  if (rainfallMm === null) return 0;
  if (rainfallMm >= 30) return -1.4;
  if (rainfallMm >= 10) return -0.9;
  if (rainfallMm >= 2.5) return -0.45;
  if (rainfallMm > 0) return -0.15;
  return 0;
}

function cloudHeatingAdjustment(cloudCoverPct: number) {
  if (cloudCoverPct >= 95) return -0.85;
  if (cloudCoverPct >= 85) return -0.55;
  if (cloudCoverPct >= 70) return -0.3;
  if (cloudCoverPct >= 50) return -0.1;
  return 0.2;
}

function getRemainingHeatingPotential(nowHour: number) {
  if (nowHour < 9) return 2.2;
  if (nowHour < 11) return 1.7;
  if (nowHour < 13) return 1.1;
  if (nowHour < 15) return 0.65;
  if (nowHour < 17) return 0.25;
  return 0;
}

function getOfficialForecastMaxForToday(snapshot: HkoWeatherSnapshot) {
  const todayCompact = getHktDateCompact();

  const todayForecast = snapshot.forecast.days.find(
    (day) => day.forecastDate === todayCompact
  );

  if (typeof todayForecast?.forecastMaxtempC === "number") {
    return todayForecast.forecastMaxtempC;
  }

  return snapshot.forecast.days[0]?.forecastMaxtempC ?? null;
}

function determineMaxSoFar(snapshot: HkoWeatherSnapshot, state: MarketState) {
  if (typeof state.manualMaxOverrideC === "number") {
    return {
      value: state.manualMaxOverrideC,
      source: "manual_override" as const,
      autoMax: snapshot.sinceMidnight?.maxTempC ?? null
    };
  }

  if (typeof snapshot.sinceMidnight?.maxTempC === "number") {
    return {
      value: snapshot.sinceMidnight.maxTempC,
      source: "hko_since_midnight" as const,
      autoMax: snapshot.sinceMidnight.maxTempC
    };
  }

  if (typeof snapshot.current.hkoCurrentTempC === "number") {
    return {
      value: snapshot.current.hkoCurrentTempC,
      source: "current_temperature_fallback" as const,
      autoMax: null
    };
  }

  const fallback = getOfficialForecastMaxForToday(snapshot) ?? 20;

  return {
    value: fallback,
    source: "forecast_fallback" as const,
    autoMax: null
  };
}

function sampleFinalMax(params: {
  snapshot: HkoWeatherSnapshot;
  state: MarketState;
  maxSoFarC: number;
  officialForecastMaxC: number | null;
  simulations?: number;
}) {
  const simulations = params.simulations ?? 6000;
  const nowHour = getHktHour();
  const currentTempC =
    params.snapshot.current.hkoCurrentTempC ?? params.maxSoFarC;

  const observedRainfallMm =
    params.snapshot.hourlyRainfall?.rainfallMm ?? null;

  const heatingPotential = getRemainingHeatingPotential(nowHour);
  const officialAnchor =
    params.officialForecastMaxC ??
    Math.max(params.maxSoFarC + 0.5, currentTempC + heatingPotential);

  const cloudAdjustment = cloudHeatingAdjustment(params.state.cloudCoverPct);
  const observedRainAdjustment = rainfallObservedAdjustment(observedRainfallMm);

  const meanPotentialMax = Math.max(
    params.maxSoFarC,
    currentTempC + heatingPotential + cloudAdjustment + observedRainAdjustment,
    officialAnchor + cloudAdjustment * 0.6 + observedRainAdjustment * 0.5
  );

  const samples: number[] = [];

  for (let i = 0; i < simulations; i += 1) {
    const modelError = randomNormal(0, 0.45);
    const lateDaySpike = Math.max(0, randomNormal(0.1, 0.35));
    const stationNoise = randomNormal(0, 0.08);

    let scenarioMax = params.maxSoFarC + stationNoise;

    for (let hour = nowHour; hour <= 23; hour += 1) {
      const hourProgress =
        hour <= 15 ? clamp((hour - nowHour + 1) / Math.max(1, 15 - nowHour + 1), 0, 1) : 1;

      let temp =
        currentTempC +
        (meanPotentialMax - currentTempC) * hourProgress +
        modelError;

      if (hour > 15) {
        temp -= (hour - 15) * 0.28;
      }

      if (hour >= 11 && hour <= 16) {
        temp += lateDaySpike;
      }

      if (params.state.rainEtaMinutes !== null) {
        const minutesFromNow = (hour - nowHour) * 60;
        const etaErrorMinutes = randomNormal(0, 35);
        const effectiveEta = params.state.rainEtaMinutes + etaErrorMinutes;

        if (minutesFromNow >= effectiveEta && minutesFromNow <= effectiveEta + 180) {
          temp += rainCoolingAdjustment(
            params.state.expectedRainIntensity,
            params.state.rainProbability120m
          );
        } else if (
          minutesFromNow >= effectiveEta - 60 &&
          minutesFromNow < effectiveEta
        ) {
          temp +=
            rainCoolingAdjustment(
              params.state.expectedRainIntensity,
              params.state.rainProbability60m
            ) * 0.35;
        }
      }

      temp += randomNormal(0, 0.15);
      scenarioMax = Math.max(scenarioMax, temp);
    }

    samples.push(round1(scenarioMax));
  }

  return samples;
}

function calculatePercentiles(samples: number[]): ForecastPercentiles {
  const sorted = [...samples].sort((a, b) => a - b);

  return {
    p10: round1(percentile(sorted, 0.1)),
    p25: round1(percentile(sorted, 0.25)),
    median: round1(percentile(sorted, 0.5)),
    p75: round1(percentile(sorted, 0.75)),
    p90: round1(percentile(sorted, 0.9))
  };
}

function calculateOutcomeProbabilities(
  samples: number[],
  outcomes: OutcomeRange[]
): OutcomeProbability[] {
  return outcomes.map((outcome) => {
    const count = samples.filter((temp) => {
      const aboveLower = outcome.lower === null || temp >= outcome.lower;
      const belowUpper = outcome.upper === null || temp < outcome.upper;
      return aboveLower && belowUpper;
    }).length;

    return {
      ...outcome,
      probability: count / samples.length
    };
  });
}

function buildKeyDrivers(params: {
  snapshot: HkoWeatherSnapshot;
  state: MarketState;
  maxSoFarC: number;
  officialForecastMaxC: number | null;
}) {
  const drivers: string[] = [];

  const currentTempC = params.snapshot.current.hkoCurrentTempC;

  if (currentTempC !== null) {
    drivers.push(`HKO current temperature is ${currentTempC.toFixed(1)}°C.`);
  }

  if (params.snapshot.sinceMidnight?.maxTempC !== null) {
    drivers.push(
      `HKO maximum temperature since midnight is ${params.snapshot.sinceMidnight?.maxTempC?.toFixed(
        1
      )}°C.`
    );
  }

  drivers.push(`Model max-so-far input is ${params.maxSoFarC.toFixed(1)}°C.`);

  if (params.officialForecastMaxC !== null) {
    drivers.push(
      `Official HKO forecast maximum temperature anchor is ${params.officialForecastMaxC.toFixed(
        1
      )}°C.`
    );
  }

  if (params.snapshot.hourlyRainfall?.rainfallMm !== null) {
    drivers.push(
      `Observed HKO hourly rainfall is ${params.snapshot.hourlyRainfall?.rainfallMm?.toFixed(
        1
      )} mm.`
    );
  }

  if (params.state.rainEtaMinutes !== null) {
    drivers.push(
      `Rainband ETA is around ${params.state.rainEtaMinutes} minutes, with ${Math.round(
        params.state.rainProbability120m * 100
      )}% rain probability in the next 120 minutes.`
    );
  }

  drivers.push(
    `Expected rain intensity is ${params.state.expectedRainIntensity}; cloud cover input is ${params.state.cloudCoverPct}%.`
  );

  return drivers;
}

function buildWarnings(params: {
  state: MarketState;
  maxSoFarC: number;
  source: ForecastResult["maxSoFarSource"];
}) {
  const warnings: string[] = [];

  warnings.push(
    "This is a nowcast and probability model only. Final settlement must follow the official market rules and official HKO source."
  );

  if (params.source !== "hko_since_midnight") {
    warnings.push(
      "Max-so-far is not directly from the HKO since-midnight max/min feed. Treat this run with extra caution."
    );
  }

  const fraction = params.maxSoFarC - Math.floor(params.maxSoFarC);

  if (fraction >= 0.85 || fraction <= 0.15) {
    warnings.push(
      "Boundary risk: max-so-far is close to a whole-degree market boundary."
    );
  }

  if (params.state.rainEtaMinutes !== null && params.state.rainEtaMinutes <= 90) {
    warnings.push(
      "Rainband timing is a major uncertainty. If rain arrives later or misses HKO, hotter outcomes can recover."
    );
  }

  return warnings;
}

export function estimateForecast(
  snapshot: HkoWeatherSnapshot,
  state: MarketState
): Omit<ForecastResult, "aiExplanation"> {
  const officialForecastMaxC = getOfficialForecastMaxForToday(snapshot);
  const maxSoFar = determineMaxSoFar(snapshot, state);

  const samples = sampleFinalMax({
    snapshot,
    state,
    maxSoFarC: maxSoFar.value,
    officialForecastMaxC
  });

  return {
    generatedAt: new Date().toISOString(),
    hktDate: getHktDateCompact(),
    hkoCurrentTempC: snapshot.current.hkoCurrentTempC,
    autoMaxSoFarC: maxSoFar.autoMax,
    maxSoFarC: maxSoFar.value,
    maxSoFarSource: maxSoFar.source,
    officialForecastMaxC,
    observedHourlyRainfallMm: snapshot.hourlyRainfall?.rainfallMm ?? null,
    estimatedFinalMaxC: calculatePercentiles(samples),
    outcomeProbabilities: calculateOutcomeProbabilities(
      samples,
      state.outcomes
    ),
    keyDrivers: buildKeyDrivers({
      snapshot,
      state,
      maxSoFarC: maxSoFar.value,
      officialForecastMaxC
    }),
    warnings: buildWarnings({
      state,
      maxSoFarC: maxSoFar.value,
      source: maxSoFar.source
    })
  };
}
