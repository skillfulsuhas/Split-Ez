import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminAuth";
import { computeSplit } from "@/lib/compute";
import type { Person, Item, Claim } from "@/lib/types";

export const runtime = "nodejs";

// GET /api/admin/sessions -> every split, newest first, with computed totals.
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const db = getAdminClient();
    const { data: sessions, error } = await db
      .from("sessions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!sessions || sessions.length === 0) return NextResponse.json({ sessions: [] });

    const ids = sessions.map((s) => s.id);
    const [{ data: people }, { data: items }, { data: claims }] = await Promise.all([
      db.from("people").select("*").in("session_id", ids),
      db.from("items").select("*").in("session_id", ids),
      db.from("claims").select("*, items!inner(session_id)").in("items.session_id", ids),
    ]);

    const peopleBy = groupBy(people ?? [], (p: any) => p.session_id);
    const itemsBy = groupBy(items ?? [], (i: any) => i.session_id);
    const claimsBy = groupBy(claims ?? [], (c: any) => c.items?.session_id);

    const out = sessions.map((s) => {
      const sp = (peopleBy.get(s.id) ?? []) as Person[];
      const si = (itemsBy.get(s.id) ?? []) as Item[];
      const sc = ((claimsBy.get(s.id) ?? []) as any[]).map((c) => ({
        id: c.id,
        item_id: c.item_id,
        person_id: c.person_id,
        weight: Number(c.weight),
      })) as Claim[];
      const r = computeSplit({
        people: sp,
        items: si,
        claims: sc,
        tax: Number(s.tax),
        serviceCharge: Number(s.service_charge),
        extras: Number(s.extras),
        discount: Number(s.discount),
      });
      return {
        id: s.id,
        slug: s.slug,
        title: s.title,
        currency: s.currency,
        created_at: s.created_at,
        peopleCount: sp.length,
        itemsCount: si.length,
        billTotal: r.billTotal,
        people: sp.map((p) => p.name),
      };
    });

    return NextResponse.json({ sessions: out });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not load sessions." }, { status: 500 });
  }
}

function groupBy<T>(arr: T[], key: (x: T) => string | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = key(x);
    if (!k) continue;
    const a = m.get(k) ?? [];
    a.push(x);
    m.set(k, a);
  }
  return m;
}
