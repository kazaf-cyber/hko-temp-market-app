import { defaultMarketState } from "@/lib/defaults";
import { getSql, isDatabaseEnabled } from "@/lib/db";
import type { MarketState } from "@/types";

type AppStateDbRow = {
  value: unknown;
};

type MarketStateLoadResult = {
  state: MarketState;
  databaseEnabled: boolean;
  persisted: boolean;
};

function normalizeRows<T extends Record<string, unknown>>(value: unknown): T[] {
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

function parseMarketState(value: unknown): MarketState {
  if (value === null || value === undefined) {
    return defaultMarketState;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as MarketState;
    } catch {
      return defaultMarketState;
    }
  }

  return value as MarketState;
}

export async function getMarketState(): Promise<MarketStateLoadResult> {
  const sql = getSql();

  if (!sql) {
    return {
      state: defaultMarketState,
      databaseEnabled: false,
      persisted: false
    };
  }

  const queryResult = await sql`
    SELECT value
    FROM app_state
    WHERE key = 'market'
    LIMIT 1
  `;

  const rows = normalizeRows<AppStateDbRow>(queryResult);

  if (rows.length === 0) {
    return {
      state: defaultMarketState,
      databaseEnabled: isDatabaseEnabled(),
      persisted: false
    };
  }

  return {
    state: parseMarketState(rows[0]?.value),
    databaseEnabled: isDatabaseEnabled(),
    persisted: true
  };
}

export async function saveMarketState(state: MarketState): Promise<MarketState> {
  const sql = getSql();

  if (!sql) {
    throw new Error("DATABASE_URL is not configured.");
  }

  await sql`
    INSERT INTO app_state (key, value, updated_at)
    VALUES ('market', ${JSON.stringify(state)}::jsonb, NOW())
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;

  return state;
}
