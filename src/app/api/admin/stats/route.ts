import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminAuth";
import { computeSplit } from "@/lib/compute";
import type { Person, Item, Claim } from "@/lib/types";

export const runtime = "nodejs";

// GET /api/admin/stats?who=suhas
// Aggregate statistics across every split: total spend, outings over time,
// per-person spend, frequent diners, and a spotlight on one named person.
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const who = (req.nextUrl.searchParams.get("who") || "suhas").trim().toLowerCase();

  try {
    const db = getAdminClient();
    const { data: sessions } = await db.from("sessions").select("*").order("created_at");
    if (!sessions || sessions.length === 0) {
      return NextResponse.json({
        totalBill: 0,
        outings: 0,
        currency: "INR",
        byMonth: [],
        perPerson: [],
        spotlight: null,
        who,
      });
    }

    const ids = sessions.map((s) => s.id);
    const [{ data: people }, { data: items }, { data: claims }] = await Promise.all([
      db.from("people").select("*").in("session_id", ids),
      db.from("items").select("*").in("session_id", ids),
      db.from("claims").select("*, items!inner(session_id)").in("items.session_id", ids),
    ]);

    const peopleBy = groupBy(people ?? [], (p: any) => p.session_id);
    const itemsBy = groupBy(items ?? [], (i: any) => i.session_id);
    const claimsBy = groupBy(claims ?? [], (c: any) => c.items?.session_id);

    // Aggregate by normalised person name (keeps people without friend_id).
    interface Agg {
      name: string;
      total: number;
      outings: number;
      photo_url: string | null;
    }
    const perName = new Map<string, Agg>();
    const byMonth = new Map<string, number>(); // YYYY-MM -> bill total
    let totalBill = 0;
    const currency = sessions[0].currency || "INR";

    const spotlightMonth = new Map<string, number>();
    let spotlightTotal = 0;
    let spotlightOutings = 0;

    for (const s of sessions) {
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

      const month = (s.created_at || "").slice(0, 7);
      totalBill += r.billTotal;
      byMonth.set(month, (byMonth.get(month) ?? 0) + r.billTotal);

      const photoByName = new Map<string, string | null>();
      for (const p of sp) photoByName.set(p.name.toLowerCase(), p.photo_url ?? null);

      for (const pp of r.perPerson) {
        const key = pp.name.trim().toLowerCase();
        const cur = perName.get(key) ?? {
          name: pp.name.trim(),
          total: 0,
          outings: 0,
          photo_url: photoByName.get(key) ?? null,
        };
        cur.total += pp.total;
        cur.outings += 1;
        if (!cur.photo_url) cur.photo_url = photoByName.get(key) ?? null;
        perName.set(key, cur);

        if (key === who) {
          spotlightTotal += pp.total;
          spotlightOutings += 1;
          spotlightMonth.set(month, (spotlightMonth.get(month) ?? 0) + pp.total);
        }
      }
    }

    const perPerson = Array.from(perName.values())
      .map((a) => ({ ...a, total: round2(a.total) }))
      .sort((a, b) => b.total - a.total);

    const monthsSorted = Array.from(byMonth.keys()).sort();
    const byMonthArr = monthsSorted.map((m) => ({
      month: m,
      total: round2(byMonth.get(m) ?? 0),
    }));

    const spotlight =
      spotlightOutings > 0
        ? {
            name: perName.get(who)?.name ?? who,
            total: round2(spotlightTotal),
            outings: spotlightOutings,
            byMonth: monthsSorted.map((m) => ({
              month: m,
              total: round2(spotlightMonth.get(m) ?? 0),
            })),
          }
        : null;

    return NextResponse.json({
      totalBill: round2(totalBill),
      outings: sessions.length,
      currency,
      byMonth: byMonthArr,
      perPerson,
      spotlight,
      who,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not compute stats." }, { status: 500 });
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
