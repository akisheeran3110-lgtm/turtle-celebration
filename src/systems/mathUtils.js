/**
 * mathUtils
 * ---------
 * 小さな数値ヘルパー群。外部依存なし。
 */

export const TAU = Math.PI * 2;

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 0〜1 の ease-in-out(3次) */
export function easeInOut(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** [0,1] を [edge0,edge1] に対して滑らかに 0→1 へ写す(GLSL smoothstep 相当) */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

/** フレームレート非依存の指数減衰 lerp 係数。halfLifeSec で「半分まで詰める」 */
export function dampFactor(halfLifeSec, dt) {
  if (halfLifeSec <= 0) return 1;
  return 1 - Math.pow(0.5, dt / halfLifeSec);
}

/**
 * 複数のサインを合成した滑らかな擬似ノイズ(-1〜1 付近)。
 * periods は「秒」の配列。Perlin ほど厳密でなくてよい用途向け。
 */
export function fractalSin(timeSec, periods, seed = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < periods.length; i++) {
    sum += amp * Math.sin((timeSec / periods[i]) * TAU + seed * (i + 1) * 1.7);
    norm += amp;
    amp *= 0.55;
  }
  return sum / (norm || 1);
}

/** 決定的な擬似乱数(0〜1)。同じ seed で同じ列を返す。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng, lo, hi) {
  return lo + (hi - lo) * rng();
}

export function randRangePair(rng, pair) {
  return randRange(rng, pair[0], pair[1]);
}

/**
 * 空気遠近法の共通ルール: depth が小さい(遠い)ほど大きい霞ブレンド量 0〜1 を返す。
 * depth >= refDepth では 0(手前は霞まない)。
 */
export function atmosphereAmount(depth, refDepth = 0.72, maxStrength = 0.55) {
  if (!(refDepth > 0)) return 0;
  const k = clamp((refDepth - depth) / refDepth, 0, 1);
  return k * maxStrength;
}
