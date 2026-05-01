export type RainIntensity =
  | "none"
  | "light"
  | "moderate"
  | "heavy"
  | "violent"
  | "thunderstorm";

export type HkoRainfallRow = {
  place?: string | null;
  max?: number | null;
  unit?: string | null;

  [key: string]: unknown;
};

export type HkoCurrent = {
  updateTime?: string | null;
  recordTime?: string | null;

  hkoCurrentTempC?: number | null;
  hkoHumidityPct?: number | null;

  rainfall?: HkoRainfallRow[];

  [key: string]: unknown;
};

export type HkoSinceMidnight = {
  stationName?: string | null;

  maxTempC?: number | null;
  maxTempTime?: string | null;

  minTempC?: number | null;
  minTempTime?: string | null;

  source?: string | null;
  sourceUpdatedAt?: string | null;

  [key: string]: unknown;
};

export type HkoHourlyRainfall = {
  obsTime?: string | null;
  stationName?: string | null;

  rainfallMm?: number | null;
  unit?: string | null;
  warning?: string | null;

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
   * Some app UI reads lowercase psr.
   * Keep both to avoid casing mismatch.
   */
  psr?: string | null;

  [key: string]: unknown;
};

export type HkoForecast = {
  /**
   * Required because getHkoWeatherSnapshot() should always return
   * a forecast object. If no forecast rows exist, use an empty array.
   */
  days: HkoForecastDay[];

  updateTime?: string | null;
  generalSituation?: string | null;

  [key: string]: unknown;
};

export type HkoWeatherSnapshot = {
  hktDate?: string | null;

  temperatureC?: number | null;
  humidityPct?: number | null;
  rainfallMm?: number | null;
  rainIntensity?: RainIntensity | null;

  /**
   * Required: getHkoWeatherSnapshot() should always return these.
   */
  current: HkoCurrent;
  forecast: HkoForecast;

  /**
   * Optional: these may fail independently or be unavailable.
   */
  sinceMidnight?: HkoSinceMidnight | null;
  hourlyRainfall?: HkoHourlyRainfall | null;

  source?: string | null;
  observedAt?: string | null;
  raw?: unknown;

  [key: string]: unknown;
};

export type OutcomeRange = {
  name: string;
  lower: number | null;
  upper: number | null;

  /**
   * Main market probability shown in UI.
   * Prefer CLOB midpoint. Fall back to Gamma YES price.
   */
  marketPrice?: number | null;
  price?: number | null;
  marketPriceSource?: string | null;

  /**
   * Gamma binary market prices.
   */
  yesPrice?: number | null;
  noPrice?: number | null;

  /**
   * Token IDs.
   */
  tokenId?: string | null;
  clobTokenId?: string | null;
  yesTokenId?: string | null;
  noTokenId?: string | null;

  /**
   * CLOB-derived prices.
   */
  clobMidpoint?: number | null;
  yesAsk?: number | null;
  noAsk?: number | null;
  yesBid?: number | null;
  clobSpread?: number | null;

  [key: string]: unknown;
};

export type MarketOutcome = OutcomeRange;

export type ForecastOutcomeProbability = {
  name: string;

  /**
   * Forecast model probability.
   * Example: 0.57 means 57%.
   */
  probability: number;

  /**
   * Optional range metadata.
   */
  lower?: number | null;
  upper?: number | null;

  /**
   * Optional market comparison fields.
   */
  marketPrice?: number | null;
  polymarketProbability?: number | null;
  edge?: number | null;

  [key: string]: unknown;
};

export type OutcomeProbability = ForecastOutcomeProbability;

export type EstimatedFinalMaxC = {
  p10?: number | null;
  p25?: number | null;
  median?: number | null;
  p75?: number | null;
  p90?: number | null;

  [key: string]: unknown;
};

export type ForecastPercentiles = EstimatedFinalMaxC;

/**
 * Keep this flexible because API routes / AI wrappers / DB history
 * may not always return every UI field.
 */
export type ForecastResult = {
  hktDate?: string | null;
  targetDate?: string | null;

  generatedAt?: string | null;

  hkoCurrentTempC?: number | null;
  autoMaxSoFarC?: number | null;

  maxSoFarC?: number | null;
  maxSoFarSource?: string | null;

  officialForecastMaxC?: number | null;
  observedHourlyRainfallMm?: number | null;

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
  stationCode?: string | null;
  stationName?: string | null;

  officialMaxTempC?: number | null;
  officialMinTempC?: number | null;

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
  winningOutcome?: string | null;
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

  /**
   * Optional app/admin fields.
   */
  stationCode?: "HKO" | string;
  stationName?: string;

  balance?: number;
  cash?: number;
  position?: number;
  holdings?: number;

  lastForecast?: ForecastResult | null;
  lastSettlement?: SettlementResult | null;

  [key: string]: unknown;
};

/**
 * Compatibility aliases for older imports used across the app.
 */
export type WeatherSnapshot = HkoWeatherSnapshot;
export type HkoSinceMidnightMaxMin = HkoSinceMidnight;
export type HkoMaxMinSinceMidnight = HkoSinceMidnight;
export type HkoCurrentWeather = HkoCurrent;
export type HkoForecast9Day = HkoForecast;
export type HkoForecastSnapshot = HkoForecast;
