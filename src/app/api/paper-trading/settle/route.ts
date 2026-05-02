import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { settlePaperTrades } from "@/lib/paperTradingDb";

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

    const result = await settlePaperTrades({
      snapshotKey: stringOrNull(record.snapshotKey),
      targetDate: stringOrNull(record.targetDate),
      hktDate: stringOrNull(record.hktDate)
    });

    return NextResponse.json({
      ok: true,
      data: result
    });
  } catch (error) {
    console.error("Paper trading settle API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to settle paper trades."
      },
      { status: 500 }
    );
  }
}
