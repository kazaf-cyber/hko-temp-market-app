const HKO_LAT = 22.3027;
const HKO_LON = 114.1747;

export type WindyHourlyPoint = {
  timestamp: number;
  iso: string;
  tempC: number | null;
  dewPointC: number | null;
  rhPct: number | null;
  pressurePa: number | null;
  lowCloudPct: number | null;
  midCloudPct: number | null;
  highCloudPct: number | null;
  precipMm3h: number | null;
  windUSurface: number | null;
  windVSurface: number | null;
  windSpeedMs: number | null;
};

export type WindyForecast =
  | {
      source: "windy";
      enabled: false;
      reason: string;
      fetchedAt: string;
      hourly: [];
    }
  | {
      source: "windy";
      enabled: true;
      fetchedAt: string;
      model: string;
      hourly: WindyHourlyPoint[];
      rawUnits: Record<string, string | null>;
    };

type WindyRaw = {
  ts?: unknown;
  units?: Record<string, string | null>;
  [key: string]: unknown;
};

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function values(raw: WindyRaw, key: string): unknown[] {
  const value = raw[key];
  return Array.isArray(value) ? value : [];
}

function valueAt(raw: WindyRaw, key: string, index: number): number | null {
  return num(values(raw, key)[index]);
}

function tempToC(value: number | null, unit: string | null | undefined) {
  if (value === null) {
    return null;
  }

  return unit === "K" ? value - 273.15 : value;
}

function windSpeed(u: number | null, v: number | null) {
  if (u === null || v === null) {
    return null;
  }

  return Math.sqrt(u * u + v * v);
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item)
  );
}

export async function getWindyForecast(): Promise<WindyForecast> {
  const key = process.env.WINDY_API_KEY?.trim();

  if (!key) {
    return {
      source: "windy",
      enabled: false,
      reason: "WINDY_API_KEY is not configured.",
      fetchedAt: new Date().toISOString(),
      hourly: []
    };
  }

  const parameters = [
    "temp",
    "dewpoint",
    "rh",
    "pressure",
    "wind",
    "lclouds",
    "mclouds",
    "hclouds",
    "precip"
  ];

  const body = {
    lat: HKO_LAT,
    lon: HKO_LON,
    model: "gfs",
    parameters,
    levels: ["surface"],
    key
  };

  const response = await fetch("https://api.windy.com/api/point-forecast/v2", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");

    throw new Error(
      [
        `Windy request failed: ${response.status} ${response.statusText}`,
        errorText ? `Response body: ${errorText.slice(0, 500)}` : null,
        `Request model: ${body.model}`,
        `Request parameters: ${parameters.join(",")}`,
        `Has key: ${Boolean(key)}`
      ]
        .filter(Boolean)
        .join(" | ")
    );
  }

  const raw = (await response.json()) as WindyRaw;
  const timestamps = numberArray(raw.ts);
  const units = raw.units ?? {};

  const hourly: WindyHourlyPoint[] = timestamps.map((timestamp, index) => {
    const tempRaw = valueAt(raw, "temp-surface", index);
    const dewRaw = valueAt(raw, "dewpoint-surface", index);
    const u = valueAt(raw, "wind_u-surface", index);
    const v = valueAt(raw, "wind_v-surface", index);

    return {
      timestamp,
      iso: new Date(timestamp).toISOString(),
      tempC: tempToC(tempRaw, units["temp-surface"]),
      dewPointC: tempToC(dewRaw, units["dewpoint-surface"]),
      rhPct: valueAt(raw, "rh-surface", index),
      pressurePa: valueAt(raw, "pressure-surface", index),
      lowCloudPct: valueAt(raw, "lclouds-surface", index),
      midCloudPct: valueAt(raw, "mclouds-surface", index),
      highCloudPct: valueAt(raw, "hclouds-surface", index),
      precipMm3h: valueAt(raw, "past3hprecip-surface", index),
      windUSurface: u,
      windVSurface: v,
      windSpeedMs: windSpeed(u, v)
    };
  });

  return {
    source: "windy",
    enabled: true,
    fetchedAt: new Date().toISOString(),
    model: "gfs",
    hourly,
    rawUnits: units
  };
}
