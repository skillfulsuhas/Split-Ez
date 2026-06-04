export interface Session {
  id: string;
  slug: string;
  title: string | null;
  bill_image_url: string | null;
  currency: string;
  tax: number;
  service_charge: number;
  extras: number;
  discount: number;
  // Who fronted the bill + how others repay them over UPI.
  payer_name: string | null;
  payer_upi: string | null; // a UPI ID (name@bank) or a phone number
  published: boolean;
  created_at: string;
}

export interface Person {
  id: string;
  session_id: string;
  name: string;
  photo_url?: string | null;
  friend_id?: string | null;
}

// An entry in the saved, shared address book.
export interface Friend {
  id: string;
  name: string;
  photo_url: string | null;
}

export interface Item {
  id: string;
  session_id: string;
  name: string;
  price: number;
  sort_order: number;
}

export interface Claim {
  id: string;
  item_id: string;
  person_id: string;
  weight: number;
}

// Result of OCR extraction.
export interface ParsedItem {
  name: string;
  qty: number; // how many were ordered on that line
  unit_price: number; // price per single unit (the "@ X/ea" rate)
}

export interface ParsedBill {
  title?: string;
  currency?: string;
  items: ParsedItem[];
  tax: number;
  service_charge: number;
  extras: number;
}
