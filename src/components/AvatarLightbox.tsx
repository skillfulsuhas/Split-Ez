"use client";

import { useEffect, useState } from "react";

// Detail dispatched by Avatar when an enlargeable avatar is tapped.
export interface AvatarEnlargeDetail {
  name: string;
  photoUrl?: string | null;
  gradient?: string; // tailwind "from-x to-y" for the fallback circle
  initials?: string;
}

export const AVATAR_ENLARGE_EVENT = "avatar:enlarge";

export function enlargeAvatar(detail: AvatarEnlargeDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AvatarEnlargeDetail>(AVATAR_ENLARGE_EVENT, { detail }));
}

/**
 * A single, app-wide WhatsApp-style lightbox. Mounted once in the layout; any
 * Avatar marked `enlargeable` fires an event that opens this overlay with the
 * photo (or the colourful fallback circle) blown up large.
 */
export default function AvatarLightbox() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AvatarEnlargeDetail | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      setDetail((e as CustomEvent<AvatarEnlargeDetail>).detail);
      setOpen(true);
    };
    window.addEventListener(AVATAR_ENLARGE_EVENT, handler);
    return () => window.removeEventListener(AVATAR_ENLARGE_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !detail) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/70 p-6 backdrop-blur-md"
      style={{ animation: "lb-fade 0.18s ease-out" }}
      role="dialog"
      aria-modal="true"
    >
      <style>{`
        @keyframes lb-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes lb-pop { from { transform: scale(0.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col items-center gap-4"
        style={{ animation: "lb-pop 0.22s cubic-bezier(0.16,1,0.3,1)" }}
      >
        {detail.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={detail.photoUrl}
            alt={detail.name}
            className="h-72 w-72 max-w-[80vw] rounded-full object-cover shadow-2xl ring-4 ring-white/80 sm:h-80 sm:w-80"
            style={{ height: "min(72vw, 20rem)", width: "min(72vw, 20rem)" }}
          />
        ) : (
          <div
            className={`grid h-72 w-72 max-w-[80vw] place-items-center rounded-full bg-gradient-to-br ${
              detail.gradient || "from-indigo-500 to-violet-500"
            } font-bold text-white shadow-2xl ring-4 ring-white/80`}
            style={{ height: "min(72vw, 20rem)", width: "min(72vw, 20rem)" }}
          >
            <span style={{ fontSize: "5rem" }}>{detail.initials || "?"}</span>
          </div>
        )}
        <div className="text-center text-xl font-bold text-white drop-shadow">{detail.name}</div>
        <button
          onClick={() => setOpen(false)}
          className="rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-slate-700 shadow-lg backdrop-blur transition hover:bg-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}
