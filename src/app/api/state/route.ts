import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { getMarketState, saveMarketState } from "@/lib/state";
import { marketStateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getMarketState();

    return NextResponse.json({
      ok: true,
      data: state
    });
  } catch (error) {
    console.error("State GET error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load market state."
      },
      { status: 500 }
    );
  }
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
    const body = await request.json();
    const parsed = marketStateSchema.parse(body);
    const saved = await saveMarketState(parsed);

    return NextResponse.json({
      ok: true,
      data: saved
    });
  } catch (error) {
    console.error("State POST error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to save market state."
      },
      { status: 500 }
    );
  }
}
