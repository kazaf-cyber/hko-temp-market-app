import type { OutcomeRange, SettlementResult } from "@/types";

export type ResolutionOutcomeRange = Pick<OutcomeRange, "name" | "lower" | "upper">;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.trim().match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }

    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Outcome convention:
 *
 * - lower inclusive
 * - upper exclusive
 *
 * Examples:
 * - lower null, upper 30 => temp < 30
 * - lower 30, upper 31 => 30 <= temp < 31
 * - lower 31, upper null => temp >= 31
 */
export function isTemperatureInOutcome(
  officialMaxTempC: number,
  outcome: ResolutionOutcomeRange
): boolean {
  if (!Number.isFinite(officialMaxTempC)) {
    return false;
  }

  const lower = toFiniteNumber(outcome.lower);
  const upper = toFiniteNumber(outcome.upper);

  if (lower !== null && officialMaxTempC < lower) {
    return false;
  }

  if (upper !== null && officialMaxTempC >= upper) {
    return false;
  }

  return true;
}

export function findWinningOutcome(
  outcomes: ResolutionOutcomeRange[],
  officialMaxTempC: number
): ResolutionOutcomeRange | null {
  return (
    outcomes.find((outcome) =>
      isTemperatureInOutcome(officialMaxTempC, outcome)
    ) ?? null
  );
}

export function parseOfficialMaxTempC(value: unknown): number | null {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return toFiniteNumber(value);
  }

  return (
    toFiniteNumber(value.officialMaxTempC) ??
    toFiniteNumber(value.actualTempC) ??
    toFiniteNumber(value.maxTempC) ??
    toFiniteNumber(value.temperatureC) ??
    toFiniteNumber(value.maxTemperatureC) ??
    null
  );
}

export function getWinningOutcomeNameFromSettlement(
  outcomes: ResolutionOutcomeRange[],
  settlement: SettlementResult | Record<string, unknown>
): string | null {
  const officialMaxTempC = parseOfficialMaxTempC(settlement);

  if (officialMaxTempC === null) {
    return null;
  }

  return findWinningOutcome(outcomes, officialMaxTempC)?.name ?? null;
}
