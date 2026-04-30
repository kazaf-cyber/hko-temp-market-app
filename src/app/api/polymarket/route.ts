import { NextResponse } from "next/server";
import { getPolymarketOutcomesFromInput } from "@/lib/polymarket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input =
      url.searchParams.get("url") ??
      url.searchParams.get("slug") ??
      "";

    if (!input.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing url or slug."
        },
        { status: 400 }
      );
    }

    const data = await getPolymarketOutcomesFromInput(input);

    return NextResponse.json({
      ok: true,
      data
    });
  } catch (error) {
    console.error("Polymarket API route error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Polymarket outcomes."
      },
      { status: 500 }
    );
  }
}
