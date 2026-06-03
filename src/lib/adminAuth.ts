import { NextRequest, NextResponse } from "next/server";

// Simple shared-secret gate. The admin enters a password once; the browser
// sends it back on every admin request as the `x-admin-token` header. There's
// no user accounts system here, so this single env-var password is the gate.
export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || "";
}

export function isAdmin(req: NextRequest): boolean {
  const pw = adminPassword();
  if (!pw) return false; // not configured -> admin disabled
  const token = req.headers.get("x-admin-token") || "";
  return token === pw;
}

// Returns a 401 response if the caller isn't an admin, else null.
export function requireAdmin(req: NextRequest): NextResponse | null {
  if (!adminPassword()) {
    return NextResponse.json(
      { error: "Admin is not configured. Set ADMIN_PASSWORD in your environment." },
      { status: 503 }
    );
  }
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return null;
}
