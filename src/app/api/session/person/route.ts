import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

interface AddPersonBody {
  slug?: string;
  hostToken?: string;
  name?: string;
  photo_url?: string | null;
  friend_id?: string | null;
}

/**
 * POST /api/session/person
 * Add a late person to an existing split. Gated by the host token so only the
 * device that created the split can add people. Duplicate names (case-insensitive)
 * are rejected so you can't end up with "Suhas" and "suhas".
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AddPersonBody;
    const slug = (body.slug || "").trim();
    const hostToken = (body.hostToken || "").trim();
    const name = (body.name || "").trim();

    if (!slug || !hostToken) {
      return NextResponse.json({ error: "Missing session or host token." }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "Enter a name." }, { status: 400 });
    }

    const db = getAdminClient();

    // Verify host token matches this session.
    const { data: session, error: sErr } = await db
      .from("sessions")
      .select("id, host_token")
      .eq("slug", slug)
      .single();

    if (sErr || !session) {
      return NextResponse.json({ error: "Split not found." }, { status: 404 });
    }
    if (session.host_token !== hostToken) {
      return NextResponse.json(
        { error: "Only the person who created this split can add people." },
        { status: 403 }
      );
    }

    // Reject a case-insensitive duplicate name already in this split.
    const { data: existing } = await db
      .from("people")
      .select("id, name")
      .eq("session_id", session.id);
    const clash = (existing ?? []).some(
      (p) => (p.name || "").toLowerCase() === name.toLowerCase()
    );
    if (clash) {
      return NextResponse.json(
        { error: `"${name}" is already in this split.` },
        { status: 409 }
      );
    }

    const { data: person, error: pErr } = await db
      .from("people")
      .insert({
        session_id: session.id,
        name,
        photo_url: body.photo_url ?? null,
        friend_id: body.friend_id ?? null,
      })
      .select()
      .single();

    if (pErr || !person) {
      console.error(pErr);
      return NextResponse.json({ error: "Could not add person." }, { status: 500 });
    }

    return NextResponse.json({ person });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}
