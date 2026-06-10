"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const STEPS = [
  {
    n: "1",
    icon: "📸",
    t: "Snap the bill",
    d: "Upload a photo — it reads items, prices, tax and service charge automatically.",
  },
  {
    n: "2",
    icon: "👥",
    t: "Add names & share",
    d: "Check the items, add everyone's names, set any discount, and get a share link.",
  },
  {
    n: "3",
    icon: "✅",
    t: "Everyone taps in",
    d: "Drop the link in the group. Each person taps what they ate; totals update live.",
  },
];

// Little food emojis that drift behind the hero — pure decoration.
const FLOATERS = [
  { e: "🍕", x: "6%", y: "8%", delay: 0, dur: 7 },
  { e: "🥤", x: "86%", y: "4%", delay: 1.2, dur: 8 },
  { e: "🍜", x: "78%", y: "70%", delay: 0.5, dur: 9 },
  { e: "🍰", x: "4%", y: "72%", delay: 2, dur: 7.5 },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const rise = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", damping: 22, stiffness: 220 } as const,
  },
};

export default function Home() {
  return (
    <motion.main
      className="flex flex-col gap-7 pt-4"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Hero */}
      <motion.section variants={rise} className="card card-lift relative overflow-hidden">
        {/* Drifting emoji garnish */}
        {FLOATERS.map((f) => (
          <motion.span
            key={f.e}
            aria-hidden
            className="pointer-events-none absolute select-none text-2xl opacity-25"
            style={{ left: f.x, top: f.y }}
            animate={{ y: [0, -12, 0], rotate: [-6, 6, -6] }}
            transition={{ duration: f.dur, delay: f.delay, repeat: Infinity, ease: "easeInOut" }}
          >
            {f.e}
          </motion.span>
        ))}

        <div className="relative flex flex-col gap-3">
          <motion.span variants={rise} className="chip chip-off w-fit">
            ⚡ No sign-up · just a link
          </motion.span>
          <motion.h1
            variants={rise}
            className="text-[2.6rem] font-extrabold leading-[1.08] tracking-tight"
          >
            Split the bill,
            <br />
            <span className="gradient-text-animated">fairly</span>.
          </motion.h1>
          <motion.p variants={rise} className="text-slate-600">
            Snap the bill, share a link, and everyone taps what they ate. Tax splits by what you
            ordered; service charge and discounts split fairly. No more group-chat math.
          </motion.p>
          <motion.div variants={rise}>
            <Link href="/new" className="btn-primary group mt-2 w-full py-4 text-lg">
              Start a new split
              <span className="transition-transform duration-200 group-hover:translate-x-1.5">
                →
              </span>
            </Link>
          </motion.div>
        </div>
      </motion.section>

      {/* How it works — connected timeline */}
      <motion.section variants={container} className="relative grid gap-3">
        {/* the connecting rail */}
        <div
          aria-hidden
          className="absolute bottom-10 left-[2.6rem] top-10 w-px bg-gradient-to-b from-brand/40 via-accent/40 to-pop/30"
        />
        {STEPS.map((s) => (
          <motion.div
            key={s.n}
            variants={rise}
            whileHover={{ y: -3, transition: { duration: 0.18 } }}
            className="card relative flex items-start gap-4 py-4"
          >
            <span className="icon-tile relative h-11 w-11 shrink-0 text-xl">
              {s.icon}
              <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-white text-[10px] font-extrabold text-brand shadow">
                {s.n}
              </span>
            </span>
            <div>
              <p className="font-bold text-slate-900">{s.t}</p>
              <p className="mt-0.5 text-sm text-slate-600">{s.d}</p>
            </div>
          </motion.div>
        ))}
      </motion.section>

      {/* Why it's fair — quick badges */}
      <motion.section variants={rise} className="flex flex-wrap justify-center gap-2">
        {["🧾 Paisa-perfect rounding", "⚖️ Tax by what you ate", "💸 One-tap UPI repay", "🎙️ Voice claiming"].map(
          (b) => (
            <span key={b} className="chip chip-off cursor-default text-xs">
              {b}
            </span>
          )
        )}
      </motion.section>

      <motion.div variants={rise}>
        <Link
          href="/admin"
          className="mx-auto block text-center text-xs font-medium text-slate-400 transition hover:text-brand"
        >
          Admin control room →
        </Link>
      </motion.div>
    </motion.main>
  );
}
