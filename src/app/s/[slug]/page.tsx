import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/supabaseAdmin";
import SplitView from "./SplitView";
import type { Session, Person, Item, Claim } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: { slug: string } }) {
  const db = getAdminClient();

  const { data: session } = await db
    .from("sessions")
    .select("*")
    .eq("slug", params.slug)
    .single();

  if (!session) notFound();

  const [{ data: people }, { data: items }, { data: claims }] = await Promise.all([
    db.from("people").select("*").eq("session_id", session.id).order("created_at"),
    db.from("items").select("*").eq("session_id", session.id).order("sort_order"),
    db
      .from("claims")
      .select("*, items!inner(session_id)")
      .eq("items.session_id", session.id),
  ]);

  return (
    <SplitView
      session={session as Session}
      initialPeople={(people ?? []) as Person[]}
      initialItems={(items ?? []) as Item[]}
      initialClaims={((claims ?? []) as any[]).map((c) => ({
        id: c.id,
        item_id: c.item_id,
        person_id: c.person_id,
        weight: c.weight,
      })) as Claim[]}
    />
  );
}
