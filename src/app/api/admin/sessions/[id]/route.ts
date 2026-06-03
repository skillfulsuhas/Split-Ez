import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";

// DELETE /api/admin/sessions/:id -> delete a split and everything under it.
// claims cascade from items; we delete claims/items/people explicitly in case
// the DB lacks ON DELETE CASCADE, then the session row itself.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const db = getAdminClient();

    const { data: items } = await db.from("items").select("id").eq("session_id", params.id);
    const itemIds = (items ?? []).map((i) => i.id);
    if (itemIds.length > 0) {
      await db.from("claims").delete().in("item_id", itemIds);
    }
    await db.from("items").delete().eq("session_id", params.id);
    await db.from("people").delete().eq("session_id", params.id);
    const { error } = await db.from("sessions").delete().eq("id", params.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not delete session." }, { status: 500 });
  }
}
