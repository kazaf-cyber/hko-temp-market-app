export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampProbability(value: number): number {
  return clamp(value, 0, 1);
}

export function roundNumber(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function roundProbability(value: number, digits = 4): number {
  return roundNumber(clampProbability(value), digits);
}

export function maybeRoundNumber(
  value: number | null | undefined,
  digits = 4
): number | null {
  if (!isFiniteNumber(value)) {
    return null;
  }

  return roundNumber(value, digits);
}

export function maybeRoundProbability(
  value: number | null | undefined,
  digits = 4
): number | null {
  if (!isFiniteNumber(value)) {
    return null;
  }

  return roundProbability(value, digits);
}

export function parseFiniteNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "").replace(/%$/g, "");

    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Accepts:
 * - 0.42
 * - "0.42"
 * - 42
 * - "42"
 * - "42%"
 *
 * Returns normalized 0..1 probability.
 */
export function parseProbability(value: unknown): number | null {
  const parsed = parseFiniteNumber(value);

  if (parsed === null) {
    return null;
  }

  if (parsed >= 0 && parsed <= 1) {
    return roundProbability(parsed);
  }

  if (parsed >= 0 && parsed <= 100) {
    return roundProbability(parsed / 100);
  }

  return null;
}

export function firstProbability(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = parseProbability(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function complementProbability(value: number | null | undefined): number | null {
  if (!isFiniteNumber(value)) {
    return null;
  }

  return roundProbability(1 - value);
}
