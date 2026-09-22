import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { lerpColor, toHexNumber } from '../systems/colorUtils.js';
import { mulberry32, TAU, clamp } from '../systems/mathUtils.js';

/**
 * SeaLayer
 * --------
 * 水面。単一の平面ではなく、ゆるやかに波打つ横帯を数枚重ねる
 * (「Music of Hawaii」レコジャケや南国イラストの海の描き方)。
 *
 *  - 各帯は上端が sin 波。worldX に応じて位相がずれてスクロール。
 *  - 浅い帯ほど明るく(sea 色 → 白)、深い帯ほど暗く(sea 色 → deepColor)。
 *  - foam 指定の帯は上端に白い泡ライン。
 *  - 上端付近に白い飛沫(speckle)を散らす。
 *
 * 珊瑚礁は最上帯より奥に置くので、半透明の帯越しに沈んで見える。
 */
export class SeaLayer {
  constructor(cfg) {
    this.cfg = cfg;
    this.container = new Container();
    this.container.eventMode = 'none';
    this._off = cfg.frontOffsetRatio ?? 0;

    // 遠景の海(水平線側)。空と同じ縦グラデ技法: 下地(海色)+ 上に霞(空の水平線色)。
    // 島影の手前・沿岸ヴィスタ/前景の波の奥に置きたいので、コンテナは所有者(ParallaxScene)が配置する。
    this.distant = new Container();
    this.distant.eventMode = 'none';
    this._distantBase = new Sprite(Texture.WHITE);
    this._distantHaze = new Sprite(SeaLayer._hazeTexture());
    this.distant.addChild(this._distantBase, this._distantHaze);
    this._skyHorizon = 0x8fd3ec;

    this.bandGfx = cfg.bands.map(() => {
      const g = new Graphics();
      this.container.addChild(g);
      return g;
    });
    this.foamGfx = new Graphics();
    this.container.addChild(this.foamGfx);
    this.speckle = new Graphics();
    this.container.addChild(this.speckle);

    this._w = 0;
    this._h = 0;
    this._lineY = 0;
    this._sea = 0x188f88;
    this._speckleData = [];
  }

  resize(width, height, waterLineY) {
    this._w = width;
    this._h = height;
    this._lineY = waterLineY;

    const seaH = height - waterLineY;
    const top = waterLineY - 2;
    const bot = waterLineY + seaH * (this._off + (this.cfg.distantOverlapRatio ?? 0.16));
    for (const s of [this._distantBase, this._distantHaze]) {
      s.x = -40;
      s.y = top;
      s.width = width + 80;
      s.height = Math.max(4, bot - top);
    }

    const rng = mulberry32(4711);
    this._speckleData = [];
    for (let i = 0; i < this.cfg.speckleCount; i++) {
      this._speckleData.push({
        x: rng() * width,
        yOff: rng() * height * 0.12,
        r: 0.6 + rng() * 1.8,
        ph: rng() * TAU,
        sp: 0.3 + rng() * 0.6,
      });
    }
  }

  setSeaColor(sea) {
    this._sea = sea;
  }

  update(worldX, dt, hazeColor, waveMult = 1, sparkleBoost = 0, waveGlow = 0) {
    const w = this._w;
    const h = this._h;
    const lineY = this._lineY;
    const seaH = h - lineY;
    const deep = toHexNumber(this.cfg.deepColor);
    const foamColor = toHexNumber(this.cfg.foamColor);
    const margin = 40;
    const step = 26;
    const off = this._off;

    if (hazeColor != null) this._skyHorizon = toHexNumber(hazeColor);
    this._distantBase.tint = this._sea;
    this._distantHaze.tint = this._skyHorizon;

    this.foamGfx.clear();

    this.cfg.bands.forEach((band, bi) => {
      const g = this.bandGfx[bi];
      g.clear();
      let color = lerpColor(this._sea, 0xffffff, band.toneToWhite || 0);
      color = lerpColor(color, deep, band.toneToDeep || 0);

      const topY = lineY + seaH * (band.topRatio + off);
      const phase = -(worldX * band.scroll * 0.05);
      // 固定pxだと画面が小さい端末ほど波が相対的に大きく/密に見えるので、
      // 比率指定(*Ratio)があれば画面サイズに比例させる
      const wavelenPx = band.wavePeriodRatio != null ? w * band.wavePeriodRatio : band.wavePeriodPx;
      const k = TAU / wavelenPx;
      const ampPx = band.waveAmpRatio != null ? h * band.waveAmpRatio : band.waveAmpPx;
      const amp = ampPx * waveMult;

      g.moveTo(-margin, h + 4);
      g.lineTo(-margin, topY + Math.sin(-margin * k + phase) * amp);
      for (let x = -margin; x <= w + margin; x += step) {
        const y = topY + Math.sin(x * k + phase) * amp;
        g.lineTo(x, y);
      }
      g.lineTo(w + margin, h + 4);
      g.closePath();
      g.fill({ color, alpha: bi === 0 ? 1 : 0.96 });

      if (band.foam) {
        this.foamGfx.moveTo(-margin, topY + Math.sin(-margin * k + phase) * amp);
        for (let x = -margin; x <= w + margin; x += step) {
          const y = topY + Math.sin(x * k + phase) * amp;
          this.foamGfx.lineTo(x, y);
        }
        // 音楽の中低音でパッと明るく太くなる(#8: 常時見える帯全幅の線で表現)
        const glow = clamp(waveGlow, 0, 1);
        this.foamGfx.stroke({ color: foamColor, alpha: 0.4 + glow * 0.5, width: 2 + glow * 4 });
      }
    });

    // 飛沫(海面のきらめき)。音楽の高音でパッと明るく大きくなる(#8: 常時見える要素で高音を表現)
    this._st = (this._st ?? 0) + dt;
    this.speckle.clear();
    const sparkle = clamp(sparkleBoost, 0, 1);
    for (const s of this._speckleData) {
      const x = (s.x - worldX * 0.08 * s.sp) % (this._w + 60);
      const px = x < 0 ? x + this._w + 60 : x;
      const y = lineY + seaH * off + s.yOff + Math.sin(this._st * s.sp + s.ph) * 3;
      const a = 0.35 + 0.35 * Math.sin(this._st * s.sp * 1.7 + s.ph);
      const alpha = Math.min(1, Math.max(0, a) + sparkle * 0.55);
      const r = s.r * (1 + sparkle * 0.9);
      this.speckle.circle(px - 30, y, r).fill({ color: 0xffffff, alpha });
    }
  }

  static _hazeTexture() {
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, h);
    return Texture.from(canvas);
  }
}
