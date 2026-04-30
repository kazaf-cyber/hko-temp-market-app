export type RainIntensity =
  | "none"
  | "light"
  | "moderate"
  | "heavy"
  | "violent"
  | string;

export type HkoForecastDay = {
  forecastDate?: string;
  week?: string;
  forecastWeather?: string | null;
  forecastWind?: string | null;

  /**
   * Must match the property used in src/app/page.tsx.
   */
  forecastMaxtempC?: number | null;
  forecastMintempC?: number | null;

  forecastMaxrh?: number | null;
  forecastMinrh?: number | null;
  ForecastIcon?: number | null;
  PSR?: string | null;

  [key: string]: unknown;
};

export type HkoForecast = {
  days?: HkoForecastDay[];
  updateTime?: string;
  [key: string]: unknown;
};

export type WeatherSnapshot = {
  hktDate?: string;
  temperatureC?: number | null;
  humidityPct?: number | null;
  rainfallMm?: number | null;
  rainIntensity?: RainIntensity;

  forecast?: HkoForecast | null;

  source?: string;
  observedAt?: string;
  raw?: unknown;

  [key: string]: unknown;
};

export type HkoWeatherSnapshot = WeatherSnapshot;
