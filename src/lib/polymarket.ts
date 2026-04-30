import type { OutcomeRange } from "@/types";

const GAMMA_API = "https://gamma-api.polymarket.com";

type GammaEvent = {
  id?: string | number;
  slug?: string;
  title?: string;
  description?: string;
  markets?: GammaMarket[];
  [key: string]: unknown;
};

type GammaMarket = {
  id?: string | number;
  question?: string;
  slug?: string;
  outcomes?: unknown;
  outcomePrices?: unknown;
  clobTokenIds?: unknown;
  active?: boolean;
  closed?: boolean;
  [key: string]: unknown;
};

export type PolymarketParsedEvent = {
  slug: string;
  eventTitle: string | null;
  marketQuestion: string | null;
  marketSlug: string | null;
  outcomes: OutcomeRange[];
};

function parseMaybeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function extractPolymarketSlug(input: string): string {
  const cleaned = input
    .trim()
    .replace(/\\+$/g, "")
    .replace(/\/+$/g, "");

  if (!cleaned) {
    throw new Error("Polymarket URL or slug is empty.");
  }

  try {
    const url = new URL(cleaned);
    const parts = url.pathname.split("/").filter(Boolean);
    const eventIndex = parts.indexOf("event");

    if (eventIndex >= 0 && parts[eventIndex + 1]) {
      return decodeURIComponent(parts[eventIndex + 1]);
    }
  } catch {
    // Not a full URL. Fall through and parse as path or slug.
  }

  const parts = cleaned.split("/").filter(Boolean);
  const eventIndex = parts.indexOf("event");

  if (eventIndex >= 0 && parts[eventIndex + 1]) {
    return decodeURIComponent(parts[eventIndex + 1]);
  }

  return decodeURIComponent(cleaned.split("?")[0].split("#")[0]);
}

function outcomeRangeFromLabel(label: string): OutcomeRange {
  const match = label.match(/-?\d+(?:\.\d+)?/);
  const value = match ? Number(match[0]) : null;

  if (value === null || !Number.isFinite(value)) {
    return {
      name: label,
      lower: null,
      upper: null
    };
  }

  const normalized = label.toLowerCase();

  if (
    normalized.includes("or higher") ||
    normalized.includes("or above") ||
    normalized.includes("or more")
  ) {
    return {
      name: label,
      lower: value,
      upper: null
    };
  }

  if (
    normalized.includes("or below") ||
    normalized.includes("or lower") ||
    normalized.includes("or less")
  ) {
    return {
      name: label,
      lower: null,
      upper: value + 1
    };
  }

  return {
    name: label,
    lower: value,
    upper: value + 1
  };
}

async function fetchPolymarketEventBySlug(slug: string): Promise<GammaEvent> {
  const url = `${GAMMA_API}/events?slug=${encodeURIComponent(slug)}`;

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Polymarket Gamma API failed: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const event = Array.isArray(data) ? data[0] : data;

  if (!event || typeof event !== "object") {
    throw new Error(`Polymarket event not found for slug: ${slug}`);
  }

  return event as GammaEvent;
}

function selectPrimaryMarket(event: GammaEvent): GammaMarket {
  const markets = Array.isArray(event.markets) ? event.markets : [];

  if (markets.length === 0) {
    throw new Error("Polymarket event has no markets.");
  }

  const multiOutcomeMarket = markets.find((market) => {
    const outcomes = parseMaybeJsonArray(market.outcomes);
    return outcomes.length >= 2;
  });

  return multiOutcomeMarket ?? markets[0];
}

export async function getPolymarketOutcomesFromInput(
  input: string
): Promise<PolymarketParsedEvent> {
  const slug = extractPolymarketSlug(input);
  const event = await fetchPolymarketEventBySlug(slug);
  const market = selectPrimaryMarket(event);

  const labels = parseMaybeJsonArray(market.outcomes).map((item) =>
    String(item)
  );

  const prices = parseMaybeJsonArray(market.outcomePrices).map(parsePrice);
  const tokenIds = parseMaybeJsonArray(market.clobTokenIds).map((item) =>
    item === null || item === undefined ? null : String(item)
  );

  if (labels.length === 0) {
    throw new Error("No outcomes found in Polymarket market.");
  }

  const outcomes: OutcomeRange[] = labels.map((label, index) => {
    const range = outcomeRangeFromLabel(label);
    const marketPrice = prices[index] ?? null;
    const tokenId = tokenIds[index] ?? null;

    return {
      ...range,
      marketPrice,
      price: marketPrice,
      tokenId,
      clobTokenId: tokenId
    };
  });

  return {
    slug,
    eventTitle: event.title ?? null,
    marketQuestion: market.question ?? null,
    marketSlug: market.slug ?? null,
    outcomes
  };
}
