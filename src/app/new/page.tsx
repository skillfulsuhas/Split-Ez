"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { formatMoney } from "@/lib/compute";
import Avatar from "@/components/Avatar";
import CountUp from "@/components/CountUp";
import type { Friend } from "@/lib/types";

interface DraftItem {
  name: string;
  price: string; // keep as string for smooth editing
}

interface DraftPerson {
  name: string;
  photo_url: string | null;
  friend_id: string | null;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale + recompress the photo in the browser before upload.
 * Phone photos are 3-5 MB; hosting (Vercel) rejects request bodies over
 * ~4.5 MB, and large images are slow to send. We cap the longest edge at
 * 1800px and export JPEG ~0.85 — small, fast, and still sharp enough for OCR.
 * Falls back to the raw file if the canvas path fails.
 */
async function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
  try {
    const dataUrl = await readAsDataUrl(file);
    const img = document.createElement("img");
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = dataUrl;
    });

    const MAX = 1800;
    let { width, height } = img;
    if (Math.max(width, height) > MAX) {
      const scale = MAX / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(img, 0, 0, width, height);

    const out = canvas.toDataURL("image/jpeg", 0.85);
    const base64 = out.split(",")[1] ?? "";
    if (!base64) throw new Error("empty canvas output");
    return { base64, mimeType: "image/jpeg" };
  } catch {
    const dataUrl = await readAsDataUrl(file);
    return { base64: dataUrl.split(",")[1] ?? "", mimeType: file.type || "image/jpeg" };
  }
}

// Shared stagger/spring variants for the page sections.
const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const rise = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", damping: 24, stiffness: 240 } as const,
  },
};

export default function NewSplit() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [items, setItems] = useState<DraftItem[]>([{ name: "", price: "" }]);
  const [tax, setTax] = useState("");
  const [service, setService] = useState("");
  const [extras, setExtras] = useState("");
  const [people, setPeople] = useState<DraftPerson[]>([
    { name: "", photo_url: null, friend_id: null },
    { name: "", photo_url: null, friend_id: null },
  ]);

  // Load the whole address book once, then filter it locally as the host types —
  // instant suggestions instead of a network round-trip on every keystroke.
  const [allFriends, setAllFriends] = useState<Friend[]>([]);
  useEffect(() => {
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
  }, []);

  // Discount: optional. Either a percentage of the whole bill, or a flat amount.
  const [hasDiscount, setHasDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("");

  // Extra / platform discount (e.g. a Swiggy/Zomato coupon on top of the
  // restaurant offer). Also percentage or flat amount.
  const [hasExtraDiscount, setHasExtraDiscount] = useState(false);
  const [extraDiscountType, setExtraDiscountType] = useState<"percent" | "amount">("amount");
  const [extraDiscountValue, setExtraDiscountValue] = useState("");

  // Who fronted the bill + how everyone repays them (UPI ID or phone number).
  const [payerName, setPayerName] = useState("");
  const [payerUpi, setPayerUpi] = useState("");

  const [image, setImage] = useState<{ base64: string; mimeType: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState("");
  const [scanned, setScanned] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const num = (s: string) => (s.trim() === "" ? 0 : Number(s) || 0);
  const itemsTotal = items.reduce((a, b) => a + num(b.price), 0);
  const grossTotal = itemsTotal + num(tax) + num(service) + num(extras);

  // Resolve the restaurant discount to a rupee amount off the whole bill.
  const discountAmount = !hasDiscount
    ? 0
    : discountType === "percent"
    ? Math.max(0, (grossTotal * num(discountValue)) / 100)
    : Math.max(0, num(discountValue));

  // Extra/platform discount applies after the first discount.
  const afterFirst = Math.max(0, grossTotal - discountAmount);
  const extraDiscountAmount = !hasExtraDiscount
    ? 0
    : extraDiscountType === "percent"
    ? Math.max(0, (afterFirst * num(extraDiscountValue)) / 100)
    : Math.max(0, num(extraDiscountValue));

  // Total discount sent to the backend (a single rupee amount, split proportionally).
  const totalDiscount = Math.min(grossTotal, discountAmount + extraDiscountAmount);
  const billTotal = Math.max(0, grossTotal - totalDiscount);

  const imagePreview = image ? `data:${image.mimeType};base64,${image.base64}` : null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setDetail("");
    setScanned(false);
    setScanning(true);
    try {
      const img = await compressImage(file);
      setImage(img);
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: img.base64, mimeType: img.mimeType }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't read the bill — enter it manually below.");
        if (data.detail) setDetail(data.detail);
        return;
      }
      if (data.title) setTitle(data.title);
      if (Array.isArray(data.items) && data.items.length) {
        // Expand quantities: "Spaghetti x2 @ 530" -> two separate ₹530 lines,
        // so each plate can be claimed by whoever actually ate it.
        const expanded: DraftItem[] = [];
        for (const i of data.items) {
          const qty = Math.max(1, Math.round(Number(i.qty) || 1));
          const unit = Number(i.unit_price) || 0;
          for (let k = 0; k < qty; k++) {
            expanded.push({
              name: qty > 1 ? `${i.name} (${k + 1}/${qty})` : i.name,
              price: unit ? String(unit) : "",
            });
          }
        }
        setItems(expanded);
      }
      setTax(data.tax ? String(data.tax) : "");
      setService(data.service_charge ? String(data.service_charge) : "");
      setExtras(data.extras ? String(data.extras) : "");
      setScanned(true);
      if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
    } catch (err: any) {
      setError("Network error while scanning — check your connection and try again, or enter the bill manually.");
      setDetail(err?.message || String(err));
    } finally {
      setScanning(false);
    }
  }

  function updateItem(i: number, field: keyof DraftItem, value: string) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }
  const addItem = () => setItems((p) => [...p, { name: "", price: "" }]);
  const removeItem = (i: number) => setItems((p) => p.filter((_, idx) => idx !== i));

  function patchPerson(i: number, patch: Partial<DraftPerson>) {
    setPeople((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  const addPerson = () =>
    setPeople((p) => [...p, { name: "", photo_url: null, friend_id: null }]);
  const removePerson = (i: number) => setPeople((p) => p.filter((_, idx) => idx !== i));

  async function create() {
    setError("");
    const cleanItems = items
      .filter((i) => i.name.trim())
      .map((i) => ({ name: i.name.trim(), price: num(i.price) }));
    const cleanPeople = people
      .filter((p) => p.name.trim())
      .map((p) => ({ name: p.name.trim(), photo_url: p.photo_url, friend_id: p.friend_id }));

    if (cleanItems.length === 0) return setError("Add at least one item.");
    if (cleanPeople.length === 0) return setError("Add at least one person.");

    // Block duplicate names, ignoring case ("Suhas" and "suhas" are the same person).
    const seen = new Set<string>();
    for (const p of cleanPeople) {
      const key = p.name.toLowerCase();
      if (seen.has(key)) {
        return setError(`"${p.name}" is already in the list — each person can only be added once.`);
      }
      seen.add(key);
    }

    setCreating(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          currency: "INR",
          tax: num(tax),
          service_charge: num(service),
          extras: num(extras),
          discount: Math.round(totalDiscount * 100) / 100,
          payer_name: payerName.trim() || null,
          payer_upi: payerUpi.trim() || null,
          items: cleanItems,
          people: cleanPeople,
          imageBase64: image?.base64,
          mimeType: image?.mimeType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create.");
      // Remember host token so this device keeps edit rights.
      localStorage.setItem(`billsplit:host:${data.slug}`, data.hostToken);
      router.push(`/s/${data.slug}`);
    } catch (err: any) {
      setError(err.message);
      setCreating(false);
    }
  }

  return (
    <motion.main
      className="flex flex-col gap-5 pb-28"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.h1 variants={rise} className="text-3xl font-extrabold tracking-tight">
        New <span className="gradient-text-animated">split</span>
      </motion.h1>

      {/* Upload — big tappable dropzone with a scanning beam while OCR runs */}
      <motion.section variants={rise} className="card">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          disabled={scanning}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={scanning}
          className={`group relative block w-full overflow-hidden rounded-2xl border-2 border-dashed text-left transition
            ${scanning ? "border-brand/60" : "border-brand/30 hover:border-brand/70"}
            bg-gradient-to-br from-brand/5 via-accent/5 to-pop/5`}
        >
          {imagePreview ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreview}
                alt="Bill"
                className={`max-h-56 w-full object-cover transition ${scanning ? "opacity-80 saturate-50" : ""}`}
              />
              {scanning && (
                <span
                  aria-hidden
                  className="absolute left-0 h-10 w-full animate-scanline bg-gradient-to-b from-transparent via-brand/50 to-transparent"
                />
              )}
              {!scanning && (
                <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-brand shadow backdrop-blur">
                  ↺ Re-scan / change photo
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <motion.span
                className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-3xl shadow-soft"
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              >
                📸
              </motion.span>
              <span className="font-bold text-slate-800">Snap or upload the bill</span>
              <span className="text-xs text-slate-500">
                Items, tax & service charge fill themselves in. Magic.
              </span>
            </div>
          )}
        </button>

        <AnimatePresence mode="wait">
          {scanning && (
            <motion.p
              key="scanning"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 flex items-center gap-2 text-sm font-semibold text-brand"
            >
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              Reading the bill…
            </motion.p>
          )}
          {scanned && !scanning && (
            <motion.p
              key="scanned"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="mt-3 text-sm font-semibold text-green-600"
            >
              ✓ Read the bill — check the items below and fix anything that looks off.
            </motion.p>
          )}
        </AnimatePresence>
      </motion.section>

      {/* Title */}
      <motion.input
        variants={rise}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Place / occasion (optional)"
        className="input"
      />

      {/* Items */}
      <motion.section variants={rise} className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold">
            <span className="icon-tile h-7 w-7 text-sm">🧾</span> Items
          </h2>
          <span className="text-sm font-bold text-slate-500">
            <CountUp value={itemsTotal} format={(n) => formatMoney(n)} />
          </span>
        </div>
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {items.map((it, i) => (
              <motion.div
                key={i}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: "spring", damping: 26, stiffness: 320 }}
                className="flex gap-2 overflow-visible"
              >
                <input
                  value={it.name}
                  onChange={(e) => updateItem(i, "name", e.target.value)}
                  placeholder="Item"
                  className="input flex-1 py-2.5 text-sm"
                />
                <input
                  value={it.price}
                  onChange={(e) => updateItem(i, "price", e.target.value)}
                  placeholder="₹"
                  inputMode="decimal"
                  className="input w-24 py-2.5 text-sm"
                />
                <button
                  onClick={() => removeItem(i)}
                  className="rounded-xl px-2 text-slate-400 transition hover:scale-110 hover:text-red-500 active:scale-90"
                  aria-label="Remove item"
                >
                  ✕
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <button
          onClick={addItem}
          className="mt-3 text-sm font-bold text-brand transition hover:translate-x-0.5 hover:text-brand-dark"
        >
          + Add item
        </button>
      </motion.section>

      {/* Charges */}
      <motion.section variants={rise} className="card grid grid-cols-3 gap-3">
        <Field label="Tax (proportional)" value={tax} onChange={setTax} />
        <Field label="Service (equal)" value={service} onChange={setService} />
        <Field label="Extras (equal)" value={extras} onChange={setExtras} />
      </motion.section>

      {/* Discount */}
      <motion.section variants={rise} className="card">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold">
            <span className="icon-tile h-7 w-7 text-sm">🏷️</span> Discount / offer
          </h2>
          <button
            onClick={() => setHasDiscount((v) => !v)}
            className={`chip ${hasDiscount ? "chip-on" : "chip-off"}`}
          >
            {hasDiscount ? "On" : "Off"}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Got 10% off, or a flat amount off the bill? Add it here — it&apos;s shared across
          everyone proportionally.
        </p>

        <AnimatePresence initial={false}>
          {hasDiscount && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: "spring", damping: 26, stiffness: 280 }}
              className="overflow-hidden"
            >
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex gap-2">
                  <button
                    onClick={() => setDiscountType("percent")}
                    className={`chip flex-1 justify-center ${
                      discountType === "percent" ? "chip-on" : "chip-off"
                    }`}
                  >
                    Percentage %
                  </button>
                  <button
                    onClick={() => setDiscountType("amount")}
                    className={`chip flex-1 justify-center ${
                      discountType === "amount" ? "chip-on" : "chip-off"
                    }`}
                  >
                    Amount ₹
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === "percent" ? "e.g. 10" : "e.g. 150"}
                    inputMode="decimal"
                    className="input flex-1"
                  />
                  <span className="text-lg font-semibold text-slate-500">
                    {discountType === "percent" ? "%" : "₹"}
                  </span>
                </div>
                {discountAmount > 0 && (
                  <p className="text-sm font-semibold text-green-600">
                    −{formatMoney(discountAmount)} off the bill
                  </p>
                )}

                {/* Extra / platform discount (coupon on top of the restaurant offer) */}
                {!hasExtraDiscount ? (
                  <button
                    onClick={() => setHasExtraDiscount(true)}
                    className="self-start text-sm font-bold text-brand hover:text-brand-dark"
                  >
                    + Add extra / platform discount
                  </button>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-600">
                        Extra / platform discount
                      </span>
                      <button
                        onClick={() => {
                          setHasExtraDiscount(false);
                          setExtraDiscountValue("");
                        }}
                        className="text-xs font-semibold text-slate-400 hover:text-red-500"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setExtraDiscountType("percent")}
                        className={`chip flex-1 justify-center ${
                          extraDiscountType === "percent" ? "chip-on" : "chip-off"
                        }`}
                      >
                        Percentage %
                      </button>
                      <button
                        onClick={() => setExtraDiscountType("amount")}
                        className={`chip flex-1 justify-center ${
                          extraDiscountType === "amount" ? "chip-on" : "chip-off"
                        }`}
                      >
                        Amount ₹
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={extraDiscountValue}
                        onChange={(e) => setExtraDiscountValue(e.target.value)}
                        placeholder={extraDiscountType === "percent" ? "e.g. 5" : "e.g. 75"}
                        inputMode="decimal"
                        className="input flex-1"
                      />
                      <span className="text-lg font-semibold text-slate-500">
                        {extraDiscountType === "percent" ? "%" : "₹"}
                      </span>
                    </div>
                    {extraDiscountAmount > 0 && (
                      <p className="text-sm font-semibold text-green-600">
                        −{formatMoney(extraDiscountAmount)} extra off
                      </p>
                    )}
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* People */}
      <motion.section variants={rise} className="card">
        <h2 className="flex items-center gap-2 font-bold">
          <span className="icon-tile h-7 w-7 text-sm">👥</span> Who&apos;s splitting?
        </h2>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          Start typing a name — saved friends pop up with their photo. Tap the circle to add a
          new photo.
        </p>
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {people.map((p, i) => (
              <motion.div
                key={i}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ type: "spring", damping: 26, stiffness: 320 }}
              >
                <PersonRow
                  index={i}
                  person={p}
                  friends={allFriends}
                  canRemove={people.length > 1}
                  onPatch={(patch) => patchPerson(i, patch)}
                  onRemove={() => removePerson(i)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <button
          onClick={addPerson}
          className="mt-3 text-sm font-bold text-brand transition hover:translate-x-0.5 hover:text-brand-dark"
        >
          + Add person
        </button>
      </motion.section>

      {/* Who paid? — enables one-tap UPI repayment at the end */}
      <motion.section variants={rise} className="card">
        <h2 className="flex items-center gap-2 font-bold">
          <span className="icon-tile h-7 w-7 text-sm">💳</span> Who paid the bill?
        </h2>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          Optional — add the payer&apos;s name and UPI so everyone can repay them in one tap when
          the split is done.
        </p>
        <div className="flex flex-col gap-2">
          <input
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            placeholder="Payer's name (e.g. Suhas)"
            className="input py-2.5 text-sm"
          />
          <input
            value={payerUpi}
            onChange={(e) => setPayerUpi(e.target.value)}
            placeholder="UPI ID (name@bank) or phone number"
            inputMode="text"
            className="input py-2.5 text-sm"
          />
          <p className="text-[11px] text-slate-400">
            A UPI ID like <span className="font-medium">suhas@okhdfc</span> works most reliably. A
            phone number works if it&apos;s registered for UPI.
          </p>
        </div>
      </motion.section>

      {error && (
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <p>{error}</p>
          {detail && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-red-500">Technical details</summary>
              <p className="mt-1 break-words text-xs text-red-500">{detail}</p>
            </details>
          )}
        </motion.div>
      )}

      {/* Docked total + create bar — always within thumb's reach */}
      <motion.div
        variants={rise}
        className="glass fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-xl items-center gap-3 rounded-t-3xl border-b-0 px-4 py-3 shadow-float"
      >
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Bill total
          </div>
          <div className="text-2xl font-extrabold leading-tight text-slate-900">
            <CountUp value={billTotal} format={(n) => formatMoney(n)} />
          </div>
          {totalDiscount > 0 && (
            <div className="text-[11px] font-semibold text-green-600">
              <span className="text-slate-400 line-through">{formatMoney(grossTotal)}</span>{" "}
              −{formatMoney(totalDiscount)} saved
            </div>
          )}
        </div>
        <button
          onClick={create}
          disabled={creating}
          className="btn-primary ml-auto shrink-0 px-6 py-3.5 text-base"
        >
          {creating ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Creating…
            </>
          ) : (
            <>Create & share →</>
          )}
        </button>
      </motion.div>
    </motion.main>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold leading-tight text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        inputMode="decimal"
        className="input px-2.5 py-2 text-sm"
      />
    </label>
  );
}

function PersonRow({
  index,
  person,
  friends,
  canRemove,
  onPatch,
  onRemove,
}: {
  index: number;
  person: DraftPerson;
  friends: Friend[];
  canRemove: boolean;
  onPatch: (patch: Partial<DraftPerson>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter the preloaded address book locally — instant, no network per keystroke.
  const q = person.name.trim().toLowerCase();
  const suggestions = q
    ? friends.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 8)
    : [];

  function pick(f: Friend) {
    onPatch({ name: f.name, photo_url: f.photo_url, friend_id: f.id });
    setOpen(false);
  }

  async function uploadPhoto(file: File) {
    const name = person.name.trim();
    if (!name) {
      alert("Type the person's name first, then add their photo.");
      return;
    }
    setUploading(true);
    try {
      const { base64, mimeType } = await compressImage(file);
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, imageBase64: base64, mimeType }),
      });
      const data = await res.json();
      if (res.ok) onPatch({ photo_url: data.photo_url, friend_id: data.id });
    } finally {
      setUploading(false);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div className="relative flex items-center gap-2">
      {/* Avatar = tap to add/replace photo */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="relative shrink-0 rounded-full transition hover:scale-105 active:scale-95"
        title="Add a photo"
      >
        <Avatar name={person.name || "?"} photoUrl={person.photo_url} size={40} ring />
        <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-white text-[10px] shadow">
          {uploading ? "…" : "＋"}
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadPhoto(f);
        }}
      />

      <div className="relative flex-1">
        <input
          value={person.name}
          onChange={(e) => onPatch({ name: e.target.value, friend_id: null })}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          placeholder={`Person ${index + 1}`}
          className="input w-full py-2.5 text-sm"
        />
        {showList && (
          <div
            className="absolute z-10 mt-1 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"
            onMouseDown={() => blurTimer.current && clearTimeout(blurTimer.current)}
          >
            {suggestions.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => pick(f)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-brand/5"
              >
                <Avatar name={f.name} photoUrl={f.photo_url} size={28} />
                <span className="font-medium">{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {canRemove && (
        <button
          onClick={onRemove}
          className="rounded-xl px-2 text-slate-400 transition hover:scale-110 hover:text-red-500 active:scale-90"
          aria-label="Remove person"
        >
          ✕
        </button>
      )}
    </div>
  );
}
