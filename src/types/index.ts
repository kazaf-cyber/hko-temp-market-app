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
   * Keep this spelling exactly the same as page.tsx:
   * forecastMaxtempC
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
  source?: string;
  observedAt?: string;
  raw?: unknown;

  /**
   * This is the important new field.
   */
  forecast?: HkoForecast | null;

  [key: string]: unknown;
};

export type HkoWeatherSnapshot = WeatherSnapshot;
export type ForecastResult = {
  hktDate: string;
  aiExplanation?: string | null;
  predictedTempC?: number | null;
  predictedMinTempC?: number | null;
  predictedMaxTempC?: number | null;
  confidence?: number | null;
  rainIntensity?: RainIntensity;
  recommendation?: string | null;
  reason?: string | null;
  [key: string]: unknown;
};

export type SettlementResult = {
  hktDate?: string;
  settled?: boolean;
  actualTempC?: number | null;
  forecastTempC?: number | null;
  difference?: number | null;
  outcome?: string | null;
  pnl?: number | null;
  reason?: string | null;
  [key: string]: unknown;
};

export type MarketState = {
  useAI: boolean;
  balance?: number;
  cash?: number;
  position?: number;
  holdings?: number;
  lastForecast?: ForecastResult | null;
  lastSettlement?: SettlementResult | null;
  [key: string]: unknown;
};
