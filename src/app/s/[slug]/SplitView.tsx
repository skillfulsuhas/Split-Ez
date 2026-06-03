"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { computeSplit, formatMoney, splitItem } from "@/lib/compute";
import type { Session, Person, Item, Claim } from "@/lib/types";
import Avatar from "@/components/Avatar";

interface Props {
  session: Session;
  initialPeople: Person[];
  initialItems: Item[];
  initialClaims: Claim[];
}

// Preset portions offered to each claimer. value is the stored fraction;
// 0 means "equal share of whatever's left".
const PORTIONS: { label: string; value: number }[] = [
  { label: "Equal", value: 0 },
  { label: "½", value: 0.5 },
  { label: "⅓", value: 0.3333 },
  { label: "¼", value: 0.25 },
  { label: "⅕", value: 0.2 },
];

function portionLabel(weight: number): string {
  if (!(weight > 0)) return "Equal";
  const match = PORTIONS.find((p) => Math.abs(p.value - weight) < 0.01);
  return match ? match.label : `${Math.round(weight * 100)}%`;
}

// Parse a free-text portion into a fraction in (0, 1].
// Accepts "3/5", "2/7", "40%", "0.4", or "1/2".  Returns null if unparseable.
function parsePortion(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  let v: number | null = null;
  if (s.includes("/")) {
    const [a, b] = s.split("/");
    const num = parseFloat(a);
    const den = parseFloat(b);
    if (isFinite(num) && isFinite(den) && den !== 0) v = num / den;
  } else if (s.endsWith("%")) {
    const p = parseFloat(s.slice(0, -1));
    if (isFinite(p)) v = p / 100;
  } else {
    const n = parseFloat(s);
    if (isFinite(n)) v = n > 1 ? n / 100 : n; // "40" → 0.4, "0.4" → 0.4
  }
  if (v === null || !isFinite(v) || v <= 0) return null;
  return Math.min(1, v);
}

// Is this weight one of the presets (so the Custom field shouldn't claim it)?
function isPreset(weight: number): boolean {
  if (!(weight > 0)) return true;
  return PORTIONS.some((p) => p.value > 0 && Math.abs(p.value - weight) < 0.01);
}

export default function SplitView({ session, initialPeople, initialItems, initialClaims }: Props) {
  const [people, setPeople] = useState<Person[]>(initialPeople);
  const [items, setItems] = useState<Item[]>(initialItems);
  const [claims, setClaims] = useState<Claim[]>(initialClaims);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  // Per-item draft text for the "Custom" portion field.
  const [customOpen, setCustomOpen] = useState<Set<string>>(new Set());
  const [customVal, setCustomVal] = useState<Record<string, string>>({});

  const cur = session.currency || "INR";
  const meKey = `billsplit:me:${session.slug}`;

  // Restore "who am I" from this device.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(meKey) : null;
    if (saved && initialPeople.some((p) => p.id === saved)) setMeId(saved);
  }, [meKey, initialPeople]);

  // ---- Live refetch (called on any realtime event) ----
  const refetch = useCallback(async () => {
    const [pp, ii, cc] = await Promise.all([
      supabase.from("people").select("*").eq("session_id", session.id).order("created_at"),
      supabase.from("items").select("*").eq("session_id", session.id).order("sort_order"),
      supabase.from("claims").select("*, items!inner(session_id)").eq("items.session_id", session.id),
    ]);
    if (pp.data) setPeople(pp.data as Person[]);
    if (ii.data) setItems(ii.data as Item[]);
    if (cc.data)
      setClaims(
        (cc.data as any[]).map((c) => ({
          id: c.id,
          item_id: c.item_id,
          person_id: c.person_id,
          weight: Number(c.weight),
        }))
      );
  }, [session.id]);

  // ---- Realtime subscription ----
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const ping = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(refetch, 150);
    };
    const channel = supabase
      .channel(`session:${session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "claims" }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, ping)
      .on("postgres_changes", { event: "*", schema: "public", table: "people" }, ping)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session.id, refetch]);

  // ---- Derived data ----
  const claimsByItem = useMemo(() => {
    const m = new Map<string, Claim[]>();
    for (const c of claims) {
      const arr = m.get(c.item_id) ?? [];
      arr.push(c);
      m.set(c.item_id, arr);
    }
    return m;
  }, [claims]);

  const result = useMemo(
    () =>
      computeSplit({
        people,
        items,
        claims,
        tax: Number(session.tax),
        serviceCharge: Number(session.service_charge),
        extras: Number(session.extras),
        discount: Number(session.discount),
      }),
    [people, items, claims, session]
  );

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const myClaim = (itemId: string) =>
    meId ? claimsByItem.get(itemId)?.find((c) => c.person_id === meId) ?? null : null;

  // Itemised detail per person: which dishes they're on and what each costs them.
  const detailByPerson = useMemo(() => {
    const m = new Map<string, { name: string; amount: number }[]>();
    for (const item of items) {
      const its = claimsByItem.get(item.id) ?? [];
      if (its.length === 0) continue;
      const shares = splitItem(Number(item.price), its);
      shares.forEach((amount, pid) => {
        const arr = m.get(pid) ?? [];
        arr.push({ name: item.name, amount });
        m.set(pid, arr);
      });
    }
    return m;
  }, [items, claimsByItem]);

  // Progress: how many items have at least one claimer.
  const claimedCount = items.length - result.unclaimedItems.length;
  const progress = items.length > 0 ? claimedCount / items.length : 0;
  const allClaimed = items.length > 0 && result.unclaimedItems.length === 0;

  // ---- Mutations (browser anon client; RLS allows claim writes) ----
  async function withBusy(key: string, fn: () => Promise<void>) {
    setBusy((b) => new Set(b).add(key));
    try {
      await fn();
      await refetch();
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(key);
        return n;
      });
    }
  }

  async function toggleClaim(item: Item) {
    if (!meId) return;
    const existing = myClaim(item.id);
    await withBusy(item.id, async () => {
      if (existing) {
        await supabase.from("claims").delete().eq("item_id", item.id).eq("person_id", meId);
      } else {
        // weight 0 = "equal share" by default.
        await supabase.from("claims").insert({ item_id: item.id, person_id: meId, weight: 0 });
      }
    });
  }

  // Set this person's portion of a shared item (0 = equal share of the leftover).
  async function setPortion(item: Item, weight: number) {
    if (!meId) return;
    const w = Math.max(0, weight);
    await withBusy(item.id, async () => {
      await supabase
        .from("claims")
        .update({ weight: w })
        .eq("item_id", item.id)
        .eq("person_id", meId);
    });
  }

  function chooseMe(id: string) {
    setMeId(id);
    localStorage.setItem(meKey, id);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const myTotal = meId ? result.perPerson.find((p) => p.personId === meId) : null;

  // ---- "Who are you?" gate ----
  if (!meId) {
    return (
      <main className="flex flex-col gap-6 pt-2">
        <div className="card animate-pop-in">
          <span className="chip chip-off w-fit">👋 Tap to join</span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
            {session.title || "Split the bill"}
          </h1>
          <p className="mt-1 text-slate-600">Tap your name to start claiming what you ate.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => chooseMe(p.id)}
              className="flex flex-col items-center gap-2 rounded-2xl border border-white/60 bg-white/90 px-4 py-5 text-lg font-bold shadow-card backdrop-blur transition hover:border-brand hover:text-brand active:scale-[0.98]"
            >
              <Avatar name={p.name} photoUrl={p.photo_url} size={56} ring enlargeable />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <p className="text-center text-xs text-slate-400">
          Not in the list? Ask whoever started the split to add you.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-5 pt-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={peopleById.get(meId)?.name ?? "?"} photoUrl={peopleById.get(meId)?.photo_url} size={44} ring enlargeable />
          <div>
            <h1 className="text-xl font-extrabold leading-tight tracking-tight">
              {session.title || "Split the bill"}
            </h1>
            <button
              onClick={() => setMeId(null)}
              className="text-sm font-medium text-brand"
            >
              You&apos;re <b>{peopleById.get(meId)?.name}</b> · change
            </button>
          </div>
        </div>
        <button
          onClick={copyLink}
          className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand hover:text-brand"
        >
          {copied ? "Copied!" : "Share link"}
        </button>
      </header>

      {/* Claim progress */}
      <div className="card py-3">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-slate-600">
            {allClaimed ? "🎉 All items claimed!" : `${claimedCount} of ${items.length} items claimed`}
          </span>
          <span className="font-bold text-brand">{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-accent transition-all duration-500"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>

      {allClaimed && <Confetti />}

      {/* Items */}
      <section className="space-y-2">
        {items.map((item) => {
          const its = claimsByItem.get(item.id) ?? [];
          const mine = myClaim(item.id);
          const shares = splitItem(Number(item.price), its);
          const isBusy = busy.has(item.id);

          return (
            <div
              key={item.id}
              className={`rounded-2xl border bg-white/90 p-4 shadow-card backdrop-blur transition ${
                mine ? "border-brand ring-2 ring-brand/25" : "border-white/60"
              }`}
            >
              <button
                onClick={() => toggleClaim(item)}
                disabled={isBusy}
                className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-60"
              >
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm text-slate-500">{formatMoney(Number(item.price), cur)}</div>
                </div>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm ${
                    mine ? "border-brand bg-brand text-white" : "border-slate-300 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>

              {its.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {its.map((c) => {
                    const nm = peopleById.get(c.person_id)?.name ?? "?";
                    const isMe = c.person_id === meId;
                    return (
                      <span
                        key={c.id}
                        className={`flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs ${
                          isMe ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-600"
                        }`}
                        title={`${nm} pays ${formatMoney(shares.get(c.person_id) ?? 0, cur)}`}
                      >
                        <Avatar name={nm} photoUrl={peopleById.get(c.person_id)?.photo_url} size={18} enlargeable />
                        {nm}
                        {c.weight > 0 ? ` · ${portionLabel(c.weight)}` : ""}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Portion picker for shared items */}
              {mine && its.length > 1 && (
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
                  <div className="mb-1.5 text-xs font-medium text-slate-500">
                    How much did you eat?
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {PORTIONS.map((opt) => {
                      const active =
                        opt.value === 0
                          ? !(mine.weight > 0)
                          : Math.abs((mine.weight || 0) - opt.value) < 0.01;
                      return (
                        <button
                          key={opt.label}
                          onClick={() => {
                            setCustomOpen((s) => {
                              const n = new Set(s);
                              n.delete(item.id);
                              return n;
                            });
                            setPortion(item, opt.value);
                          }}
                          disabled={isBusy}
                          className={`chip text-xs ${active ? "chip-on" : "chip-off"}`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                    {(() => {
                      const customActive = mine.weight > 0 && !isPreset(mine.weight);
                      const open = customOpen.has(item.id) || customActive;
                      return (
                        <button
                          onClick={() =>
                            setCustomOpen((s) => {
                              const n = new Set(s);
                              if (n.has(item.id)) n.delete(item.id);
                              else n.add(item.id);
                              return n;
                            })
                          }
                          disabled={isBusy}
                          className={`chip text-xs ${open ? "chip-on" : "chip-off"}`}
                        >
                          {customActive ? portionLabel(mine.weight) : "Custom…"}
                        </button>
                      );
                    })()}
                  </div>

                  {/* Free-text fraction input */}
                  {(customOpen.has(item.id) || (mine.weight > 0 && !isPreset(mine.weight))) && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={
                            customVal[item.id] ??
                            (mine.weight > 0 && !isPreset(mine.weight)
                              ? String(Math.round(mine.weight * 100) / 100)
                              : "")
                          }
                          onChange={(e) =>
                            setCustomVal((v) => ({ ...v, [item.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const f = parsePortion(customVal[item.id] ?? "");
                              if (f !== null) setPortion(item, f);
                            }
                          }}
                          placeholder="e.g. 3/5, 2/7, 40%"
                          inputMode="text"
                          className="w-32 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                        />
                        <button
                          onClick={() => {
                            const f = parsePortion(customVal[item.id] ?? "");
                            if (f !== null) setPortion(item, f);
                          }}
                          disabled={isBusy || parsePortion(customVal[item.id] ?? "") === null}
                          className="chip chip-on text-xs disabled:opacity-40"
                        >
                          Set
                        </button>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        Enter any fraction, percentage, or decimal of this dish.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {mine && (
                <div className="mt-2 text-right text-sm font-medium text-brand">
                  You pay {formatMoney(shares.get(meId) ?? 0, cur)}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Unclaimed warning */}
      {result.unclaimedItems.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <b>{result.unclaimedItems.length} item(s)</b> nobody has claimed yet:{" "}
          {result.unclaimedItems.map((i) => i.name).join(", ")}. These aren&apos;t in anyone&apos;s
          total until someone taps them.
        </div>
      )}

      {/* Your total */}
      {myTotal && (
        <div className="rounded-3xl bg-gradient-to-br from-brand to-accent p-5 text-white shadow-soft">
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-90">Your total</span>
            <span className="text-3xl font-extrabold">{formatMoney(myTotal.total, cur)}</span>
          </div>
          <div className="mt-1.5 text-xs opacity-90">
            Items {formatMoney(myTotal.subtotal, cur)} · Tax {formatMoney(myTotal.taxShare, cur)} ·
            Service {formatMoney(myTotal.serviceShare, cur)}
            {Number(session.extras) ? ` · Extras ${formatMoney(myTotal.extrasShare, cur)}` : ""}
            {myTotal.discountShare ? ` · Discount −${formatMoney(myTotal.discountShare, cur)}` : ""}
          </div>
        </div>
      )}

      {/* Everyone summary — tap a person to see their exact breakdown */}
      <div>
        <button
          onClick={() => setShowSummary((s) => !s)}
          className="text-sm font-semibold text-brand"
        >
          {showSummary ? "Hide" : "Show"} everyone&apos;s totals
        </button>
        {showSummary && (
          <div className="mt-3 overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-card backdrop-blur">
            {result.perPerson.map((p) => {
              const isOpen = expandedPerson === p.personId;
              const dishes = detailByPerson.get(p.personId) ?? [];
              return (
                <div key={p.personId} className="border-b border-slate-100 last:border-0">
                  <button
                    onClick={() => setExpandedPerson(isOpen ? null : p.personId)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm ${
                      p.personId === meId ? "bg-brand/5" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Avatar name={p.name} photoUrl={peopleById.get(p.personId)?.photo_url} size={28} enlargeable />
                      {p.name}
                      <span className="text-slate-400">{isOpen ? "▾" : "▸"}</span>
                    </span>
                    <span className="font-bold">{formatMoney(p.total, cur)}</span>
                  </button>

                  {isOpen && (
                    <div className="animate-pop-in space-y-1 bg-slate-50/70 px-4 pb-3 pt-1 text-xs text-slate-600">
                      {dishes.length === 0 && <div className="italic">Hasn&apos;t claimed anything yet.</div>}
                      {dishes.map((d, idx) => (
                        <div key={idx} className="flex justify-between">
                          <span>{d.name}</span>
                          <span>{formatMoney(d.amount, cur)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t border-slate-200 pt-1">
                        <span>Items subtotal</span>
                        <span>{formatMoney(p.subtotal, cur)}</span>
                      </div>
                      {p.taxShare > 0 && (
                        <div className="flex justify-between">
                          <span>Tax (by what you ate)</span>
                          <span>{formatMoney(p.taxShare, cur)}</span>
                        </div>
                      )}
                      {p.serviceShare > 0 && (
                        <div className="flex justify-between">
                          <span>Service (split equally)</span>
                          <span>{formatMoney(p.serviceShare, cur)}</span>
                        </div>
                      )}
                      {p.extrasShare > 0 && (
                        <div className="flex justify-between">
                          <span>Extras (split equally)</span>
                          <span>{formatMoney(p.extrasShare, cur)}</span>
                        </div>
                      )}
                      {p.discountShare > 0 && (
                        <div className="flex justify-between text-green-600">
                          <span>Discount</span>
                          <span>−{formatMoney(p.discountShare, cur)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-slate-200 pt-1 font-bold text-slate-800">
                        <span>Total</span>
                        <span>{formatMoney(p.total, cur)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-slate-50 px-4 py-3 text-sm">
              <span className="text-slate-500">
                {result.unclaimedItems.length > 0 ? "Claimed so far" : "Bill total"}
              </span>
              <span className="font-bold">{formatMoney(result.grandTotal, cur)}</span>
            </div>
          </div>
        )}
      </div>

      {session.bill_image_url && (
        <a
          href={session.bill_image_url}
          target="_blank"
          rel="noreferrer"
          className="text-center text-sm text-slate-400 underline"
        >
          View the original bill
        </a>
      )}
    </main>
  );
}

/**
 * Lightweight CSS confetti — a short, one-shot celebration that fires when
 * every item has been claimed. No external deps.
 */
function Confetti() {
  const colors = ["#6366f1", "#8b5cf6", "#a855f7", "#f59e0b", "#10b981", "#ef4444"];
  const pieces = Array.from({ length: 36 });
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {pieces.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.6;
        const dur = 1.6 + Math.random() * 1.4;
        const size = 6 + Math.random() * 8;
        const color = colors[i % colors.length];
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${left}%`,
              top: 0,
              width: size,
              height: size * 0.5,
              background: color,
              borderRadius: 2,
              animation: `confetti-fall ${dur}s ${delay}s ease-in forwards`,
            }}
          />
        );
      })}
    </div>
  );
}
