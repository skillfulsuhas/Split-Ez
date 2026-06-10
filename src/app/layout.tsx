import type { Metadata, Viewport } from "next";
import "./globals.css";
import AvatarLightbox from "@/components/AvatarLightbox";

export const metadata: Metadata = {
  title: "Split-ez — split the bill, fairly",
  description: "Snap a bill, everyone taps what they ate, get exact totals with tax, service & discounts split fairly.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Animated gradient mesh backdrop (sits behind all content). */}
        <div className="mesh-bg" aria-hidden="true">
          <div className="mesh-blob b1" />
          <div className="mesh-blob b2" />
          <div className="mesh-blob b3" />
        </div>
        <div className="mx-auto min-h-screen max-w-xl px-4 pb-24 pt-4">
          <header className="sticky top-3 z-50 mb-6">
            <div className="glass flex items-center justify-between gap-2.5 rounded-full px-3 py-2 shadow-card">
              <a href="/" className="group flex items-center gap-2.5">
                <span className="icon-tile h-9 w-9 rounded-full text-lg transition-transform duration-300 group-hover:rotate-[14deg] group-hover:scale-110">
                  🍽️
                </span>
                <span className="text-xl font-extrabold tracking-tight">
                  <span className="gradient-text">Split</span>
                  <span className="text-slate-900">-ez</span>
                </span>
              </a>
              <a
                href="/new"
                className="rounded-full border border-white/70 bg-white/70 px-3.5 py-1.5 text-sm font-bold text-brand backdrop-blur transition hover:-translate-y-0.5 hover:bg-white hover:shadow-soft"
              >
                + New split
              </a>
            </div>
          </header>
          {children}
        </div>
        <AvatarLightbox />
      </body>
    </html>
  );
}
