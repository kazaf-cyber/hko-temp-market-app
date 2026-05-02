import { buildOutcomeTradeSignal } from "./signals";
import type { OutcomeTradeSignal, ProbabilitySource } from "./types";
import { firstProbability, isFiniteNumber, parseProbability } from "./math";

type ForecastLike = Record<string, unknown>;

type EnrichedOutcome = Record<string, unknown> & {
  tradeSignal: OutcomeTradeSignal;
  executableSignal: OutcomeTradeSignal;
};

export type ForecastWithTradeSignals<T extends ForecastLike = ForecastLike> = T & {
  outcomes: EnrichedOutcome[];
  probabilities: EnrichedOutcome[];
  outcomeProbabilities: EnrichedOutcome[];
  tradeSignals: OutcomeTradeSignal[];
  tradingSignals: OutcomeTradeSignal[];
  topTradeSignal: OutcomeTradeSignal | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function getAt(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);

      if (!Number.isInteger(index)) {
        return undefined;
      }

      current = current[index];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function normalizeOutcomeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/℃/g, "°c")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9°+\-.\s<>=]/g, "");
}

function getOutcomeRows(result: ForecastLike): Record<string, unknown>[] {
  const raw =
    Array.isArray(result.outcomeProbabilities)
      ? result.outcomeProbabilities
      : Array.isArray(result.probabilities)
        ? result.probabilities
        : Array.isArray(result.outcomes)
          ? result.outcomes
          : [];

  return raw.map((row) => recordOrEmpty(row));
}

function getOutcomeName(row: Record<string, unknown>, index: number): string {
  return (
    firstString(row.name, row.outcome, row.label, row.title) ??
    `Outcome ${index + 1}`
  );
}

function getPrice(...values: unknown[]): number | null {
  return firstProbability(...values);
}

function getProbabilityCandidate(row: Record<string, unknown>): {
  value: number | null;
  source: ProbabilitySource;
} {
  const candidates: Array<{ value: number | null; source: ProbabilitySource }> = [
    {
      value: getPrice(
        row.weatherProbability,
        row.weatherFairProbability,
        row.unblendedWeatherProbability,
        getAt(row, ["weather", "probability"]),
        getAt(row, ["weather", "fairProbability"])
      ),
      source: "weatherProbability"
    },
    {
      value: getPrice(row.weatherFairProbability),
      source: "weatherFairProbability"
    },
    {
      value: getPrice(row.modelProbability, row.modelProbabilityPct),
      source: "modelProbability"
    },
    {
      value: getPrice(row.forecastProbability, row.forecastProbabilityPct),
      source: "forecastProbability"
    },
    {
      value: getPrice(row.finalProbability, row.finalProbabilityPct, row.blendedProbability),
      source: "finalProbability"
    },
    {
      value: getPrice(row.probability, row.probabilityPct),
      source: "probability"
    }
  ];

  return candidates.find((candidate) => candidate.value !== null) ?? {
    value: null,
    source: "missing"
  };
}

function getClobChannelRows(result: ForecastLike): Record<string, unknown>[] {
  const derivedRows = getAt(result, ["multiChannel", "derived", "clobMidpoints"]);
  const rawRows = getAt(result, ["multiChannel", "polymarketClob", "outcomes"]);

  return [
    ...(Array.isArray(derivedRows) ? derivedRows : []),
    ...(Array.isArray(rawRows) ? rawRows : [])
  ].map((row) => recordOrEmpty(row));
}

function buildClobChannelMap(result: ForecastLike): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();

  for (const row of getClobChannelRows(result)) {
    const name = firstString(row.outcomeName, row.name, row.outcome, row.label);

    if (!name) {
      continue;
    }

    const key = normalizeOutcomeKey(name);

    if (!map.has(key)) {
      map.set(key, row);
    } else {
      map.set(key, {
        ...map.get(key),
        ...row
      });
    }
  }

  return map;
}

function getPriceAgeSeconds(result: ForecastLike): number | null {
  const fetchedAt =
    firstString(
      getAt(result, ["multiChannel", "polymarketClob", "fetchedAt"]),
      getAt(result, ["polymarketClob", "fetchedAt"]),
      getAt(result, ["market", "fetchedAt"])
    ) ?? null;

  if (!fetchedAt) {
    return null;
  }

  const timestamp = Date.parse(fetchedAt);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const ageSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));

  return ageSeconds;
}

function getConfidenceLabel(result: ForecastLike): "low" | "medium" | "high" | null {
  const value = firstString(
    result.confidenceLabel,
    getAt(result, ["model", "confidenceLabel"]),
    getAt(result, ["diagnostics", "confidenceLabel"])
  );

  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return null;
}

function getTopTradeSignal(signals: OutcomeTradeSignal[]): OutcomeTradeSignal | null {
  const tradable = signals
    .filter((signal) => signal.shouldTrade && signal.bestEdge !== null)
    .sort((a, b) => {
      const edgeDelta = (b.bestEdge ?? -Infinity) - (a.bestEdge ?? -Infinity);

      if (edgeDelta !== 0) {
        return edgeDelta;
      }

      return b.recommendedStakeFraction - a.recommendedStakeFraction;
    });

  return tradable[0] ?? null;
}

export function enrichForecastWithTradeSignals<T extends ForecastLike>(
  result: T
): ForecastWithTradeSignals<T> {
  const rows = getOutcomeRows(result);
  const clobChannelMap = buildClobChannelMap(result);
  const priceAgeSeconds = getPriceAgeSeconds(result);

  const confidence = parseProbability(
    result.confidence ?? getAt(result, ["model", "confidence"])
  );

  const confidenceLabel = getConfidenceLabel(result);

  const resolutionConfidence =
    parseProbability(
      result.resolutionConfidence ??
        getAt(result, ["market", "resolutionConfidence"]) ??
        getAt(result, ["diagnostics", "resolutionConfidence"])
    ) ?? 0.95;

  const tradeSignals = rows.map((row, index) => {
    const outcomeName = getOutcomeName(row, index);
    const channel = clobChannelMap.get(normalizeOutcomeKey(outcomeName)) ?? {};

    const probabilityCandidate = getProbabilityCandidate(row);

    const modelProbability = probabilityCandidate.value ?? 0;
    const modelProbabilityAvailable = probabilityCandidate.value !== null;

    const weatherProbability = getPrice(
      row.weatherProbability,
      row.weatherFairProbability,
      row.unblendedWeatherProbability
    );

    const finalProbability = getPrice(
      row.finalProbability,
      row.blendedProbability,
      row.probability
    );

    const marketProbability = getPrice(
      row.marketProbability,
      row.polymarketProbability,
      row.clobMidpoint,
      row.marketPrice,
      row.price,
      channel.midpoint
    );

    const yesBid = getPrice(
      row.yesBid,
      row.clobBestBid,
      row.bestBid,
      row.clobBuyPrice,
      channel.yesBid
    );

    const yesAsk = getPrice(
      row.yesAsk,
      row.clobBestAsk,
      row.bestAsk,
      row.clobSellPrice,
      channel.yesAsk
    );

    const noAsk =
      getPrice(
        row.noAsk,
        row.noBestAsk,
        row.noAskPrice,
        row.clobNoAsk,
        row.clobNoBestAsk,
        channel.noAsk
      ) ?? (yesBid !== null ? 1 - yesBid : null);

    const noBid =
      getPrice(
        row.noBid,
        row.noBestBid,
        row.noBidPrice,
        row.clobNoBid,
        channel.noBid
      ) ?? (yesAsk !== null ? 1 - yesAsk : null);

    const midpoint = getPrice(
      row.clobMidpoint,
      row.midpoint,
      row.marketProbability,
      channel.midpoint
    );

    const spread =
      getPrice(row.clobSpread, row.spread, channel.spread) ??
      (yesAsk !== null && yesBid !== null ? Math.max(0, yesAsk - yesBid) : null);

    return buildOutcomeTradeSignal({
      outcomeName,
      modelProbability,
      modelProbabilityAvailable,
      probabilitySource: probabilityCandidate.source,

      weatherProbability,
      finalProbability,
      marketProbability,

      yesBid: yesBid !== null && isFiniteNumber(yesBid) ? yesBid : null,
      yesAsk: yesAsk !== null && isFiniteNumber(yesAsk) ? yesAsk : null,
      noBid: noBid !== null && isFiniteNumber(noBid) ? noBid : null,
      noAsk: noAsk !== null && isFiniteNumber(noAsk) ? noAsk : null,
      midpoint,
      spread,

      confidence,
      confidenceLabel,
      priceAgeSeconds,
      resolutionConfidence
    });
  });

  const enrichedOutcomes = rows.map((row, index): EnrichedOutcome => {
    const tradeSignal = tradeSignals[index];

    return {
      ...row,
      tradeSignal,
      executableSignal: tradeSignal
    };
  });

  const topTradeSignal = getTopTradeSignal(tradeSignals);

  return {
    ...result,
    outcomes: enrichedOutcomes,
    probabilities: enrichedOutcomes,
    outcomeProbabilities: enrichedOutcomes,
    tradeSignals,
    tradingSignals: tradeSignals,
    topTradeSignal
  };
}
