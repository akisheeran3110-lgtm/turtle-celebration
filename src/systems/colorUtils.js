import { clamp, easeInOut } from './mathUtils.js';

/** "0xRRGGBB" 形式の文字列 or 数値をそのまま数値に正規化 */
export function toHexNumber(v) {
  return typeof v === 'string' ? parseInt(v, 16) : v;
}

/** 数値カラー → "#rrggbb" */
export function hexToCss(v) {
  return '#' + (toHexNumber(v) & 0xffffff).toString(16).padStart(6, '0');
}

/** 2つの色を t(0〜1)で線形補間(sRGB空間の素朴な補間) */
export function lerpColor(colorA, colorB, t) {
  const a = toHexNumber(colorA);
  const b = toHexNumber(colorB);

  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;

  const k = clamp(t, 0, 1);
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bch = Math.round(ab + (bb - ab) * k);

  return (r << 16) | (g << 8) | bch;
}

/**
 * gradientStops([{t, ...colorKeys}, ...])から、進行度(0〜1, ループ)に対応する色を返す。
 * stops間は ease-in-out で補間し、切り替わりが機械的に見えないようにする。
 */
export function sampleGradient(stops, progress, key) {
  const p = ((progress % 1) + 1) % 1;

  for (let i = 0; i < stops.length - 1; i++) {
    const cur = stops[i];
    const next = stops[i + 1];
    if (p >= cur.t && p <= next.t) {
      const localT = (p - cur.t) / (next.t - cur.t || 1);
      return lerpColor(cur[key], next[key], easeInOut(localT));
    }
  }
  // 末尾→先頭のループ区間
  const last = stops[stops.length - 1];
  const first = stops[0];
  const span = 1 - last.t + first.t;
  const localT = span === 0 ? 0 : (p - last.t) / span;
  return lerpColor(last[key], first[key], easeInOut(localT));
}

/** 明度(HSL の L 相当)を factor 倍だけ上下させた色。長時間の単調感を散らす用途。 */
export function jitterBrightness(color, factor) {
  const c = toHexNumber(color);
  let r = (c >> 16) & 0xff;
  let g = (c >> 8) & 0xff;
  let b = c & 0xff;
  const m = 1 + factor;
  r = clamp(Math.round(r * m), 0, 255);
  g = clamp(Math.round(g * m), 0, 255);
  b = clamp(Math.round(b * m), 0, 255);
  return (r << 16) | (g << 8) | b;
}
