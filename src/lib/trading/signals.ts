import type {
  OutcomeTradeInputs,
  OutcomeTradeSignal,
  PriceQuality,
  SignalStrength,
  TradeSide
} from "./types";
import {
  calculateKellyFraction,
  calculateNoEdge,
  calculateRequiredEdge,
  calculateYesEdge
} from "./ev";
import { clampProbability, isFiniteNumber, roundProbability } from "./math";

function getPriceQuality(params: {
  yesAsk: number | null;
  noAsk: number | null;
  spread: number | null;
  priceAgeSeconds?: number | null;
}): PriceQuality {
  if (params.yesAsk === null && params.noAsk === null) {
    return "MISSING_PRICE";
  }

  if (isFiniteNumber(params.priceAgeSeconds) && params.priceAgeSeconds > 90) {
    return "STALE";
  }

  if (isFiniteNumber(params.spread) && params.spread > 0.08) {
    return "WIDE_SPREAD";
  }

  return "GOOD";
}

function getStrength(edge: number | null, requiredEdge: number): SignalStrength {
  if (edge === null || edge <= requiredEdge) {
    return "NONE";
  }

  const excess = edge - requiredEdge;

  if (excess >= 0.08) {
    return "STRONG";
  }

  if (excess >= 0.04) {
    return "MEDIUM";
  }

  return "WEAK";
}

function getMaxEntry(probability: number, requiredEdge: number): number | null {
  const value = probability - requiredEdge;

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return roundProbability(value);
}

function getStakeCap(strength: SignalStrength): number {
  if (strength === "STRONG") {
    return 0.02;
  }

  if (strength === "MEDIUM") {
    return 0.0125;
  }

  if (strength === "WEAK") {
    return 0.0075;
  }

  return 0;
}

export function buildOutcomeTradeSignal(input: OutcomeTradeInputs): OutcomeTradeSignal {
  const modelProbabilityAvailable =
    input.modelProbabilityAvailable !== false &&
    isFiniteNumber(input.modelProbability) &&
    input.modelProbability >= 0 &&
    input.modelProbability <= 1;

  const modelProbability = modelProbabilityAvailable
    ? clampProbability(input.modelProbability)
    : 0;

  const modelNoProbability = clampProbability(1 - modelProbability);

  const yesEdge = modelProbabilityAvailable
    ? calculateYesEdge(modelProbability, input.yesAsk)
    : null;

  const noEdge = modelProbabilityAvailable
    ? calculateNoEdge(modelProbability, input.noAsk)
    : null;

  const requiredEdge = calculateRequiredEdge({
    spread: input.spread,
    confidence: input.confidence,
    confidenceLabel: input.confidenceLabel,
    priceAgeSeconds: input.priceAgeSeconds,
    resolutionConfidence: input.resolutionConfidence
  });

  const priceQuality = getPriceQuality({
    yesAsk: input.yesAsk,
    noAsk: input.noAsk,
    spread: input.spread,
    priceAgeSeconds: input.priceAgeSeconds
  });

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!modelProbabilityAvailable) {
    warnings.push("Missing model probability; trade signal disabled.");
  }

  if (priceQuality === "MISSING_PRICE") {
    warnings.push("Missing executable YES/NO ask price.");
  }

  if (priceQuality === "WIDE_SPREAD") {
    warnings.push("Spread is wide; executable edge requires extra caution.");
  }

  if (priceQuality === "STALE") {
    warnings.push("CLOB price snapshot appears stale.");
  }

  if ((input.resolutionConfidence ?? 0.95) < 0.9) {
    warnings.push("Resolution mapping confidence is below trading threshold.");
  }

  const commonTradeGate =
    modelProbabilityAvailable &&
    priceQuality === "GOOD" &&
    (input.resolutionConfidence ?? 0.95) >= 0.9;

  const yesTradable =
    commonTradeGate &&
    yesEdge !== null &&
    input.yesAsk !== null &&
    yesEdge > requiredEdge;

  const noTradable =
    commonTradeGate &&
    noEdge !== null &&
    input.noAsk !== null &&
    noEdge > requiredEdge;

  let side: TradeSide = "NO_TRADE";
  let bestEdge: number | null = null;
  let strength: SignalStrength = "NONE";
  let recommendedStakeFraction = 0;

  if (yesTradable && (!noTradable || (yesEdge ?? -Infinity) >= (noEdge ?? -Infinity))) {
    side = "BUY_YES";
    bestEdge = yesEdge;
    strength = getStrength(yesEdge, requiredEdge);

    recommendedStakeFraction = calculateKellyFraction({
      probability: modelProbability,
      entryPrice: input.yesAsk,
      kellyMultiplier: 0.25,
      maxFraction: getStakeCap(strength)
    });

    reasons.push("YES executable edge exceeds required edge.");
  } else if (noTradable && noEdge !== null && input.noAsk !== null) {
    side = "BUY_NO";
    bestEdge = noEdge;
    strength = getStrength(noEdge, requiredEdge);

    recommendedStakeFraction = calculateKellyFraction({
      probability: modelNoProbability,
      entryPrice: input.noAsk,
      kellyMultiplier: 0.25,
      maxFraction: getStakeCap(strength)
    });

    reasons.push("NO executable edge exceeds required edge.");
  } else {
    reasons.push("No side clears required executable edge after uncertainty buffers.");
  }

  return {
    outcomeName: input.outcomeName,

    side,
    strength,
    shouldTrade: side !== "NO_TRADE",

    modelProbability,
    modelNoProbability,
    modelProbabilityAvailable,
    probabilitySource: input.probabilitySource ?? "missing",

    weatherProbability: input.weatherProbability ?? null,
    finalProbability: input.finalProbability ?? null,
    marketProbability: input.marketProbability ?? null,

    yesBid: input.yesBid,
    yesAsk: input.yesAsk,
    noBid: input.noBid,
    noAsk: input.noAsk,
    midpoint: input.midpoint,
    spread: input.spread,

    yesEdge,
    noEdge,
    bestEdge,
    requiredEdge,

    maxYesEntry: getMaxEntry(modelProbability, requiredEdge),
    maxNoEntry: getMaxEntry(modelNoProbability, requiredEdge),

    recommendedStakeFraction,

    priceQuality,
    priceAgeSeconds: input.priceAgeSeconds ?? null,
    resolutionConfidence: input.resolutionConfidence ?? null,

    reasons,
    warnings
  };
}
