import { randomUUID } from "crypto";
import {
  getSignalSnapshots,
  getSql,
  initDatabase,
  isDatabaseEnabled,
  type SignalSnapshotRow
} from "@/lib/db";

let paperTradingInitPromise: Promise<void> | null = null;

export type PaperTradeStatus = "OPEN" | "SETTLED" | "CANCELLED";

type PaperTradeDbRow = {
  id: number | string | bigint;
  created_at: string | Date;
  run_id: string | null;

  signal_snapshot_id: number | string | bigint | null;
  snapshot_key: string;

  hkt_date: string | null;
  target_date: string | null;

  market_slug: string | null;
  market_title: string | null;

  outcome_name: string;
  side: string;
  strength: string;

  entry_price: number | string;
  stake_fraction: number | string;
  bankroll_usd: number | string;
  notional_usd: number | string;
  shares: number | string;

  model_probability: number | string | null;
  market_probability: number | string | null;
  best_edge: number | string | null;
  required_edge: number | string | null;

  price_quality: string | null;
  resolution_confidence: number | string | null;

  status: string;
  settled_at: string | Date | null;
  outcome_won: boolean | string | number | null;
  realized_pnl_usd: number | string | null;

  signal: unknown;
  notes: unknown;
};

export type PaperTradeRow = {
  id: number;
  createdAt: string;
  runId: string | null;

  signalSnapshotId: number | null;
  snapshotKey: string;

  hktDate: string | null;
  targetDate: string | null;

  marketSlug: string | null;
  marketTitle: string | null;

  outcomeName: string;
  side: string;
  strength: string;

  entryPrice: number;
  stakeFraction: number;
  bankrollUsd: number;
  notionalUsd: number;
  shares: number;

  modelProbability: number | null;
  marketProbability: number | null;
  bestEdge: number | null;
  requiredEdge: number | null;

  priceQuality: string | null;
  resolutionConfidence: number | null;

  status: PaperTradeStatus;
  settledAt: string | null;
  outcomeWon: boolean | null;
  realizedPnlUsd: number | null;

  signal: Record<string, unknown>;
  notes: unknown[];
};

export type PaperTradingConfig = {
  enabled: boolean;

  bankrollUsd: number;

  minStakeFraction: number;
  maxStakeFraction: number;

  minNotionalUsd: number;
  maxNotionalUsdPerTrade: number;
  maxDailyNotionalUsd: number;
  maxOpenTrades: number;

  minResolutionConfidence: number;
  minBestEdge: number;
  maxPriceAgeSeconds: number | null;

  allowedPriceQualities: string[];
  allowedStrengths: string[];
};

export type PaperTradingConfigOverrides = Partial<
  Pick<
    PaperTradingConfig,
    | "bankrollUsd"
    | "minStakeFraction"
    | "maxStakeFraction"
    | "minNotionalUsd"
    | "maxNotionalUsdPerTrade"
    | "maxDailyNotionalUsd"
    | "maxOpenTrades"
    | "minResolutionConfidence"
    | "minBestEdge"
    | "maxPriceAgeSeconds"
    | "allowedPriceQualities"
    | "allowedStrengths"
  >
>;

export type PaperTradingRiskState = {
  hktDate: string;
  dailyNotionalUsedUsd: number;
  dailyNotionalRemainingUsd: number;
  dailyTradeCount: number;
  openTradeCount: number;
  openTradeSlotsRemaining: number;
};

export type PaperTradeSkip = {
  signalSnapshotId: number | null;
  snapshotKey: string | null;
  outcomeName: string | null;
  side: string | null;
  reason: string;
  detail: string | null;
};

export type PaperTradePlan = {
  signalSnapshotId: number;
  snapshotKey: string;
  outcomeName: string;
  side: string;
  strength: string;
  entryPrice: number;
  stakeFraction: number;
  notionalUsd: number;
  shares: number;
  bestEdge: number | null;
  priceQuality: string | null;
  resolutionConfidence: number | null;
};

export type PaperTradingRunOptions = {
  snapshotKey?: string | null;
  dryRun?: boolean;
  limit?: number;
  force?: boolean;
  configOverrides?: PaperTradingConfigOverrides;
};

export type PaperTradingRunResult = {
  ok: boolean;
  reason: string | null;

  databaseEnabled: boolean;
  runId: string;
  dryRun: boolean;

  snapshotKey: string | null;
  snapshotRowCount: number;
  evaluatedCount: number;

  plannedCount: number;
  insertedCount: number;
  skippedCount: number;

  plannedTrades: PaperTradePlan[];
  createdTrades: PaperTradeRow[];
  skipped: PaperTradeSkip[];

  config: PaperTradingConfig;
  riskBefore: PaperTradingRiskState;
  riskAfter: PaperTradingRiskState;
};

export type PaperTradingSummary = {
  hktDate: string;

  totalTrades: number;
  openTrades: number;
  settledTrades: number;
  cancelledTrades: number;

  totalNotionalUsd: number;
  openNotionalUsd: number;
  settledNotionalUsd: number;

  realizedPnlUsd: number;
  estimatedBankrollUsd: number;
  worstCaseOpenLossUsd: number;
};

export type PaperTradeSettleOptions = {
  snapshotKey?: string | null;
  targetDate?: string | null;
  hktDate?: string | null;
};

export type PaperTradeSettleResult = {
  settledCount: number;
  totalRealizedPnlUsd: number;
  filters: {
    snapshotKey: string | null;
    targetDate: string | null;
    hktDate: string | null;
  };
  trades: PaperTradeRow[];
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

function roundNumber(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundUsd(value: number): number {
  return roundNumber(value, 4);
}

function sum(values: Array<number | null | undefined>): number {
  return roundNumber(
    values
      .filter((value): value is number => typeof value === "number")
      .reduce((total, value) => total + value, 0)
  );
}

function safeLimit(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.round(value), 5000));
}

function normalizeStatus(value: unknown): PaperTradeStatus {
  const normalized =
    typeof value === "string" ? value.trim().toUpperCase() : "OPEN";

  if (
    normalized === "OPEN" ||
    normalized === "SETTLED" ||
    normalized === "CANCELLED"
  ) {
    return normalized;
  }

  return "OPEN";
}

function getCurrentHktDateString(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw.trim() === "") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalNumberEnv(
  name: string,
  fallback: number | null
): number | null {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw.trim() === "") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (["none", "null", "off", "false", "disabled"].includes(normalized)) {
    return null;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function readCsvEnv(name: string, fallback: string): string[] {
  return parseCsv(process.env[name] ?? fallback);
}

function normalizeStringArray(values: string[]): string[] {
  return values.map((value) => value.trim().toUpperCase()).filter(Boolean);
}

function applyNumberOverride(
  config: PaperTradingConfig,
  key: keyof PaperTradingConfigOverrides,
  value: unknown
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }

  if (key === "maxOpenTrades") {
    config.maxOpenTrades = Math.max(0, Math.round(value));
    return;
  }

  if (
    key === "bankrollUsd" ||
    key === "minStakeFraction" ||
    key === "maxStakeFraction" ||
    key === "minNotionalUsd" ||
    key === "maxNotionalUsdPerTrade" ||
    key === "maxDailyNotionalUsd" ||
    key === "minResolutionConfidence" ||
    key === "minBestEdge" ||
    key === "maxPriceAgeSeconds"
  ) {
    (config[key] as number | null) = value;
  }
}

function mapPaperTradeRow(row: PaperTradeDbRow): PaperTradeRow {
  return {
    id: toNumberOrNull(row.id) ?? 0,
    createdAt: toDateString(row.created_at),
    runId: toStringOrNull(row.run_id),

    signalSnapshotId: toNumberOrNull(row.signal_snapshot_id),
    snapshotKey: String(row.snapshot_key),

    hktDate: toStringOrNull(row.hkt_date),
    targetDate: toStringOrNull(row.target_date),

    marketSlug: toStringOrNull(row.market_slug),
    marketTitle: toStringOrNull(row.market_title),

    outcomeName: String(row.outcome_name),
    side: String(row.side),
    strength: String(row.strength),

    entryPrice: toNumberOrNull(row.entry_price) ?? 0,
    stakeFraction: toNumberOrNull(row.stake_fraction) ?? 0,
    bankrollUsd: toNumberOrNull(row.bankroll_usd) ?? 0,
    notionalUsd: toNumberOrNull(row.notional_usd) ?? 0,
    shares: toNumberOrNull(row.shares) ?? 0,

    modelProbability: toNumberOrNull(row.model_probability),
    marketProbability: toNumberOrNull(row.market_probability),
    bestEdge: toNumberOrNull(row.best_edge),
    requiredEdge: toNumberOrNull(row.required_edge),

    priceQuality: toStringOrNull(row.price_quality),
    resolutionConfidence: toNumberOrNull(row.resolution_confidence),

    status: normalizeStatus(row.status),
    settledAt: toNullableDateString(row.settled_at),
    outcomeWon: toBooleanOrNull(row.outcome_won),
    realizedPnlUsd: toNumberOrNull(row.realized_pnl_usd),

    signal: parseJsonRecord(row.signal),
    notes: parseJsonArray(row.notes)
  };
}

function emptyRiskState(config: PaperTradingConfig): PaperTradingRiskState {
  return {
    hktDate: getCurrentHktDateString(),
    dailyNotionalUsedUsd: 0,
    dailyNotionalRemainingUsd: config.maxDailyNotionalUsd,
    dailyTradeCount: 0,
    openTradeCount: 0,
    openTradeSlotsRemaining: config.maxOpenTrades
  };
}

function makeSkip(
  row: SignalSnapshotRow | null,
  reason: string,
  detail: string | null = null
): PaperTradeSkip {
  return {
    signalSnapshotId: row?.id ?? null,
    snapshotKey: row?.snapshotKey ?? null,
    outcomeName: row?.outcomeName ?? null,
    side: row?.side ?? null,
    reason,
    detail
  };
}

function getEntryPrice(row: SignalSnapshotRow): number | null {
  if (row.side === "BUY_YES") {
    return row.yesAsk;
  }

  if (row.side === "BUY_NO") {
    return row.noAsk;
  }

  return null;
}

function buildRiskStateAfterPlans(
  before: PaperTradingRiskState,
  config: PaperTradingConfig,
  plannedTrades: PaperTradePlan[]
): PaperTradingRiskState {
  const plannedNotional = sum(plannedTrades.map((trade) => trade.notionalUsd));
  const plannedCount = plannedTrades.length;

  const dailyNotionalUsedUsd = roundUsd(
    before.dailyNotionalUsedUsd + plannedNotional
  );

  const openTradeCount = before.openTradeCount + plannedCount;

  return {
    hktDate: before.hktDate,
    dailyNotionalUsedUsd,
    dailyNotionalRemainingUsd: roundUsd(
      Math.max(0, config.maxDailyNotionalUsd - dailyNotionalUsedUsd)
    ),
    dailyTradeCount: before.dailyTradeCount + plannedCount,
    openTradeCount,
    openTradeSlotsRemaining: Math.max(
      0,
      config.maxOpenTrades - openTradeCount
    )
  };
}

export function getPaperTradingConfig(
  overrides: PaperTradingConfigOverrides = {}
): PaperTradingConfig {
  const config: PaperTradingConfig = {
    enabled: readBooleanEnv("PAPER_TRADING_ENABLED", true),

    bankrollUsd: Math.max(1, readNumberEnv("PAPER_BANKROLL_USD", 1000)),

    minStakeFraction: Math.max(
      0,
      readNumberEnv("PAPER_MIN_STAKE_FRACTION", 0.001)
    ),
    maxStakeFraction: Math.max(
      0.0001,
      readNumberEnv("PAPER_MAX_STAKE_FRACTION", 0.02)
    ),

    minNotionalUsd: Math.max(0, readNumberEnv("PAPER_MIN_NOTIONAL_USD", 1)),
    maxNotionalUsdPerTrade: Math.max(
      0.01,
      readNumberEnv("PAPER_MAX_NOTIONAL_USD_PER_TRADE", 25)
    ),
    maxDailyNotionalUsd: Math.max(
      0.01,
      readNumberEnv("PAPER_MAX_DAILY_NOTIONAL_USD", 100)
    ),
    maxOpenTrades: Math.max(
      0,
      Math.round(readNumberEnv("PAPER_MAX_OPEN_TRADES", 8))
    ),

    minResolutionConfidence: Math.max(
      0,
      Math.min(readNumberEnv("PAPER_MIN_RESOLUTION_CONFIDENCE", 0.9), 1)
    ),
    minBestEdge: Math.max(0, readNumberEnv("PAPER_MIN_BEST_EDGE", 0.02)),
    maxPriceAgeSeconds: readOptionalNumberEnv(
      "PAPER_MAX_PRICE_AGE_SECONDS",
      300
    ),

    allowedPriceQualities: readCsvEnv("PAPER_ALLOWED_PRICE_QUALITIES", "GOOD"),
    allowedStrengths: readCsvEnv(
      "PAPER_ALLOWED_STRENGTHS",
      "MEDIUM,STRONG,VERY_STRONG,HIGH"
    )
  };

  applyNumberOverride(config, "bankrollUsd", overrides.bankrollUsd);
  applyNumberOverride(
    config,
    "minStakeFraction",
    overrides.minStakeFraction
  );
  applyNumberOverride(
    config,
    "maxStakeFraction",
    overrides.maxStakeFraction
  );
  applyNumberOverride(config, "minNotionalUsd", overrides.minNotionalUsd);
  applyNumberOverride(
    config,
    "maxNotionalUsdPerTrade",
    overrides.maxNotionalUsdPerTrade
  );
  applyNumberOverride(
    config,
    "maxDailyNotionalUsd",
    overrides.maxDailyNotionalUsd
  );
  applyNumberOverride(config, "maxOpenTrades", overrides.maxOpenTrades);
  applyNumberOverride(
    config,
    "minResolutionConfidence",
    overrides.minResolutionConfidence
  );
  applyNumberOverride(config, "minBestEdge", overrides.minBestEdge);
  applyNumberOverride(
    config,
    "maxPriceAgeSeconds",
    overrides.maxPriceAgeSeconds
  );

  if (Array.isArray(overrides.allowedPriceQualities)) {
    config.allowedPriceQualities = normalizeStringArray(
      overrides.allowedPriceQualities
    );
  }

  if (Array.isArray(overrides.allowedStrengths)) {
    config.allowedStrengths = normalizeStringArray(overrides.allowedStrengths);
  }

  config.bankrollUsd = Math.max(1, config.bankrollUsd);
  config.minStakeFraction = Math.max(0, config.minStakeFraction);
  config.maxStakeFraction = Math.max(
    config.minStakeFraction,
    config.maxStakeFraction
  );
  config.minNotionalUsd = Math.max(0, config.minNotionalUsd);
  config.maxNotionalUsdPerTrade = Math.max(
    config.minNotionalUsd,
    config.maxNotionalUsdPerTrade
  );
  config.maxDailyNotionalUsd = Math.max(0, config.maxDailyNotionalUsd);
  config.maxOpenTrades = Math.max(0, Math.round(config.maxOpenTrades));
  config.minResolutionConfidence = Math.max(
    0,
    Math.min(config.minResolutionConfidence, 1)
  );
  config.minBestEdge = Math.max(0, config.minBestEdge);

  if (
    config.maxPriceAgeSeconds !== null &&
    (!Number.isFinite(config.maxPriceAgeSeconds) ||
      config.maxPriceAgeSeconds <= 0)
  ) {
    config.maxPriceAgeSeconds = null;
  }

  return config;
}

export async function initPaperTradingDatabase() {
  const sql = getSql();

  if (!sql) {
    throw new Error("DATABASE_URL is not configured.");
  }

  /**
   * Ensure base tables exist first:
   * - forecast_runs
   * - signal_snapshots
   */
  await initDatabase();

  await sql`
    CREATE TABLE IF NOT EXISTS paper_trades (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      run_id TEXT,

      signal_snapshot_id BIGINT UNIQUE REFERENCES signal_snapshots(id) ON DELETE SET NULL,
      snapshot_key TEXT NOT NULL,

      hkt_date TEXT,
      target_date TEXT,

      market_slug TEXT,
      market_title TEXT,

      outcome_name TEXT NOT NULL,
      side TEXT NOT NULL,
      strength TEXT NOT NULL,

      entry_price DOUBLE PRECISION NOT NULL,
      stake_fraction DOUBLE PRECISION NOT NULL,
      bankroll_usd DOUBLE PRECISION NOT NULL,
      notional_usd DOUBLE PRECISION NOT NULL,
      shares DOUBLE PRECISION NOT NULL,

      model_probability DOUBLE PRECISION,
      market_probability DOUBLE PRECISION,
      best_edge DOUBLE PRECISION,
      required_edge DOUBLE PRECISION,

      price_quality TEXT,
      resolution_confidence DOUBLE PRECISION,

      status TEXT NOT NULL DEFAULT 'OPEN',
      settled_at TIMESTAMPTZ,
      outcome_won BOOLEAN,
      realized_pnl_usd DOUBLE PRECISION,

      signal JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes JSONB NOT NULL DEFAULT '[]'::jsonb
    )
  `;

  /**
   * These ALTERs make the migration tolerant if a partial paper_trades
   * table was manually created earlier.
   */
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS run_id TEXT`;
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS market_slug TEXT`;
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS market_title TEXT`;
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS model_probability DOUBLE PRECISION`;
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS market_probability DOUBLE PRECISION`;
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS best_edge DOUBLE PRECISION`;
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS required_edge DOUBLE PRECISION`;
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS price_quality TEXT`;
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS resolution_confidence DOUBLE PRECISION`;
  await sql`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS notes JSONB NOT NULL DEFAULT '[]'::jsonb`;

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'paper_trades_signal_snapshot_id_key'
      ) THEN
        ALTER TABLE paper_trades
        ADD CONSTRAINT paper_trades_signal_snapshot_id_key UNIQUE (signal_snapshot_id);
      END IF;
    END $$;
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS paper_trades_created_at_idx
    ON paper_trades (created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS paper_trades_status_idx
    ON paper_trades (status)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS paper_trades_snapshot_key_idx
    ON paper_trades (snapshot_key)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS paper_trades_signal_snapshot_id_idx
    ON paper_trades (signal_snapshot_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS paper_trades_target_date_idx
    ON paper_trades (target_date)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS paper_trades_hkt_date_idx
    ON paper_trades (hkt_date)
  `;
}

async function ensurePaperTradingTable() {
  if (!paperTradingInitPromise) {
    paperTradingInitPromise = initPaperTradingDatabase().catch((error) => {
      paperTradingInitPromise = null;
      throw error;
    });
  }

  return paperTradingInitPromise;
}

export async function getPaperTradingRiskState(
  config = getPaperTradingConfig()
): Promise<PaperTradingRiskState> {
  const sql = getSql();

  if (!sql) {
    return emptyRiskState(config);
  }

  await ensurePaperTradingTable();

  const dailyRows = normalizeRows<{
    daily_notional_usd: number | string | null;
    daily_trade_count: number | string | null;
  }>(await sql`
    SELECT
      COALESCE(SUM(notional_usd), 0) AS daily_notional_usd,
      COUNT(*) AS daily_trade_count
    FROM paper_trades
    WHERE (created_at AT TIME ZONE 'Asia/Hong_Kong')::date =
          (NOW() AT TIME ZONE 'Asia/Hong_Kong')::date
  `);

  const openRows = normalizeRows<{
    open_trade_count: number | string | null;
  }>(await sql`
    SELECT COUNT(*) AS open_trade_count
    FROM paper_trades
    WHERE status = 'OPEN'
  `);

  const dailyNotionalUsedUsd = roundUsd(
    toNumberOrNull(dailyRows[0]?.daily_notional_usd) ?? 0
  );

  const dailyTradeCount = toNumberOrNull(dailyRows[0]?.daily_trade_count) ?? 0;
  const openTradeCount = toNumberOrNull(openRows[0]?.open_trade_count) ?? 0;

  return {
    hktDate: getCurrentHktDateString(),
    dailyNotionalUsedUsd,
    dailyNotionalRemainingUsd: roundUsd(
      Math.max(0, config.maxDailyNotionalUsd - dailyNotionalUsedUsd)
    ),
    dailyTradeCount,
    openTradeCount,
    openTradeSlotsRemaining: Math.max(
      0,
      config.maxOpenTrades - openTradeCount
    )
  };
}

async function getExistingSignalSnapshotIdsForSnapshot(
  snapshotKey: string
): Promise<Set<number>> {
  const sql = getSql();

  if (!sql) {
    return new Set();
  }

  await ensurePaperTradingTable();

  const rows = normalizeRows<{
    signal_snapshot_id: number | string | bigint | null;
  }>(await sql`
    SELECT signal_snapshot_id
    FROM paper_trades
    WHERE snapshot_key = ${snapshotKey}
      AND signal_snapshot_id IS NOT NULL
  `);

  return new Set(
    rows
      .map((row) => toNumberOrNull(row.signal_snapshot_id))
      .filter((value): value is number => value !== null)
  );
}

function evaluatePaperTradeCandidate(params: {
  row: SignalSnapshotRow;
  config: PaperTradingConfig;
  existingSignalSnapshotIds: Set<number>;
}):
  | {
      ok: true;
      entryPrice: number;
      stakeFraction: number;
    }
  | {
      ok: false;
      skip: PaperTradeSkip;
    } {
  const { row, config, existingSignalSnapshotIds } = params;

  if (!Number.isFinite(row.id) || row.id <= 0) {
    return {
      ok: false,
      skip: makeSkip(row, "INVALID_SIGNAL_SNAPSHOT_ID")
    };
  }

  if (existingSignalSnapshotIds.has(row.id)) {
    return {
      ok: false,
      skip: makeSkip(row, "DUPLICATE_SIGNAL_SNAPSHOT")
    };
  }

  if (row.settledAt || row.outcomeWon !== null) {
    return {
      ok: false,
      skip: makeSkip(row, "SIGNAL_ALREADY_SETTLED")
    };
  }

  if (!row.shouldTrade) {
    return {
      ok: false,
      skip: makeSkip(row, "SHOULD_TRADE_FALSE")
    };
  }

  if (row.side !== "BUY_YES" && row.side !== "BUY_NO") {
    return {
      ok: false,
      skip: makeSkip(row, "UNSUPPORTED_SIDE", row.side)
    };
  }

  const entryPrice = getEntryPrice(row);

  if (
    entryPrice === null ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    entryPrice >= 1
  ) {
    return {
      ok: false,
      skip: makeSkip(
        row,
        "INVALID_ENTRY_PRICE",
        entryPrice === null ? "null" : String(entryPrice)
      )
    };
  }

  if (config.allowedPriceQualities.length > 0) {
    const priceQuality = row.priceQuality?.trim().toUpperCase() ?? "";

    if (!priceQuality || !config.allowedPriceQualities.includes(priceQuality)) {
      return {
        ok: false,
        skip: makeSkip(
          row,
          "PRICE_QUALITY_NOT_ALLOWED",
          row.priceQuality ?? "null"
        )
      };
    }
  }

  if (config.allowedStrengths.length > 0) {
    const strength = row.strength.trim().toUpperCase();

    if (!strength || !config.allowedStrengths.includes(strength)) {
      return {
        ok: false,
        skip: makeSkip(row, "STRENGTH_NOT_ALLOWED", row.strength)
      };
    }
  }

  if (config.minResolutionConfidence > 0) {
    if (row.resolutionConfidence === null) {
      return {
        ok: false,
        skip: makeSkip(row, "MISSING_RESOLUTION_CONFIDENCE")
      };
    }

    if (row.resolutionConfidence < config.minResolutionConfidence) {
      return {
        ok: false,
        skip: makeSkip(
          row,
          "LOW_RESOLUTION_CONFIDENCE",
          String(row.resolutionConfidence)
        )
      };
    }
  }

  if (
    config.maxPriceAgeSeconds !== null &&
    row.priceAgeSeconds !== null &&
    row.priceAgeSeconds > config.maxPriceAgeSeconds
  ) {
    return {
      ok: false,
      skip: makeSkip(row, "PRICE_TOO_OLD", String(row.priceAgeSeconds))
    };
  }

  if (config.minBestEdge > 0) {
    if (row.bestEdge === null) {
      return {
        ok: false,
        skip: makeSkip(row, "MISSING_BEST_EDGE")
      };
    }

    if (row.bestEdge < config.minBestEdge) {
      return {
        ok: false,
        skip: makeSkip(row, "EDGE_TOO_SMALL", String(row.bestEdge))
      };
    }
  }

  if (
    row.recommendedStakeFraction === null ||
    !Number.isFinite(row.recommendedStakeFraction) ||
    row.recommendedStakeFraction <= 0
  ) {
    return {
      ok: false,
      skip: makeSkip(row, "INVALID_RECOMMENDED_STAKE_FRACTION")
    };
  }

  if (row.recommendedStakeFraction < config.minStakeFraction) {
    return {
      ok: false,
      skip: makeSkip(
        row,
        "STAKE_FRACTION_TOO_SMALL",
        String(row.recommendedStakeFraction)
      )
    };
  }

  const stakeFraction = Math.min(
    row.recommendedStakeFraction,
    config.maxStakeFraction
  );

  return {
    ok: true,
    entryPrice,
    stakeFraction
  };
}

function buildPaperTradePlan(params: {
  row: SignalSnapshotRow;
  entryPrice: number;
  stakeFraction: number;
  notionalUsd: number;
}): PaperTradePlan {
  const { row, entryPrice, stakeFraction, notionalUsd } = params;

  return {
    signalSnapshotId: row.id,
    snapshotKey: row.snapshotKey,
    outcomeName: row.outcomeName,
    side: row.side,
    strength: row.strength,
    entryPrice: roundNumber(entryPrice, 6),
    stakeFraction: roundNumber(stakeFraction, 6),
    notionalUsd: roundUsd(notionalUsd),
    shares: roundNumber(notionalUsd / entryPrice, 6),
    bestEdge: row.bestEdge,
    priceQuality: row.priceQuality,
    resolutionConfidence: row.resolutionConfidence
  };
}

async function insertPaperTrade(params: {
  runId: string;
  row: SignalSnapshotRow;
  plan: PaperTradePlan;
  config: PaperTradingConfig;
}): Promise<PaperTradeRow | null> {
  const sql = getSql();

  if (!sql) {
    return null;
  }

  await ensurePaperTradingTable();

  const { runId, row, plan, config } = params;

  const insertRows = normalizeRows<PaperTradeDbRow>(await sql`
    INSERT INTO paper_trades (
      run_id,

      signal_snapshot_id,
      snapshot_key,

      hkt_date,
      target_date,

      market_slug,
      market_title,

      outcome_name,
      side,
      strength,

      entry_price,
      stake_fraction,
      bankroll_usd,
      notional_usd,
      shares,

      model_probability,
      market_probability,
      best_edge,
      required_edge,

      price_quality,
      resolution_confidence,

      status,
      signal,
      notes
    )
    VALUES (
      ${runId},

      ${row.id},
      ${row.snapshotKey},

      ${row.hktDate},
      ${row.targetDate},

      ${row.marketSlug},
      ${row.marketTitle},

      ${row.outcomeName},
      ${row.side},
      ${row.strength},

      ${plan.entryPrice},
      ${plan.stakeFraction},
      ${config.bankrollUsd},
      ${plan.notionalUsd},
      ${plan.shares},

      ${row.modelProbability},
      ${row.marketProbability},
      ${row.bestEdge},
      ${row.requiredEdge},

      ${row.priceQuality},
      ${row.resolutionConfidence},

      ${"OPEN"},
      ${JSON.stringify(row.signal)}::jsonb,
      ${JSON.stringify([
        {
          type: "AUTO_PAPER_TRADING",
          runId,
          createdAt: new Date().toISOString()
        }
      ])}::jsonb
    )
    ON CONFLICT (signal_snapshot_id) DO NOTHING
    RETURNING *
  `);

  const inserted = insertRows[0];

  return inserted ? mapPaperTradeRow(inserted) : null;
}

export async function runAutoPaperTrading(
  options: PaperTradingRunOptions = {}
): Promise<PaperTradingRunResult> {
  const runId = randomUUID();
  const dryRun = Boolean(options.dryRun);
  const config = getPaperTradingConfig(options.configOverrides);

  const baseResult = {
    databaseEnabled: isDatabaseEnabled(),
    runId,
    dryRun,
    snapshotKey: null,
    snapshotRowCount: 0,
    evaluatedCount: 0,
    plannedCount: 0,
    insertedCount: 0,
    skippedCount: 0,
    plannedTrades: [] as PaperTradePlan[],
    createdTrades: [] as PaperTradeRow[],
    skipped: [] as PaperTradeSkip[],
    config,
    riskBefore: emptyRiskState(config),
    riskAfter: emptyRiskState(config)
  };

  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      reason: "DATABASE_URL is not configured.",
      ...baseResult
    };
  }

  if (!config.enabled && !options.force) {
    return {
      ok: false,
      reason:
        "Paper trading is disabled. Set PAPER_TRADING_ENABLED=true or call the admin run endpoint with force=true.",
      ...baseResult
    };
  }

  await ensurePaperTradingTable();

  const limit = safeLimit(options.limit, 1000);
  const snapshots = await getSignalSnapshots(limit);

  if (snapshots.length === 0) {
    const risk = await getPaperTradingRiskState(config);

    return {
      ok: false,
      reason: "No signal snapshots found. Run and save a forecast first.",
      ...baseResult,
      riskBefore: risk,
      riskAfter: risk
    };
  }

  const selectedSnapshotKey =
    toStringOrNull(options.snapshotKey) ?? snapshots[0]?.snapshotKey ?? null;

  if (!selectedSnapshotKey) {
    const risk = await getPaperTradingRiskState(config);

    return {
      ok: false,
      reason: "Unable to determine snapshotKey.",
      ...baseResult,
      riskBefore: risk,
      riskAfter: risk
    };
  }

  const snapshotRows = snapshots.filter(
    (row) => row.snapshotKey === selectedSnapshotKey
  );

  if (snapshotRows.length === 0) {
    const risk = await getPaperTradingRiskState(config);

    return {
      ok: false,
      reason:
        "Requested snapshotKey was not found in the fetched snapshot window. Increase limit or check snapshotKey.",
      ...baseResult,
      snapshotKey: selectedSnapshotKey,
      riskBefore: risk,
      riskAfter: risk
    };
  }

  const riskBefore = await getPaperTradingRiskState(config);
  const existingSignalSnapshotIds =
    await getExistingSignalSnapshotIdsForSnapshot(selectedSnapshotKey);

  let remainingDailyNotionalUsd = riskBefore.dailyNotionalRemainingUsd;
  let remainingOpenSlots = riskBefore.openTradeSlotsRemaining;

  const plannedTrades: PaperTradePlan[] = [];
  const createdTrades: PaperTradeRow[] = [];
  const skipped: PaperTradeSkip[] = [];

  /**
   * Allocate scarce paper risk budget to highest-edge signals first.
   */
  const sortedRows = [...snapshotRows].sort((a, b) => {
    const aEdge = a.bestEdge ?? Number.NEGATIVE_INFINITY;
    const bEdge = b.bestEdge ?? Number.NEGATIVE_INFINITY;

    if (bEdge !== aEdge) {
      return bEdge - aEdge;
    }

    return (b.recommendedStakeFraction ?? 0) - (a.recommendedStakeFraction ?? 0);
  });

  for (const row of sortedRows) {
    const evaluation = evaluatePaperTradeCandidate({
      row,
      config,
      existingSignalSnapshotIds
    });

    if (!evaluation.ok) {
      skipped.push(evaluation.skip);
      continue;
    }

    if (remainingOpenSlots <= 0) {
      skipped.push(
        makeSkip(
          row,
          "MAX_OPEN_TRADES_REACHED",
          String(config.maxOpenTrades)
        )
      );
      continue;
    }

    if (remainingDailyNotionalUsd <= 0) {
      skipped.push(
        makeSkip(
          row,
          "MAX_DAILY_NOTIONAL_REACHED",
          String(config.maxDailyNotionalUsd)
        )
      );
      continue;
    }

    const rawNotionalUsd = config.bankrollUsd * evaluation.stakeFraction;
    const cappedNotionalUsd = Math.min(
      rawNotionalUsd,
      config.maxNotionalUsdPerTrade,
      remainingDailyNotionalUsd
    );

    const notionalUsd = roundUsd(cappedNotionalUsd);

    if (notionalUsd < config.minNotionalUsd) {
      skipped.push(
        makeSkip(
          row,
          "MIN_NOTIONAL_NOT_MET",
          `notional=${notionalUsd}, min=${config.minNotionalUsd}`
        )
      );
      continue;
    }

    const plan = buildPaperTradePlan({
      row,
      entryPrice: evaluation.entryPrice,
      stakeFraction: evaluation.stakeFraction,
      notionalUsd
    });

    if (dryRun) {
      plannedTrades.push(plan);
      remainingDailyNotionalUsd = roundUsd(
        remainingDailyNotionalUsd - notionalUsd
      );
      remainingOpenSlots -= 1;
      continue;
    }

    const inserted = await insertPaperTrade({
      runId,
      row,
      plan,
      config
    });

    if (!inserted) {
      skipped.push(makeSkip(row, "DUPLICATE_RACE_OR_INSERT_SKIPPED"));
      existingSignalSnapshotIds.add(row.id);
      continue;
    }

    plannedTrades.push(plan);
    createdTrades.push(inserted);
    existingSignalSnapshotIds.add(row.id);

    remainingDailyNotionalUsd = roundUsd(
      remainingDailyNotionalUsd - notionalUsd
    );
    remainingOpenSlots -= 1;
  }

  const riskAfter = dryRun
    ? buildRiskStateAfterPlans(riskBefore, config, plannedTrades)
    : await getPaperTradingRiskState(config);

  return {
    ok: true,
    reason: null,

    databaseEnabled: true,
    runId,
    dryRun,

    snapshotKey: selectedSnapshotKey,
    snapshotRowCount: snapshotRows.length,
    evaluatedCount: sortedRows.length,

    plannedCount: plannedTrades.length,
    insertedCount: createdTrades.length,
    skippedCount: skipped.length,

    plannedTrades,
    createdTrades,
    skipped,

    config,
    riskBefore,
    riskAfter
  };
}

export async function getPaperTrades(
  params: {
    limit?: number;
    status?: string | null;
    snapshotKey?: string | null;
  } = {}
): Promise<PaperTradeRow[]> {
  const sql = getSql();

  if (!sql) {
    return [];
  }

  await ensurePaperTradingTable();

  const limit = safeLimit(params.limit, 200);
  const status = toStringOrNull(params.status)?.toUpperCase() ?? null;
  const snapshotKey = toStringOrNull(params.snapshotKey);

  if (status && snapshotKey) {
    const rows = normalizeRows<PaperTradeDbRow>(await sql`
      SELECT *
      FROM paper_trades
      WHERE status = ${status}
        AND snapshot_key = ${snapshotKey}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    return rows.map(mapPaperTradeRow);
  }

  if (status) {
    const rows = normalizeRows<PaperTradeDbRow>(await sql`
      SELECT *
      FROM paper_trades
      WHERE status = ${status}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    return rows.map(mapPaperTradeRow);
  }

  if (snapshotKey) {
    const rows = normalizeRows<PaperTradeDbRow>(await sql`
      SELECT *
      FROM paper_trades
      WHERE snapshot_key = ${snapshotKey}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    return rows.map(mapPaperTradeRow);
  }

  const rows = normalizeRows<PaperTradeDbRow>(await sql`
    SELECT *
    FROM paper_trades
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  return rows.map(mapPaperTradeRow);
}

export async function getPaperTradingSummary(
  config = getPaperTradingConfig()
): Promise<PaperTradingSummary> {
  const sql = getSql();

  if (!sql) {
    return {
      hktDate: getCurrentHktDateString(),

      totalTrades: 0,
      openTrades: 0,
      settledTrades: 0,
      cancelledTrades: 0,

      totalNotionalUsd: 0,
      openNotionalUsd: 0,
      settledNotionalUsd: 0,

      realizedPnlUsd: 0,
      estimatedBankrollUsd: config.bankrollUsd,
      worstCaseOpenLossUsd: 0
    };
  }

  await ensurePaperTradingTable();

  const rows = normalizeRows<{
    total_trades: number | string | null;
    open_trades: number | string | null;
    settled_trades: number | string | null;
    cancelled_trades: number | string | null;

    total_notional_usd: number | string | null;
    open_notional_usd: number | string | null;
    settled_notional_usd: number | string | null;

    realized_pnl_usd: number | string | null;
  }>(await sql`
    SELECT
      COUNT(*) AS total_trades,
      COUNT(*) FILTER (WHERE status = 'OPEN') AS open_trades,
      COUNT(*) FILTER (WHERE status = 'SETTLED') AS settled_trades,
      COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled_trades,

      COALESCE(SUM(notional_usd), 0) AS total_notional_usd,
      COALESCE(SUM(notional_usd) FILTER (WHERE status = 'OPEN'), 0) AS open_notional_usd,
      COALESCE(SUM(notional_usd) FILTER (WHERE status = 'SETTLED'), 0) AS settled_notional_usd,

      COALESCE(SUM(realized_pnl_usd) FILTER (WHERE status = 'SETTLED'), 0) AS realized_pnl_usd
    FROM paper_trades
  `);

  const row = rows[0];

  const realizedPnlUsd = roundUsd(toNumberOrNull(row?.realized_pnl_usd) ?? 0);
  const openNotionalUsd = roundUsd(
    toNumberOrNull(row?.open_notional_usd) ?? 0
  );

  return {
    hktDate: getCurrentHktDateString(),

    totalTrades: toNumberOrNull(row?.total_trades) ?? 0,
    openTrades: toNumberOrNull(row?.open_trades) ?? 0,
    settledTrades: toNumberOrNull(row?.settled_trades) ?? 0,
    cancelledTrades: toNumberOrNull(row?.cancelled_trades) ?? 0,

    totalNotionalUsd: roundUsd(toNumberOrNull(row?.total_notional_usd) ?? 0),
    openNotionalUsd,
    settledNotionalUsd: roundUsd(
      toNumberOrNull(row?.settled_notional_usd) ?? 0
    ),

    realizedPnlUsd,
    estimatedBankrollUsd: roundUsd(config.bankrollUsd + realizedPnlUsd),
    worstCaseOpenLossUsd: openNotionalUsd
  };
}

async function settlePaperTradesWithQuery(
  kind: "ALL" | "SNAPSHOT_KEY" | "TARGET_DATE" | "HKT_DATE" | "TARGET_OR_HKT",
  filters: {
    snapshotKey: string | null;
    targetDate: string | null;
    hktDate: string | null;
  }
): Promise<PaperTradeRow[]> {
  const sql = getSql();

  if (!sql) {
    return [];
  }

  await ensurePaperTradingTable();

  if (kind === "SNAPSHOT_KEY" && filters.snapshotKey) {
    const rows = normalizeRows<PaperTradeDbRow>(await sql`
      UPDATE paper_trades AS p
      SET
        status = 'SETTLED',
        settled_at = COALESCE(s.settled_at, NOW()),
        outcome_won = s.outcome_won,
        realized_pnl_usd = p.shares * s.realized_pnl_per_share
      FROM signal_snapshots AS s
      WHERE p.signal_snapshot_id = s.id
        AND p.status = 'OPEN'
        AND p.snapshot_key = ${filters.snapshotKey}
        AND s.outcome_won IS NOT NULL
        AND s.realized_pnl_per_share IS NOT NULL
      RETURNING p.*
    `);

    return rows.map(mapPaperTradeRow);
  }

  if (kind === "TARGET_OR_HKT" && filters.targetDate && filters.hktDate) {
    const rows = normalizeRows<PaperTradeDbRow>(await sql`
      UPDATE paper_trades AS p
      SET
        status = 'SETTLED',
        settled_at = COALESCE(s.settled_at, NOW()),
        outcome_won = s.outcome_won,
        realized_pnl_usd = p.shares * s.realized_pnl_per_share
      FROM signal_snapshots AS s
      WHERE p.signal_snapshot_id = s.id
        AND p.status = 'OPEN'
        AND (
          p.target_date = ${filters.targetDate}
          OR s.target_date = ${filters.targetDate}
          OR p.hkt_date = ${filters.hktDate}
          OR s.hkt_date = ${filters.hktDate}
        )
        AND s.outcome_won IS NOT NULL
        AND s.realized_pnl_per_share IS NOT NULL
      RETURNING p.*
    `);

    return rows.map(mapPaperTradeRow);
  }

  if (kind === "TARGET_DATE" && filters.targetDate) {
    const rows = normalizeRows<PaperTradeDbRow>(await sql`
      UPDATE paper_trades AS p
      SET
        status = 'SETTLED',
        settled_at = COALESCE(s.settled_at, NOW()),
        outcome_won = s.outcome_won,
        realized_pnl_usd = p.shares * s.realized_pnl_per_share
      FROM signal_snapshots AS s
      WHERE p.signal_snapshot_id = s.id
        AND p.status = 'OPEN'
        AND (
          p.target_date = ${filters.targetDate}
          OR s.target_date = ${filters.targetDate}
        )
        AND s.outcome_won IS NOT NULL
        AND s.realized_pnl_per_share IS NOT NULL
      RETURNING p.*
    `);

    return rows.map(mapPaperTradeRow);
  }

  if (kind === "HKT_DATE" && filters.hktDate) {
    const rows = normalizeRows<PaperTradeDbRow>(await sql`
      UPDATE paper_trades AS p
      SET
        status = 'SETTLED',
        settled_at = COALESCE(s.settled_at, NOW()),
        outcome_won = s.outcome_won,
        realized_pnl_usd = p.shares * s.realized_pnl_per_share
      FROM signal_snapshots AS s
      WHERE p.signal_snapshot_id = s.id
        AND p.status = 'OPEN'
        AND (
          p.hkt_date = ${filters.hktDate}
          OR s.hkt_date = ${filters.hktDate}
        )
        AND s.outcome_won IS NOT NULL
        AND s.realized_pnl_per_share IS NOT NULL
      RETURNING p.*
    `);

    return rows.map(mapPaperTradeRow);
  }

  const rows = normalizeRows<PaperTradeDbRow>(await sql`
    UPDATE paper_trades AS p
    SET
      status = 'SETTLED',
      settled_at = COALESCE(s.settled_at, NOW()),
      outcome_won = s.outcome_won,
      realized_pnl_usd = p.shares * s.realized_pnl_per_share
    FROM signal_snapshots AS s
    WHERE p.signal_snapshot_id = s.id
      AND p.status = 'OPEN'
      AND s.outcome_won IS NOT NULL
      AND s.realized_pnl_per_share IS NOT NULL
    RETURNING p.*
  `);

  return rows.map(mapPaperTradeRow);
}

export async function settlePaperTrades(
  options: PaperTradeSettleOptions = {}
): Promise<PaperTradeSettleResult> {
  if (!isDatabaseEnabled()) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const snapshotKey = toStringOrNull(options.snapshotKey);
  const targetDate = toStringOrNull(options.targetDate);
  const hktDate = toStringOrNull(options.hktDate);

  let kind: "ALL" | "SNAPSHOT_KEY" | "TARGET_DATE" | "HKT_DATE" | "TARGET_OR_HKT" =
    "ALL";

  if (snapshotKey) {
    kind = "SNAPSHOT_KEY";
  } else if (targetDate && hktDate) {
    kind = "TARGET_OR_HKT";
  } else if (targetDate) {
    kind = "TARGET_DATE";
  } else if (hktDate) {
    kind = "HKT_DATE";
  }

  const trades = await settlePaperTradesWithQuery(kind, {
    snapshotKey,
    targetDate,
    hktDate
  });

  return {
    settledCount: trades.length,
    totalRealizedPnlUsd: sum(trades.map((trade) => trade.realizedPnlUsd)),
    filters: {
      snapshotKey,
      targetDate,
      hktDate
    },
    trades
  };
}
