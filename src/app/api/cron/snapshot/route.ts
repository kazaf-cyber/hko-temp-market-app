import { NextResponse } from "next/server";
import { checkCronSecret } from "@/lib/cronAuth";
import { getMarketState } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getAt(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const auth = checkCronSecret(request);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.message,
      },
      {
        status: auth.status,
      },
    );
  }

  const startedAt = new Date().toISOString();

  try {
    const marketStateLoad = await getMarketState();

    const forecastUrl = new URL("/api/forecast", request.url);

    const response = await fetch(forecastUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        includeClob: true,
        blendMarket: true,
        debug: false,

        /**
         * Very important:
         * This makes /api/forecast save forecast_runs + signal_snapshots.
         */
        saveHistory: true,

        /**
         * Use persisted admin market assumptions / outcome universe.
         */
        state: marketStateLoad.state,

        /**
         * After Step 4 below, this prevents burning Poe quota every 15 minutes.
         */
        ai: false,
      }),
    });

    const payload = await readJsonSafe(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          job: "phase1-snapshot",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: "Forecast API returned a non-2xx response.",
          status: response.status,
          payload,
        },
        {
          status: response.status,
        },
      );
    }

    const payloadRecord = isRecord(payload) ? payload : {};
    const dataRecord = isRecord(payloadRecord.data) ? payloadRecord.data : {};
    const result =
      dataRecord.result ??
      dataRecord.forecast ??
      payloadRecord.result ??
      payloadRecord.forecast ??
      null;

    const historySave =
      dataRecord.historySave ?? payloadRecord.historySave ?? null;

    const generatedAt = firstString(
      payloadRecord.generatedAt,
      dataRecord.generatedAt,
      getAt(result, ["generatedAt"]),
    );

    const hktDate = firstString(
      dataRecord.hktDate,
      payloadRecord.hktDate,
      getAt(result, ["hktDate"]),
      getAt(result, ["date"]),
    );

    const targetDate = firstString(
      dataRecord.targetDate,
      dataRecord.forecastDate,
      payloadRecord.targetDate,
      payloadRecord.forecastDate,
      getAt(result, ["targetDate"]),
      getAt(result, ["forecastDate"]),
      hktDate,
    );

    const topOutcome =
      dataRecord.topOutcome ??
      payloadRecord.topOutcome ??
      getAt(result, ["topOutcome"]) ??
      null;

    return NextResponse.json(
      {
        ok: true,
        job: "phase1-snapshot",
        startedAt,
        finishedAt: new Date().toISOString(),
        state: {
          databaseEnabled: marketStateLoad.databaseEnabled,
          persisted: marketStateLoad.persisted,
        },
        forecast: {
          status: response.status,
          generatedAt,
          hktDate,
          targetDate,
          topOutcome,
        },
        historySave,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Phase 1 snapshot cron error:", error);

    return NextResponse.json(
      {
        ok: false,
        job: "phase1-snapshot",
        startedAt,
        finishedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : "Failed to run Phase 1 snapshot cron.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
