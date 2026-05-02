"use client";

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties
} from "react";

type PaperTradeStatus = "OPEN" | "SETTLED" | "CANCELLED";

type LoadingKey = "load" | "dryRun" | "run" | "settle" | null;

type Tone = "default" | "good" | "bad" | "warn" | "muted";

type PaperTradingConfig = {
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

type PaperTradingRiskState = {
  hktDate: string;
  dailyNotionalUsedUsd: number;
  dailyNotionalRemainingUsd: number;
  dailyTradeCount: number;
  openTradeCount: number;
  openTradeSlotsRemaining: number;
};

type PaperTradingSummary = {
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
  config: PaperTradingConfig;
  summary: PaperTradingSummary;
  risk: PaperTradingRiskState;
  trades: PaperTradeRow[];
};

type PaperTradeSkip = {
  signalSnapshotId: number | null;
  snapshotKey: string | null;
  outcomeName: string | null;
  side: string | null;
  reason: string;
  detail: string | null;
};

type PaperTradePlan = {
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

type PaperTradingRunResult = {
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

type PaperTradeSettleResult = {
  settledCount: number;
  totalRealizedPnlUsd: number;
  filters: {
    snapshotKey: string | null;
    targetDate: string | null;
    hktDate: string | null;
  };
  trades: PaperTradeRow[];
};

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error: string | null;
  status: number;
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
    fontWeight: 800,
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
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px"
  },
  compactGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "10px"
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
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: "7px"
  },
  metricValue: {
    fontSize: "22px",
    fontWeight: 850,
    letterSpacing: "-0.035em"
  },
  metricHint: {
    marginTop: "5px",
    color: "#64748b",
    fontSize: "12px",
    lineHeight: 1.45
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
    alignItems: "end"
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
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    minHeight: "40px",
    color: "#334155",
    fontSize: "13px",
    fontWeight: 750
  },
  checkbox: {
    width: "16px",
    height: "16px"
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
    fontWeight: 800,
    cursor: "pointer",
    background: "#ffffff",
    color: "#0f172a"
  },
  buttonPrimary: {
    borderColor: "#4f46e5",
    background: "#4f46e5",
    color: "#ffffff"
  },
  buttonDanger: {
    borderColor: "#dc2626",
    background: "#dc2626",
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
  },
  muted: {
    color: "#64748b"
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
    minWidth: "960px",
    borderCollapse: "collapse",
    fontSize: "13px"
  },
  smallTable: {
    width: "100%",
    minWidth: "720px",
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
  badge: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    padding: "4px 8px",
    fontSize: "11px",
    fontWeight: 850,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    whiteSpace: "nowrap"
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
  resultGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "10px",
    marginBottom: "12px"
  },
  codeLine: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
    fontSize: "12px",
    color: "#334155",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "8px",
    overflowWrap: "anywhere"
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

function getHktToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

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
    return "";
  }

  return `${year}-${month}-${day}`;
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

function formatNumber(value: unknown, digits = 4): string {
  const number = finiteNumber(value);

  if (number === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits
  }).format(number);
}

function formatPercent(value: unknown, digits = 2): string {
  const number = finiteNumber(value);

  if (number === null) {
    return "—";
  }

  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(number * 100)}%`;
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

function statusBadgeStyle(status: PaperTradeStatus): CSSProperties {
  if (status === "OPEN") {
    return {
      ...styles.badge,
      background: "#eff6ff",
      color: "#1d4ed8"
    };
  }

  if (status === "SETTLED") {
    return {
      ...styles.badge,
      background: "#ecfdf5",
      color: "#047857"
    };
  }

  return {
    ...styles.badge,
    background: "#f8fafc",
    color: "#475569"
  };
}

function addOptionalNumber(
  body: Record<string, unknown>,
  key: string,
  rawValue: string,
  label: string
) {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }

  body[key] = parsed;
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

function MetricCard({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: string;
  hint?: string;
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

function Button({
  children,
  disabled,
  variant = "default",
  onClick
}: {
  children: React.ReactNode;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger" | "soft";
  onClick: () => void;
}) {
  const variantStyle =
    variant === "primary"
      ? styles.buttonPrimary
      : variant === "danger"
        ? styles.buttonDanger
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

function StatusBadge({ status }: { status: PaperTradeStatus }) {
  return <span style={statusBadgeStyle(status)}>{status}</span>;
}

function SkipReasonList({ skipped }: { skipped: PaperTradeSkip[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();

    for (const item of skipped) {
      map.set(item.reason, (map.get(item.reason) ?? 0) + 1);
    }

    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [skipped]);

  if (skipped.length === 0) {
    return <div style={styles.empty}>No skipped signals.</div>;
  }

  return (
    <div style={styles.tableWrap}>
      <table style={styles.smallTable}>
        <thead>
          <tr>
            <th style={styles.th}>Reason</th>
            <th style={styles.th}>Count</th>
          </tr>
        </thead>
        <tbody>
          {counts.map(([reason, count]) => (
            <tr key={reason}>
              <td style={{ ...styles.td, ...styles.mono }}>{reason}</td>
              <td style={styles.td}>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunResultPanel({
  title,
  result
}: {
  title: string;
  result: PaperTradingRunResult | null;
}) {
  if (!result) {
    return null;
  }

  const planned = result.plannedTrades.slice(0, 12);
  const skipped = result.skipped.slice(0, 20);

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <div>
          <h2 style={styles.sectionTitle}>{title}</h2>
          <p style={styles.sectionDescription}>
            Run ID：<span style={styles.mono}>{result.runId}</span>
          </p>
        </div>
        <span
          style={{
            ...styles.badge,
            background: result.ok ? "#ecfdf5" : "#fef2f2",
            color: result.ok ? "#047857" : "#b91c1c"
          }}
        >
          {result.ok ? "OK" : "NOT OK"}
        </span>
      </div>

      {result.reason ? (
        <div style={{ ...styles.message, ...styles.errorMessage }}>
          {result.reason}
        </div>
      ) : null}

      <div style={styles.resultGrid}>
        <MetricCard
          label="Snapshot key"
          value={result.snapshotKey ?? "—"}
          hint="Selected signal snapshot batch"
          tone="muted"
        />
        <MetricCard
          label="Rows evaluated"
          value={formatNumber(result.evaluatedCount, 0)}
          hint={`Snapshot rows: ${result.snapshotRowCount}`}
        />
        <MetricCard
          label="Planned"
          value={formatNumber(result.plannedCount, 0)}
          tone={result.plannedCount > 0 ? "good" : "warn"}
        />
        <MetricCard
          label="Inserted"
          value={formatNumber(result.insertedCount, 0)}
          hint={result.dryRun ? "Dry run does not insert" : undefined}
          tone={result.insertedCount > 0 ? "good" : "default"}
        />
        <MetricCard
          label="Skipped"
          value={formatNumber(result.skippedCount, 0)}
          tone={result.skippedCount > 0 ? "warn" : "good"}
        />
        <MetricCard
          label="Daily risk after"
          value={formatUsd(result.riskAfter.dailyNotionalUsedUsd)}
          hint={`Remaining: ${formatUsd(
            result.riskAfter.dailyNotionalRemainingUsd
          )}`}
        />
      </div>

      <details style={styles.details} open>
        <summary style={styles.detailsSummary}>Planned trades</summary>
        <div style={{ height: "12px" }} />

        {planned.length === 0 ? (
          <div style={styles.empty}>No planned trades.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.smallTable}>
              <thead>
                <tr>
                  <th style={styles.th}>Outcome</th>
                  <th style={styles.th}>Side</th>
                  <th style={styles.th}>Entry</th>
                  <th style={styles.th}>Stake</th>
                  <th style={styles.th}>Notional</th>
                  <th style={styles.th}>Shares</th>
                  <th style={styles.th}>Edge</th>
                  <th style={styles.th}>Quality</th>
                </tr>
              </thead>
              <tbody>
                {planned.map((trade) => (
                  <tr
                    key={`${trade.signalSnapshotId}-${trade.outcomeName}-${trade.side}`}
                  >
                    <td style={styles.td}>{trade.outcomeName}</td>
                    <td style={{ ...styles.td, ...styles.mono }}>
                      {trade.side}
                    </td>
                    <td style={styles.td}>{formatNumber(trade.entryPrice)}</td>
                    <td style={styles.td}>
                      {formatPercent(trade.stakeFraction)}
                    </td>
                    <td style={styles.td}>{formatUsd(trade.notionalUsd)}</td>
                    <td style={styles.td}>{formatNumber(trade.shares, 6)}</td>
                    <td style={styles.td}>{formatPercent(trade.bestEdge)}</td>
                    <td style={styles.td}>
                      <span style={styles.pill}>
                        {trade.priceQuality ?? "—"} /{" "}
                        {formatPercent(trade.resolutionConfidence)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result.plannedTrades.length > planned.length ? (
          <p style={styles.sectionDescription}>
            Showing first {planned.length} of {result.plannedTrades.length}{" "}
            planned trades.
          </p>
        ) : null}
      </details>

      <details style={styles.details}>
        <summary style={styles.detailsSummary}>Skipped reason summary</summary>
        <div style={{ height: "12px" }} />
        <SkipReasonList skipped={result.skipped} />
      </details>

      <details style={styles.details}>
        <summary style={styles.detailsSummary}>Skipped details</summary>
        <div style={{ height: "12px" }} />

        {skipped.length === 0 ? (
          <div style={styles.empty}>No skipped details.</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.smallTable}>
              <thead>
                <tr>
                  <th style={styles.th}>Reason</th>
                  <th style={styles.th}>Outcome</th>
                  <th style={styles.th}>Side</th>
                  <th style={styles.th}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {skipped.map((item, index) => (
                  <tr
                    key={`${item.signalSnapshotId ?? "x"}-${item.reason}-${index}`}
                  >
                    <td style={{ ...styles.td, ...styles.mono }}>
                      {item.reason}
                    </td>
                    <td style={styles.td}>{item.outcomeName ?? "—"}</td>
                    <td style={{ ...styles.td, ...styles.mono }}>
                      {item.side ?? "—"}
                    </td>
                    <td style={styles.td}>{item.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result.skipped.length > skipped.length ? (
          <p style={styles.sectionDescription}>
            Showing first {skipped.length} of {result.skipped.length} skipped
            rows.
          </p>
        ) : null}
      </details>
    </section>
  );
}

function TradesTable({ trades }: { trades: PaperTradeRow[] }) {
  if (trades.length === 0) {
    return (
      <div style={styles.empty}>
        No trades loaded. Click <strong>Load trades</strong>, or create paper
        trades from the run controls.
      </div>
    );
  }

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>ID</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Created</th>
            <th style={styles.th}>Outcome</th>
            <th style={styles.th}>Side</th>
            <th style={styles.th}>Entry</th>
            <th style={styles.th}>Notional</th>
            <th style={styles.th}>Shares</th>
            <th style={styles.th}>Edge</th>
            <th style={styles.th}>P/L</th>
            <th style={styles.th}>Snapshot</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id}>
              <td style={{ ...styles.td, ...styles.mono }}>#{trade.id}</td>
              <td style={styles.td}>
                <StatusBadge status={trade.status} />
              </td>
              <td style={styles.td}>{formatDateTime(trade.createdAt)}</td>
              <td style={styles.td}>
                <strong>{trade.outcomeName}</strong>
                <div style={styles.sectionDescription}>
                  {trade.marketTitle ?? trade.marketSlug ?? "—"}
                </div>
                <div style={styles.sectionDescription}>
                  HKT: {trade.hktDate ?? "—"} · Target:{" "}
                  {trade.targetDate ?? "—"}
                </div>
              </td>
              <td style={{ ...styles.td, ...styles.mono }}>
                {trade.side}
                <div style={styles.sectionDescription}>{trade.strength}</div>
              </td>
              <td style={styles.td}>{formatNumber(trade.entryPrice)}</td>
              <td style={styles.td}>{formatUsd(trade.notionalUsd)}</td>
              <td style={styles.td}>{formatNumber(trade.shares, 6)}</td>
              <td style={styles.td}>
                {formatPercent(trade.bestEdge)}
                <div style={styles.sectionDescription}>
                  Quality: {trade.priceQuality ?? "—"}
                </div>
              </td>
              <td
                style={{
                  ...styles.td,
                  color: toneColor(pnlTone(trade.realizedPnlUsd)),
                  fontWeight: 850
                }}
              >
                {trade.realizedPnlUsd === null
                  ? "—"
                  : formatUsd(trade.realizedPnlUsd)}
                <div style={styles.sectionDescription}>
                  Won:{" "}
                  {trade.outcomeWon === null
                    ? "—"
                    : trade.outcomeWon
                      ? "Yes"
                      : "No"}
                </div>
              </td>
              <td style={{ ...styles.td, ...styles.mono }}>
                <div>{trade.snapshotKey}</div>
                <div style={styles.sectionDescription}>
                  Signal #{trade.signalSnapshotId ?? "—"}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PaperTradingPanel() {
  const [adminSecret, setAdminSecret] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [tradeSnapshotKey, setTradeSnapshotKey] = useState("");
  const [tradeLimit, setTradeLimit] = useState("100");

  const [runSnapshotKey, setRunSnapshotKey] = useState("");
  const [runLimit, setRunLimit] = useState("1000");
  const [forceRun, setForceRun] = useState(false);

  const [bankrollUsd, setBankrollUsd] = useState("");
  const [minStakeFraction, setMinStakeFraction] = useState("");
  const [maxStakeFraction, setMaxStakeFraction] = useState("");
  const [minNotionalUsd, setMinNotionalUsd] = useState("");
  const [maxNotionalUsdPerTrade, setMaxNotionalUsdPerTrade] = useState("");
  const [maxDailyNotionalUsd, setMaxDailyNotionalUsd] = useState("");
  const [maxOpenTrades, setMaxOpenTrades] = useState("");
  const [minResolutionConfidence, setMinResolutionConfidence] = useState("");
  const [minBestEdge, setMinBestEdge] = useState("");
  const [maxPriceAgeSeconds, setMaxPriceAgeSeconds] = useState("");
  const [allowedPriceQualities, setAllowedPriceQualities] = useState("");
  const [allowedStrengths, setAllowedStrengths] = useState("");

  const [settleSnapshotKey, setSettleSnapshotKey] = useState("");
  const [settleTargetDate, setSettleTargetDate] = useState("");
  const [settleHktDate, setSettleHktDate] = useState(getHktToday);

  const [tradesData, setTradesData] = useState<PaperTradesResponse | null>(
    null
  );
  const [dryRunResult, setDryRunResult] =
    useState<PaperTradingRunResult | null>(null);
  const [liveRunResult, setLiveRunResult] =
    useState<PaperTradingRunResult | null>(null);
  const [settleResult, setSettleResult] =
    useState<PaperTradeSettleResult | null>(null);

  const [loading, setLoading] = useState<LoadingKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isBusy = loading !== null;

  const requireAdminSecret = useCallback(() => {
    if (!adminSecret.trim()) {
      setError("Please enter x-admin-secret first.");
      setNotice(null);
      return false;
    }

    return true;
  }, [adminSecret]);

  const loadTrades = useCallback(
    async (silent = false) => {
      if (!requireAdminSecret()) {
        return;
      }

      if (!silent) {
        setLoading("load");
        setNotice(null);
      }

      setError(null);

      try {
        const params = new URLSearchParams();

        if (statusFilter.trim()) {
          params.set("status", statusFilter.trim());
        }

        if (tradeSnapshotKey.trim()) {
          params.set("snapshotKey", tradeSnapshotKey.trim());
        }

        if (tradeLimit.trim()) {
          params.set("limit", tradeLimit.trim());
        }

        const query = params.toString();
        const path = query
          ? `/api/paper-trading/trades?${query}`
          : "/api/paper-trading/trades";

        const envelope = await adminFetchEnvelope<PaperTradesResponse>(path, {
          adminSecret
        });

        if (!envelope.ok || !envelope.data) {
          throw new Error(envelope.error ?? "Failed to load paper trades.");
        }

        setTradesData(envelope.data);

        if (!silent) {
          setNotice(`Loaded ${envelope.data.count} paper trade row(s).`);
        }
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        if (!silent) {
          setLoading(null);
        }
      }
    },
    [
      adminSecret,
      requireAdminSecret,
      statusFilter,
      tradeLimit,
      tradeSnapshotKey
    ]
  );

  const buildRunBody = useCallback(
    (dryRun: boolean) => {
      const body: Record<string, unknown> = {
        dryRun,
        force: forceRun
      };

      if (runSnapshotKey.trim()) {
        body.snapshotKey = runSnapshotKey.trim();
      }

      addOptionalNumber(body, "limit", runLimit, "Run limit");
      addOptionalNumber(body, "bankrollUsd", bankrollUsd, "Bankroll USD");
      addOptionalNumber(
        body,
        "minStakeFraction",
        minStakeFraction,
        "Minimum stake fraction"
      );
      addOptionalNumber(
        body,
        "maxStakeFraction",
        maxStakeFraction,
        "Maximum stake fraction"
      );
      addOptionalNumber(
        body,
        "minNotionalUsd",
        minNotionalUsd,
        "Minimum notional USD"
      );
      addOptionalNumber(
        body,
        "maxNotionalUsdPerTrade",
        maxNotionalUsdPerTrade,
        "Maximum notional USD per trade"
      );
      addOptionalNumber(
        body,
        "maxDailyNotionalUsd",
        maxDailyNotionalUsd,
        "Maximum daily notional USD"
      );
      addOptionalNumber(
        body,
        "maxOpenTrades",
        maxOpenTrades,
        "Maximum open trades"
      );
      addOptionalNumber(
        body,
        "minResolutionConfidence",
        minResolutionConfidence,
        "Minimum resolution confidence"
      );
      addOptionalNumber(
        body,
        "minBestEdge",
        minBestEdge,
        "Minimum best edge"
      );
      addOptionalNumber(
        body,
        "maxPriceAgeSeconds",
        maxPriceAgeSeconds,
        "Maximum price age seconds"
      );

      if (allowedPriceQualities.trim()) {
        body.allowedPriceQualities = allowedPriceQualities.trim();
      }

      if (allowedStrengths.trim()) {
        body.allowedStrengths = allowedStrengths.trim();
      }

      return body;
    },
    [
      allowedPriceQualities,
      allowedStrengths,
      bankrollUsd,
      forceRun,
      maxDailyNotionalUsd,
      maxNotionalUsdPerTrade,
      maxOpenTrades,
      maxPriceAgeSeconds,
      maxStakeFraction,
      minBestEdge,
      minNotionalUsd,
      minResolutionConfidence,
      minStakeFraction,
      runLimit,
      runSnapshotKey
    ]
  );

  const runPaperTrading = useCallback(
    async (dryRun: boolean) => {
      if (!requireAdminSecret()) {
        return;
      }

      setLoading(dryRun ? "dryRun" : "run");
      setError(null);
      setNotice(null);

      try {
        const body = buildRunBody(dryRun);

        const envelope = await adminFetchEnvelope<PaperTradingRunResult>(
          "/api/paper-trading/run",
          {
            adminSecret,
            method: "POST",
            body
          }
        );

        if (!envelope.data) {
          throw new Error(envelope.error ?? "Paper trading run failed.");
        }

        if (dryRun) {
          setDryRunResult(envelope.data);
        } else {
          setLiveRunResult(envelope.data);
        }

        if (!envelope.ok || !envelope.data.ok) {
          setError(
            envelope.data.reason ??
              envelope.error ??
              "Paper trading run did not complete."
          );
        } else {
          setNotice(
            dryRun
              ? `Dry run completed. Planned ${envelope.data.plannedCount}, skipped ${envelope.data.skippedCount}.`
              : `Paper run completed. Inserted ${envelope.data.insertedCount}, skipped ${envelope.data.skippedCount}.`
          );
        }

        await loadTrades(true);
      } catch (runError) {
        setError(getErrorMessage(runError));
      } finally {
        setLoading(null);
      }
    },
    [adminSecret, buildRunBody, loadTrades, requireAdminSecret]
  );

  const settleTrades = useCallback(async () => {
    if (!requireAdminSecret()) {
      return;
    }

    setLoading("settle");
    setError(null);
    setNotice(null);

    try {
      const body: Record<string, unknown> = {};

      if (settleSnapshotKey.trim()) {
        body.snapshotKey = settleSnapshotKey.trim();
      }

      if (settleTargetDate.trim()) {
        body.targetDate = settleTargetDate.trim();
      }

      if (settleHktDate.trim()) {
        body.hktDate = settleHktDate.trim();
      }

      const envelope = await adminFetchEnvelope<PaperTradeSettleResult>(
        "/api/paper-trading/settle",
        {
          adminSecret,
          method: "POST",
          body
        }
      );

      if (!envelope.ok || !envelope.data) {
        throw new Error(envelope.error ?? "Failed to settle paper trades.");
      }

      setSettleResult(envelope.data);
      setNotice(
        `Settled ${envelope.data.settledCount} paper trade(s). Realized P/L: ${formatUsd(
          envelope.data.totalRealizedPnlUsd
        )}.`
      );

      await loadTrades(true);
    } catch (settleError) {
      setError(getErrorMessage(settleError));
    } finally {
      setLoading(null);
    }
  }, [
    adminSecret,
    loadTrades,
    requireAdminSecret,
    settleHktDate,
    settleSnapshotKey,
    settleTargetDate
  ]);

  const summary = tradesData?.summary ?? null;
  const risk = tradesData?.risk ?? null;
  const config = tradesData?.config ?? null;
  const trades = tradesData?.trades ?? [];

  const latestSnapshotKey = useMemo(() => {
    if (trades.length === 0) {
      return "—";
    }

    return trades[0]?.snapshotKey ?? "—";
  }, [trades]);

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.eyebrow}>PR-3 Admin UI</div>
          <h1 style={styles.title}>Paper Trading Panel</h1>
          <p style={styles.subtitle}>
            Admin-only dashboard for PR-2 auto paper trading. This UI only
            writes to the paper ledger via your server APIs. It does not place
            real exchange orders.
          </p>
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

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Auth and trade filters</h2>
              <p style={styles.sectionDescription}>
                Admin secret is kept in browser state only. It is not saved to
                localStorage.
              </p>
            </div>
            <div style={styles.buttonRow}>
              <Button
                disabled={isBusy}
                variant="primary"
                onClick={() => {
                  void loadTrades(false);
                }}
              >
                {loading === "load" ? "Loading..." : "Load trades"}
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
              Status
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
              Snapshot key filter
              <input
                type="text"
                value={tradeSnapshotKey}
                onChange={(event) => setTradeSnapshotKey(event.target.value)}
                placeholder="Optional"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Limit
              <input
                type="number"
                min="1"
                max="1000"
                value={tradeLimit}
                onChange={(event) => setTradeLimit(event.target.value)}
                style={styles.input}
              />
            </label>
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Summary</h2>
              <p style={styles.sectionDescription}>
                Latest loaded ledger summary. Click Load trades after deploy or
                after a run.
              </p>
            </div>
            <span style={styles.pill}>
              Database:{" "}
              {tradesData ? (tradesData.databaseEnabled ? "enabled" : "off") : "—"}
            </span>
          </div>

          {!tradesData || !summary || !risk || !config ? (
            <div style={styles.empty}>
              No summary loaded yet. Enter your admin secret and click{" "}
              <strong>Load trades</strong>.
            </div>
          ) : (
            <div style={styles.grid}>
              <MetricCard
                label="Total trades"
                value={formatNumber(summary.totalTrades, 0)}
                hint={`Latest snapshot: ${latestSnapshotKey}`}
              />
              <MetricCard
                label="Open trades"
                value={formatNumber(summary.openTrades, 0)}
                tone={summary.openTrades > 0 ? "warn" : "default"}
                hint={`Open slots left: ${risk.openTradeSlotsRemaining}`}
              />
              <MetricCard
                label="Settled trades"
                value={formatNumber(summary.settledTrades, 0)}
              />
              <MetricCard
                label="Realized P/L"
                value={formatUsd(summary.realizedPnlUsd)}
                tone={pnlTone(summary.realizedPnlUsd)}
              />
              <MetricCard
                label="Estimated bankroll"
                value={formatUsd(summary.estimatedBankrollUsd)}
                hint={`Base bankroll: ${formatUsd(config.bankrollUsd)}`}
              />
              <MetricCard
                label="Open notional"
                value={formatUsd(summary.openNotionalUsd)}
                hint={`Worst-case open loss: ${formatUsd(
                  summary.worstCaseOpenLossUsd
                )}`}
              />
              <MetricCard
                label="Daily notional used"
                value={formatUsd(risk.dailyNotionalUsedUsd)}
                hint={`Remaining: ${formatUsd(
                  risk.dailyNotionalRemainingUsd
                )} · HKT ${risk.hktDate}`}
              />
              <MetricCard
                label="Paper enabled"
                value={config.enabled ? "Yes" : "No"}
                tone={config.enabled ? "good" : "bad"}
                hint={`Max open: ${config.maxOpenTrades}`}
              />
            </div>
          )}
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Run auto paper trading</h2>
              <p style={styles.sectionDescription}>
                Start with Dry run. Actual run only inserts paper trades into{" "}
                <span style={styles.mono}>paper_trades</span>.
              </p>
            </div>
            <div style={styles.buttonRow}>
              <Button
                disabled={isBusy}
                variant="soft"
                onClick={() => {
                  void runPaperTrading(true);
                }}
              >
                {loading === "dryRun" ? "Dry running..." : "Dry run"}
              </Button>
              <Button
                disabled={isBusy}
                variant="primary"
                onClick={() => {
                  void runPaperTrading(false);
                }}
              >
                {loading === "run" ? "Running..." : "Create paper trades"}
              </Button>
            </div>
          </div>

          <div style={styles.formGrid}>
            <label style={styles.label}>
              Snapshot key
              <input
                type="text"
                value={runSnapshotKey}
                onChange={(event) => setRunSnapshotKey(event.target.value)}
                placeholder="Blank = latest snapshot"
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Snapshot fetch limit
              <input
                type="number"
                min="1"
                max="5000"
                value={runLimit}
                onChange={(event) => setRunLimit(event.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={forceRun}
                onChange={(event) => setForceRun(event.target.checked)}
                style={styles.checkbox}
              />
              Force if PAPER_TRADING_ENABLED=false
            </label>
          </div>

          <details style={styles.details}>
            <summary style={styles.detailsSummary}>
              Optional run overrides
            </summary>

            <div style={{ height: "12px" }} />

            <div style={styles.compactGrid}>
              <label style={styles.label}>
                Bankroll USD
                <input
                  type="number"
                  value={bankrollUsd}
                  onChange={(event) => setBankrollUsd(event.target.value)}
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Min stake fraction
                <input
                  type="number"
                  step="0.0001"
                  value={minStakeFraction}
                  onChange={(event) =>
                    setMinStakeFraction(event.target.value)
                  }
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Max stake fraction
                <input
                  type="number"
                  step="0.0001"
                  value={maxStakeFraction}
                  onChange={(event) =>
                    setMaxStakeFraction(event.target.value)
                  }
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Min notional USD
                <input
                  type="number"
                  value={minNotionalUsd}
                  onChange={(event) => setMinNotionalUsd(event.target.value)}
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Max notional / trade
                <input
                  type="number"
                  value={maxNotionalUsdPerTrade}
                  onChange={(event) =>
                    setMaxNotionalUsdPerTrade(event.target.value)
                  }
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Max daily notional
                <input
                  type="number"
                  value={maxDailyNotionalUsd}
                  onChange={(event) =>
                    setMaxDailyNotionalUsd(event.target.value)
                  }
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Max open trades
                <input
                  type="number"
                  value={maxOpenTrades}
                  onChange={(event) => setMaxOpenTrades(event.target.value)}
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Min resolution confidence
                <input
                  type="number"
                  step="0.01"
                  value={minResolutionConfidence}
                  onChange={(event) =>
                    setMinResolutionConfidence(event.target.value)
                  }
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Min best edge
                <input
                  type="number"
                  step="0.001"
                  value={minBestEdge}
                  onChange={(event) => setMinBestEdge(event.target.value)}
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Max price age seconds
                <input
                  type="number"
                  value={maxPriceAgeSeconds}
                  onChange={(event) =>
                    setMaxPriceAgeSeconds(event.target.value)
                  }
                  placeholder="env default"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Allowed price qualities
                <input
                  type="text"
                  value={allowedPriceQualities}
                  onChange={(event) =>
                    setAllowedPriceQualities(event.target.value)
                  }
                  placeholder="GOOD,FAIR"
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Allowed strengths
                <input
                  type="text"
                  value={allowedStrengths}
                  onChange={(event) => setAllowedStrengths(event.target.value)}
                  placeholder="LOW,MEDIUM,STRONG"
                  style={styles.input}
                />
              </label>
            </div>
          </details>
        </section>

        <RunResultPanel title="Latest dry run result" result={dryRunResult} />
        <RunResultPanel title="Latest paper run result" result={liveRunResult} />

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Settle paper trades</h2>
              <p style={styles.sectionDescription}>
                Usually run this after{" "}
                <span style={styles.mono}>/api/signals/settle</span> has
                settled signal snapshots.
              </p>
            </div>
            <div style={styles.buttonRow}>
              <Button
                disabled={isBusy}
                variant="danger"
                onClick={() => {
                  void settleTrades();
                }}
              >
                {loading === "settle" ? "Settling..." : "Settle paper trades"}
              </Button>
            </div>
          </div>

          <div style={styles.formGrid}>
            <label style={styles.label}>
              HKT date
              <input
                type="date"
                value={settleHktDate}
                onChange={(event) => setSettleHktDate(event.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Target date
              <input
                type="date"
                value={settleTargetDate}
                onChange={(event) => setSettleTargetDate(event.target.value)}
                style={styles.input}
              />
            </label>

            <label style={styles.label}>
              Snapshot key
              <input
                type="text"
                value={settleSnapshotKey}
                onChange={(event) => setSettleSnapshotKey(event.target.value)}
                placeholder="Optional"
                style={styles.input}
              />
            </label>
          </div>

          <p style={styles.sectionDescription}>
            If all three fields are blank, the API will attempt to settle all
            open paper trades that already have settled signal snapshots.
          </p>

          {settleResult ? (
            <div style={{ marginTop: "12px" }}>
              <div style={styles.codeLine}>
                Settled {settleResult.settledCount} trade(s), realized P/L{" "}
                {formatUsd(settleResult.totalRealizedPnlUsd)}. Filters:{" "}
                {JSON.stringify(settleResult.filters)}
              </div>
            </div>
          ) : null}
        </section>

        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Paper trades</h2>
              <p style={styles.sectionDescription}>
                Loaded rows: {trades.length}
              </p>
            </div>
            <div style={styles.buttonRow}>
              <Button
                disabled={isBusy}
                onClick={() => {
                  void loadTrades(false);
                }}
              >
                Refresh
              </Button>
            </div>
          </div>

          <TradesTable trades={trades} />
        </section>
      </div>
    </main>
  );
}
