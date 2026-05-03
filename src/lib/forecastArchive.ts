import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type ForecastArchiveSource = "manual-ui" | "api" | "scheduler" | "test" | string;

export type ForecastArchiveOutcome = {
  outcomeName: string;
  minC: number | null;
  maxC: number | null;

  weatherProbability: number | null;
  finalProbability: number | null;
  marketProbability: number | null;

  edgeVsMarket: number | null;
};

export type ForecastArchiveRecord = {
  schemaVersion: "forecast-archive-v1";

  id: string;
  fingerprint: string;
  savedAt: string;
  source: ForecastArchiveSource;
  note: string | null;

  generatedAt: string | null;
  hktDate: string | null;
  version: string | null;

  market: {
    title: string | null;
    question: string | null;
    slug: string | null;
    url: string | null;
  };

  target: {
    observedMaxLowerBoundC: number | null;
    estimatedFinalMaxC: number | null;
    forecastFinalMaxMeanC: number | null;
    forecastFinalMaxStdDevC: number | null;
    confidenceLabel: string | null;
    confidenceScore: number | null;
    agreementLabel: string | null;
  };

  weatherEvidenceSummary: {
    hkoCurrentTempC: number | null;
    hkoMaxSinceMidnightC: number | null;
    hkoMinSinceMidnightC: number | null;
    observedMaxLowerBoundC: number | null;

    openMeteoRemainingDayMaxC: number | null;
    windyRemainingDayMaxC: number | null;
    hkoOfficialForecastMaxC: number | null;

    solarHeatingScore: number | null;
    rainCoolingScore: number | null;
    cloudCoolingPenaltyC: number | null;
    solarHeatingBonusC: number | null;

    rainProbabilityNext2hPct: number | null;
    rainProbabilityNext6hPct: number | null;
    precipitationRemainingDayMm: number | null;

    shortwaveRemainingMeanWm2: number | null;
    shortwaveRemainingMaxWm2: number | null;

    dewPointNowC: number | null;
    relativeHumidityNowPct: number | null;
    windSpeedNowKmh: number | null;
    windGustNowKmh: number | null;

    modelDisagreementC: number | null;
    sourceCount: number | null;

    aiHints: string[];
    coolingReasons: string[];
  };

  outcomeProbabilities: ForecastArchiveOutcome[];

  diagnostics: {
    errors: string[];
    warnings: string[];
  };

  rawForecast?: unknown;
};

export type CreateForecastArchiveRecordOptions = {
  source?: ForecastArchiveSource;
  note?: string | null;
  includeRawForecast?: boolean;
};

export type ReadForecastArchiveOptions = {
  limit?: number;
  hktDate?: string | null;
};

export type ForecastArchiveStats = {
  totalRecords: number;
  uniqueHktDates: number;
  latestSavedAt: string | null;
  earliestSavedAt: string | null;
  recordsByDate: Array<{
    hktDate: string;
    count: number;
    latestSavedAt: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPath(value: unknown, pathParts: string[]): unknown {
  let current: unknown = value;

  for (const part of pathParts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }

    if (!isRecord(current)) return undefined;
    current = current[part];
  }

  return current;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
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

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }

  return null;
}

function asStringArray(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => asString(item))
    .filter((item): item is string => item !== null)
    .slice(0, maxItems);
}

function firstString(value: unknown, paths: string[][]): string | null {
  for (const pathParts of paths) {
    const parsed = asString(readPath(value, pathParts));
    if (parsed !== null) return parsed;
  }

  return null;
}

function firstNumber(value: unknown, paths: string[][]): number | null {
  for (const pathParts of paths) {
    const parsed = asNumber(readPath(value, pathParts));
    if (parsed !== null) return parsed;
  }

  return null;
}

function firstBoolean(value: unknown, paths: string[][]): boolean | null {
  for (const pathParts of paths) {
    const parsed = asBoolean(readPath(value, pathParts));
    if (parsed !== null) return parsed;
  }

  return null;
}

function firstArray(value: unknown, paths: string[][]): unknown[] {
  for (const pathParts of paths) {
    const candidate = readPath(value, pathParts);
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeProbability(value: unknown): number | null {
  const parsed = asNumber(value);
  if (parsed === null) return null;

  /**
   * Accept both:
   * - 0.42
   * - 42
   */
  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;

  if (!Number.isFinite(normalized)) return null;
  return clamp(normalized, 0, 1);
}

function firstProbability(value: unknown, paths: string[][]): number | null {
  for (const pathParts of paths) {
    const parsed = normalizeProbability(readPath(value, pathParts));
    if (parsed !== null) return parsed;
  }

  return null;
}

function roundNumber(value: number | null | undefined, digits = 6): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sha256Short(value: unknown, length = 24): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, length);
}

function getArchiveFilePath() {
  const configured = process.env.FORECAST_ARCHIVE_FILE;

  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  return path.join(process.cwd(), "data", "forecast-archive.jsonl");
}

function extractOutcomeProbabilities(forecast: unknown): ForecastArchiveOutcome[] {
  const rows = firstArray(forecast, [
    ["outcomeProbabilities"],
    ["probabilities"],
    ["outcomes"],
    ["model", "outcomeProbabilities"],
    ["model", "probabilities"],
    ["market", "outcomes"],
    ["summary", "outcomeProbabilities"]
  ]);

  return rows
    .map((row, index): ForecastArchiveOutcome | null => {
      if (!isRecord(row)) return null;

      const outcomeName =
        firstString(row, [
          ["outcomeName"],
          ["name"],
          ["label"],
          ["title"],
          ["rangeLabel"],
          ["marketOutcomeName"],
          ["outcome", "outcomeName"],
          ["outcome", "name"],
          ["outcome", "label"]
        ]) ?? `Outcome ${index + 1}`;

      const minC = firstNumber(row, [
        ["minC"],
        ["lowerC"],
        ["lowerBoundC"],
        ["minTempC"],
        ["lowerTempC"],
        ["range", "minC"],
        ["range", "lowerC"],
        ["outcome", "minC"],
        ["outcome", "lowerC"],
        ["outcome", "lowerBoundC"]
      ]);

      const maxC = firstNumber(row, [
        ["maxC"],
        ["upperC"],
        ["upperBoundC"],
        ["maxTempC"],
        ["upperTempC"],
        ["range", "maxC"],
        ["range", "upperC"],
        ["outcome", "maxC"],
        ["outcome", "upperC"],
        ["outcome", "upperBoundC"]
      ]);

      const weatherProbability = firstProbability(row, [
        ["weatherProbability"],
        ["weatherProbabilityPct"],
        ["weatherProb"],
        ["modelProbability"],
        ["modelProbabilityPct"],
        ["probabilityWeather"],
        ["pWeather"]
      ]);

      const finalProbability = firstProbability(row, [
        ["finalProbability"],
        ["finalProbabilityPct"],
        ["probability"],
        ["probabilityPct"],
        ["blendedProbability"],
        ["modelBlendedProbability"],
        ["pFinal"]
      ]);

      const marketProbability = firstProbability(row, [
        ["marketProbability"],
        ["marketProbabilityPct"],
        ["clobProbability"],
        ["clobMidpoint"],
        ["marketMidpoint"],
        ["midpoint"],
        ["gammaPrice"],
        ["gammaYesPrice"],
        ["pMarket"]
      ]);

      const edgeVsMarket =
        finalProbability !== null && marketProbability !== null
          ? roundNumber(finalProbability - marketProbability, 6)
          : null;

      return {
        outcomeName,
        minC: roundNumber(minC, 3),
        maxC: roundNumber(maxC, 3),
        weatherProbability: roundNumber(weatherProbability, 6),
        finalProbability: roundNumber(finalProbability, 6),
        marketProbability: roundNumber(marketProbability, 6),
        edgeVsMarket
      };
    })
    .filter((row): row is ForecastArchiveOutcome => row !== null);
}

function extractErrors(forecast: unknown): string[] {
  const candidates = [
    ...asStringArray(readPath(forecast, ["errors"])),
    ...asStringArray(readPath(forecast, ["diagnostics", "errors"])),
    ...asStringArray(readPath(forecast, ["multiChannel", "errors"])),
    ...asStringArray(readPath(forecast, ["snapshot", "errors"]))
  ];

  return Array.from(new Set(candidates)).slice(0, 20);
}

function extractWarnings(forecast: unknown): string[] {
  const candidates = [
    ...asStringArray(readPath(forecast, ["warnings"])),
    ...asStringArray(readPath(forecast, ["diagnostics", "warnings"])),
    ...asStringArray(readPath(forecast, ["diagnostics", "assumptions"])),
    ...asStringArray(readPath(forecast, ["model", "warnings"]))
  ];

  return Array.from(new Set(candidates)).slice(0, 30);
}

export function createForecastArchiveRecord(
  forecast: unknown,
  options: CreateForecastArchiveRecordOptions = {}
): ForecastArchiveRecord {
  const savedAt = new Date().toISOString();

  const generatedAt = firstString(forecast, [
    ["generatedAt"],
    ["forecast", "generatedAt"],
    ["summary", "generatedAt"]
  ]);

  const hktDate = firstString(forecast, [
    ["hktDate"],
    ["targetDateHkt"],
    ["weatherEvidence", "targetDateHkt"],
    ["market", "hktDate"],
    ["forecast", "hktDate"]
  ]);

  const version = firstString(forecast, [
    ["version"],
    ["engineVersion"],
    ["forecastEngineVersion"],
    ["model", "version"]
  ]);

  const observedMaxLowerBoundC = firstNumber(forecast, [
    ["weatherEvidence", "observed", "observedMaxLowerBoundC"],
    ["weather", "observedMaxLowerBoundC"],
    ["weather", "observedMaxC"],
    ["observedMaxLowerBoundC"],
    ["observedMaxC"]
  ]);

  const forecastFinalMaxMeanC = firstNumber(forecast, [
    ["weather", "forecastFinalMaxMeanC"],
    ["model", "forecastFinalMaxMeanC"],
    ["model", "meanC"],
    ["forecastFinalMaxMeanC"]
  ]);

  const estimatedFinalMaxC = firstNumber(forecast, [
    ["estimatedFinalMaxC"],
    ["model", "estimatedFinalMaxC"],
    ["model", "estimatedFinalDailyMaxC"],
    ["weather", "estimatedFinalMaxC"],
    ["weather", "estimatedFinalDailyMaxC"],
    ["weather", "forecastFinalMaxMeanC"],
    ["model", "forecastFinalMaxMeanC"]
  ]);

  const forecastFinalMaxStdDevC = firstNumber(forecast, [
    ["weather", "forecastFinalMaxStdDevC"],
    ["model", "forecastFinalMaxStdDevC"],
    ["model", "stdDevC"],
    ["forecastFinalMaxStdDevC"]
  ]);

  const confidenceLabel = firstString(forecast, [
    ["weatherEvidence", "uncertainty", "confidenceLabel"],
    ["weather", "confidenceLabel"],
    ["model", "confidenceLabel"]
  ]);

  const confidenceScore = firstNumber(forecast, [
    ["weatherEvidence", "uncertainty", "confidenceScore"],
    ["weather", "confidenceScore"],
    ["model", "confidenceScore"]
  ]);

  const agreementLabel = firstString(forecast, [
    ["weatherEvidence", "uncertainty", "agreementLabel"],
    ["weather", "agreementLabel"],
    ["model", "agreementLabel"]
  ]);

  const outcomeProbabilities = extractOutcomeProbabilities(forecast);

  const fingerprintPayload = {
    generatedAt,
    hktDate,
    version,
    observedMaxLowerBoundC,
    estimatedFinalMaxC,
    forecastFinalMaxMeanC,
    forecastFinalMaxStdDevC,
    outcomeProbabilities
  };

  const fingerprint = sha256Short(fingerprintPayload);
  const safeDate = hktDate ?? "unknown-date";

  const includeRawForecast =
    options.includeRawForecast ?? process.env.FORECAST_ARCHIVE_INCLUDE_RAW === "1";

  const record: ForecastArchiveRecord = {
    schemaVersion: "forecast-archive-v1",

    id: `${safeDate}-${randomUUID()}`,
    fingerprint,
    savedAt,
    source: options.source ?? "api",
    note: options.note ?? null,

    generatedAt,
    hktDate,
    version,

    market: {
      title: firstString(forecast, [
        ["market", "title"],
        ["market", "eventTitle"],
        ["market", "eventName"],
        ["market", "name"]
      ]),
      question: firstString(forecast, [
        ["market", "question"],
        ["market", "description"],
        ["question"]
      ]),
      slug: firstString(forecast, [
        ["market", "slug"],
        ["market", "eventSlug"],
        ["polymarket", "slug"]
      ]),
      url: firstString(forecast, [
        ["market", "url"],
        ["market", "polymarketUrl"],
        ["polymarketUrl"],
        ["input", "polymarketUrl"]
      ])
    },

    target: {
      observedMaxLowerBoundC: roundNumber(observedMaxLowerBoundC, 3),
      estimatedFinalMaxC: roundNumber(estimatedFinalMaxC, 3),
      forecastFinalMaxMeanC: roundNumber(forecastFinalMaxMeanC, 3),
      forecastFinalMaxStdDevC: roundNumber(forecastFinalMaxStdDevC, 3),
      confidenceLabel,
      confidenceScore: roundNumber(confidenceScore, 6),
      agreementLabel
    },

    weatherEvidenceSummary: {
      hkoCurrentTempC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "observed", "hkoCurrentTempC"],
          ["weather", "hkoCurrentTempC"]
        ]),
        3
      ),
      hkoMaxSinceMidnightC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "observed", "hkoMaxSinceMidnightC"],
          ["weather", "hkoMaxSinceMidnightC"],
          ["weather", "hkoMaxSoFarC"]
        ]),
        3
      ),
      hkoMinSinceMidnightC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "observed", "hkoMinSinceMidnightC"],
          ["weather", "hkoMinSinceMidnightC"]
        ]),
        3
      ),
      observedMaxLowerBoundC: roundNumber(observedMaxLowerBoundC, 3),

      openMeteoRemainingDayMaxC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "temperatureGuidance", "openMeteoRemainingDayMaxC"],
          ["weather", "openMeteoRemainingDayMaxC"],
          ["weather", "openMeteoFutureMaxC"]
        ]),
        3
      ),
      windyRemainingDayMaxC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "temperatureGuidance", "windyRemainingDayMaxC"],
          ["weather", "windyRemainingDayMaxC"],
          ["weather", "windyFutureMaxC"]
        ]),
        3
      ),
      hkoOfficialForecastMaxC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "temperatureGuidance", "hkoOfficialForecastMaxC"],
          ["weather", "officialForecastMaxC"],
          ["officialForecastMaxC"]
        ]),
        3
      ),

      solarHeatingScore: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "heating", "solarHeatingScore"],
          ["weather", "solarHeatingScore"]
        ]),
        3
      ),
      rainCoolingScore: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "cooling", "rainCoolingScore"],
          ["weather", "rainCoolingScore"]
        ]),
        3
      ),
      cloudCoolingPenaltyC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "heating", "cloudCoolingPenaltyC"],
          ["weather", "cloudCoolingPenaltyC"]
        ]),
        3
      ),
      solarHeatingBonusC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "heating", "solarHeatingBonusC"],
          ["weather", "solarHeatingBonusC"]
        ]),
        3
      ),

      rainProbabilityNext2hPct: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "cooling", "rainProbabilityNext2hPct"],
          ["weather", "rainProbabilityNext2hPct"]
        ]),
        3
      ),
      rainProbabilityNext6hPct: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "cooling", "rainProbabilityNext6hPct"],
          ["weather", "rainProbabilityNext6hPct"]
        ]),
        3
      ),
      precipitationRemainingDayMm: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "cooling", "precipitationRemainingDayMm"],
          ["weather", "precipitationRemainingDayMm"]
        ]),
        3
      ),

      shortwaveRemainingMeanWm2: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "heating", "shortwaveRemainingMeanWm2"],
          ["weather", "shortwaveRemainingMeanWm2"]
        ]),
        3
      ),
      shortwaveRemainingMaxWm2: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "heating", "shortwaveRemainingMaxWm2"],
          ["weather", "shortwaveRemainingMaxWm2"]
        ]),
        3
      ),

      dewPointNowC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "airMass", "dewPointNowC"],
          ["weather", "dewPointNowC"]
        ]),
        3
      ),
      relativeHumidityNowPct: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "airMass", "relativeHumidityNowPct"],
          ["weather", "relativeHumidityNowPct"]
        ]),
        3
      ),
      windSpeedNowKmh: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "airMass", "windSpeedNowKmh"],
          ["weather", "windSpeedNowKmh"]
        ]),
        3
      ),
      windGustNowKmh: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "airMass", "windGustNowKmh"],
          ["weather", "windGustNowKmh"]
        ]),
        3
      ),

      modelDisagreementC: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "uncertainty", "modelDisagreementC"],
          ["weather", "modelDisagreementC"]
        ]),
        3
      ),
      sourceCount: roundNumber(
        firstNumber(forecast, [
          ["weatherEvidence", "uncertainty", "sourceCount"],
          ["weather", "sourceCount"]
        ]),
        0
      ),

      aiHints: asStringArray(readPath(forecast, ["weatherEvidence", "aiHints"]), 12),
      coolingReasons: asStringArray(readPath(forecast, ["weatherEvidence", "cooling", "reasons"]), 12)
    },

    outcomeProbabilities,

    diagnostics: {
      errors: extractErrors(forecast),
      warnings: extractWarnings(forecast)
    },

    ...(includeRawForecast ? { rawForecast: forecast } : {})
  };

  /**
   * Extra safety:
   * If archive caller accidentally sends only a small envelope like
   * { forecast, source }, try to detect that pattern.
   */
  const nestedForecast = isRecord(forecast) ? forecast.forecast : null;

  if (
    record.outcomeProbabilities.length === 0 &&
    record.generatedAt === null &&
    record.hktDate === null &&
    isRecord(nestedForecast)
  ) {
    return createForecastArchiveRecord(nestedForecast, options);
  }

  return record;
}

export async function appendForecastArchiveRecord(record: ForecastArchiveRecord) {
  const filePath = getArchiveFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function appendForecastSnapshot(
  forecast: unknown,
  options: CreateForecastArchiveRecordOptions = {}
) {
  const record = createForecastArchiveRecord(forecast, options);
  await appendForecastArchiveRecord(record);
  return record;
}

function isForecastArchiveRecord(value: unknown): value is ForecastArchiveRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === "forecast-archive-v1" &&
    typeof value.id === "string" &&
    typeof value.savedAt === "string"
  );
}

export async function readForecastArchive(
  options: ReadForecastArchiveOptions = {}
): Promise<ForecastArchiveRecord[]> {
  const filePath = getArchiveFilePath();

  let text = "";

  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      isRecord(error) &&
      typeof error.code === "string" &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }

  const records: ForecastArchiveRecord[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (isForecastArchiveRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      /**
       * Ignore malformed JSONL line.
       * We do not want one corrupted line to break dashboard history.
       */
    }
  }

  const filtered = options.hktDate
    ? records.filter((record) => record.hktDate === options.hktDate)
    : records;

  const sorted = filtered.sort((a, b) => {
    return Date.parse(b.savedAt) - Date.parse(a.savedAt);
  });

  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.floor(options.limit))
      : 100;

  return sorted.slice(0, limit);
}

export function buildForecastArchiveStats(records: ForecastArchiveRecord[]): ForecastArchiveStats {
  const byDate = new Map<string, { count: number; latestSavedAt: string }>();

  for (const record of records) {
    const key = record.hktDate ?? "unknown-date";
    const existing = byDate.get(key);

    if (!existing) {
      byDate.set(key, {
        count: 1,
        latestSavedAt: record.savedAt
      });
      continue;
    }

    existing.count += 1;

    if (Date.parse(record.savedAt) > Date.parse(existing.latestSavedAt)) {
      existing.latestSavedAt = record.savedAt;
    }
  }

  const savedTimes = records
    .map((record) => Date.parse(record.savedAt))
    .filter((value) => Number.isFinite(value));

  const latestSavedAt =
    savedTimes.length > 0 ? new Date(Math.max(...savedTimes)).toISOString() : null;

  const earliestSavedAt =
    savedTimes.length > 0 ? new Date(Math.min(...savedTimes)).toISOString() : null;

  return {
    totalRecords: records.length,
    uniqueHktDates: byDate.size,
    latestSavedAt,
    earliestSavedAt,
    recordsByDate: Array.from(byDate.entries())
      .map(([hktDate, value]) => ({
        hktDate,
        count: value.count,
        latestSavedAt: value.latestSavedAt
      }))
      .sort((a, b) => Date.parse(b.latestSavedAt) - Date.parse(a.latestSavedAt))
  };
}

export function resolveArchivedOutcomeFromMaxC(
  outcomes: ForecastArchiveOutcome[],
  realizedMaxC: number,
  options: {
    upperInclusive?: boolean;
  } = {}
): ForecastArchiveOutcome | null {
  if (!Number.isFinite(realizedMaxC)) return null;

  const upperInclusive = options.upperInclusive ?? false;

  return (
    outcomes.find((outcome) => {
      const lowerOk = outcome.minC === null || realizedMaxC >= outcome.minC;
      const upperOk =
        outcome.maxC === null ||
        (upperInclusive ? realizedMaxC <= outcome.maxC : realizedMaxC < outcome.maxC);

      return lowerOk && upperOk;
    }) ?? null
  );
}

export function computeArchivedForecastScores(params: {
  outcomes: ForecastArchiveOutcome[];
  realizedOutcomeName: string;
  probabilityField?: "weatherProbability" | "finalProbability" | "marketProbability";
}) {
  const probabilityField = params.probabilityField ?? "finalProbability";

  if (!params.outcomes.length) {
    return {
      brierScore: null,
      logLoss: null,
      winningProbability: null
    };
  }

  let brier = 0;
  let winningProbability: number | null = null;

  for (const outcome of params.outcomes) {
    const probability = outcome[probabilityField] ?? 0;
    const actual = outcome.outcomeName === params.realizedOutcomeName ? 1 : 0;

    brier += (probability - actual) ** 2;

    if (actual === 1) {
      winningProbability = probability;
    }
  }

  const clippedWinningProbability =
    winningProbability === null ? null : clamp(winningProbability, 1e-9, 1);

  return {
    brierScore: roundNumber(brier, 8),
    logLoss:
      clippedWinningProbability === null
        ? null
        : roundNumber(-Math.log(clippedWinningProbability), 8),
    winningProbability: roundNumber(winningProbability, 8)
  };
}

/**
 * Exported mostly for debugging / API response.
 */
export function getForecastArchiveDebugInfo() {
  return {
    filePath: getArchiveFilePath(),
    includeRawForecast: process.env.FORECAST_ARCHIVE_INCLUDE_RAW === "1"
  };
}
