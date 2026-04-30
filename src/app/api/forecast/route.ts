import { NextResponse } from "next/server";
import { estimateForecast } from "@/lib/forecast";
import { getHkoWeatherSnapshot } from "@/lib/hko";
import { generatePoeExplanation } from "@/lib/poe";
import { saveForecastRun } from "@/lib/db";
import { getMarketState } from "@/lib/state";
import { forecastApiRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ForecastBase = {
  hktDate: string;
  [key: string]: unknown;
};

type ForecastResultWithAI = ForecastBase & {
  aiExplanation: string | null;
};

type HistorySaveResult = {
  saved: boolean;
  reason: string | null;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = forecastApiRequestSchema.parse(body);

    const persistedState = await getMarketState();
    const state = parsed.state ?? persistedState.state;

    const snapshot = await getHkoWeatherSnapshot();

    const forecastWithoutAI = estimateForecast(snapshot, state) as ForecastBase;

    let aiExplanation: string | null = null;

    const shouldUseAI = parsed.forceAI ?? state.useAI;

    if (shouldUseAI) {
      aiExplanation = await generatePoeExplanation({
        snapshot,
        state,
        forecast: forecastWithoutAI
      });
    }

    const result: ForecastResultWithAI = {
      ...forecastWithoutAI,
      aiExplanation
    };

    let historySave: HistorySaveResult = {
      saved: false,
      reason: "saveHistory was false."
    };

    if (parsed.saveHistory) {
      historySave = await saveForecastRun({
        hktDate: result.hktDate,
        state,
        weather: snapshot,
        result
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        result,
        weather: snapshot,
        historySave
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
            : "Failed to generate forecast."
      },
      { status: 500 }
    );
  }
}
