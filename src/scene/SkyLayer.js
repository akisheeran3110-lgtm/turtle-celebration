import { Container, Sprite, Texture, Graphics } from 'pixi.js';
import { toHexNumber, lerpColor } from '../systems/colorUtils.js';
import { mulberry32, clamp, TAU } from '../systems/mathUtils.js';

// 太陽/月の芯・ハロー用の放射グラデーション(白ベース、tint で時間帯色を乗せる)。
// ChargeAura.js と同じ「canvasで焼いて1回だけ作る」パターン。
let SUN_CORE_TEX = null;
let SUN_GLOW_TEX = null;
function radialTex(stops) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}
function sunCoreTexture() {
  if (!SUN_CORE_TEX) {
    SUN_CORE_TEX = radialTex([
      [0, 'rgba(255,255,255,1)'],
      [0.55, 'rgba(255,255,255,0.92)'],
      [0.82, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }
  return SUN_CORE_TEX;
}
function sunGlowTexture() {
  if (!SUN_GLOW_TEX) {
    SUN_GLOW_TEX = radialTex([
      [0, 'rgba(255,255,255,0.55)'],
      [0.35, 'rgba(255,255,255,0.26)'],
      [0.7, 'rgba(255,255,255,0.08)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }
  return SUN_GLOW_TEX;
}

/**
 * SkyLayer
 * --------
 * 遠景空。時間帯グラデーションの主役。
 *
 *   base / horizon : 上=濃い → 水平線側=明るい の縦グラデ(2枚重ね)
 *   celestial      : 太陽 = 芯 + 同心リング(「Morena do Mar」風)。夜は月(クレーター + 光輪)
 *   stars          : 夜だけフェードインする、大きさまちまちの白い斑点 + 4輝の star
 *   orbStars       : 収集した光のオーブが小さな星として溜まる。1サイクルでリセット
 */
export class SkyLayer {
  constructor(def, timeConfig) {
    this.def = def;
    this.timeConfig = timeConfig;
    this.container = new Container();

    this.base = new Sprite(Texture.WHITE);
    this.horizon = new Sprite(SkyLayer._gradientTexture());
    this.container.addChild(this.base, this.horizon);

    this.stars = new Container();
    this.orbStars = new Container();
    this.container.addChild(this.stars, this.orbStars);

    // 太陽/月: 焼き込みグラデーションの芯+ハロー(Sprite)+ 動く同心リング(Graphics)。
    // ChargeAura と同じ構成で、生成イラストでは出せない「常に動いてる輪っか」を表現する。
    this.celestial = new Container();
    this.sunGlow = new Sprite(sunGlowTexture());
    this.sunGlow.anchor.set(0.5);
    this.sunCore = new Sprite(sunCoreTexture());
    this.sunCore.anchor.set(0.5);
    this.sunRings = new Graphics();
    this.moonCraters = new Graphics();
    this.celestial.addChild(this.sunGlow, this.sunCore, this.sunRings, this.moonCraters);
    this.container.addChild(this.celestial);
    this._ringT = 0;
    this._isMoonNow = false;
    this._celestialColor = 0xffffff;
    this._sunRadius = 40;

    this.meteors = new Container();
    this.container.addChild(this.meteors);
    this._meteors = [];
    this._meteorQueue = [];
    this._meteorSeed = 909;

    this._starData = [];
    this._w = 0;
    this._h = 0;
    this._orbSeed = 1;
    this._dim = 1;
    this._audio = 0; // 音楽の低域振幅の偏差(太陽/空の明るさに ±)
    this._sunBoost = 0;
    this._sunVel = 0;
    this._lastCelestialKey = '';
  }

  resize(width, height) {
    this._w = width;
    this._h = height;
    this.base.width = width;
    this.base.height = height;
    this.horizon.width = width;
    this.horizon.height = height;
    this._buildStars();
    this._layoutOrbStars();
    this._lastCelestialKey = '';
  }

  _buildStars() {
    this.stars.removeChildren();
    this._starData.length = 0;
    const cfg = this.timeConfig.stars;
    const rng = mulberry32(20240501);
    const color = toHexNumber(cfg.color);
    for (let i = 0; i < cfg.count; i++) {
      const x = rng() * this._w;
      const y = rng() * this._h * 0.6;
      const g = new Graphics();
      const roll = rng();
      if (roll < 0.12) {
        const s = 2 + rng() * 2.4;
        g.poly([0, -s * 2.4, s * 0.5, 0, 0, s * 2.4, -s * 0.5, 0]).fill({ color, alpha: 1 });
        g.poly([-s * 2.4, 0, 0, s * 0.5, s * 2.4, 0, 0, -s * 0.5]).fill({ color, alpha: 1 });
      } else {
        g.circle(0, 0, 0.5 + rng() * 1.7).fill({ color, alpha: 1 });
      }
      g.position.set(x, y);
      g.alpha = 0;
      this.stars.addChild(g);
      this._starData.push({ g, base: 0.45 + rng() * 0.55, ph: rng() * TAU });
    }
  }

  scroll(worldX) {
    const d = this.def.depth;
    this.stars.position.set(-worldX * d * 0.12, 0);
    this.orbStars.position.copyFrom(this.stars.position);
  }

  update(tod, dt) {
    // 音楽のビートで「パッと膨らんで、バネで戻る」動き(生の偏差そのまま使うと細かく震えるだけになる)
    this._sunVel += (clamp(this._audio, -1, 1) - this._sunBoost) * 24 * dt;
    this._sunVel *= Math.exp(-8 * dt);
    this._sunBoost += this._sunVel * dt;
    const pulse = clamp(this._sunBoost, -1, 1);

    this.base.tint = tod.color('skyTop');
    this.horizon.tint = pulse > 0
      ? lerpColor(tod.color('skyHorizon'), 0xffffff, clamp(pulse, 0, 1) * 0.6)
      : tod.color('skyHorizon');

    const pos = tod.celestialPos(this._w, this._h);
    const isMoon = tod.isMoon;
    const col = toHexNumber(tod.celestialColor());
    const key = `${isMoon}_${col}`;
    if (key !== this._lastCelestialKey) {
      this._drawCelestial(isMoon, col);
      this._lastCelestialKey = key;
    }
    this._updateCelestialRings(dt);
    this.celestial.position.set(pos.x, pos.y);
    // 太陽/月自体が音楽のビートで一回り大きく膨らむ(はっきり見える反応)
    this.celestial.scale.set(1 + Math.max(0, pulse) * 0.6);
    const horizonFade = clamp((this._h - pos.y) / (this._h * 0.28), 0.35, 1);
    this.celestial.alpha = clamp(0.9 * horizonFade * this._dim * (1 + pulse * 0.7), 0, 1);

    const a = tod.starAlpha;
    this.stars.alpha = a;
    this.orbStars.alpha = clamp(a * 1.1, 0, 1);
    this._tw = (this._tw ?? 0) + dt;
    for (const s of this._starData) {
      s.g.alpha = s.base * (0.7 + 0.3 * Math.sin(this._tw * 0.5 + s.ph));
    }

    this._updateMeteors(dt);
  }

  // --- 流星(RareEvents から呼ばれる) ---
  spawnShootingStar() {
    this._meteorQueue.push({ delay: 0, speed: 0.95, len: 0.22 });
  }

  spawnMeteorShower(count = 6) {
    const rng = mulberry32((this._meteorSeed++ * 2654435761) >>> 0);
    for (let i = 0; i < (count | 0); i++) {
      this._meteorQueue.push({ delay: rng() * 7.5, speed: 0.75 + rng() * 0.6, len: 0.12 + rng() * 0.12 });
    }
  }

  _addMeteor(speed, lenR) {
    const rng = mulberry32((this._meteorSeed++ * 2654435761) >>> 0);
    const g = new Graphics();
    const L = this._h * lenR;
    g.moveTo(0, 0);
    g.lineTo(L * 0.55, -L * 0.23);
    g.stroke({ color: 0xfffdf2, alpha: 0.4, width: 5 });
    g.moveTo(0, 0);
    g.lineTo(L, -L * 0.42);
    g.stroke({ color: 0xfffdf2, alpha: 0.95, width: 2.4 });
    g.circle(0, 0, 3.4).fill({ color: 0xffffff, alpha: 0.3 });
    g.circle(0, 0, 1.8).fill({ color: 0xffffff, alpha: 1 });
    const x = this._w * (0.22 + rng() * 0.82);
    const y = this._h * (0.02 + rng() * 0.26);
    g.position.set(x, y);
    this.meteors.addChild(g);
    this._meteors.push({
      g, x, y,
      vx: -this._w * 0.62 * speed,
      vy: this._h * 0.34 * speed,
      life: 0,
      maxLife: 1.15 / speed,
    });
  }

  _updateMeteors(dt) {
    for (let i = this._meteorQueue.length - 1; i >= 0; i--) {
      const q = this._meteorQueue[i];
      q.delay -= dt;
      if (q.delay <= 0) {
        this._addMeteor(q.speed, q.len);
        this._meteorQueue.splice(i, 1);
      }
    }
    for (let i = this._meteors.length - 1; i >= 0; i--) {
      const m = this._meteors[i];
      m.life += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.g.position.set(m.x, m.y);
      const k = m.life / m.maxLife;
      m.g.alpha = k < 0.14 ? k / 0.14 : (1 - (k - 0.14) / 0.86);
      if (k >= 1 || m.x < -this._w * 0.1) {
        m.g.destroy();
        this._meteors.splice(i, 1);
      }
    }
  }

  _drawCelestial(isMoon, color) {
    const cc = this.timeConfig.celestial;
    // 固定pxだと画面が小さい端末ほど相対的に巨大に見えるので、画面の高さに比例させる
    const r = cc.radiusRatio != null ? this._h * cc.radiusRatio : cc.radiusPx;
    this._sunRadius = r;
    this._isMoonNow = isMoon;
    this._celestialColor = color;

    this.sunCore.tint = color;
    this.sunGlow.tint = color;
    this.moonCraters.clear();

    if (isMoon) {
      this.sunGlow.width = this.sunGlow.height = r * 2.5;
      this.sunGlow.alpha = 0.45;
      this.sunCore.width = this.sunCore.height = r * 2.15;
      this.sunCore.alpha = 1;
      this.moonCraters.circle(-r * 0.32, -r * 0.22, r * 0.15).fill({ color: 0x000000, alpha: 0.08 });
      this.moonCraters.circle(r * 0.3, r * 0.12, r * 0.11).fill({ color: 0x000000, alpha: 0.07 });
      this.moonCraters.circle(r * 0.02, -r * 0.42, r * 0.08).fill({ color: 0x000000, alpha: 0.07 });
    } else {
      // 太陽: ソフトな焼き込みグラデ(芯 + 広いハロー)。輪っかはリアルタイムで動かす(_updateCelestialRings)。
      this.sunGlow.width = this.sunGlow.height = r * 4.4;
      this.sunGlow.alpha = 0.85;
      this.sunCore.width = this.sunCore.height = r * 2.3;
      this.sunCore.alpha = 1;
    }
  }

  /** 太陽の周りの同心リングを、それぞれ違う速さ/位相でゆっくり脈動させる(=止め絵ではない「動いてる感じ」)。 */
  _updateCelestialRings(dt) {
    this._ringT += dt;
    this.sunRings.clear();
    if (this._isMoonNow) return;
    const r = this._sunRadius;
    const col = this._celestialColor;
    const rings = [
      { base: 1.35, speed: 0.35, amp: 0.06, alpha: 0.4, width: 1.6 },
      { base: 1.62, speed: -0.24, amp: 0.05, alpha: 0.26, width: 1.3 },
      { base: 1.9, speed: 0.16, amp: 0.04, alpha: 0.16, width: 1.1 },
    ];
    rings.forEach((rg, i) => {
      const ph = this._ringT * rg.speed + i * 1.7;
      const rr = r * (rg.base + Math.sin(ph) * rg.amp);
      this.sunRings.circle(0, 0, rr).stroke({ color: col, alpha: rg.alpha, width: rg.width });
    });
  }

  setCelestialDim(k) {
    this._dim = clamp(k, 0, 1);
  }

  /** 音楽の低域振幅の偏差(概ね -0.3〜0.3)。太陽・水平線の明るさに ± で効かせる。 */
  setAudioLevel(dev) {
    this._audio = dev || 0;
  }

  addOrbStar() {
    const rng = mulberry32((this._orbSeed++ * 2654435761) >>> 0);
    const color = toHexNumber(this.timeConfig.stars.color);
    const g = new Graphics();
    const s = 2.4 + rng() * 1.8;
    g.circle(0, 0, s * 2).fill({ color, alpha: 0.16 });
    g.poly([0, -s * 2.6, s * 0.5, 0, 0, s * 2.6, -s * 0.5, 0]).fill({ color, alpha: 0.95 });
    g.poly([-s * 2.6, 0, 0, s * 0.5, s * 2.6, 0, 0, -s * 0.5]).fill({ color, alpha: 0.95 });
    g.circle(0, 0, s * 0.7).fill({ color: 0xffffff, alpha: 1 });
    g._frac = { x: 0.06 + rng() * 0.88, y: 0.04 + rng() * 0.44 };
    this.orbStars.addChild(g);
    this._placeOrbStar(g);
  }

  clearOrbStars() {
    this.orbStars.removeChildren();
  }

  get orbStarCount() {
    return this.orbStars.children.length;
  }

  _placeOrbStar(g) {
    g.position.set(g._frac.x * this._w, g._frac.y * this._h * 0.6);
  }

  _layoutOrbStars() {
    for (const g of this.orbStars.children) this._placeOrbStar(g);
  }

  static _gradientTexture() {
    const h = 256;
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    grad.addColorStop(0.62, 'rgba(255,255,255,0.6)');
    grad.addColorStop(0.78, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, h);
    return Texture.from(canvas);
  }
}
