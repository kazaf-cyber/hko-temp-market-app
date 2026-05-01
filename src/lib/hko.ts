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

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(/[^\d.-]/g, "");
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

function pickHkoStationValue(
  data:
    | Array<{
        place?: string;
        value?: number;
        unit?: string;
      }>
    | undefined
) {
  if (!data || data.length === 0) {
    return null;
  }

  const exactHkoStation = data.find((item) =>
    (item.place ?? "").toLowerCase().includes("HK Observatory")
  );

  const selected = exactHkoStation ?? data[0];

  return typeof selected.value === "number" ? selected.value : null;
}

function extractTimeCells(row: string[]) {
  return row.filter((cell) => {
    const trimmed = cell.trim();
    return /^([01]\d|2[0-3]):[0-5]\d/.test(trimmed);
  });
}

function findHkoRow(rows: string[][]) {
  return rows.find((row) =>
    row.some((cell) => {
      const lower = cell.toLowerCase();
      return (
        lower.includes("HK Observatory") ||
        lower === "hko" ||
        cell.includes("香港天文台")
      );
    })
  );
}

export async function getHkoCurrentWeather() {
  const url = `${HKO_WEATHER_API}?dataType=rhrread&lang=en`;
  const raw = await fetchJson<RawHkoCurrentWeather>(url);

  const hkoCurrentTempC = pickHkoStationValue(raw.temperature?.data);
  const hkoHumidityPct = pickHkoStationValue(raw.humidity?.data);

  return {
    updateTime: raw.updateTime ?? null,
    recordTime: raw.temperature?.recordTime ?? null,
    hkoCurrentTempC,
    hkoHumidityPct,
    rainfall:
      raw.rainfall?.data?.map((item) => ({
        place: item.place ?? "Unknown",
        max: typeof item.max === "number" ? item.max : null,
        unit: item.unit ?? null
      })) ?? []
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

  return {
    updateTime: raw.updateTime ?? null,
    generalSituation: raw.generalSituation ?? null,
    days
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

  const numericValues = row
    .map((cell) => parseNumber(cell))
    .filter((value): value is number => value !== null);

  const timeCells = extractTimeCells(row);

  return {
    stationName: "HK Observatory",
    maxTempC: numericValues[0] ?? null,
    maxTempTime: timeCells[0] ?? null,
    minTempC: numericValues[1] ?? null,
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
        (item.automaticWeatherStation ?? "")
          .toLowerCase()
          .includes("HK Observatory")
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
  const [current, forecast, sinceMidnight, hourlyRainfall] = await Promise.all([
    getHkoCurrentWeather(),
    getHkoForecast(),
    getHkoSinceMidnightMaxMin(),
    getHkoHourlyRainfall()
  ]);

  return {
    current,
    forecast,
    sinceMidnight,
    hourlyRainfall
  };
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
      return {
        date: dateCompact,
        stationCode: "HKO",
        stationName: "HK Observatory",
        officialMaxTempC: getNestedNumericValue(raw[key]),
        rawKey: key,
        available: getNestedNumericValue(raw[key]) !== null,
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
