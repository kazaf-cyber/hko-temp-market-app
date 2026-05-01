import type { OutcomeRange } from "@/types";

const CLOB_API = "https://clob.polymarket.com";

export type ClobOutcomePrice = {
  outcomeName: string;

  yesTokenId: string | null;
  noTokenId: string | null;

  gammaYesPrice: number | null;
  gammaNoPrice: number | null;

  /**
   * Buy Yes / Buy No as shown by Polymarket buttons, if endpoint matches.
   */
  yesAsk: number | null;
  noAsk: number | null;

  /**
   * Implied YES bid from Buy No:
   * yesBid = 1 - noAsk
   */
  yesBid: number | null;

  /**
   * Preferred market probability.
   */
  midpoint: number | null;

  /**
   * Spread between yesAsk and yesBid.
   */
  spread: number | null;
};

export type PolymarketClobSnapshot = {
  source: "polymarket-clob";
  enabled: boolean;
  fetchedAt: string;
  outcomes: ClobOutcomePrice[];
  errors: Array<{
    tokenId: string;
    message: string;
  }>;
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

function firstNumberFromObject(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;

  for (const key of keys) {
    const parsed = num(record[key]);
    if (parsed !== null) return parsed;
  }

  return null;
}

async function fetchJsonOrNull(url: string): Promise<unknown | null> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function getBuyPrice(tokenId: string | null | undefined) {
  if (!tokenId) return null;

  const raw = await fetchJsonOrNull(
    `${CLOB_API}/price?token_id=${encodeURIComponent(tokenId)}&side=BUY`
  );

  return firstNumberFromObject(raw, ["price", "value"]);
}

async function getMidpoint(tokenId: string | null | undefined) {
  if (!tokenId) return null;

  const raw = await fetchJsonOrNull(
    `${CLOB_API}/midpoint?token_id=${encodeURIComponent(tokenId)}`
  );

  return firstNumberFromObject(raw, ["mid", "midpoint", "mid_price", "price"]);
}

async function getSpread(tokenId: string | null | undefined) {
  if (!tokenId) return null;

  const raw = await fetchJsonOrNull(
    `${CLOB_API}/spread?token_id=${encodeURIComponent(tokenId)}`
  );

  return firstNumberFromObject(raw, ["spread", "value"]);
}

function getGammaYesPrice(outcome: OutcomeRange) {
  if (typeof outcome.yesPrice === "number") return outcome.yesPrice;
  if (typeof outcome.marketPrice === "number") return outcome.marketPrice;
  if (typeof outcome.price === "number") return outcome.price;
  return null;
}

function getGammaNoPrice(outcome: OutcomeRange) {
  if (typeof outcome.noPrice === "number") return outcome.noPrice;
  return null;
}

async function getOutcomeClobData(
  outcome: OutcomeRange
): Promise<ClobOutcomePrice> {
  const yesTokenId =
    outcome.yesTokenId ?? outcome.clobTokenId ?? outcome.tokenId ?? null;

  const noTokenId = outcome.noTokenId ?? null;

  if (!yesTokenId && !noTokenId) {
    throw new Error(`Outcome ${outcome.name} has no YES/NO token IDs.`);
  }

  const [yesAsk, noAsk, yesMidpoint, yesSpread] = await Promise.all([
    getBuyPrice(yesTokenId),
    getBuyPrice(noTokenId),
    getMidpoint(yesTokenId),
    getSpread(yesTokenId)
  ]);

  const yesBid = typeof noAsk === "number" ? 1 - noAsk : null;

  const midpointFromButtons =
    typeof yesAsk === "number" && typeof yesBid === "number"
      ? (yesAsk + yesBid) / 2
      : null;

  const gammaYesPrice = getGammaYesPrice(outcome);
  const gammaNoPrice = getGammaNoPrice(outcome);

  /**
   * Priority:
   * 1. CLOB midpoint endpoint
   * 2. midpoint derived from Buy Yes / Buy No
   * 3. Gamma YES fallback
   */
  const midpoint = yesMidpoint ?? midpointFromButtons ?? gammaYesPrice;

  const spread =
    yesSpread ??
    (typeof yesAsk === "number" && typeof yesBid === "number"
      ? yesAsk - yesBid
      : null);

  return {
    outcomeName: outcome.name,

    yesTokenId,
    noTokenId,

    gammaYesPrice,
    gammaNoPrice,

    yesAsk,
    noAsk,
    yesBid,

    midpoint,
    spread
  };
}

export async function getPolymarketClobSnapshot(
  outcomes: OutcomeRange[]
): Promise<PolymarketClobSnapshot> {
  const targets = outcomes.filter(
    (outcome) =>
      outcome.yesTokenId ||
      outcome.noTokenId ||
      outcome.clobTokenId ||
      outcome.tokenId
  );

  if (targets.length === 0) {
    return {
      source: "polymarket-clob",
      enabled: false,
      fetchedAt: new Date().toISOString(),
      outcomes: [],
      errors: []
    };
  }

  const settled = await Promise.allSettled(
    targets.map((outcome) => getOutcomeClobData(outcome))
  );

  const prices: ClobOutcomePrice[] = [];
  const errors: Array<{ tokenId: string; message: string }> = [];

  settled.forEach((result, index) => {
    const tokenId =
      targets[index].yesTokenId ??
      targets[index].clobTokenId ??
      targets[index].tokenId ??
      "unknown";

    if (result.status === "fulfilled") {
      prices.push(result.value);
    } else {
      errors.push({
        tokenId,
        message:
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown CLOB error"
      });
    }
  });

  return {
    source: "polymarket-clob",
    enabled: true,
    fetchedAt: new Date().toISOString(),
    outcomes: prices,
    errors
  };
}
