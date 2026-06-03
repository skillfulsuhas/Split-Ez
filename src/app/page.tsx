import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-col gap-7 pt-4">
      <section className="card card-lift animate-rise-in overflow-hidden">
        <div className="flex flex-col gap-3">
          <span className="chip chip-off w-fit">⚡ No sign-up · just a link</span>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
            Split the bill, <span className="gradient-text">fairly</span>.
          </h1>
          <p className="text-slate-600">
            Snap the bill, share a link, and everyone taps what they ate. Tax splits by what
            you ordered; service charge and discounts split fairly. No more group-chat math.
          </p>
          <Link href="/new" className="btn-primary mt-2 w-full py-4 text-lg">
            Start a new split →
          </Link>
        </div>
      </section>

      <section className="grid gap-3">
        {[
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
        ].map((s) => (
          <div
            key={s.n}
            className="card card-lift flex items-start gap-4 py-4 animate-rise-in"
            style={{ animationDelay: `${Number(s.n) * 90}ms` }}
          >
            <span className="icon-tile h-11 w-11 shrink-0 text-xl">{s.icon}</span>
            <div>
              <p className="font-bold text-slate-900">{s.t}</p>
              <p className="mt-0.5 text-sm text-slate-600">{s.d}</p>
            </div>
          </div>
        ))}
      </section>

      <Link
        href="/admin"
        className="mx-auto text-center text-xs font-medium text-slate-400 transition hover:text-brand"
      >
        Admin control room →
      </Link>
    </main>
  );
}
