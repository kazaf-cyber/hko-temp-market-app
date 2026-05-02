"use client";

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";

type PaperTradeStatus = "OPEN" | "SETTLED" | "CANCELLED";

type DateBasis = "hktDate" | "targetDate" | "settledAt" | "createdAt";

type LoadingKey = "load" | null;

type Tone = "default" | "good" | "bad" | "warn" | "muted";

type PaperTradeRow = {
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

type PaperTradesResponse = {
  databaseEnabled: boolean;
  count: number;
  trades: PaperTradeRow[];
};

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error: string | null;
  status: number;
};

type MutableGroup = {
  key: string;

  totalTrades: number;
  openTrades: number;
  settledTrades: number;

  wins: number;
  losses: number;
  pushes: number;

  realizedPnlUsd: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  notionalUsd: number;

  edgeSum: number;
  edgeCount: number;
};

type BreakdownRow = {
  key: string;

  totalTrades: number;
  openTrades: number;
  settledTrades: number;

  wins: number;
  losses: number;
  pushes: number;

  realizedPnlUsd: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  notionalUsd: number;

  winRate: number | null;
  roi: number | null;
  avgEdge: number | null;
  avgPnlUsd: number | null;
  profitFactor: number | null;
};

type DailyStat = {
  date: string;

  settledTrades: number;
  wins: number;
  losses: number;
  pushes: number;

  notionalUsd: number;
  realizedPnlUsd: number;
  cumulativePnlUsd: number;
  drawdownUsd: number;

  winRate: number | null;
  roi: number | null;
  avgEdge: number | null;
};

type CalibrationRow = {
  key: string;
  lower: number;
  upper: number;

  count: number;
  avgPredicted: number;
  actualWinRate: number;
  gap: number;
  brierScore: number;

  realizedPnlUsd: number;
  notionalUsd: number;
  roi: number | null;
};

type SummaryMetrics = BreakdownRow & {
  openNotionalUsd: number;
  totalNotionalUsd: number;

  maxDrawdownUsd: number;
  maxDrawdownPct: number | null;

  brierScore: number | null;
  avgModelProbability: number | null;
  avgMarketProbability: number | null;
  avgBestEdge: number | null;
};

type AnalyticsResult = {
  filteredTrades: PaperTradeRow[];
  settledTrades: PaperTradeRow[];

  summary: SummaryMetrics;
  dailyStats: DailyStat[];

  bySide: BreakdownRow[];
  byStrength: BreakdownRow[];
  byPriceQuality: BreakdownRow[];
  byEdgeBucket: BreakdownRow[];
  bySnapshotKey: BreakdownRow[];

  calibration: CalibrationRow[];

  topWinners: PaperTradeRow[];
  topLosers: PaperTradeRow[];
};

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(180deg, #f8fafc 0%, #eef2ff 45%, #f8fafc 100%)",
    color: "#0f172a",
    padding: "32px 16px",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  },
  container: {
    width: "100%",
    maxWidth: "1180px",
    margin: "0 auto"
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginBottom: "20px"
  },
  eyebrow: {
    color: "#4f46e5",
    fontSize: "13px",
    fontWeight: 850,
    letterSpacing: "0.08em",
    textTransform: "uppercase"
  },
  title: {
    margin: 0,
    fontSize: "34px",
    lineHeight: 1.1,
    letterSpacing: "-0.04em"
  },
  subtitle: {
    margin: 0,
    color: "#475569",
    fontSize: "15px",
    lineHeight: 1.6
  },
  navRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "8px"
  },
  linkButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "12px",
    padding: "10px 14px",
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    color: "#334155",
    fontSize: "14px",
    fontWeight: 850,
    textDecoration: "none"
  },
  section: {
    background: "rgba(255, 255, 255, 0.92)",
    border: "1px solid #e2e8f0",
    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.08)",
    borderRadius: "20px",
    padding: "18px",
    marginBottom: "18px"
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    marginBottom: "14px"
  },
  sectionTitle: {
    margin: 0,
    fontSize: "20px",
    lineHeight: 1.25,
    letterSpacing: "-0.02em"
  },
  sectionDescription: {
    margin: "5px 0 0",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: 1.5
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "12px",
    alignItems: "end"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "12px"
  },
  twoColumnGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: "14px"
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    color: "#334155",
    fontSize: "13px",
    fontWeight: 750
  },
  input: {
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    padding: "10px 11px",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: "14px",
    outline: "none"
  },
  select: {
    width: "100%",
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    padding: "10px 11px",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: "14px",
    outline: "none"
  },
  buttonRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    alignItems: "center"
  },
  button: {
    border: "1px solid #cbd5e1",
    borderRadius: "12px",
    padding: "10px 14px",
    fontSize: "14px",
    fontWeight: 850,
    cursor: "pointer",
    background: "#ffffff",
    color: "#0f172a"
  },
  buttonPrimary: {
    borderColor: "#4f46e5",
    background: "#4f46e5",
    color: "#ffffff"
  },
  buttonSoft: {
    borderColor: "#c7d2fe",
    background: "#eef2ff",
    color: "#3730a3"
  },
  buttonDisabled: {
    opacity: 0.55,
    cursor: "not-allowed"
  },
  message: {
    borderRadius: "14px",
    padding: "12px 14px",
    marginBottom: "14px",
    fontSize: "13px",
    lineHeight: 1.5
  },
  errorMessage: {
    background: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca"
  },
  noticeMessage: {
    background: "#ecfdf5",
    color: "#065f46",
    border: "1px solid #bbf7d0"
  },
  warningMessage: {
    background: "#fffbeb",
    color: "#92400e",
    border: "1px solid #fde68a"
  },
  metricCard: {
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    background: "#ffffff",
    padding: "14px"
  },
  metricLabel: {
    color: "#64748b",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: "7px"
  },
  metricValue: {
    fontSize: "22px",
    fontWeight: 900,
    letterSpacing: "-0.035em"
  },
  metricHint: {
    marginTop: "5px",
    color: "#64748b",
    fontSize: "12px",
    lineHeight: 1.45
  },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    background: "#ffffff"
  },
  table: {
    width: "100%",
    minWidth: "920px",
    borderCollapse: "collapse",
    fontSize: "13px"
  },
  smallTable: {
    width: "100%",
    minWidth: "760px",
    borderCollapse: "collapse",
    fontSize: "13px"
  },
  th: {
    textAlign: "left",
    padding: "11px 12px",
    color: "#475569",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
    fontSize: "12px",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    whiteSpace: "nowrap"
  },
  td: {
    padding: "12px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "top"
  },
  mono: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "4px 8px",
    fontSize: "11px",
    fontWeight: 850,
    background: "#f1f5f9",
    color: "#334155",
    whiteSpace: "nowrap"
  },
  empty: {
    color: "#64748b",
    background: "#f8fafc",
    border: "1px dashed #cbd5e1",
    padding: "16px",
    borderRadius: "16px",
    fontSize: "14px",
    lineHeight: 1.5
  },
  chartBox: {
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    background: "#ffffff",
    padding: "12px"
  },
  chartCaption: {
    color: "#64748b",
    fontSize: "12px",
    lineHeight: 1.5,
    marginTop: "8px"
  },
  details: {
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    background: "#f8fafc",
    padding: "12px",
    marginTop: "12px"
  },
  detailsSummary: {
    cursor: "pointer",
    fontWeight: 850,
    color: "#334155"
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Unknown error.";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  const number = finiteNumber(value);
  return number === null ? fallback : number;
}

function safeAverage(sum: number, count: number): number | null {
  return count > 0 ? sum / count : null;
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return null;
  }

  if (denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function formatUsd(value: unknown, digits = 2): string {
  const number = finiteNumber(value);

  if (number === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(number);
}

function formatSignedUsd(value: unknown, digits = 2): string {
  const number = finiteNumber(value);

  if (number === null) {
    return "—";
  }

  if (number > 0) {
    return `+${formatUsd(number, digits)}`;
  }

  return formatUsd(number, digits);
}

function formatNumber(value: unknown, digits = 2): string {
  if (typeof value === "number" && value === Number.POSITIVE_INFINITY) {
    return "∞";
  }

  const number = finiteNumber(value);

  if (number === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits
  }).format(number);
}

function formatPercent(value: unknown, digits = 1): string {
  const number = finiteNumber(value);

  if (number === null) {
    return "—";
  }

  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(number * 100)}%`;
}

function formatRatio(value: number | null, digits = 2): string {
  if (value === null) {
    return "—";
  }

  if (value === Number.POSITIVE_INFINITY) {
    return "∞";
  }

  if (!Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatHktYmd(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  let year = "";
  let month = "";
  let day = "";

  for (const part of parts) {
    if (part.type === "year") {
      year = part.value;
    }

    if (part.type === "month") {
      month = part.value;
    }

    if (part.type === "day") {
      day = part.value;
    }
  }

  if (!year || !month || !day) {
    return null;
  }

  return `${year}-${month}-${day}`;
}

function toneColor(tone: Tone): string {
  if (tone === "good") {
    return "#047857";
  }

  if (tone === "bad") {
    return "#b91c1c";
  }

  if (tone === "warn") {
    return "#b45309";
  }

  if (tone === "muted") {
    return "#64748b";
  }

  return "#0f172a";
}

function pnlTone(value: unknown): Tone {
  const number = finiteNumber(value);

  if (number === null || number === 0) {
    return "default";
  }

  return number > 0 ? "good" : "bad";
}

function metricToneForHigherBetter(value: number | null): Tone {
  if (value === null) {
    return "muted";
  }

  if (value > 0) {
    return "good";
  }

  if (value < 0) {
    return "bad";
  }

  return "default";
}

function cleanKey(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || "—";
}

function getProbability(value: unknown): number | null {
  const number = finiteNumber(value);

  if (number === null) {
    return null;
  }

  if (number < 0 || number > 1) {
    return null;
  }

  return number;
}

function getTradeWon(trade: PaperTradeRow): boolean | null {
  if (typeof trade.outcomeWon === "boolean") {
    return trade.outcomeWon;
  }

  const pnl = finiteNumber(trade.realizedPnlUsd);

  if (pnl === null || pnl === 0) {
    return null;
  }

  return pnl > 0;
}

function isSettledAnalyzable(trade: PaperTradeRow): boolean {
  return trade.status === "SETTLED" && finiteNumber(trade.realizedPnlUsd) !== null;
}

function getTradeAnalysisDate(
  trade: PaperTradeRow,
  basis: DateBasis
): string | null {
  if (basis === "hktDate") {
    return trade.hktDate;
  }

  if (basis === "targetDate") {
    return trade.targetDate;
  }

  if (basis === "settledAt") {
    return formatHktYmd(trade.settledAt);
  }

  return formatHktYmd(trade.createdAt);
}

function isInDateRange(
  date: string | null,
  fromDate: string,
  toDate: string
): boolean {
  if (!date) {
    return !fromDate && !toDate;
  }

  if (fromDate && date < fromDate) {
    return false;
  }

  if (toDate && date > toDate) {
    return false;
  }

  return true;
}

function makeMutableGroup(key: string): MutableGroup {
  return {
    key,

    totalTrades: 0,
    openTrades: 0,
    settledTrades: 0,

    wins: 0,
    losses: 0,
    pushes: 0,

    realizedPnlUsd: 0,
    grossProfitUsd: 0,
    grossLossUsd: 0,
    notionalUsd: 0,

    edgeSum: 0,
    edgeCount: 0
  };
}

function addTradeToGroup(group: MutableGroup, trade: PaperTradeRow) {
  group.totalTrades += 1;

  if (trade.status === "OPEN") {
    group.openTrades += 1;
  }

  if (!isSettledAnalyzable(trade)) {
    return;
  }

  group.settledTrades += 1;

  const pnl = toNumber(trade.realizedPnlUsd);
  const notional = toNumber(trade.notionalUsd);

  group.realizedPnlUsd += pnl;
  group.notionalUsd += notional;

  if (pnl > 0) {
    group.grossProfitUsd += pnl;
  }

  if (pnl < 0) {
    group.grossLossUsd += pnl;
  }

  const won = getTradeWon(trade);

  if (won === true) {
    group.wins += 1;
  } else if (won === false) {
    group.losses += 1;
  } else {
    group.pushes += 1;
  }

  const edge = finiteNumber(trade.bestEdge);

  if (edge !== null) {
    group.edgeSum += edge;
    group.edgeCount += 1;
  }
}

function finalizeGroup(group: MutableGroup): BreakdownRow {
  const grossLossAbs = Math.abs(group.grossLossUsd);

  let profitFactor: number | null = null;

  if (grossLossAbs > 0) {
    profitFactor = group.grossProfitUsd / grossLossAbs;
  } else if (group.grossProfitUsd > 0) {
    profitFactor = Number.POSITIVE_INFINITY;
  }

  return {
    key: group.key,

    totalTrades: group.totalTrades,
    openTrades: group.openTrades,
    settledTrades: group.settledTrades,

    wins: group.wins,
    losses: group.losses,
    pushes: group.pushes,

    realizedPnlUsd: group.realizedPnlUsd,
    grossProfitUsd: group.grossProfitUsd,
    grossLossUsd: group.grossLossUsd,
    notionalUsd: group.notionalUsd,

    winRate: safeDivide(group.wins, group.settledTrades),
    roi: safeDivide(group.realizedPnlUsd, group.notionalUsd),
    avgEdge: safeAverage(group.edgeSum, group.edgeCount),
    avgPnlUsd: safeAverage(group.realizedPnlUsd, group.settledTrades),
    profitFactor
  };
}

function groupByTrades(
  trades: PaperTradeRow[],
  keyFn: (trade: PaperTradeRow) => string
): BreakdownRow[] {
  const map = new Map<string, MutableGroup>();

  for (const trade of trades) {
    const key = cleanKey(keyFn(trade));

    let group = map.get(key);

    if (!group) {
      group = makeMutableGroup(key);
      map.set(key, group);
    }

    addTradeToGroup(group, trade);
  }

  return [...map.values()]
    .map(finalizeGroup)
    .sort((a, b) => {
      if (b.settledTrades !== a.settledTrades) {
        return b.settledTrades - a.settledTrades;
      }

      if (b.totalTrades !== a.totalTrades) {
        return b.totalTrades - a.totalTrades;
      }

      return b.realizedPnlUsd - a.realizedPnlUsd;
    });
}

function getEdgeBucket(edgeValue: unknown): string {
  const edge = finiteNumber(edgeValue);

  if (edge === null) {
    return "No edge";
  }

  if (edge < 0) {
    return "< 0%";
  }

  if (edge < 0.01) {
    return "0–1%";
  }

  if (edge < 0.02) {
    return "1–2%";
  }

  if (edge < 0.03) {
    return "2–3%";
  }

  if (edge < 0.05) {
    return "3–5%";
  }

  if (edge < 0.08) {
    return "5–8%";
  }

  return ">= 8%";
}

function getProbabilityBucket(probability: number): {
  key: string;
  lower: number;
  upper: number;
  index: number;
} {
  const index = Math.min(9, Math.max(0, Math.floor(probability * 10)));
  const lower = index / 10;
  const upper = (index + 1) / 10;

  return {
    key: `${Math.round(lower * 100)}–${Math.round(upper * 100)}%`,
    lower,
    upper,
    index
  };
}

function buildCalibrationRows(settledTrades: PaperTradeRow[]): CalibrationRow[] {
  type MutableCalibration = {
    key: string;
    lower: number;
    upper: number;
    index: number;

    count: number;
    predictedSum: number;
    actualSum: number;
    brierSum: number;

    realizedPnlUsd: number;
    notionalUsd: number;
  };

  const map = new Map<number, MutableCalibration>();

  for (const trade of settledTrades) {
    const probability = getProbability(trade.modelProbability);
    const won = getTradeWon(trade);

    if (probability === null || won === null) {
      continue;
    }

    const bucket = getProbabilityBucket(probability);
    let row = map.get(bucket.index);

    if (!row) {
      row = {
        key: bucket.key,
        lower: bucket.lower,
        upper: bucket.upper,
        index: bucket.index,

        count: 0,
        predictedSum: 0,
        actualSum: 0,
        brierSum: 0,

        realizedPnlUsd: 0,
        notionalUsd: 0
      };

      map.set(bucket.index, row);
    }

    const actual = won ? 1 : 0;
    const pnl = toNumber(trade.realizedPnlUsd);
    const notional = toNumber(trade.notionalUsd);

    row.count += 1;
    row.predictedSum += probability;
    row.actualSum += actual;
    row.brierSum += Math.pow(probability - actual, 2);
    row.realizedPnlUsd += pnl;
    row.notionalUsd += notional;
  }

  return [...map.values()]
    .sort((a, b) => a.index - b.index)
    .map((row) => {
      const avgPredicted = row.predictedSum / row.count;
      const actualWinRate = row.actualSum / row.count;

      return {
        key: row.key,
        lower: row.lower,
        upper: row.upper,

        count: row.count,
        avgPredicted,
        actualWinRate,
        gap: actualWinRate - avgPredicted,
        brierScore: row.brierSum / row.count,

        realizedPnlUsd: row.realizedPnlUsd,
        notionalUsd: row.notionalUsd,
        roi: safeDivide(row.realizedPnlUsd, row.notionalUsd)
      };
    });
}

function buildDailyStats(
  settledTrades: PaperTradeRow[],
  dateBasis: DateBasis
): DailyStat[] {
  type MutableDaily = {
    date: string;

    settledTrades: number;
    wins: number;
    losses: number;
    pushes: number;

    notionalUsd: number;
    realizedPnlUsd: number;

    edgeSum: number;
    edgeCount: number;
  };

  const map = new Map<string, MutableDaily>();

  for (const trade of settledTrades) {
    const date = getTradeAnalysisDate(trade, dateBasis) ?? "Unknown";
    let row = map.get(date);

    if (!row) {
      row = {
        date,

        settledTrades: 0,
        wins: 0,
        losses: 0,
        pushes: 0,

        notionalUsd: 0,
        realizedPnlUsd: 0,

        edgeSum: 0,
        edgeCount: 0
      };

      map.set(date, row);
    }

    row.settledTrades += 1;
    row.notionalUsd += toNumber(trade.notionalUsd);
    row.realizedPnlUsd += toNumber(trade.realizedPnlUsd);

    const won = getTradeWon(trade);

    if (won === true) {
      row.wins += 1;
    } else if (won === false) {
      row.losses += 1;
    } else {
      row.pushes += 1;
    }

    const edge = finiteNumber(trade.bestEdge);

    if (edge !== null) {
      row.edgeSum += edge;
      row.edgeCount += 1;
    }
  }

  const sorted = [...map.values()].sort((a, b) => {
    if (a.date === "Unknown") {
      return 1;
    }

    if (b.date === "Unknown") {
      return -1;
    }

    return a.date.localeCompare(b.date);
  });

  let cumulativePnlUsd = 0;
  let peakPnlUsd = 0;

  return sorted.map((row) => {
    cumulativePnlUsd += row.realizedPnlUsd;

    if (cumulativePnlUsd > peakPnlUsd) {
      peakPnlUsd = cumulativePnlUsd;
    }

    const drawdownUsd = peakPnlUsd - cumulativePnlUsd;

    return {
      date: row.date,

      settledTrades: row.settledTrades,
      wins: row.wins,
      losses: row.losses,
      pushes: row.pushes,

      notionalUsd: row.notionalUsd,
      realizedPnlUsd: row.realizedPnlUsd,
      cumulativePnlUsd,
      drawdownUsd,

      winRate: safeDivide(row.wins, row.settledTrades),
      roi: safeDivide(row.realizedPnlUsd, row.notionalUsd),
      avgEdge: safeAverage(row.edgeSum, row.edgeCount)
    };
  });
}

function buildSummaryMetrics(
  filteredTrades: PaperTradeRow[],
  settledTrades: PaperTradeRow[],
  dailyStats: DailyStat[]
): SummaryMetrics {
  const group = makeMutableGroup("All trades");

  let openNotionalUsd = 0;
  let totalNotionalUsd = 0;

  for (const trade of filteredTrades) {
    addTradeToGroup(group, trade);

    const notional = toNumber(trade.notionalUsd);
    totalNotionalUsd += notional;

    if (trade.status === "OPEN") {
      openNotionalUsd += notional;
    }
  }

  let brierSum = 0;
  let brierCount = 0;

  let modelProbabilitySum = 0;
  let modelProbabilityCount = 0;

  let marketProbabilitySum = 0;
  let marketProbabilityCount = 0;

  let bestEdgeSum = 0;
  let bestEdgeCount = 0;

  for (const trade of settledTrades) {
    const modelProbability = getProbability(trade.modelProbability);
    const marketProbability = getProbability(trade.marketProbability);
    const bestEdge = finiteNumber(trade.bestEdge);
    const won = getTradeWon(trade);

    if (modelProbability !== null) {
      modelProbabilitySum += modelProbability;
      modelProbabilityCount += 1;
    }

    if (marketProbability !== null) {
      marketProbabilitySum += marketProbability;
      marketProbabilityCount += 1;
    }

    if (bestEdge !== null) {
      bestEdgeSum += bestEdge;
      bestEdgeCount += 1;
    }

    if (modelProbability !== null && won !== null) {
      const actual = won ? 1 : 0;
      brierSum += Math.pow(modelProbability - actual, 2);
      brierCount += 1;
    }
  }

  const base = finalizeGroup(group);

  const maxDrawdownUsd = dailyStats.reduce(
    (max, row) => Math.max(max, row.drawdownUsd),
    0
  );

  const maxCumulativePnlUsd = dailyStats.reduce(
    (max, row) => Math.max(max, row.cumulativePnlUsd),
    0
  );

  return {
    ...base,

    openNotionalUsd,
    totalNotionalUsd,

    maxDrawdownUsd,
    maxDrawdownPct:
      maxCumulativePnlUsd > 0 ? maxDrawdownUsd / maxCumulativePnlUsd : null,

    brierScore: safeAverage(brierSum, brierCount),
    avgModelProbability: safeAverage(
      modelProbabilitySum,
      modelProbabilityCount
    ),
    avgMarketProbability: safeAverage(
      marketProbabilitySum,
      marketProbabilityCount
    ),
    avgBestEdge: safeAverage(bestEdgeSum, bestEdgeCount)
  };
}

function computeAnalytics(
  allTrades: PaperTradeRow[],
  dateBasis: DateBasis,
  fromDate: string,
  toDate: string
): AnalyticsResult {
  const filteredTrades = allTrades.filter((trade) => {
    const date = getTradeAnalysisDate(trade, dateBasis);
    return isInDateRange(date, fromDate, toDate);
  });

  const settledTrades = filteredTrades.filter(isSettledAnalyzable);
  const dailyStats = buildDailyStats(settledTrades, dateBasis);
  const summary = buildSummaryMetrics(filteredTrades, settledTrades, dailyStats);

  const bySide = groupByTrades(filteredTrades, (trade) => trade.side);
  const byStrength = groupByTrades(filteredTrades, (trade) => trade.strength);
  const byPriceQuality = groupByTrades(
    filteredTrades,
    (trade) => trade.priceQuality ?? "—"
  );
  const byEdgeBucket = groupByTrades(filteredTrades, (trade) =>
    getEdgeBucket(trade.bestEdge)
  );
  const bySnapshotKey = groupByTrades(
    filteredTrades,
    (trade) => trade.snapshotKey
  );

  const calibration = buildCalibrationRows(settledTrades);

  const settledByPnlDesc = [...settledTrades].sort(
    (a, b) => toNumber(b.realizedPnlUsd) - toNumber(a.realizedPnlUsd)
  );

  const settledByPnlAsc = [...settledTrades].sort(
    (a, b) => toNumber(a.realizedPnlUsd) - toNumber(b.realizedPnlUsd)
  );

  return {
    filteredTrades,
    settledTrades,

    summary,
    dailyStats,

    bySide,
    byStrength,
    byPriceQuality,
    byEdgeBucket,
    bySnapshotKey,

    calibration,

    topWinners: settledByPnlDesc.slice(0, 8),
    topLosers: settledByPnlAsc.slice(0, 8)
  };
}

async function adminFetchEnvelope<T>(
  path: string,
  options: {
    adminSecret: string;
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
  }
): Promise<ApiEnvelope<T>> {
  const headers: Record<string, string> = {};
  const secret = options.adminSecret.trim();

  if (secret) {
    headers["x-admin-secret"] = secret;
  }

  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body:
      options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store"
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!isRecord(payload)) {
    throw new Error(`Request failed with HTTP ${response.status}.`);
  }

  const error =
    typeof payload.error === "string"
      ? payload.error
      : typeof payload.message === "string"
        ? payload.message
        : null;

  const envelope: ApiEnvelope<T> = {
    ok: payload.ok === true,
    error,
    status: response.status
  };

  if ("data" in payload) {
    envelope.data = payload.data as T;
  }

  if (!response.ok && !("data" in payload)) {
    throw new Error(error ?? `Request failed with HTTP ${response.status}.`);
  }

  if (!envelope.ok && !("data" in payload)) {
    throw new Error(error ?? "Request failed.");
  }

  return envelope;
}

function Button({
  children,
  disabled,
  variant = "default",
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  variant?: "default" | "primary" | "soft";
  onClick: () => void;
}) {
  const variantStyle =
    variant === "primary"
      ? styles.buttonPrimary
      : variant === "soft"
        ? styles.buttonSoft
        : {};

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        ...styles.button,
        ...variantStyle,
        ...(disabled ? styles.buttonDisabled : {})
      }}
    >
      {children}
    </button>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div
        style={{
          ...styles.metricValue,
          color: toneColor(tone)
        }}
      >
        {value}
      </div>
      {hint ? <div style={styles.metricHint}>{hint}</div> : null}
    </div>
  );
}

function EquityCurveChart({ dailyStats }: { dailyStats: DailyStat[] }) {
  if (dailyStats.length === 0) {
    return (
      <div style={styles.empty}>
        No settled trades yet. Equity curve will appear after paper trades are
        settled.
      </div>
    );
  }

  const width = 900;
  const height = 280;
  const padding = 36;

  const series = [
    {
      date: "Start",
      cumulativePnlUsd: 0
    },
    ...dailyStats.map((row) => ({
      date: row.date,
      cumulativePnlUsd: row.cumulativePnlUsd
    }))
  ];

  const rawMin = Math.min(0, ...series.map((row) => row.cumulativePnlUsd));
  const rawMax = Math.max(0, ...series.map((row) => row.cumulativePnlUsd));
  const rawRange = rawMax - rawMin || 1;

  const yMin = rawMin - rawRange * 0.14;
  const yMax = rawMax + rawRange * 0.14;
  const yRange = yMax - yMin || 1;

  function x(index: number): number {
    if (series.length <= 1) {
      return width / 2;
    }

    return (
      padding +
      (index / (series.length - 1)) * (width - padding * 2)
    );
  }

  function y(value: number): number {
    return padding + ((yMax - value) / yRange) * (height - padding * 2);
  }

  const points = series.map((row, index) => ({
    x: x(index),
    y: y(row.cumulativePnlUsd),
    value: row.cumulativePnlUsd,
    date: row.date
  }));

  const path = points
    .map((point, index) =>
      index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`
    )
    .join(" ");

  const zeroY = y(0);

  return (
    <div style={styles.chartBox}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="280"
        role="img"
        aria-label="Paper trading cumulative PnL equity curve"
      >
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          rx="18"
          fill="#ffffff"
        />

        <line
          x1={padding}
          x2={width - padding}
          y1={zeroY}
          y2={zeroY}
          stroke="#cbd5e1"
          strokeDasharray="5 5"
        />

        <line
          x1={padding}
          x2={padding}
          y1={padding}
          y2={height - padding}
          stroke="#e2e8f0"
        />

        <line
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
          stroke="#e2e8f0"
        />

        <path
          d={path}
          fill="none"
          stroke={series[series.length - 1].cumulativePnlUsd >= 0 ? "#047857" : "#b91c1c"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {points.length <= 40
          ? points.map((point, index) => (
              <circle
                key={`${point.date}-${index}`}
                cx={point.x}
                cy={point.y}
                r="4"
                fill={point.value >= 0 ? "#047857" : "#b91c1c"}
                opacity="0.92"
              />
            ))
          : null}

        <text
          x={padding}
          y={padding - 12}
          fill="#64748b"
          fontSize="12"
          fontWeight="700"
        >
          {formatUsd(yMax)}
        </text>

        <text
          x={padding}
          y={height - 8}
          fill="#64748b"
          fontSize="12"
          fontWeight="700"
        >
          {formatUsd(yMin)}
        </text>

        <text
          x={padding}
          y={height - 14}
          fill="#64748b"
          fontSize="12"
          fontWeight="700"
        >
          {series[0].date}
        </text>

        <text
          x={width - padding}
          y={height - 14}
          fill="#64748b"
          fontSize="12"
          fontWeight="700"
          textAnchor="end"
        >
          {series[series.length - 1].date}
        </text>
      </svg>

      <div style={styles.chartCaption}>
        Equity curve uses cumulative realized P/L from settled paper trades only.
        Open positions are not marked-to-market in this chart.
      </div>
    </div>
  );
}

function BreakdownTable({
  title,
  description,
  rows,
  maxRows = 12
}: {
  title: string;
  description: string;
  rows: BreakdownRow[];
  maxRows?: number;
}) {
  const displayRows = rows.slice(0, maxRows);

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <div>
          <h2 style={styles.sectionTitle}>{title}</h2>
          <p style={styles.sectionDescription}>{description}</p>
        </div>
        <span style={styles.pill}>Rows: {rows.length}</span>
      </div>

      {displayRows.length === 0 ? (
        <div style={styles.empty}>No data for this breakdown.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.smallTable}>
            <thead>
              <tr>
                <th style={styles.th}>Segment</th>
                <th style={styles.th}>Total</th>
                <th style={styles.th}>Settled</th>
                <th style={styles.th}>Win rate</th>
                <th style={styles.th}>P/L</th>
                <th style={styles.th}>ROI</th>
                <th style={styles.th}>Avg edge</th>
                <th style={styles.th}>Expectancy</th>
                <th style={styles.th}>Profit factor</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.key}>
                  <td style={{ ...styles.td, ...styles.mono }}>{row.key}</td>
                  <td style={styles.td}>{formatNumber(row.totalTrades, 0)}</td>
                  <td style={styles.td}>
                    {formatNumber(row.settledTrades, 0)}
                  </td>
                  <td style={styles.td}>{formatPercent(row.winRate)}</td>
                  <td
                    style={{
                      ...styles.td,
                      color: toneColor(pnlTone(row.realizedPnlUsd)),
                      fontWeight: 850
                    }}
                  >
                    {formatSignedUsd(row.realizedPnlUsd)}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      color: toneColor(metricToneForHigherBetter(row.roi)),
                      fontWeight: 850
                    }}
                  >
                    {formatPercent(row.roi)}
                  </td>
                  <td style={styles.td}>{formatPercent(row.avgEdge, 2)}</td>
                  <td style={styles.td}>{formatSignedUsd(row.avgPnlUsd)}</td>
                  <td style={styles.td}>{formatRatio(row.profitFactor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > displayRows.length ? (
        <p style={styles.sectionDescription}>
          Showing first {displayRows.length} of {rows.length} rows.
        </p>
      ) : null}
    </section>
  );
}

function CalibrationTable({ rows }: { rows: CalibrationRow[] }) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <div>
          <h2 style={styles.sectionTitle}>Model probability calibration</h2>
          <p style={styles.sectionDescription}>
            Buckets compare average model probability against actual win rate
            for settled paper trades. Lower Brier score is better.
          </p>
        </div>
        <span style={styles.pill}>Buckets: {rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <div style={styles.empty}>
          No calibration data yet. You need settled trades with non-null{" "}
          <span style={styles.mono}>modelProbability</span> and{" "}
          <span style={styles.mono}>outcomeWon</span>.
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.smallTable}>
            <thead>
              <tr>
                <th style={styles.th}>Model prob bucket</th>
                <th style={styles.th}>Count</th>
                <th style={styles.th}>Avg predicted</th>
                <th style={styles.th}>Actual win rate</th>
                <th style={styles.th}>Gap</th>
                <th style={styles.th}>Brier</th>
                <th style={styles.th}>P/L</th>
                <th style={styles.th}>ROI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td style={{ ...styles.td, ...styles.mono }}>{row.key}</td>
                  <td style={styles.td}>{formatNumber(row.count, 0)}</td>
                  <td style={styles.td}>{formatPercent(row.avgPredicted)}</td>
                  <td style={styles.td}>{formatPercent(row.actualWinRate)}</td>
                  <td
                    style={{
                      ...styles.td,
                      color: toneColor(metricToneForHigherBetter(row.gap)),
                      fontWeight: 850
                    }}
                  >
                    {formatPercent(row.gap)}
                  </td>
                  <td style={styles.td}>{formatNumber(row.brierScore, 4)}</td>
                  <td
                    style={{
                      ...styles.td,
                      color: toneColor(pnlTone(row.realizedPnlUsd)),
                      fontWeight: 850
                    }}
                  >
                    {formatSignedUsd(row.realizedPnlUsd)}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      color: toneColor(metricToneForHigherBetter(row.roi)),
                      fontWeight: 850
                    }}
                  >
                    {formatPercent(row.roi)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details style={styles.details}>
        <summary style={styles.detailsSummary}>How to read this table</summary>
        <p style={styles.sectionDescription}>
          If the model is well calibrated, a 60–70% bucket should win roughly
          60–70% of the time over a large sample. Small samples can be noisy, so
          use this table as a directional diagnostic, not as proof.
        </p>
      </details>
    </section>
  );
}

function DailyStatsTable({ rows }: { rows: DailyStat[] }) {
  const displayRows = rows.slice(-30);

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <div>
          <h2 style={styles.sectionTitle}>Daily realized P/L</h2>
          <p style={styles.sectionDescription}>
            Last {displayRows.length} daily rows based on selected date basis.
          </p>
        </div>
        <span style={styles.pill}>Days: {rows.length}</span>
      </div>

      {displayRows.length === 0 ? (
        <div style={styles.empty}>No settled daily stats yet.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.smallTable}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Trades</th>
                <th style={styles.th}>Win rate</th>
                <th style={styles.th}>Notional</th>
                <th style={styles.th}>Daily P/L</th>
                <th style={styles.th}>Cumulative P/L</th>
                <th style={styles.th}>Drawdown</th>
                <th style={styles.th}>ROI</th>
                <th style={styles.th}>Avg edge</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.date}>
                  <td style={{ ...styles.td, ...styles.mono }}>{row.date}</td>
                  <td style={styles.td}>
                    {formatNumber(row.settledTrades, 0)}
                  </td>
                  <td style={styles.td}>{formatPercent(row.winRate)}</td>
                  <td style={styles.td}>{formatUsd(row.notionalUsd)}</td>
                  <td
                    style={{
                      ...styles.td,
                      color: toneColor(pnlTone(row.realizedPnlUsd)),
                      fontWeight: 850
                    }}
                  >
                    {formatSignedUsd(row.realizedPnlUsd)}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      color: toneColor(pnlTone(row.cumulativePnlUsd)),
                      fontWeight: 850
                    }}
                  >
                    {formatSignedUsd(row.cumulativePnlUsd)}
                  </td>
                  <td style={styles.td}>{formatUsd(row.drawdownUsd)}</td>
                  <td
                    style={{
                      ...styles.td,
                      color: toneColor(metricToneForHigherBetter(row.roi)),
                      fontWeight: 850
                    }}
                  >
                    {formatPercent(row.roi)}
                  </td>
                  <td style={styles.td}>{formatPercent(row.avgEdge, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TopTradesTable({
  title,
  description,
  trades
}: {
  title: string;
  description: string;
  trades: PaperTradeRow[];
}) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <div>
          <h2 style={styles.sectionTitle}>{title}</h2>
          <p style={styles.sectionDescription}>{description}</p>
        </div>
      </div>

      {trades.length === 0 ? (
        <div style={styles.empty}>No settled trades yet.</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.smallTable}>
            <thead>
              <tr>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Outcome</th>
                <th style={styles.th}>Side</th>
                <th style={styles.th}>Entry</th>
                <th style={styles.th}>Notional</th>
                <th style={styles.th}>P/L</th>
                <th style={styles.th}>Created</th>
                <th style={styles.th}>Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={`${title}-${trade.id}`}>
                  <td style={{ ...styles.td, ...styles.mono }}>#{trade.id}</td>
                  <td style={styles.td}>
                    <strong>{trade.outcomeName}</strong>
                    <div style={styles.sectionDescription}>
                      {trade.marketTitle ?? trade.marketSlug ?? "—"}
                    </div>
                  </td>
                  <td style={{ ...styles.td, ...styles.mono }}>
                    {trade.side}
                    <div style={styles.sectionDescription}>{trade.strength}</div>
                  </td>
                  <td style={styles.td}>{formatNumber(trade.entryPrice, 4)}</td>
                  <td style={styles.td}>{formatUsd(trade.notionalUsd)}</td>
                  <td
                    style={{
                      ...styles.td,
                      color: toneColor(pnlTone(trade.realizedPnlUsd)),
                      fontWeight: 850
                    }}
                  >
                    {formatSignedUsd(trade.realizedPnlUsd)}
                  </td>
                  <td style={styles.td}>{formatDateTime(trade.createdAt)}</td>
                  <td style={{ ...styles.td, ...styles.mono }}>
                    {trade.snapshotKey}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function PaperTradingPerformancePanel() {
  const [adminSecret, setAdminSecret] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [snapshotKey, setSnapshotKey] = useState("");
  const [apiLimit, setApiLimit] = useState("1000");

  const [dateBasis, setDateBasis] = useState<DateBasis>("hktDate");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [tradesData, setTradesData] = useState<PaperTradesResponse | null>(
    null
  );

  const [loading, setLoading] = useState<LoadingKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isBusy = loading !== null;

  const loadAnalytics = useCallback(async () => {
    if (!adminSecret.trim()) {
      setError("Please enter x-admin-secret first.");
      setNotice(null);
      return;
    }

    setLoading("load");
    setError(null);
    setNotice(null);

    try {
      const params = new URLSearchParams();

      if (statusFilter.trim()) {
        params.set("status", statusFilter.trim());
      }

      if (snapshotKey.trim()) {
        params.set("snapshotKey", snapshotKey.trim());
      }

      if (apiLimit.trim()) {
        params.set("limit", apiLimit.trim());
      }

      const query = params.toString();
      const path = query
        ? `/api/paper-trading/trades?${query}`
        : "/api/paper-trading/trades";

      const envelope = await adminFetchEnvelope<PaperTradesResponse>(path, {
        adminSecret
      });

      if (!envelope.ok || !envelope.data) {
        throw new Error(
          envelope.error ?? "Failed to load paper trading analytics."
        );
      }

      setTradesData(envelope.data);
      setNotice(`Loaded ${envelope.data.count} paper trade row(s).`);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(null);
    }
  }, [adminSecret, apiLimit, snapshotKey, statusFilter]);

  const analytics = useMemo(
    () =>
      computeAnalytics(
        tradesData?.trades ?? [],
        dateBasis,
        fromDate,
        toDate
      ),
    [dateBasis, fromDate, toDate, tradesData]
  );

  const apiLimitNumber = finiteNumber(apiLimit);
  const hitLimit =
    tradesData !== null &&
    apiLimitNumber !== null &&
    tradesData.count >= apiLimitNumber;

  const summary = analytics.summary;

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.eyebrow}>PR-4 Read-only analytics</div>
          <h1 style={styles.title}>Paper Trading Performance</h1>
          <p style={styles.subtitle}>
            Performance, equity curve, drawdown, segment breakdowns, and model
            probability calibration for paper trades. This page is read-only and
            does not create, settle, or cancel trades.
          </p>

          <div style={styles.navRow}>
            <a href="/admin/paper-trading" style={styles.linkButton}>
              ← Back to paper trading panel
            </a>
          </div>
        </header>

        {error ? (
          <div style={{ ...styles.message, ...styles.errorMessage }}>
            {error}
          </div>
        ) : null}

        {notice ? (
          <div style={{ ...styles.message, ...styles.noticeMessage }}>
            {notice}
          </div>
        ) : null}

        {hitLimit ? (
          <div style={{ ...styles.message, ...styles.warningMessage }}>
            Loaded row count reached the API limit of{" "}
            <strong>{formatNumber(apiLimitNumber, 0)}</strong>. Metrics may be
            truncated. Increase the limit if your API allows it, or filter by
            snapshot/status/date.
          </div>
        ) : null}

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Load analytics data</h2>
              <p style={styles.sectionDescription}>
                This page reads from{" "}
                <span style={styles.mono}>GET /api/paper-trading/trades</span>{" "}
                and calculates analytics client-side.
              </p>
            </div>

            <div style={styles.buttonRow}>
              <Button
                disabled={isBusy}
                variant="primary"
                onClick={() => {
                  void loadAnalytics();
                }}
              >
                {loading === "load" ? "Loading..." : "Load analytics"}
              </Button>
            </div>
          </div>

          <div style={styles.formGrid}>
            <label style={styles.label}>
              x-admin-secret
              <input
                type="password"
                autoComplete="off"
                value={adminSecret}
                onChange={(event) => setAdminSecret(event.target.value)}
                placeholder="YOUR_ADMIN_SECRET"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              API status filter
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={styles.select}
              >
                <option value="">All</option>
                <option value="OPEN">OPEN</option>
                <option value="SETTLED">SETTLED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </label>

            <label style={styles.label}>
              API snapshot key filter
              <input
                type="text"
                value={snapshotKey}
                onChange={(event) => setSnapshotKey(event.target.value)}
                placeholder="Optional"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              API limit
              <input
                type="number"
                min="1"
                max="5000"
                value={apiLimit}
                onChange={(event) => setApiLimit(event.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Analysis date basis
              <select
                value={dateBasis}
                onChange={(event) =>
                  setDateBasis(event.target.value as DateBasis)
                }
                style={styles.select}
              >
                <option value="hktDate">Trade HKT date</option>
                <option value="targetDate">Target date</option>
                <option value="settledAt">Settled date, HKT</option>
                <option value="createdAt">Created date, HKT</option>
              </select>
            </label>

            <label style={styles.label}>
              Client-side from date
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Client-side to date
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                style={styles.input}
              />
            </label>

            <div style={styles.buttonRow}>
              <Button
                disabled={isBusy}
                variant="soft"
                onClick={() => {
                  setStatusFilter("");
                  setSnapshotKey("");
                  setFromDate("");
                  setToDate("");
                  setDateBasis("hktDate");
                }}
              >
                Clear filters
              </Button>
            </div>
          </div>
        </section>

        {!tradesData ? (
          <section style={styles.section}>
            <div style={styles.empty}>
              No data loaded yet. Enter your admin secret and click{" "}
              <strong>Load analytics</strong>.
            </div>
          </section>
        ) : (
          <>
            <section style={styles.section}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Performance summary</h2>
                  <p style={styles.sectionDescription}>
                    API rows loaded: {formatNumber(tradesData.count, 0)} ·
                    Filtered rows:{" "}
                    {formatNumber(analytics.filteredTrades.length, 0)} ·
                    Settled rows:{" "}
                    {formatNumber(analytics.settledTrades.length, 0)}
                  </p>
                </div>
                <span style={styles.pill}>
                  Database: {tradesData.databaseEnabled ? "enabled" : "off"}
                </span>
              </div>

              <div style={styles.grid}>
                <MetricCard
                  label="Filtered trades"
                  value={formatNumber(summary.totalTrades, 0)}
                  hint={`Open: ${formatNumber(
                    summary.openTrades,
                    0
                  )} · Settled: ${formatNumber(summary.settledTrades, 0)}`}
                />

                <MetricCard
                  label="Realized P/L"
                  value={formatSignedUsd(summary.realizedPnlUsd)}
                  tone={pnlTone(summary.realizedPnlUsd)}
                  hint={`Gross profit: ${formatUsd(
                    summary.grossProfitUsd
                  )} · Gross loss: ${formatUsd(summary.grossLossUsd)}`}
                />

                <MetricCard
                  label="ROI"
                  value={formatPercent(summary.roi)}
                  tone={metricToneForHigherBetter(summary.roi)}
                  hint={`Settled notional: ${formatUsd(summary.notionalUsd)}`}
                />

                <MetricCard
                  label="Win rate"
                  value={formatPercent(summary.winRate)}
                  hint={`Wins: ${formatNumber(
                    summary.wins,
                    0
                  )} · Losses: ${formatNumber(
                    summary.losses,
                    0
                  )} · Pushes: ${formatNumber(summary.pushes, 0)}`}
                />

                <MetricCard
                  label="Profit factor"
                  value={formatRatio(summary.profitFactor)}
                  hint="Gross profit divided by absolute gross loss"
                />

                <MetricCard
                  label="Expectancy / trade"
                  value={formatSignedUsd(summary.avgPnlUsd)}
                  tone={pnlTone(summary.avgPnlUsd)}
                  hint="Average realized P/L per settled trade"
                />

                <MetricCard
                  label="Max drawdown"
                  value={formatUsd(summary.maxDrawdownUsd)}
                  tone={summary.maxDrawdownUsd > 0 ? "warn" : "good"}
                  hint={`Drawdown pct: ${formatPercent(
                    summary.maxDrawdownPct
                  )}`}
                />

                <MetricCard
                  label="Open notional"
                  value={formatUsd(summary.openNotionalUsd)}
                  tone={summary.openNotionalUsd > 0 ? "warn" : "default"}
                  hint="Open trades are not marked-to-market here"
                />

                <MetricCard
                  label="Avg model prob"
                  value={formatPercent(summary.avgModelProbability)}
                  hint={`Avg market prob: ${formatPercent(
                    summary.avgMarketProbability
                  )}`}
                />

                <MetricCard
                  label="Avg best edge"
                  value={formatPercent(summary.avgBestEdge, 2)}
                  tone={metricToneForHigherBetter(summary.avgBestEdge)}
                  hint="Settled trades only"
                />

                <MetricCard
                  label="Brier score"
                  value={formatNumber(summary.brierScore, 4)}
                  hint="Lower is better; needs settled trades with outcomes"
                />

                <MetricCard
                  label="Total notional"
                  value={formatUsd(summary.totalNotionalUsd)}
                  hint="Includes open, settled, and cancelled loaded rows"
                />
              </div>
            </section>

            <section style={styles.section}>
              <div style={styles.sectionHeader}>
                <div>
                  <h2 style={styles.sectionTitle}>Equity curve</h2>
                  <p style={styles.sectionDescription}>
                    Cumulative realized P/L from settled paper trades.
                  </p>
                </div>
              </div>

              <EquityCurveChart dailyStats={analytics.dailyStats} />
            </section>

            <DailyStatsTable rows={analytics.dailyStats} />

            <CalibrationTable rows={analytics.calibration} />

            <div style={styles.twoColumnGrid}>
              <BreakdownTable
                title="Breakdown by side"
                description="Performance by BUY_YES / BUY_NO or equivalent side label."
                rows={analytics.bySide}
              />

              <BreakdownTable
                title="Breakdown by strength"
                description="Performance by signal strength."
                rows={analytics.byStrength}
              />
            </div>

            <div style={styles.twoColumnGrid}>
              <BreakdownTable
                title="Breakdown by price quality"
                description="Performance by price quality filter."
                rows={analytics.byPriceQuality}
              />

              <BreakdownTable
                title="Breakdown by edge bucket"
                description="Performance by bestEdge bucket."
                rows={analytics.byEdgeBucket}
              />
            </div>

            <BreakdownTable
              title="Breakdown by snapshot key"
              description="Useful for comparing different signal batches or model versions."
              rows={analytics.bySnapshotKey}
              maxRows={20}
            />

            <div style={styles.twoColumnGrid}>
              <TopTradesTable
                title="Top winners"
                description="Largest realized positive paper trades."
                trades={analytics.topWinners}
              />

              <TopTradesTable
                title="Top losers"
                description="Largest realized negative paper trades."
                trades={analytics.topLosers}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
