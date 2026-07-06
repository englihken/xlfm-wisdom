// src/lib/qr.ts
// Dependency-free QR Code generator (byte mode) — a condensed TypeScript port of Nayuki's
// public-domain "QR Code generator" reference algorithm. Vendored ON PURPOSE to keep the
// staff 公开报名 card able to render a scannable link WITHOUT adding an npm dependency
// (C2 constraint). Supports all 40 versions, automatic version selection, and mask
// optimisation. Returns a boolean module matrix; the caller renders it (we use inline SVG).
//
// NOTE: correctness of a QR symbol can only be truly confirmed by scanning it with a real
// device — the C2 verification doc calls for a phone scan-test of the generated code.

export type Ecc = 'L' | 'M' | 'Q' | 'H';

// Table row order is L,M,Q,H (ordinals 0..3). Format bits use a different mapping.
const ECL_ORDINAL: Record<Ecc, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECL_FORMATBITS: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 };

// ECC codewords per block, indexed [eclOrdinal][version] (version 0 unused).
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const MIN_VERSION = 1;
const MAX_VERSION = 40;
const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

const getBit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

function utf8Bytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

function getNumRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver: number, ecc: number): number {
  return Math.floor(getNumRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecc][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecc][ver];
}

// ── Reed–Solomon over GF(256), primitive polynomial 0x11D ────────────────────────────
function reedSolomonMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function reedSolomonComputeDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}
function reedSolomonComputeRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= reedSolomonMultiply(coef, factor); });
  }
  return result;
}

function addEccAndInterleave(data: number[], ver: number, ecc: number): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecc][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][ver];
  const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecw = reedSolomonComputeRemainder(dat, rsDiv);
    if (i < numShortBlocks) dat.push(0); // align interleave; padding cell skipped below
    blocks.push(dat.concat(ecw));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
    }
  }
  return result;
}

// ── Symbol builder ───────────────────────────────────────────────────────────────────
export function qrModules(text: string, ecl: Ecc = 'M'): boolean[][] {
  const ecc = ECL_ORDINAL[ecl];
  const data = utf8Bytes(text);

  // choose the smallest version that fits (byte mode)
  let version = MIN_VERSION;
  for (; ; version++) {
    const capacityBits = getNumDataCodewords(version, ecc) * 8;
    const ccBits = version < 10 ? 8 : 16;
    const usedBits = 4 + ccBits + 8 * data.length;
    if (usedBits <= capacityBits) break;
    if (version >= MAX_VERSION) throw new Error('Data too long for a QR code');
  }

  // build the bit stream: byte-mode indicator, char count, data, terminator, padding
  const bb: number[] = [];
  const appendBits = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1); };
  appendBits(0x4, 4);
  appendBits(data.length, version < 10 ? 8 : 16);
  for (const b of data) appendBits(b, 8);
  const capacityBits = getNumDataCodewords(version, ecc) * 8;
  appendBits(0, Math.min(4, capacityBits - bb.length));
  appendBits(0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8);

  const dataCodewords = new Array<number>(bb.length >> 3).fill(0);
  bb.forEach((bit, i) => { dataCodewords[i >> 3] |= bit << (7 - (i & 7)); });
  const allCodewords = addEccAndInterleave(dataCodewords, version, ecc);

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFunction[y][x] = true; };

  const drawFinder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
    }
  };
  const drawAlign = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  };
  const alignPositions = (): number[] => {
    if (version === 1) return [];
    const numAlign = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  };
  const drawFormatBits = (mask: number) => {
    const dataBits = (ECL_FORMATBITS[ecl] << 3) | mask;
    let rem = dataBits;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((dataBits << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i));
    setFn(8, 7, getBit(bits, 6));
    setFn(8, 8, getBit(bits, 7));
    setFn(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(bits, i));
    setFn(8, size - 8, true); // dark module
  };
  const drawVersion = () => {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  };

  // function patterns
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  drawFinder(3, 3); drawFinder(size - 4, 3); drawFinder(3, size - 4);
  const ap = alignPositions();
  for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
    if (!((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0))) drawAlign(ap[i], ap[j]);
  }
  drawFormatBits(0); // reserve the format area (real bits drawn after masking)
  drawVersion();

  // draw data + ECC codewords in the zig-zag pattern
  let idx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && idx < allCodewords.length * 8) {
          modules[y][x] = getBit(allCodewords[idx >>> 3], 7 - (idx & 7));
          idx++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let invert = false;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (!isFunction[y][x] && invert) modules[y][x] = !modules[y][x];
    }
  };

  const finderPenaltyAddHistory = (run: number, hist: number[]) => {
    if (hist[0] === 0) run += size;
    hist.pop();
    hist.unshift(run);
  };
  const finderPenaltyCountPatterns = (h: number[]): number => {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  };
  const finderPenaltyTerminate = (color: boolean, run: number, hist: number[]): number => {
    if (color) { finderPenaltyAddHistory(run, hist); run = 0; }
    run += size;
    finderPenaltyAddHistory(run, hist);
    return finderPenaltyCountPatterns(hist);
  };
  const getPenalty = (): number => {
    let result = 0;
    for (let y = 0; y < size; y++) {
      let color = false, run = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (modules[y][x] === color) { run++; if (run === 5) result += PENALTY_N1; else if (run > 5) result++; }
        else { finderPenaltyAddHistory(run, hist); if (!color) result += finderPenaltyCountPatterns(hist) * PENALTY_N3; color = modules[y][x]; run = 1; }
      }
      result += finderPenaltyTerminate(color, run, hist) * PENALTY_N3;
    }
    for (let x = 0; x < size; x++) {
      let color = false, run = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (modules[y][x] === color) { run++; if (run === 5) result += PENALTY_N1; else if (run > 5) result++; }
        else { finderPenaltyAddHistory(run, hist); if (!color) result += finderPenaltyCountPatterns(hist) * PENALTY_N3; color = modules[y][x]; run = 1; }
      }
      result += finderPenaltyTerminate(color, run, hist) * PENALTY_N3;
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += PENALTY_N2;
    }
    let dark = 0;
    for (const row of modules) for (const v of row) if (v) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  };

  // choose the mask with the lowest penalty
  let bestMask = 0, minPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask); drawFormatBits(mask);
    const penalty = getPenalty();
    if (penalty < minPenalty) { bestMask = mask; minPenalty = penalty; }
    applyMask(mask); // undo (XOR is its own inverse)
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);

  return modules;
}
