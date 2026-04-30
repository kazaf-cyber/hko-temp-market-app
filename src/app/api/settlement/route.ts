import { NextResponse } from "next/server";
import { getHkoSettlementMax } from "@/lib/hko";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getYesterdayHktCompact() {
  const now = new Date();
  const hktNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" })
  );

  hktNow.setDate(hktNow.getDate() - 1);

  const year = hktNow.getFullYear();
  const month = String(hktNow.getMonth() + 1).padStart(2, "0");
  const day = String(hktNow.getDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? getYesterdayHktCompact();

    if (!/^\d{8}$/.test(date)) {
      return NextResponse.json(
        {
          ok: false,
          error: "date must be YYYYMMDD."
        },
        { status: 400 }
      );
    }

    const settlement = await getHkoSettlementMax(date);

    return NextResponse.json({
      ok: true,
      data: settlement
    });
  } catch (error) {
    console.error("Settlement API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch settlement data."
      },
      { status: 500 }
    );
  }
}
