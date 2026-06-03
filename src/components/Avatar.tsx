"use client";

import { enlargeAvatar } from "./AvatarLightbox";

// Deterministic gradient per name so the same person always gets the same
// colourful fallback circle when they don't have a photo.
const GRADIENTS = [
  "from-indigo-500 to-violet-500",
  "from-rose-500 to-orange-400",
  "from-emerald-500 to-teal-400",
  "from-sky-500 to-blue-500",
  "from-fuchsia-500 to-pink-500",
  "from-amber-500 to-yellow-400",
  "from-cyan-500 to-sky-400",
  "from-purple-500 to-indigo-500",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({
  name,
  photoUrl,
  size = 40,
  ring = false,
  enlargeable = false,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
  ring?: boolean;
  // When true, tapping the avatar opens the full-screen lightbox.
  enlargeable?: boolean;
}) {
  const dim = { width: size, height: size };
  const ringCls = ring ? "ring-2 ring-white shadow-soft" : "";
  const grad = GRADIENTS[hash(name) % GRADIENTS.length];

  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    enlargeAvatar({ name, photoUrl, gradient: grad, initials: initials(name) });
  };

  // Only make it interactive when asked. Stops the click from bubbling to any
  // parent button (e.g. join / expand rows) so it just enlarges.
  const interactive = enlargeable
    ? "cursor-zoom-in transition hover:brightness-105 hover:ring-2 hover:ring-brand/50"
    : "";
  const interactiveProps = enlargeable
    ? { onClick: open, role: "button" as const, "aria-label": `View ${name}'s photo` }
    : {};

  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        {...interactiveProps}
        src={photoUrl}
        alt={name}
        style={dim}
        className={`shrink-0 rounded-full object-cover ${ringCls} ${interactive}`}
      />
    );
  }

  return (
    <div
      {...interactiveProps}
      style={dim}
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br ${grad} font-bold text-white ${ringCls} ${interactive}`}
    >
      <span style={{ fontSize: Math.max(11, size * 0.4) }}>{initials(name)}</span>
    </div>
  );
}
