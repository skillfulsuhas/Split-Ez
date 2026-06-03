import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";

interface MergeBody {
  keepId?: string; // the friend to keep
  mergeIds?: string[]; // duplicates to fold into keepId and delete
}

// POST /api/admin/friends/merge -> re-point all people rows from the duplicate
// friends onto the kept friend, then delete the duplicates.
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const { keepId, mergeIds } = (await req.json()) as MergeBody;
    if (!keepId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
      return NextResponse.json({ error: "keepId and mergeIds are required." }, { status: 400 });
    }
    const dups = mergeIds.filter((id) => id && id !== keepId);
    if (dups.length === 0) return NextResponse.json({ ok: true, merged: 0 });

    const db = getAdminClient();

    // The kept friend's photo, so re-pointed people inherit a consistent face.
    const { data: keep } = await db
      .from("friends")
      .select("id, photo_url")
      .eq("id", keepId)
      .maybeSingle();
    if (!keep) return NextResponse.json({ error: "Kept friend not found." }, { status: 404 });

    await db
      .from("people")
      .update({ friend_id: keepId, photo_url: keep.photo_url })
      .in("friend_id", dups);

    const { error } = await db.from("friends").delete().in("id", dups);
    if (error) throw error;

    return NextResponse.json({ ok: true, merged: dups.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not merge friends." }, { status: 500 });
  }
}
