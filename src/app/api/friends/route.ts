import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * GET /api/friends         -> the whole address book, so the client can load it
 *                             once and filter locally (no per-keystroke latency).
 * GET /api/friends?q=ali    -> server-side search (kept for compatibility).
 * Returns: [{ id, name, photo_url }].
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  try {
    const db = getAdminClient();
    let query = db.from("friends").select("id, name, photo_url").order("name");
    query = q ? query.ilike("name", `%${q}%`).limit(8) : query.limit(1000);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ friends: data ?? [] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ friends: [] });
  }
}

interface CreateBody {
  name?: string;
  imageBase64?: string;
  mimeType?: string;
}

/**
 * POST /api/friends  -> save a person to the address book (with optional photo).
 * Body: { name, imageBase64?, mimeType? }. Reuses an existing friend with the
 * same (case-insensitive) name, updating their photo if a new one is given.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateBody;
    const name = (body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }

    const db = getAdminClient();

    // Optional avatar upload.
    let photoUrl: string | null = null;
    if (body.imageBase64) {
      const buffer = Buffer.from(body.imageBase64, "base64");
      const ext = (body.mimeType || "image/jpeg").split("/")[1] || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await db.storage
        .from("avatars")
        .upload(path, buffer, { contentType: body.mimeType || "image/jpeg", upsert: true });
      if (!upErr) {
        photoUrl = db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }
    }

    // Reuse an existing friend with the same name (case-insensitive).
    const { data: existing } = await db
      .from("friends")
      .select("id, name, photo_url")
      .ilike("name", name)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Only overwrite the photo when a new one was uploaded.
      const photo_url = photoUrl ?? existing.photo_url;
      if (photoUrl && photoUrl !== existing.photo_url) {
        await db.from("friends").update({ photo_url: photoUrl }).eq("id", existing.id);
      }
      return NextResponse.json({ id: existing.id, name: existing.name, photo_url });
    }

    const { data: friend, error } = await db
      .from("friends")
      .insert({ name, photo_url: photoUrl })
      .select("id, name, photo_url")
      .single();

    if (error || !friend) {
      console.error(error);
      return NextResponse.json({ error: "Could not save friend." }, { status: 500 });
    }
    return NextResponse.json(friend);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}
