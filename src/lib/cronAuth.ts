// src/lib/cronAuth.ts

export type CronAuthResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

export function checkCronSecret(request: Request): CronAuthResult {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return {
      ok: false,
      status: 500,
      message: "CRON_SECRET is not configured on the server.",
    };
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const xCronSecret = request.headers.get("x-cron-secret") ?? "";

  if (authHeader === `Bearer ${expected}`) {
    return { ok: true };
  }

  /**
   * x-cron-secret is optional fallback for manual curl / GitHub Actions.
   * Prefer Authorization: Bearer <CRON_SECRET>.
   */
  if (xCronSecret === expected) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 401,
    message: "Unauthorized cron request.",
  };
}
