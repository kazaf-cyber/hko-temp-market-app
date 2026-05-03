const HKO_LAT = 22.3027;
const HKO_LON = 114.1747;

export type OpenMeteoHourlyPoint = {
  time: string;

  temperature2mC: number | null;
  apparentTemperatureC: number | null;
  relativeHumidity2mPct: number | null;
  dewPoint2mC: number | null;

  precipitationProbabilityPct: number | null;
  precipitationMm: number | null;
  rainMm: number | null;
  showersMm: number | null;

  weatherCode: number | null;

  cloudCoverPct: number | null;
  cloudCoverLowPct: number | null;
  cloudCoverMidPct: number | null;
  cloudCoverHighPct: number | null;

  pressureMslHpa: number | null;
  surfacePressureHpa: number | null;
  visibilityM: number | null;

  windSpeed10mKmh: number | null;
  windGusts10mKmh: number | null;
  windDirection10mDeg: number | null;

  shortwaveRadiationWm2: number | null;
  directRadiationWm2: number | null;
  diffuseRadiationWm2: number | null;
  uvIndex: number | null;
  sunshineDurationSeconds: number | null;

  capeJkg: number | null;
};

export type OpenMeteoCurrent = {
  time: string | null;

  temperature2mC: number | null;
  apparentTemperatureC: number | null;
  relativeHumidity2mPct: number | null;
  dewPoint2mC: number | null;

  precipitationMm: number | null;
  rainMm: number | null;
  showersMm: number | null;

  weatherCode: number | null;

  cloudCoverPct: number | null;

  pressureMslHpa: number | null;
  surfacePressureHpa: number | null;
  visibilityM: number | null;

  windSpeed10mKmh: number | null;
  windGusts10mKmh: number | null;
  windDirection10mDeg: number | null;

  shortwaveRadiationWm2: number | null;
};

export type OpenMeteoDailyPoint = {
  date: string;

  temperature2mMaxC: number | null;
  temperature2mMinC: number | null;
  temperature2mMeanC: number | null;

  apparentTemperatureMaxC: number | null;
  apparentTemperatureMinC: number | null;
  apparentTemperatureMeanC: number | null;

  precipitationSumMm: number | null;
  rainSumMm: number | null;
  showersSumMm: number | null;
  precipitationProbabilityMaxPct: number | null;

  windSpeed10mMaxKmh: number | null;
  windGusts10mMaxKmh: number | null;

  shortwaveRadiationSumMjM2: number | null;
  sunshineDurationSeconds: number | null;
  uvIndexMax: number | null;
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
  daily: OpenMeteoDailyPoint[];
};

type OpenMeteoRaw = {
  latitude?: number;
  longitude?: number;
  timezone?: string;
  current?: Record<string, unknown>;
  hourly?: Record<string, unknown>;
  daily?: Record<string, unknown>;
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
  const currentVariables = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "dew_point_2m",
    "precipitation",
    "rain",
    "showers",
    "weather_code",
    "cloud_cover",
    "pressure_msl",
    "surface_pressure",
    "visibility",
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
    "shortwave_radiation"
  ];

  const hourlyVariables = [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "dew_point_2m",
    "precipitation_probability",
    "precipitation",
    "rain",
    "showers",
    "weather_code",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "pressure_msl",
    "surface_pressure",
    "visibility",
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
    "shortwave_radiation",
    "direct_radiation",
    "diffuse_radiation",
    "uv_index",
    "sunshine_duration",
    "cape"
  ];

  const dailyVariables = [
    "temperature_2m_max",
    "temperature_2m_min",
    "temperature_2m_mean",
    "apparent_temperature_max",
    "apparent_temperature_min",
    "apparent_temperature_mean",
    "precipitation_sum",
    "rain_sum",
    "showers_sum",
    "precipitation_probability_max",
    "wind_speed_10m_max",
    "wind_gusts_10m_max",
    "shortwave_radiation_sum",
    "sunshine_duration",
    "uv_index_max"
  ];

  const params = new URLSearchParams({
    latitude: String(HKO_LAT),
    longitude: String(HKO_LON),
    timezone: "Asia/Hong_Kong",
    forecast_days: "3",
    current: currentVariables.join(","),
    hourly: hourlyVariables.join(","),
    daily: dailyVariables.join(","),
    wind_speed_unit: "kmh",
    temperature_unit: "celsius",
    precipitation_unit: "mm"
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo request failed: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as OpenMeteoRaw;

  const hourlyRaw = raw.hourly ?? {};
  const hourlyTimes = arr(hourlyRaw.time).map(String);

  const hourly: OpenMeteoHourlyPoint[] = hourlyTimes.map((time, i) => ({
    time,

    temperature2mC: num(getAt(hourlyRaw, "temperature_2m", i)),
    apparentTemperatureC: num(getAt(hourlyRaw, "apparent_temperature", i)),
    relativeHumidity2mPct: num(getAt(hourlyRaw, "relative_humidity_2m", i)),
    dewPoint2mC: num(getAt(hourlyRaw, "dew_point_2m", i)),

    precipitationProbabilityPct: num(getAt(hourlyRaw, "precipitation_probability", i)),
    precipitationMm: num(getAt(hourlyRaw, "precipitation", i)),
    rainMm: num(getAt(hourlyRaw, "rain", i)),
    showersMm: num(getAt(hourlyRaw, "showers", i)),

    weatherCode: num(getAt(hourlyRaw, "weather_code", i)),

    cloudCoverPct: num(getAt(hourlyRaw, "cloud_cover", i)),
    cloudCoverLowPct: num(getAt(hourlyRaw, "cloud_cover_low", i)),
    cloudCoverMidPct: num(getAt(hourlyRaw, "cloud_cover_mid", i)),
    cloudCoverHighPct: num(getAt(hourlyRaw, "cloud_cover_high", i)),

    pressureMslHpa: num(getAt(hourlyRaw, "pressure_msl", i)),
    surfacePressureHpa: num(getAt(hourlyRaw, "surface_pressure", i)),
    visibilityM: num(getAt(hourlyRaw, "visibility", i)),

    windSpeed10mKmh: num(getAt(hourlyRaw, "wind_speed_10m", i)),
    windGusts10mKmh: num(getAt(hourlyRaw, "wind_gusts_10m", i)),
    windDirection10mDeg: num(getAt(hourlyRaw, "wind_direction_10m", i)),

    shortwaveRadiationWm2: num(getAt(hourlyRaw, "shortwave_radiation", i)),
    directRadiationWm2: num(getAt(hourlyRaw, "direct_radiation", i)),
    diffuseRadiationWm2: num(getAt(hourlyRaw, "diffuse_radiation", i)),
    uvIndex: num(getAt(hourlyRaw, "uv_index", i)),
    sunshineDurationSeconds: num(getAt(hourlyRaw, "sunshine_duration", i)),

    capeJkg: num(getAt(hourlyRaw, "cape", i))
  }));

  const dailyRaw = raw.daily ?? {};
  const dailyTimes = arr(dailyRaw.time).map(String);

  const daily: OpenMeteoDailyPoint[] = dailyTimes.map((date, i) => ({
    date,

    temperature2mMaxC: num(getAt(dailyRaw, "temperature_2m_max", i)),
    temperature2mMinC: num(getAt(dailyRaw, "temperature_2m_min", i)),
    temperature2mMeanC: num(getAt(dailyRaw, "temperature_2m_mean", i)),

    apparentTemperatureMaxC: num(getAt(dailyRaw, "apparent_temperature_max", i)),
    apparentTemperatureMinC: num(getAt(dailyRaw, "apparent_temperature_min", i)),
    apparentTemperatureMeanC: num(getAt(dailyRaw, "apparent_temperature_mean", i)),

    precipitationSumMm: num(getAt(dailyRaw, "precipitation_sum", i)),
    rainSumMm: num(getAt(dailyRaw, "rain_sum", i)),
    showersSumMm: num(getAt(dailyRaw, "showers_sum", i)),
    precipitationProbabilityMaxPct: num(getAt(dailyRaw, "precipitation_probability_max", i)),

    windSpeed10mMaxKmh: num(getAt(dailyRaw, "wind_speed_10m_max", i)),
    windGusts10mMaxKmh: num(getAt(dailyRaw, "wind_gusts_10m_max", i)),

    shortwaveRadiationSumMjM2: num(getAt(dailyRaw, "shortwave_radiation_sum", i)),
    sunshineDurationSeconds: num(getAt(dailyRaw, "sunshine_duration", i)),
    uvIndexMax: num(getAt(dailyRaw, "uv_index_max", i))
  }));

  const current = raw.current
    ? {
        time: str(raw.current.time),

        temperature2mC: num(raw.current.temperature_2m),
        apparentTemperatureC: num(raw.current.apparent_temperature),
        relativeHumidity2mPct: num(raw.current.relative_humidity_2m),
        dewPoint2mC: num(raw.current.dew_point_2m),

        precipitationMm: num(raw.current.precipitation),
        rainMm: num(raw.current.rain),
        showersMm: num(raw.current.showers),

        weatherCode: num(raw.current.weather_code),

        cloudCoverPct: num(raw.current.cloud_cover),

        pressureMslHpa: num(raw.current.pressure_msl),
        surfacePressureHpa: num(raw.current.surface_pressure),
        visibilityM: num(raw.current.visibility),

        windSpeed10mKmh: num(raw.current.wind_speed_10m),
        windGusts10mKmh: num(raw.current.wind_gusts_10m),
        windDirection10mDeg: num(raw.current.wind_direction_10m),

        shortwaveRadiationWm2: num(raw.current.shortwave_radiation)
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
    hourly,
    daily
  };
}
