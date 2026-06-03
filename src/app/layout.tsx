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
        <div className="mx-auto min-h-screen max-w-xl px-4 pb-24 pt-6">
          <header className="mb-6 flex items-center justify-between gap-2.5">
            <a href="/" className="group flex items-center gap-2.5">
              <span className="icon-tile h-9 w-9 text-lg transition-transform group-hover:scale-110 group-hover:rotate-6">
                🍽️
              </span>
              <span className="text-xl font-extrabold tracking-tight">
                <span className="gradient-text">Split</span>
                <span className="text-slate-900">-ez</span>
              </span>
            </a>
            <a
              href="/new"
              className="rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-sm font-semibold text-brand backdrop-blur transition hover:bg-white"
            >
              + New split
            </a>
          </header>
          {children}
        </div>
        <AvatarLightbox />
      </body>
    </html>
  );
}
