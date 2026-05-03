import { NextResponse } from "next/server";
import {
  appendForecastSnapshot,
  buildForecastArchiveStats,
  getForecastArchiveDebugInfo,
  readForecastArchive
} from "@/lib/forecastArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  return null;
}

function asInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const limit = asInteger(url.searchParams.get("limit")) ?? 50;
    const hktDate = asString(url.searchParams.get("hktDate"));

    const records = await readForecastArchive({
      limit,
      hktDate
    });

    const stats = buildForecastArchiveStats(records);

    return NextResponse.json({
      ok: true,
      records,
      stats,
      debug: getForecastArchiveDebugInfo()
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getErrorMessage(error)
      },
      {
        status: 500
      }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!isRecord(body)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Request body must be a JSON object."
        },
        {
          status: 400
        }
      );
    }

    /**
     * Accept both:
     * 1. POST { forecast, source, note }
     * 2. POST raw ForecastResult directly
     */
    const forecast = isRecord(body.forecast) ? body.forecast : body;

    if (!isRecord(forecast)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing forecast object."
        },
        {
          status: 400
        }
      );
    }

    const source = asString(body.source) ?? "api";
    const note = asString(body.note);

    const record = await appendForecastSnapshot(forecast, {
      source,
      note
    });

    return NextResponse.json({
      ok: true,
      record,
      debug: getForecastArchiveDebugInfo()
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getErrorMessage(error)
      },
      {
        status: 500
      }
    );
  }
}
