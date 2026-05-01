import { NextResponse } from "next/server";
import { getMultiChannelSnapshot } from "@/lib/multichannel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeClob =
      url.searchParams.get("includeClob") === "1" ||
      url.searchParams.get("includeClob") === "true";

    const polymarketUrl =
  url.searchParams.get("polymarketUrl") ??
  url.searchParams.get("url") ??
  null;

const data = await getMultiChannelSnapshot({
  includeClob,
  polymarketUrl
});

    return NextResponse.json({
      ok: true,
      data
    });
  } catch (error) {
    console.error("Live data API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load multi-channel live data."
      },
      { status: 500 }
    );
  }
}
