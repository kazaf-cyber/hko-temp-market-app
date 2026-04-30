import { neon } from "@neondatabase/serverless";
import type { ForecastResult, HkoWeatherSnapshot, MarketState } from "@/types";

let cachedSql: ReturnType<typeof neon> | null = null;

type ForecastRunDbRow = {
  id: number | string | bigint;
  created_at: string | Date;
  hkt_date: string;
  result: unknown;
};

export type ForecastHistoryRow = {
  id: number;
  createdAt: string;
  hktDate: string;
  result: ForecastResult;
};

function normalizeRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) {
      throw new Error(
        "Database returned arrayMode rows. This app expects object rows. Please use arrayMode: false."
      );
    }

    return value as T[];
  }

  if (
    value !== null &&
    typeof value === "object" &&
    "rows" in value &&
    Array.isArray((value as { rows?: unknown }).rows)
  ) {
    return (value as { rows: T[] }).rows;
  }

  return [];
}

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function parseForecastResult(value: unknown): ForecastResult {
  if (value === null || value === undefined) {
    return {} as ForecastResult;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as ForecastResult;
    } catch {
      return {} as ForecastResult;
    }
  }

  return value as ForecastResult;
}

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return null;
  }

  if (!cachedSql) {
    cachedSql = neon(databaseUrl, {
      arrayMode: false,
      fullResults: false
    });
  }

  return cachedSql;
}

export function isDatabaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export async function initDatabase() {
  const sql = getSql();

  if (!sql) {
    throw new Error("DATABASE_URL is not configured.");
  }

  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS forecast_runs (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      hkt_date TEXT NOT NULL,
      state JSONB NOT NULL,
      weather JSONB NOT NULL,
      result JSONB NOT NULL,
      ai_explanation TEXT
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS forecast_runs_created_at_idx
    ON forecast_runs (created_at DESC)
  `;
}

export async function saveForecastRun(params: {
  hktDate: string;
  state: MarketState;
  weather: HkoWeatherSnapshot;
  result: ForecastResult;
}): Promise<{
  saved: boolean;
  reason: string | null;
}> {
  const sql = getSql();

  if (!sql) {
    return {
      saved: false,
      reason: "DATABASE_URL is not configured."
    };
  }

  await sql`
    INSERT INTO forecast_runs (
      hkt_date,
      state,
      weather,
      result,
      ai_explanation
    )
    VALUES (
      ${params.hktDate},
      ${JSON.stringify(params.state)}::jsonb,
      ${JSON.stringify(params.weather)}::jsonb,
      ${JSON.stringify(params.result)}::jsonb,
      ${params.result.aiExplanation ?? null}
    )
  `;

  return {
    saved: true,
    reason: null
  };
}

export async function getForecastHistory(
  limit = 30
): Promise<ForecastHistoryRow[]> {
  const sql = getSql();

  if (!sql) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(limit, 100));

  const queryResult = await sql`
    SELECT
      id,
      created_at,
      hkt_date,
      result
    FROM forecast_runs
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;

  const rows = normalizeRows<ForecastRunDbRow>(queryResult);

  return rows.map((row) => ({
    id: Number(row.id),
    createdAt: toDateString(row.created_at),
    hktDate: String(row.hkt_date),
    result: parseForecastResult(row.result)
  }));
}
