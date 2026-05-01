import type {
  HkoForecastDay,
  HkoHourlyRainfall,
  HkoSinceMidnightMaxMin,
  HkoWeatherSnapshot,
  SettlementResult
} from "@/types";

const HKO_WEATHER_API =
  "https://data.weather.gov.hk/weatherAPI/opendata/weather.php";

const HKO_OPEN_DATA_API =
  "https://data.weather.gov.hk/weatherAPI/opendata/opendata.php";

const HKO_SINCE_MIDNIGHT_MAX_MIN_CSV =
  "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_since_midnight_maxmin.csv";

const HKO_HOURLY_RAINFALL_API =
  "https://data.weather.gov.hk/weatherAPI/opendata/hourlyRainfall.php";

type RawHkoCurrentWeather = {
  updateTime?: string;
  rainfall?: {
    data?: Array<{
      unit?: string;
      place?: string;
      max?: number;
      min?: number;
      main?: string;
    }>;
    startTime?: string;
    endTime?: string;
  };
  temperature?: {
    recordTime?: string;
    data?: Array<{
      place?: string;
      value?: number;
      unit?: string;
    }>;
  };
  humidity?: {
    recordTime?: string;
    data?: Array<{
      place?: string;
      value?: number;
      unit?: string;
    }>;
  };
};

type RawHkoForecast = {
  generalSituation?: string;
  updateTime?: string;
  weatherForecast?: Array<{
    forecastDate?: string;
    week?: string;
    forecastWeather?: string;
    forecastWind?: string;
    forecastMaxtemp?: {
      value?: number;
      unit?: string;
    };
    forecastMintemp?: {
      value?: number;
      unit?: string;
    };
    PSR?: string;
  }>;
};

type RawHourlyRainfall = {
  obsTime?: string;
  hourlyRainfall?: Array<{
    automaticWeatherStation?: string;
    automaticWeatherStationID?: string;
    value?: string | number;
    unit?: string;
  }>;
};

type HkoSourceError = {
  source: string;
  message: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`HKO request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchTextWithLastModified(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/csv,text/plain,*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`HKO CSV request failed with status ${response.status}`);
  }

  return {
    text: await response.text(),
    lastModified: response.headers.get("last-modified")
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown HKO error";
}

function normalizeStationName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function isHkoStationName(value: unknown): boolean {
  const normalized = normalizeStationName(value);

  return (
    normalized === "hko" ||
    normalized.includes("hkobservatory") ||
    normalized.includes("hongkongobservatory") ||
    normalized.includes("香港天文台")
  );
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (
    normalized === "-" ||
    normalized === "--" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "null" ||
    normalized === "nil"
  ) {
    return null;
  }

  /*
    HKO rainfall sometimes reports trace rainfall.
    Treat trace as 0 mm for dashboard / cooling logic.
  */
  if (
    normalized === "trace" ||
    normalized === "tr" ||
    normalized === "t" ||
    normalized === "微量"
  ) {
    return 0;
  }

  const cleaned = normalized.replace(/,/g, "").replace(/[^\d.+-]/g, "");

  /*
    Important:
    Without this guard, Number("") is 0, so strings like "HK Observatory"
    would incorrectly parse as 0.
  */
  if (!/[+-]?\d/.test(cleaned)) {
    return null;
  }

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }

      row.push(field);

      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row.map((cell) => cell.trim()));
      }

      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);

  if (row.some((cell) => cell.trim().length > 0)) {
    rows.push(row.map((cell) => cell.trim()));
  }

  return rows;
}

function roundNumber(value: unknown, digits = 2): number | null {
  const parsed = parseNumber(value);

  if (parsed === null) {
    return null;
  }

  const factor = 10 ** digits;

  return Math.round(parsed * factor) / factor;
}

function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = parseNumber(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function maxNumber(values: unknown[]): number | null {
  const nums = values
    .map(parseNumber)
    .filter((value): value is number => value !== null);

  return nums.length ? Math.max(...nums) : null;
}

function minNumber(values: unknown[]): number | null {
  const nums = values
    .map(parseNumber)
    .filter((value): value is number => value !== null);

  return nums.length ? Math.min(...nums) : null;
}

function getTimeMatch(cell: string): string | null {
  const match = cell.trim().match(/(?:^|\s)([01]?\d|2[0-3]):[0-5]\d(?:\s|$)?/);

  return match ? match[0].trim() : null;
}

function isTimeCell(cell: string) {
  return getTimeMatch(cell) !== null;
}

function extractTimeCells(row: string[]) {
  return row
    .map((cell) => getTimeMatch(cell))
    .filter((cell): cell is string => Boolean(cell));
}

function parseTemperatureCell(cell: string): number | null {
  if (isTimeCell(cell)) {
    return null;
  }

  const parsed = parseNumber(cell);

  if (parsed === null) {
    return null;
  }

  /*
    Defensive sanity range.
    This prevents station IDs, dates, and times from being treated as temperatures.
  */
  if (parsed < -20 || parsed > 50) {
    return null;
  }

  return parsed;
}

function findHkoRow(rows: string[][]) {
  return (
    rows.find((row) => row.some((cell) => isHkoStationName(cell))) ?? null
  );
}

function pickHkoStationRecord<
  T extends {
    place?: string;
    automaticWeatherStation?: string;
    automaticWeatherStationID?: string;
    value?: unknown;
  }
>(data: T[] | undefined): T | null {
  if (!data || data.length === 0) {
    return null;
  }

  const exactHkoStation =
    data.find((item) =>
      isHkoStationName(
        item.place ??
          item.automaticWeatherStation ??
          item.automaticWeatherStationID
      )
    ) ?? null;

  if (exactHkoStation) {
    return exactHkoStation;
  }

  return (
    data.find((item) => parseNumber(item.value) !== null) ??
    data[0] ??
    null
  );
}

function pickHkoStationValue(
  data:
    | Array<{
        place?: string;
        value?: number;
        unit?: string;
      }>
    | undefined
) {
  const selected = pickHkoStationRecord(data);

  return selected ? parseNumber(selected.value) : null;
}

function makeEmptyCurrentWeather() {
  return {
    updateTime: null,
    recordTime: null,

    hkoCurrentTempC: null,
    currentTempC: null,
    currentTemperatureC: null,
    temperatureC: null,

    hkoHumidityPct: null,
    humidityPct: null,

    rainfall: [],
    rainfallData: [],
    rawRainfall: null,
    temperature: null,
    humidity: null,

    warning: "HKO current weather was unavailable."
  };
}

function makeEmptyForecast() {
  return {
    updateTime: null,
    generalSituation: null,
    days: [] as HkoForecastDay[],
    today: null as HkoForecastDay | null,
    weatherForecast: [] as RawHkoForecast["weatherForecast"],

    officialForecastMaxC: null,
    hkoOfficialForecastMaxC: null,
    forecastMaxC: null,
    hkoForecastMaxC: null,

    officialForecastMinC: null,
    hkoOfficialForecastMinC: null,
    forecastMinC: null,
    hkoForecastMinC: null,

    forecastMaxtemp: null as { value: number; unit: string } | null,
    forecastMintemp: null as { value: number; unit: string } | null,

    warning: "HKO 9-day forecast was unavailable."
  };
}

export async function getHkoCurrentWeather() {
  const url = `${HKO_WEATHER_API}?dataType=rhrread&lang=en`;
  const raw = await fetchJson<RawHkoCurrentWeather>(url);

  const hkoCurrentTempC = pickHkoStationValue(raw.temperature?.data);
  const hkoHumidityPct = pickHkoStationValue(raw.humidity?.data);

  const rainfallData =
    raw.rainfall?.data?.map((item) => ({
      place: item.place ?? "Unknown",
      max: typeof item.max === "number" ? item.max : null,
      min: typeof item.min === "number" ? item.min : null,
      main: item.main ?? null,
      value: typeof item.max === "number" ? item.max : null,
      rainfallMm: typeof item.max === "number" ? item.max : null,
      unit: item.unit ?? null
    })) ?? [];

  return {
    updateTime: raw.updateTime ?? null,
    recordTime: raw.temperature?.recordTime ?? null,

    hkoCurrentTempC,
    currentTempC: hkoCurrentTempC,
    currentTemperatureC: hkoCurrentTempC,
    temperatureC: hkoCurrentTempC,

    hkoHumidityPct,
    humidityPct: hkoHumidityPct,

    /*
      Keep the previous shape:
        current.rainfall = array
      Add compatibility aliases:
        rainfallData
        rawRainfall
        temperature
        humidity
    */
    rainfall: rainfallData,
    rainfallData,
    rawRainfall: raw.rainfall ?? null,

    temperature: raw.temperature ?? null,
    humidity: raw.humidity ?? null
  };
}

export async function getHkoForecast() {
  const url = `${HKO_WEATHER_API}?dataType=fnd&lang=en`;
  const raw = await fetchJson<RawHkoForecast>(url);

  const days: HkoForecastDay[] =
    raw.weatherForecast?.map((day) => ({
      forecastDate: day.forecastDate ?? "",
      week: day.week ?? "",
      forecastWeather: day.forecastWeather ?? "",
      forecastWind: day.forecastWind ?? "",
      forecastMaxtempC:
        typeof day.forecastMaxtemp?.value === "number"
          ? day.forecastMaxtemp.value
          : null,
      forecastMintempC:
        typeof day.forecastMintemp?.value === "number"
          ? day.forecastMintemp.value
          : null,
      psr: day.PSR ?? null
    })) ?? [];

  const today = days[0] ?? null;

  const officialForecastMaxC =
    typeof today?.forecastMaxtempC === "number"
      ? today.forecastMaxtempC
      : null;

  const officialForecastMinC =
    typeof today?.forecastMintempC === "number"
      ? today.forecastMintempC
      : null;

  return {
    updateTime: raw.updateTime ?? null,
    generalSituation: raw.generalSituation ?? null,
    days,
    today,
    weatherForecast: raw.weatherForecast ?? [],

    /*
      Stable aliases for route.ts / forecast.ts / page.tsx.
    */
    officialForecastMaxC,
    hkoOfficialForecastMaxC: officialForecastMaxC,
    forecastMaxC: officialForecastMaxC,
    hkoForecastMaxC: officialForecastMaxC,

    officialForecastMinC,
    hkoOfficialForecastMinC: officialForecastMinC,
    forecastMinC: officialForecastMinC,
    hkoForecastMinC: officialForecastMinC,

    /*
      Compatibility with common raw-HKO paths:
        forecast.forecastMaxtemp.value
        forecast.forecastMintemp.value
    */
    forecastMaxtemp:
      officialForecastMaxC === null
        ? null
        : {
            value: officialForecastMaxC,
            unit: "C"
          },
    forecastMintemp:
      officialForecastMinC === null
        ? null
        : {
            value: officialForecastMinC,
            unit: "C"
          }
  };
}

export async function getHkoSinceMidnightMaxMin(): Promise<HkoSinceMidnightMaxMin | null> {
  const { text, lastModified } = await fetchTextWithLastModified(
    HKO_SINCE_MIDNIGHT_MAX_MIN_CSV
  );

  const rows = parseCsv(text);
  const row = findHkoRow(rows);

  if (!row) {
    return null;
  }

  /*
    Important:
    Do NOT run parseNumber() blindly on every CSV cell.
    Otherwise station names can become 0 and times like 14:30 can become 1430.
  */
  const temperatureValues = row
    .map((cell) => parseTemperatureCell(cell))
    .filter((value): value is number => value !== null);

  const timeCells = extractTimeCells(row);

  const maxTempC = temperatureValues[0] ?? null;
  const minTempC = temperatureValues[1] ?? null;

  return {
    stationName: "HK Observatory",
    maxTempC,
    maxTempTime: timeCells[0] ?? null,
    minTempC,
    minTempTime: timeCells[1] ?? null,
    source: "HKO latest maximum/minimum air temperature since midnight CSV",
    sourceUpdatedAt: lastModified
  };
}

export async function getHkoHourlyRainfall(): Promise<HkoHourlyRainfall | null> {
  try {
    const raw = await fetchJson<RawHourlyRainfall>(
      `${HKO_HOURLY_RAINFALL_API}?lang=en`
    );

    const row =
      raw.hourlyRainfall?.find((item) =>
        isHkoStationName(
          item.automaticWeatherStation ?? item.automaticWeatherStationID
        )
      ) ?? null;

    if (!row) {
      return {
        obsTime: raw.obsTime ?? null,
        stationName: null,
        rainfallMm: null,
        unit: null,
        warning:
          "HKO automatic weather station rainfall row was not found. This rainfall dataset is provisional."
      };
    }

    return {
      obsTime: raw.obsTime ?? null,
      stationName: row.automaticWeatherStation ?? null,
      rainfallMm: parseNumber(row.value),
      unit: row.unit ?? null,
      warning:
        "Hourly rainfall from automatic weather stations is provisional and may differ from official climatological records."
    };
  } catch {
    return null;
  }
}

export async function getHkoWeatherSnapshot(): Promise<HkoWeatherSnapshot> {
  /*
    Use allSettled so one HKO sub-source failing does not 500 the whole app.
  */
  const [currentResult, forecastResult, sinceMidnightResult, hourlyRainfallResult] =
    await Promise.allSettled([
      getHkoCurrentWeather(),
      getHkoForecast(),
      getHkoSinceMidnightMaxMin(),
      getHkoHourlyRainfall()
    ]);

  const sourceErrors: HkoSourceError[] = [];

  if (currentResult.status === "rejected") {
    sourceErrors.push({
      source: "hko-current-weather",
      message: getErrorMessage(currentResult.reason)
    });
  }

  if (forecastResult.status === "rejected") {
    sourceErrors.push({
      source: "hko-forecast",
      message: getErrorMessage(forecastResult.reason)
    });
  }

  if (sinceMidnightResult.status === "rejected") {
    sourceErrors.push({
      source: "hko-since-midnight-max-min",
      message: getErrorMessage(sinceMidnightResult.reason)
    });
  }

  if (hourlyRainfallResult.status === "rejected") {
    sourceErrors.push({
      source: "hko-hourly-rainfall",
      message: getErrorMessage(hourlyRainfallResult.reason)
    });
  }

  const current =
    currentResult.status === "fulfilled"
      ? currentResult.value
      : makeEmptyCurrentWeather();

  const forecast =
    forecastResult.status === "fulfilled"
      ? forecastResult.value
      : makeEmptyForecast();

  const sinceMidnight =
    sinceMidnightResult.status === "fulfilled"
      ? sinceMidnightResult.value
      : null;

  const hourlyRainfall =
    hourlyRainfallResult.status === "fulfilled"
      ? hourlyRainfallResult.value
      : null;

  const hkoCurrentTempC = roundNumber(current.hkoCurrentTempC, 2);

  /*
    Observed max lower-bound rule:

      final daily max >= max(
        HKO max since midnight,
        HKO current temperature
      )

    If since-midnight CSV is unavailable, current HKO temperature is still a
    valid lower bound for final daily max.
  */
  const hkoMaxSinceMidnightC = roundNumber(
    maxNumber([sinceMidnight?.maxTempC, hkoCurrentTempC]),
    2
  );

  const hkoMinSinceMidnightC = roundNumber(sinceMidnight?.minTempC, 2);

  const officialForecastMaxC = roundNumber(
    firstNumber([
      forecast.officialForecastMaxC,
      forecast.hkoOfficialForecastMaxC,
      forecast.forecastMaxC,
      forecast.hkoForecastMaxC,
      forecast.days[0]?.forecastMaxtempC
    ]),
    2
  );

  const officialForecastMinC = roundNumber(
    firstNumber([
      forecast.officialForecastMinC,
      forecast.hkoOfficialForecastMinC,
      forecast.forecastMinC,
      forecast.hkoForecastMinC,
      forecast.days[0]?.forecastMintempC
    ]),
    2
  );

  const hourlyRainfallMm = roundNumber(hourlyRainfall?.rainfallMm, 2);

  const hkoSourceAvailable =
    hkoCurrentTempC !== null ||
    hkoMaxSinceMidnightC !== null ||
    hkoMinSinceMidnightC !== null ||
    officialForecastMaxC !== null ||
    hourlyRainfallMm !== null;

  const warnings = [
    ...sourceErrors.map((error) => `${error.source}: ${error.message}`),
    sinceMidnight === null
      ? "HKO since-midnight maximum/minimum CSV was unavailable or did not contain an HK Observatory row."
      : null,
    officialForecastMaxC === null
      ? "HKO official forecast maximum was unavailable."
      : null,
    hourlyRainfall === null
      ? "HKO hourly rainfall feed was unavailable."
      : hourlyRainfall.warning ?? null
  ].filter((item): item is string => Boolean(item));

  const hkoMaxSinceMidnightSource =
    sinceMidnight?.maxTempC !== null && sinceMidnight?.maxTempC !== undefined
      ? sinceMidnight.source
      : hkoCurrentTempC !== null
        ? "HKO current temperature fallback"
        : null;

  const snapshot = {
    /*
      Original shape.
    */
    current,
    forecast,
    sinceMidnight,
    hourlyRainfall,

    /*
      Stable top-level aliases for downstream code.
    */
    hkoCurrentTempC,
    currentTempC: hkoCurrentTempC,
    currentTemperatureC: hkoCurrentTempC,
    temperatureC: hkoCurrentTempC,

    hkoMaxSinceMidnightC,
    maxSinceMidnightC: hkoMaxSinceMidnightC,
    hkoMaxSoFarC: hkoMaxSinceMidnightC,
    maxSoFarC: hkoMaxSinceMidnightC,

    observedMaxC: hkoMaxSinceMidnightC,
    observedMaxSoFarC: hkoMaxSinceMidnightC,
    observedMaxLowerBoundC: hkoMaxSinceMidnightC,
    observedFinalMaxLowerBoundC: hkoMaxSinceMidnightC,

    hkoMinSinceMidnightC,
    minSinceMidnightC: hkoMinSinceMidnightC,
    observedMinC: hkoMinSinceMidnightC,
    observedMinSoFarC: hkoMinSinceMidnightC,
    minSoFarC: hkoMinSinceMidnightC,

    officialForecastMaxC,
    hkoOfficialForecastMaxC: officialForecastMaxC,
    forecastMaxC: officialForecastMaxC,
    hkoForecastMaxC: officialForecastMaxC,

    officialForecastMinC,
    hkoOfficialForecastMinC: officialForecastMinC,
    forecastMinC: officialForecastMinC,
    hkoForecastMinC: officialForecastMinC,

    observedHourlyRainfallMm: hourlyRainfallMm,
    hourlyRainfallMm,
    rainfallLastHourMm: hourlyRainfallMm,
    rainfallPastHourMm: hourlyRainfallMm,
    rainHourlyMm: hourlyRainfallMm,
    rainfallMm: hourlyRainfallMm,

    /*
      Compatibility raw-ish aliases.
    */
    weatherForecast: forecast.weatherForecast ?? [],
    days: forecast.days ?? [],
    forecastMaxtemp:
      officialForecastMaxC === null
        ? null
        : {
            value: officialForecastMaxC,
            unit: "C"
          },
    forecastMintemp:
      officialForecastMinC === null
        ? null
        : {
            value: officialForecastMinC,
            unit: "C"
          },

    /*
      Diagnostics.
    */
    sourceStatus: {
      hko: hkoSourceAvailable,
      current: currentResult.status === "fulfilled",
      forecast: forecastResult.status === "fulfilled",
      sinceMidnight: sinceMidnight !== null,
      hourlyRainfall: hourlyRainfall !== null
    },

    sourceErrors,
    errors: sourceErrors,
    warnings,

    sourceDiagnostics: {
      hko: {
        ok: hkoSourceAvailable,
        status: hkoSourceAvailable ? "ok" : "unavailable",
        errors: sourceErrors,
        warnings
      },
      currentTemperature: {
        valueC: hkoCurrentTempC,
        source: hkoCurrentTempC !== null ? "HKO current weather API" : null
      },
      maxSinceMidnight: {
        valueC: hkoMaxSinceMidnightC,
        source: hkoMaxSinceMidnightSource,
        rawCsvMaxTempC: sinceMidnight?.maxTempC ?? null,
        fallbackCurrentTempC: hkoCurrentTempC
      },
      minSinceMidnight: {
        valueC: hkoMinSinceMidnightC,
        source: sinceMidnight?.source ?? null
      },
      officialForecastMax: {
        valueC: officialForecastMaxC,
        source:
          officialForecastMaxC !== null
            ? "HKO 9-day weather forecast first day"
            : null
      },
      hourlyRainfall: {
        valueMm: hourlyRainfallMm,
        source:
          hourlyRainfallMm !== null
            ? "HKO hourly rainfall automatic weather station feed"
            : null,
        warning: hourlyRainfall?.warning ?? null
      }
    }
  };

  /*
    Cast is intentional:
    '@/types' may define HkoWeatherSnapshot narrowly as only:
      { current, forecast, sinceMidnight, hourlyRainfall }
    but downstream route.ts / forecast.ts benefits from the extra aliases.
  */
  return snapshot as HkoWeatherSnapshot;
}

function getNestedNumericValue(value: unknown): number | null {
  const direct = parseNumber(value);

  if (direct !== null) {
    return direct;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = getNestedNumericValue(item);

      if (nested !== null) {
        return nested;
      }
    }

    return null;
  }

  const record = value as Record<string, unknown>;

  for (const key of ["value", "data", "reading", "readings"]) {
    const nested = getNestedNumericValue(record[key]);

    if (nested !== null) {
      return nested;
    }
  }

  return null;
}

export async function getHkoSettlementMax(
  dateCompact: string
): Promise<SettlementResult> {
  const url = `${HKO_OPEN_DATA_API}?dataType=RYES&lang=en&date=${dateCompact}`;
  const raw = await fetchJson<Record<string, unknown>>(url);

  const exactKeys = ["HKOMaxTemp", "HKOReadingsMaxTemp"];

  for (const key of exactKeys) {
    if (key in raw) {
      const officialMaxTempC = getNestedNumericValue(raw[key]);

      return {
        date: dateCompact,
        stationCode: "HKO",
        stationName: "HK Observatory",
        officialMaxTempC,
        rawKey: key,
        available: officialMaxTempC !== null,
        note:
          "RYES is the HKO Weather and Radiation Level Report. It is normally available after the next day 01:30 HKT."
      };
    }
  }

  const fuzzyEntry = Object.entries(raw).find(([key]) => {
    const lower = key.toLowerCase();
    return lower.includes("hko") && lower.includes("maxtemp");
  });

  if (fuzzyEntry) {
    const [key, value] = fuzzyEntry;
    const parsed = getNestedNumericValue(value);

    return {
      date: dateCompact,
      stationCode: "HKO",
      stationName: "HK Observatory",
      officialMaxTempC: parsed,
      rawKey: key,
      available: parsed !== null,
      note:
        "RYES is the HKO Weather and Radiation Level Report. It is normally available after the next day 01:30 HKT."
    };
  }

  return {
    date: dateCompact,
    stationCode: "HKO",
    stationName: "HK Observatory",
    officialMaxTempC: null,
    rawKey: null,
    available: false,
    note:
      "No HKO MaxTemp key was found in RYES. The date may be too recent or the response format may have changed."
  };
}
