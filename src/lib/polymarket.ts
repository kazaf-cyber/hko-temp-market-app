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
  archived?: boolean;
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

/**
 * Convert labels like:
 * - 19°C or below
 * - 20°C
 * - 29°C or higher
 * into numeric buckets.
 */
function outcomeRangeFromTemperatureLabel(label: string): OutcomeRange {
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

/**
 * Extract the temperature bucket from a binary Polymarket question.
 *
 * Examples:
 * - "Will the highest temperature in Hong Kong be 19°C or below on May 1?"
 *   -> "19°C or below"
 *
 * - "Will the highest temperature in Hong Kong be 22°C on May 1?"
 *   -> "22°C"
 *
 * - "Will the highest temperature in Hong Kong be 29°C or higher on May 1?"
 *   -> "29°C or higher"
 */
function extractTemperatureLabelFromQuestion(question: string): string | null {
  const cleaned = question.replace(/\s+/g, " ").trim();

  const patterns = [
    /be\s+(-?\d+(?:\.\d+)?\s*°?\s*C\s+or\s+below)\s+on/i,
    /be\s+(-?\d+(?:\.\d+)?\s*°?\s*C\s+or\s+lower)\s+on/i,
    /be\s+(-?\d+(?:\.\d+)?\s*°?\s*C\s+or\s+higher)\s+on/i,
    /be\s+(-?\d+(?:\.\d+)?\s*°?\s*C\s+or\s+above)\s+on/i,
    /be\s+(-?\d+(?:\.\d+)?\s*°?\s*C)\s+on/i
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);

    if (match?.[1]) {
      return normalizeTemperatureLabel(match[1]);
    }
  }

  /**
   * Fallback: find the first temp phrase anywhere in the question.
   */
  const fallback = cleaned.match(
    /(-?\d+(?:\.\d+)?\s*°?\s*C(?:\s+or\s+(?:below|lower|higher|above))?)/i
  );

  if (fallback?.[1]) {
    return normalizeTemperatureLabel(fallback[1]);
  }

  return null;
}

function normalizeTemperatureLabel(raw: string): string {
  const normalized = raw
    .replace(/\s+/g, " ")
    .replace(/\s*°\s*C/i, "°C")
    .trim();

  const match = normalized.match(/-?\d+(?:\.\d+)?/);

  if (!match) {
    return normalized;
  }

  const value = match[0];

  if (/or\s+below/i.test(normalized) || /or\s+lower/i.test(normalized)) {
    return `${value}°C or below`;
  }

  if (/or\s+higher/i.test(normalized) || /or\s+above/i.test(normalized)) {
    return `${value}°C or higher`;
  }

  return `${value}°C`;
}

/**
 * Some markets may have a useful bucket inside the slug:
 * highest-temperature-in-hong-kong-on-may-1-2026-19corbelow
 * highest-temperature-in-hong-kong-on-may-1-2026-29corhigher
 *
 * This is only a fallback. The question is preferred.
 */
function extractTemperatureLabelFromSlug(slug: string | undefined): string | null {
  if (!slug) return null;

  const lower = slug.toLowerCase();

  const below = lower.match(/(-?\d+(?:\.\d+)?)c(?:or)?below/);
  if (below?.[1]) {
    return `${below[1]}°C or below`;
  }

  const lowerMatch = lower.match(/(-?\d+(?:\.\d+)?)c(?:or)?lower/);
  if (lowerMatch?.[1]) {
    return `${lowerMatch[1]}°C or below`;
  }

  const higher = lower.match(/(-?\d+(?:\.\d+)?)c(?:or)?higher/);
  if (higher?.[1]) {
    return `${higher[1]}°C or higher`;
  }

  const plain = lower.match(/(-?\d+(?:\.\d+)?)c(?:$|-)/);
  if (plain?.[1]) {
    return `${plain[1]}°C`;
  }

  return null;
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

function getYesOutcomeIndex(market: GammaMarket): number {
  const labels = parseMaybeJsonArray(market.outcomes).map((item) =>
    String(item).toLowerCase()
  );

  const yesIndex = labels.findIndex((label) => label === "yes");

  return yesIndex >= 0 ? yesIndex : 0;
}

function parseBinaryTemperatureMarket(market: GammaMarket): OutcomeRange | null {
  const question = market.question ?? "";
  const labelFromQuestion = extractTemperatureLabelFromQuestion(question);
  const labelFromSlug = extractTemperatureLabelFromSlug(market.slug);

  const label = labelFromQuestion ?? labelFromSlug;

  if (!label) {
    return null;
  }

  const labels = parseMaybeJsonArray(market.outcomes).map((item) =>
  String(item).toLowerCase()
);

const yesIndex = labels.findIndex((item) => item === "yes");
const noIndex = labels.findIndex((item) => item === "no");

const finalYesIndex = yesIndex >= 0 ? yesIndex : 0;
const finalNoIndex = noIndex >= 0 ? noIndex : finalYesIndex === 0 ? 1 : 0;

const prices = parseMaybeJsonArray(market.outcomePrices).map(parsePrice);
const tokenIds = parseMaybeJsonArray(market.clobTokenIds).map((item) =>
  item === null || item === undefined ? null : String(item)
);

const yesPrice = prices[finalYesIndex] ?? null;
const noPrice = prices[finalNoIndex] ?? null;

const yesTokenId = tokenIds[finalYesIndex] ?? null;
const noTokenId = tokenIds[finalNoIndex] ?? null;

const range = outcomeRangeFromTemperatureLabel(label);

return {
  ...range,

  /**
   * Gamma fallback. This may not match Polymarket UI midpoint exactly.
   * CLOB midpoint will overwrite marketPrice later if includeClob=1.
   */
  marketPrice: yesPrice,
  price: yesPrice,
  marketPriceSource: "gamma_yes",

  yesPrice,
  noPrice,

  tokenId: yesTokenId,
  clobTokenId: yesTokenId,
  yesTokenId,
  noTokenId,

  question: market.question ?? null,
  marketSlug: market.slug ?? null
};
}

function sortTemperatureOutcomes(outcomes: OutcomeRange[]): OutcomeRange[] {
  return [...outcomes].sort((a, b) => {
    const aKey =
      typeof a.lower === "number"
        ? a.lower
        : typeof a.upper === "number"
          ? a.upper - 1
          : Number.POSITIVE_INFINITY;

    const bKey =
      typeof b.lower === "number"
        ? b.lower
        : typeof b.upper === "number"
          ? b.upper - 1
          : Number.POSITIVE_INFINITY;

    return aKey - bKey;
  });
}

function dedupeOutcomes(outcomes: OutcomeRange[]): OutcomeRange[] {
  const map = new Map<string, OutcomeRange>();

  for (const outcome of outcomes) {
    const key = `${outcome.name}|${outcome.lower ?? ""}|${outcome.upper ?? ""}`;

    if (!map.has(key)) {
      map.set(key, outcome);
    }
  }

  return [...map.values()];
}

export async function getPolymarketOutcomesFromInput(
  input: string
): Promise<PolymarketParsedEvent> {
  const slug = extractPolymarketSlug(input);
  const event = await fetchPolymarketEventBySlug(slug);
  const markets = Array.isArray(event.markets) ? event.markets : [];

  if (markets.length === 0) {
    throw new Error("Polymarket event has no markets.");
  }

  /**
   * This event is a bundle of binary markets.
   * Do NOT parse the first market's Yes/No as temperature outcomes.
   * Instead, parse every market's question and use YES price.
   */
  const binaryTemperatureOutcomes = markets
    .map(parseBinaryTemperatureMarket)
    .filter((item): item is OutcomeRange => item !== null);

  const outcomes = sortTemperatureOutcomes(
    dedupeOutcomes(binaryTemperatureOutcomes)
  );

  if (outcomes.length === 0) {
    throw new Error(
      "No temperature outcomes could be parsed from Polymarket event markets."
    );
  }

  return {
    slug,
    eventTitle: event.title ?? null,
    marketQuestion: event.title ?? null,
    marketSlug: null,
    outcomes
  };
}
