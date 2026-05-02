import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { initDatabase } from "@/lib/db";
import { defaultMarketState } from "@/lib/defaults";
import { saveMarketState } from "@/lib/state";
import { initPaperTradingDatabase } from "@/lib/paperTradingDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    await initDatabase();
    await initPaperTradingDatabase();
    await saveMarketState(defaultMarketState);

    return NextResponse.json({
      ok: true,
      data: {
        message: "Database initialized and default market state saved."
      }
    });
  } catch (error) {
    console.error("Init DB error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to initialize database."
      },
      { status: 500 }
    );
  }
}
