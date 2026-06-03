import { NextRequest, NextResponse } from "next/server";
import { adminPassword } from "@/lib/adminAuth";

export const runtime = "nodejs";

// POST /api/admin/login  { password }  -> { ok: true } if it matches.
export async function POST(req: NextRequest) {
  if (!adminPassword()) {
    return NextResponse.json(
      { error: "Admin is not configured. Set ADMIN_PASSWORD in your environment." },
      { status: 503 }
    );
  }
  try {
    const { password } = (await req.json()) as { password?: string };
    if ((password || "") === adminPassword()) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
}
