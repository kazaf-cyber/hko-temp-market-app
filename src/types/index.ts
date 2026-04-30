export type RainIntensity =
  | "none"
  | "light"
  | "moderate"
  | "heavy"
  | "violent"
  | "thunderstorm";

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
  forecastDate?: string | null;
  week?: string | null;

  forecastWeather?: string | null;
  forecastWind?: string | null;

  forecastMaxtempC?: number | null;
  forecastMintempC?: number | null;

  forecastMaxrh?: number | null;
  forecastMinrh?: number | null;

  ForecastIcon?: number | null;

  /**
   * Some HKO-style data uses uppercase PSR.
   */
  PSR?: string | null;

  /**
   * Your page.tsx reads lowercase psr.
   * Keep both to avoid casing mismatch.
   */
  psr?: string | null;

  [key: string]: unknown;
};

export type HkoForecast = {
  days?: HkoForecastDay[] | null;
  updateTime?: string | null;

  [key: string]: unknown;
};

export type HkoWeatherSnapshot = {
  hktDate?: string | null;

  temperatureC?: number | null;
  humidityPct?: number | null;
  rainfallMm?: number | null;
  rainIntensity?: RainIntensity | null;

  current?: HkoCurrent | null;
  sinceMidnight?: HkoSinceMidnight | null;
  hourlyRainfall?: HkoHourlyRainfall | null;
  forecast?: HkoForecast | null;

  source?: string | null;
  observedAt?: string | null;
  raw?: unknown;

  [key: string]: unknown;
};

export type OutcomeRange = {
  name: string;
  lower: number | null;
  upper: number | null;

  [key: string]: unknown;
};

export type MarketOutcome = OutcomeRange;

export type MarketOutcome = OutcomeRange;

export type ForecastOutcomeProbability = {
  name: string;
  probability: number;

  [key: string]: unknown;
};

export type EstimatedFinalMaxC = {
  p10?: number | null;
  p25?: number | null;
  median?: number | null;
  p75?: number | null;
  p90?: number | null;

  [key: string]: unknown;
};

/**
 * Keep this flexible because API routes / AI wrappers / DB history
 * may not always return every UI field.
 */
export type ForecastResult = {
  hktDate?: string | null;
  targetDate?: string | null;

  generatedAt?: string | null;

  maxSoFarC?: number | null;
  maxSoFarSource?: string | null;

  estimatedFinalMaxC?: EstimatedFinalMaxC | null;
  outcomeProbabilities?: ForecastOutcomeProbability[] | null;

  keyDrivers?: string[] | null;
  warnings?: string[] | null;

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
  hktDate?: string | null;
  targetDate?: string | null;

  date?: string | null;
  officialMaxTempC?: number | null;
  available?: boolean | null;

  rawKey?: string | null;
  note?: string | null;

  settled?: boolean | null;

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

  outcomes: OutcomeRange[];

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
