import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";

interface PatchBody {
  name?: string;
  imageBase64?: string;
  mimeType?: string;
  clearPhoto?: boolean;
}

// PATCH /api/admin/friends/:id -> rename and/or change photo.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as PatchBody;
    const db = getAdminClient();
    const update: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();

    if (body.clearPhoto) {
      update.photo_url = null;
    } else if (body.imageBase64) {
      const buffer = Buffer.from(body.imageBase64, "base64");
      const ext = (body.mimeType || "image/jpeg").split("/")[1] || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await db.storage
        .from("avatars")
        .upload(path, buffer, { contentType: body.mimeType || "image/jpeg", upsert: true });
      if (!upErr) update.photo_url = db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { data, error } = await db
      .from("friends")
      .update(update)
      .eq("id", params.id)
      .select("id, name, photo_url")
      .single();
    if (error || !data) throw error;

    // Keep already-placed people rows in sync (photo follows the friend).
    if (update.photo_url !== undefined) {
      await db.from("people").update({ photo_url: update.photo_url }).eq("friend_id", params.id);
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not update friend." }, { status: 500 });
  }
}

// DELETE /api/admin/friends/:id -> remove from address book.
// Existing people rows keep their copied name/photo; we just unlink them.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const db = getAdminClient();
    await db.from("people").update({ friend_id: null }).eq("friend_id", params.id);
    const { error } = await db.from("friends").delete().eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not delete friend." }, { status: 500 });
  }
}
