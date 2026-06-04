import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabaseAdmin";
import { newSlug, newHostToken } from "@/lib/slug";

export const runtime = "nodejs";

interface CreateBody {
  title?: string;
  currency?: string;
  tax?: number;
  service_charge?: number;
  extras?: number;
  discount?: number;
  payer_name?: string | null;
  payer_upi?: string | null;
  items: { name: string; price: number }[];
  // Accept plain names (legacy) or rich objects with an avatar / friend link.
  people: (string | { name: string; photo_url?: string | null; friend_id?: string | null })[];
  imageBase64?: string;
  mimeType?: string;
}

interface PersonInput {
  name: string;
  photo_url: string | null;
  friend_id: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateBody;

    const items = (body.items || []).filter((i) => i.name?.trim());
    const seenNames = new Set<string>();
    const people: PersonInput[] = (body.people || [])
      .map((p): PersonInput => {
        if (typeof p === "string") return { name: p.trim(), photo_url: null, friend_id: null };
        return {
          name: (p.name || "").trim(),
          photo_url: p.photo_url ?? null,
          friend_id: p.friend_id ?? null,
        };
      })
      .filter((p) => p.name)
      // Drop case-insensitive duplicate names — keep the first occurrence only.
      .filter((p) => {
        const key = p.name.toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });

    if (people.length === 0) {
      return NextResponse.json({ error: "Add at least one person." }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json({ error: "Add at least one item." }, { status: 400 });
    }

    const db = getAdminClient();
    const slug = newSlug();
    const hostToken = newHostToken();

    // Optional: upload bill image to storage.
    let billImageUrl: string | null = null;
    if (body.imageBase64) {
      const buffer = Buffer.from(body.imageBase64, "base64");
      const ext = (body.mimeType || "image/jpeg").split("/")[1] || "jpg";
      const path = `${slug}/bill.${ext}`;
      const { error: upErr } = await db.storage
        .from("bills")
        .upload(path, buffer, { contentType: body.mimeType || "image/jpeg", upsert: true });
      if (!upErr) {
        billImageUrl = db.storage.from("bills").getPublicUrl(path).data.publicUrl;
      }
    }

    const { data: session, error: sErr } = await db
      .from("sessions")
      .insert({
        slug,
        title: body.title?.trim() || null,
        currency: body.currency || "INR",
        tax: Number(body.tax) || 0,
        service_charge: Number(body.service_charge) || 0,
        extras: Number(body.extras) || 0,
        discount: Math.max(0, Number(body.discount) || 0),
        payer_name: body.payer_name?.trim() || null,
        payer_upi: body.payer_upi?.trim() || null,
        bill_image_url: billImageUrl,
        host_token: hostToken,
        published: true,
      })
      .select()
      .single();

    if (sErr || !session) {
      console.error(sErr);
      return NextResponse.json({ error: "Could not create session." }, { status: 500 });
    }

    const { error: pErr } = await db.from("people").insert(
      people.map((p) => ({
        session_id: session.id,
        name: p.name,
        photo_url: p.photo_url,
        friend_id: p.friend_id,
      }))
    );

    const { error: iErr } = await db.from("items").insert(
      items.map((it, idx) => ({
        session_id: session.id,
        name: it.name.trim(),
        price: Number(it.price) || 0,
        sort_order: idx,
      }))
    );

    if (pErr || iErr) {
      console.error(pErr || iErr);
      return NextResponse.json({ error: "Could not save people/items." }, { status: 500 });
    }

    return NextResponse.json({ slug, hostToken });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}
