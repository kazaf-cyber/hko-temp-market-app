from pathlib import Path
import re

ROOT = Path.cwd()

def path(rel: str) -> Path:
    return ROOT / rel

def read_file(rel: str) -> str:
    p = path(rel)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {rel}")
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")

def write_file(rel: str, content: str) -> None:
    p = path(rel)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content.replace("\r\n", "\n"), encoding="utf-8")

def replace_once(rel: str, old: str, new: str) -> None:
    content = read_file(rel)
    if old not in content:
        raise RuntimeError(f"Pattern not found in {rel}:\n{old[:500]}")
    content = content.replace(old, new, 1)
    write_file(rel, content)

def replace_all(rel: str, old: str, new: str) -> None:
    content = read_file(rel)
    if old not in content:
        raise RuntimeError(f"Pattern not found in {rel}:\n{old[:500]}")
    content = content.replace(old, new)
    write_file(rel, content)

def replace_regex(rel: str, pattern: str, new: str) -> None:
    content = read_file(rel)
    compiled = re.compile(pattern, re.S)
    content2, n = compiled.subn(lambda _m: new, content, count=1)
    if n != 1:
        raise RuntimeError(f"Regex pattern not found exactly once in {rel}:\n{pattern[:500]}")
    write_file(rel, content2)

def insert_before_once(rel: str, marker: str, insert: str) -> None:
    content = read_file(rel)
    if marker not in content:
        raise RuntimeError(f"Insert marker not found in {rel}:\n{marker[:500]}")
    content = content.replace(marker, insert + marker, 1)
    write_file(rel, content)

print("Applying target-date fix...")

# ---------------------------------------------------------------------
# 1. Create / overwrite src/lib/targetDate.ts
# ---------------------------------------------------------------------

write_file("src/lib/targetDate.ts", r'''// src/lib/targetDate.ts

const MONTHS: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "05",
  june: "06",
  jun: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  october: "10",
  oct: "10",
  november: "11",
  nov: "11",
  december: "12",
  dec: "12"
};

export function normalizeISODate(input: unknown): string | null {
  const s = String(input ?? "").trim();

  if (!s) {
    return null;
  }

  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (!m) {
    return null;
  }

  const year = m[1];
  const month = m[2].padStart(2, "0");
  const day = m[3].padStart(2, "0");

  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);

  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) {
    return null;
  }

  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return null;
  }

  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== mo ||
    date.getUTCDate() !== d
  ) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

export function getHktTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to format HKT date");
  }

  return `${year}-${month}-${day}`;
}

export function isTargetTodayHkt(targetDate: string, now = new Date()): boolean {
  const normalized = normalizeISODate(targetDate);

  if (!normalized) {
    return false;
  }

  return normalized === getHktTodayISO(now);
}

export function zhDateLabel(isoDate: string): string {
  const normalized = normalizeISODate(isoDate);

  if (!normalized) {
    return String(isoDate);
  }

  const [, month, day] = normalized.split("-");

  return `${Number(month)}月${Number(day)}日`;
}

export function yyyymmdd(isoDate: string): string {
  const normalized = normalizeISODate(isoDate);

  if (!normalized) {
    return "";
  }

  return normalized.replace(/-/g, "");
}

export function extractTargetDateFromText(input: unknown): string | null {
  const s = String(input ?? "").trim();

  if (!s) {
    return null;
  }

  /*
    Polymarket slug / URL style:
      highest-temperature-in-hong-kong-on-may-2-2026
      highest-temperature-in-hong-kong-on-may-2-2026-21corbelow
      https://polymarket.com/.../highest-temperature-in-hong-kong-on-may-2-2026
  */
  const slugMatch = s.match(
    /(?:^|[-/])on-(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)-(\d{1,2})-(\d{4})(?:[-/?#&]|$)/i
  );

  if (slugMatch) {
    const monthName = slugMatch[1].toLowerCase();
    const day = slugMatch[2].padStart(2, "0");
    const year = slugMatch[3];
    const month = MONTHS[monthName];

    if (month) {
      return normalizeISODate(`${year}-${month}-${day}`);
    }
  }

  /*
    More generic slug:
      may-2-2026
  */
  const genericSlugMatch = s.match(
    /(?:^|[-/\s])(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)-(\d{1,2})-(\d{4})(?:[-/\s?#&]|$)/i
  );

  if (genericSlugMatch) {
    const monthName = genericSlugMatch[1].toLowerCase();
    const day = genericSlugMatch[2].padStart(2, "0");
    const year = genericSlugMatch[3];
    const month = MONTHS[monthName];

    if (month) {
      return normalizeISODate(`${year}-${month}-${day}`);
    }
  }

  /*
    Text style:
      on May 2, 2026
      on May 2 2026
  */
  const textMatchWithYear = s.match(
    /\bon\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );

  if (textMatchWithYear) {
    const monthName = textMatchWithYear[1].toLowerCase();
    const day = textMatchWithYear[2].padStart(2, "0");
    const year = textMatchWithYear[3];
    const month = MONTHS[monthName];

    if (month) {
      return normalizeISODate(`${year}-${month}-${day}`);
    }
  }

  return null;
}

export function extractOutcomeTargetDates(outcomes: unknown): string[] {
  if (!Array.isArray(outcomes)) {
    return [];
  }

  const dates = new Set<string>();

  for (const row of outcomes) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const r = row as Record<string, unknown>;

    const candidates = [
      r.marketSlug,
      r.slug,
      r.eventSlug,
      r.question,
      r.title,
      r.name,
      r.description,
      r.url,
      r.marketUrl
    ];

    for (const candidate of candidates) {
      const parsed = extractTargetDateFromText(candidate);

      if (parsed) {
        dates.add(parsed);
      }
    }
  }

  return Array.from(dates).sort();
}

export function resolveTargetDate(args: {
  explicitDate?: unknown;
  outcomes?: unknown;
  texts?: unknown[];
  now?: Date;
}): string {
  const explicit = normalizeISODate(args.explicitDate);

  if (explicit) {
    return explicit;
  }

  for (const text of args.texts ?? []) {
    const parsed = extractTargetDateFromText(text);

    if (parsed) {
      return parsed;
    }
  }

  const datesFromOutcomes = extractOutcomeTargetDates(args.outcomes);

  if (datesFromOutcomes.length === 1) {
    return datesFromOutcomes[0];
  }

  return getHktTodayISO(args.now ?? new Date());
}
''')

old_root_target = path("lib/targetDate.ts")
if old_root_target.exists():
    old_root_target.unlink()
    print("Deleted old lib/targetDate.ts")

# ---------------------------------------------------------------------
# 2. src/lib/openmeteo.ts
# ---------------------------------------------------------------------

replace_once(
    "src/lib/openmeteo.ts",
    'forecast_days: "2",',
    'forecast_days: "7",'
)

# ---------------------------------------------------------------------
# 3. src/lib/forecast.ts
# ---------------------------------------------------------------------

replace_once(
    "src/lib/forecast.ts",
    'import type { OutcomeRange } from "@/types";',
    '''import type { OutcomeRange } from "@/types";
import {
  getHktTodayISO,
  normalizeISODate
} from "@/lib/targetDate";'''
)

replace_once(
    "src/lib/forecast.ts",
    '''export type ForecastWeatherInputs = {
  forecastTargetDate: string;''',
    '''export type ForecastWeatherInputs = {
  targetDate: string;
  todayHkt: string;
  targetIsTodayHkt: boolean;

  forecastTargetDate: string;'''
)

replace_once(
    "src/lib/forecast.ts",
    '''  hktDate: string;
  forecastDate: string;
  date: string;''',
    '''  targetDate: string;
  todayHkt: string;
  targetIsTodayHkt: boolean;

  hktDate: string;
  forecastDate: string;
  date: string;'''
)

replace_once(
    "src/lib/forecast.ts",
    '''export type GetForecastOptions = {
  includeClob?: boolean;
  blendMarket?: boolean;
  includeRawSnapshot?: boolean;
  marketWeightOverride?: number;
  now?: Date;
};''',
    '''export type GetForecastOptions = {
  includeClob?: boolean;
  blendMarket?: boolean;
  includeRawSnapshot?: boolean;
  marketWeightOverride?: number;
  now?: Date;

  /*
    Date-safe forecast target.
    Example:
      2026-05-02

    If omitted, engine falls back to today's Hong Kong date.
  */
  targetDate?: string | null;

  /*
    POST /api/forecast passes the current unsaved UI state here.
    Without this, getForecast() would load stale DB state instead of the
    outcomes currently shown in the dashboard.
  */
  state?: MarketStateLike | null;
};'''
)

replace_regex(
    "src/lib/forecast.ts",
    r'''function getHongKongDayBounds\(now: Date\) \{[\s\S]*?\n\}\n(?=\nfunction parseOpenMeteoTimeMs)''',
    r'''function getHongKongDayBounds(now: Date, targetDateInput?: string | null) {
  const parts = getHongKongDateParts(now);
  const todayHkt = `${parts.year}-${parts.month}-${parts.day}`;

  const targetDate = normalizeISODate(targetDateInput) ?? todayHkt;
  const targetIsTodayHkt = targetDate === todayHkt;

  return {
    ymd: targetDate,
    todayHkt,
    targetIsTodayHkt,
    hour: targetIsTodayHkt ? parts.hour : 0,
    startMs: Date.parse(`${targetDate}T00:00:00+08:00`),
    endMs: Date.parse(`${targetDate}T23:59:59.999+08:00`)
  };
}
'''
)

replace_regex(
    "src/lib/forecast.ts",
    r'''function getOpenMeteoRemainingDayMaxC\([\s\S]*?\n\}\n(?=\nfunction getWindyRemainingDayMaxC)''',
    r'''function getOpenMeteoRemainingDayMaxC(
  snapshot: MultiChannelSnapshot,
  now: Date,
  targetDate?: string | null
): number | null {
  const openMeteo = snapshot.openMeteo;
  if (!openMeteo) return null;

  const bounds = getHongKongDayBounds(now, targetDate);
  const nowMs = now.getTime();

  /*
    If target date is today:
      use current hour onward, with one-hour lookback.

    If target date is not today:
      use the full target calendar day.
      Do NOT use today's current temperature as target-date lower bound.
  */
  const lowerBoundMs = bounds.targetIsTodayHkt
    ? Math.max(bounds.startMs, nowMs - 60 * 60 * 1000)
    : bounds.startMs;

  const values: unknown[] = openMeteo.hourly
    .filter((point) => {
      const timestamp = parseOpenMeteoTimeMs(point.time);
      if (timestamp === null) return false;

      return timestamp >= lowerBoundMs && timestamp <= bounds.endMs;
    })
    .map((point) => point.temperature2mC);

  if (bounds.targetIsTodayHkt) {
    values.push(openMeteo.current?.temperature2mC ?? null);
  }

  return maxNumber(values);
}
'''
)

replace_regex(
    "src/lib/forecast.ts",
    r'''function getWindyRemainingDayMaxC\([\s\S]*?\n\}\n(?=\nfunction estimateCoolingAdjustment)''',
    r'''function getWindyRemainingDayMaxC(
  snapshot: MultiChannelSnapshot,
  now: Date,
  targetDate?: string | null
): number | null {
  const windy = snapshot.windy;
  if (!windy || !windy.enabled) return null;

  const bounds = getHongKongDayBounds(now, targetDate);
  const nowMs = now.getTime();

  const lowerBoundMs = bounds.targetIsTodayHkt
    ? Math.max(bounds.startMs, nowMs - 90 * 60 * 1000)
    : bounds.startMs;

  const values: unknown[] = windy.hourly
    .filter(
      (point) =>
        point.timestamp >= lowerBoundMs && point.timestamp <= bounds.endMs
    )
    .map((point) => point.tempC);

  return maxNumber(values);
}
'''
)

replace_regex(
    "src/lib/forecast.ts",
    r'''function getOfficialForecastMaxC\([\s\S]*?\n\}\n(?=\nfunction getHourlyRainfallMm)''',
    r'''function compactYmdFromAny(value: unknown): string | null {
  const s = String(value ?? "").trim();

  if (!s) {
    return null;
  }

  const normalized = normalizeISODate(s);

  if (normalized) {
    return normalized.replace(/-/g, "");
  }

  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);

  if (compact) {
    return `${compact[1]}${compact[2]}${compact[3]}`;
  }

  return null;
}

function getForecastRowsFromSnapshot(
  snapshot: MultiChannelSnapshot
): Record<string, unknown>[] {
  const candidates = [
    getAt(snapshot, ["hko", "forecast", "days"]),
    getAt(snapshot, ["hko", "days"]),
    getAt(snapshot, ["hko", "weatherForecast"]),
    getAt(snapshot, ["hko", "forecast", "weatherForecast"]),
    getAt(snapshot, ["hko", "raw", "weatherForecast"]),
    getAt(snapshot, ["hko", "nineDayWeatherForecast"]),
    getAt(snapshot, ["hko", "raw", "nineDayWeatherForecast"])
  ];

  const rows: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    for (const row of candidate) {
      if (isRecord(row)) {
        rows.push(row);
      }
    }
  }

  return rows;
}

function getHkoForecastRowForTargetDate(
  snapshot: MultiChannelSnapshot,
  targetDate?: string | null
): Record<string, unknown> | null {
  const targetCompact = compactYmdFromAny(targetDate);

  if (!targetCompact) {
    return null;
  }

  const rows = getForecastRowsFromSnapshot(snapshot);

  return (
    rows.find((row) => {
      const rowDate = compactYmdFromAny(
        row.forecastDate ??
          row.date ??
          row.hktDate ??
          row.forecast_date
      );

      return rowDate === targetCompact;
    }) ?? null
  );
}

function getOfficialForecastMaxC(
  snapshot: MultiChannelSnapshot,
  targetDate?: string | null
): number | null {
  const targetRow = getHkoForecastRowForTargetDate(snapshot, targetDate);

  if (targetRow) {
    const targetRowValue = firstNumber([
      targetRow.forecastMaxtempC,
      targetRow.forecastMaxC,
      targetRow.hkoForecastMaxC,
      targetRow.officialForecastMaxC,
      getAt(targetRow, ["forecastMaxtemp", "value"]),
      getAt(targetRow, ["forecastMaxTemp", "value"]),
      getAt(targetRow, ["forecastMaxTemperature", "value"])
    ]);

    if (targetRowValue !== null) {
      return targetRowValue;
    }
  }

  /*
    If caller supplied a future/non-today target date and we could not find
    that target forecast row, do not silently fall back to today's HKO forecast.
  */
  const normalizedTargetDate = normalizeISODate(targetDate);

  if (normalizedTargetDate && normalizedTargetDate !== getHktTodayISO()) {
    return null;
  }

  /*
    Fallback to previous same-day paths.
  */
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
'''
)

replace_regex(
    "src/lib/forecast.ts",
    r'''function computeWeatherInputs\([\s\S]*?\n\}\n(?=\n/\*\n  Abramowitz-Stegun)''',
    r'''function computeWeatherInputs(
  snapshot: MultiChannelSnapshot,
  now: Date,
  targetDateInput?: string | null
): ForecastWeatherInputs {
  const bounds = getHongKongDayBounds(now, targetDateInput);

  const targetDate = bounds.ymd;
  const todayHkt = bounds.todayHkt;
  const targetIsTodayHkt = bounds.targetIsTodayHkt;

  const hongKongHour = bounds.hour;

  const remainingSettlementHours = targetIsTodayHkt
    ? Math.max(0, (bounds.endMs - now.getTime()) / (60 * 60 * 1000))
    : bounds.endMs < now.getTime()
      ? 0
      : 24;

  const hkoCurrentTempC = getHkoCurrentTempC(snapshot);

  const rawHkoMaxSinceMidnightC = getHkoMaxSinceMidnightC(
    snapshot,
    hkoCurrentTempC
  );

  /*
    CRITICAL DATE-SAFETY RULE:

    observedMaxC is a hard lower bound ONLY when the market target date is
    today in Hong Kong.

    Example:
      todayHkt = 2026-05-01
      targetDate = 2026-05-02

    In that case, May 1 HKO observed max must NOT make May 2 low buckets
    impossible.
  */
  const observedMaxC = targetIsTodayHkt
    ? maxNumber([rawHkoMaxSinceMidnightC, hkoCurrentTempC])
    : null;

  const hkoMinSinceMidnightC = getHkoMinSinceMidnightC(snapshot);

  const officialForecastMaxC = getOfficialForecastMaxC(
    snapshot,
    targetDate
  );

  const rawHourlyRainfallMm = getHourlyRainfallMm(snapshot);

  /*
    Hourly rainfall is an observed same-day signal.
    Do not use today's hourly rainfall as tomorrow/future target-date
    cooling input.
  */
  const hourlyRainfallMm = targetIsTodayHkt ? rawHourlyRainfallMm : null;

  const openMeteoCurrentTempC = firstNumber([
    getAt(snapshot, ["derived", "openMeteoCurrentTempC"]),
    snapshot.openMeteo?.current?.temperature2mC
  ]);

  const openMeteoRemainingDayMaxC = firstNumber([
    getOpenMeteoRemainingDayMaxC(snapshot, now, targetDate),
    targetIsTodayHkt
      ? getAt(snapshot, ["derived", "openMeteoRemainingDayMaxC"])
      : null,
    targetIsTodayHkt
      ? getAt(snapshot, ["derived", "openMeteoFutureMaxC"])
      : null
  ]);

  const windyRemainingDayMaxC = firstNumber([
    getWindyRemainingDayMaxC(snapshot, now, targetDate),
    targetIsTodayHkt
      ? getAt(snapshot, ["derived", "windyRemainingDayMaxC"])
      : null,
    targetIsTodayHkt
      ? getAt(snapshot, ["derived", "windyFutureMaxC"])
      : null
  ]);

  const rainProbabilityNext2hPct = targetIsTodayHkt
    ? firstNumber([getAt(snapshot, ["derived", "rainProbabilityNext2hPct"])])
    : null;

  const cloudCoverNowPct = targetIsTodayHkt
    ? firstNumber([
        getAt(snapshot, ["derived", "cloudCoverNowPct"]),
        snapshot.openMeteo?.current?.cloudCoverPct
      ])
    : null;

  const modelDisagreementC =
    openMeteoRemainingDayMaxC !== null && windyRemainingDayMaxC !== null
      ? Math.abs(openMeteoRemainingDayMaxC - windyRemainingDayMaxC)
      : null;

  /*
    HKO official forecast max is a useful forecast channel, but it is not an
    observation. It gets a modest weight as a prior, while observedMaxC remains
    the hard lower bound only for same-day markets.
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

  const cooling = targetIsTodayHkt
    ? estimateCoolingAdjustment({
        rainProbabilityNext2hPct,
        cloudCoverNowPct,
        observedHourlyRainfallMm: hourlyRainfallMm
      })
    : {
        coolingAdjustmentC: 0,
        adjustmentReasons: [
          `Live rain/cloud cooling adjustment disabled because targetDate=${targetDate} and todayHkt=${todayHkt}.`
        ]
      };

  let adjustedFutureMeanC =
    modelFutureMeanC ??
    firstNumber([
      officialForecastMaxC,
      targetIsTodayHkt ? hkoCurrentTempC : null,
      targetIsTodayHkt ? openMeteoCurrentTempC : null,
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
    Late-day cap only makes sense for same-day settlement.
  */
  if (
    targetIsTodayHkt &&
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
    targetIsTodayHkt && observedMaxC !== null && adjustedFutureMeanC !== null
      ? Math.max(observedMaxC, adjustedFutureMeanC)
      : adjustedFutureMeanC ??
        officialForecastMaxC ??
        openMeteoRemainingDayMaxC ??
        windyRemainingDayMaxC ??
        (targetIsTodayHkt ? observedMaxC ?? hkoCurrentTempC : null) ??
        null;

  const hkoSourceAvailable =
    hkoCurrentTempC !== null ||
    rawHkoMaxSinceMidnightC !== null ||
    hkoMinSinceMidnightC !== null ||
    officialForecastMaxC !== null ||
    rawHourlyRainfallMm !== null;

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
    targetDate,
    todayHkt,
    targetIsTodayHkt,

    forecastTargetDate: targetDate,
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

    /*
      hkoMaxSinceMidnightC is kept as live HKO context.
      hkoMaxSoFarC / maxSoFarC are settlement lower-bound aliases and are null
      when target date is not today.
    */
    hkoMaxSoFarC: roundNumber(observedMaxC, 2),
    hkoMaxSinceMidnightC: roundNumber(rawHkoMaxSinceMidnightC, 2),
    maxSinceMidnightC: roundNumber(rawHkoMaxSinceMidnightC, 2),
    maxSoFarC: roundNumber(observedMaxC, 2),

    hkoMinSinceMidnightC: roundNumber(hkoMinSinceMidnightC, 2),
    minSinceMidnightC: roundNumber(hkoMinSinceMidnightC, 2),
    observedMinC: targetIsTodayHkt
      ? roundNumber(hkoMinSinceMidnightC, 2)
      : null,
    observedMinSoFarC: targetIsTodayHkt
      ? roundNumber(hkoMinSinceMidnightC, 2)
      : null,
    minSoFarC: targetIsTodayHkt
      ? roundNumber(hkoMinSinceMidnightC, 2)
      : null,

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
'''
)

replace_once(
    "src/lib/forecast.ts",
    '''  if (params.weather.observedMaxC === null) {
    warnings.push("Observed HKO max lower bound is unavailable.");
  }''',
    '''  if (!params.weather.targetIsTodayHkt) {
    warnings.push(
      `Target date is ${params.weather.targetDate}, while today HKT is ${params.weather.todayHkt}; live HKO observed max is not used as settlement lower bound.`
    );
  } else if (params.weather.observedMaxC === null) {
    warnings.push("Observed HKO max lower bound is unavailable.");
  }'''
)

replace_once(
    "src/lib/forecast.ts",
    '''  const drivers: string[] = [];

  if (params.topOutcome) {''',
    '''  const drivers: string[] = [];

  drivers.push(
    `Target market date is ${params.weather.targetDate} HKT. Today HKT is ${params.weather.todayHkt}.`
  );

  if (!params.weather.targetIsTodayHkt) {
    drivers.push(
      `Live HKO observations from ${params.weather.todayHkt} are context only and are not used as the settlement lower bound for ${params.weather.targetDate}.`
    );
  }

  if (params.topOutcome) {'''
)

replace_once(
    "src/lib/forecast.ts",
    '''    params.weather.observedMaxC !== null
      ? `observed max lower bound ${formatTemperature(
          params.weather.observedMaxC
        )}`
      : null,''',
    '''    params.weather.targetIsTodayHkt && params.weather.observedMaxC !== null
      ? `observed max lower bound ${formatTemperature(
          params.weather.observedMaxC
        )}`
      : null,'''
)

replace_once(
    "src/lib/forecast.ts",
    '''  const pieces: string[] = [];

  if (params.topOutcome) {''',
    '''  const pieces: string[] = [];

  pieces.push(
    `Target market date is ${params.weather.targetDate} HKT; today HKT is ${params.weather.todayHkt}.`
  );

  if (!params.weather.targetIsTodayHkt) {
    pieces.push(
      "Live HKO observed max is not used as the settlement lower bound because the target date is not today."
    );
  }

  if (params.topOutcome) {'''
)

replace_once(
    "src/lib/forecast.ts",
    '''  const weather = computeWeatherInputs(params.snapshot, now);''',
    '''  const weather = computeWeatherInputs(
    params.snapshot,
    now,
    params.options?.targetDate
  );'''
)

replace_once(
    "src/lib/forecast.ts",
    '''    hktDate: weather.forecastTargetDate,
    forecastDate: weather.forecastTargetDate,
    date: weather.forecastTargetDate,''',
    '''    targetDate: weather.targetDate,
    todayHkt: weather.todayHkt,
    targetIsTodayHkt: weather.targetIsTodayHkt,

    hktDate: weather.forecastTargetDate,
    forecastDate: weather.forecastTargetDate,
    date: weather.forecastTargetDate,'''
)

replace_once(
    "src/lib/forecast.ts",
    '''      assumptions: [
        "Outcome ranges are treated as lower-inclusive and upper-exclusive.",
        "The forecast horizon is restricted to the remaining part of the current Hong Kong calendar day.",
        "The daily maximum cannot finish below the maximum already observed by HKO.",
        "The observed max lower bound is max(HKO max since midnight, HKO current temperature).",
        "Official HKO forecast max is used as a forecast prior, not as an observed lower bound.",
        "Weather fair probabilities come from a normal distribution around the same-day final maximum estimate.",
        "When sufficient market prices are available, final probabilities blend weather fair probabilities with CLOB/Gamma-implied probabilities."
      ],''',
    '''      assumptions: [
        "Outcome ranges are treated as lower-inclusive and upper-exclusive.",
        `Target market date is ${weather.targetDate} HKT; today HKT is ${weather.todayHkt}.`,
        weather.targetIsTodayHkt
          ? "Because target date is today, the daily maximum cannot finish below the maximum already observed by HKO."
          : "Because target date is not today, today's HKO observed maximum is not used as the target-date settlement lower bound.",
        weather.targetIsTodayHkt
          ? "The observed max lower bound is max(HKO max since midnight, HKO current temperature)."
          : "Observed max lower-bound repair is disabled for this target date.",
        "Official HKO forecast max is used as a forecast prior, not as an observed lower bound.",
        "Weather fair probabilities come from a normal distribution around the target-date final maximum estimate.",
        "When sufficient market prices are available, final probabilities blend weather fair probabilities with CLOB/Gamma-implied probabilities."
      ],'''
)

replace_once(
    "src/lib/forecast.ts",
    '''  try {
    const rawMarketState = await getMarketState();
    marketState = unwrapMarketState(rawMarketState);
  } catch (error) {''',
    '''  try {
    if (options.state && isRecord(options.state)) {
      marketState = unwrapMarketState(options.state);
    } else {
      const rawMarketState = await getMarketState();
      marketState = unwrapMarketState(rawMarketState);
    }
  } catch (error) {'''
)

replace_once(
    "src/lib/forecast.ts",
    '''    generatedAt: forecast.generatedAt,
    hktDate: forecast.hktDate,
    market: forecast.market,''',
    '''    generatedAt: forecast.generatedAt,
    targetDate: forecast.targetDate,
    todayHkt: forecast.todayHkt,
    targetIsTodayHkt: forecast.targetIsTodayHkt,
    hktDate: forecast.hktDate,
    market: forecast.market,'''
)

# ---------------------------------------------------------------------
# 4. src/lib/poe.ts
# ---------------------------------------------------------------------

replace_once(
    "src/lib/poe.ts",
    '''import type { ForecastResult } from "@/lib/forecast";
import { summarizeForecastForPrompt } from "@/lib/forecast";''',
    '''import type { ForecastResult } from "@/lib/forecast";
import { summarizeForecastForPrompt } from "@/lib/forecast";
import {
  normalizeISODate,
  zhDateLabel
} from "@/lib/targetDate";'''
)

replace_regex(
    "src/lib/poe.ts",
    r'''export function buildMultiChannelForecastPrompt\(forecast: ForecastResult\) \{[\s\S]*?\n\}\n(?=\nexport async function getPoeForecastCommentary)''',
    r'''export function buildMultiChannelForecastPrompt(forecast: ForecastResult) {
  const compactForecast = summarizeForecastForPrompt(forecast);

  const forecastRecord = forecast as unknown as Record<string, unknown>;

  const targetDate =
    normalizeISODate(forecastRecord.targetDate) ??
    normalizeISODate(forecastRecord.hktDate) ??
    normalizeISODate(forecastRecord.forecastDate) ??
    normalizeISODate(forecastRecord.date) ??
    "unknown";

  const todayHkt =
    typeof forecastRecord.todayHkt === "string"
      ? forecastRecord.todayHkt
      : typeof forecast.weather?.todayHkt === "string"
        ? forecast.weather.todayHkt
        : "unknown";

  const targetIsTodayHkt =
    forecastRecord.targetIsTodayHkt === true ||
    forecast.weather?.targetIsTodayHkt === true;

  const targetDateLabel =
    targetDate === "unknown" ? "目標日期" : zhDateLabel(targetDate);

  return [
    "你是一名嚴謹的香港天氣與 prediction market 分析員。",
    "",
    "請根據以下 multi-channel forecast JSON，用繁體中文寫一段可直接放在 dashboard 上的分析。",
    "",
    "CRITICAL DATE RULES:",
    `- Target market date: ${targetDate} HKT (${targetDateLabel}).`,
    `- Today's HKT date according to the server: ${todayHkt}.`,
    `- targetIsTodayHkt: ${String(targetIsTodayHkt)}.`,
    `- 你只可以分析 ${targetDateLabel}，不可轉去分析其他日期。`,
    `- 文章標題必須完全等於：## ${targetDateLabel}香港最高氣溫 — Dashboard 分析`,
    "- 如果 targetIsTodayHkt=false，live HKO current temp / max since midnight 只可以作為今日實況背景，不可以當作 target date 的 settlement lower bound。",
    "- 如果 targetIsTodayHkt=false，不可以說某些低溫 outcome 已因今日 observed max 而不可能。",
    "- 只有 targetIsTodayHkt=true，而且 JSON 內 outcome 明確 isImpossibleByObservedMax=true，才可以說 outcome 已被 observed max 排除。",
    "- 不要寫 5月1日，除非 target market date 真的是 2026-05-01。",
    "",
    "要求：",
    "1. 先用 1 句說明目前最高機率 outcome。",
    "2. 解釋 HKO forecast、Open-Meteo、Windy、rain/cloud、CLOB/Gamma price 如何影響機率。",
    "3. 如果 targetIsTodayHkt=true 且某些 outcome 已因 observed max 達到 upper bound 而不可能，才明確指出。",
    "4. 如果 targetIsTodayHkt=false，要明確指出 live HKO observed max 沒有用作目標日期下限。",
    "5. 不要捏造 JSON 沒有提供的數據。",
    "6. 不要給投資建議；只說明概率、風險與不確定性。",
    "7. 最後用 2-4 個 bullet points 列出 watch points。",
    "",
    "Forecast JSON:",
    "```json",
    JSON.stringify(compactForecast, null, 2),
    "```"
  ].join("\n");
}
'''
)

replace_once(
    "src/lib/poe.ts",
    '''      maxTokens: options.maxTokens ?? 850,''',
    '''      maxTokens: options.maxTokens ?? 1400,'''
)

# ---------------------------------------------------------------------
# 5. src/app/api/forecast/route.ts
# ---------------------------------------------------------------------

replace_once(
    "src/app/api/forecast/route.ts",
    '''import { NextResponse } from "next/server";
import { getForecast, type GetForecastOptions } from "@/lib/forecast";
import { getPoeForecastCommentary } from "@/lib/poe";
import { initDatabase, saveForecastRun } from "@/lib/db";
import type { ForecastResult, HkoWeatherSnapshot, MarketState } from "@/types";''',
    '''import { NextResponse } from "next/server";
import { getForecast, type GetForecastOptions } from "@/lib/forecast";
import { getPoeForecastCommentary } from "@/lib/poe";
import { initDatabase, saveForecastRun } from "@/lib/db";
import type { ForecastResult, HkoWeatherSnapshot, MarketState } from "@/types";
import {
  getHktTodayISO,
  normalizeISODate,
  resolveTargetDate,
  zhDateLabel
} from "@/lib/targetDate";'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''type RunForecastOptions = GetForecastOptions & {
  ai?: boolean;
  saveHistory?: boolean;
  state?: MarketState | null;
};''',
    '''type RunForecastOptions = GetForecastOptions & {
  ai?: boolean;
  saveHistory?: boolean;
  state?: MarketState | null;
  targetDate?: string | null;
};'''
)

insert_before_once(
    "src/app/api/forecast/route.ts",
    "\nfunction getStringField(",
    r'''
function resolveRequestTargetDate(params: {
  body?: Record<string, unknown>;
  state?: MarketState | null;
  url?: URL;
}): string {
  const body = params.body ?? {};
  const stateRecord = recordOrEmpty(params.state);

  const explicitDate = firstString(
    body.targetDate,
    body.date,
    body.selectedDate,
    body.forecastDate,
    params.url?.searchParams.get("targetDate"),
    params.url?.searchParams.get("date"),
    stateRecord.targetDate,
    stateRecord.date,
    stateRecord.selectedDate,
    stateRecord.forecastDate
  );

  return resolveTargetDate({
    explicitDate,
    outcomes:
      stateRecord.outcomes ??
      body.outcomes ??
      body.outcomeProbabilities ??
      body.probabilities,
    texts: [
      body.polymarketUrl,
      body.marketUrl,
      body.url,
      body.slug,
      body.eventSlug,
      body.marketSlug,
      stateRecord.polymarketUrl,
      stateRecord.marketUrl,
      stateRecord.url,
      stateRecord.slug,
      stateRecord.eventSlug,
      stateRecord.marketSlug,
      stateRecord.title,
      stateRecord.question
    ]
  });
}

'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''function normalizeForecastResultForPage(
  forecast: Forecast,
  aiCommentary: AiCommentary,
  state: MarketState | null = null
): ForecastResult {
  const forecastRecord = recordOrEmpty(forecast);

  const observedMaxCandidate =
    getObservedMaxLowerBoundCandidate(forecastRecord);

  const observedMaxLowerBoundC = observedMaxCandidate?.value ?? null;''',
    '''function normalizeForecastResultForPage(
  forecast: Forecast,
  aiCommentary: AiCommentary,
  state: MarketState | null = null,
  targetDateInput?: string | null
): ForecastResult {
  const forecastRecord = recordOrEmpty(forecast);

  const targetDate =
    normalizeISODate(targetDateInput) ??
    normalizeISODate(
      firstString(
        forecastRecord.targetDate,
        forecastRecord.hktDate,
        forecastRecord.forecastDate,
        forecastRecord.date
      )
    ) ??
    getForecastHktDate(forecast);

  const todayHkt = getHktTodayISO();
  const targetIsTodayHkt = targetDate === todayHkt;

  const rawObservedMaxCandidate =
    getObservedMaxLowerBoundCandidate(forecastRecord);

  /*
    CRITICAL DATE LOCK:
    Only same-day markets may use live HKO observed max as a hard lower bound.
  */
  const observedMaxCandidate = targetIsTodayHkt
    ? rawObservedMaxCandidate
    : null;

  const observedMaxLowerBoundC = targetIsTodayHkt
    ? observedMaxCandidate?.value ?? null
    : null;'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''  const warnings = collectWarnings({
    forecastRecord,
    weatherForDisplay,
    sourceStatus
  });''',
    '''  const warnings = collectWarnings({
    forecastRecord,
    weatherForDisplay,
    sourceStatus
  });

  if (!targetIsTodayHkt) {
    addWarning(
      warnings,
      `Date safety: targetDate=${targetDate}, todayHkt=${todayHkt}; live HKO observed max is not used as settlement lower bound.`
    );
  }'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''  const keyDrivers =
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
        });''',
    '''  const baseKeyDrivers =
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

  const targetDateDriver = targetIsTodayHkt
    ? `Target market date is ${targetDate} HKT, same as today HKT. Live HKO observed max can be used as same-day lower bound.`
    : `Target market date is ${targetDate} HKT; today HKT is ${todayHkt}. Live HKO observed max is not used as target-date lower bound.`;

  const keyDrivers = [
    targetDateDriver,
    ...baseKeyDrivers.filter(
      (driver) => !driver.toLowerCase().includes("target market date")
    )
  ];'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''  const diagnostics = {
    ...recordOrEmpty(forecastRecord.diagnostics),
    phase2RoutePatch: true,
    aiInputMode: "multi_channel_forecast_json",''',
    '''  const diagnostics = {
    ...recordOrEmpty(forecastRecord.diagnostics),
    phase2RoutePatch: true,
    targetDate,
    todayHkt,
    targetIsTodayHkt,
    rawObservedMaxCandidate: rawObservedMaxCandidate
      ? {
          valueC: rawObservedMaxCandidate.value,
          source: rawObservedMaxCandidate.source,
          path: rawObservedMaxCandidate.path
        }
      : null,
    observedMaxCandidateUsed: targetIsTodayHkt,
    aiInputMode: "multi_channel_forecast_json",'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''  return {
    ...forecastRecord,

    generatedAt,''',
    '''  return {
    ...forecastRecord,

    generatedAt,

    targetDate,
    hktDate: targetDate,
    forecastDate: targetDate,
    date: targetDate,
    todayHkt,
    targetIsTodayHkt,'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''function buildForecastPayload(params: {
  forecast: Forecast;
  aiCommentary: AiCommentary;
  historySave: HistorySaveResult;
  state?: MarketState | null;
}) {''',
    '''function buildForecastPayload(params: {
  forecast: Forecast;
  aiCommentary: AiCommentary;
  historySave: HistorySaveResult;
  state?: MarketState | null;
  targetDate?: string | null;
}) {'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''  const resultForDisplay = normalizeForecastResultForPage(
    params.forecast,
    params.aiCommentary,
    params.state ?? null
  );''',
    '''  const resultForDisplay = normalizeForecastResultForPage(
    params.forecast,
    params.aiCommentary,
    params.state ?? null,
    params.targetDate ?? null
  );'''
)

insert_before_once(
    "src/app/api/forecast/route.ts",
    "\nasync function runForecast(options: RunForecastOptions) {",
    r'''
function explanationLooksWrongTargetDate(text: string, targetDate: string) {
  const expectedLabel = zhDateLabel(targetDate);

  if (!text.includes(expectedLabel)) {
    return true;
  }

  const dateLabels = Array.from(text.matchAll(/(\d{1,2})月(\d{1,2})日/g)).map(
    (match) => `${Number(match[1])}月${Number(match[2])}日`
  );

  return dateLabels.some((label) => label !== expectedLabel);
}

function buildDateSafeFallbackExplanation(forecast: Forecast): string {
  const forecastRecord = recordOrEmpty(forecast);

  const targetDate =
    normalizeISODate(
      firstString(
        forecastRecord.targetDate,
        forecastRecord.hktDate,
        forecastRecord.forecastDate,
        forecastRecord.date
      )
    ) ?? getForecastHktDate(forecast);

  const todayHkt =
    firstString(
      forecastRecord.todayHkt,
      getAt(forecastRecord, ["weather", "todayHkt"])
    ) ?? getHktTodayISO();

  const targetIsTodayHkt =
    firstBoolean(
      forecastRecord.targetIsTodayHkt,
      getAt(forecastRecord, ["weather", "targetIsTodayHkt"])
    ) ?? targetDate === todayHkt;

  const label = zhDateLabel(targetDate);

  const topOutcome = recordOrEmpty(forecastRecord.topOutcome);

  const topName =
    firstString(topOutcome.name, topOutcome.outcome, topOutcome.label) ??
    "最高機率 outcome";

  const topProbabilityText =
    formatProbabilityForDriver(
      firstProbability(
        topOutcome.finalProbability,
        topOutcome.blendedProbability,
        topOutcome.probability
      )
    ) ?? "未能讀取";

  const drivers =
    stringArray(forecastRecord.keyDrivers) ??
    stringArray(getAt(forecastRecord, ["diagnostics", "keyDrivers"])) ??
    [];

  const warnings =
    warningStrings(forecastRecord.warnings).length > 0
      ? warningStrings(forecastRecord.warnings)
      : warningStrings(getAt(forecastRecord, ["diagnostics", "warnings"]));

  return [
    `## ${label}香港最高氣溫 — Dashboard 分析`,
    "",
    `目標市場日期是 **${targetDate} HKT（${label}）**。伺服器今日 HKT 日期是 **${todayHkt}**。`,
    "",
    targetIsTodayHkt
      ? "由於目標日期就是今日，live HKO observed max 可以作為同日 settlement lower bound。"
      : "由於目標日期不是今日，live HKO observed max 只作為今日實況背景，**不會**用作目標日期的 settlement lower bound。",
    "",
    `目前最高機率 outcome 是 **${topName}**，final probability 約 **${topProbabilityText}**。`,
    "",
    "### Key drivers",
    "",
    ...(drivers.length > 0
      ? drivers.slice(0, 6).map((driver) => `- ${driver}`)
      : ["- Dashboard 未提供額外 key drivers。"]),
    "",
    "### Watch points",
    "",
    "- 目標日期必須同 Polymarket market slug / URL 一致。",
    "- 如果 targetIsTodayHkt=false，不應把今日 HKO max since midnight 當作該日結算下限。",
    "- HKO official forecast max、Open-Meteo / Windy target-day forecast、以及 CLOB/Gamma price 會共同影響最終概率。",
    ...(warnings.length > 0
      ? ["", "### Warnings", "", ...warnings.slice(0, 5).map((w) => `- ${w}`)]
      : [])
  ].join("\n");
}
'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''      const normalizedForAi = normalizeForecastResultForPage(
        forecast,
        null,
        options.state ?? null
      );''',
    '''      const normalizedForAi = normalizeForecastResultForPage(
        forecast,
        null,
        options.state ?? null,
        options.targetDate ?? null
      );'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''      aiCommentary = await getPoeForecastCommentary(forecastForAi);

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
      }''',
    '''      aiCommentary = await getPoeForecastCommentary(forecastForAi);

      const aiText = getAiExplanationText(aiCommentary);

      const aiTargetDate =
        normalizeISODate(
          firstString(
            getAt(forecastForAi, ["targetDate"]),
            getAt(forecastForAi, ["hktDate"]),
            getAt(forecastForAi, ["forecastDate"]),
            getAt(forecastForAi, ["date"]),
            options.targetDate
          )
        ) ?? null;

      /*
        If Poe returns a wrong-date explanation, discard it.
        This prevents May 2 dashboard showing a May 1 writeup.
      */
      if (
        aiText &&
        aiTargetDate &&
        explanationLooksWrongTargetDate(aiText, aiTargetDate)
      ) {
        aiCommentary = {
          explanation: buildDateSafeFallbackExplanation(forecastForAi)
        };
      }

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
      }'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''  return buildForecastPayload({
    forecast,
    aiCommentary,
    historySave,
    state: options.state ?? null
  });''',
    '''  return buildForecastPayload({
    forecast,
    aiCommentary,
    historySave,
    state: options.state ?? null,
    targetDate: options.targetDate ?? null
  });'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''    const marketWeightOverride =
      parseNumber(url.searchParams.get("marketWeight")) ??
      parseNumber(url.searchParams.get("marketWeightOverride"));

    const payload = await runForecast({''',
    '''    const marketWeightOverride =
      parseNumber(url.searchParams.get("marketWeight")) ??
      parseNumber(url.searchParams.get("marketWeightOverride"));

    const targetDate = resolveRequestTargetDate({
      url,
      state: null,
      body: {}
    });

    const payload = await runForecast({'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''      ai,
      saveHistory: false,
      state: null
    });''',
    '''      ai,
      saveHistory: false,
      state: null,
      targetDate
    });'''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''    const state = parseMarketState(body.state);
    const saveHistory = parseBoolean(body.saveHistory, false);

    const marketWeightOverride =''',
    '''    const state = parseMarketState(body.state);
    const saveHistory = parseBoolean(body.saveHistory, false);

    const targetDate = resolveRequestTargetDate({
      body,
      state,
      url
    });

    const marketWeightOverride ='''
)

replace_once(
    "src/app/api/forecast/route.ts",
    '''      ai,
      saveHistory,
      state
    });''',
    '''      ai,
      saveHistory,
      state,
      targetDate
    });'''
)

# ---------------------------------------------------------------------
# 6. src/app/page.tsx
# ---------------------------------------------------------------------

insert_before_once(
    "src/app/page.tsx",
    "\nfunction Card({",
    r'''
const DEFAULT_POLYMARKET_URL =
  "https://polymarket.com/zh-hant/event/highest-temperature-in-hong-kong-on-may-1-2026";

const MONTHS_FOR_TARGET_DATE: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "05",
  june: "06",
  jun: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  october: "10",
  oct: "10",
  november: "11",
  nov: "11",
  december: "12",
  dec: "12"
};

function extractTargetDateFromTextForClient(input: unknown): string | null {
  const s = String(input ?? "").trim();

  if (!s) {
    return null;
  }

  const match = s.match(
    /(?:^|[-/])on-(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)-(\d{1,2})-(\d{4})(?:[-/?#&]|$)/i
  );

  if (!match) {
    return null;
  }

  const monthName = match[1].toLowerCase();
  const month = MONTHS_FOR_TARGET_DATE[monthName];

  if (!month) {
    return null;
  }

  return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}

'''
)

replace_once(
    "src/app/page.tsx",
    '''  const [polymarketUrl, setPolymarketUrl] = useState(
    "https://polymarket.com/zh-hant/event/highest-temperature-in-hong-kong-on-may-1-2026"
  );''',
    '''  const [polymarketUrl, setPolymarketUrl] = useState(
    DEFAULT_POLYMARKET_URL
  );

  const [targetDate, setTargetDate] = useState(
    extractTargetDateFromTextForClient(DEFAULT_POLYMARKET_URL) ?? ""
  );'''
)

replace_once(
    "src/app/page.tsx",
    '''  const officialForecastMax = useMemo(
    () => weather?.forecast?.days?.[0]?.forecastMaxtempC ?? null,
    [weather]
  );''',
    '''  const officialForecastMax = useMemo(() => {
    const targetCompact = targetDate.replace(/-/g, "");

    const targetForecastDay =
      weather?.forecast?.days?.find(
        (day) => String(day.forecastDate ?? "") === targetCompact
      ) ?? null;

    return firstDisplayNumber(
      targetForecastDay?.forecastMaxtempC,
      weather?.forecast?.days?.[0]?.forecastMaxtempC,
      readPath(weather, ["officialForecastMaxC"]),
      readPath(weather, ["hkoOfficialForecastMaxC"]),
      readPath(weather, ["forecastMaxC"]),
      readPath(forecast, ["officialForecastMaxC"]),
      readPath(forecast, ["hkoOfficialForecastMaxC"]),
      readPath(forecast, ["forecastMaxC"])
    );
  }, [weather, forecast, targetDate]);'''
)

replace_once(
    "src/app/page.tsx",
    '''      const nextOutcomes = json.data.outcomes;

      setState((previous) => ({
        ...previous,
        outcomes: nextOutcomes
      }));

      setOutcomesJson(JSON.stringify(nextOutcomes, null, 2));''',
    '''      const nextOutcomes = json.data.outcomes;

      const nextTargetDate =
        extractTargetDateFromTextForClient(json.data.slug) ??
        extractTargetDateFromTextForClient(json.data.marketSlug) ??
        extractTargetDateFromTextForClient(json.data.eventTitle) ??
        extractTargetDateFromTextForClient(json.data.marketQuestion) ??
        extractTargetDateFromTextForClient(polymarketUrl) ??
        targetDate;

      if (nextTargetDate) {
        setTargetDate(nextTargetDate);
      }

      setState((previous) => ({
        ...previous,
        outcomes: nextOutcomes,

        /*
          These are allowed because MarketState has [key: string]: unknown.
          They help the backend resolve the correct market target date.
        */
        targetDate: nextTargetDate,
        polymarketUrl,
        slug: json.data.slug,
        eventSlug: json.data.slug,
        marketSlug: json.data.marketSlug,
        title: json.data.eventTitle,
        question: json.data.marketQuestion
      }));

      setOutcomesJson(JSON.stringify(nextOutcomes, null, 2));'''
)

replace_once(
    "src/app/page.tsx",
    '''      const nextState = {
        ...state,
        outcomes: parsedOutcomes
      };''',
    '''      const resolvedTargetDate =
        targetDate ||
        extractTargetDateFromTextForClient(polymarketUrl) ||
        "";

      const nextState = {
        ...state,
        outcomes: parsedOutcomes,
        targetDate: resolvedTargetDate,
        polymarketUrl
      };'''
)

replace_once(
    "src/app/page.tsx",
    '''          state: nextState,
          saveHistory,
          forceAI
        })''',
    '''          state: nextState,
          saveHistory,
          forceAI,
          targetDate: resolvedTargetDate,
          polymarketUrl
        })'''
)

# This is the second same-shaped nextState block, inside saveSettings().
replace_once(
    "src/app/page.tsx",
    '''      const nextState = {
        ...state,
        outcomes: parsedOutcomes
      };''',
    '''      const nextState = {
        ...state,
        outcomes: parsedOutcomes,
        targetDate,
        polymarketUrl
      };'''
)

replace_once(
    "src/app/page.tsx",
    '''                onChange={(event) => setPolymarketUrl(event.target.value)}''',
    '''                onChange={(event) => {
                  const value = event.target.value;
                  setPolymarketUrl(value);

                  const parsedTargetDate =
                    extractTargetDateFromTextForClient(value);

                  if (parsedTargetDate) {
                    setTargetDate(parsedTargetDate);
                  }
                }}'''
)

replace_once(
    "src/app/page.tsx",
    '''              />
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-2">''',
    '''              />
            </label>

            <label className="mt-4 block">
              <span className="text-sm text-slate-300">
                Target market date
              </span>

              <input
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
                className={inputClass}
                type="date"
              />

              <p className="mt-2 text-xs text-slate-500">
                This date is sent to /api/forecast. Live HKO observed max is only used
                when this equals today in Hong Kong.
              </p>
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-2">'''
)

print("Done. Modified target-date handling files.")
print("")
print("Next suggested checks:")
print("  npm run lint")
print("  npm run build")
