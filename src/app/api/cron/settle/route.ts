import { NextResponse } from "next/server";
import { checkCronSecret } from "@/lib/cronAuth";
import { initDatabase, settleSignalSnapshots } from "@/lib/db";
import { getHkoSettlementMax } from "@/lib/hko";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getHktDateIsoDaysAgo(daysAgo: number): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const nowHktDate = formatter.format(new Date());
  const hktMidnightUtc = new Date(`${nowHktDate}T00:00:00+08:00`);

  hktMidnightUtc.setUTCDate(hktMidnightUtc.getUTCDate() - daysAgo);

  return formatter.format(hktMidnightUtc);
}

function normalizeDateParam(value: string | null): {
  iso: string;
  compact: string;
} | null {
  if (!value) {
    const iso = getHktDateIsoDaysAgo(1);

    return {
      iso,
      compact: iso.replace(/-/g, ""),
    };
  }

  const trimmed = value.trim();

  if (/^\d{8}$/.test(trimmed)) {
    const yyyy = trimmed.slice(0, 4);
    const mm = trimmed.slice(4, 6);
    const dd = trimmed.slice(6, 8);

    return {
      iso: `${yyyy}-${mm}-${dd}`,
      compact: trimmed,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return {
      iso: trimmed,
      compact: trimmed.replace(/-/g, ""),
    };
  }

  return null;
}

function getAt(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function extractOfficialMaxTempC(value: unknown): number | null {
  const directCandidates = [
    getAt(value, ["officialMaxTempC"]),
    getAt(value, ["maxTempC"]),
    getAt(value, ["maxTemperatureC"]),
    getAt(value, ["maximumTemperatureC"]),
    getAt(value, ["temperatureMaxC"]),
    getAt(value, ["data", "officialMaxTempC"]),
    getAt(value, ["data", "maxTempC"]),
    getAt(value, ["data", "maxTemperatureC"]),
    getAt(value, ["data", "maximumTemperatureC"]),
    getAt(value, ["data", "temperatureMaxC"]),
    getAt(value, ["temperature", "max"]),
    getAt(value, ["temperature", "maximum"]),
    getAt(value, ["report", "maxTempC"]),
    getAt(value, ["report", "maxTemperatureC"]),
  ];

  for (const candidate of directCandidates) {
    const parsed = toFiniteNumber(candidate);

    if (parsed !== null) {
      return parsed;
    }
  }

  return findMaxTempNumberDeep(value);
}

function findMaxTempNumberDeep(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = findMaxTempNumberDeep(item);

      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    const looksLikeMaxTemp =
      normalizedKey.includes("max") &&
      (normalizedKey.includes("temp") ||
        normalizedKey.includes("temperature"));

    if (looksLikeMaxTemp) {
      const parsed = toFiniteNumber(child);

      if (parsed !== null) {
        return parsed;
      }
    }
  }

  for (const child of Object.values(value)) {
    const parsed = findMaxTempNumberDeep(child);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export async function GET(request: Request) {
  const auth = checkCronSecret(request);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.message,
      },
      {
        status: auth.status,
      },
    );
  }

  const startedAt = new Date().toISOString();

  try {
    const url = new URL(request.url);
    const normalizedDate = normalizeDateParam(url.searchParams.get("date"));

    if (!normalizedDate) {
      return NextResponse.json(
        {
          ok: false,
          error: "date must be YYYY-MM-DD or YYYYMMDD.",
        },
        {
          status: 400,
        },
      );
    }

    /**
     * Ensure app_state, forecast_runs, signal_snapshots exist.
     * Safe to run repeatedly because initDatabase uses CREATE TABLE IF NOT EXISTS.
     */
    await initDatabase();

    const settlement = await getHkoSettlementMax(normalizedDate.compact);
    const officialMaxTempC = extractOfficialMaxTempC(settlement);

    if (officialMaxTempC === null) {
      return NextResponse.json(
        {
          ok: false,
          job: "phase1-settle",
          startedAt,
          finishedAt: new Date().toISOString(),
          date: normalizedDate,
          settlement,
          error:
            "Could not extract official maximum temperature from HKO settlement response. HKO report may not be available yet.",
        },
        {
          /**
           * 409 = not ready / conflict with current state.
           * Cron can retry later.
           */
          status: 409,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        },
      );
    }

    const settleResult = await settleSignalSnapshots({
      targetDate: normalizedDate.iso,
      hktDate: normalizedDate.iso,
      officialMaxTempC,
    });

    return NextResponse.json(
      {
        ok: true,
        job: "phase1-settle",
        startedAt,
        finishedAt: new Date().toISOString(),
        date: normalizedDate,
        officialMaxTempC,
        settlement,
        settleResult,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Phase 1 settlement cron error:", error);

    return NextResponse.json(
      {
        ok: false,
        job: "phase1-settle",
        startedAt,
        finishedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : "Failed to run Phase 1 settlement cron.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
