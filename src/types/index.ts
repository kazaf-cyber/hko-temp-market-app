export type RainIntensity =
  | "none"
  | "light"
  | "moderate"
  | "heavy"
  | "violent"
  | "thunderstorm"
  | string;

export type HkoCurrent = {
  hkoCurrentTempC?: number | null;
  recordTime?: string | null;

  [key: string]: unknown;
};

export type HkoSinceMidnight = {
  maxTempC?: number | null;
  maxTempTime?: string | null;

  minTempC?: number | null;
  minTempTime?: string | null;

  [key: string]: unknown;
};

export type HkoHourlyRainfall = {
  rainfallMm?: number | null;
  obsTime?: string | null;

  [key: string]: unknown;
};

export type HkoForecastDay = {
  forecastDate?: string;
  week?: string;

  forecastWeather?: string | null;
  forecastWind?: string | null;

  forecastMaxtempC?: number | null;
  forecastMintempC?: number | null;

  forecastMaxrh?: number | null;
  forecastMinrh?: number | null;

  ForecastIcon?: number | null;

  /**
   * HKO data sometimes uses uppercase PSR.
   */
  PSR?: string | null;

  /**
   * Your page.tsx currently reads lowercase psr.
   * Keep both to avoid TypeScript/runtime mismatch.
   */
  psr?: string | null;

  [key: string]: unknown;
};

export type HkoForecast = {
  days?: HkoForecastDay[];
  updateTime?: string | null;

  [key: string]: unknown;
};

export type HkoWeatherSnapshot = {
  hktDate?: string;

  temperatureC?: number | null;
  humidityPct?: number | null;
  rainfallMm?: number | null;
  rainIntensity?: RainIntensity | null;

  current?: HkoCurrent | null;
  sinceMidnight?: HkoSinceMidnight | null;
  hourlyRainfall?: HkoHourlyRainfall | null;
  forecast?: HkoForecast | null;

  source?: string;
  observedAt?: string;
  raw?: unknown;

  [key: string]: unknown;
};

export type MarketOutcome = {
  name: string;
  lower: number | null;
  upper: number | null;

  [key: string]: unknown;
};

export type ForecastOutcomeProbability = {
  name: string;
  probability: number;

  [key: string]: unknown;
};

export type EstimatedFinalMaxC = {
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;

  [key: string]: unknown;
};

export type ForecastResult = {
  hktDate?: string;
  targetDate?: string;

  generatedAt: string;

  maxSoFarC: number | null;
  maxSoFarSource: string;

  estimatedFinalMaxC: EstimatedFinalMaxC;
  outcomeProbabilities: ForecastOutcomeProbability[];

  keyDrivers: string[];
  warnings: string[];

  predictedTempC?: number | null;
  predictedMinTempC?: number | null;
  predictedMaxTempC?: number | null;

  confidence?: number | null;
  recommendation?: string | null;
  reason?: string | null;
  aiExplanation?: string | null;

  rainIntensity?: RainIntensity | null;

  [key: string]: unknown;
};

export type SettlementResult = {
  hktDate?: string;
  targetDate?: string;

  date: string;
  officialMaxTempC: number | null;
  available: boolean;

  rawKey?: string | null;
  note?: string | null;

  settled?: boolean;

  actualTempC?: number | null;
  forecastTempC?: number | null;
  predictedTempC?: number | null;

  difference?: number | null;
  pnl?: number | null;

  outcome?: string | null;
  reason?: string | null;

  [key: string]: unknown;
};

export type MarketState = {
  useAI: boolean;

  outcomes: MarketOutcome[];

  manualMaxOverrideC: number | null;
  rainEtaMinutes: number | null;

  cloudCoverPct: number;
  rainProbability60m: number;
  rainProbability120m: number;

  expectedRainIntensity: RainIntensity;

  balance?: number;
  cash?: number;
  position?: number;
  holdings?: number;

  lastForecast?: ForecastResult | null;
  lastSettlement?: SettlementResult | null;

  [key: string]: unknown;
};
