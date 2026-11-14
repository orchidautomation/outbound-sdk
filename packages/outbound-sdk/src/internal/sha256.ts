// A small synchronous SHA-256. Mapping functions are pure and synchronous, so
// they cannot use the asynchronous Web Crypto digest for content hashes and
// event ids. This follows FIPS 180-4 and is checked against its test vectors.

/* oxlint-disable no-bitwise -- SHA-256 is specified in bitwise operations. */

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

const rotate = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

const pad = (bytes: Uint8Array): Uint8Array => {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
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

/** The SHA-256 digest of a UTF-8 string, as lowercase hex. */
export const sha256Hex = (input: string): string => {
  const padded = pad(new TextEncoder().encode(input));
  const view = new DataView(padded.buffer);
  const state = [...INITIAL];

  for (let offset = 0; offset < padded.length; offset += 64) {
    compress(state, schedule(view, offset));
  }

  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
};

/** A short stable id derived from the parts, for refs, event ids and cache keys. */
export const stableId = (
  ...parts: (string | number | null | undefined)[]
): string =>
  sha256Hex(parts.map((part) => String(part ?? "")).join("\u001F")).slice(
    0,
    32
  );
