"use client";

import { useMemo, useState } from "react";

type ArchiveRecordPreview = {
  id?: string;
  savedAt?: string;
  hktDate?: string | null;
  version?: string | null;
  target?: {
    estimatedFinalMaxC?: number | null;
    observedMaxLowerBoundC?: number | null;
    confidenceLabel?: string | null;
  };
  outcomeProbabilities?: Array<{
    outcomeName?: string;
    finalProbability?: number | null;
    weatherProbability?: number | null;
    marketProbability?: number | null;
  }>;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  record?: ArchiveRecordPreview;
  records?: ArchiveRecordPreview[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPath(value: unknown, pathParts: string[]): unknown {
  let current: unknown = value;

  for (const part of pathParts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }

    if (!isRecord(current)) return undefined;
    current = current[part];
  }

  return current;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatTemp(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${value.toFixed(2)}°C`;
}

function formatProbability(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;

  return new Intl.DateTimeFormat("en-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(parsed));
}

function getBestOutcome(record: ArchiveRecordPreview) {
  const rows = Array.isArray(record.outcomeProbabilities)
    ? record.outcomeProbabilities
    : [];

  return rows
    .filter((row) => typeof row.finalProbability === "number")
    .sort((a, b) => (b.finalProbability ?? 0) - (a.finalProbability ?? 0))[0];
}

export default function ForecastArchivePanel({ forecast }: { forecast: unknown | null }) {
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingLatest, setIsLoadingLatest] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestRecords, setLatestRecords] = useState<ArchiveRecordPreview[]>([]);

  const forecastLabel = useMemo(() => {
    const hktDate =
      asString(readPath(forecast, ["hktDate"])) ??
      asString(readPath(forecast, ["weatherEvidence", "targetDateHkt"])) ??
      "unknown date";

    const generatedAt = asString(readPath(forecast, ["generatedAt"]));
    const observedMax =
      asNumber(readPath(forecast, ["weatherEvidence", "observed", "observedMaxLowerBoundC"])) ??
      asNumber(readPath(forecast, ["weather", "observedMaxLowerBoundC"])) ??
      asNumber(readPath(forecast, ["weather", "observedMaxC"]));

    const estimatedFinal =
      asNumber(readPath(forecast, ["model", "estimatedFinalMaxC"])) ??
      asNumber(readPath(forecast, ["weather", "forecastFinalMaxMeanC"])) ??
      asNumber(readPath(forecast, ["estimatedFinalMaxC"]));

    return {
      hktDate,
      generatedAt,
      observedMax,
      estimatedFinal
    };
  }, [forecast]);

  async function saveSnapshot() {
    if (!forecast || isSaving) return;

    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/forecast-archive", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          source: "manual-ui",
          forecast
        })
      });

      const payload = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? `Archive request failed: ${response.status}`);
      }

      const id = payload.record?.id;
      setMessage(id ? `Saved snapshot: ${id}` : "Saved snapshot.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unknown save error");
    } finally {
      setIsSaving(false);
    }
  }

  async function loadLatest() {
    if (isLoadingLatest) return;

    setIsLoadingLatest(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/forecast-archive?limit=8", {
        method: "GET",
        cache: "no-store"
      });

      const payload = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? `Archive load failed: ${response.status}`);
      }

      setLatestRecords(Array.isArray(payload.records) ? payload.records : []);
      setMessage("Loaded latest archive snapshots.");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown load error");
    } finally {
      setIsLoadingLatest(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">
            Forecast Archive
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            PR-6A snapshot logger：儲存今次 forecast、weather evidence、outcome
            probabilities，用嚟之後做 calibration / post-mortem / backtest dataset。
          </p>

          <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-slate-950 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                HKT Date
              </div>
              <div className="mt-1 font-semibold text-slate-100">
                {forecastLabel.hktDate}
              </div>
            </div>

            <div className="rounded-xl bg-slate-950 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Generated
              </div>
              <div className="mt-1 font-semibold text-slate-100">
                {formatDateTime(forecastLabel.generatedAt)}
              </div>
            </div>

            <div className="rounded-xl bg-slate-950 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Observed floor
              </div>
              <div className="mt-1 font-semibold text-cyan-300">
                {formatTemp(forecastLabel.observedMax)}
              </div>
            </div>

            <div className="rounded-xl bg-slate-950 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Estimated final
              </div>
              <div className="mt-1 font-semibold text-emerald-300">
                {formatTemp(forecastLabel.estimatedFinal)}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <button
            type="button"
            onClick={saveSnapshot}
            disabled={!forecast || isSaving}
            className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {isSaving ? "Saving..." : "Save snapshot"}
          </button>

          <button
            type="button"
            onClick={loadLatest}
            disabled={isLoadingLatest}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-500"
          >
            {isLoadingLatest ? "Loading..." : "Load latest"}
          </button>
        </div>
      </div>

      {message && (
        <div className="mt-4 rounded-xl border border-emerald-900 bg-emerald-950 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-900 bg-red-950 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {latestRecords.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-800">
          <div className="bg-slate-950 px-4 py-3 text-sm font-semibold text-slate-200">
            Latest archive snapshots
          </div>

          <div className="divide-y divide-slate-800">
            {latestRecords.map((record) => {
              const bestOutcome = getBestOutcome(record);

              return (
                <div
                  key={record.id ?? `${record.savedAt}-${record.hktDate}`}
                  className="grid gap-3 px-4 py-3 text-sm text-slate-300 md:grid-cols-5"
                >
                  <div>
                    <div className="text-xs text-slate-500">Saved</div>
                    <div>{formatDateTime(record.savedAt)}</div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-500">HKT Date</div>
                    <div>{record.hktDate ?? "--"}</div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-500">Observed floor</div>
                    <div>{formatTemp(record.target?.observedMaxLowerBoundC)}</div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-500">Estimated final</div>
                    <div>{formatTemp(record.target?.estimatedFinalMaxC)}</div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-500">Top outcome</div>
                    <div>
                      {bestOutcome?.outcomeName ?? "--"}{" "}
                      {bestOutcome?.finalProbability !== null &&
                      bestOutcome?.finalProbability !== undefined
                        ? `(${formatProbability(bestOutcome.finalProbability)})`
                        : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
