import { computeSplit, formatMoney } from "./compute";
import type { Item, Person, Claim } from "./types";

let passed = 0;
let failed = 0;

function approx(a: number, b: number, eps = 0.001): boolean {
  return Math.abs(a - b) < eps;
}
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  ✓ " + msg);
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

function p(id: string, name: string): Person {
  return { id, session_id: "s", name };
}
function it(id: string, name: string, price: number): Item {
  return { id, session_id: "s", name, price, sort_order: 0 };
}
function cl(item: string, person: string, weight = 1): Claim {
  return { id: `${item}-${person}`, item_id: item, person_id: person, weight };
}

// ---------------------------------------------------------------
console.log("\nTest 1: equal split of one shared item (fries case)");
{
  const people = [p("A", "A"), p("B", "B"), p("C", "C")];
  const items = [it("fries", "Fries", 90)];
  const claims = [cl("fries", "A"), cl("fries", "B"), cl("fries", "C")];
  const r = computeSplit({ people, items, claims, tax: 0, serviceCharge: 0, extras: 0 });
  const totals = Object.fromEntries(r.perPerson.map((x) => [x.personId, x.total]));
  assert(approx(totals.A, 30) && approx(totals.B, 30) && approx(totals.C, 30), "3-way equal split = 30 each");
  assert(approx(totals.A + totals.B + totals.C, 90), "shares sum to item price");
}

// ---------------------------------------------------------------
console.log("\nTest 2: fractional portion (sushi: 1 ate half, others split the rest)");
{
  // sushi 200: A says they ate half (fraction 0.5). B/C/D/E left it on "equal"
  // (weight 0). A pays 200*0.5 = 100; the other 100 splits equally among 4 -> 25 each.
  const people = [p("A", "A"), p("B", "B"), p("C", "C"), p("D", "D"), p("E", "E")];
  const items = [it("sushi", "Sushi", 200)];
  const claims = [
    cl("sushi", "A", 0.5),
    cl("sushi", "B", 0),
    cl("sushi", "C", 0),
    cl("sushi", "D", 0),
    cl("sushi", "E", 0),
  ];
  const r = computeSplit({ people, items, claims, tax: 0, serviceCharge: 0, extras: 0 });
  const t = Object.fromEntries(r.perPerson.map((x) => [x.personId, x.total]));
  assert(approx(t.A, 100), "half-eater pays 100");
  assert(approx(t.B, 25) && approx(t.E, 25), "the rest split the other half -> 25 each");
  assert(approx(t.A + t.B + t.C + t.D + t.E, 200), "shares sum to 200");
}

// ---------------------------------------------------------------
console.log("\nTest 3: proportional tax + equal service + equal extras");
{
  // A eats 100, B eats 100, C eats 200. subtotal 400.
  // tax 40 proportional: A 10, B 10, C 20
  // service 30 equal: 10 each. extras 15 equal: 5 each.
  const people = [p("A", "A"), p("B", "B"), p("C", "C")];
  const items = [it("i1", "Dish A", 100), it("i2", "Dish B", 100), it("i3", "Dish C", 200)];
  const claims = [cl("i1", "A"), cl("i2", "B"), cl("i3", "C")];
  const r = computeSplit({ people, items, claims, tax: 40, serviceCharge: 30, extras: 15 });
  const m = Object.fromEntries(r.perPerson.map((x) => [x.personId, x]));
  assert(approx(m.A.taxShare, 10) && approx(m.C.taxShare, 20), "tax is proportional to subtotal");
  assert(approx(m.A.serviceShare, 10) && approx(m.C.serviceShare, 10), "service split equally");
  assert(approx(m.A.extrasShare, 5) && approx(m.C.extrasShare, 5), "extras split equally");
  assert(approx(m.A.total, 125), "A total = 100+10+10+5 = 125");
  assert(approx(m.C.total, 235), "C total = 200+20+10+5 = 235");
  assert(approx(r.grandTotal, 485), "grand total = 400+40+30+15 = 485");
}

// ---------------------------------------------------------------
console.log("\nTest 4: rounding reconciles exactly (no lost paisa)");
{
  // 100 split 3 ways = 33.33 / 33.33 / 33.34
  const people = [p("A", "A"), p("B", "B"), p("C", "C")];
  const items = [it("x", "Thing", 100)];
  const claims = [cl("x", "A"), cl("x", "B"), cl("x", "C")];
  const r = computeSplit({ people, items, claims, tax: 0, serviceCharge: 0, extras: 0 });
  const sum = r.perPerson.reduce((a, b) => a + b.total, 0);
  assert(approx(sum, 100), "3-way 100 reconciles to exactly 100");
  const cents = r.perPerson.map((x) => Math.round(x.total * 100));
  assert(cents.filter((c) => c === 3334).length === 1, "exactly one person absorbs the extra paisa");
}

// ---------------------------------------------------------------
console.log("\nTest 5: unclaimed items are flagged, not silently dropped");
{
  const people = [p("A", "A"), p("B", "B")];
  const items = [it("eaten", "Eaten", 50), it("nobody", "Nobody", 80)];
  const claims = [cl("eaten", "A")];
  const r = computeSplit({ people, items, claims, tax: 0, serviceCharge: 0, extras: 0 });
  assert(r.unclaimedItems.length === 1 && r.unclaimedItems[0].id === "nobody", "unclaimed item detected");
  assert(approx(r.claimedSubtotal, 50), "claimed subtotal excludes unclaimed");
  assert(approx(r.billTotal, 130), "bill total still reflects full bill");
}

// ---------------------------------------------------------------
console.log("\nTest 6: full realistic bill reconciles to bill total");
{
  const people = [p("A", "A"), p("B", "B"), p("C", "C"), p("D", "D")];
  const items = [
    it("i1", "Biryani", 320),
    it("i2", "Paneer", 280),
    it("i3", "Naan x4", 160),
    it("i4", "Sushi", 200),
    it("i5", "Cola x2", 90),
  ];
  const claims = [
    cl("i1", "A"),
    cl("i2", "B"),
    cl("i3", "A"), cl("i3", "B"), cl("i3", "C"), cl("i3", "D"),
    cl("i4", "C", 0.5), cl("i4", "A", 0), cl("i4", "B", 0), cl("i4", "D", 0),
    cl("i5", "C"), cl("i5", "D"),
  ];
  const r = computeSplit({ people, items, claims, tax: 52.5, serviceCharge: 105, extras: 0 });
  const sum = r.perPerson.reduce((a, b) => a + b.total, 0);
  assert(approx(sum, r.grandTotal), "sum of person totals == grand total");
  assert(approx(r.grandTotal, r.billTotal), "everything claimed -> grand total == bill total");
  console.log("    bill total:", formatMoney(r.billTotal));
  r.perPerson.forEach((x) => console.log(`    ${x.name}: ${formatMoney(x.total)}`));
}

// ---------------------------------------------------------------
console.log("\nTest 7: discount reduces everyone proportionally, reconciles exactly");
{
  // A: 100 + tax 10 + service 10 = 120, B: 120, C: 200 + tax 20 + service 10 = 230.
  // pre-discount sum = 470. A 10% (47) discount on the whole bill.
  const people = [p("A", "A"), p("B", "B"), p("C", "C")];
  const items = [it("i1", "Dish A", 100), it("i2", "Dish B", 100), it("i3", "Dish C", 200)];
  const claims = [cl("i1", "A"), cl("i2", "B"), cl("i3", "C")];
  const r = computeSplit({
    people, items, claims, tax: 40, serviceCharge: 30, extras: 0, discount: 47,
  });
  const sum = r.perPerson.reduce((a, b) => a + b.total, 0);
  assert(approx(r.grandTotal, 470 - 47), "grand total = bill - discount = 423");
  assert(approx(sum, r.grandTotal), "discounted person totals reconcile to grand total");
  const m = Object.fromEntries(r.perPerson.map((x) => [x.personId, x]));
  assert(approx(m.A.discountShare, 12) && approx(m.C.discountShare, 23), "discount proportional to pre-discount total");
  assert(approx(m.C.total, 207), "C: 230 - 23 = 207");
}

// ---------------------------------------------------------------
console.log("\nTest 8: zero discount behaves exactly like before");
{
  const people = [p("A", "A"), p("B", "B")];
  const items = [it("x", "Thing", 100)];
  const claims = [cl("x", "A"), cl("x", "B")];
  const r = computeSplit({ people, items, claims, tax: 0, serviceCharge: 0, extras: 0, discount: 0 });
  assert(approx(r.perPerson[0].total, 50) && approx(r.discount, 0), "no discount -> unchanged 50/50");
}

// ---------------------------------------------------------------
console.log("\nTest 9: default 'equal' portions split a shared dish evenly");
{
  // Nobody sets a fraction (weight 0) -> equal thirds.
  const people = [p("A", "A"), p("B", "B"), p("C", "C")];
  const items = [it("fries", "Fries", 90)];
  const claims = [cl("fries", "A", 0), cl("fries", "B", 0), cl("fries", "C", 0)];
  const r = computeSplit({ people, items, claims, tax: 0, serviceCharge: 0, extras: 0 });
  const t = Object.fromEntries(r.perPerson.map((x) => [x.personId, x.total]));
  assert(approx(t.A, 30) && approx(t.B, 30) && approx(t.C, 30), "weight 0 everywhere -> equal 30 each");
}

// ---------------------------------------------------------------
console.log("\nTest 10: explicit fractions + leftover split among the equal-sharers");
{
  // Pizza 120. A ate 1/2, B ate 1/4 (both explicit). C & D left it equal.
  // Specified = 0.75, remainder 0.25 split between C,D -> 0.125 each.
  // A=60, B=30, C=15, D=15.
  const people = [p("A", "A"), p("B", "B"), p("C", "C"), p("D", "D")];
  const items = [it("pz", "Pizza", 120)];
  const claims = [cl("pz", "A", 0.5), cl("pz", "B", 0.25), cl("pz", "C", 0), cl("pz", "D", 0)];
  const r = computeSplit({ people, items, claims, tax: 0, serviceCharge: 0, extras: 0 });
  const t = Object.fromEntries(r.perPerson.map((x) => [x.personId, x.total]));
  assert(approx(t.A, 60), "A (½) pays 60");
  assert(approx(t.B, 30), "B (¼) pays 30");
  assert(approx(t.C, 15) && approx(t.D, 15), "C & D split the leftover quarter -> 15 each");
  assert(approx(t.A + t.B + t.C + t.D, 120), "shares sum to 120");
}

// ---------------------------------------------------------------
console.log("\nTest 11: all-explicit fractions normalise to the full price");
{
  // Cake 100, A says 2/3, B says 1/3 (no equal-sharers). Allocates the full 100.
  const people = [p("A", "A"), p("B", "B")];
  const items = [it("cake", "Cake", 100)];
  const claims = [cl("cake", "A", 0.667), cl("cake", "B", 0.333)];
  const r = computeSplit({ people, items, claims, tax: 0, serviceCharge: 0, extras: 0 });
  const sum = r.perPerson.reduce((a, b) => a + b.total, 0);
  assert(approx(sum, 100), "all-explicit fractions still reconcile to 100");
  const t = Object.fromEntries(r.perPerson.map((x) => [x.personId, x.total]));
  assert(t.A > t.B, "the 2/3 eater pays more than the 1/3 eater");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
