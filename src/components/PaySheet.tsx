"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import { formatMoney } from "@/lib/compute";

/**
 * Bottom-sheet payment flow.
 *
 * Why this exists: GPay/PhonePe/Paytm restrict payments that are *initiated
 * from a web page* (`upi://pay` intent links) to personal, non-merchant UPI
 * IDs — the app opens, but the payment is declined or silently blocked "for
 * security reasons". There's no way around that from a website, so instead of
 * one link that sometimes fails we give every reliable path:
 *
 *  1. The intent link (works on some app/version combos) — kept as a shortcut.
 *  2. A *amount-free* intent link — far more often allowed, user types amount.
 *  3. A standard UPI QR — scan from another phone, or save & use the app's
 *     own "scan from gallery"; QR payments aren't web-initiated so they work.
 *  4. One-tap copy of the UPI ID and the exact amount for a manual transfer.
 */

// Strip characters UPI apps choke on; keep notes short and alphanumeric.
function cleanNote(s: string): string {
  return s.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
}

function upiLink(upi: string, payee: string, amount?: number, note?: string): string {
  const params = new URLSearchParams({ pa: upi.trim(), pn: cleanNote(payee) || "Payee", cu: "INR" });
  if (amount && amount > 0) params.set("am", amount.toFixed(2));
  if (note) params.set("tn", cleanNote(note) || "Bill split");
  return `upi://pay?${params.toString()}`;
}

export default function PaySheet({
  open,
  onClose,
  payerName,
  payerUpi,
  amount,
  note,
}: {
  open: boolean;
  onClose: () => void;
  payerName: string;
  payerUpi: string;
  amount: number;
  note: string;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"" | "upi" | "amount">("");

  const fullLink = upiLink(payerUpi, payerName, amount, note);
  const bareLink = upiLink(payerUpi, payerName);

  // Standard UPI QR payload is the same upi://pay string — every UPI app
  // can scan it, amount prefilled.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    QRCode.toDataURL(fullLink, {
      width: 560,
      margin: 1,
      color: { dark: "#1e1b4b", light: "#ffffff" },
    })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [open, fullLink]);

  // Lock background scroll while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function copy(text: string, kind: "upi" | "amount") {
    navigator.clipboard?.writeText(text).catch(() => {});
    if (navigator.vibrate) navigator.vibrate(10);
    setCopied(kind);
    setTimeout(() => setCopied(""), 1400);
  }

  function downloadQr() {
    if (!qr) return;
    const a = document.createElement("a");
    a.href = qr;
    a.download = `pay-${cleanNote(payerName) || "upi"}.png`;
    a.click();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="sheet max-h-[88vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="sheet-handle" />

            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Pay your share to
                </div>
                <div className="text-xl font-extrabold">{payerName}</div>
                <div className="mt-0.5 break-all text-xs font-medium text-slate-500">{payerUpi}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">You owe</div>
                <div className="text-2xl font-extrabold text-brand tabular">
                  {formatMoney(amount)}
                </div>
              </div>
            </div>

            {/* Path 1 — intent link (quickest when it works) */}
            <a href={fullLink} className="btn-primary mt-4 w-full py-3.5 text-base">
              💸 Open UPI app & pay {formatMoney(amount)}
            </a>
            <p className="mt-1.5 text-center text-[11px] text-slate-400">
              Opens GPay / PhonePe / Paytm with everything prefilled.
            </p>

            {/* Path 2 & 3 — the reliable fallbacks */}
            <div className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50/80 p-3.5">
              <div className="text-sm font-bold text-amber-900">
                App opened but payment failed or got blocked?
              </div>
              <p className="mt-1 text-xs leading-relaxed text-amber-800/90">
                UPI apps often block payments started from a website link to personal UPI IDs
                (a security rule — not a bug in this split). These always work instead:
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => copy(payerUpi, "upi")}
                  className="btn-ghost py-2.5 text-xs font-bold"
                >
                  {copied === "upi" ? "✓ Copied!" : "📋 Copy UPI ID"}
                </button>
                <button
                  onClick={() => copy(amount.toFixed(2), "amount")}
                  className="btn-ghost py-2.5 text-xs font-bold"
                >
                  {copied === "amount" ? "✓ Copied!" : `📋 Copy ${formatMoney(amount)}`}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-amber-800/80">
                Then open your UPI app yourself → “Pay to UPI ID” → paste → pay. Payments you
                start inside the app are never blocked.
              </p>

              <a
                href={bareLink}
                className="mt-2 block text-center text-xs font-bold text-amber-900 underline underline-offset-2"
              >
                Or try opening the app without a prefilled amount →
              </a>
            </div>

            {/* Path 4 — QR (scan from another phone, or gallery-scan) */}
            {qr && (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt={`UPI QR to pay ${payerName}`} className="h-44 w-44 rounded-lg" />
                <div className="text-center text-xs font-medium text-slate-500">
                  Scan with any UPI app — amount prefilled.
                </div>
                <button onClick={downloadQr} className="text-xs font-bold text-brand">
                  ⬇️ Save QR (then “scan from gallery” in GPay/PhonePe)
                </button>
              </div>
            )}

            <button onClick={onClose} className="btn-ghost mt-4 w-full py-3 text-sm">
              Done
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
