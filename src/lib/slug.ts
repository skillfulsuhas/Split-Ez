// Short, URL-safe, unguessable identifiers (no external deps).
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz"; // no 0/1/l/o ambiguity

function randomString(len: number): string {
  let out = "";
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function newSlug(): string {
  return randomString(8); // ~40 bits, fine for a friends tool
}

export function newHostToken(): string {
  return randomString(24);
}
