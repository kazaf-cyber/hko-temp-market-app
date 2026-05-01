const HKO_LAT = 22.3027;
const HKO_LON = 114.1747;

export type OpenMeteoHourlyPoint = {
  time: string;
  temperature2mC: number | null;
  relativeHumidity2mPct: number | null;
  dewPoint2mC: number | null;
  precipitationProbabilityPct: number | null;
  precipitationMm: number | null;
  rainMm: number | null;
  cloudCoverPct: number | null;
  cloudCoverLowPct: number | null;
  cloudCoverMidPct: number | null;
  cloudCoverHighPct: number | null;
  windSpeed10mKmh: number | null;
  windDirection10mDeg: number | null;
  shortwaveRadiationWm2: number | null;
};

export type OpenMeteoCurrent = {
  time: string | null;
  temperature2mC: number | null;
  relativeHumidity2mPct: number | null;
  precipitationMm: number | null;
  rainMm: number | null;
  cloudCoverPct: number | null;
  windSpeed10mKmh: number | null;
  windDirection10mDeg: number | null;
};

export type OpenMeteoForecast = {
  source: "open-meteo";
  enabled: true;
  fetchedAt: string;
  latitude: number;
  longitude: number;
  timezone: string | null;
  current: OpenMeteoCurrent | null;
  hourly: OpenMeteoHourlyPoint[];
};

type OpenMeteoRaw = {
  latitude?: number;
  longitude?: number;
  timezone?: string;
  current?: Record<string, unknown>;
  hourly?: Record<string, unknown>;
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

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getAt(record: Record<string, unknown> | undefined, key: string, i: number) {
  const values = arr(record?.[key]);
  return values[i];
}

export async function getOpenMeteoForecast(): Promise<OpenMeteoForecast> {
  const params = new URLSearchParams({
    latitude: String(HKO_LAT),
    longitude: String(HKO_LON),
    timezone: "Asia/Hong_Kong",
    forecast_days: "7",
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "precipitation",
      "rain",
      "cloud_cover",
      "wind_speed_10m",
      "wind_direction_10m"
    ].join(","),
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "dew_point_2m",
      "precipitation_probability",
      "precipitation",
      "rain",
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "wind_speed_10m",
      "wind_direction_10m",
      "shortwave_radiation"
    ].join(",")
  });

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Open-Meteo request failed: ${response.status} ${response.statusText}`
    );
  }

  const raw = (await response.json()) as OpenMeteoRaw;
  const hourly = raw.hourly ?? {};
  const times = arr(hourly.time).map(String);

  const points: OpenMeteoHourlyPoint[] = times.map((time, i) => ({
    time,
    temperature2mC: num(getAt(hourly, "temperature_2m", i)),
    relativeHumidity2mPct: num(getAt(hourly, "relative_humidity_2m", i)),
    dewPoint2mC: num(getAt(hourly, "dew_point_2m", i)),
    precipitationProbabilityPct: num(
      getAt(hourly, "precipitation_probability", i)
    ),
    precipitationMm: num(getAt(hourly, "precipitation", i)),
    rainMm: num(getAt(hourly, "rain", i)),
    cloudCoverPct: num(getAt(hourly, "cloud_cover", i)),
    cloudCoverLowPct: num(getAt(hourly, "cloud_cover_low", i)),
    cloudCoverMidPct: num(getAt(hourly, "cloud_cover_mid", i)),
    cloudCoverHighPct: num(getAt(hourly, "cloud_cover_high", i)),
    windSpeed10mKmh: num(getAt(hourly, "wind_speed_10m", i)),
    windDirection10mDeg: num(getAt(hourly, "wind_direction_10m", i)),
    shortwaveRadiationWm2: num(getAt(hourly, "shortwave_radiation", i))
  }));

  const current = raw.current
    ? {
        time: str(raw.current.time),
        temperature2mC: num(raw.current.temperature_2m),
        relativeHumidity2mPct: num(raw.current.relative_humidity_2m),
        precipitationMm: num(raw.current.precipitation),
        rainMm: num(raw.current.rain),
        cloudCoverPct: num(raw.current.cloud_cover),
        windSpeed10mKmh: num(raw.current.wind_speed_10m),
        windDirection10mDeg: num(raw.current.wind_direction_10m)
      }
    : null;

  return {
    source: "open-meteo",
    enabled: true,
    fetchedAt: new Date().toISOString(),
    latitude: raw.latitude ?? HKO_LAT,
    longitude: raw.longitude ?? HKO_LON,
    timezone: raw.timezone ?? null,
    current,
    hourly: points
  };
}
