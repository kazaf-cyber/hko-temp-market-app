// src/lib/targetDate.ts

const MONTHS: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "05",
  june: "06",
  jun: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  october: "10",
  oct: "10",
  november: "11",
  nov: "11",
  december: "12",
  dec: "12"
};

export function normalizeISODate(input: unknown): string | null {
  const s = String(input ?? "").trim();

  if (!s) {
    return null;
  }

  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (!m) {
    return null;
  }

  const year = m[1];
  const month = m[2].padStart(2, "0");
  const day = m[3].padStart(2, "0");

  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);

  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) {
    return null;
  }

  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return null;
  }

  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== mo ||
    date.getUTCDate() !== d
  ) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

export function getHktTodayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Failed to format HKT date");
  }

  return `${year}-${month}-${day}`;
}

export function isTargetTodayHkt(targetDate: string, now = new Date()): boolean {
  const normalized = normalizeISODate(targetDate);

  if (!normalized) {
    return false;
  }

  return normalized === getHktTodayISO(now);
}

export function zhDateLabel(isoDate: string): string {
  const normalized = normalizeISODate(isoDate);

  if (!normalized) {
    return String(isoDate);
  }

  const [, month, day] = normalized.split("-");

  return `${Number(month)}月${Number(day)}日`;
}

export function yyyymmdd(isoDate: string): string {
  const normalized = normalizeISODate(isoDate);

  if (!normalized) {
    return "";
  }

  return normalized.replace(/-/g, "");
}

export function extractTargetDateFromText(input: unknown): string | null {
  const s = String(input ?? "").trim();

  if (!s) {
    return null;
  }

  /*
    Polymarket slug / URL style:
      highest-temperature-in-hong-kong-on-may-2-2026
      highest-temperature-in-hong-kong-on-may-2-2026-21corbelow
      https://polymarket.com/.../highest-temperature-in-hong-kong-on-may-2-2026
  */
  const slugMatch = s.match(
    /(?:^|[-/])on-(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)-(\d{1,2})-(\d{4})(?:[-/?#&]|$)/i
  );

  if (slugMatch) {
    const monthName = slugMatch[1].toLowerCase();
    const day = slugMatch[2].padStart(2, "0");
    const year = slugMatch[3];
    const month = MONTHS[monthName];

    if (month) {
      return normalizeISODate(`${year}-${month}-${day}`);
    }
  }

  /*
    More generic slug:
      may-2-2026
  */
  const genericSlugMatch = s.match(
    /(?:^|[-/\s])(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)-(\d{1,2})-(\d{4})(?:[-/\s?#&]|$)/i
  );

  if (genericSlugMatch) {
    const monthName = genericSlugMatch[1].toLowerCase();
    const day = genericSlugMatch[2].padStart(2, "0");
    const year = genericSlugMatch[3];
    const month = MONTHS[monthName];

    if (month) {
      return normalizeISODate(`${year}-${month}-${day}`);
    }
  }

  /*
    Text style:
      on May 2, 2026
      on May 2 2026
  */
  const textMatchWithYear = s.match(
    /\bon\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );

  if (textMatchWithYear) {
    const monthName = textMatchWithYear[1].toLowerCase();
    const day = textMatchWithYear[2].padStart(2, "0");
    const year = textMatchWithYear[3];
    const month = MONTHS[monthName];

    if (month) {
      return normalizeISODate(`${year}-${month}-${day}`);
    }
  }

  return null;
}

export function extractOutcomeTargetDates(outcomes: unknown): string[] {
  if (!Array.isArray(outcomes)) {
    return [];
  }

  const dates = new Set<string>();

  for (const row of outcomes) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const r = row as Record<string, unknown>;

    const candidates = [
      r.marketSlug,
      r.slug,
      r.eventSlug,
      r.question,
      r.title,
      r.name,
      r.description,
      r.url,
      r.marketUrl
    ];

    for (const candidate of candidates) {
      const parsed = extractTargetDateFromText(candidate);

      if (parsed) {
        dates.add(parsed);
      }
    }
  }

  return Array.from(dates).sort();
}

export function resolveTargetDate(args: {
  explicitDate?: unknown;
  outcomes?: unknown;
  texts?: unknown[];
  now?: Date;
}): string {
  const explicit = normalizeISODate(args.explicitDate);

  if (explicit) {
    return explicit;
  }

  for (const text of args.texts ?? []) {
    const parsed = extractTargetDateFromText(text);

    if (parsed) {
      return parsed;
    }
  }

  const datesFromOutcomes = extractOutcomeTargetDates(args.outcomes);

  if (datesFromOutcomes.length === 1) {
    return datesFromOutcomes[0];
  }

  return getHktTodayISO(args.now ?? new Date());
}
