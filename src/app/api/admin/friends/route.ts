import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";

// GET /api/admin/friends -> full address book, with how many splits each is in.
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const db = getAdminClient();
    const [{ data: friends, error }, { data: links }] = await Promise.all([
      db.from("friends").select("id, name, photo_url, created_at").order("name"),
      db.from("people").select("friend_id"),
    ]);
    if (error) throw error;

    const counts = new Map<string, number>();
    for (const p of links ?? []) {
      if (p.friend_id) counts.set(p.friend_id, (counts.get(p.friend_id) ?? 0) + 1);
    }
    const out = (friends ?? []).map((f) => ({ ...f, uses: counts.get(f.id) ?? 0 }));
    return NextResponse.json({ friends: out });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not load friends." }, { status: 500 });
  }
}

interface CreateBody {
  name?: string;
  imageBase64?: string;
  mimeType?: string;
}

// POST /api/admin/friends -> create a new address-book entry (with optional photo).
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as CreateBody;
    const name = (body.name || "").trim();
    if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });

    const db = getAdminClient();

    let photoUrl: string | null = null;
    if (body.imageBase64) {
      const buffer = Buffer.from(body.imageBase64, "base64");
      const ext = (body.mimeType || "image/jpeg").split("/")[1] || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await db.storage
        .from("avatars")
        .upload(path, buffer, { contentType: body.mimeType || "image/jpeg", upsert: true });
      if (!upErr) photoUrl = db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    const { data: existing } = await db
      .from("friends")
      .select("id, name, photo_url")
      .ilike("name", name)
      .limit(1)
      .maybeSingle();

    if (existing) {
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
    if (error || !friend) throw error;
    return NextResponse.json(friend);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not create friend." }, { status: 500 });
  }
}
