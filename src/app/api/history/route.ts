import { NextResponse } from "next/server";
import { getForecastHistory, isDatabaseEnabled } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "30");

    const history = await getForecastHistory(limit);

    return NextResponse.json({
      ok: true,
      data: {
        databaseEnabled: isDatabaseEnabled(),
        history
      }
    });
  } catch (error) {
    console.error("History API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load forecast history."
      },
      { status: 500 }
    );
  }
}
