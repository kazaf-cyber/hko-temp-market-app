import type { OutcomeRange } from "@/types";

const CLOB_API = "https://clob.polymarket.com";

export type ClobOutcomePrice = {
  outcomeName: string;
  tokenId: string;
  gammaPrice: number | null;
  midpoint: number | null;
  spread: number | null;
  buyPrice: number | null;
  sellPrice: number | null;
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
  if (typeof value === "number" && Number.isFinite(value)) return value;

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

async function getTokenClobData(outcome: OutcomeRange): Promise<ClobOutcomePrice> {
  const tokenId = outcome.clobTokenId ?? outcome.tokenId;

  if (!tokenId) {
    throw new Error(`Outcome ${outcome.name} has no clobTokenId/tokenId.`);
  }

  const [midpointRaw, spreadRaw, buyRaw, sellRaw] = await Promise.all([
    fetchJsonOrNull(`${CLOB_API}/midpoint?token_id=${encodeURIComponent(tokenId)}`),
    fetchJsonOrNull(`${CLOB_API}/spread?token_id=${encodeURIComponent(tokenId)}`),
    fetchJsonOrNull(
      `${CLOB_API}/price?token_id=${encodeURIComponent(tokenId)}&side=BUY`
    ),
    fetchJsonOrNull(
      `${CLOB_API}/price?token_id=${encodeURIComponent(tokenId)}&side=SELL`
    )
  ]);

  const midpoint = firstNumberFromObject(midpointRaw, [
    "mid",
    "midpoint",
    "price"
  ]);

  const spread = firstNumberFromObject(spreadRaw, ["spread", "value"]);

  const buyPrice = firstNumberFromObject(buyRaw, ["price", "value"]);
  const sellPrice = firstNumberFromObject(sellRaw, ["price", "value"]);

  const gammaPrice =
    typeof outcome.marketPrice === "number"
      ? outcome.marketPrice
      : typeof outcome.price === "number"
        ? outcome.price
        : null;

  return {
    outcomeName: outcome.name,
    tokenId,
    gammaPrice,
    midpoint,
    spread,
    buyPrice,
    sellPrice
  };
}

export async function getPolymarketClobSnapshot(
  outcomes: OutcomeRange[]
): Promise<PolymarketClobSnapshot> {
  const targets = outcomes.filter((outcome) => outcome.clobTokenId || outcome.tokenId);

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
    targets.map((outcome) => getTokenClobData(outcome))
  );

  const prices: ClobOutcomePrice[] = [];
  const errors: Array<{ tokenId: string; message: string }> = [];

  settled.forEach((result, index) => {
    const tokenId =
      targets[index].clobTokenId ?? targets[index].tokenId ?? "unknown";

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
