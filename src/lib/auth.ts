export function checkAdminSecret(request: Request) {
  const expected = process.env.ADMIN_SECRET;

  if (!expected) {
    return {
      ok: false,
      status: 500,
      message: "ADMIN_SECRET is not configured on the server."
    };
  }

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-admin-secret") ??
    url.searchParams.get("adminSecret") ??
    "";

  if (provided !== expected) {
    return {
      ok: false,
      status: 401,
      message: "Invalid admin secret."
    };
  }

  return {
    ok: true,
    status: 200,
    message: "OK"
  };
}
