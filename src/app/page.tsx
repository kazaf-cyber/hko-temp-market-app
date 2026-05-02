"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ForecastResult,
  HkoWeatherSnapshot,
  MarketState,
  RainIntensity,
  SettlementResult
} from "@/types";
import { defaultMarketState } from "@/lib/defaults";
import { TradingSignalsTable } from "@/components/dashboard/TradingSignalsTable";
type StateResponse = {
  ok: boolean;
  data?: {
    state: MarketState;
    databaseEnabled: boolean;
    persisted: boolean;
  };
  error?: string;
};

type PolymarketResponse = {
  ok: boolean;
  data?: {
    slug: string;
    eventTitle: string | null;
    marketQuestion: string | null;
    marketSlug: string | null;
    outcomes: MarketState["outcomes"];
  };
  error?: string;
};

type WeatherResponse = {
  ok: boolean;
  data?: HkoWeatherSnapshot;
  error?: string;
};

type ForecastResponse = {
  ok: boolean;
  data?: {
    result: ForecastResult;
    weather: HkoWeatherSnapshot;
    historySave?: {
  saved: boolean;
  reason: string | null;
   } | null;
  };
  error?: string;
};

type HistoryRow = {
  id: number;
  createdAt: string;
  hktDate: string;
  result: ForecastResult;
};

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-900";

const buttonPrimary =
  "rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50";

const buttonSecondary =
  "rounded-xl bg-slate-700 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50";

function formatTemp(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${value.toFixed(1)}°C`;
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (!isPlainRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const match = value.trim().match(/-?\d+(?:\.\d+)?/);

    if (!match) {
      return null;
    }

    const parsed = Number(match[0]);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function firstDisplayNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numberFromUnknown(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}
function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "--";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value * 100)}%`;
}

function getOutcomeMarketPrice(outcome: MarketState["outcomes"][number]) {
  if (typeof outcome.clobMidpoint === "number") {
    return outcome.clobMidpoint;
  }

  if (typeof outcome.marketPrice === "number") {
    return outcome.marketPrice;
  }

  if (typeof outcome.price === "number") {
    return outcome.price;
  }

  return null;
}

function formatHktDateTime(isoString: string | null | undefined) {
  if (!isoString) {
    return "--";
  }

  const date = new Date(isoString);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleString("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    hour12: false
  });
}

function rangeLabel(lower: number | null, upper: number | null) {
  if (lower === null && upper !== null) {
    return `< ${upper.toFixed(1)}°C`;
  }

  if (lower !== null && upper === null) {
    return `≥ ${lower.toFixed(1)}°C`;
  }

  if (lower !== null && upper !== null) {
    return `${lower.toFixed(1)}°C to < ${upper.toFixed(1)}°C`;
  }

  return "Any";
}

function getYesterdayHktCompact() {
  const now = new Date();
  const hktNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" })
  );

  hktNow.setDate(hktNow.getDate() - 1);

  const year = hktNow.getFullYear();
  const month = String(hktNow.getMonth() + 1).padStart(2, "0");
  const day = String(hktNow.getDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

function Card({
  label,
  value,
  sub
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-50">{value}</p>
      {sub && <p className="mt-2 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function HomePage() {
  const [state, setState] = useState<MarketState>(defaultMarketState);
  const [weather, setWeather] = useState<HkoWeatherSnapshot | null>(null);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);

  const [polymarketUrl, setPolymarketUrl] = useState(
    "https://polymarket.com/zh-hant/event/highest-temperature-in-hong-kong-on-may-1-2026"
  );

  const [loadingPolymarket, setLoadingPolymarket] = useState(false);
  const [adminSecret, setAdminSecret] = useState("");
  const [outcomesJson, setOutcomesJson] = useState(
    JSON.stringify(defaultMarketState.outcomes, null, 2)
  );
  const [settlementDate, setSettlementDate] = useState(getYesterdayHktCompact());

  const [databaseEnabled, setDatabaseEnabled] = useState(false);
  const [persisted, setPersisted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const officialForecastMax = useMemo(
    () => weather?.forecast?.days?.[0]?.forecastMaxtempC ?? null,
    [weather]
  );

  const hkoCurrentTempC = useMemo(
    () =>
      firstDisplayNumber(
        readPath(weather, ["current", "hkoCurrentTempC"]),
        readPath(weather, ["current", "currentTempC"]),
        readPath(weather, ["current", "temperatureC"]),
        readPath(weather, ["current", "tempC"]),
        readPath(weather, ["hkoCurrentTempC"]),
        readPath(weather, ["currentTempC"]),
        readPath(weather, ["temperatureC"]),
        readPath(weather, ["hko", "currentTempC"]),
        readPath(weather, ["hko", "hkoCurrentTempC"]),

        readPath(forecast, ["hkoCurrentTempC"]),
        readPath(forecast, ["weather", "current", "hkoCurrentTempC"]),
        readPath(forecast, ["weather", "hkoCurrentTempC"]),
        readPath(forecast, ["hko", "currentTempC"])
      ),
    [weather, forecast]
  );

  const hkoMaxSinceMidnightC = useMemo(
    () =>
      firstDisplayNumber(
        readPath(weather, ["sinceMidnight", "maxTempC"]),
        readPath(weather, ["sinceMidnight", "maxTemperatureC"]),
        readPath(weather, ["hkoMaxSinceMidnightC"]),
        readPath(weather, ["maxSinceMidnightC"]),
        readPath(weather, ["maxSoFarC"]),
        readPath(weather, ["observedMaxSoFarC"]),
        readPath(weather, ["observedMaxLowerBoundC"]),
        readPath(weather, ["observedFinalMaxLowerBoundC"]),
        readPath(weather, ["hko", "maxSinceMidnightC"]),
        readPath(weather, ["hko", "hkoMaxSinceMidnightC"]),

        readPath(forecast, ["hkoMaxSinceMidnightC"]),
        readPath(forecast, ["maxSoFarC"]),
        readPath(forecast, ["observedMaxLowerBoundC"]),
        readPath(forecast, ["observedFinalMaxLowerBoundC"]),
        readPath(forecast, ["weather", "sinceMidnight", "maxTempC"]),
        readPath(forecast, ["weather", "hkoMaxSinceMidnightC"]),
        readPath(forecast, ["hko", "maxSinceMidnightC"])
      ),
    [weather, forecast]
  );

  const hkoMinSinceMidnightC = useMemo(
    () =>
      firstDisplayNumber(
        readPath(weather, ["sinceMidnight", "minTempC"]),
        readPath(weather, ["sinceMidnight", "minTemperatureC"]),
        readPath(weather, ["hkoMinSinceMidnightC"]),
        readPath(weather, ["minSinceMidnightC"]),
        readPath(forecast, ["weather", "sinceMidnight", "minTempC"]),
        readPath(forecast, ["weather", "hkoMinSinceMidnightC"])
      ),
    [weather, forecast]
  );

  const hkoCurrentRecordTime = useMemo(
    () =>
      firstNonEmptyString(
        readPath(weather, ["current", "recordTime"]),
        readPath(weather, ["current", "obsTime"]),
        readPath(weather, ["recordTime"]),
        readPath(weather, ["obsTime"]),
        readPath(forecast, ["weather", "current", "recordTime"]),
        readPath(forecast, ["generatedAt"])
      ),
    [weather, forecast]
  );

  const hkoMaxSinceMidnightTime = useMemo(
    () =>
      firstNonEmptyString(
        readPath(weather, ["sinceMidnight", "maxTempTime"]),
        readPath(weather, ["sinceMidnight", "maxTime"]),
        readPath(weather, ["maxTempTime"]),
        readPath(forecast, ["weather", "sinceMidnight", "maxTempTime"]),
        readPath(forecast, ["generatedAt"])
      ),
    [weather, forecast]
  );

  const hkoMinSinceMidnightTime = useMemo(
    () =>
      firstNonEmptyString(
        readPath(weather, ["sinceMidnight", "minTempTime"]),
        readPath(weather, ["sinceMidnight", "minTime"]),
        readPath(weather, ["minTempTime"]),
        readPath(forecast, ["weather", "sinceMidnight", "minTempTime"])
      ),
    [weather, forecast]
  );
  
  function updateState(partial: Partial<MarketState>) {
    setState((previous) => ({
      ...previous,
      ...partial
    }));
  }

  async function loadState() {
    const response = await fetch("/api/state", {
      cache: "no-store"
    });

    const json = (await response.json()) as StateResponse;

    if (!json.ok || !json.data) {
      throw new Error(json.error || "Failed to load state.");
    }

    setState(json.data.state);
    setOutcomesJson(JSON.stringify(json.data.state.outcomes ?? [], null, 2));
    setDatabaseEnabled(json.data.databaseEnabled);
    setPersisted(json.data.persisted);
  }

  async function loadWeather() {
    const response = await fetch("/api/weather", {
      cache: "no-store"
    });

    const json = (await response.json()) as WeatherResponse;

    if (!json.ok || !json.data) {
      throw new Error(json.error || "Failed to load weather.");
    }

    setWeather(json.data);
  }

  async function loadHistory() {
    const response = await fetch("/api/history?limit=20", {
      cache: "no-store"
    });

    const json = (await response.json()) as {
      ok: boolean;
      data?: {
        databaseEnabled: boolean;
        history: HistoryRow[];
      };
      error?: string;
    };

    if (json.ok && json.data) {
      setHistory(json.data.history);
    }
  }

  async function loadPolymarketOutcomes() {
    setLoadingPolymarket(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/polymarket?includeClob=1&url=${encodeURIComponent(
          polymarketUrl
        )}`,
        {
          cache: "no-store"
        }
      );

      const json = (await response.json()) as PolymarketResponse;

      if (!json.ok || !json.data) {
        throw new Error(json.error || "Failed to load Polymarket outcomes.");
      }

      const nextOutcomes = json.data.outcomes;

      setState((previous) => ({
        ...previous,
        outcomes: nextOutcomes
      }));

      setOutcomesJson(JSON.stringify(nextOutcomes, null, 2));

      setMessage(
        `Loaded ${nextOutcomes.length} Polymarket outcomes from ${json.data.slug}. Now run forecast again.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unknown Polymarket loading error."
      );
    } finally {
      setLoadingPolymarket(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      await Promise.all([loadState(), loadWeather(), loadHistory()]);
      setMessage("Loaded latest HKO data and market state.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown load error.");
    } finally {
      setLoading(false);
    }
  }

  async function runForecast(saveHistory: boolean, forceAI: boolean) {
    setForecastLoading(true);
    setError(null);
    setMessage(null);

    try {
      let parsedOutcomes = state.outcomes;

      try {
        parsedOutcomes = JSON.parse(outcomesJson) as MarketState["outcomes"];
      } catch {
        throw new Error("Outcomes JSON is invalid.");
      }

      const nextState = {
        ...state,
        outcomes: parsedOutcomes
      };

      const response = await fetch("/api/forecast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify({
          state: nextState,
          saveHistory,
          forceAI
        })
      });

      const json = (await response.json()) as ForecastResponse;

      if (!json.ok || !json.data) {
        throw new Error(json.error || "Forecast failed.");
      }

      setState(nextState);
      setForecast(json.data.result);
      setWeather(json.data.weather);

      if (saveHistory) {
        await loadHistory();
      }

      const historySave = json.data.historySave ?? null;

let nextMessage = "Forecast generated.";

if (saveHistory) {
  if (historySave?.saved) {
    nextMessage = "Forecast generated and saved to history.";
  } else if (historySave?.reason) {
    nextMessage = `Forecast generated. ${historySave.reason}`;
  } else {
    nextMessage = "Forecast generated. History save status unavailable.";
  }
}

setMessage(nextMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown forecast error.");
    } finally {
      setForecastLoading(false);
    }
  }

  async function saveSettings() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      let parsedOutcomes = state.outcomes;

      try {
        parsedOutcomes = JSON.parse(outcomesJson) as MarketState["outcomes"];
      } catch {
        throw new Error("Outcomes JSON is invalid.");
      }

      const nextState = {
        ...state,
        outcomes: parsedOutcomes
      };

      const response = await fetch("/api/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": adminSecret
        },
        body: JSON.stringify(nextState)
      });

      const json = (await response.json()) as {
        ok: boolean;
        data?: MarketState;
        error?: string;
      };

      if (!json.ok || !json.data) {
        throw new Error(json.error || "Failed to save settings.");
      }

      setState(json.data);
      setMessage("Market settings saved.");
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown save error.");
    } finally {
      setLoading(false);
    }
  }

  async function initDb() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/init", {
        method: "POST",
        headers: {
          "x-admin-secret": adminSecret
        }
      });

      const json = (await response.json()) as {
        ok: boolean;
        data?: {
          message: string;
        };
        error?: string;
      };

      if (!json.ok) {
        throw new Error(json.error || "Failed to initialize DB.");
      }

      setMessage(json.data?.message ?? "Database initialized.");
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown init error.");
    } finally {
      setLoading(false);
    }
  }

  async function checkSettlement() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/settlement?date=${settlementDate}`, {
        cache: "no-store"
      });

      const json = (await response.json()) as {
        ok: boolean;
        data?: SettlementResult;
        error?: string;
      };

      if (!json.ok || !json.data) {
        throw new Error(json.error || "Settlement check failed.");
      }

      setSettlement(json.data);
      setMessage("Settlement data loaded.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unknown settlement error."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-cyan-300">
            Full Version
          </p>

          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
            HKO 香港最高氣溫 Prediction Market 完全版
          </h1>

          <p className="max-w-4xl text-slate-300">
            自動讀取 HKO 即時天氣、官方九天天氣預報、由午夜至今最高氣溫，
            再結合雨帶 ETA、雨勢、雲量和 Monte Carlo engine，
            估計今日 final daily maximum temperature 各 outcome 概率。
          </p>
        </header>

        {message && (
          <div className="rounded-2xl border border-emerald-700 bg-emerald-950 p-4 text-emerald-100">
            {message}
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-700 bg-red-950 p-4 text-red-100">
            <p className="font-semibold">Error</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-5">
         <Card
            label="HKO Current Temp"
            value={formatTemp(hkoCurrentTempC)}
            sub={`Record: ${hkoCurrentRecordTime ?? "--"}`}
          />

          <Card
            label="HKO Max Since Midnight"
            value={formatTemp(hkoMaxSinceMidnightC)}
            sub={`Time: ${hkoMaxSinceMidnightTime ?? "--"}`}
          />

          <Card
            label="HKO Min Since Midnight"
            value={formatTemp(hkoMinSinceMidnightC)}
            sub={`Time: ${hkoMinSinceMidnightTime ?? "--"}`}
          />

          <Card
            label="Official Forecast Max"
            value={formatTemp(officialForecastMax)}
            sub={`PSR: ${
              weather?.forecast?.days?.[0]?.psr ??
              weather?.forecast?.days?.[0]?.PSR ??
              "--"
            }`}
          />

          <Card
            label="Hourly Rainfall"
            value={
              typeof weather?.hourlyRainfall?.rainfallMm === "number"
                ? `${weather.hourlyRainfall.rainfallMm.toFixed(1)} mm`
                : "--"
            }
            sub={`Obs: ${weather?.hourlyRainfall?.obsTime ?? "--"}`}
          />
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Controls</h2>
              <p className="mt-1 text-sm text-slate-400">
                這裡控制市場假設。HKO max-so-far 已自動取得；除非你要
                override，否則 manual override 留空。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void loadAll()}
                disabled={loading}
                className={buttonSecondary}
              >
                {loading ? "Loading..." : "Refresh All"}
              </button>

              <button
                onClick={() => void runForecast(true, Boolean(state.useAI))}
                disabled={forecastLoading}
                className={buttonPrimary}
              >
                {forecastLoading ? "Calculating..." : "更新預測並儲存"}
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <label className="block">
              <span className="text-sm text-slate-300">
                Polymarket event URL / slug
              </span>

              <input
                value={polymarketUrl}
                onChange={(event) => setPolymarketUrl(event.target.value)}
                className={inputClass}
                type="text"
                placeholder="Paste Polymarket event URL here"
              />
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void loadPolymarketOutcomes()}
                disabled={loadingPolymarket}
                className={buttonSecondary}
              >
                {loadingPolymarket
                  ? "Loading Polymarket..."
                  : "Load Polymarket outcomes"}
              </button>

              <p className="text-sm text-slate-400">
                讀取後會更新 outcomes JSON；之後再按「更新預測並儲存」重新計算概率。
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm text-slate-300">
                Manual max override °C
              </span>
              <input
                value={
                  state.manualMaxOverrideC == null
                    ? ""
                    : String(state.manualMaxOverrideC)
                }
                onChange={(event) => {
                  const value = event.target.value.trim();

                  updateState({
                    manualMaxOverrideC:
                      value === "" ? null : Number(value)
                  });
                }}
                className={inputClass}
                type="number"
                step="0.1"
                placeholder="Leave empty to use HKO auto max"
              />
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">
                Rainband ETA minutes
              </span>
              <input
                value={
                  state.rainEtaMinutes == null
                    ? ""
                    : String(state.rainEtaMinutes)
                }
                onChange={(event) => {
                  const value = event.target.value.trim();

                  updateState({
                    rainEtaMinutes: value === "" ? null : Number(value)
                  });
                }}
                className={inputClass}
                type="number"
                step="1"
                min="0"
              />
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">Cloud cover %</span>
              <input
                value={
                  typeof state.cloudCoverPct === "number"
                    ? state.cloudCoverPct
                    : 85
                }
                onChange={(event) =>
                  updateState({
                    cloudCoverPct: Number(event.target.value)
                  })
                }
                className={inputClass}
                type="number"
                step="1"
                min="0"
                max="100"
              />
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">
                Rain probability 60m
              </span>
              <input
                value={
                  typeof state.rainProbability60m === "number"
                    ? state.rainProbability60m
                    : 0.65
                }
                onChange={(event) =>
                  updateState({
                    rainProbability60m: Number(event.target.value)
                  })
                }
                className={inputClass}
                type="number"
                step="0.01"
                min="0"
                max="1"
              />
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">
                Rain probability 120m
              </span>
              <input
                value={
                  typeof state.rainProbability120m === "number"
                    ? state.rainProbability120m
                    : 0.75
                }
                onChange={(event) =>
                  updateState({
                    rainProbability120m: Number(event.target.value)
                  })
                }
                className={inputClass}
                type="number"
                step="0.01"
                min="0"
                max="1"
              />
            </label>

            <label className="block">
              <span className="text-sm text-slate-300">Rain intensity</span>
              <select
                value={String(state.expectedRainIntensity ?? "moderate")}
                onChange={(event) =>
                  updateState({
                    expectedRainIntensity: event.target.value as RainIntensity
                  })
                }
                className={inputClass}
              >
                <option value="none">none</option>
                <option value="light">light</option>
                <option value="moderate">moderate</option>
                <option value="heavy">heavy</option>
                <option value="thunderstorm">thunderstorm</option>
              </select>
            </label>
          </div>

          <label className="mt-5 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(state.useAI)}
              onChange={(event) =>
                updateState({
                  useAI: event.target.checked
                })
              }
            />
            Use Poe AI explanation
          </label>
          
        </section>

       <TradingSignalsTable forecast={forecast} />

       <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-xl font-semibold">Market outcomes</h2>

            <p className="mt-1 text-sm text-slate-400">
              你可以在 Admin settings 改 outcomes JSON。
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-400">
                  <tr>
                    <th className="border-b border-slate-800 py-3 pr-4">
                      Outcome
                    </th>
                    <th className="border-b border-slate-800 py-3 pr-4">
                      Range
                    </th>
                    <th className="border-b border-slate-800 py-3 pr-4">
                      Polymarket
                    </th>
                    <th className="border-b border-slate-800 py-3 pr-4">
                      Model
                    </th>
                    <th className="border-b border-slate-800 py-3 pr-4">
                      Edge
                    </th>
                    <th className="border-b border-slate-800 py-3">
                      Bar
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {(state.outcomes ?? []).map((outcome) => {
                    const forecastOutcome =
                      forecast?.outcomeProbabilities?.find(
                        (item) => item.name === outcome.name
                      ) ?? null;

                    const probability = firstDisplayNumber(
                      readPath(forecastOutcome, ["probability"]),
                      readPath(forecastOutcome, ["modelProbability"]),
                      readPath(forecastOutcome, ["weatherProbability"]),
                      readPath(forecastOutcome, ["forecastProbability"])
                    );

                    const marketPrice =
                      getOutcomeMarketPrice(outcome) ??
                      firstDisplayNumber(
                        readPath(forecastOutcome, ["marketProbability"]),
                        readPath(forecastOutcome, ["polymarketProbability"]),
                        readPath(forecastOutcome, ["marketPrice"]),
                        readPath(forecastOutcome, ["price"]),
                        readPath(forecastOutcome, ["clobMidpoint"]),
                        readPath(forecastOutcome, ["yesPrice"]),
                        readPath(forecastOutcome, ["lastPrice"])
                      );

                    const edge =
                      typeof probability === "number" &&
                      typeof marketPrice === "number"
                        ? probability - marketPrice
                        : null;

                    return (
                      <tr key={outcome.name}>
                        <td className="border-b border-slate-800 py-3 pr-4 font-medium">
                          {outcome.name}
                        </td>

                        <td className="border-b border-slate-800 py-3 pr-4 text-slate-300">
                          {rangeLabel(outcome.lower, outcome.upper)}
                        </td>

                        <td className="border-b border-slate-800 py-3 pr-4 text-slate-300">
                          {formatPercent(marketPrice)}
                        </td>

                        <td className="border-b border-slate-800 py-3 pr-4 text-cyan-300">
                          {formatPercent(probability)}
                        </td>

                        <td
                          className={
                            edge !== null && edge > 0
                              ? "border-b border-slate-800 py-3 pr-4 text-emerald-300"
                              : edge !== null && edge < 0
                                ? "border-b border-slate-800 py-3 pr-4 text-red-300"
                                : "border-b border-slate-800 py-3 pr-4 text-slate-400"
                          }
                        >
                          {formatSignedPercent(edge)}
                        </td>

                        <td className="border-b border-slate-800 py-3">
                          <div className="h-3 w-full rounded-full bg-slate-800">
                            <div
                              className="h-3 rounded-full bg-cyan-400"
                              style={{
                                width:
                                  typeof probability === "number"
                                    ? `${Math.round(probability * 100)}%`
                                    : "0%"
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-xl font-semibold">Estimated final daily max</h2>

            {forecast ? (
              <>
                <p className="mt-1 text-sm text-slate-400">
                  Generated: {formatHktDateTime(forecast.generatedAt)} HKT
                </p>

                <p className="mt-1 text-sm text-slate-400">
                  Max so far source:{" "}
                  <span className="text-cyan-300">
                    {forecast.maxSoFarSource ?? "--"}
                  </span>
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">P10</p>
                    <p className="text-2xl font-bold">
                      {formatTemp(forecast.estimatedFinalMaxC?.p10)}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">P25</p>
                    <p className="text-2xl font-bold">
                      {formatTemp(forecast.estimatedFinalMaxC?.p25)}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">Median</p>
                    <p className="text-2xl font-bold text-cyan-300">
                      {formatTemp(forecast.estimatedFinalMaxC?.median)}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">P75</p>
                    <p className="text-2xl font-bold">
                      {formatTemp(forecast.estimatedFinalMaxC?.p75)}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">P90</p>
                    <p className="text-2xl font-bold">
                      {formatTemp(forecast.estimatedFinalMaxC?.p90)}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-400">
                Click 更新預測並儲存 to generate forecast.
              </p>
            )}
          </div>
        </section>

        {forecast && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-100">
                  Poe AI explanation
                </h2>

                <p className="mt-1 text-sm text-slate-400">
                  Full AI analysis. Long output is scrollable inside this panel.
                </p>
              </div>

              <div className="rounded-full bg-slate-950 px-3 py-1 text-xs text-cyan-300">
                Scrollable
              </div>
            </div>

            <div className="mt-4 max-h-screen overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-4">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-200">
                {forecast.aiExplanation ||
                  "AI explanation disabled or not available."}
              </pre>
            </div>
          </section>
        )}

        {forecast && (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-xl font-semibold">Key drivers</h2>

              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300">
                {(forecast.keyDrivers ?? []).length > 0 ? (
                  (forecast.keyDrivers ?? []).map((driver) => (
                    <li key={driver}>{driver}</li>
                  ))
                ) : (
                  <li>No key drivers returned.</li>
                )}
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-xl font-semibold">Warnings</h2>

              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-amber-200">
                {(forecast.warnings ?? []).length > 0 ? (
                  (forecast.warnings ?? []).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))
                ) : (
                  <li>No warnings.</li>
                )}
              </ul>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Admin settings</h2>

          <p className="mt-1 text-sm text-slate-400">
            Database enabled:{" "}
            <span
              className={databaseEnabled ? "text-emerald-300" : "text-red-300"}
            >
              {databaseEnabled ? "yes" : "no"}
            </span>
            {" · "}
            State persisted:{" "}
            <span
              className={persisted ? "text-emerald-300" : "text-amber-300"}
            >
              {persisted ? "yes" : "no"}
            </span>
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <label className="block">
                <span className="text-sm text-slate-300">Admin secret</span>
                <input
                  value={adminSecret}
                  onChange={(event) => setAdminSecret(event.target.value)}
                  className={inputClass}
                  type="password"
                  placeholder="ADMIN_SECRET from Vercel env"
                />
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => void initDb()}
                  disabled={loading}
                  className={buttonSecondary}
                >
                  Init DB
                </button>

                <button
                  onClick={() => void saveSettings()}
                  disabled={loading}
                  className={buttonPrimary}
                >
                  Save Settings
                </button>

                <button
                  onClick={() => void runForecast(false, true)}
                  disabled={forecastLoading}
                  className={buttonSecondary}
                >
                  Run Forecast With AI Only
                </button>
              </div>
            </div>

            <label className="block">
              <span className="text-sm text-slate-300">Outcomes JSON</span>
              <textarea
                value={outcomesJson}
                onChange={(event) => setOutcomesJson(event.target.value)}
                className="mt-2 min-h-64 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-900"
              />
            </label>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-xl font-semibold">Settlement check</h2>

            <p className="mt-1 text-sm text-slate-400">
              用 HKO RYES weather and radiation report 檢查過去日期的 HKO
              official max temp。通常只適合昨日或更早日期。
            </p>

            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
              <label className="block flex-1">
                <span className="text-sm text-slate-300">Date YYYYMMDD</span>
                <input
                  value={settlementDate}
                  onChange={(event) => setSettlementDate(event.target.value)}
                  className={inputClass}
                  type="text"
                />
              </label>

              <button
                onClick={() => void checkSettlement()}
                disabled={loading}
                className={buttonSecondary}
              >
                Check Settlement
              </button>
            </div>

            {settlement && (
              <div className="mt-4 rounded-xl bg-slate-950 p-4 text-sm">
                <p>
                  Date:{" "}
                  <span className="text-cyan-300">
                    {settlement.date ?? "--"}
                  </span>
                </p>

                <p>
                  Official max:{" "}
                  <span className="text-cyan-300">
                    {formatTemp(settlement.officialMaxTempC)}
                  </span>
                </p>

                <p>Available: {settlement.available ? "yes" : "no"}</p>
                <p>Raw key: {settlement.rawKey ?? "--"}</p>
                <p className="mt-2 text-slate-400">
                  {settlement.note ?? "--"}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-xl font-semibold">Forecast history</h2>

            {history.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">
                No history yet. Run forecast with save enabled after DB init.
              </p>
            ) : (
              <div className="mt-4 max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-900 text-slate-400">
                    <tr>
                      <th className="border-b border-slate-800 py-2 pr-3">
                        Time
                      </th>
                      <th className="border-b border-slate-800 py-2 pr-3">
                        Max so far
                      </th>
                      <th className="border-b border-slate-800 py-2 pr-3">
                        Median
                      </th>
                      <th className="border-b border-slate-800 py-2">
                        Top outcome
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {history.map((row) => {
                      const topOutcome = [
                        ...(row.result.outcomeProbabilities ?? [])
                      ].sort((a, b) => b.probability - a.probability)[0];

                      return (
                        <tr key={row.id}>
                          <td className="border-b border-slate-800 py-2 pr-3">
                            {formatHktDateTime(row.createdAt)}
                          </td>

                          <td className="border-b border-slate-800 py-2 pr-3">
                            {formatTemp(row.result.maxSoFarC)}
                          </td>

                          <td className="border-b border-slate-800 py-2 pr-3">
                            {formatTemp(row.result.estimatedFinalMaxC?.median)}
                          </td>

                          <td className="border-b border-slate-800 py-2">
                            {topOutcome
                              ? `${topOutcome.name} ${formatPercent(
                                  topOutcome.probability
                                )}`
                              : "--"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm leading-6 text-slate-400">
          <h2 className="text-lg font-semibold text-slate-100">
            Important note
          </h2>
          <p className="mt-2">
            This app is a probability and nowcast tool. It is not a settlement
            authority. Prediction market settlement must follow the exact market
            rules and official source specified by the market.
          </p>
        </section>
      </div>
    </main>
  );
}
