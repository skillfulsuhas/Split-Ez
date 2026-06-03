"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { compressImage } from "@/lib/image";
import { formatMoney } from "@/lib/compute";

const TOKEN_KEY = "billsplit:admin";

type Tab = "people" | "splits" | "stats";

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("people");

  // Restore a saved session.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    if (saved) setToken(saved);
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        setToken(pw);
        localStorage.setItem(TOKEN_KEY, pw);
      } else {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || "Wrong password.");
      }
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setToken(null);
    localStorage.removeItem(TOKEN_KEY);
  }

  if (!token) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center gap-6">
        <div className="card animate-pop-in">
          <span className="chip chip-off w-fit">🔐 Admin</span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
            Split-ez <span className="gradient-text">control room</span>
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Enter the admin password to manage friends, browse past splits, and see spending stats.
          </p>
          <form onSubmit={login} className="mt-4 flex flex-col gap-3">
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Admin password"
              className="input"
              autoFocus
            />
            {err && <p className="text-sm font-medium text-rose-600">{err}</p>}
            <button className="btn-primary" disabled={busy || !pw}>
              {busy ? "Checking…" : "Enter"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-5 pt-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">
            Admin <span className="gradient-text">control room</span>
          </h1>
          <p className="text-sm text-slate-500">Manage your shared address book & history.</p>
        </div>
        <button onClick={logout} className="btn-ghost px-3 py-2 text-sm">
          Log out
        </button>
      </header>

      <div className="flex gap-1.5">
        {(["people", "splits", "stats"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`chip text-sm ${tab === t ? "chip-on" : "chip-off"}`}
          >
            {t === "people" ? "👥 People" : t === "splits" ? "🧾 Splits" : "📊 Stats"}
          </button>
        ))}
      </div>

      {tab === "people" && <PeopleTab token={token} />}
      {tab === "splits" && <SplitsTab token={token} />}
      {tab === "stats" && <StatsTab token={token} />}
    </main>
  );
}

// ------------------------------------------------------------------ helpers

function useAdminFetch(token: string) {
  return useCallback(
    (url: string, init: RequestInit = {}) =>
      fetch(url, {
        ...init,
        headers: { ...(init.headers || {}), "x-admin-token": token, "content-type": "application/json" },
      }),
    [token]
  );
}

async function pickImage(): Promise<{ base64: string; mimeType: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve(await compressImage(file));
    };
    input.click();
  });
}

// ------------------------------------------------------------------ People

interface FriendRow {
  id: string;
  name: string;
  photo_url: string | null;
  uses: number;
}

function PeopleTab({ token }: { token: string }) {
  const af = useAdminFetch(token);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newPhoto, setNewPhoto] = useState<{ base64: string; mimeType: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const res = await af("/api/admin/friends");
    const j = await res.json().catch(() => ({ friends: [] }));
    setFriends(j.friends || []);
    setLoading(false);
  }, [af]);

  useEffect(() => {
    load();
  }, [load]);

  async function addFriend() {
    if (!newName.trim()) return;
    setAdding(true);
    await af("/api/admin/friends", {
      method: "POST",
      body: JSON.stringify({
        name: newName.trim(),
        imageBase64: newPhoto?.base64,
        mimeType: newPhoto?.mimeType,
      }),
    });
    setNewName("");
    setNewPhoto(null);
    setAdding(false);
    load();
  }

  async function doMerge() {
    const ids = Array.from(selected);
    if (ids.length < 2) return;
    // Keep the one with the most uses (ties: first).
    const keep = ids
      .map((id) => friends.find((f) => f.id === id)!)
      .sort((a, b) => b.uses - a.uses)[0];
    await af("/api/admin/friends/merge", {
      method: "POST",
      body: JSON.stringify({ keepId: keep.id, mergeIds: ids.filter((id) => id !== keep.id) }),
    });
    setSelected(new Set());
    setMergeMode(false);
    load();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Add new */}
      <div className="card">
        <div className="label">Add someone to the address book</div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => setNewPhoto(await pickImage())}
            className="shrink-0"
            title="Add a photo"
          >
            <Avatar name={newName || "?"} photoUrl={newPhoto ? `data:${newPhoto.mimeType};base64,${newPhoto.base64}` : null} size={48} ring />
          </button>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="input"
            onKeyDown={(e) => e.key === "Enter" && addFriend()}
          />
          <button onClick={addFriend} disabled={adding || !newName.trim()} className="btn-primary shrink-0 px-4 py-2.5 text-sm">
            {adding ? "…" : "Add"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">Tap the circle to attach a photo.</p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-500">
          {friends.length} {friends.length === 1 ? "person" : "people"}
        </span>
        <div className="flex gap-2">
          {mergeMode && (
            <button
              onClick={doMerge}
              disabled={selected.size < 2}
              className="chip chip-on text-sm disabled:opacity-40"
            >
              Merge {selected.size || ""}
            </button>
          )}
          <button
            onClick={() => {
              setMergeMode((m) => !m);
              setSelected(new Set());
            }}
            className={`chip text-sm ${mergeMode ? "chip-on" : "chip-off"}`}
          >
            {mergeMode ? "Cancel" : "Merge duplicates"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {friends.map((f) => (
            <FriendCard
              key={f.id}
              friend={f}
              token={token}
              mergeMode={mergeMode}
              selected={selected.has(f.id)}
              onToggleSelect={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (n.has(f.id)) n.delete(f.id);
                  else n.add(f.id);
                  return n;
                })
              }
              onChanged={load}
            />
          ))}
          {friends.length === 0 && (
            <p className="text-center text-sm text-slate-400">No one saved yet. Add your first friend above.</p>
          )}
        </div>
      )}
    </div>
  );
}

function FriendCard({
  friend,
  token,
  mergeMode,
  selected,
  onToggleSelect,
  onChanged,
}: {
  friend: FriendRow;
  token: string;
  mergeMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onChanged: () => void;
}) {
  const af = useAdminFetch(token);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(friend.name);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await af(`/api/admin/friends/${friend.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    setEditing(false);
    onChanged();
  }

  async function changePhoto() {
    const img = await pickImage();
    if (!img) return;
    setBusy(true);
    await af(`/api/admin/friends/${friend.id}`, {
      method: "PATCH",
      body: JSON.stringify({ imageBase64: img.base64, mimeType: img.mimeType }),
    });
    setBusy(false);
    onChanged();
  }

  async function clearPhoto() {
    setBusy(true);
    await af(`/api/admin/friends/${friend.id}`, {
      method: "PATCH",
      body: JSON.stringify({ clearPhoto: true }),
    });
    setBusy(false);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Remove ${friend.name} from the address book?`)) return;
    setBusy(true);
    await af(`/api/admin/friends/${friend.id}`, { method: "DELETE" });
    setBusy(false);
    onChanged();
  }

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border bg-white/90 p-3 shadow-card backdrop-blur transition ${
        selected ? "border-brand ring-2 ring-brand/25" : "border-white/60"
      }`}
    >
      {mergeMode && (
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-5 w-5 accent-indigo-500" />
      )}
      <button onClick={changePhoto} disabled={busy} title="Change photo">
        <Avatar name={friend.name} photoUrl={friend.photo_url} size={44} ring />
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input py-1.5"
            onKeyDown={(e) => e.key === "Enter" && save()}
            autoFocus
          />
        ) : (
          <>
            <div className="truncate font-semibold">{friend.name}</div>
            <div className="text-xs text-slate-400">
              {friend.uses} {friend.uses === 1 ? "split" : "splits"}
            </div>
          </>
        )}
      </div>
      {!mergeMode && (
        <div className="flex shrink-0 gap-1.5 text-xs">
          {editing ? (
            <>
              <button onClick={save} disabled={busy} className="chip chip-on">
                Save
              </button>
              <button onClick={() => { setEditing(false); setName(friend.name); }} className="chip chip-off">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="chip chip-off">
                Edit
              </button>
              {friend.photo_url && (
                <button onClick={clearPhoto} disabled={busy} className="chip chip-off">
                  Clear photo
                </button>
              )}
              <button onClick={remove} disabled={busy} className="chip chip-off text-rose-600 hover:text-rose-700">
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Splits

interface SplitRow {
  id: string;
  slug: string;
  title: string | null;
  currency: string;
  created_at: string;
  peopleCount: number;
  itemsCount: number;
  billTotal: number;
  people: string[];
}

function SplitsTab({ token }: { token: string }) {
  const af = useAdminFetch(token);
  const [rows, setRows] = useState<SplitRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await af("/api/admin/sessions");
    const j = await res.json().catch(() => ({ sessions: [] }));
    setRows(j.sessions || []);
    setLoading(false);
  }, [af]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string, label: string) {
    if (!confirm(`Delete "${label}" and all its data? This can't be undone.`)) return;
    await af(`/api/admin/sessions/${id}`, { method: "DELETE" });
    load();
  }

  if (loading) return <p className="text-center text-sm text-slate-400">Loading…</p>;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-slate-500">{rows.length} splits</span>
      {rows.map((s) => {
        const label = s.title || "Untitled split";
        return (
          <div key={s.id} className="rounded-2xl border border-white/60 bg-white/90 p-4 shadow-card backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{label}</div>
                <div className="text-xs text-slate-400">
                  {new Date(s.created_at).toLocaleDateString()} · {s.peopleCount} people · {s.itemsCount} items
                </div>
                {s.people.length > 0 && (
                  <div className="mt-1 truncate text-xs text-slate-500">{s.people.join(", ")}</div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-bold">{formatMoney(s.billTotal, s.currency)}</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2 text-xs">
              <a href={`/s/${s.slug}`} target="_blank" rel="noreferrer" className="chip chip-off">
                Open
              </a>
              <button onClick={() => remove(s.id, label)} className="chip chip-off text-rose-600 hover:text-rose-700">
                Delete
              </button>
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <p className="text-center text-sm text-slate-400">No splits yet.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ Stats

interface StatsData {
  totalBill: number;
  outings: number;
  currency: string;
  byMonth: { month: string; total: number }[];
  perPerson: { name: string; total: number; outings: number; photo_url: string | null }[];
  spotlight: {
    name: string;
    total: number;
    outings: number;
    byMonth: { month: string; total: number }[];
  } | null;
  who: string;
}

function StatsTab({ token }: { token: string }) {
  const af = useAdminFetch(token);
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [who, setWho] = useState("suhas");
  const whoRef = useRef("suhas");

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      const res = await af(`/api/admin/stats?who=${encodeURIComponent(target)}`);
      const j = await res.json().catch(() => null);
      setData(j);
      setLoading(false);
    },
    [af]
  );

  useEffect(() => {
    load(whoRef.current);
  }, [load]);

  if (loading && !data) return <p className="text-center text-sm text-slate-400">Crunching numbers…</p>;
  if (!data) return <p className="text-center text-sm text-rose-500">Could not load stats.</p>;

  const cur = data.currency;

  return (
    <div className="flex flex-col gap-4">
      {/* Headline cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-3xl bg-gradient-to-br from-brand to-accent p-4 text-white shadow-soft">
          <div className="text-xs opacity-90">Total billed across all splits</div>
          <div className="mt-1 text-2xl font-extrabold">{formatMoney(data.totalBill, cur)}</div>
        </div>
        <div className="card flex flex-col justify-center">
          <div className="text-xs text-slate-500">Outings logged</div>
          <div className="mt-1 text-2xl font-extrabold text-brand">{data.outings}</div>
        </div>
      </div>

      {/* Spend over time */}
      <div className="card">
        <div className="label">Spend over time</div>
        <BarChart data={data.byMonth} currency={cur} />
      </div>

      {/* Spotlight on a person (Suhas by default) */}
      <div className="card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="label mb-0">Spotlight</div>
          <input
            value={who}
            onChange={(e) => setWho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                whoRef.current = who.trim() || "suhas";
                load(whoRef.current);
              }
            }}
            placeholder="name"
            className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-brand"
          />
        </div>
        {data.spotlight ? (
          <>
            <div className="flex items-center gap-3">
              <Avatar
                name={data.spotlight.name}
                photoUrl={data.perPerson.find((p) => p.name.toLowerCase() === data.who)?.photo_url}
                size={48}
                ring
                enlargeable
              />
              <div>
                <div className="text-lg font-extrabold capitalize">{data.spotlight.name}</div>
                <div className="text-sm text-slate-500">
                  went out <b>{data.spotlight.outings}</b>{" "}
                  {data.spotlight.outings === 1 ? "time" : "times"} · spent{" "}
                  <b className="text-brand">{formatMoney(data.spotlight.total, cur)}</b>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <BarChart data={data.spotlight.byMonth} currency={cur} />
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">
            No splits found for &ldquo;{data.who}&rdquo;. Try another name.
          </p>
        )}
      </div>

      {/* Per-person leaderboard */}
      <div className="card">
        <div className="label">Who spends the most</div>
        <div className="flex flex-col gap-1">
          {data.perPerson.map((p, i) => (
            <div key={p.name + i} className="flex items-center gap-3 py-1.5">
              <span className="w-5 text-sm font-bold text-slate-400">{i + 1}</span>
              <Avatar name={p.name} photoUrl={p.photo_url} size={32} enlargeable />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold capitalize">{p.name}</div>
                <div className="text-xs text-slate-400">
                  {p.outings} {p.outings === 1 ? "outing" : "outings"}
                </div>
              </div>
              <div className="text-sm font-bold">{formatMoney(p.total, cur)}</div>
            </div>
          ))}
          {data.perPerson.length === 0 && (
            <p className="text-sm text-slate-400">No spend recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Dependency-free SVG bar chart.
function BarChart({ data, currency }: { data: { month: string; total: number }[]; currency: string }) {
  if (data.length === 0) return <p className="text-sm text-slate-400">No data yet.</p>;
  const max = Math.max(...data.map((d) => d.total), 1);
  const W = 320;
  const H = 140;
  const pad = 24;
  const bw = (W - pad * 2) / data.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Spend over time">
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {data.map((d, i) => {
        const h = ((H - pad * 2) * d.total) / max;
        const x = pad + i * bw + bw * 0.15;
        const w = bw * 0.7;
        const y = H - pad - h;
        const label = d.month.slice(5); // MM
        return (
          <g key={d.month}>
            <rect x={x} y={y} width={w} height={Math.max(0, h)} rx={3} fill="url(#barGrad)" />
            <text x={x + w / 2} y={H - pad + 12} textAnchor="middle" fontSize="8" fill="#94a3b8">
              {label}
            </text>
          </g>
        );
      })}
      <text x={pad} y={14} fontSize="9" fill="#64748b">
        max {formatMoney(max, currency)}
      </text>
    </svg>
  );
}
