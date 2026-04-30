import { defaultMarketState } from "@/lib/defaults";
import { getSql, isDatabaseEnabled } from "@/lib/db";
import type { MarketState } from "@/types";

export async function getMarketState(): Promise<{
  state: MarketState;
  databaseEnabled: boolean;
  persisted: boolean;
}> {
  const sql = getSql();

  if (!sql) {
    return {
      state: defaultMarketState,
      databaseEnabled: false,
      persisted: false
    };
  }

  const rows = await sql`
    SELECT value
    FROM app_state
    WHERE key = 'market'
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      state: defaultMarketState,
      databaseEnabled: isDatabaseEnabled(),
      persisted: false
    };
  }

  return {
    state: rows[0].value as MarketState,
    databaseEnabled: isDatabaseEnabled(),
    persisted: true
  };
}

export async function saveMarketState(state: MarketState) {
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
