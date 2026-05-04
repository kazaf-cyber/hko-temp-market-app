import { randomUUID } from "crypto";
import { neon } from "@neondatabase/serverless";
import { isTemperatureInOutcome } from "@/lib/trading/resolution";
import type { ForecastResult, HkoWeatherSnapshot, MarketState } from "@/types";


let cachedSql: ReturnType<typeof neon> | null = null;
let signalSnapshotsInitPromise: Promise<void> | null = null;


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

type SignalSnapshotDbRow = {
  id: number | string | bigint;
  forecast_run_id: number | string | bigint | null;
  snapshot_key: string;
  created_at: string | Date;
  hkt_date: string | null;
  target_date: string | null;
  market_slug: string | null;
  market_title: string | null;

  outcome_name: string;
  outcome_lower: number | string | null;
  outcome_upper: number | string | null;

  side: string;
  strength: string;
  should_trade: boolean | string | number;

  model_probability: number | string | null;
  model_no_probability: number | string | null;
  weather_probability: number | string | null;
  final_probability: number | string | null;
  market_probability: number | string | null;

  yes_bid: number | string | null;
  yes_ask: number | string | null;
  no_bid: number | string | null;
  no_ask: number | string | null;
  midpoint: number | string | null;
  spread: number | string | null;

  yes_edge: number | string | null;
  no_edge: number | string | null;
  best_edge: number | string | null;
  required_edge: number | string | null;
  max_yes_entry: number | string | null;
  max_no_entry: number | string | null;
  recommended_stake_fraction: number | string | null;

  price_quality: string | null;
  price_age_seconds: number | string | null;
  resolution_confidence: number | string | null;
  probability_source: string | null;

  reasons: unknown;
  warnings: unknown;
  signal: unknown;
  forecast_summary: unknown;

  settled_at: string | Date | null;
  official_max_temp_c: number | string | null;
  winning_outcome_name: string | null;
  outcome_won: boolean | string | number | null;
  realized_pnl_per_share: number | string | null;
};

export type SignalSnapshotRow = {
  id: number;
  forecastRunId: number | null;
  snapshotKey: string;
  createdAt: string;
  hktDate: string | null;
  targetDate: string | null;
  marketSlug: string | null;
  marketTitle: string | null;

  outcomeName: string;
  outcomeLower: number | null;
  outcomeUpper: number | null;

  side: string;
  strength: string;
  shouldTrade: boolean;

  modelProbability: number | null;
  modelNoProbability: number | null;
  weatherProbability: number | null;
  finalProbability: number | null;
  marketProbability: number | null;

  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  midpoint: number | null;
  spread: number | null;

  yesEdge: number | null;
  noEdge: number | null;
  bestEdge: number | null;
  requiredEdge: number | null;
  maxYesEntry: number | null;
  maxNoEntry: number | null;
  recommendedStakeFraction: number | null;

  priceQuality: string | null;
  priceAgeSeconds: number | null;
  resolutionConfidence: number | null;
  probabilitySource: string | null;

  reasons: unknown[];
  warnings: unknown[];
  signal: Record<string, unknown>;
  forecastSummary: Record<string, unknown>;

  settledAt: string | null;
  officialMaxTempC: number | null;
  winningOutcomeName: string | null;
  outcomeWon: boolean | null;
  realizedPnlPerShare: number | null;
};

export type SignalSnapshotSaveResult = {
  saved: number;
  snapshotKey: string | null;
  reason: string | null;
};

export type SignalSettlementResult = {
  updated: number;
  officialMaxTempC: number;
  targetDate: string | null;
  hktDate: string | null;
  winningOutcomeName: string | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function toNullableDateString(value: unknown): string | null {
  const parsed = toDateString(value);
  return parsed ? parsed : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = toStringOrNull(value);

    if (parsed) {
      return parsed;
    }
  }

  return null;
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

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return {};
}

function parseJsonArray(value: unknown): unknown[] {
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

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function getResultRecord(result: ForecastResult): Record<string, unknown> {
  return result as unknown as Record<string, unknown>;
}

function getSignalRecords(result: ForecastResult): Record<string, unknown>[] {
  const record = getResultRecord(result);

  const tradeSignals = recordArray(record.tradeSignals);
  if (tradeSignals.length > 0) {
    return tradeSignals;
  }

  const tradingSignals = recordArray(record.tradingSignals);
  if (tradingSignals.length > 0) {
    return tradingSignals;
  }

  return [];
}

function getOutcomeRecords(result: ForecastResult): Record<string, unknown>[] {
  const record = getResultRecord(result);

  const outcomeProbabilities = recordArray(record.outcomeProbabilities);
  if (outcomeProbabilities.length > 0) {
    return outcomeProbabilities;
  }

  const outcomes = recordArray(record.outcomes);
  if (outcomes.length > 0) {
    return outcomes;
  }

  const probabilities = recordArray(record.probabilities);
  if (probabilities.length > 0) {
    return probabilities;
  }

  return [];
}

function findOutcomeMeta(
  result: ForecastResult,
  outcomeName: string
): Record<string, unknown> | null {
  return (
    getOutcomeRecords(result).find((outcome) => {
      const name = firstString(outcome.name, outcome.outcomeName);
      return name === outcomeName;
    }) ?? null
  );
}

function getForecastSummary(result: ForecastResult): Record<string, unknown> {
  const record = getResultRecord(result);

  return {
    version: record.version ?? null,
    generatedAt: record.generatedAt ?? null,
    hktDate: record.hktDate ?? null,
    targetDate: record.targetDate ?? record.forecastDate ?? record.date ?? null,
    topOutcome: record.topOutcome ?? null,
    model: record.model ?? null,
    confidence: record.confidence ?? null,
    confidenceLabel: record.confidenceLabel ?? null,
    summary: record.summary ?? null,
    diagnostics: record.diagnostics ?? null
  };
}

function getForecastMarketInfo(result: ForecastResult): {
  marketSlug: string | null;
  marketTitle: string | null;
} {
  const record = getResultRecord(result);
  const market = isRecord(record.market) ? record.market : {};

  return {
    marketSlug: firstString(
      market.slug,
      market.eventSlug,
      record.marketSlug,
      record.eventSlug,
      record.slug
    ),
    marketTitle: firstString(
      market.title,
      market.question,
      record.marketTitle,
      record.marketQuestion,
      record.eventTitle
    )
  };
}

function roundNumber(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function computeRealizedPnlPerShare(params: {
  side: string;
  entryPrice: number | null;
  outcomeWon: boolean;
}): number | null {
  if (params.side === "NO_TRADE") {
    return 0;
  }

  if (params.entryPrice === null || !Number.isFinite(params.entryPrice)) {
    return null;
  }

  if (params.side === "BUY_YES") {
    return roundNumber(
      params.outcomeWon ? 1 - params.entryPrice : -params.entryPrice
    );
  }

  if (params.side === "BUY_NO") {
    return roundNumber(
      params.outcomeWon ? -params.entryPrice : 1 - params.entryPrice
    );
  }

  return null;
}

function mapSignalSnapshotRow(row: SignalSnapshotDbRow): SignalSnapshotRow {
  return {
    id: toNumberOrNull(row.id) ?? 0,
    forecastRunId: toNumberOrNull(row.forecast_run_id),
    snapshotKey: String(row.snapshot_key),
    createdAt: toDateString(row.created_at),
    hktDate: toStringOrNull(row.hkt_date),
    targetDate: toStringOrNull(row.target_date),
    marketSlug: toStringOrNull(row.market_slug),
    marketTitle: toStringOrNull(row.market_title),

    outcomeName: String(row.outcome_name),
    outcomeLower: toNumberOrNull(row.outcome_lower),
    outcomeUpper: toNumberOrNull(row.outcome_upper),

    side: String(row.side),
    strength: String(row.strength),
    shouldTrade: toBooleanOrNull(row.should_trade) ?? false,

    modelProbability: toNumberOrNull(row.model_probability),
    modelNoProbability: toNumberOrNull(row.model_no_probability),
    weatherProbability: toNumberOrNull(row.weather_probability),
    finalProbability: toNumberOrNull(row.final_probability),
    marketProbability: toNumberOrNull(row.market_probability),

    yesBid: toNumberOrNull(row.yes_bid),
    yesAsk: toNumberOrNull(row.yes_ask),
    noBid: toNumberOrNull(row.no_bid),
    noAsk: toNumberOrNull(row.no_ask),
    midpoint: toNumberOrNull(row.midpoint),
    spread: toNumberOrNull(row.spread),

    yesEdge: toNumberOrNull(row.yes_edge),
    noEdge: toNumberOrNull(row.no_edge),
    bestEdge: toNumberOrNull(row.best_edge),
    requiredEdge: toNumberOrNull(row.required_edge),
    maxYesEntry: toNumberOrNull(row.max_yes_entry),
    maxNoEntry: toNumberOrNull(row.max_no_entry),
    recommendedStakeFraction: toNumberOrNull(row.recommended_stake_fraction),

    priceQuality: toStringOrNull(row.price_quality),
    priceAgeSeconds: toNumberOrNull(row.price_age_seconds),
    resolutionConfidence: toNumberOrNull(row.resolution_confidence),
    probabilitySource: toStringOrNull(row.probability_source),

    reasons: parseJsonArray(row.reasons),
    warnings: parseJsonArray(row.warnings),
    signal: parseJsonRecord(row.signal),
    forecastSummary: parseJsonRecord(row.forecast_summary),

    settledAt: toNullableDateString(row.settled_at),
    officialMaxTempC: toNumberOrNull(row.official_max_temp_c),
    winningOutcomeName: toStringOrNull(row.winning_outcome_name),
    outcomeWon: toBooleanOrNull(row.outcome_won),
    realizedPnlPerShare: toNumberOrNull(row.realized_pnl_per_share)
  };
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

export async function initSignalSnapshotsDatabase() {
  const sql = getSql();

  if (!sql) {
    throw new Error("DATABASE_URL is not configured.");
  }

  await sql`
    CREATE TABLE IF NOT EXISTS signal_snapshots (
      id BIGSERIAL PRIMARY KEY,

      forecast_run_id BIGINT REFERENCES forecast_runs(id) ON DELETE SET NULL,
      snapshot_key TEXT NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      hkt_date TEXT,
      target_date TEXT,

      market_slug TEXT,
      market_title TEXT,

      outcome_name TEXT NOT NULL,
      outcome_lower DOUBLE PRECISION,
      outcome_upper DOUBLE PRECISION,

      side TEXT NOT NULL DEFAULT 'NO_TRADE',
      strength TEXT NOT NULL DEFAULT 'NONE',
      should_trade BOOLEAN NOT NULL DEFAULT FALSE,

      model_probability DOUBLE PRECISION,
      model_no_probability DOUBLE PRECISION,
      weather_probability DOUBLE PRECISION,
      final_probability DOUBLE PRECISION,
      market_probability DOUBLE PRECISION,

      yes_bid DOUBLE PRECISION,
      yes_ask DOUBLE PRECISION,
      no_bid DOUBLE PRECISION,
      no_ask DOUBLE PRECISION,
      midpoint DOUBLE PRECISION,
      spread DOUBLE PRECISION,

      yes_edge DOUBLE PRECISION,
      no_edge DOUBLE PRECISION,
      best_edge DOUBLE PRECISION,
      required_edge DOUBLE PRECISION,
      max_yes_entry DOUBLE PRECISION,
      max_no_entry DOUBLE PRECISION,
      recommended_stake_fraction DOUBLE PRECISION,

      price_quality TEXT,
      price_age_seconds DOUBLE PRECISION,
      resolution_confidence DOUBLE PRECISION,
      probability_source TEXT,

      reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      signal JSONB NOT NULL,
      forecast_summary JSONB,

      settled_at TIMESTAMPTZ,
      official_max_temp_c DOUBLE PRECISION,
      winning_outcome_name TEXT,
      outcome_won BOOLEAN,
      realized_pnl_per_share DOUBLE PRECISION
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS signal_snapshots_created_at_idx
    ON signal_snapshots (created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS signal_snapshots_hkt_date_idx
    ON signal_snapshots (hkt_date)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS signal_snapshots_target_date_idx
    ON signal_snapshots (target_date)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS signal_snapshots_snapshot_key_idx
    ON signal_snapshots (snapshot_key)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS signal_snapshots_trade_idx
    ON signal_snapshots (should_trade, side, strength)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS signal_snapshots_settlement_idx
    ON signal_snapshots (target_date, outcome_won)
  `;
}

async function ensureSignalSnapshotsTable() {
  if (!signalSnapshotsInitPromise) {
    signalSnapshotsInitPromise = initSignalSnapshotsDatabase().catch((error) => {
      signalSnapshotsInitPromise = null;
      throw error;
    });
  }

  return signalSnapshotsInitPromise;
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

  await initSignalSnapshotsDatabase();
}

export async function saveSignalSnapshotsFromForecastResult(params: {
  forecastRunId?: number | null;
  hktDate: string;
  result: ForecastResult;
}): Promise<SignalSnapshotSaveResult> {
  const sql = getSql();

  if (!sql) {
    return {
      saved: 0,
      snapshotKey: null,
      reason: "DATABASE_URL is not configured."
    };
  }

  const signals = getSignalRecords(params.result);

  if (signals.length === 0) {
    return {
      saved: 0,
      snapshotKey: null,
      reason: "Forecast result has no tradeSignals."
    };
  }

  await ensureSignalSnapshotsTable();

  const record = getResultRecord(params.result);
  const snapshotKey = randomUUID();

  const hktDate =
    firstString(record.hktDate, record.date, params.hktDate) ?? params.hktDate;

  const targetDate =
    firstString(record.targetDate, record.forecastDate, record.date, hktDate) ??
    hktDate;

  const { marketSlug, marketTitle } = getForecastMarketInfo(params.result);
  const forecastSummary = getForecastSummary(params.result);

  let saved = 0;

  for (const signal of signals) {
    const outcomeName =
      firstString(signal.outcomeName, signal.name) ?? "Unknown outcome";

    const outcomeMeta = findOutcomeMeta(params.result, outcomeName);

    const outcomeLower =
      toNumberOrNull(signal.lower) ?? toNumberOrNull(outcomeMeta?.lower);

    const outcomeUpper =
      toNumberOrNull(signal.upper) ?? toNumberOrNull(outcomeMeta?.upper);

    const side = firstString(signal.side) ?? "NO_TRADE";
    const strength = firstString(signal.strength) ?? "NONE";
    const shouldTrade = toBooleanOrNull(signal.shouldTrade) ?? side !== "NO_TRADE";

    await sql`
      INSERT INTO signal_snapshots (
        forecast_run_id,
        snapshot_key,

        hkt_date,
        target_date,
        market_slug,
        market_title,

        outcome_name,
        outcome_lower,
        outcome_upper,

        side,
        strength,
        should_trade,

        model_probability,
        model_no_probability,
        weather_probability,
        final_probability,
        market_probability,

        yes_bid,
        yes_ask,
        no_bid,
        no_ask,
        midpoint,
        spread,

        yes_edge,
        no_edge,
        best_edge,
        required_edge,
        max_yes_entry,
        max_no_entry,
        recommended_stake_fraction,

        price_quality,
        price_age_seconds,
        resolution_confidence,
        probability_source,

        reasons,
        warnings,
        signal,
        forecast_summary
      )
      VALUES (
        ${params.forecastRunId ?? null},
        ${snapshotKey},

        ${hktDate},
        ${targetDate},
        ${marketSlug},
        ${marketTitle},

        ${outcomeName},
        ${outcomeLower},
        ${outcomeUpper},

        ${side},
        ${strength},
        ${shouldTrade},

        ${toNumberOrNull(signal.modelProbability)},
        ${toNumberOrNull(signal.modelNoProbability)},
        ${toNumberOrNull(signal.weatherProbability)},
        ${toNumberOrNull(signal.finalProbability)},
        ${toNumberOrNull(signal.marketProbability)},

        ${toNumberOrNull(signal.yesBid)},
        ${toNumberOrNull(signal.yesAsk)},
        ${toNumberOrNull(signal.noBid)},
        ${toNumberOrNull(signal.noAsk)},
        ${toNumberOrNull(signal.midpoint)},
        ${toNumberOrNull(signal.spread)},

        ${toNumberOrNull(signal.yesEdge)},
        ${toNumberOrNull(signal.noEdge)},
        ${toNumberOrNull(signal.bestEdge)},
        ${toNumberOrNull(signal.requiredEdge)},
        ${toNumberOrNull(signal.maxYesEntry)},
        ${toNumberOrNull(signal.maxNoEntry)},
        ${toNumberOrNull(signal.recommendedStakeFraction)},

        ${firstString(signal.priceQuality)},
        ${toNumberOrNull(signal.priceAgeSeconds)},
        ${toNumberOrNull(signal.resolutionConfidence)},
        ${firstString(signal.probabilitySource)},

        ${JSON.stringify(parseJsonArray(signal.reasons))}::jsonb,
        ${JSON.stringify(parseJsonArray(signal.warnings))}::jsonb,
        ${JSON.stringify(signal)}::jsonb,
        ${JSON.stringify(forecastSummary)}::jsonb
      )
    `;

    saved += 1;
  }

  return {
    saved,
    snapshotKey,
    reason: null
  };
}

export async function saveForecastRun(params: {
  hktDate: string;
  state: MarketState;
  weather: HkoWeatherSnapshot;
  result: ForecastResult;
}): Promise<{ saved: boolean; reason: string | null }> {
  const sql = getSql();

  if (!sql) {
    return {
      saved: false,
      reason: "DATABASE_URL is not configured."
    };
  }

  const insertResult = await sql`
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
    RETURNING id, created_at
  `;

  const insertedRows = normalizeRows<{
    id: number | string | bigint;
    created_at: string | Date;
  }>(insertResult);

  const forecastRunId = toNumberOrNull(insertedRows[0]?.id);

  /**
   * Do not fail the whole forecast history save if signal snapshot persistence
   * fails. Forecast history is still useful, and the API route already returns
   * a compact save status.
   */
  try {
    await saveSignalSnapshotsFromForecastResult({
      forecastRunId,
      hktDate: params.hktDate,
      result: params.result
    });
  } catch (error) {
    console.error("Signal snapshot save error:", error);
  }

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

export async function getSignalSnapshots(
  limit = 200
): Promise<SignalSnapshotRow[]> {
  const sql = getSql();

  if (!sql) {
    return [];
  }

  await ensureSignalSnapshotsTable();

  const safeLimit = Math.max(1, Math.min(limit, 1000));

  const queryResult = await sql`
    SELECT *
    FROM signal_snapshots
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `;

  return normalizeRows<SignalSnapshotDbRow>(queryResult).map(
    mapSignalSnapshotRow
  );
}

export async function getSignalSnapshotsForDate(params: {
  targetDate?: string | null;
  hktDate?: string | null;
  limit?: number;
}): Promise<SignalSnapshotRow[]> {
  const sql = getSql();

  if (!sql) {
    return [];
  }

  await ensureSignalSnapshotsTable();

  const targetDate = toStringOrNull(params.targetDate);
  const hktDate = toStringOrNull(params.hktDate);
  const safeLimit = Math.max(1, Math.min(params.limit ?? 2000, 5000));

  if (targetDate && hktDate) {
    const queryResult = await sql`
      SELECT *
      FROM signal_snapshots
      WHERE target_date = ${targetDate}
         OR hkt_date = ${hktDate}
      ORDER BY created_at DESC
      LIMIT ${safeLimit}
    `;

    return normalizeRows<SignalSnapshotDbRow>(queryResult).map(
      mapSignalSnapshotRow
    );
  }

  if (targetDate) {
    const queryResult = await sql`
      SELECT *
      FROM signal_snapshots
      WHERE target_date = ${targetDate}
         OR hkt_date = ${targetDate}
      ORDER BY created_at DESC
      LIMIT ${safeLimit}
    `;

    return normalizeRows<SignalSnapshotDbRow>(queryResult).map(
      mapSignalSnapshotRow
    );
  }

  if (hktDate) {
    const queryResult = await sql`
      SELECT *
      FROM signal_snapshots
      WHERE hkt_date = ${hktDate}
         OR target_date = ${hktDate}
      ORDER BY created_at DESC
      LIMIT ${safeLimit}
    `;

    return normalizeRows<SignalSnapshotDbRow>(queryResult).map(
      mapSignalSnapshotRow
    );
  }

  return [];
}

export async function settleSignalSnapshots(params: {
  targetDate?: string | null;
  hktDate?: string | null;
  officialMaxTempC: number;
}): Promise<SignalSettlementResult> {
  const sql = getSql();

  if (!sql) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!Number.isFinite(params.officialMaxTempC)) {
    throw new Error("officialMaxTempC must be a finite number.");
  }

  await ensureSignalSnapshotsTable();

  const targetDate = toStringOrNull(params.targetDate);
  const hktDate = toStringOrNull(params.hktDate);

  if (!targetDate && !hktDate) {
    throw new Error("Either targetDate or hktDate is required.");
  }

  const rows = await getSignalSnapshotsForDate({
    targetDate,
    hktDate,
    limit: 5000
  });

  const winningOutcome =
    rows.find((row) =>
      isTemperatureInOutcome(params.officialMaxTempC, {
        name: row.outcomeName,
        lower: row.outcomeLower,
        upper: row.outcomeUpper
      })
    ) ?? null;

  const winningOutcomeName = winningOutcome?.outcomeName ?? null;
  const settledAt = new Date().toISOString();

  let updated = 0;

  for (const row of rows) {
    const outcomeWon = isTemperatureInOutcome(params.officialMaxTempC, {
      name: row.outcomeName,
      lower: row.outcomeLower,
      upper: row.outcomeUpper
    });

    const entryPrice =
      row.side === "BUY_YES"
        ? row.yesAsk
        : row.side === "BUY_NO"
          ? row.noAsk
          : null;

    const realizedPnlPerShare = computeRealizedPnlPerShare({
      side: row.side,
      entryPrice,
      outcomeWon
    });

    await sql`
      UPDATE signal_snapshots
      SET
        settled_at = ${settledAt},
        official_max_temp_c = ${params.officialMaxTempC},
        winning_outcome_name = ${winningOutcomeName},
        outcome_won = ${outcomeWon},
        realized_pnl_per_share = ${realizedPnlPerShare}
      WHERE id = ${row.id}
    `;

    updated += 1;
  }

  return {
    updated,
    officialMaxTempC: params.officialMaxTempC,
    targetDate,
    hktDate,
    winningOutcomeName
  };
}
