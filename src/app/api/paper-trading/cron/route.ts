import { NextResponse } from "next/server";
import { checkAdminSecret } from "@/lib/auth";
import { runAutoPaperTrading } from "@/lib/paperTradingDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function checkCronOrAdminSecret(request: Request): {
  ok: boolean;
  status: number;
  message: string | null;
} {
  const admin = checkAdminSecret(request);

  if (admin.ok) {
    return {
      ok: true,
      status: 200,
      message: null
    };
  }

  const cronSecret =
    process.env.PAPER_TRADING_CRON_SECRET ?? process.env.CRON_SECRET;

  if (!cronSecret) {
    return {
      ok: false,
      status: 500,
      message:
        "PAPER_TRADING_CRON_SECRET or CRON_SECRET is not configured. Admin auth may still be used on the run endpoint."
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  const headerSecret = request.headers.get("x-cron-secret")?.trim();

  if (bearer === cronSecret || headerSecret === cronSecret) {
    return {
      ok: true,
      status: 200,
      message: null
    };
  }

  return {
    ok: false,
    status: 401,
    message: "Unauthorized cron request."
  };
}

function parseBooleanParam(value: string | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

async function handleCron(request: Request) {
  const auth = checkCronOrAdminSecret(request);

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
    const url = new URL(request.url);

    const result = await runAutoPaperTrading({
      dryRun: parseBooleanParam(url.searchParams.get("dryRun"), false),
      limit: parseLimit(url.searchParams.get("limit")),
      force: false
    });

    return NextResponse.json(
      {
        ok: result.ok,
        data: result,
        error: result.ok ? null : result.reason
      },
      {
        status: result.ok ? 200 : result.databaseEnabled ? 400 : 503
      }
    );
  } catch (error) {
    console.error("Paper trading cron API error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to run paper trading cron."
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
