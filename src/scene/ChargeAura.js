import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { clamp, TAU } from '../systems/mathUtils.js';

let GLOW_TEX = null;
let DARK_TEX = null;
function radialTex(stops) {
  const size = 160;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}
function glowTexture() {
  if (!GLOW_TEX) {
    GLOW_TEX = radialTex([
      [0, 'rgba(224,250,255,1)'],
      [0.28, 'rgba(160,228,255,0.7)'],
      [0.7, 'rgba(120,200,255,0.15)'],
      [1, 'rgba(120,200,255,0)'],
    ]);
  }
  return GLOW_TEX;
}
function darkTexture() {
  if (!DARK_TEX) {
    DARK_TEX = radialTex([
      [0, 'rgba(255,255,255,0)'],
      [0.34, 'rgba(255,255,255,0)'],
      [0.62, 'rgba(255,255,255,0.95)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }
  return DARK_TEX;
}

/**
 * ChargeAura
 * ----------
 * 潜水チャージ中の「パワーが溜まっている」エフェクト。3段階:
 *   Tier1: 芯の発光 + 外へ広がるリング1本 + 下から昇る光条 少し。
 *   Tier2: 発光強く + リング2本(外+内) + 光条 増える + パルス速く。
 *   Tier3: 発光最大 + リング3本 + 光条 密 + 周囲の水が放射状に暗く締まる。
 * リリース時に一気に外へ弾けて解放。
 */
export class ChargeAura {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.container = new Container();
    this.container.eventMode = 'none';
    this.container.visible = false;

    this.dark = new Sprite(darkTexture());
    this.dark.anchor.set(0.5);
    this.dark.tint = 0x061524;
    this.dark.visible = false;

    this.glow = new Sprite(glowTexture());
    this.glow.anchor.set(0.5);
    this.glow.alpha = 0;

    this.rings = new Graphics();
    this.streaks = new Graphics();

    this.container.addChild(this.dark, this.glow, this.rings, this.streaks);

    this._t = 0;
    this._releaseT = 0;
    this._releaseTier = 0;
  }

  update(dt, s) {
    this._t += dt;
    if (s.leapTier > 0) {
      this._releaseT = 0.6;
      this._releaseTier = s.leapTier;
    } else if (this._releaseT > 0) {
      this._releaseT = Math.max(0, this._releaseT - dt);
    }

    const tier = s.tier | 0;
    const releasing = this._releaseT > 0;
    if (tier <= 0 && !releasing) {
      if (this.container.visible) {
        this.container.visible = false;
        this.rings.clear();
        this.streaks.clear();
        this.glow.alpha = 0;
        this.dark.visible = false;
      }
      return;
    }

    this.container.visible = true;
    this.container.position.set(s.x, s.y);
    const R = s.sizePx * 0.5;
    const relK = releasing ? this._releaseT / 0.6 : 0;

    // --- 芯の発光 ---
    const glowBase = releasing ? 0.5 + relK * 0.6 : 0.35 + 0.55 * s.norm;
    const pulse = 1 + 0.12 * Math.sin(this._t * (6 + tier * 3));
    this.glow.alpha = clamp(glowBase * pulse, 0, 1);
    const gs = (s.sizePx * (1.0 + s.norm * 0.9 + (releasing ? relK * 1.6 : 0)) * pulse) / 160;
    this.glow.scale.set(gs);

    // --- Tier3: 亀の周りの水が放射状に暗く締まる ---
    if (tier >= 3 && !releasing) {
      this.dark.visible = true;
      const tighten = clamp((s.norm - 0.66) / 0.34, 0, 1);
      this.dark.scale.set((s.sizePx * (3.4 - tighten * 1.2)) / 160);
      this.dark.alpha = 0.42 + tighten * 0.3 + 0.06 * Math.sin(this._t * 10);
    } else {
      this.dark.visible = false;
    }

    // --- リング: 外へ広がる + (tier2+)内へ集まる ---
    this.rings.clear();
    const drawRing = (rr, a, w) => {
      this.rings.circle(0, 0, rr).stroke({ color: 0xd4f6ff, alpha: clamp(a, 0, 1), width: w });
      const dots = 14 + tier * 6;
      for (let d = 0; d < dots; d++) {
        const ang = (d / dots) * TAU + this._t * 0.7;
        this.rings.circle(Math.cos(ang) * rr, Math.sin(ang) * rr, 1.4).fill({ color: 0xeafcff, alpha: clamp(a * 0.9, 0, 1) });
      }
    };
    const nOut = releasing ? 3 : Math.max(1, tier);
    const outSpeed = releasing ? 3.4 : 0.8 + tier * 0.55;
    const outMax = releasing ? s.sizePx * (2.0 + this._releaseTier * 0.6) : s.sizePx * (1.05 + tier * 0.34);
    for (let i = 0; i < nOut; i++) {
      const ph = (this._t * outSpeed + i / nOut) % 1;
      drawRing(R + (outMax - R) * ph, (1 - ph) * (releasing ? 1.0 : 0.75 + tier * 0.08), releasing ? 3.5 : 2.6);
    }
    if (tier >= 2 && !releasing) {
      const inN = tier - 1;
      for (let i = 0; i < inN; i++) {
        const ph = (this._t * (0.9 + tier * 0.4) + i / inN) % 1;
        const rr = R + (s.sizePx * 1.5 - R) * (1 - ph); // 外→内
        drawRing(rr, ph * (0.5 + tier * 0.06), 1.8);
      }
    }

    // --- 下から昇る光条(エネルギーが集まる) ---
    this.streaks.clear();
    const nStreak = releasing ? 0 : 3 + tier * 3;
    for (let i = 0; i < nStreak; i++) {
      const seed = i * 12.9898;
      const ph = (this._t * (1.2 + tier * 0.5) + (seed % 1)) % 1; // 下→亀
      const sx = ((seed * 53) % 1 - 0.5) * s.sizePx * 1.4;
      const y0 = s.sizePx * (1.6 - ph * 1.7);
      const len = s.sizePx * (0.1 + 0.14 * (1 - ph));
      const a = Math.sin(ph * Math.PI) * (0.4 + tier * 0.1);
      this.streaks.roundRect(sx - 1.4, y0, 2.8, len, 1.4).fill({ color: 0xcdf4ff, alpha: clamp(a, 0, 1) });
    }
  }
}
