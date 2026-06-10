"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";
import { computeSplit, formatMoney, splitItem } from "@/lib/compute";
import type { Session, Person, Item, Claim, Friend } from "@/lib/types";
import Avatar from "@/components/Avatar";
import CountUp from "@/components/CountUp";
import PaySheet from "@/components/PaySheet";

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

// Words to ignore when matching a spoken sentence against dish names.
const VOICE_STOPWORDS = new Set([
  "the", "and", "with", "for", "ate", "had", "have", "also", "some", "one", "two",
  "plate", "plates", "order", "please", "piece", "pieces", "got", "took", "was",
  "were", "that", "this", "just", "only", "plus", "then", "served",
]);

// Find which items a spoken sentence refers to. Matches on each dish's
// distinctive words so "I had paneer tikka and a coke" claims those dishes.
function matchSpokenItems(transcript: string, items: Item[]): Item[] {
  const t = ` ${transcript.toLowerCase()} `;
  return items.filter((item) => {
    const base = item.name.toLowerCase().replace(/\([^)]*\)/g, " ");
    const tokens = base
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !VOICE_STOPWORDS.has(w));
    if (tokens.length === 0) return t.includes(base.trim());
    return tokens.some((tok) => t.includes(` ${tok}`) || t.includes(`${tok} `));
  });
}

// Tiny haptic tick on supported phones — makes taps feel physical.
function buzz(pattern: number | number[] = 8) {
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
}

// Shared springs.
const springy = { type: "spring", damping: 24, stiffness: 300 } as const;
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};
const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: springy },
};

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
  // Host-only: add a forgotten person to this split without recreating it.
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [allFriends, setAllFriends] = useState<Friend[]>([]);
  // Voice claiming.
  const [listening, setListening] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState("");
  // UPI bottom sheet.
  const [payOpen, setPayOpen] = useState(false);

  const cur = session.currency || "INR";
  const meKey = `billsplit:me:${session.slug}`;
  const hostKey = `billsplit:host:${session.slug}`;

  // Restore "who am I" + host token from this device.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(meKey) : null;
    if (saved && initialPeople.some((p) => p.id === saved)) setMeId(saved);
    if (typeof window !== "undefined") setHostToken(localStorage.getItem(hostKey));
  }, [meKey, hostKey, initialPeople]);

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

  // Preload the address book once (host only) so the "forgot someone" search is
  // instant and can reuse a saved friend's photo + identity.
  useEffect(() => {
    if (!hostToken) return;
    let alive = true;
    fetch("/api/friends")
      .then((r) => r.json())
      .then((d) => {
        if (alive && Array.isArray(d.friends)) setAllFriends(d.friends);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hostToken]);

  // ---- Pull fresh state on mount ----
  // Server props can be stale by the time someone re-opens the link, so always
  // re-query the backend right away instead of waiting for the first tap.
  useEffect(() => {
    refetch();
  }, [refetch]);

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
    buzz(existing ? 5 : [8, 30, 8]);
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
    buzz(6);
    await withBusy(item.id, async () => {
      await supabase
        .from("claims")
        .update({ weight: w })
        .eq("item_id", item.id)
        .eq("person_id", meId);
    });
  }

  function chooseMe(id: string) {
    buzz([8, 30, 12]);
    setMeId(id);
    localStorage.setItem(meKey, id);
  }

  // Claim every dish a spoken sentence refers to (only adds, never un-claims).
  async function claimByVoice(transcript: string) {
    if (!meId) return;
    const matched = matchSpokenItems(transcript, items);
    const toAdd = matched.filter((it) => !myClaim(it.id));
    if (toAdd.length === 0) {
      setVoiceMsg(`Heard “${transcript}” — couldn't match a dish. Try naming items on the bill.`);
      return;
    }
    setVoiceBusy(true);
    try {
      await supabase
        .from("claims")
        .insert(toAdd.map((it) => ({ item_id: it.id, person_id: meId, weight: 0 })));
      await refetch();
      buzz([8, 30, 8, 30, 8]);
      setVoiceMsg(`✓ Added: ${toAdd.map((i) => i.name).join(", ")}`);
    } catch {
      setVoiceMsg("Couldn't save those — tap the items manually.");
    } finally {
      setVoiceBusy(false);
    }
  }

  // Start the browser's speech recognition and claim what was heard.
  function startVoice() {
    if (typeof window === "undefined") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setVoiceMsg("Voice input isn't supported in this browser — try Chrome on Android/desktop.");
      return;
    }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setVoiceMsg("");
    setListening(true);
    buzz(10);
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) claimByVoice(transcript);
    };
    rec.onerror = () => {
      setVoiceMsg("Didn't catch that — tap the mic and try again.");
      setListening(false);
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  // Host adds a forgotten person to this split (no recreate needed). If the name
  // matches a saved friend, their photo + identity come along.
  async function addPerson(payload: { name: string; photo_url: string | null; friend_id: string | null }): Promise<boolean> {
    const name = payload.name.trim();
    if (!name || !hostToken) return false;
    setAddErr("");
    // Friendly client-side guard before hitting the server.
    if (people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setAddErr(`"${name}" is already in this split.`);
      return false;
    }
    setAddBusy(true);
    try {
      const res = await fetch("/api/session/person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: session.slug,
          hostToken,
          name,
          photo_url: payload.photo_url,
          friend_id: payload.friend_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddErr(data.error || "Could not add person.");
        return false;
      }
      await refetch();
      return true;
    } catch {
      setAddErr("Network error — try again.");
      return false;
    } finally {
      setAddBusy(false);
    }
  }

  // Text used everywhere we share the link.
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const shareTitle = session.title ? `Split-ez: ${session.title}` : "Split-ez — split the bill";
  const shareText = `${
    session.title ? `Splitting "${session.title}"` : "Let's split the bill"
  } on Split-ez 🍽️\nTap your name and pick what you ate:\n${shareUrl}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  // Native share sheet (mobile) → lets you send straight into a WhatsApp group,
  // Messages, Telegram, etc. Falls back to copying the link on desktop.
  async function shareLink() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
        return;
      } catch {
        /* user cancelled or unsupported — fall through to copy */
      }
    }
    copyLink();
  }

  // Open WhatsApp directly with the message prefilled; WhatsApp then lets you
  // pick the group/contact to send it to.
  function shareWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const myTotal = meId ? result.perPerson.find((p) => p.personId === meId) : null;

  // Repayment: is a payer set, and am I that payer?
  const myName = meId ? peopleById.get(meId)?.name ?? "" : "";
  const payerName = session.payer_name?.trim() || "";
  const payerUpi = session.payer_upi?.trim() || "";
  const iAmPayer = !!payerName && myName.toLowerCase() === payerName.toLowerCase();
  const payNote = session.title ? `Split-ez ${session.title}` : "Split-ez bill";

  // ---- "Who are you?" gate ----
  if (!meId) {
    return (
      <motion.main
        className="flex flex-col gap-6 pt-2"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={rise} className="card">
          <span className="chip chip-off w-fit">👋 Tap to join</span>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
            {session.title || "Split the bill"}
          </h1>
          <p className="mt-1 text-slate-600">Tap your name to start claiming what you ate.</p>
        </motion.div>

        {/* Share card — the host lands here right after creating the split. */}
        <motion.div variants={rise}>
          <ShareCard
            onShare={shareLink}
            onWhatsApp={shareWhatsApp}
            onCopy={copyLink}
            copied={copied}
          />
        </motion.div>

        <motion.div variants={container} className="grid grid-cols-2 gap-3">
          {people.map((p) => (
            <motion.button
              key={p.id}
              variants={rise}
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => chooseMe(p.id)}
              className="flex flex-col items-center gap-2 rounded-3xl border border-white/60 bg-white/90 px-4 py-5 text-lg font-bold shadow-card backdrop-blur transition-colors hover:border-brand hover:text-brand"
            >
              <Avatar name={p.name} photoUrl={p.photo_url} size={64} ring />
              <span>{p.name}</span>
            </motion.button>
          ))}
        </motion.div>

        {hostToken && (
          <motion.div variants={rise}>
            <AddPerson
              friends={allFriends}
              existing={people}
              onAdd={addPerson}
              busy={addBusy}
              error={addErr}
              onClearError={() => addErr && setAddErr("")}
            />
          </motion.div>
        )}

        <motion.p variants={rise} className="text-center text-xs text-slate-400">
          {hostToken
            ? "Forgot someone? Add them above — no need to start over."
            : "Not in the list? Ask whoever started the split to add you."}
        </motion.p>
      </motion.main>
    );
  }

  return (
    <motion.main
      className="flex flex-col gap-5 pt-2"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.header variants={rise} className="flex items-center justify-between gap-3">
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
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={shareLink}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand hover:text-brand"
        >
          <span>{copied ? "✓" : "🔗"}</span>
          {copied ? "Copied!" : "Share"}
        </motion.button>
      </motion.header>

      {/* Claim progress */}
      <motion.div variants={rise} className="card py-3">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-slate-600">
            {allClaimed ? "🎉 All items claimed!" : `${claimedCount} of ${items.length} items claimed`}
          </span>
          <span className="font-bold text-brand tabular">{Math.round(progress * 100)}%</span>
        </div>
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="relative h-full rounded-full bg-gradient-to-r from-brand via-accent to-pop"
            initial={false}
            animate={{ width: `${Math.round(progress * 100)}%` }}
            transition={{ type: "spring", damping: 26, stiffness: 180 }}
          >
            {/* moving glint on the filled part */}
            <span
              aria-hidden
              className="absolute inset-0 animate-shimmer rounded-full"
              style={{
                backgroundImage:
                  "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.5) 50%, transparent 70%)",
                backgroundSize: "200% 100%",
              }}
            />
          </motion.div>
        </div>
      </motion.div>

      {allClaimed && <Confetti />}

      {/* Voice claiming — tap the mic and say what you ate */}
      <motion.div variants={rise} className="card py-4">
        <div className="flex items-center gap-3">
          <span className="relative grid h-12 w-12 shrink-0 place-items-center">
            {listening && (
              <>
                <span className="absolute inset-0 animate-ping-soft rounded-full bg-brand/60" />
                <span
                  className="absolute inset-0 animate-ping-soft rounded-full bg-accent/50"
                  style={{ animationDelay: "0.45s" }}
                />
              </>
            )}
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={startVoice}
              disabled={listening || voiceBusy}
              aria-label="Speak what you ate"
              className="relative grid h-12 w-12 place-items-center rounded-full text-xl text-white shadow-soft"
              style={{ backgroundImage: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}
            >
              🎤
            </motion.button>
          </span>
          <div className="min-w-0">
            <div className="font-bold leading-tight">
              {listening ? "Listening… say what you ate" : "Speak what you ate"}
            </div>
            <div className="text-xs text-slate-500">
              e.g. “I had the paneer tikka and a cold coffee” — it ticks those items for you.
            </div>
          </div>
        </div>
        <AnimatePresence>
          {voiceMsg && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-2 text-sm font-medium text-brand"
            >
              {voiceMsg}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Items */}
      <motion.section variants={container} className="space-y-2">
        {items.map((item) => {
          const its = claimsByItem.get(item.id) ?? [];
          const mine = myClaim(item.id);
          const shares = splitItem(Number(item.price), its);
          const isBusy = busy.has(item.id);

          return (
            <motion.div
              key={item.id}
              variants={rise}
              layout
              transition={springy}
              className={`rounded-2xl border bg-white/90 p-4 shadow-card backdrop-blur transition-colors ${
                mine ? "border-brand ring-2 ring-brand/25" : "border-white/60"
              }`}
            >
              <button
                onClick={() => toggleClaim(item)}
                disabled={isBusy}
                className="flex w-full items-center justify-between gap-3 text-left disabled:opacity-60"
              >
                <div>
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-sm text-slate-500 tabular">
                    {formatMoney(Number(item.price), cur)}
                  </div>
                </div>
                <motion.span
                  initial={false}
                  animate={
                    mine
                      ? { scale: [1, 1.35, 1], backgroundColor: "#6366f1" }
                      : { scale: 1, backgroundColor: "rgba(255,255,255,0)" }
                  }
                  transition={{ duration: 0.35 }}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm ${
                    mine ? "border-brand text-white" : "border-slate-300 text-transparent"
                  }`}
                >
                  ✓
                </motion.span>
              </button>

              {its.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <AnimatePresence initial={false}>
                    {its.map((c) => {
                      const nm = peopleById.get(c.person_id)?.name ?? "?";
                      const isMe = c.person_id === meId;
                      return (
                        <motion.span
                          key={c.id}
                          layout
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={springy}
                          className={`flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs ${
                            isMe ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-600"
                          }`}
                          title={`${nm} pays ${formatMoney(shares.get(c.person_id) ?? 0, cur)}`}
                        >
                          <Avatar name={nm} photoUrl={peopleById.get(c.person_id)?.photo_url} size={18} enlargeable />
                          {nm}
                          {c.weight > 0 ? ` · ${portionLabel(c.weight)}` : ""}
                        </motion.span>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}

              {/* Portion picker — available as soon as you claim a dish, even if
                  you're the first/only person on it. */}
              <AnimatePresence initial={false}>
                {mine && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ type: "spring", damping: 28, stiffness: 300 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
                      <div className="mb-1.5 text-xs font-medium text-slate-500">
                        {its.length > 1 ? "How much did you eat?" : "Ate only part of it? Set your share"}
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

                    <div className="mt-2 text-right text-sm font-semibold text-brand">
                      You pay{" "}
                      <CountUp value={shares.get(meId) ?? 0} format={(n) => formatMoney(n, cur)} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.section>

      {/* Unclaimed warning */}
      <AnimatePresence>
        {result.unclaimedItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
          >
            <b>{result.unclaimedItems.length} item(s)</b> nobody has claimed yet:{" "}
            {result.unclaimedItems.map((i) => i.name).join(", ")}. These aren&apos;t in anyone&apos;s
            total until someone taps them.
          </motion.div>
        )}
      </AnimatePresence>

      {/* Your total */}
      {myTotal && (
        <motion.div
          variants={rise}
          className="relative overflow-hidden rounded-3xl p-5 text-white shadow-glow"
          style={{
            backgroundImage: "linear-gradient(120deg,#6366f1,#8b5cf6,#d946ef,#8b5cf6,#6366f1)",
            backgroundSize: "250% 100%",
            animation: "gradient-x 8s ease infinite",
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm opacity-90">Your total</span>
            <span className="text-3xl font-extrabold">
              <CountUp value={myTotal.total} format={(n) => formatMoney(n, cur)} />
            </span>
          </div>
          <div className="mt-1.5 text-xs opacity-90">
            Items {formatMoney(myTotal.subtotal, cur)} · Tax {formatMoney(myTotal.taxShare, cur)} ·
            Service {formatMoney(myTotal.serviceShare, cur)}
            {Number(session.extras) ? ` · Extras ${formatMoney(myTotal.extrasShare, cur)}` : ""}
            {myTotal.discountShare ? ` · Discount −${formatMoney(myTotal.discountShare, cur)}` : ""}
          </div>
        </motion.div>
      )}

      {/* Repay the person who paid, over UPI */}
      {myTotal && payerName && (
        iAmPayer ? (
          <motion.div
            variants={rise}
            className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800"
          >
            🎉 You paid this bill. Everyone else can repay you
            {payerUpi ? <> at <b>{payerUpi}</b></> : null} — they&apos;ll see a Pay button here.
          </motion.div>
        ) : payerUpi ? (
          <motion.div variants={rise} className="card">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-500">Pay your share to</div>
                <div className="font-bold">{payerName}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">You owe</div>
                <div className="text-xl font-extrabold text-brand tabular">
                  <CountUp value={myTotal.total} format={(n) => formatMoney(n, cur)} />
                </div>
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                buzz(10);
                setPayOpen(true);
              }}
              className="btn-primary mt-3 w-full py-3.5 text-base"
            >
              💸 Pay {formatMoney(myTotal.total, cur)}
            </motion.button>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              UPI app link, scannable QR, or copy-paste — whichever works for you.
            </p>
            <PaySheet
              open={payOpen}
              onClose={() => setPayOpen(false)}
              payerName={payerName}
              payerUpi={payerUpi}
              amount={myTotal.total}
              note={payNote}
            />
          </motion.div>
        ) : null
      )}

      {/* Everyone summary — tap a person to see their exact breakdown */}
      <motion.div variants={rise}>
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowSummary((s) => !s)}
          className="flex w-full items-center justify-between gap-2 rounded-2xl border border-white/60 bg-white/90 px-4 py-3.5 text-left shadow-card backdrop-blur transition hover:border-brand"
        >
          <span className="flex items-center gap-2">
            <span className="icon-tile h-8 w-8 text-base">👥</span>
            <span>
              <span className="block font-bold leading-tight">Everyone&apos;s totals</span>
              <span className="block text-xs text-slate-500">
                See what each person owes · {result.perPerson.length} people
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="font-extrabold text-brand tabular">
              <CountUp value={result.grandTotal} format={(n) => formatMoney(n, cur)} />
            </span>
            <motion.span
              animate={{ rotate: showSummary ? 90 : 0 }}
              transition={springy}
              className="text-slate-400"
            >
              ▸
            </motion.span>
          </span>
        </motion.button>
        <AnimatePresence initial={false}>
          {showSummary && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 240 }}
              className="overflow-hidden"
            >
              <div className="mt-3 overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-card backdrop-blur">
                {result.perPerson.map((p) => {
                  const isOpen = expandedPerson === p.personId;
                  const dishes = detailByPerson.get(p.personId) ?? [];
                  return (
                    <div key={p.personId} className="border-b border-slate-100 last:border-0">
                      <button
                        onClick={() => setExpandedPerson(isOpen ? null : p.personId)}
                        className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm transition-colors ${
                          p.personId === meId ? "bg-brand/5" : "hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          <Avatar name={p.name} photoUrl={peopleById.get(p.personId)?.photo_url} size={28} enlargeable />
                          {p.name}
                          <motion.span
                            animate={{ rotate: isOpen ? 90 : 0 }}
                            transition={springy}
                            className="inline-block text-slate-400"
                          >
                            ▸
                          </motion.span>
                        </span>
                        <span className="font-bold tabular">{formatMoney(p.total, cur)}</span>
                      </button>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ type: "spring", damping: 28, stiffness: 280 }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-1 bg-slate-50/70 px-4 pb-3 pt-1 text-xs text-slate-600">
                              {dishes.length === 0 && (
                                <div className="italic">Hasn&apos;t claimed anything yet.</div>
                              )}
                              {dishes.map((d, idx) => (
                                <div key={idx} className="flex justify-between">
                                  <span>{d.name}</span>
                                  <span className="tabular">{formatMoney(d.amount, cur)}</span>
                                </div>
                              ))}
                              <div className="flex justify-between border-t border-slate-200 pt-1">
                                <span>Items subtotal</span>
                                <span className="tabular">{formatMoney(p.subtotal, cur)}</span>
                              </div>
                              {p.taxShare > 0 && (
                                <div className="flex justify-between">
                                  <span>Tax (by what you ate)</span>
                                  <span className="tabular">{formatMoney(p.taxShare, cur)}</span>
                                </div>
                              )}
                              {p.serviceShare > 0 && (
                                <div className="flex justify-between">
                                  <span>Service (split equally)</span>
                                  <span className="tabular">{formatMoney(p.serviceShare, cur)}</span>
                                </div>
                              )}
                              {p.extrasShare > 0 && (
                                <div className="flex justify-between">
                                  <span>Extras (split equally)</span>
                                  <span className="tabular">{formatMoney(p.extrasShare, cur)}</span>
                                </div>
                              )}
                              {p.discountShare > 0 && (
                                <div className="flex justify-between text-green-600">
                                  <span>Discount</span>
                                  <span className="tabular">−{formatMoney(p.discountShare, cur)}</span>
                                </div>
                              )}
                              <div className="flex justify-between border-t border-slate-200 pt-1 font-bold text-slate-800">
                                <span>Total</span>
                                <span className="tabular">{formatMoney(p.total, cur)}</span>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between bg-slate-50 px-4 py-3 text-sm">
                  <span className="text-slate-500">
                    {result.unclaimedItems.length > 0 ? "Claimed so far" : "Bill total"}
                  </span>
                  <span className="font-bold tabular">{formatMoney(result.grandTotal, cur)}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {hostToken && (
        <motion.div variants={rise}>
          <AddPerson
            friends={allFriends}
            existing={people}
            onAdd={addPerson}
            busy={addBusy}
            error={addErr}
            onClearError={() => addErr && setAddErr("")}
          />
        </motion.div>
      )}

      {session.bill_image_url && (
        <a
          href={session.bill_image_url}
          target="_blank"
          rel="noreferrer"
          className="text-center text-sm text-slate-400 underline transition hover:text-brand"
        >
          View the original bill
        </a>
      )}
    </motion.main>
  );
}

/**
 * Share card shown on the join screen so the host can immediately send the
 * link to a WhatsApp group (or any app) and friends can open & claim.
 */
function ShareCard({
  onShare,
  onWhatsApp,
  onCopy,
  copied,
}: {
  onShare: () => void;
  onWhatsApp: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2">
        <span className="icon-tile h-8 w-8 text-base">📲</span>
        <div>
          <div className="font-bold leading-tight">Send this to your group</div>
          <div className="text-xs text-slate-500">Everyone opens the link & taps what they ate.</div>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <motion.button
          whileTap={{ scale: 0.97 }}
          whileHover={{ y: -2 }}
          onClick={onWhatsApp}
          className="btn w-full py-3 text-white shadow-soft"
          style={{ backgroundColor: "#25D366" }}
        >
          <span className="text-lg">🟢</span> Share on WhatsApp
        </motion.button>
        <div className="flex gap-2">
          <button onClick={onShare} className="btn-ghost flex-1 py-2.5 text-sm">
            More apps…
          </button>
          <button onClick={onCopy} className="btn-ghost flex-1 py-2.5 text-sm">
            {copied ? "✓ Copied" : "Copy link"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Host-only box to add a forgotten person to an existing split. Searches the
 * saved address book locally (instant) so a known friend keeps their photo.
 */
function AddPerson({
  friends,
  existing,
  onAdd,
  busy,
  error,
  onClearError,
}: {
  friends: Friend[];
  existing: Person[];
  onAdd: (p: { name: string; photo_url: string | null; friend_id: string | null }) => Promise<boolean>;
  busy: boolean;
  error: string;
  onClearError: () => void;
}) {
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<Friend | null>(null);
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = value.trim().toLowerCase();
  const already = new Set(existing.map((p) => p.name.toLowerCase()));
  const suggestions = q
    ? friends
        .filter((f) => f.name.toLowerCase().includes(q) && !already.has(f.name.toLowerCase()))
        .slice(0, 6)
    : [];

  async function submit() {
    const name = value.trim();
    if (!name) return;
    // Use the picked friend only if the name still matches it.
    const match =
      picked && picked.name.toLowerCase() === name.toLowerCase() ? picked : null;
    const ok = await onAdd({
      name,
      photo_url: match?.photo_url ?? null,
      friend_id: match?.id ?? null,
    });
    if (ok) {
      setValue("");
      setPicked(null);
      setOpen(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2">
        <span className="icon-tile h-8 w-8 text-base">＋</span>
        <div>
          <div className="font-bold leading-tight">Forgot someone?</div>
          <div className="text-xs text-slate-500">
            Add a person to this split — saved friends pop up with their photo.
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setPicked(null);
              setOpen(true);
              onClearError();
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setOpen(false), 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Name"
            className="input w-full py-2.5 text-sm"
          />
          {open && suggestions.length > 0 && (
            <div
              className="absolute z-10 mt-1 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"
              onMouseDown={() => blurTimer.current && clearTimeout(blurTimer.current)}
            >
              {suggestions.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setValue(f.name);
                    setPicked(f);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-brand/5"
                >
                  <Avatar name={f.name} photoUrl={f.photo_url} size={28} />
                  <span className="font-medium">{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={submit}
          disabled={busy || !value.trim()}
          className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Lightweight CSS confetti — a short, one-shot celebration that fires when
 * every item has been claimed. No external deps.
 */
function Confetti() {
  const colors = ["#6366f1", "#8b5cf6", "#d946ef", "#f59e0b", "#10b981", "#ef4444", "#06b6d4"];
  const pieces = Array.from({ length: 60 });
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-10vh) translateX(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) translateX(var(--drift, 0px)) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {pieces.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.8;
        const dur = 1.6 + Math.random() * 1.6;
        const size = 6 + Math.random() * 9;
        const color = colors[i % colors.length];
        const round = i % 3 === 0;
        const drift = (Math.random() - 0.5) * 160;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${left}%`,
              top: 0,
              width: size,
              height: round ? size : size * 0.5,
              background: color,
              borderRadius: round ? "50%" : 2,
              ["--drift" as any]: `${drift}px`,
              animation: `confetti-fall ${dur}s ${delay}s cubic-bezier(0.25,0.46,0.45,0.94) forwards`,
            }}
          />
        );
      })}
    </div>
  );
}
