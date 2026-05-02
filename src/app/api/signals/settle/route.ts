import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { settleSignalSnapshots } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export async function POST(request: Request) {
  const auth = checkAdminSecret(request);

  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: auth.message
      },
      { status: auth.status }
    );
  }

  try {
    const body: unknown = await request.json().catch(() => ({}));
    const record = isRecord(body) ? body : {};

    const targetDate = stringOrNull(record.targetDate);
    const hktDate = stringOrNull(record.hktDate);
    const officialMaxTempC = numberOrNull(record.officialMaxTempC);

    if (officialMaxTempC === null) {
      return NextResponse.json(
        {
          ok: false,
          error: "officialMaxTempC is required."
        },
        { status: 400 }
      );
    }

    if (!targetDate && !hktDate) {
      return NextResponse.json(
        {
          ok: false,
          error: "Either targetDate or hktDate is required."
        },
        { status: 400 }
      );
    }

    const result = await settleSignalSnapshots({
      targetDate,
      hktDate,
      officialMaxTempC
    });

    return NextResponse.json({
      ok: true,
      data: result
    });
  } catch (error) {
    console.error("Signal settle API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to settle signal snapshots."
      },
      { status: 500 }
    );
  }
}
