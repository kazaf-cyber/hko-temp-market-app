import { NextResponse } from "next/server";
import { getForecast, type GetForecastOptions } from "@/lib/forecast";
import { getPoeForecastCommentary } from "@/lib/poe";
import { initDatabase, saveForecastRun } from "@/lib/db";
import type { ForecastResult, HkoWeatherSnapshot, MarketState } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Forecast = Awaited<ReturnType<typeof getForecast>>;
type AiCommentary =
  | Awaited<ReturnType<typeof getPoeForecastCommentary>>
  | null;

type HistorySaveResult = {
  saved: boolean;
  reason: string | null;
};

type RunForecastOptions = GetForecastOptions & {
  ai?: boolean;
  saveHistory?: boolean;
  state?: MarketState | null;
};

let databaseInitPromise: Promise<void> | null = null;

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return fallback;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseMarketState(value: unknown): MarketState | null {
  if (!isRecord(value)) {
    return null;
  }

  return value as MarketState;
}

function getStringField(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function formatHktDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";

  return `${year}-${month}-${day}`;
}

function getForecastHktDate(forecast: Forecast) {
  const forecastRecord = forecast as unknown as Record<string, unknown>;

  const explicitForecastDate = getStringField(forecastRecord, [
    "hktDate",
    "hkt_date",
    "forecastDate",
    "date"
  ]);

  if (explicitForecastDate) {
    return explicitForecastDate;
  }

  const weather = forecastRecord.weather;

  if (isRecord(weather)) {
    const explicitWeatherDate = getStringField(weather, [
      "hktDate",
      "hkt_date",
      "forecastDate",
      "date"
    ]);

    if (explicitWeatherDate) {
      return explicitWeatherDate;
    }
  }

  const generatedAt = getStringField(forecastRecord, ["generatedAt"]);

  if (generatedAt) {
    const generatedAtDate = new Date(generatedAt);

    if (Number.isFinite(generatedAtDate.getTime())) {
      return formatHktDate(generatedAtDate);
    }
  }

  return formatHktDate(new Date());
}

function getAiExplanationText(aiCommentary: AiCommentary): string | null {
  if (!aiCommentary) {
    return null;
  }

  if (typeof aiCommentary === "string") {
    return aiCommentary;
  }

  if (isRecord(aiCommentary)) {
    const directText = getStringField(aiCommentary, [
      "text",
      "summary",
      "explanation",
      "commentary",
      "content",
      "message"
    ]);

    if (directText) {
      return directText;
    }
  }

  try {
    return JSON.stringify(aiCommentary);
  } catch {
    return String(aiCommentary);
  }
}

function buildResultForHistory(
  forecast: Forecast,
  aiCommentary: AiCommentary
): ForecastResult {
  const aiExplanation = getAiExplanationText(aiCommentary);

  if (!aiExplanation) {
    return forecast as ForecastResult;
  }

  return {
    ...(forecast as ForecastResult),
    aiExplanation
  };
}

async function ensureDatabaseInitialized() {
  if (!databaseInitPromise) {
    databaseInitPromise = initDatabase().catch((error) => {
      databaseInitPromise = null;
      throw error;
    });
  }

  return databaseInitPromise;
}

async function saveHistoryIfRequested(params: {
  saveHistory: boolean;
  state: MarketState | null;
  forecast: Forecast;
  aiCommentary: AiCommentary;
}): Promise<HistorySaveResult> {
  if (!params.saveHistory) {
    return {
      saved: false,
      reason: "History save was not requested."
    };
  }

  if (!params.state) {
    return {
      saved: false,
      reason: "Market state was not provided, so history was not saved."
    };
  }

  try {
    /*
      Make this route self-healing.

      If forecast_runs table does not exist yet, initDatabase() will create it.
      If DATABASE_URL is missing, initDatabase() will throw and we return a clean reason.
    */
    await ensureDatabaseInitialized();

    const resultForHistory = buildResultForHistory(
      params.forecast,
      params.aiCommentary
    );

    return await saveForecastRun({
      hktDate: getForecastHktDate(params.forecast),
      state: params.state,
      weather: params.forecast.weather as unknown as HkoWeatherSnapshot,
      result: resultForHistory
    });
  } catch (error) {
    console.error("Forecast history save error:", error);

    return {
      saved: false,
      reason:
        error instanceof Error
          ? error.message
          : "Failed to save forecast history."
    };
  }
}

function buildForecastPayload(params: {
  forecast: Forecast;
  aiCommentary: AiCommentary;
  historySave: HistorySaveResult;
}) {
  /*
    Important compatibility layer.

    Your frontend currently expects:

      json.data.result
      json.data.weather
      json.data.historySave.saved

    So data must include:
      - all forecast fields
      - result
      - forecast
      - weather
      - historySave
      - ai
  */
  const data = {
    ...params.forecast,
    result: params.forecast,
    forecast: params.forecast,
    ai: params.aiCommentary,
    historySave: params.historySave
  };

  return {
    ok: true,
    generatedAt: params.forecast.generatedAt,

    /*
      Main response shape used by the current page.tsx.
    */
    data,

    /*
      AI commentary, if requested.
    */
    ai: params.aiCommentary,

    /*
      Backward-friendly aliases for older UI code.
    */
    forecast: params.forecast,
    result: params.forecast,
    historySave: params.historySave,
    outcomes: params.forecast.outcomes,
    probabilities: params.forecast.outcomes.map((outcome) => ({
      name: outcome.name,
      lower: outcome.lower,
      upper: outcome.upper,
      probability: outcome.probability,
      probabilityPct: outcome.probabilityPct,
      weatherProbability: outcome.weatherProbability,
      weatherProbabilityPct: outcome.weatherProbabilityPct,
      marketProbability: outcome.marketProbability,
      marketProbabilityPct: outcome.marketProbabilityPct,
      rank: outcome.rank,
      isImpossibleByObservedMax: outcome.isImpossibleByObservedMax
    })),
    topOutcome: params.forecast.topOutcome,
    summary: params.forecast.summary,
    weather: params.forecast.weather,
    model: params.forecast.model,
    diagnostics: params.forecast.diagnostics
  };
}

async function runForecast(options: RunForecastOptions) {
  const forecast = await getForecast(options);

  const aiCommentary = options.ai
    ? await getPoeForecastCommentary(forecast)
    : null;

  const historySave = await saveHistoryIfRequested({
    saveHistory: Boolean(options.saveHistory),
    state: options.state ?? null,
    forecast,
    aiCommentary
  });

  return buildForecastPayload({
    forecast,
    aiCommentary,
    historySave
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    /*
      Defaults:
      - includeClob true because Phase 2 is multi-channel.
      - blendMarket true because final probability should use CLOB/Gamma when available.
      - ai false by default to avoid spending Poe credits on every dashboard refresh.
      - saveHistory false for GET requests.
    */
    const includeClob = parseBoolean(url.searchParams.get("includeClob"), true);
    const blendMarket = parseBoolean(url.searchParams.get("blendMarket"), true);
    const debug = parseBoolean(url.searchParams.get("debug"), false);

    const ai =
      parseBoolean(url.searchParams.get("ai"), false) ||
      parseBoolean(url.searchParams.get("explain"), false) ||
      parseBoolean(url.searchParams.get("forceAI"), false);

    const marketWeightOverride = parseNumber(
      url.searchParams.get("marketWeight")
    );

    const payload = await runForecast({
      includeClob,
      blendMarket,
      includeRawSnapshot: debug,
      marketWeightOverride,
      ai,
      saveHistory: false,
      state: null
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    console.error("Forecast API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate multi-channel forecast."
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown> = {};

    try {
      const parsed = await request.json();

      body =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      body = {};
    }

    const includeClob = parseBoolean(body.includeClob, true);
    const blendMarket = parseBoolean(body.blendMarket, true);
    const debug = parseBoolean(body.debug, false);

    /*
      Frontend may send:
      - ai
      - explain
      - forceAI

      Your page.tsx seems to send forceAI, so we support all three.
    */
    const ai =
      parseBoolean(body.ai, false) ||
      parseBoolean(body.explain, false) ||
      parseBoolean(body.forceAI, false);

    /*
      Frontend sends:
      - state
      - saveHistory

      If saveHistory is true and DATABASE_URL is configured,
      this route will now save into forecast_runs.
    */
    const state = parseMarketState(body.state);
    const saveHistory = parseBoolean(body.saveHistory, false);

    const marketWeightOverride = parseNumber(body.marketWeight);

    const payload = await runForecast({
      includeClob,
      blendMarket,
      includeRawSnapshot: debug,
      marketWeightOverride,
      ai,
      saveHistory,
      state
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    console.error("Forecast API POST error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate multi-channel forecast."
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0"
        }
      }
    );
  }
}
