import type { Item, Person, Claim } from "./types";

export interface PersonBreakdown {
  personId: string;
  name: string;
  subtotal: number;      // sum of their weighted item shares
  taxShare: number;      // proportional to subtotal
  serviceShare: number;  // equal split
  extrasShare: number;   // equal split
  discountShare: number; // proportional to their pre-discount total (always >= 0; reduces total)
  total: number;         // subtotal + tax + service + extras - discount
}

export interface ComputeInput {
  people: Person[];
  items: Item[];
  claims: Claim[];
  tax: number;
  serviceCharge: number;
  extras: number;
  discount?: number; // a positive amount taken OFF the bill
}

export interface ComputeResult {
  perPerson: PersonBreakdown[];
  itemsSubtotal: number;       // sum of all item prices
  claimedSubtotal: number;     // sum of item prices that have >=1 claimer
  unclaimedItems: Item[];      // items nobody has claimed yet
  discount: number;            // total discount amount applied
  grandTotal: number;          // claimedSubtotal + tax + service + extras - discount
  billTotal: number;           // itemsSubtotal + tax + service + extras - discount (full bill)
}

/** Round to 2 decimals safely (avoids 1.005 -> 1.00 float bugs). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Distribute a total amount across recipients by weight, rounding every
 * share to 2 decimals while guaranteeing the rounded shares sum EXACTLY
 * to round2(total). Uses largest-remainder reconciliation so no paisa is
 * lost or invented.
 */
function distribute(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const target = round2(total);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  if (totalWeight <= 0) {
    // No basis to weight by: split equally.
    return reconcile(
      target,
      weights.map(() => target / n)
    );
  }

  const raw = weights.map((w) => (target * w) / totalWeight);
  return reconcile(target, raw);
}

/**
 * Round each raw share to 2dp, then push the leftover paisa (in cents)
 * onto the entries with the largest fractional remainders.
 */
function reconcile(target: number, raw: number[]): number[] {
  const targetCents = Math.round(target * 100);
  const floors = raw.map((r) => Math.floor(r * 100));
  let used = floors.reduce((a, b) => a + b, 0);
  let leftover = targetCents - used; // number of extra paisa to hand out

  const remainders = raw
    .map((r, i) => ({ i, frac: r * 100 - Math.floor(r * 100) }))
    .sort((a, b) => b.frac - a.frac);

  const cents = [...floors];
  let k = 0;
  while (leftover > 0 && remainders.length > 0) {
    cents[remainders[k % remainders.length].i] += 1;
    leftover -= 1;
    k += 1;
  }
  // If leftover is negative (rare), remove from smallest remainders.
  k = 0;
  const asc = [...remainders].reverse();
  while (leftover < 0 && asc.length > 0) {
    cents[asc[k % asc.length].i] -= 1;
    leftover += 1;
    k += 1;
  }
  return cents.map((c) => c / 100);
}

/**
 * Split ONE item's price across the people who claimed it.
 *
 * A claim's `weight` is read as the EXPLICIT FRACTION of the dish that
 * person ate (e.g. 0.5 = half, 0.33 ≈ a third). A weight of 0 (or less)
 * means "equal share": that person takes an equal slice of whatever
 * fraction is left after everyone who named an explicit fraction.
 *
 *   • 3 people, none specified      → ⅓ each
 *   • A says ½, three others equal   → A pays ½, others split the other ½ → ⅙ each
 *   • everyone specified a fraction  → fractions are normalised to the full price
 *
 * Always reconciles to exactly round2(price) (largest-remainder rounding).
 */
export function splitItem(price: number, claims: Claim[]): Map<string, number> {
  const out = new Map<string, number>();
  if (claims.length === 0) return out;

  const explicit = claims.filter((c) => c.weight > 0);
  const autos = claims.filter((c) => !(c.weight > 0));
  const sumExplicit = explicit.reduce((a, c) => a + Math.min(1, c.weight), 0);

  // Fraction of the dish assigned to each claimer.
  const fractions = new Map<string, number>();
  if (autos.length > 0) {
    const remainder = Math.max(0, 1 - sumExplicit);
    const per = remainder / autos.length;
    for (const c of explicit) fractions.set(c.person_id, Math.min(1, c.weight));
    for (const c of autos) fractions.set(c.person_id, per);
  } else {
    // Everyone named a fraction: use them directly; distribute() normalises
    // so the full price is always allocated even if they don't sum to 1.
    for (const c of explicit) fractions.set(c.person_id, c.weight);
  }

  const ids = claims.map((c) => c.person_id);
  const weights = ids.map((id) => fractions.get(id) ?? 0);
  const shares = distribute(price, weights);
  ids.forEach((id, i) => out.set(id, shares[i]));
  return out;
}

export function computeSplit(input: ComputeInput): ComputeResult {
  const { people, items, claims, tax, serviceCharge, extras } = input;
  const discount = Math.max(0, round2(input.discount ?? 0));

  const claimsByItem = new Map<string, Claim[]>();
  for (const c of claims) {
    const arr = claimsByItem.get(c.item_id) ?? [];
    arr.push(c);
    claimsByItem.set(c.item_id, arr);
  }

  // 1) Per-person subtotal from each item's fractional shares.
  const subtotals = new Map<string, number>();
  for (const p of people) subtotals.set(p.id, 0);

  const unclaimedItems: Item[] = [];
  let claimedSubtotal = 0;

  for (const item of items) {
    const itemClaims = (claimsByItem.get(item.id) ?? []).filter((c) =>
      subtotals.has(c.person_id)
    );
    if (itemClaims.length === 0) {
      unclaimedItems.push(item);
      continue;
    }
    claimedSubtotal += item.price;
    const shares = splitItem(item.price, itemClaims);
    shares.forEach((amt, pid) => {
      subtotals.set(pid, round2((subtotals.get(pid) ?? 0) + amt));
    });
  }

  claimedSubtotal = round2(claimedSubtotal);
  const itemsSubtotal = round2(items.reduce((a, b) => a + b.price, 0));

  // 2) Tax: proportional to each person's subtotal.
  const subtotalWeights = people.map((p) => subtotals.get(p.id) ?? 0);
  const taxShares = distribute(tax, subtotalWeights);

  // 3) Service charge + extras: equal split across ALL people.
  const equalWeights = people.map(() => 1);
  const serviceShares = distribute(serviceCharge, equalWeights);
  const extrasShares = distribute(extras, equalWeights);

  // 4) Discount: distribute proportional to each person's PRE-discount total
  //    (subtotal + tax + service + extras), so everyone's bill drops by the
  //    same effective percentage. Discount is taken on the whole bill.
  const preTotals = people.map((p, i) => {
    const subtotal = subtotals.get(p.id) ?? 0;
    return round2(subtotal + (taxShares[i] ?? 0) + (serviceShares[i] ?? 0) + (extrasShares[i] ?? 0));
  });
  const discountShares = distribute(discount, preTotals);

  const perPerson: PersonBreakdown[] = people.map((p, i) => {
    const subtotal = subtotals.get(p.id) ?? 0;
    const taxShare = taxShares[i] ?? 0;
    const serviceShare = serviceShares[i] ?? 0;
    const extrasShare = extrasShares[i] ?? 0;
    const discountShare = discountShares[i] ?? 0;
    return {
      personId: p.id,
      name: p.name,
      subtotal,
      taxShare,
      serviceShare,
      extrasShare,
      discountShare,
      total: round2(subtotal + taxShare + serviceShare + extrasShare - discountShare),
    };
  });

  const grandTotal = round2(claimedSubtotal + tax + serviceCharge + extras - discount);
  const billTotal = round2(itemsSubtotal + tax + serviceCharge + extras - discount);

  return {
    perPerson,
    itemsSubtotal,
    claimedSubtotal,
    unclaimedItems,
    discount,
    grandTotal,
    billTotal,
  };
}

export function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
