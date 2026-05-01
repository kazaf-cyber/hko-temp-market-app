// lib/targetDate.ts

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
    Match Polymarket slug style:
    highest-temperature-in-hong-kong-on-may-2-2026-21corbelow
  */
  const slugMatch = s.match(
    /(?:^|-)on-(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)-(\d{1,2})-(\d{4})(?:-|$)/i
  );

  if (slugMatch) {
    const monthName = slugMatch[1].toLowerCase();
    const day = slugMatch[2].padStart(2, "0");
    const year = slugMatch[3];
    const month = MONTHS[monthName];

    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  /*
    Match question style:
    Will the highest temperature in Hong Kong be 21°C or below on May 2?
    If year is absent, this function cannot safely infer year unless caller supplies it.
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
      return `${year}-${month}-${day}`;
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
      r.question,
      r.title,
      r.name
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
  now?: Date;
}): string {
  const explicit = normalizeISODate(args.explicitDate);

  if (explicit) {
    return explicit;
  }

  const datesFromOutcomes = extractOutcomeTargetDates(args.outcomes);

  if (datesFromOutcomes.length === 1) {
    return datesFromOutcomes[0];
  }

  return getHktTodayISO(args.now ?? new Date());
}

export function isTargetTodayHkt(targetDate: string, now = new Date()): boolean {
  return normalizeISODate(targetDate) === getHktTodayISO(now);
}
