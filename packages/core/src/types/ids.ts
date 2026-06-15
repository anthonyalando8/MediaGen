// packages/core/src/types/ids.ts
//
// Branded primitives (Deliverable 05.1). Branding prevents accidentally
// passing a raw string/number where a validated Id/Frame is expected, with
// zero runtime cost (the brand is erased at compile time).

/** nanoid(12)-shaped identifier. */
export type Id = string & { __brand: "Id" };

/** Integer frame index; seconds = frame / fps. */
export type Frame = number & { __brand: "Frame" };

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
const ID_LENGTH = 12;

/** Minimal shape of the Web Crypto API this module needs (avoids depending on DOM lib types). */
interface MinimalCrypto {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function getCrypto(): MinimalCrypto | undefined {
  return (globalThis as unknown as { crypto?: MinimalCrypto }).crypto;
}

/**
 * Generates a nanoid(12)-shaped Id using crypto.getRandomValues when
 * available (browser, worker, and Node 19+ all expose globalThis.crypto),
 * falling back to Math.random for older/exotic runtimes. The fallback is
 * non-cryptographic but sufficient for client-side document ids.
 */
export function createId(): Id {
  const bytes = new Uint8Array(ID_LENGTH);
  const cryptoObj = getCrypto();
  if (cryptoObj) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < ID_LENGTH; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return out as Id;
}

/** Brands a plain integer as a Frame. Truncates toward zero for safety. */
export function toFrame(n: number): Frame {
  return Math.trunc(n) as Frame;
}
