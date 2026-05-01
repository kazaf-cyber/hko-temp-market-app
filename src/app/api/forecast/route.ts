import { NextResponse } from "next/server";
import { getForecast, type GetForecastOptions } from "@/lib/forecast";
import { getPoeForecastCommentary } from "@/lib/poe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function buildForecastPayload(params: {
  forecast: Awaited<ReturnType<typeof getForecast>>;
  aiCommentary: Awaited<ReturnType<typeof getPoeForecastCommentary>> | null;
}) {
  return {
    ok: true,
    generatedAt: params.forecast.generatedAt,

    /*
      New canonical shape.
    */
    data: params.forecast,
    ai: params.aiCommentary,

    /*
      Backward-friendly aliases for older UI code.
    */
    forecast: params.forecast,
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

async function runForecast(options: GetForecastOptions & { ai?: boolean }) {
  const forecast = await getForecast(options);

  const aiCommentary = options.ai
    ? await getPoeForecastCommentary(forecast)
    : null;

  return buildForecastPayload({
    forecast,
    aiCommentary
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
    */
    const includeClob = parseBoolean(url.searchParams.get("includeClob"), true);
    const blendMarket = parseBoolean(url.searchParams.get("blendMarket"), true);
    const debug = parseBoolean(url.searchParams.get("debug"), false);
    const ai =
      parseBoolean(url.searchParams.get("ai"), false) ||
      parseBoolean(url.searchParams.get("explain"), false);

    const marketWeightOverride = parseNumber(url.searchParams.get("marketWeight"));

    const payload = await runForecast({
      includeClob,
      blendMarket,
      includeRawSnapshot: debug,
      marketWeightOverride,
      ai
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
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      body = {};
    }

    const includeClob = parseBoolean(body.includeClob, true);
    const blendMarket = parseBoolean(body.blendMarket, true);
    const debug = parseBoolean(body.debug, false);
    const ai = parseBoolean(body.ai ?? body.explain, false);
    const marketWeightOverride = parseNumber(body.marketWeight);

    const payload = await runForecast({
      includeClob,
      blendMarket,
      includeRawSnapshot: debug,
      marketWeightOverride,
      ai
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
