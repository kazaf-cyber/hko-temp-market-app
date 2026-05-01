import { NextResponse } from "next/server";
import { getPolymarketOutcomesFromInput } from "@/lib/polymarket";
import { getPolymarketClobSnapshot } from "@/lib/polymarketClob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input =
      url.searchParams.get("url") ??
      url.searchParams.get("slug") ??
      "";

    const includeClob =
      url.searchParams.get("includeClob") === "1" ||
      url.searchParams.get("includeClob") === "true";

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

    if (includeClob) {
      const clob = await getPolymarketClobSnapshot(data.outcomes);

      const clobByName = new Map(
        clob.outcomes.map((item) => [item.outcomeName, item])
      );

      data.outcomes = data.outcomes.map((outcome) => {
        const clobItem = clobByName.get(outcome.name);

        if (!clobItem) {
          return outcome;
        }

        return {
          ...outcome,

          /**
           * Make UI use CLOB midpoint as primary Polymarket probability.
           */
          marketPrice: clobItem.midpoint,
          price: clobItem.midpoint,
          marketPriceSource: "clob_midpoint",

          clobMidpoint: clobItem.midpoint,
          yesAsk: clobItem.yesAsk,
          noAsk: clobItem.noAsk,
          yesBid: clobItem.yesBid,
          clobSpread: clobItem.spread
        };
      });

      return NextResponse.json({
        ok: true,
        data: {
          ...data,
          clob
        }
      });
    }

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
