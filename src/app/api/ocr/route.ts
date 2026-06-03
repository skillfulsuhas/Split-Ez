import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ParsedBill } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Tried in order. If one is unavailable/retired, we fall through to the next.
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

const PROMPT = `You are an expert at reading Indian restaurant/cafe bills from a photo, including faint thermal-printer receipts where text is skewed or wrapped across lines.

Return ONLY valid JSON (no markdown fences, no commentary) in EXACTLY this shape:
{
  "title": "<restaurant name if visible, else empty string>",
  "currency": "INR",
  "items": [ { "name": "<dish name>", "qty": <integer: how many were ordered>, "unit_price": <number: price for ONE unit> } ],
  "tax": <number: sum of all taxes — CGST + SGST + IGST + GST + VAT>,
  "service_charge": <number: service charge actually charged>,
  "extras": <number: packing/delivery/round-off and similar; discounts are negative>
}

CRITICAL READING RULES:
- An item's name may WRAP onto two or more printed lines (e.g. "SINGAPORE CHILLI" then "CHICKEN" on the next line). Join the wrapped pieces into ONE item name. Use the food words on adjacent lines, not the numbers.
- "qty" is the quantity ordered on that line. "unit_price" is the price for a SINGLE unit (the "@ X/ea" rate, or the "Price" column). The line total equals qty × unit_price — do NOT put the line total in unit_price.
  - Example: "Spaghetti Arrabiata (Veg)  2 @ 530/ea  1,060.00" -> { "name": "Spaghetti Arrabiata (Veg)", "qty": 2, "unit_price": 530 }
  - Example: "Hot Chocolate Hazelnut  2 @ 310/ea  620.00" -> { "name": "Hot Chocolate Hazelnut", "qty": 2, "unit_price": 310 }
  - Example: "GOLDEN FRIED PRAWNS  490  1  490.000" -> { "name": "Golden Fried Prawns", "qty": 1, "unit_price": 490 }
- If you can only see a line total and no per-unit rate, set qty to 1 and unit_price to that total.
- Read the quantity carefully — "1 @ ...", "2 @ ...", or a "Qty" column. The bill header may say "N items (M Qty)"; M is the sum of all quantities, use it as a sanity check.
- Strip commas and currency symbols from numbers: "1,060.00" -> 1060, "490.000" -> 490.
- NEVER output these as items: Sub Total, Subtotal, Net Amount, Gross Amount, Bill Total, Grand Total, Round Off, Tax/CGST/SGST/GST/VAT lines, Service Charge, Tip, or "Pax"/table info.
- tax: add up every tax line. Example: "CGST 101.35" + "SGST 101.35" -> tax 202.70.
- service_charge: if the bill says service charge is "voluntary", "not mandatory", "not charged", or there is no service charge line, use 0. Only use a positive number if an amount was actually added.
- extras: if there is a round-off (e.g. Bill Total 4256.70 but Bill Total (rounded) 4257.00), put the difference here (0.30). Otherwise 0.
- If a value is genuinely absent, use 0 for numbers and "" for strings.
- Read carefully and double-check every price against its line.`;

function extractJson(text: string): string {
  // Models sometimes wrap JSON in ```json fences despite instructions.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1) return text.slice(first, last + 1);
  return text.trim();
}

function normalize(parsed: any): ParsedBill {
  const toNum = (v: any) => {
    if (typeof v === "number") return v;
    const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  return {
    title: typeof parsed?.title === "string" ? parsed.title : "",
    currency: parsed?.currency || "INR",
    items: Array.isArray(parsed?.items)
      ? parsed.items
          .filter((i: any) => i && typeof i.name === "string" && i.name.trim())
          .map((i: any) => {
            const qty = Math.max(1, Math.round(toNum(i.qty) || 1));
            // Prefer an explicit per-unit price; otherwise derive from a line
            // total if the model only gave one.
            let unit = toNum(i.unit_price);
            if (!unit) {
              const lineTotal = toNum(i.price ?? i.amount ?? i.total);
              unit = lineTotal && qty > 0 ? lineTotal / qty : lineTotal;
            }
            return { name: i.name.trim(), qty, unit_price: unit };
          })
      : [],
    tax: toNum(parsed?.tax),
    service_charge: toNum(parsed?.service_charge),
    extras: toNum(parsed?.extras),
  };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OCR isn't configured: GEMINI_API_KEY is missing. Add it to .env.local and restart the dev server (or set it in Vercel).",
        code: "NO_KEY",
      },
      { status: 500 }
    );
  }

  let imageBase64: string | undefined;
  let mimeType: string | undefined;
  try {
    const body = await req.json();
    imageBase64 = body.imageBase64;
    mimeType = body.mimeType;
  } catch {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }
  if (!imageBase64) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const errors: string[] = [];

  for (const modelName of MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      });

      const result = await model.generateContent([
        { text: PROMPT },
        { inlineData: { data: imageBase64, mimeType: mimeType || "image/jpeg" } },
      ]);

      const raw = result.response.text();
      const parsed = JSON.parse(extractJson(raw));
      const bill = normalize(parsed);

      if (bill.items.length === 0) {
        errors.push(`${modelName}: returned no items`);
        continue; // try a stronger model
      }
      return NextResponse.json({ ...bill, _model: modelName });
    } catch (err: any) {
      const msg = err?.message || String(err);
      errors.push(`${modelName}: ${msg}`);
      // 404 / not found -> model retired, try next. Otherwise also try next.
      continue;
    }
  }

  console.error("OCR failed across all models:", errors);
  return NextResponse.json(
    {
      error: "Couldn't read the bill automatically. You can enter items manually below.",
      detail: errors.join(" | "),
    },
    { status: 502 }
  );
}
