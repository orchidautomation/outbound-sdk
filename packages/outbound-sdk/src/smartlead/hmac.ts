// HMAC-SHA256 over bytes, synchronously. A webhook's `verify` is synchronous,
// so it cannot use Web Crypto, and the shared `sha256Hex` hashes a string, not
// bytes. SHA-256 follows FIPS 180-4 and HMAC follows RFC 2104; both are
// checked against published test vectors.

/* oxlint-disable no-bitwise -- SHA-256 and HMAC are specified in bitwise operations. */

const K = new Uint32Array([
  0x42_8a_2f_98, 0x71_37_44_91, 0xb5_c0_fb_cf, 0xe9_b5_db_a5, 0x39_56_c2_5b,
  0x59_f1_11_f1, 0x92_3f_82_a4, 0xab_1c_5e_d5, 0xd8_07_aa_98, 0x12_83_5b_01,
  0x24_31_85_be, 0x55_0c_7d_c3, 0x72_be_5d_74, 0x80_de_b1_fe, 0x9b_dc_06_a7,
  0xc1_9b_f1_74, 0xe4_9b_69_c1, 0xef_be_47_86, 0x0f_c1_9d_c6, 0x24_0c_a1_cc,
  0x2d_e9_2c_6f, 0x4a_74_84_aa, 0x5c_b0_a9_dc, 0x76_f9_88_da, 0x98_3e_51_52,
  0xa8_31_c6_6d, 0xb0_03_27_c8, 0xbf_59_7f_c7, 0xc6_e0_0b_f3, 0xd5_a7_91_47,
  0x06_ca_63_51, 0x14_29_29_67, 0x27_b7_0a_85, 0x2e_1b_21_38, 0x4d_2c_6d_fc,
  0x53_38_0d_13, 0x65_0a_73_54, 0x76_6a_0a_bb, 0x81_c2_c9_2e, 0x92_72_2c_85,
  0xa2_bf_e8_a1, 0xa8_1a_66_4b, 0xc2_4b_8b_70, 0xc7_6c_51_a3, 0xd1_92_e8_19,
  0xd6_99_06_24, 0xf4_0e_35_85, 0x10_6a_a0_70, 0x19_a4_c1_16, 0x1e_37_6c_08,
  0x27_48_77_4c, 0x34_b0_bc_b5, 0x39_1c_0c_b3, 0x4e_d8_aa_4a, 0x5b_9c_ca_4f,
  0x68_2e_6f_f3, 0x74_8f_82_ee, 0x78_a5_63_6f, 0x84_c8_78_14, 0x8c_c7_02_08,
  0x90_be_ff_fa, 0xa4_50_6c_eb, 0xbe_f9_a3_f7, 0xc6_71_78_f2,
]);

const INITIAL = [
  0x6a_09_e6_67, 0xbb_67_ae_85, 0x3c_6e_f3_72, 0xa5_4f_f5_3a, 0x51_0e_52_7f,
  0x9b_05_68_8c, 0x1f_83_d9_ab, 0x5b_e0_cd_19,
];

const BLOCK_BYTES = 64;

const rotate = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

const pad = (bytes: Uint8Array): Uint8Array => {
  const paddedLength =
    Math.ceil((bytes.length + 9) / BLOCK_BYTES) * BLOCK_BYTES;

  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_00_00_00_00));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  return padded;
};

const schedule = (view: DataView, offset: number): Uint32Array => {
  const words = new Uint32Array(64);

  for (let index = 0; index < 16; index += 1) {
    words[index] = view.getUint32(offset + index * 4);
  }

  for (let index = 16; index < 64; index += 1) {
    const w15 = words[index - 15] ?? 0;
    const w2 = words[index - 2] ?? 0;
    const s0 = rotate(w15, 7) ^ rotate(w15, 18) ^ (w15 >>> 3);
    const s1 = rotate(w2, 17) ^ rotate(w2, 19) ^ (w2 >>> 10);
    words[index] =
      ((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0;
  }

  return words;
};

const compress = (state: number[], words: Uint32Array): void => {
  let [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = state;

  for (let index = 0; index < 64; index += 1) {
    const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
    const choice = (e & f) ^ (~e & g);
    const t1 = (h + s1 + choice + (K[index] ?? 0) + (words[index] ?? 0)) >>> 0;
    const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (s0 + majority) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }

  const next = [a, b, c, d, e, f, g, h];

  for (let index = 0; index < 8; index += 1) {
    state[index] = ((state[index] ?? 0) + (next[index] ?? 0)) >>> 0;
  }
};

/** The SHA-256 digest of `bytes`, as 32 bytes. */
export const sha256 = (bytes: Uint8Array): Uint8Array => {
  const padded = pad(bytes);
  const view = new DataView(padded.buffer);
  const state = [...INITIAL];

  for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
    compress(state, schedule(view, offset));
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);

  for (const [index, word] of state.entries()) {
    out.setUint32(index * 4, word);
  }

  return digest;
};

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
