// HMAC-SHA256 over bytes, synchronously. A webhook's `verify` is synchronous,
// so it cannot use Web Crypto. HMAC follows RFC 2104 and is checked against
// published test vectors; the hash is the SDK's own SHA-256.

/* oxlint-disable no-bitwise -- HMAC is specified in bitwise operations. */

import { sha256 } from "../internal/sha256.ts";

const BLOCK_BYTES = 64;

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);

  return joined;
};

/** HMAC-SHA256 of `message` under `key` (RFC 2104), as 32 bytes. */
export const hmacSha256 = (
  key: Uint8Array,
  message: Uint8Array
): Uint8Array => {
  const block = new Uint8Array(BLOCK_BYTES);
  // A key longer than one block is hashed first; a shorter one is zero-padded.
  block.set(key.length > BLOCK_BYTES ? sha256(key) : key);

  const inner = block.map((byte) => byte ^ 0x36);
  const outer = block.map((byte) => byte ^ 0x5c);

  return sha256(concat(outer, sha256(concat(inner, message))));
};

/** Decodes standard base64, or `null` when the text is not valid base64. */
export const fromBase64 = (text: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(text), (char) => char.codePointAt(0) ?? 0);
  } catch {
    return null;
  }
};

export const toBase64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(""));

/** Compares two strings without stopping at the first difference. */
export const timingSafeEqual = (left: string, right: string): boolean => {
  let difference = left.length ^ right.length;

  for (let index = 0; index < left.length; index += 1) {
    difference |=
      (left.codePointAt(index) ?? 0) ^
      (right.codePointAt(index % Math.max(right.length, 1)) ?? 0);
  }

  return difference === 0;
};
