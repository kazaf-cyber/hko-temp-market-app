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

type StateResponse = {
  ok: boolean;
  data?: {
    state: MarketState;
    databaseEnabled: boolean;
    persisted: boolean;
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
    historySave: {
      saved: boolean;
      reason: string | null;
    };
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
  if (typeof value !== "number") {
    return "--";
  }

  return `${value.toFixed(1)}°C`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "--";
  }

  return `${Math.round(value * 100)}%`;
}

function formatHktDateTime(isoString: string | null | undefined) {
  if (!isoString) {
    return "--";
  }

  return new Date(isoString).toLocaleString("zh-HK", {
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

  const officialForecastMax = useMemo(() => {
    if (!weather) {
      return null;
    }

    return weather.forecast?.days?.[0]?.forecastMaxtempC ?? null;
  }, [weather]);

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
    setOutcomesJson(JSON.stringify(json.data.state.outcomes, null, 2));
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

      setMessage(
        json.data.historySave.saved
          ? "Forecast generated and saved to history."
          : `Forecast generated. ${json.data.historySave.reason}`
      );
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
            value={formatTemp(weather?.current.hkoCurrentTempC)}
            sub={`Record: ${weather?.current.recordTime ?? "--"}`}
          />

          <Card
            label="HKO Max Since Midnight"
            value={formatTemp(weather?.sinceMidnight?.maxTempC)}
            sub={`Time: ${weather?.sinceMidnight?.maxTempTime ?? "--"}`}
          />

          <Card
            label="HKO Min Since Midnight"
            value={formatTemp(weather?.sinceMidnight?.minTempC)}
            sub={`Time: ${weather?.sinceMidnight?.minTempTime ?? "--"}`}
          />

          <Card
            label="Official Forecast Max"
            value={formatTemp(officialForecastMax)}
            sub={`PSR: ${weather?.forecast.days[0]?.psr ?? "--"}`}
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
                這裡控制市場假設。HKO max-so-far 已自動取得；除非你要 override，
                否則 manual override 留空。
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
                onClick={() => void runForecast(true, state.useAI)}
                disabled={forecastLoading}
                className={buttonPrimary}
              >
                {forecastLoading ? "Calculating..." : "更新預測並儲存"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm text-slate-300">
                Manual max override °C
              </span>
              <input
                value={
                  state.manualMaxOverrideC === null
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
                  state.rainEtaMinutes === null
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
                value={state.cloudCoverPct}
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
                value={state.rainProbability60m}
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
                value={state.rainProbability120m}
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
                value={state.expectedRainIntensity}
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
              checked={state.useAI}
              onChange={(event) =>
                updateState({
                  useAI: event.target.checked
                })
              }
            />
            Use Poe AI explanation
          </label>
        </section>

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
                      Probability
                    </th>
                    <th className="border-b border-slate-800 py-3">Bar</th>
                  </tr>
                </thead>

                <tbody>
                  {state.outcomes.map((outcome) => {
                    const probability =
                      forecast?.outcomeProbabilities.find(
                        (item) => item.name === outcome.name
                      )?.probability ?? null;

                    return (
                      <tr key={outcome.name}>
                        <td className="border-b border-slate-800 py-3 pr-4 font-medium">
                          {outcome.name}
                        </td>
                        <td className="border-b border-slate-800 py-3 pr-4 text-slate-300">
                          {rangeLabel(outcome.lower, outcome.upper)}
                        </td>
                        <td className="border-b border-slate-800 py-3 pr-4 text-cyan-300">
                          {formatPercent(probability)}
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
                    {forecast.maxSoFarSource}
                  </span>
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">P10</p>
                    <p className="text-2xl font-bold">
                      {forecast.estimatedFinalMaxC.p10.toFixed(1)}°C
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">P25</p>
                    <p className="text-2xl font-bold">
                      {forecast.estimatedFinalMaxC.p25.toFixed(1)}°C
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">Median</p>
                    <p className="text-2xl font-bold text-cyan-300">
                      {forecast.estimatedFinalMaxC.median.toFixed(1)}°C
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">P75</p>
                    <p className="text-2xl font-bold">
                      {forecast.estimatedFinalMaxC.p75.toFixed(1)}°C
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-3">
                    <p className="text-slate-400">P90</p>
                    <p className="text-2xl font-bold">
                      {forecast.estimatedFinalMaxC.p90.toFixed(1)}°C
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl bg-slate-950 p-4">
                  <p className="text-sm font-semibold text-cyan-300">
                    Poe AI explanation
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                    {forecast.aiExplanation ||
                      "AI explanation disabled or not available."}
                  </p>
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
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-xl font-semibold">Key drivers</h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300">
                {forecast.keyDrivers.map((driver) => (
                  <li key={driver}>{driver}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-xl font-semibold">Warnings</h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-amber-200">
                {forecast.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Admin settings</h2>

          <p className="mt-1 text-sm text-slate-400">
            Database enabled:{" "}
            <span className={databaseEnabled ? "text-emerald-300" : "text-red-300"}>
              {databaseEnabled ? "yes" : "no"}
            </span>
            {" · "}
            State persisted:{" "}
            <span className={persisted ? "text-emerald-300" : "text-amber-300"}>
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
                  <span className="text-cyan-300">{settlement.date}</span>
                </p>
                <p>
                  Official max:{" "}
                  <span className="text-cyan-300">
                    {formatTemp(settlement.officialMaxTempC)}
                  </span>
                </p>
                <p>Available: {settlement.available ? "yes" : "no"}</p>
                <p>Raw key: {settlement.rawKey ?? "--"}</p>
                <p className="mt-2 text-slate-400">{settlement.note}</p>
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
                      const topOutcome = [...row.result.outcomeProbabilities].sort(
                        (a, b) => b.probability - a.probability
                      )[0];

                      return (
                        <tr key={row.id}>
                          <td className="border-b border-slate-800 py-2 pr-3">
                            {formatHktDateTime(row.createdAt)}
                          </td>
                          <td className="border-b border-slate-800 py-2 pr-3">
                            {formatTemp(row.result.maxSoFarC)}
                          </td>
                          <td className="border-b border-slate-800 py-2 pr-3">
                            {formatTemp(row.result.estimatedFinalMaxC.median)}
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
