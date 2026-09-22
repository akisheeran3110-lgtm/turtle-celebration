import { Container, Sprite, Graphics, Texture, Rectangle } from 'pixi.js';
import { mulberry32, randRange, randRangePair, atmosphereAmount } from '../systems/mathUtils.js';
import { lerpColor, toHexNumber } from '../systems/colorUtils.js';

/** 生成アセットの余白を除いた不透明部分の相対 bbox(x0,y0,x1,y1)。anchor を実際の見た目の底に合わせる。 */
const BBOX = {
  'palm-tree': { x0: 0.1, y0: 0.09, x1: 0.9, y1: 0.9 },
  'cliff-rock': { x0: 0.07, y0: 0.23, x1: 0.92, y1: 0.765 },
  'coastal-town': { x0: 0.16, y0: 0.22, x1: 0.64, y1: 0.84 },
  'hula-dancer': { x0: 0.13, y0: 0.06, x1: 0.85, y1: 0.94 },
  totem: { x0: 0.24, y0: 0.02, x1: 0.76, y1: 0.975 },
};

/**
 * CoastalVista
 * ------------
 * 「通りすがりの特別な景色」。ヤシ・崖・崖上の街・フラダンサー・トーテムを
 * あらかじめ用意した固定構図プリセットでまとめて配置し、低頻度(数分に1回)で
 * 右→左へ一度だけ流す。ランダムなのは「どのプリセットか / 全体スケール / 左右反転」まで。
 *
 *  - depth は珊瑚礁(0.66)と島影(0.3)の中間 = 0.5。島より明確に手前。
 *  - 砂浜はコード描画の浅い曲線帯(新規アセット不要)。
 *  - 空気遠近法の共通ルール(遠いほど霞む)を tint で薄く適用。
 *
 * プリセット item 座標系: x は構図中心からの相対(spread に対する比率)、
 * y はスクリーン高に対する相対オフセット(負 = 上)、baseline は水面ライン。
 */
const PRESETS = [
  {
    name: 'cliff-town',
    items: [
      { key: 'cliff-rock', x: 0.0, hRatio: 0.17 },
      { key: 'coastal-town', x: -0.02, y: -0.125, hRatio: 0.105 },
      { key: 'palm-tree', x: -0.44, hRatio: 0.28 },
      { key: 'palm-tree', x: 0.5, hRatio: 0.22, flip: true },
    ],
  },
  {
    name: 'rock-palm',
    items: [
      { key: 'cliff-rock', x: 0.0, hRatio: 0.13 },
      { key: 'palm-tree', x: 0.34, hRatio: 0.3 },
    ],
  },
  {
    name: 'beach-palms',
    items: [
      { key: 'palm-tree', x: -0.36, hRatio: 0.25 },
      { key: 'palm-tree', x: 0.02, hRatio: 0.32 },
      { key: 'palm-tree', x: 0.42, hRatio: 0.2, flip: true },
    ],
  },
  {
    name: 'hula-beach',
    items: [
      { key: 'palm-tree', x: -0.42, hRatio: 0.27 },
      { key: 'palm-tree', x: 0.44, hRatio: 0.19, flip: true },
      { key: 'totem', x: 0.22, hRatio: 0.15 },
      { key: 'hula-dancer', x: -0.06, hRatio: 0.17 },
    ],
  },
];

export class CoastalVista {
  constructor(cfg, rngSeed, textures) {
    this.cfg = cfg ?? {};
    this.depth = this.cfg.depth ?? 0.5;
    this.container = new Container();
    this.container.eventMode = 'none';
    this.rng = mulberry32(rngSeed ?? 9090);
    this.tex = textures ?? {};

    this.sand = new Graphics();
    this.container.addChild(this.sand);
    this.sprites = [];
    this._trimCache = new Map();

    this._active = false;
    this._t = 0;
    this._lastWorldX = 0;
    this._compX = 0;
    this._preset = null;
    this._nextAt = randRangePair(this.rng, this.cfg.firstSpawnSec ?? [30, 60]);
    this._w = 0;
    this._h = 0;
    this._waterLineY = 0;
  }

  resize(width, height, waterLineY) {
    this._w = width;
    this._h = height;
    this._waterLineY = waterLineY ?? height * 0.62;
    if (this._active) this._layout();
  }

  /** テスト用: 次のフレームで確実に出現させる */
  forceSpawn() {
    if (!this._active) this._begin();
  }

  /** 余白を除いた trimmed テクスチャ(anchor(0.5,1) が見た目の底に来る)。 */
  _trimmed(key) {
    if (this._trimCache.has(key)) return this._trimCache.get(key);
    const src = this.tex[key];
    let out = src ?? null;
    const bb = BBOX[key];
    if (src && bb) {
      const fw = src.source.width;
      const fh = src.source.height;
      const r = new Rectangle(bb.x0 * fw, bb.y0 * fh, (bb.x1 - bb.x0) * fw, (bb.y1 - bb.y0) * fh);
      out = new Texture({ source: src.source, frame: r });
    }
    this._trimCache.set(key, out);
    return out;
  }

  _getSprite(i) {
    if (!this.sprites[i]) {
      const sp = new Sprite();
      this.container.addChild(sp);
      this.sprites.push(sp);
    }
    return this.sprites[i];
  }

  _begin() {
    this._preset = PRESETS[(this.rng() * PRESETS.length) | 0];
    this._flip = this.rng() < 0.5 ? -1 : 1;
    this._scale = randRange(this.rng, 0.9, 1.15);
    // 構図中心をちょうど右端の外に置く: screenX = compX - worldX*depth
    this._compX = this._lastWorldX * this.depth + this._w * 1.15;
    this._active = true;

    for (const sp of this.sprites) sp.visible = false;
    this._preset.items.forEach((item, i) => {
      const sp = this._getSprite(i);
      const tex = this._trimmed(item.key);
      if (!tex) {
        sp.visible = false;
        return;
      }
      sp.texture = tex;
      sp.anchor.set(0.5, 1);
      const f = (item.flip ? -1 : 1) * this._flip;
      const hpx = item.hRatio * this._h * this._scale;
      const s = hpx / (tex.height || 1);
      sp.scale.set(s * f, s);
      sp.visible = true;
    });
    this._layout();
  }

  _layout() {
    // ヤシ/岩が砂浜から少し浮いて見えるとの指摘 → 接地点をやや下げて沈める
    const baseY = this._waterLineY - this._h * 0.006 + this._h * (this.cfg.groundOffsetRatio ?? 0.016);
    const spread = this._w * (this.cfg.spreadRatio ?? 0.6) * this._scale;
    this._spread = spread;
    this._preset.items.forEach((item, i) => {
      const sp = this.sprites[i];
      if (!sp || !sp.visible) return;
      sp._localX = item.x * spread * this._flip;
      sp._localY = baseY + (item.y ?? 0) * this._h;
    });
  }

  update(worldX, tod, dt) {
    this._lastWorldX = worldX;

    if (!this._active) {
      this.sand.visible = false;
      this._t += dt;
      if (this._t >= this._nextAt) this._begin();
      return;
    }

    const centerX = this._compX - worldX * this.depth;
    if (centerX < -this._w * 0.8) {
      this._active = false;
      this._t = 0;
      this._nextAt = randRangePair(this.rng, this.cfg.spawnEverySec ?? [210, 340]);
      for (const sp of this.sprites) sp.visible = false;
      this.sand.visible = false;
      return;
    }

    const hazeAmt = this.cfg.hazeAmount ?? atmosphereAmount(this.depth);
    const night = tod.nightness ?? 0;
    let tint = hazeAmt > 0 ? lerpColor(0xffffff, tod.color('skyHorizon'), hazeAmt) : 0xffffff;
    if (night > 0) tint = lerpColor(tint, toHexNumber(this.cfg.nightTint ?? '0x27384F'), night * 0.62);

    for (const sp of this.sprites) {
      if (!sp.visible) continue;
      sp.position.set(centerX + sp._localX, sp._localY);
      sp.tint = tint;
    }
    this._drawSand(centerX, tint);
  }

  _drawSand(cx, tint) {
    const g = this.sand;
    g.clear();
    g.visible = true;
    const w = this._spread * 1.7;
    const y = this._waterLineY - this._h * 0.004;
    const rise = this._h * 0.032;
    const sand = lerpColor(toHexNumber(this.cfg.sandColor ?? '0xEAD6A6'), tint, 0.24);

    g.moveTo(cx - w / 2, y + rise);
    g.quadraticCurveTo(cx, y - rise, cx + w / 2, y + rise);
    g.lineTo(cx + w / 2, y + this._h * 0.13);
    g.lineTo(cx - w / 2, y + this._h * 0.13);
    g.closePath();
    g.fill({ color: sand, alpha: 0.96 });

    g.moveTo(cx - w / 2, y + rise);
    g.quadraticCurveTo(cx, y - rise, cx + w / 2, y + rise);
    g.stroke({ color: lerpColor(sand, 0xffffff, 0.45), alpha: 0.5, width: 3 });
  }
}
