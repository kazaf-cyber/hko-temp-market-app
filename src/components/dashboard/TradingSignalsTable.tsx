"use client";

import type { ForecastResult } from "@/types";
import type { OutcomeTradeSignal, TradeSide } from "@/lib/trading/types";

type TradingSignalsTableProps = {
  forecast: ForecastResult | null | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTradeSignal(value: unknown): value is OutcomeTradeSignal {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.outcomeName === "string" &&
    typeof value.side === "string" &&
    typeof value.strength === "string"
  );
}

function getSignals(forecast: ForecastResult | null | undefined): OutcomeTradeSignal[] {
  if (!forecast || !isRecord(forecast)) {
    return [];
  }

  const raw = Array.isArray(forecast.tradeSignals)
    ? forecast.tradeSignals
    : Array.isArray(forecast.tradingSignals)
      ? forecast.tradingSignals
      : [];

  return raw.filter(isTradeSignal);
}

function getTopSignal(
  forecast: ForecastResult | null | undefined,
  signals: OutcomeTradeSignal[]
): OutcomeTradeSignal | null {
  if (forecast && isRecord(forecast) && isTradeSignal(forecast.topTradeSignal)) {
    return forecast.topTradeSignal;
  }

  return (
    signals
      .filter((signal) => signal.shouldTrade && typeof signal.bestEdge === "number")
      .sort((a, b) => (b.bestEdge ?? -Infinity) - (a.bestEdge ?? -Infinity))[0] ?? null
  );
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${(value * 100).toFixed(digits)}%`;
}

function formatSignedPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  const sign = value > 0 ? "+" : "";

  return `${sign}${(value * 100).toFixed(digits)}%`;
}

function sideClassName(side: TradeSide): string {
  if (side === "BUY_YES") {
    return "bg-emerald-950 text-emerald-200 ring-emerald-700";
  }

  if (side === "BUY_NO") {
    return "bg-amber-950 text-amber-200 ring-amber-700";
  }

  return "bg-slate-800 text-slate-300 ring-slate-700";
}

function edgeClassName(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "text-slate-500";
  }

  if (value > 0) {
    return "text-emerald-300";
  }

  if (value < 0) {
    return "text-red-300";
  }

  return "text-slate-300";
}

function qualityClassName(signal: OutcomeTradeSignal): string {
  if (signal.priceQuality === "GOOD") {
    return "text-emerald-300";
  }

  if (signal.priceQuality === "WIDE_SPREAD") {
    return "text-amber-300";
  }

  if (signal.priceQuality === "STALE" || signal.priceQuality === "MISSING_PRICE") {
    return "text-red-300";
  }

  return "text-slate-300";
}

export function TradingSignalsTable({ forecast }: TradingSignalsTableProps) {
  const signals = getSignals(forecast);

  if (!forecast) {
    return null;
  }

  const topSignal = getTopSignal(forecast, signals);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Executable trading signals</h2>
          <p className="mt-1 text-sm text-slate-400">
            Uses executable YES/NO ask prices and uncertainty buffers. This table is
            intentionally stricter than midpoint edge.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm">
          <p className="text-slate-400">Top signal</p>

          {topSignal ? (
            <div className="mt-2">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${sideClassName(
                  topSignal.side
                )}`}
              >
                {topSignal.side} / {topSignal.strength}
              </span>

              <p className="mt-2 font-semibold text-slate-100">{topSignal.outcomeName}</p>

              <p className="mt-1 text-slate-400">
                Edge:{" "}
                <span className={edgeClassName(topSignal.bestEdge)}>
                  {formatSignedPercent(topSignal.bestEdge)}
                </span>{" "}
                · Required: {formatPercent(topSignal.requiredEdge)}
              </p>

              <p className="mt-1 text-slate-400">
                Stake cap: {formatPercent(topSignal.recommendedStakeFraction, 2)}
              </p>
            </div>
          ) : (
            <p className="mt-2 font-semibold text-slate-300">NO_TRADE</p>
          )}
        </div>
      </div>

      {signals.length === 0 ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
          No trade signals returned yet. Run forecast again after deploying the v3 edge
          engine patch.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="border-b border-slate-800 py-3 pr-4">Outcome</th>
                <th className="border-b border-slate-800 py-3 pr-4">Signal</th>
                <th className="border-b border-slate-800 py-3 pr-4">Model P</th>
                <th className="border-b border-slate-800 py-3 pr-4">YES ask</th>
                <th className="border-b border-slate-800 py-3 pr-4">YES edge</th>
                <th className="border-b border-slate-800 py-3 pr-4">NO ask</th>
                <th className="border-b border-slate-800 py-3 pr-4">NO edge</th>
                <th className="border-b border-slate-800 py-3 pr-4">Required</th>
                <th className="border-b border-slate-800 py-3 pr-4">Max entry</th>
                <th className="border-b border-slate-800 py-3 pr-4">Stake</th>
                <th className="border-b border-slate-800 py-3 pr-4">Quality</th>
              </tr>
            </thead>

            <tbody>
              {signals.map((signal) => {
                const maxEntry =
                  signal.side === "BUY_YES"
                    ? signal.maxYesEntry
                    : signal.side === "BUY_NO"
                      ? signal.maxNoEntry
                      : null;

                return (
                  <tr key={signal.outcomeName} className="align-top">
                    <td className="border-b border-slate-800 py-3 pr-4">
                      <div className="font-medium text-slate-100">{signal.outcomeName}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Source: {signal.probabilitySource}
                      </div>
                    </td>

                    <td className="border-b border-slate-800 py-3 pr-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${sideClassName(
                          signal.side
                        )}`}
                      >
                        {signal.side} / {signal.strength}
                      </span>

                      <div className="mt-2 space-y-1 text-xs text-slate-500">
                        {signal.reasons.slice(0, 2).map((reason) => (
                          <div key={reason}>{reason}</div>
                        ))}
                      </div>
                    </td>

                    <td className="border-b border-slate-800 py-3 pr-4">
                      {formatPercent(signal.modelProbability)}
                    </td>

                    <td className="border-b border-slate-800 py-3 pr-4">
                      {formatPercent(signal.yesAsk)}
                    </td>

                    <td
                      className={`border-b border-slate-800 py-3 pr-4 ${edgeClassName(
                        signal.yesEdge
                      )}`}
                    >
                      {formatSignedPercent(signal.yesEdge)}
                    </td>

                    <td className="border-b border-slate-800 py-3 pr-4">
                      {formatPercent(signal.noAsk)}
                    </td>

                    <td
                      className={`border-b border-slate-800 py-3 pr-4 ${edgeClassName(
                        signal.noEdge
                      )}`}
                    >
                      {formatSignedPercent(signal.noEdge)}
                    </td>

                    <td className="border-b border-slate-800 py-3 pr-4">
                      {formatPercent(signal.requiredEdge)}
                    </td>

                    <td className="border-b border-slate-800 py-3 pr-4">
                      {formatPercent(maxEntry)}
                    </td>

                    <td className="border-b border-slate-800 py-3 pr-4">
                      {formatPercent(signal.recommendedStakeFraction, 2)}
                    </td>

                    <td className="border-b border-slate-800 py-3 pr-4">
                      <div className={qualityClassName(signal)}>{signal.priceQuality}</div>

                      {signal.warnings.length > 0 && (
                        <div className="mt-2 space-y-1 text-xs text-amber-300">
                          {signal.warnings.slice(0, 2).map((warning) => (
                            <div key={warning}>{warning}</div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
