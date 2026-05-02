export type TradeSide = "BUY_YES" | "BUY_NO" | "NO_TRADE";

export type SignalStrength = "NONE" | "WEAK" | "MEDIUM" | "STRONG";

export type PriceQuality = "GOOD" | "WIDE_SPREAD" | "STALE" | "MISSING_PRICE";

export type ProbabilitySource =
  | "weatherProbability"
  | "weatherFairProbability"
  | "modelProbability"
  | "forecastProbability"
  | "finalProbability"
  | "probability"
  | "missing";

export type ConfidenceLabel = "low" | "medium" | "high";

export type OutcomeTradeInputs = {
  outcomeName: string;

  /**
   * Decision probability for YES.
   *
   * Important:
   * Prefer weather-only / model fair probability here.
   * Do not blindly use market-blended probability for edge discovery,
   * otherwise the market price partially compares against itself.
   */
  modelProbability: number;

  /**
   * False means the model probability was missing and modelProbability is only
   * a safe placeholder. Signal engine must not trade in that case.
   */
  modelProbabilityAvailable?: boolean;

  probabilitySource?: ProbabilitySource;

  weatherProbability?: number | null;
  finalProbability?: number | null;
  marketProbability?: number | null;

  /**
   * CLOB executable / executable-derived prices, normalized to 0..1.
   *
   * yesAsk = cost to buy YES now.
   * noAsk = cost to buy NO now.
   * yesBid ≈ 1 - noAsk.
   * noBid ≈ 1 - yesAsk.
   */
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  midpoint: number | null;
  spread: number | null;

  confidence: number | null;
  confidenceLabel?: ConfidenceLabel | null;

  /**
   * Used for stale price penalty.
   */
  priceAgeSeconds?: number | null;

  /**
   * Future use: if settlement / resolution mapping is uncertain, block trade.
   */
  resolutionConfidence?: number | null;
};

export type OutcomeTradeSignal = {
  outcomeName: string;

  side: TradeSide;
  strength: SignalStrength;
  shouldTrade: boolean;

  modelProbability: number;
  modelNoProbability: number;
  modelProbabilityAvailable: boolean;
  probabilitySource: ProbabilitySource;

  weatherProbability: number | null;
  finalProbability: number | null;
  marketProbability: number | null;

  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  midpoint: number | null;
  spread: number | null;

  /**
   * Executable edge:
   * YES edge = model P(YES) - YES ask.
   * NO edge = model P(NO) - NO ask.
   */
  yesEdge: number | null;
  noEdge: number | null;
  bestEdge: number | null;

  /**
   * Minimum edge required before signal becomes tradable.
   * Includes uncertainty, confidence, stale-price, spread/liquidity,
   * and resolution-risk buffers.
   */
  requiredEdge: number;

  /**
   * Max entry is the highest price where edge still clears requiredEdge.
   */
  maxYesEntry: number | null;
  maxNoEntry: number | null;

  recommendedStakeFraction: number;

  priceQuality: PriceQuality;
  priceAgeSeconds: number | null;
  resolutionConfidence: number | null;

  reasons: string[];
  warnings: string[];
};
