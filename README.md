# BillSplit

Snap a photo of a restaurant bill, share a link in the group chat, and everyone taps
what they ate. Tax is split **proportionally** (to what each person ordered); service
charge and extras are split **equally**; shared items (e.g. a plate of fries, or sushi
where one person ate half) split by **portion weights**. Totals update **live** for
everyone. No logins — access is by an unguessable share link.

- **Frontend + API:** Next.js 14 (App Router, TypeScript, Tailwind) — deploy on Vercel free tier
- **Database + file storage + realtime:** Supabase free tier
- **Bill reading (OCR):** Google Gemini Flash (tries `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`, free tier)

Everything runs on free tiers at the scale of "me and my friends."

---

## How it works

1. **Host** opens the site → uploads a photo of the bill → Gemini reads items, prices,
   tax, and service charge → host reviews/corrects, adds everyone's names → publishes.
2. Host gets a **share link** and drops it in the group chat.
3. **Each friend** opens the link, taps their name, then taps the items they ate.
   - 3 people tap "Fries" → fries splits 3 ways automatically.
   - Ate more/less of a shared item? A **+ / −** portion stepper appears so the heavy
     eater takes a bigger share (e.g. sushi: one person bumps to ×4, the rest stay ×1).
4. Everyone sees their **own total** and (optionally) **everyone's totals**, updating live.

### The math
- **Item share** = price × (your weight ÷ sum of all weights on that item).
- **Subtotal** = sum of your item shares.
- **Tax** = total tax × (your subtotal ÷ total subtotal). *(proportional)*
- **Service + extras** = split equally across all people. *(equal)*
- **Total** = subtotal + tax share + service share + extras share.
- Rounding is reconciled so everyone's totals add up to the exact bill — no lost paisa.

---

## One-time setup (~15 minutes, all free)

### 1. Create a Supabase project
1. Go to <https://supabase.com> → sign up → **New project**.
2. Pick a name and a strong database password; choose the region closest to you.
3. Wait ~2 minutes for it to provision.

### 2. Create the database tables
1. In your Supabase project, open **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase/schema.sql` from this project, copy its entire contents, paste, and
   click **Run**. This creates the tables, indexes, realtime publication, row-level
   security policies, and the `bills` storage bucket for photos.

### 3. Get your Supabase keys
In Supabase → **Project Settings → API**, copy:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` *(secret — server-side only)*

### 4. Get a Gemini API key (free)
1. Go to <https://aistudio.google.com/app/apikey> → **Create API key**.
2. Copy it → `GEMINI_API_KEY`.

### 5. Set environment variables
Copy `.env.example` to `.env.local` and fill in the five values:

```bash
cp .env.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
```

---

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Run the split-math tests anytime:

```bash
npm run test:compute
```

---

## Deploy to Vercel (free, public URL)

1. Push this folder to a GitHub repo.
2. Go to <https://vercel.com> → sign up → **Add New… → Project** → import the repo.
3. In **Environment Variables**, add the same four keys from your `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`).
4. Click **Deploy**. You'll get a public URL like `https://billsplit-yourname.vercel.app`.

That URL is the site you share. Each split creates its own `/s/<code>` link to drop in
the group chat.

> **Tip:** keep `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` as plain (non-public)
> env vars. Only the two `NEXT_PUBLIC_` ones are exposed to the browser, and that's
> intentional and safe.

---

## Project structure

```
src/
  app/
    page.tsx              Landing page
    new/page.tsx          Host: upload bill, review, add people, publish
    s/[slug]/page.tsx     Loads a session (server)
    s/[slug]/SplitView.tsx  Friend claim UI + realtime + live totals
    api/ocr/route.ts      Gemini bill reader → structured JSON
    api/session/route.ts  Create a session (uses service-role key)
  lib/
    compute.ts            Split engine (weights, proportional tax, equal service, rounding)
    compute.test.ts       Tests (run: npm run test:compute)
    types.ts              Shared types
    slug.ts               Unguessable link codes
    supabaseClient.ts     Browser client (anon key)
    supabaseAdmin.ts      Server client (service-role key)
supabase/
  schema.sql              Database + storage setup
```

---

## Troubleshooting OCR
If scanning a bill falls back to manual entry, click **Technical details** under the
error to see why. Common causes:
- **`GEMINI_API_KEY is missing`** — add it to `.env.local` and **restart `npm run dev`**
  (env changes are only picked up on restart). On Vercel, add it in project settings and redeploy.
- **`404 ... model not found`** — your key/project can't access that model; the app
  automatically falls back to the next model in the list, but if all fail, check that
  the Generative Language API is enabled for your key at <https://aistudio.google.com>.
- **Large image / timeout** — photos are auto-compressed to ~1800px before upload, so
  this is rare; if it happens, retake the photo a bit closer and flatter.

## Notes & possible next steps
- **Currency** is INR (₹) by default. To change it, edit the `currency` default in
  `supabase/schema.sql` and the value sent from `src/app/new/page.tsx`.
- **Editing after publish** and **adding a late person** aren't wired into the UI yet —
  the data model and host token already support it if you want to add it later.
- OCR isn't perfect on every receipt; the review step before publishing is where you
  fix any misread item or price.
```
