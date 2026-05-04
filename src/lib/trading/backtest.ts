import type { SignalSnapshotRow } from "@/lib/db";

export type ForecastResidualCalibrationReport = {
  count: number;
  meanResidualC: number | null;
  meanAbsoluteErrorC: number | null;
  rmseC: number | null;
  byTimeBand: Record<string, {
    count: number;
    meanResidualC: number | null;
    meanAbsoluteErrorC: number | null;
  }>;
  byRainCoolingBucket: Record<string, {
    count: number;
    meanResidualC: number | null;
  }>;
  bySolarHeatingBucket: Record<string, {
    count: number;
    meanResidualC: number | null;
  }>;
};

export type TradeGroupMetrics = {
  tradeCount: number;
  settledTradeCount: number;
  unresolvedTradeCount: number;
  wins: number;
  losses: number;
  hitRate: number | null;
  totalPnlPerShare: number;
  averagePnlPerTrade: number | null;
  totalEntryCost: number;
  roiOnEntryCost: number | null;
};

export type BacktestReport = {
  snapshotCount: number;
  signalCount: number;
  tradeCount: number;
  settledTradeCount: number;
  unresolvedTradeCount: number;

  wins: number;
  losses: number;
  hitRate: number | null;

  totalPnlPerShare: number;
  averagePnlPerTrade: number | null;
  totalEntryCost: number;
  roiOnEntryCost: number | null;

  averageModelProbability: number | null;
  averageMarketProbability: number | null;
  averageBestEdge: number | null;
  averageRequiredEdge: number | null;

  bySide: Record<string, TradeGroupMetrics>;
  byStrength: Record<string, TradeGroupMetrics>;
};

export type CalibrationBucket = {
  bucket: string;
  lower: number;
  upper: number;
  count: number;
  averageForecastProbability: number | null;
  observedFrequency: number | null;
  calibrationError: number | null;
  brierScore: number | null;
};

export type CalibrationReport = {
  resolvedCount: number;
  bucketSize: number;
  weightedBrierScore: number | null;
  expectedCalibrationError: number | null;
  buckets: CalibrationBucket[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundNumber(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(isFiniteNumber);

  if (valid.length === 0) {
    return null;
  }

  return roundNumber(
    valid.reduce((sum, value) => sum + value, 0) / valid.length
  );
}

function sum(values: Array<number | null | undefined>): number {
  return roundNumber(
    values
      .filter(isFiniteNumber)
      .reduce((total, value) => total + value, 0)
  );
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

function didTradeWin(row: SignalSnapshotRow): boolean | null {
  if (row.outcomeWon === null) {
    return null;
  }

  if (row.side === "BUY_YES") {
    return row.outcomeWon;
  }

  if (row.side === "BUY_NO") {
    return !row.outcomeWon;
  }

  return null;
}

function isTrade(row: SignalSnapshotRow): boolean {
  return row.shouldTrade && row.side !== "NO_TRADE";
}

function summarizeTradeRows(rows: SignalSnapshotRow[]): TradeGroupMetrics {
  const tradeRows = rows.filter(isTrade);
  const settledTradeRows = tradeRows.filter(
    (row) => didTradeWin(row) !== null && row.realizedPnlPerShare !== null
  );

  const wins = settledTradeRows.filter((row) => didTradeWin(row) === true).length;
  const losses = settledTradeRows.filter(
    (row) => didTradeWin(row) === false
  ).length;

  const totalPnlPerShare = sum(
    settledTradeRows.map((row) => row.realizedPnlPerShare)
  );

  const totalEntryCost = sum(settledTradeRows.map(getEntryPrice));

  return {
    tradeCount: tradeRows.length,
    settledTradeCount: settledTradeRows.length,
    unresolvedTradeCount: tradeRows.length - settledTradeRows.length,
    wins,
    losses,
    hitRate:
      settledTradeRows.length > 0
        ? roundNumber(wins / settledTradeRows.length)
        : null,
    totalPnlPerShare,
    averagePnlPerTrade:
      settledTradeRows.length > 0
        ? roundNumber(totalPnlPerShare / settledTradeRows.length)
        : null,
    totalEntryCost,
    roiOnEntryCost:
      totalEntryCost > 0 ? roundNumber(totalPnlPerShare / totalEntryCost) : null
  };
}

function groupBy(
  rows: SignalSnapshotRow[],
  keyFn: (row: SignalSnapshotRow) => string
): Record<string, SignalSnapshotRow[]> {
  return rows.reduce<Record<string, SignalSnapshotRow[]>>((groups, row) => {
    const key = keyFn(row);

    groups[key] ??= [];
    groups[key].push(row);

    return groups;
  }, {});
}

export function buildBacktestReport(rows: SignalSnapshotRow[]): BacktestReport {
  const signalRows = rows;
  const tradeRows = signalRows.filter(isTrade);

  const settledTradeRows = tradeRows.filter(
    (row) => didTradeWin(row) !== null && row.realizedPnlPerShare !== null
  );

  const overall = summarizeTradeRows(signalRows);

  const bySideGroups = groupBy(tradeRows, (row) => row.side);
  const byStrengthGroups = groupBy(tradeRows, (row) => row.strength);

  const bySide = Object.fromEntries(
    Object.entries(bySideGroups).map(([side, groupRows]) => [
      side,
      summarizeTradeRows(groupRows)
    ])
  );

  const byStrength = Object.fromEntries(
    Object.entries(byStrengthGroups).map(([strength, groupRows]) => [
      strength,
      summarizeTradeRows(groupRows)
    ])
  );

  return {
    snapshotCount: new Set(signalRows.map((row) => row.snapshotKey)).size,
    signalCount: signalRows.length,
    tradeCount: overall.tradeCount,
    settledTradeCount: overall.settledTradeCount,
    unresolvedTradeCount: overall.unresolvedTradeCount,

    wins: overall.wins,
    losses: overall.losses,
    hitRate: overall.hitRate,

    totalPnlPerShare: overall.totalPnlPerShare,
    averagePnlPerTrade: overall.averagePnlPerTrade,
    totalEntryCost: overall.totalEntryCost,
    roiOnEntryCost: overall.roiOnEntryCost,

    averageModelProbability: average(
      settledTradeRows.map((row) => row.modelProbability)
    ),
    averageMarketProbability: average(
      settledTradeRows.map((row) => row.marketProbability)
    ),
    averageBestEdge: average(settledTradeRows.map((row) => row.bestEdge)),
    averageRequiredEdge: average(
      settledTradeRows.map((row) => row.requiredEdge)
    ),

    bySide,
    byStrength
  };
}

function formatBucketLabel(lower: number, upper: number, isLast: boolean) {
  const lowerPct = Math.round(lower * 100);
  const upperPct = Math.round(upper * 100);

  if (isLast) {
    return `${lowerPct}-${upperPct}%`;
  }

  return `${lowerPct}-<${upperPct}%`;
}

/**
 * Probability calibration:
 *
 * Uses modelProbability as forecast P(outcome wins).
 * Uses outcomeWon as observed result.
 */
export function buildCalibrationReport(
  rows: SignalSnapshotRow[],
  bucketSize = 0.1
): CalibrationReport {
  const safeBucketSize =
    Number.isFinite(bucketSize) && bucketSize > 0 && bucketSize <= 1
      ? bucketSize
      : 0.1;

  const bucketCount = Math.ceil(1 / safeBucketSize);

  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const lower = roundNumber(index * safeBucketSize, 6);
    const upper =
      index === bucketCount - 1
        ? 1
        : roundNumber((index + 1) * safeBucketSize, 6);

    return {
      lower,
      upper,
      rows: [] as SignalSnapshotRow[]
    };
  });

  const resolvedRows = rows.filter(
    (row) =>
      isFiniteNumber(row.modelProbability) &&
      row.modelProbability >= 0 &&
      row.modelProbability <= 1 &&
      row.outcomeWon !== null
  );

  for (const row of resolvedRows) {
    const probability = row.modelProbability ?? 0;
    const index = Math.min(
      bucketCount - 1,
      Math.floor(probability / safeBucketSize)
    );

    buckets[index]?.rows.push(row);
  }

  let weightedBrierNumerator = 0;
  let eceNumerator = 0;

  const outputBuckets: CalibrationBucket[] = buckets.map((bucket, index) => {
    const count = bucket.rows.length;
    const isLast = index === buckets.length - 1;

    if (count === 0) {
      return {
        bucket: formatBucketLabel(bucket.lower, bucket.upper, isLast),
        lower: bucket.lower,
        upper: bucket.upper,
        count: 0,
        averageForecastProbability: null,
        observedFrequency: null,
        calibrationError: null,
        brierScore: null
      };
    }

    const averageForecastProbability =
      bucket.rows.reduce(
        (total, row) => total + (row.modelProbability ?? 0),
        0
      ) / count;

    const observedFrequency =
      bucket.rows.filter((row) => row.outcomeWon === true).length / count;

    const brierScore =
      bucket.rows.reduce((total, row) => {
        const p = row.modelProbability ?? 0;
        const y = row.outcomeWon ? 1 : 0;
        return total + (p - y) ** 2;
      }, 0) / count;

    const calibrationError = Math.abs(
      averageForecastProbability - observedFrequency
    );

    weightedBrierNumerator += brierScore * count;
    eceNumerator += calibrationError * count;

    return {
      bucket: formatBucketLabel(bucket.lower, bucket.upper, isLast),
      lower: bucket.lower,
      upper: bucket.upper,
      count,
      averageForecastProbability: roundNumber(averageForecastProbability),
      observedFrequency: roundNumber(observedFrequency),
      calibrationError: roundNumber(calibrationError),
      brierScore: roundNumber(brierScore)
    };
  });

  return {
    resolvedCount: resolvedRows.length,
    bucketSize: safeBucketSize,
    weightedBrierScore:
      resolvedRows.length > 0
        ? roundNumber(weightedBrierNumerator / resolvedRows.length)
        : null,
    expectedCalibrationError:
      resolvedRows.length > 0
        ? roundNumber(eceNumerator / resolvedRows.length)
        : null,
    buckets: outputBuckets
  };
}
