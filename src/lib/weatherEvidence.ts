import type { MultiChannelSnapshot } from "@/lib/multichannel";

export type ConfidenceLabel = "low" | "medium" | "high";
export type AgreementLabel = "high" | "medium" | "low";

export type WeatherEvidence = {
  targetDateHkt: string;
  generatedAt: string;

  observed: {
    hkoCurrentTempC: number | null;
    hkoMaxSinceMidnightC: number | null;
    hkoMinSinceMidnightC: number | null;
    observedMaxLowerBoundC: number | null;
    observedHourlyRainfallMm: number | null;
  };

  temperatureGuidance: {
    hkoCurrentTempC: number | null;
    hkoMaxSinceMidnightC: number | null;
    observedMaxLowerBoundC: number | null;

    openMeteoCurrentTempC: number | null;
    openMeteoNext2hMaxC: number | null;
    openMeteoNext6hMaxC: number | null;
    openMeteoRemainingDayMaxC: number | null;

    windyNext2hMaxC: number | null;
    windyNext6hMaxC: number | null;
    windyRemainingDayMaxC: number | null;

    hkoOfficialForecastMaxC: number | null;
    modelFutureMeanC: number | null;
    adjustedFutureMeanC: number | null;
  };

  heating: {
    solarHeatingScore: number;
    shortwaveNowWm2: number | null;
    shortwaveRemainingMeanWm2: number | null;
    shortwaveRemainingMaxWm2: number | null;
    shortwaveRemainingEnergyMjM2: number | null;

    cloudCoverNowPct: number | null;
    lowCloudCoverNowPct: number | null;
    midCloudCoverNowPct: number | null;
    highCloudCoverNowPct: number | null;

    cloudCoolingPenaltyC: number;
    solarHeatingBonusC: number;
  };

  cooling: {
    rainCoolingScore: number;
    rainCoolingAdjustmentC: number;

    hkoObservedHourlyRainfallMm: number | null;
    rainProbabilityNext2hPct: number | null;
    rainProbabilityNext6hPct: number | null;

    precipitationNext2hMm: number | null;
    precipitationNext6hMm: number | null;
    precipitationRemainingDayMm: number | null;

    rainNext2hMm: number | null;
    rainNext6hMm: number | null;
    rainRemainingDayMm: number | null;

    reasons: string[];
  };

  airMass: {
    apparentTemperatureNowC: number | null;
    dewPointNowC: number | null;
    relativeHumidityNowPct: number | null;
    pressureMslNowHpa: number | null;
    surfacePressureNowHpa: number | null;
    visibilityNowM: number | null;

    windSpeedNowKmh: number | null;
    windGustNowKmh: number | null;
    windDirectionNowDeg: number | null;

    ventilationCoolingScore: number;
    humidAirMassScore: number;
  };

  uncertainty: {
    modelDisagreementC: number | null;
    openMeteoWindySpreadC: number | null;
    multiSourceSpreadC: number | null;
    sourceCount: number;
    agreementLabel: AgreementLabel;
    confidenceScore: number;
    confidenceLabel: ConfidenceLabel;
    uncertaintyAdjustmentC: number;
  };

  aiHints: string[];
};

type Numericish = number | string | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getAt(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }

    if (!isRecord(current)) return undefined;
    current = current[key];
  }

  return current;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsed = Number(trimmed.replace(/,/g, "").replace(/%$/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function maxNumber(values: unknown[]): number | null {
  const nums = values
    .map(asNumber)
    .filter((value): value is number => value !== null);

  return nums.length > 0 ? Math.max(...nums) : null;
}

function minNumber(values: unknown[]): number | null {
  const nums = values
    .map(asNumber)
    .filter((value): value is number => value !== null);

  return nums.length > 0 ? Math.min(...nums) : null;
}

function sumNumber(values: unknown[]): number | null {
  const nums = values
    .map(asNumber)
    .filter((value): value is number => value !== null);

  if (nums.length === 0) return null;
  return nums.reduce((acc, value) => acc + value, 0);
}

function meanNumber(values: unknown[]): number | null {
  const nums = values
    .map(asNumber)
    .filter((value): value is number => value !== null);

  if (nums.length === 0) return null;
  return nums.reduce((acc, value) => acc + value, 0) / nums.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundNumber(value: number | null | undefined, digits = 2): number | null {
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

function parseHktLikeTimeMs(value: unknown): number | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  const timestamp = hasTimezone ? Date.parse(normalized) : Date.parse(`${normalized}+08:00`);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function getRemainingOpenMeteoPoints(snapshot: MultiChannelSnapshot, now: Date, hours?: number) {
  const openMeteo = snapshot.openMeteo;
  if (!openMeteo) return [];

  const bounds = getHongKongDayBounds(now);
  const nowMs = now.getTime();

  const lowerBoundMs = Math.max(bounds.startMs, nowMs - 60 * 60 * 1000);
  const upperBoundMs =
    typeof hours === "number"
      ? Math.min(bounds.endMs, nowMs + hours * 60 * 60 * 1000)
      : bounds.endMs;

  return openMeteo.hourly.filter((point) => {
    const timestamp = parseHktLikeTimeMs(point.time);
    if (timestamp === null) return false;

    return timestamp >= lowerBoundMs && timestamp <= upperBoundMs;
  });
}

function getRemainingWindyPoints(snapshot: MultiChannelSnapshot, now: Date, hours?: number) {
  const windy = snapshot.windy;
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

function weightedAverage(values: Array<{ value: number | null; weight: number }>): number | null {
  let numerator = 0;
  let denominator = 0;

  for (const item of values) {
    if (item.value === null || !Number.isFinite(item.value)) continue;
    if (!Number.isFinite(item.weight) || item.weight <= 0) continue;

    numerator += item.value * item.weight;
    denominator += item.weight;
  }

  return denominator > 0 ? numerator / denominator : null;
}

function getOfficialForecastMaxC(snapshot: MultiChannelSnapshot): number | null {
  const firstForecastDay = snapshot.hko.forecast.days?.[0];

  return firstNumber([
    getAt(snapshot, ["derived", "officialForecastMaxC"]),
    getAt(snapshot, ["derived", "hkoOfficialForecastMaxC"]),
    getAt(snapshot, ["derived", "forecastMaxC"]),
    getAt(snapshot, ["derived", "hkoForecastMaxC"]),

    firstForecastDay?.forecastMaxtempC,
    getAt(firstForecastDay, ["forecastMaxtemp", "value"]),
    getAt(firstForecastDay, ["forecastMaxTemp", "value"]),
    getAt(firstForecastDay, ["forecastMaxTemperature", "value"]),

    getAt(snapshot, ["hko", "officialForecastMaxC"]),
    getAt(snapshot, ["hko", "forecastMaxC"]),
    getAt(snapshot, ["hko", "localForecast", "forecastMaxtemp", "value"]),
    getAt(snapshot, ["hko", "nineDayWeatherForecast", "0", "forecastMaxtemp", "value"]),
    getAt(snapshot, ["hko", "raw", "weatherForecast", "0", "forecastMaxtemp", "value"])
  ]);
}

function getHkoCurrentTempC(snapshot: MultiChannelSnapshot): number | null {
  return firstNumber([
    getAt(snapshot, ["derived", "hkoCurrentTempC"]),
    snapshot.hko.current.hkoCurrentTempC,
    getAt(snapshot, ["hko", "current", "currentTempC"]),
    getAt(snapshot, ["hko", "current", "temperatureC"]),
    getAt(snapshot, ["hko", "temperatureC"])
  ]);
}

function getHkoMaxSinceMidnightC(snapshot: MultiChannelSnapshot): number | null {
  return maxNumber([
    getAt(snapshot, ["derived", "hkoMaxSoFarC"]),
    getAt(snapshot, ["derived", "hkoMaxSinceMidnightC"]),
    snapshot.hko.sinceMidnight?.maxTempC,
    getAt(snapshot, ["hko", "sinceMidnight", "maxTemperatureC"]),
    getHkoCurrentTempC(snapshot)
  ]);
}

function getHkoMinSinceMidnightC(snapshot: MultiChannelSnapshot): number | null {
  return minNumber([
    getAt(snapshot, ["derived", "hkoMinSinceMidnightC"]),
    snapshot.hko.sinceMidnight?.minTempC,
    getAt(snapshot, ["hko", "sinceMidnight", "minTemperatureC"])
  ]);
}

function getHourlyRainfallMm(snapshot: MultiChannelSnapshot): number | null {
  return firstNumber([
    getAt(snapshot, ["derived", "observedHourlyRainfallMm"]),
    getAt(snapshot, ["derived", "hourlyRainfallMm"]),
    snapshot.hko.hourlyRainfall?.rainfallMm,
    getAt(snapshot, ["hko", "hourlyRainfall", "value"]),
    getAt(snapshot, ["hko", "rainfallMm"])
  ]);
}

function estimateCloudCoolingPenaltyC(params: {
  cloudCoverNowPct: number | null;
  lowCloudCoverNowPct: number | null;
  shortwaveRemainingMeanWm2: number | null;
}) {
  let penalty = 0;

  const cloud = params.cloudCoverNowPct;
  const lowCloud = params.lowCloudCoverNowPct;
  const shortwave = params.shortwaveRemainingMeanWm2;

  if (cloud !== null) {
    if (cloud >= 95) penalty += 0.16;
    else if (cloud >= 85) penalty += 0.18;
    else if (cloud >= 70) penalty += 0.1;
    else if (cloud >= 55) penalty += 0.04;
  }

  if (lowCloud !== null) {
    if (lowCloud >= 80) penalty += 0.18;
    else if (lowCloud >= 60) penalty += 0.1;
    else if (lowCloud >= 40) penalty += 0.05;
  }

  if (shortwave !== null) {
    if (shortwave <= 80) penalty += 0.14;
    else if (shortwave <= 160) penalty += 0.08;
    else if (shortwave >= 450) penalty -= 0.08;
  }

  return clamp(penalty, 0, 0.45);
}

function estimateSolarHeatingScore(params: {
  hour: number;
  shortwaveRemainingMeanWm2: number | null;
  shortwaveRemainingMaxWm2: number | null;
  cloudCoverNowPct: number | null;
  lowCloudCoverNowPct: number | null;
}) {
  const { hour } = params;

  if (hour >= 18 || hour < 6) return 0;

  let score = 35;

  const meanShortwave = params.shortwaveRemainingMeanWm2;
  const maxShortwave = params.shortwaveRemainingMaxWm2;
  const cloud = params.cloudCoverNowPct;
  const lowCloud = params.lowCloudCoverNowPct;

  if (meanShortwave !== null) {
    score += clamp((meanShortwave - 150) / 5, -25, 35);
  }

  if (maxShortwave !== null) {
    score += clamp((maxShortwave - 350) / 20, -10, 15);
  }

  if (cloud !== null) {
    score -= clamp((cloud - 40) * 0.35, 0, 25);
  }

  if (lowCloud !== null) {
    score -= clamp((lowCloud - 35) * 0.4, 0, 25);
  }

  if (hour >= 10 && hour <= 14) score += 8;
  if (hour >= 15) score -= 10;

  return Math.round(clamp(score, 0, 100));
}

function estimateSolarHeatingBonusC(params: {
  hour: number;
  solarHeatingScore: number;
  shortwaveRemainingMeanWm2: number | null;
  cloudCoverNowPct: number | null;
}) {
  if (params.hour < 8 || params.hour >= 16) return 0;

  if (
    params.solarHeatingScore >= 78 &&
    (params.shortwaveRemainingMeanWm2 ?? 0) >= 420 &&
    (params.cloudCoverNowPct ?? 100) <= 50
  ) {
    return 0.30;
  }

  if (
    params.solarHeatingScore >= 65 &&
    (params.shortwaveRemainingMeanWm2 ?? 0) >= 300 &&
    (params.cloudCoverNowPct ?? 100) <= 65
  ) {
    return 0.18;
  }

  return 0;
}

function estimateRainCooling(params: {
  observedHourlyRainfallMm: number | null;
  rainProbabilityNext2hPct: number | null;
  rainProbabilityNext6hPct: number | null;
  precipitationNext2hMm: number | null;
  precipitationNext6hMm: number | null;
  rainNext2hMm: number | null;
  rainNext6hMm: number | null;
}) {
  let score = 0;
  let adjustment = 0;
  const reasons: string[] = [];

  const rainProb2h = params.rainProbabilityNext2hPct;
  const rainProb6h = params.rainProbabilityNext6hPct;
  const observedRain = params.observedHourlyRainfallMm;
  const precip2h = params.precipitationNext2hMm;
  const precip6h = params.precipitationNext6hMm;
  const rain2h = params.rainNext2hMm;
  const rain6h = params.rainNext6hMm;

  if (rainProb2h !== null) {
    if (rainProb2h >= 85) {
      score += 35;
      adjustment += 0.25;
      reasons.push("Very high next-2h rain probability suppresses heat upside.");
    } else if (rainProb2h >= 65) {
      score += 25;
      adjustment += 0.26;
      reasons.push("High next-2h rain probability lowers expected remaining-day maximum.");
    } else if (rainProb2h >= 45) {
      score += 13;
      adjustment += 0.12;
      reasons.push("Moderate next-2h rain probability adds cooling pressure.");
    }
  }

  if (rainProb6h !== null) {
    if (rainProb6h >= 85) {
      score += 22;
      adjustment += 0.2;
      reasons.push("High next-6h rain probability increases cooling / convective uncertainty.");
    } else if (rainProb6h >= 65) {
      score += 13;
      adjustment += 0.1;
      reasons.push("Next-6h rain risk modestly limits heating potential.");
    }
  }

  const shortRainMm = maxNumber([precip2h, rain2h]);
  const mediumRainMm = maxNumber([precip6h, rain6h]);

  if (shortRainMm !== null) {
    if (shortRainMm >= 5) {
      score += 20;
      adjustment += 0.24;
      reasons.push("Meaningful modelled precipitation in the next 2h supports cooling.");
    } else if (shortRainMm >= 1) {
      score += 10;
      adjustment += 0.1;
      reasons.push("Light modelled precipitation in the next 2h adds minor cooling.");
    }
  }

  if (mediumRainMm !== null) {
    if (mediumRainMm >= 10) {
      score += 15;
      adjustment += 0.16;
      reasons.push("Next-6h accumulated precipitation is high enough to cap heating.");
    } else if (mediumRainMm >= 3) {
      score += 8;
      adjustment += 0.08;
      reasons.push("Next-6h precipitation signal is mildly cooling.");
    }
  }

  if (observedRain !== null) {
    if (observedRain >= 10) {
      score += 18;
      adjustment += 0.22;
      reasons.push("Recent heavy observed HKO rainfall supports a cooler near-term profile.");
    } else if (observedRain >= 2) {
      score += 8;
      adjustment += 0.08;
      reasons.push("Recent observed HKO rainfall adds mild cooling pressure.");
    }
  }

  return {
    rainCoolingScore: Math.round(clamp(score, 0, 100)),
    rainCoolingAdjustmentC: roundNumber(clamp(adjustment, 0, 0.95), 3) ?? 0,
    reasons
  };
}

function estimateVentilationCoolingScore(params: {
  windSpeedNowKmh: number | null;
  windGustNowKmh: number | null;
}) {
  const wind = params.windSpeedNowKmh;
  const gust = params.windGustNowKmh;

  let score = 0;

  if (wind !== null) {
    if (wind >= 35) score += 35;
    else if (wind >= 25) score += 25;
    else if (wind >= 15) score += 12;
  }

  if (gust !== null) {
    if (gust >= 55) score += 25;
    else if (gust >= 40) score += 15;
    else if (gust >= 28) score += 8;
  }

  return Math.round(clamp(score, 0, 100));
}

function estimateHumidAirMassScore(params: {
  dewPointNowC: number | null;
  relativeHumidityNowPct: number | null;
}) {
  let score = 0;

  const dewPoint = params.dewPointNowC;
  const humidity = params.relativeHumidityNowPct;

  if (dewPoint !== null) {
    if (dewPoint >= 26) score += 45;
    else if (dewPoint >= 24) score += 35;
    else if (dewPoint >= 22) score += 22;
    else if (dewPoint >= 20) score += 12;
  }

  if (humidity !== null) {
    if (humidity >= 90) score += 30;
    else if (humidity >= 80) score += 20;
    else if (humidity >= 70) score += 10;
  }

  return Math.round(clamp(score, 0, 100));
}

function estimateAgreementLabel(spread: number | null): AgreementLabel {
  if (spread === null) return "medium";
  if (spread <= 0.45) return "high";
  if (spread <= 1.0) return "medium";
  return "low";
}

function estimateUncertaintyAdjustmentC(params: {
  modelDisagreementC: number | null;
  rainCoolingScore: number;
  sourceCount: number;
}) {
  let adjustment = 0;

  if (params.modelDisagreementC !== null) {
    adjustment += clamp(params.modelDisagreementC * 0.16, 0, 0.38);
  } else {
    adjustment += 0.08;
  }

  if (params.rainCoolingScore >= 70) adjustment += 0.14;
  else if (params.rainCoolingScore >= 45) adjustment += 0.08;

  if (params.sourceCount <= 1) adjustment += 0.16;
  else if (params.sourceCount <= 2) adjustment += 0.06;

  return roundNumber(clamp(adjustment, 0, 0.55), 3) ?? 0;
}

function estimateConfidence(params: {
  observedMaxLowerBoundC: number | null;
  hkoCurrentTempC: number | null;
  openMeteoRemainingDayMaxC: number | null;
  windyRemainingDayMaxC: number | null;
  hkoOfficialForecastMaxC: number | null;
  modelDisagreementC: number | null;
  sourceCount: number;
  hour: number;
}) {
  let score = 0.28;

  if (params.observedMaxLowerBoundC !== null) score += 0.22;
  if (params.hkoCurrentTempC !== null) score += 0.08;
  if (params.openMeteoRemainingDayMaxC !== null) score += 0.16;
  if (params.windyRemainingDayMaxC !== null) score += 0.12;
  if (params.hkoOfficialForecastMaxC !== null) score += 0.06;

  if (params.sourceCount >= 3) score += 0.08;
  else if (params.sourceCount <= 1) score -= 0.08;

  if (params.hour >= 15) score += 0.08;
  if (params.hour >= 18) score += 0.05;

  if (params.modelDisagreementC !== null) {
    if (params.modelDisagreementC >= 1.5) score -= 0.14;
    else if (params.modelDisagreementC >= 0.8) score -= 0.07;
  }

  const confidenceScore = clamp(score, 0.2, 0.9);
  const confidenceLabel: ConfidenceLabel =
    confidenceScore >= 0.72 ? "high" : confidenceScore >= 0.5 ? "medium" : "low";

  return {
    confidenceScore: roundNumber(confidenceScore, 4) ?? confidenceScore,
    confidenceLabel
  };
}

function buildAiHints(params: {
  observedMaxLowerBoundC: number | null;
  hkoOfficialForecastMaxC: number | null;
  openMeteoRemainingDayMaxC: number | null;
  windyRemainingDayMaxC: number | null;
  solarHeatingScore: number;
  rainCoolingScore: number;
  modelDisagreementC: number | null;
  agreementLabel: AgreementLabel;
  confidenceLabel: ConfidenceLabel;
}) {
  const hints: string[] = [];

  if (params.observedMaxLowerBoundC !== null) {
    hints.push(
      `HKO observed max lower bound is ${params.observedMaxLowerBoundC.toFixed(
        1
      )}°C and must be treated as a hard floor.`
    );
  }

  if (params.hkoOfficialForecastMaxC !== null) {
    hints.push(
      `Official HKO forecast max is ${params.hkoOfficialForecastMaxC.toFixed(
        1
      )}°C and should be treated as forecast guidance, not observation.`
    );
  }

  if (params.openMeteoRemainingDayMaxC !== null) {
    hints.push(
      `Open-Meteo remaining-day max guidance is ${params.openMeteoRemainingDayMaxC.toFixed(
        1
      )}°C.`
    );
  }

  if (params.windyRemainingDayMaxC !== null) {
    hints.push(
      `Windy remaining-day max guidance is ${params.windyRemainingDayMaxC.toFixed(1)}°C.`
    );
  }

  if (params.solarHeatingScore >= 70) {
    hints.push("Solar heating evidence is strong, so further daytime upside remains possible.");
  } else if (params.solarHeatingScore <= 25) {
    hints.push("Solar heating evidence is weak, so additional daytime upside is limited.");
  }

  if (params.rainCoolingScore >= 65) {
    hints.push("Rain / convection evidence is materially cooling and increases uncertainty.");
  } else if (params.rainCoolingScore >= 35) {
    hints.push("Rain evidence adds mild cooling pressure.");
  }

  if (params.modelDisagreementC !== null && params.modelDisagreementC >= 0.8) {
    hints.push(
      `Model disagreement is ${params.modelDisagreementC.toFixed(
        2
      )}°C, so bucket-boundary probabilities are less stable.`
    );
  }

  hints.push(`Model agreement is ${params.agreementLabel}; confidence is ${params.confidenceLabel}.`);

  return hints.slice(0, 8);
}

export function buildWeatherEvidenceFromSnapshot(
  snapshot: MultiChannelSnapshot,
  now = new Date()
): WeatherEvidence {
  const bounds = getHongKongDayBounds(now);

  const openMeteoNext2h = getRemainingOpenMeteoPoints(snapshot, now, 2);
  const openMeteoNext6h = getRemainingOpenMeteoPoints(snapshot, now, 6);
  const openMeteoRemaining = getRemainingOpenMeteoPoints(snapshot, now);

  const windyNext2h = getRemainingWindyPoints(snapshot, now, 2);
  const windyNext6h = getRemainingWindyPoints(snapshot, now, 6);
  const windyRemaining = getRemainingWindyPoints(snapshot, now);

  const hkoCurrentTempC = getHkoCurrentTempC(snapshot);
  const hkoMaxSinceMidnightC = getHkoMaxSinceMidnightC(snapshot);
  const hkoMinSinceMidnightC = getHkoMinSinceMidnightC(snapshot);
  const observedMaxLowerBoundC = maxNumber([hkoCurrentTempC, hkoMaxSinceMidnightC]);
  const observedHourlyRainfallMm = getHourlyRainfallMm(snapshot);

  const hkoOfficialForecastMaxC = getOfficialForecastMaxC(snapshot);

  const openMeteoCurrentTempC = firstNumber([
    snapshot.openMeteo?.current?.temperature2mC,
    getAt(snapshot, ["derived", "openMeteoCurrentTempC"])
  ]);

  const openMeteoNext2hMaxC = maxNumber(openMeteoNext2h.map((point) => point.temperature2mC));
  const openMeteoNext6hMaxC = maxNumber(openMeteoNext6h.map((point) => point.temperature2mC));
  const openMeteoRemainingDayMaxC = firstNumber([
    maxNumber(openMeteoRemaining.map((point) => point.temperature2mC)),
    getAt(snapshot, ["derived", "openMeteoRemainingDayMaxC"]),
    getAt(snapshot, ["derived", "openMeteoFutureMaxC"])
  ]);

  const windyNext2hMaxC = maxNumber(windyNext2h.map((point) => point.tempC));
  const windyNext6hMaxC = maxNumber(windyNext6h.map((point) => point.tempC));
  const windyRemainingDayMaxC = firstNumber([
    maxNumber(windyRemaining.map((point) => point.tempC)),
    getAt(snapshot, ["derived", "windyRemainingDayMaxC"]),
    getAt(snapshot, ["derived", "windyFutureMaxC"])
  ]);

  const modelFutureMeanC = weightedAverage([
    { value: openMeteoRemainingDayMaxC, weight: 0.48 },
    { value: windyRemainingDayMaxC, weight: 0.32 },
    { value: hkoOfficialForecastMaxC, weight: 0.2 }
  ]);

  const shortwaveNowWm2 = firstNumber([
    getAt(snapshot, ["openMeteo", "current", "shortwaveRadiationWm2"]),
    getAt(openMeteoNext2h[0], ["shortwaveRadiationWm2"])
  ]);

  const shortwaveRemainingMeanWm2 = meanNumber(
    openMeteoRemaining.map((point) => point.shortwaveRadiationWm2)
  );
  const shortwaveRemainingMaxWm2 = maxNumber(
    openMeteoRemaining.map((point) => point.shortwaveRadiationWm2)
  );

  // Hourly W/m² integrated across 1h buckets:
  // Wh/m² = W/m² * 1h; MJ/m² = Wh/m² * 0.0036.
  const shortwaveRemainingEnergyMjM2 =
    sumNumber(openMeteoRemaining.map((point) => point.shortwaveRadiationWm2)) === null
      ? null
      : roundNumber(
          (sumNumber(openMeteoRemaining.map((point) => point.shortwaveRadiationWm2)) ?? 0) *
            0.0036,
          3
        );

  const cloudCoverNowPct = firstNumber([
    getAt(snapshot, ["derived", "cloudCoverNowPct"]),
    snapshot.openMeteo?.current?.cloudCoverPct,
    getAt(openMeteoNext2h[0], ["cloudCoverPct"])
  ]);

  const lowCloudCoverNowPct = firstNumber([
    getAt(snapshot, ["derived", "lowCloudNowPct"]),
    getAt(openMeteoNext2h[0], ["cloudCoverLowPct"])
  ]);

  const midCloudCoverNowPct = firstNumber([
    getAt(snapshot, ["derived", "midCloudNowPct"]),
    getAt(openMeteoNext2h[0], ["cloudCoverMidPct"])
  ]);

  const highCloudCoverNowPct = firstNumber([
    getAt(snapshot, ["derived", "highCloudNowPct"]),
    getAt(openMeteoNext2h[0], ["cloudCoverHighPct"])
  ]);

  const solarHeatingScore = estimateSolarHeatingScore({
    hour: bounds.hour,
    shortwaveRemainingMeanWm2,
    shortwaveRemainingMaxWm2,
    cloudCoverNowPct,
    lowCloudCoverNowPct
  });

  const cloudCoolingPenaltyC = estimateCloudCoolingPenaltyC({
    cloudCoverNowPct,
    lowCloudCoverNowPct,
    shortwaveRemainingMeanWm2
  });

  const solarHeatingBonusC = estimateSolarHeatingBonusC({
    hour: bounds.hour,
    solarHeatingScore,
    shortwaveRemainingMeanWm2,
    cloudCoverNowPct
  });

  const rainProbabilityNext2hPct = firstNumber([
    getAt(snapshot, ["derived", "rainProbabilityNext2hPct"]),
    maxNumber(openMeteoNext2h.map((point) => point.precipitationProbabilityPct))
  ]);

  const rainProbabilityNext6hPct = firstNumber([
    getAt(snapshot, ["derived", "rainProbabilityNext6hPct"]),
    maxNumber(openMeteoNext6h.map((point) => point.precipitationProbabilityPct))
  ]);

  const precipitationNext2hMm = firstNumber([
    getAt(snapshot, ["derived", "precipitationNext2hMm"]),
    sumNumber(openMeteoNext2h.map((point) => point.precipitationMm))
  ]);

  const precipitationNext6hMm = firstNumber([
    getAt(snapshot, ["derived", "precipitationNext6hMm"]),
    sumNumber(openMeteoNext6h.map((point) => point.precipitationMm))
  ]);

  const precipitationRemainingDayMm = firstNumber([
    getAt(snapshot, ["derived", "precipitationRemainingDayMm"]),
    sumNumber(openMeteoRemaining.map((point) => point.precipitationMm))
  ]);

  const rainNext2hMm = firstNumber([
    getAt(snapshot, ["derived", "rainNext2hMm"]),
    sumNumber(openMeteoNext2h.map((point) => point.rainMm))
  ]);

  const rainNext6hMm = firstNumber([
    getAt(snapshot, ["derived", "rainNext6hMm"]),
    sumNumber(openMeteoNext6h.map((point) => point.rainMm))
  ]);

  const rainRemainingDayMm = firstNumber([
    getAt(snapshot, ["derived", "rainRemainingDayMm"]),
    sumNumber(openMeteoRemaining.map((point) => point.rainMm))
  ]);

  const rainCooling = estimateRainCooling({
    observedHourlyRainfallMm,
    rainProbabilityNext2hPct,
    rainProbabilityNext6hPct,
    precipitationNext2hMm,
    precipitationNext6hMm,
    rainNext2hMm,
    rainNext6hMm
  });

  const apparentTemperatureNowC = firstNumber([
    snapshot.openMeteo?.current?.apparentTemperatureC,
    getAt(openMeteoNext2h[0], ["apparentTemperatureC"])
  ]);

  const dewPointNowC = firstNumber([
    snapshot.openMeteo?.current?.dewPoint2mC,
    getAt(openMeteoNext2h[0], ["dewPoint2mC"]),
    getAt(snapshot, ["derived", "dewPointNowC"])
  ]);

  const relativeHumidityNowPct = firstNumber([
    snapshot.openMeteo?.current?.relativeHumidity2mPct,
    getAt(openMeteoNext2h[0], ["relativeHumidity2mPct"])
  ]);

  const pressureMslNowHpa = firstNumber([
    snapshot.openMeteo?.current?.pressureMslHpa,
    getAt(openMeteoNext2h[0], ["pressureMslHpa"])
  ]);

  const surfacePressureNowHpa = firstNumber([
    snapshot.openMeteo?.current?.surfacePressureHpa,
    getAt(openMeteoNext2h[0], ["surfacePressureHpa"])
  ]);

  const visibilityNowM = firstNumber([
    snapshot.openMeteo?.current?.visibilityM,
    getAt(openMeteoNext2h[0], ["visibilityM"])
  ]);

  const windSpeedNowKmh = firstNumber([
    getAt(snapshot, ["derived", "windSpeedNowKmh"]),
    snapshot.openMeteo?.current?.windSpeed10mKmh,
    getAt(openMeteoNext2h[0], ["windSpeed10mKmh"])
  ]);

  const windGustNowKmh = firstNumber([
    getAt(snapshot, ["derived", "windGustNowKmh"]),
    snapshot.openMeteo?.current?.windGusts10mKmh,
    getAt(openMeteoNext2h[0], ["windGusts10mKmh"])
  ]);

  const windDirectionNowDeg = firstNumber([
    snapshot.openMeteo?.current?.windDirection10mDeg,
    getAt(openMeteoNext2h[0], ["windDirection10mDeg"])
  ]);

  const ventilationCoolingScore = estimateVentilationCoolingScore({
    windSpeedNowKmh,
    windGustNowKmh
  });

  const humidAirMassScore = estimateHumidAirMassScore({
    dewPointNowC,
    relativeHumidityNowPct
  });

  const openMeteoWindySpreadC =
    openMeteoRemainingDayMaxC !== null && windyRemainingDayMaxC !== null
      ? Math.abs(openMeteoRemainingDayMaxC - windyRemainingDayMaxC)
      : null;

  const sourceGuidance = [
    openMeteoRemainingDayMaxC,
    windyRemainingDayMaxC,
    hkoOfficialForecastMaxC
  ].filter((value): value is number => value !== null);

  const multiSourceSpreadC =
    sourceGuidance.length >= 2
      ? Math.max(...sourceGuidance) - Math.min(...sourceGuidance)
      : openMeteoWindySpreadC;

  const sourceCount =
    (observedMaxLowerBoundC !== null || hkoOfficialForecastMaxC !== null ? 1 : 0) +
    (openMeteoRemainingDayMaxC !== null ? 1 : 0) +
    (windyRemainingDayMaxC !== null ? 1 : 0);

  const modelDisagreementC = firstNumber([
    getAt(snapshot, ["derived", "modelDisagreementC"]),
    openMeteoWindySpreadC,
    multiSourceSpreadC
  ]);

  const agreementLabel = estimateAgreementLabel(modelDisagreementC);

  const uncertaintyAdjustmentC = estimateUncertaintyAdjustmentC({
    modelDisagreementC,
    rainCoolingScore: rainCooling.rainCoolingScore,
    sourceCount
  });

  const confidence = estimateConfidence({
    observedMaxLowerBoundC,
    hkoCurrentTempC,
    openMeteoRemainingDayMaxC,
    windyRemainingDayMaxC,
    hkoOfficialForecastMaxC,
    modelDisagreementC,
    sourceCount,
    hour: bounds.hour
  });

  const combinedCoolingAdjustmentC = clamp(
    rainCooling.rainCoolingAdjustmentC + cloudCoolingPenaltyC - solarHeatingBonusC,
    -0.25,
    1.25
  );

  const adjustedFutureMeanC =
    modelFutureMeanC === null
      ? null
      : modelFutureMeanC - rainCooling.rainCoolingAdjustmentC - cloudCoolingPenaltyC + solarHeatingBonusC;

  const aiHints = buildAiHints({
    observedMaxLowerBoundC,
    hkoOfficialForecastMaxC,
    openMeteoRemainingDayMaxC,
    windyRemainingDayMaxC,
    solarHeatingScore,
    rainCoolingScore: rainCooling.rainCoolingScore,
    modelDisagreementC,
    agreementLabel,
    confidenceLabel: confidence.confidenceLabel
  });

  if (combinedCoolingAdjustmentC >= 0.5) {
    aiHints.push(
      `Net weather adjustment is cooling by about ${combinedCoolingAdjustmentC.toFixed(2)}°C.`
    );
  } else if (combinedCoolingAdjustmentC <= -0.1) {
    aiHints.push(
      `Net weather adjustment is warming by about ${Math.abs(combinedCoolingAdjustmentC).toFixed(
        2
      )}°C.`
    );
  }

  return {
    targetDateHkt: bounds.ymd,
    generatedAt: new Date().toISOString(),

    observed: {
      hkoCurrentTempC: roundNumber(hkoCurrentTempC, 2),
      hkoMaxSinceMidnightC: roundNumber(hkoMaxSinceMidnightC, 2),
      hkoMinSinceMidnightC: roundNumber(hkoMinSinceMidnightC, 2),
      observedMaxLowerBoundC: roundNumber(observedMaxLowerBoundC, 2),
      observedHourlyRainfallMm: roundNumber(observedHourlyRainfallMm, 2)
    },

    temperatureGuidance: {
      hkoCurrentTempC: roundNumber(hkoCurrentTempC, 2),
      hkoMaxSinceMidnightC: roundNumber(hkoMaxSinceMidnightC, 2),
      observedMaxLowerBoundC: roundNumber(observedMaxLowerBoundC, 2),

      openMeteoCurrentTempC: roundNumber(openMeteoCurrentTempC, 2),
      openMeteoNext2hMaxC: roundNumber(openMeteoNext2hMaxC, 2),
      openMeteoNext6hMaxC: roundNumber(openMeteoNext6hMaxC, 2),
      openMeteoRemainingDayMaxC: roundNumber(openMeteoRemainingDayMaxC, 2),

      windyNext2hMaxC: roundNumber(windyNext2hMaxC, 2),
      windyNext6hMaxC: roundNumber(windyNext6hMaxC, 2),
      windyRemainingDayMaxC: roundNumber(windyRemainingDayMaxC, 2),

      hkoOfficialForecastMaxC: roundNumber(hkoOfficialForecastMaxC, 2),
      modelFutureMeanC: roundNumber(modelFutureMeanC, 3),
      adjustedFutureMeanC: roundNumber(adjustedFutureMeanC, 3)
    },

    heating: {
      solarHeatingScore,
      shortwaveNowWm2: roundNumber(shortwaveNowWm2, 1),
      shortwaveRemainingMeanWm2: roundNumber(shortwaveRemainingMeanWm2, 1),
      shortwaveRemainingMaxWm2: roundNumber(shortwaveRemainingMaxWm2, 1),
      shortwaveRemainingEnergyMjM2,

      cloudCoverNowPct: roundNumber(cloudCoverNowPct, 1),
      lowCloudCoverNowPct: roundNumber(lowCloudCoverNowPct, 1),
      midCloudCoverNowPct: roundNumber(midCloudCoverNowPct, 1),
      highCloudCoverNowPct: roundNumber(highCloudCoverNowPct, 1),

      cloudCoolingPenaltyC: roundNumber(cloudCoolingPenaltyC, 3) ?? 0,
      solarHeatingBonusC: roundNumber(solarHeatingBonusC, 3) ?? 0
    },

    cooling: {
      rainCoolingScore: rainCooling.rainCoolingScore,
      rainCoolingAdjustmentC: rainCooling.rainCoolingAdjustmentC,

      hkoObservedHourlyRainfallMm: roundNumber(observedHourlyRainfallMm, 2),
      rainProbabilityNext2hPct: roundNumber(rainProbabilityNext2hPct, 1),
      rainProbabilityNext6hPct: roundNumber(rainProbabilityNext6hPct, 1),

      precipitationNext2hMm: roundNumber(precipitationNext2hMm, 2),
      precipitationNext6hMm: roundNumber(precipitationNext6hMm, 2),
      precipitationRemainingDayMm: roundNumber(precipitationRemainingDayMm, 2),

      rainNext2hMm: roundNumber(rainNext2hMm, 2),
      rainNext6hMm: roundNumber(rainNext6hMm, 2),
      rainRemainingDayMm: roundNumber(rainRemainingDayMm, 2),

      reasons: rainCooling.reasons
    },

    airMass: {
      apparentTemperatureNowC: roundNumber(apparentTemperatureNowC, 2),
      dewPointNowC: roundNumber(dewPointNowC, 2),
      relativeHumidityNowPct: roundNumber(relativeHumidityNowPct, 1),
      pressureMslNowHpa: roundNumber(pressureMslNowHpa, 1),
      surfacePressureNowHpa: roundNumber(surfacePressureNowHpa, 1),
      visibilityNowM: roundNumber(visibilityNowM, 0),

      windSpeedNowKmh: roundNumber(windSpeedNowKmh, 1),
      windGustNowKmh: roundNumber(windGustNowKmh, 1),
      windDirectionNowDeg: roundNumber(windDirectionNowDeg, 0),

      ventilationCoolingScore,
      humidAirMassScore
    },

    uncertainty: {
      modelDisagreementC: roundNumber(modelDisagreementC, 3),
      openMeteoWindySpreadC: roundNumber(openMeteoWindySpreadC, 3),
      multiSourceSpreadC: roundNumber(multiSourceSpreadC, 3),
      sourceCount,
      agreementLabel,
      confidenceScore: confidence.confidenceScore,
      confidenceLabel: confidence.confidenceLabel,
      uncertaintyAdjustmentC
    },

    aiHints
  };
}

export function getWeatherEvidenceNetAdjustmentC(evidence: WeatherEvidence) {
  return roundNumber(
    clamp(
      evidence.cooling.rainCoolingAdjustmentC +
        evidence.heating.cloudCoolingPenaltyC -
        evidence.heating.solarHeatingBonusC,
      -0.25,
      1.25
    ),
    3
  );
}
