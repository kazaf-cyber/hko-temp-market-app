import { NextResponse } from "next/server";
import { getHkoWeatherSnapshot } from "@/lib/hko";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getHkoWeatherSnapshot();

    return NextResponse.json({
      ok: true,
      data: snapshot
    });
  } catch (error) {
    console.error("Weather API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch HKO weather data."
      },
      { status: 500 }
    );
  }
}
