/**
 * shapes.js
 * ---------
 * コード描画のシルエット(珊瑚 / 島影 / 雲 / 前景の葉 / 花)。ベタ1色ではなく
 * 2〜3トーン(mid / dark / rim)を重ね、切り紙ステンシルのような奥行きを出す。
 * 生き物・乗り物・人物・アーチはスプライト(`decorations/deco-*.png`)へ移行済み。
 *
 * 規約:
 *   - 珊瑚 / 島 … 原点(0,0)= 接地点(下端中央)。上へ伸びる。
 *   - 雲 / 葉    … 原点(0,0)= 図形の中心。
 *   - tones = { mid, dark, rim }(数値カラー)。花などは個別色。
 */

/* ========================================================================
 * 形状ライブラリ方式(改訂)
 * ランダムな多角形生成をやめ、手作りで曲線を作り込んだ固定シェイプを並べ、
 * DecorLayer 側でスケール・左右反転・色味ジッターだけでバリエーションを出す。
 * すべて (g, tones, size) 署名。tones = { mid, dark, rim }。
 *   - 珊瑚 / 島 … 原点 = 下端中央(接地点)、上へ伸びる
 *   - 内側に等高線のような薄い曲線を 2〜3 本入れて単色ベタ塗りから脱する
 *   - 明(mid) / 暗(dark) の 2 段 + rim の細い線
 * ==================================================================== */

import { lerpColor } from '../systems/colorUtils.js';

const F = (color, alpha = 1) => ({ color, alpha });

function arc3(g, x0, y0, cx, cy, x1, y1, color, a, w) {
  g.moveTo(x0, y0);
  g.quadraticCurveTo(cx, cy, x1, y1);
  g.stroke({ color, alpha: a, width: Math.max(1, w) });
}

/** 決定的な小さいドット散布(リソグラフ風のハーフトーン境目に)。 */
function stipple(g, x0, x1, y, spread, n, color, alpha, seed) {
  let s = (seed | 0) || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    g.circle(x0 + (x1 - x0) * rnd(), y + (rnd() - 0.5) * spread, 0.7 + rnd() * 1.0);
  }
  g.fill(F(color, alpha));
}

/* ---------------------------- 珊瑚 ---------------------------- */

function coralStem(g, t, bw, h, lean = 0) {
  g.moveTo(-bw, 0);
  g.quadraticCurveTo(-bw * 0.5 + lean, -h * 0.5, -bw * 0.45 + lean, -h);
  g.lineTo(bw * 0.45 + lean, -h);
  g.quadraticCurveTo(bw * 0.5 + lean, -h * 0.5, bw, 0);
  g.closePath();
  g.fill(F(t.mid));
  g.moveTo(bw * 0.1, 0);
  g.quadraticCurveTo(bw * 0.35 + lean, -h * 0.5, bw * 0.35 + lean, -h);
  g.lineTo(bw * 0.45 + lean, -h);
  g.quadraticCurveTo(bw * 0.5 + lean, -h * 0.5, bw, 0);
  g.closePath();
  g.fill(F(t.dark, 0.6));
}

function tableCap(g, t, cy, wl, wr, droop) {
  g.moveTo(-wl, cy + droop);
  g.quadraticCurveTo(-wl * 0.45, cy - wl * 0.24, 0, cy - wl * 0.2);
  g.quadraticCurveTo(wr * 0.45, cy - wr * 0.24, wr, cy + droop);
  g.quadraticCurveTo(wr * 0.5, cy + droop + wr * 0.22, 0, cy + droop + wr * 0.16);
  g.quadraticCurveTo(-wl * 0.5, cy + droop + wl * 0.22, -wl, cy + droop);
  g.fill(F(t.mid));
  // 下面 = 影
  g.moveTo(-wl * 0.82, cy + droop + wl * 0.03);
  g.quadraticCurveTo(0, cy + droop + wl * 0.26, wr * 0.82, cy + droop + wr * 0.03);
  g.quadraticCurveTo(0, cy + droop + wr * 0.08, -wl * 0.82, cy + droop + wl * 0.03);
  g.fill(F(t.dark, 0.55));
  // 上面の等高線
  arc3(g, -wl * 0.68, cy - wl * 0.02, 0, cy - wl * 0.15, wr * 0.68, cy - wr * 0.02, t.rim, 0.4, wl * 0.03);
  arc3(g, -wl * 0.45, cy + droop * 0.4, 0, cy - wl * 0.03, wr * 0.45, cy + droop * 0.4, t.rim, 0.24, wl * 0.022);
}

function tableWide(g, t, s) {
  coralStem(g, t, s * 0.13, s * 0.5);
  tableCap(g, t, -s * 0.5, s * 0.82, s * 0.86, s * 0.05);
}
function tableDome(g, t, s) {
  coralStem(g, t, s * 0.11, s * 0.4, s * 0.04);
  tableCap(g, t, -s * 0.42, s * 0.55, s * 0.6, -s * 0.06);
}

function branchOne(g, t, x0, y0, ang, len, bw, col) {
  const tipX = x0 + Math.sin(ang) * len;
  const tipY = y0 - Math.abs(Math.cos(ang)) * len;
  g.moveTo(x0 - bw, y0);
  g.quadraticCurveTo((x0 + tipX) / 2 - bw, (y0 + tipY) / 2, tipX - bw * 0.5, tipY);
  g.quadraticCurveTo(tipX + bw * 0.5, tipY, (x0 + tipX) / 2 + bw, (y0 + tipY) / 2);
  g.quadraticCurveTo(x0 + bw, y0 * 0.4 + tipY * 0.1, x0 + bw, y0);
  g.fill(F(col));
  g.circle(tipX, tipY, bw * 0.95).fill(F(t.rim, 0.7));
  return [tipX, tipY];
}

function branchColony(g, t, s, defs) {
  g.ellipse(0, -s * 0.04, s * 0.24, s * 0.09).fill(F(t.dark));
  defs.forEach((d, i) => {
    const [mx, my] = branchOne(g, t, d.x, 0, d.ang, d.len * s, s * d.bw, i % 2 ? t.dark : t.mid);
    if (d.sub) {
      branchOne(g, t, (d.x + mx) / 2, (0 + my) / 2, d.ang + d.sub, d.len * s * 0.45, s * d.bw * 0.8, t.dark);
    }
  });
  arc3(g, -s * 0.18, -s * 0.1, 0, -s * 0.45, s * 0.18, -s * 0.1, t.rim, 0.3, s * 0.02);
}

function branch3(g, t, s) {
  branchColony(g, t, s, [
    { x: -s * 0.06, ang: -0.55, len: 0.9, bw: 0.09, sub: 0.6 },
    { x: 0, ang: 0.05, len: 1.0, bw: 0.1 },
    { x: s * 0.06, ang: 0.6, len: 0.85, bw: 0.09, sub: -0.6 },
  ]);
}
function branchBushy(g, t, s) {
  branchColony(g, t, s, [
    { x: -s * 0.14, ang: -0.9, len: 0.62, bw: 0.08 },
    { x: -s * 0.06, ang: -0.35, len: 0.82, bw: 0.09, sub: 0.5 },
    { x: 0, ang: 0.0, len: 0.7, bw: 0.09 },
    { x: s * 0.06, ang: 0.4, len: 0.84, bw: 0.09, sub: -0.5 },
    { x: s * 0.14, ang: 0.95, len: 0.58, bw: 0.08 },
  ]);
}
function branchTall(g, t, s) {
  branchColony(g, t, s, [
    { x: -s * 0.04, ang: -0.3, len: 1.15, bw: 0.075, sub: 0.5 },
    { x: s * 0.03, ang: 0.28, len: 1.3, bw: 0.08, sub: -0.4 },
  ]);
}

/** ソフトコーラルの棍棒状の葉1本。基部で細く、上でふくらむ。 */
function softClub(g, t, x, h, w, lean, col) {
  const bx = x;
  const tx = x + lean;
  g.moveTo(bx - w * 0.42, 0);
  g.quadraticCurveTo(bx - w * 0.72, -h * 0.5, tx - w * 0.6, -h * 0.82);
  g.quadraticCurveTo(tx - w * 0.28, -h * 1.06, tx, -h * 1.06);
  g.quadraticCurveTo(tx + w * 0.28, -h * 1.06, tx + w * 0.6, -h * 0.82);
  g.quadraticCurveTo(bx + w * 0.72, -h * 0.5, bx + w * 0.42, 0);
  g.closePath();
  g.fill(F(col));
  // 中央の等高線 + ふくらみのハイライト
  arc3(g, bx, -h * 0.16, (bx + tx) / 2 + w * 0.15, -h * 0.6, tx, -h * 0.95, t.rim, 0.4, w * 0.22);
  g.ellipse(tx, -h * 0.82, w * 0.5, h * 0.26).fill(F(t.rim, 0.38));
}

function softFat(g, t, s) {
  g.ellipse(0, -s * 0.05, s * 0.36, s * 0.12).fill(F(t.dark));
  softClub(g, t, -s * 0.3, s * 0.6, s * 0.26, -s * 0.05, t.dark);
  softClub(g, t, s * 0.32, s * 0.54, s * 0.24, s * 0.06, t.dark);
  softClub(g, t, s * 0.0, s * 0.88, s * 0.3, s * 0.02, t.mid);
}
function softThin(g, t, s) {
  g.ellipse(0, -s * 0.04, s * 0.3, s * 0.1).fill(F(t.dark));
  const cfg = [[-0.36, 0.58], [-0.16, 0.82], [0.06, 0.96], [0.28, 0.72], [0.44, 0.5]];
  cfg.forEach(([x, hf], i) => softClub(g, t, x * s, s * hf, s * 0.15, x * s * 0.28, i % 2 ? t.mid : t.dark));
}

export const CORAL_SHAPES = [tableWide, tableDome, branch3, branchBushy, branchTall, softFat, softThin];
export const SOFT_CORAL_FROM = 5; // index >= これ は左右に揺れる

/* ---------------------------- 島影 ---------------------------- */

/** bumps: [{x,h,r}] を滑らかにつないだ島影 + 内側の等高線。原点 = 下端中央。 */
function drawIsland(g, t, bumps, w) {
  const half = w / 2;
  const first = bumps[0];
  const last = bumps[bumps.length - 1];

  g.moveTo(-half, 0);
  g.quadraticCurveTo(-half * 0.5, -first.h * 0.32, first.x - first.r, -first.h * 0.72);
  g.quadraticCurveTo(first.x - first.r * 0.4, -first.h, first.x, -first.h);
  for (let i = 0; i < bumps.length; i++) {
    const b = bumps[i];
    const nx = bumps[i + 1];
    if (nx) {
      const mx = (b.x + nx.x) / 2;
      const saddleY = -Math.min(b.h, nx.h) * 0.52;
      g.quadraticCurveTo(b.x + b.r * 0.5, -b.h, mx, saddleY);
      g.quadraticCurveTo(nx.x - nx.r * 0.5, -nx.h, nx.x, -nx.h);
    } else {
      g.quadraticCurveTo(b.x + b.r, -b.h * 0.72, b.x + b.r * 1.5, -b.h * 0.3);
      g.quadraticCurveTo(half * 0.5, -b.h * 0.1, half, 0);
    }
  }
  g.closePath();
  g.fill(F(t.mid));

  // 影 = 右半分
  g.poly([0, 0, last.x, -last.h * 0.9, last.x + last.r * 0.9, -last.h * 0.3, half, 0]).fill(F(t.dark, 0.5));

  // 等高線(各峰の稜線に沿った薄い曲線を 2〜3 本。参照: island-linework-reference)
  const cw = Math.max(2, w * 0.01);
  for (const b of bumps) {
    const arcs = [
      { off: 0.16, rr: 0.5, a: 0.5 },
      { off: 0.34, rr: 0.74, a: 0.34 },
      { off: 0.54, rr: 0.95, a: 0.2 },
    ];
    for (const ar of arcs) {
      const yy = -b.h * (1 - ar.off);
      const rr = b.r * ar.rr;
      arc3(g, b.x - rr, yy + b.h * 0.05, b.x, yy - b.h * 0.05, b.x + rr, yy + b.h * 0.05, t.rim, ar.a, cw);
    }
  }
}

/*
 * 島影プリセット(#14: ベジェ補間化)
 * ------------------------------------
 * ランダム多角形生成はしない。手作りのプリセット(bump 制御点 + 幅)を並べ、
 * 「バンプ数が同じプリセットどうし」を mix で線形補間して中間形をつくる。
 * drawIsland の等高線もバンプに従うので、補間形にも自動でついてくる。
 * 値は size に対する比率(drawIslandPreset で ×size する)。
 */
export const ISLAND_PRESETS = [
  { bumps: [{ x: -0.5, h: 1.0, r: 0.72 }, { x: 0.55, h: 0.64, r: 0.58 }], w: 2.7 },    // 0 双耳峰
  { bumps: [{ x: -0.22, h: 1.12, r: 0.56 }, { x: 0.6, h: 0.48, r: 0.6 }], w: 2.65 },   // 1 主峰+肩
  { bumps: [{ x: -0.12, h: 1.14, r: 1.0 }], w: 2.4 },                                  // 2 単峰
  { bumps: [{ x: 0.06, h: 0.96, r: 1.18 }], w: 2.55 },                                 // 3 単峰(幅広ドーム)
  { bumps: [{ x: -0.72, h: 0.68, r: 0.5 }, { x: 0.0, h: 1.04, r: 0.6 }, { x: 0.72, h: 0.52, r: 0.44 }], w: 2.95 }, // 4 三峰
  { bumps: [{ x: -0.6, h: 0.46, r: 0.62 }, { x: 0.02, h: 0.56, r: 0.74 }, { x: 0.64, h: 0.42, r: 0.56 }], w: 2.9 }, // 5 長尾根
];

/** 補間可能なプリセットの組(= バンプ数が同じインデックス群)。 */
export const ISLAND_PRESET_GROUPS = [[2, 3], [0, 1], [4, 5]];

function lerpBumps(a, b, m) {
  return a.map((ba, i) => {
    const bb = b[i] ?? ba;
    return {
      x: ba.x + (bb.x - ba.x) * m,
      h: ba.h + (bb.h - ba.h) * m,
      r: ba.r + (bb.r - ba.r) * m,
    };
  });
}

/** プリセット pa→pb を mix で補間した島影。pb 省略で pa をそのまま描く。 */
export function drawIslandPreset(g, t, s, pa, pb, mix = 0) {
  const bumps = pb ? lerpBumps(pa.bumps, pb.bumps, mix) : pa.bumps;
  const w = pb ? pa.w + (pb.w - pa.w) * mix : pa.w;
  drawIsland(g, t, bumps.map((b) => ({ x: b.x * s, h: b.h * s, r: b.r * s })), w * s);
}

export function island(g, t, size, seed = 1) {
  drawIslandPreset(g, t, size, ISLAND_PRESETS[Math.abs(seed | 0) % ISLAND_PRESETS.length]);
}

/* ---------------------------- 雲 ---------------------------- */
/*
 * 参考(design-reference/29c2229c 他)の様式へ寄せた雲:
 *   - もこもこの輪郭 = 円ローブの連なり + 平らな底(union 塗り)
 *   - 影ベース → 本体(下=暗い mid → 上=明るい へ擬似グラデ3段) → 太陽側のリムライト
 *   - エッジは軽くソフト(1回り大きい低アルファのハロー)、境目に控えめなハーフトーン
 * ローブは [x, y, r](size 比率)。原点 = 図形の中心あたり、底は y ≈ 0.12*s。
 */

/** ローブ群(puffy な上)+ ゆるく波打つ底 を 1 つの塗り形状として描く。呼び出し側で fill/stroke。 */
function cloudBody(g, lobes, dx, dy, baseY, bulge) {
  const pts = lobes.map(([x, y, r]) => [x + dx, y + dy, r]);
  // 上: 各ローブの円
  for (const [x, y, r] of pts) g.circle(x, y, r);
  // 底: 左端 → 各ローブ下を波でつなぐ → 右端。上辺は水平で閉じる(円が覆う)
  const first = pts[0];
  const last = pts[pts.length - 1];
  const topLine = Math.min(...pts.map((p) => p[1]));
  g.moveTo(first[0] - first[2] * 0.7, first[1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const bpt = pts[i + 1];
    const midx = (a[0] + bpt[0]) / 2;
    g.quadraticCurveTo(midx, baseY + dy + bulge, bpt[0], bpt[1]);
  }
  g.lineTo(last[0] + last[2] * 0.7, last[1]);
  g.lineTo(last[0] + last[2] * 0.7, topLine);
  g.lineTo(first[0] - first[2] * 0.7, topLine);
  g.closePath();
}

function drawCloud(g, t, s, lobes, alpha, sunDir) {
  const baseY = s * 0.14;
  const dir = sunDir >= 0 ? 1 : -1;
  const bodyLo = lerpColor(t.dark, t.mid, 0.45);
  const bodyHi = lerpColor(t.mid, t.rim, 0.55);
  const scaleLobes = (k) => lobes.map(([x, y, r]) => [x * k, y * k, r * k]);

  const ys = lobes.map((l) => l[1]);
  const yLo = Math.min(...ys);
  const yMid = ys.reduce((a, b) => a + b, 0) / ys.length;
  const top = lobes.filter((l) => l[1] <= yLo + (yMid - yLo) * 0.55);

  // 各トーン帯は「雲全体の形を少しずつ上へずらした」もの = staircase なしの帯グラデ
  // 1. 影ベース(少し下・少し外)
  cloudBody(g, lobes.map(([x, y, r]) => [x, y, r * 1.02]), 0, s * 0.06, baseY, s * 0.015);
  g.fill(F(t.dark, alpha));
  // 2. 本体(暗め mid)
  cloudBody(g, lobes, 0, 0, baseY, -s * 0.005);
  g.fill(F(bodyLo, alpha));
  // 3. 中間(上へ 0.06s)
  cloudBody(g, lobes, 0, -s * 0.06, baseY, -s * 0.01);
  g.fill(F(t.mid, alpha));
  // 4. 上部(上へ 0.13s、少し縮小)
  cloudBody(g, scaleLobes(0.92), 0, -s * 0.13, baseY, -s * 0.01);
  g.fill(F(bodyHi, alpha));

  // 5. リムライト(最上部の太陽側の細い三日月)
  for (const [x, y, r] of top) g.circle(x - dir * r * 0.42, y - r * 0.36 - s * 0.02, r * 0.5);
  g.fill(F(t.rim, alpha * 0.5));

  // 6. 控えめなハーフトーン(本体と中間の境目あたり)
  const xs = lobes.map((l) => l[0]);
  stipple(
    g,
    Math.min(...xs) * 0.95,
    Math.max(...xs) * 0.95,
    -s * 0.02,
    s * 0.1,
    Math.round(7 + s * 0.09),
    lerpColor(t.mid, t.dark, 0.5),
    alpha * 0.18,
    Math.round(s * 13 + lobes.length),
  );
}

/*
 * 雲プリセット(ローブ配列。#14 のベジェ補間はローブごとの線形補間で維持)。
 * 値は size 比率(drawCloudPreset で ×size)。もこもこ・幅広・平らな底。
 */
export const CLOUD_PRESETS = [
  { lobes: [[-1.4, 0.06, 0.58], [-0.85, -0.14, 0.72], [-0.2, -0.3, 0.8], [0.45, -0.22, 0.74], [1.05, -0.04, 0.66], [1.5, 0.08, 0.5]] },
  { lobes: [[-1.25, 0.08, 0.56], [-0.7, -0.18, 0.74], [-0.05, -0.26, 0.78], [0.6, -0.12, 0.7], [1.15, 0.02, 0.6], [1.5, 0.1, 0.46]] },
  { lobes: [[-1.3, 0.05, 0.62], [-0.7, -0.22, 0.76], [-0.05, -0.1, 0.66], [0.5, -0.3, 0.78], [1.1, -0.08, 0.66], [1.5, 0.08, 0.5]] },
  { lobes: [[-1.35, 0.1, 0.5], [-0.8, -0.06, 0.7], [-0.2, -0.28, 0.8], [0.35, -0.18, 0.72], [0.9, -0.32, 0.7], [1.4, -0.02, 0.6]] },
];

/** プリセット pa→pb を mix で補間した雲。pb 省略で pa をそのまま。 */
export function drawCloudPreset(g, t, s, pa, pb, mix, alpha, sunDir = -1) {
  let lobes = pa.lobes;
  if (pb && pb !== pa) {
    lobes = pa.lobes.map((la, i) => {
      const lb = pb.lobes[i] ?? la;
      return la.map((v, k) => v + (lb[k] - v) * mix);
    });
  }
  drawCloud(g, t, s, lobes.map(([x, y, r]) => [x * s, y * s, r * s]), alpha, sunDir);
}

export function cloud(g, t, size, variant = 0, alpha = 0.9) {
  drawCloudPreset(g, t, size, CLOUD_PRESETS[Math.abs(variant | 0) % CLOUD_PRESETS.length], null, 0, alpha, -1);
}

/* ============================ 前景の植物 ============================ */

/**
 * ヤシの葉1枚(コーナー用の大きめのフロンド)。原点=葉柄の付け根。
 * dir(+1/-1) で伸びる向き、curl でしなり(0=水平, 1=大きく垂れる)。
 * 中央の葉軸に沿って小葉(filled)を密に生やした羽状シルエット。
 */
export function palmFrond(g, t, length, dir = 1, curl = 0.5) {
  const L = length;
  // 葉軸のサンプル点
  const N = 16;
  const spine = [];
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const x = dir * L * p * (1.05 - 0.05 * p);
    const y = -L * (0.12 + curl * (p * 1.05 - 0.15 * p * p));
    spine.push({ x, y, p });
  }
  // 小葉(下側 → 上側 の順で塗ると重なりが自然)
  for (const side of [1, -1]) {
    for (let i = 1; i < N; i++) {
      const s0 = spine[i];
      const s1 = spine[Math.min(i + 1, N)];
      const env = Math.sin(s0.p * Math.PI) ** 0.7; // 中ほどで最長
      const llen = L * (0.05 + 0.5 * env);
      // 小葉の向き: 葉軸接線から side 方向へ開き、やや前方へ倒す
      const tx = s1.x - s0.x;
      const ty = s1.y - s0.y;
      const tl = Math.hypot(tx, ty) || 1;
      const nx = (-ty / tl) * side;
      const ny = (tx / tl) * side;
      const rake = 0.55; // 前方への倒し込み
      const ex = s0.x + nx * llen * (1 - rake) + (tx / tl) * llen * rake;
      const ey = s0.y + ny * llen * (1 - rake) + (ty / tl) * llen * rake - llen * 0.12;
      const w = llen * 0.16;
      g.moveTo(s0.x - (tx / tl) * w, s0.y - (ty / tl) * w);
      g.quadraticCurveTo((s0.x + ex) / 2 + nx * llen * 0.15, (s0.y + ey) / 2 + ny * llen * 0.15, ex, ey);
      g.quadraticCurveTo((s0.x + ex) / 2, (s0.y + ey) / 2, s0.x + (tx / tl) * w, s0.y + (ty / tl) * w);
      g.closePath();
      g.fill(F(i % 3 === 0 ? t.dark : t.mid));
    }
  }
  // 葉軸
  g.moveTo(spine[0].x, spine[0].y);
  for (let i = 1; i <= N; i++) g.lineTo(spine[i].x, spine[i].y);
  g.stroke({ color: t.dark, width: Math.max(2.5, L * 0.028) });
  g.moveTo(spine[0].x, spine[0].y);
  for (let i = 1; i <= N; i++) g.lineTo(spine[i].x, spine[i].y);
  g.stroke({ color: t.rim, alpha: 0.35, width: Math.max(1, L * 0.01) });
}

/** モンステラの葉。原点=中心。 */
export function monsteraLeaf(g, t, size) {
  const s = size;
  g.moveTo(0, s * 0.9);
  g.bezierCurveTo(-s * 0.9, s * 0.5, -s * 0.95, -s * 0.6, 0, -s * 0.95);
  g.bezierCurveTo(s * 0.95, -s * 0.6, s * 0.9, s * 0.5, 0, s * 0.9);
  g.fill(F(t.mid));
  // 切れ込み(dark で穴を演出)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const yy = -s * 0.5 + i * s * 0.5;
      g.moveTo(side * s * 0.1, yy);
      g.quadraticCurveTo(side * s * 0.6, yy - s * 0.05, side * s * 0.82, yy + s * 0.12);
      g.quadraticCurveTo(side * s * 0.55, yy + s * 0.05, side * s * 0.1, yy + s * 0.12);
      g.fill(F(t.dark));
    }
  }
  g.moveTo(0, s * 0.85);
  g.lineTo(0, -s * 0.9);
  g.stroke({ color: t.rim, alpha: 0.4, width: Math.max(1.5, s * 0.03) });
}

/** 細長い南国の葉。原点=付け根。 */
export function bigLeaf(g, t, size, dir = 1) {
  const s = size;
  g.moveTo(0, 0);
  g.quadraticCurveTo(dir * s * 0.5, -s * 0.4, dir * s * 0.15, -s * 1.5);
  g.quadraticCurveTo(dir * -s * 0.35, -s * 0.5, 0, 0);
  g.fill(F(t.mid));
  g.moveTo(0, 0);
  g.quadraticCurveTo(dir * s * 0.1, -s * 0.6, dir * s * 0.15, -s * 1.5);
  g.stroke({ color: t.dark, alpha: 0.8, width: Math.max(1.5, s * 0.04) });
}

/* ============================ 花 ============================ */

/** プルメリア(5弁、クリーム+黄芯)。原点=中心。 */
export function plumeria(g, colors, size) {
  const s = size;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a) * s * 0.42;
    const cy = Math.sin(a) * s * 0.42;
    g.ellipse(cx, cy, s * 0.42, s * 0.3).fill(F(colors.petal));
  }
  g.circle(0, 0, s * 0.34).fill(F(colors.petal));
  g.circle(0, 0, s * 0.16).fill(F(colors.center));
}

/** ハイビスカス風(5弁 + 芯 + しべ)。原点=中心。 */
export function hibiscus(g, color, size, centerColor = 0xF4B434) {
  const s = size;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a) * s * 0.5;
    const cy = Math.sin(a) * s * 0.5;
    g.ellipse(cx, cy, s * 0.5, s * 0.42).fill(F(color));
  }
  g.circle(0, 0, s * 0.34).fill(F(color));
  g.circle(0, 0, s * 0.14).fill(F(centerColor));
  g.moveTo(0, 0);
  g.lineTo(s * 0.05, -s * 0.7);
  g.stroke({ color: centerColor, width: Math.max(1.5, s * 0.06) });
  g.circle(s * 0.05, -s * 0.7, s * 0.09).fill(F(centerColor));
}
