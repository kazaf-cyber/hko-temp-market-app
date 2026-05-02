import {
  clamp,
  clampProbability,
  isFiniteNumber,
  roundNumber,
  roundProbability
} from "./math";

function isValidPrice(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

export function calculateYesEdge(
  modelYesProbability: number,
  yesAsk: number | null
): number | null {
  if (!isValidPrice(yesAsk)) {
    return null;
  }

  return roundNumber(clampProbability(modelYesProbability) - yesAsk);
}

export function calculateNoEdge(
  modelYesProbability: number,
  noAsk: number | null
): number | null {
  if (!isValidPrice(noAsk)) {
    return null;
  }

  const modelNoProbability = clampProbability(1 - modelYesProbability);

  return roundNumber(modelNoProbability - noAsk);
}

export function calculateRequiredEdge(params: {
  spread: number | null;
  confidence: number | null;
  confidenceLabel?: "low" | "medium" | "high" | null;
  priceAgeSeconds?: number | null;
  resolutionConfidence?: number | null;
}): number {
  const baseBuffer = 0.02;

  /**
   * We already compare against executable ask, so spread is not fully charged
   * again. But wide spread still means worse fill quality / stale risk.
   */
  const spreadPenalty =
    isValidPrice(params.spread) && params.spread > 0
      ? clamp(params.spread * 0.5, 0.005, 0.06)
      : 0.02;

  const labelConfidencePenalty =
    params.confidenceLabel === "high"
      ? 0.005
      : params.confidenceLabel === "medium"
        ? 0.02
        : params.confidenceLabel === "low"
          ? 0.04
          : 0.025;

  const numericConfidence =
    isFiniteNumber(params.confidence) && params.confidence >= 0 && params.confidence <= 1
      ? params.confidence
      : null;

  const numericConfidencePenalty =
    numericConfidence === null ? 0.015 : clamp((0.75 - numericConfidence) * 0.08, 0, 0.04);

  const priceAgeSeconds =
    isFiniteNumber(params.priceAgeSeconds) && params.priceAgeSeconds >= 0
      ? params.priceAgeSeconds
      : null;

  const stalePricePenalty =
    priceAgeSeconds === null
      ? 0.01
      : priceAgeSeconds > 90
        ? 0.04
        : priceAgeSeconds > 45
          ? 0.025
          : priceAgeSeconds > 15
            ? 0.01
            : 0;

  const resolutionConfidence =
    isFiniteNumber(params.resolutionConfidence) &&
    params.resolutionConfidence >= 0 &&
    params.resolutionConfidence <= 1
      ? params.resolutionConfidence
      : 0.95;

  const resolutionPenalty =
    resolutionConfidence < 0.85
      ? 0.05
      : resolutionConfidence < 0.9
        ? 0.03
        : resolutionConfidence < 0.95
          ? 0.01
          : 0;

  const requiredEdge =
    baseBuffer +
    spreadPenalty +
    labelConfidencePenalty +
    numericConfidencePenalty +
    stalePricePenalty +
    resolutionPenalty;

  return roundProbability(clamp(requiredEdge, 0.035, 0.18));
}

/**
 * Conservative fractional Kelly for a binary prediction-market share.
 *
 * If price is c and true probability is p, full Kelly fraction of bankroll
 * allocated to contract cost is approximately:
 *
 *   f = (p - c) / (1 - c)
 *
 * This function applies a small multiplier and a hard cap.
 */
export function calculateKellyFraction(params: {
  probability: number;
  entryPrice: number;
  kellyMultiplier?: number;
  maxFraction?: number;
}): number {
  const probability = clampProbability(params.probability);
  const entryPrice = clamp(params.entryPrice, 0.0001, 0.9999);

  const fullKelly = (probability - entryPrice) / (1 - entryPrice);

  if (!Number.isFinite(fullKelly) || fullKelly <= 0) {
    return 0;
  }

  const kellyMultiplier = params.kellyMultiplier ?? 0.25;
  const maxFraction = params.maxFraction ?? 0.015;

  return roundNumber(clamp(fullKelly * kellyMultiplier, 0, maxFraction), 4);
}
