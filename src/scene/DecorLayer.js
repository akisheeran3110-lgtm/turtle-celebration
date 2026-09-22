import { Container, Graphics, Sprite } from 'pixi.js';
import { mulberry32, randRange, randRangePair, atmosphereAmount, TAU, clamp } from '../systems/mathUtils.js';
import { jitterBrightness, lerpColor } from '../systems/colorUtils.js';
import { trimTexture } from './textureTrim.js';
import {
  CORAL_SHAPES,
  SOFT_CORAL_FROM,
  ISLAND_PRESETS,
  ISLAND_PRESET_GROUPS,
  CLOUD_PRESETS,
  drawIslandPreset,
  drawCloudPreset,
} from './shapes.js';

/** 島影スプライト(deco-island-*.png)の不透明部分 bbox。anchor(0.5,1) を接地点に合わせる。 */
const ISLAND_SPRITE_BBOX = {
  'island-1': { x0: 0.075, y0: 0.32, x1: 0.93, y1: 0.702 },
  'island-2': { x0: 0.1, y0: 0.338, x1: 0.905, y1: 0.657 },
  'island-3': { x0: 0.085, y0: 0.315, x1: 0.9, y1: 0.734 },
  'island-4': { x0: 0.124, y0: 0.413, x1: 0.929, y1: 0.629 },
};

/** 雲スプライト(deco-cloud-*.png)の不透明部分 bbox。アセット追加時に実測して埋める(pngbbox.mjs)。 */
const CLOUD_SPRITE_BBOX = {
  'cloud-01': { x0: 0.008, y0: 0.158, x1: 0.985, y1: 0.78 },
  'cloud-02': { x0: 0.021, y0: 0.109, x1: 0.982, y1: 0.765 },
  'cloud-03': { x0: 0.012, y0: 0.139, x1: 0.996, y1: 0.81 },
  'cloud-04': { x0: 0.025, y0: 0.077, x1: 0.981, y1: 0.765 },
};

/** 珊瑚スプライト(deco-coral.png)の不透明部分 bbox。 */
const CORAL_SPRITE_BBOX = {
  coral: { x0: 0.037, y0: 0.057, x1: 0.96, y1: 0.942 },
};

/** 海藻/草スプライト(deco-grass-*.png)の不透明部分 bbox(reef の soft coral 枠にフォールバックで使う)。 */
const GRASS_SPRITE_BBOX = {
  'grass-1': { x0: 0.024, y0: 0.071, x1: 0.976, y1: 0.969 },
  'grass-2': { x0: 0.026, y0: 0.024, x1: 0.96, y1: 1 },
  'grass-3': { x0: 0.068, y0: 0.088, x1: 0.931, y1: 0.911 },
  'grass-4': { x0: 0.038, y0: 0.229, x1: 0.962, y1: 0.913 },
};

/**
 * DecorLayer
 * ----------
 * 連続して画面を流れる装飾(珊瑚礁 / 島影 / 雲)の1レイヤー。
 *  - 形は shapes.js のシェイプライブラリから選ぶ(ランダム多角形生成なし)。
 *    島 / 雲は「同グループの 2 プリセット + mix」でベジェ補間して中間形をつくる(#14)。
 *    珊瑚は離散(7 種)のまま。
 *    島影はさらに、確率 spriteChance で deco-island-*.png スプライトも選ぶ(コード描画の変種)。
 *  - バリエーションはスケール・左右反転・明度ジッター・軽い回転のみ。
 *  - poolSize 個の Graphics を使い回す。画面外に出たら反対側へ再配置。
 *  - 色は時間帯パレット(mid/dark/rim)。トーンが変わったら描き直す。
 *  - ソフトコーラルだけ左右に揺れる。雲だけ上下に揺れる。
 */
export class DecorLayer {
  constructor(def, rngSeed, textures = {}) {
    this.def = def;
    this.container = new Container();
    this.rng = mulberry32(rngSeed);

    // 島影は「コード描画のプリセット + deco-island-*.png スプライト」からランダム選択(#島スプライト)
    this._islandTex = [];
    if (def.kind === 'island') {
      for (const key of ['island-1', 'island-2', 'island-3', 'island-4']) {
        if (textures[key]) this._islandTex.push(trimTexture(textures[key], ISLAND_SPRITE_BBOX[key]));
      }
    }
    // 雲は deco-cloud-*.png があればスプライトで(なければ shapes.js の drawCloud にフォールバック)
    this._cloudTex = [];
    if (def.kind === 'cloud') {
      for (const key of Object.keys(textures)) {
        if (key.startsWith('cloud-') && textures[key]) {
          this._cloudTex.push(trimTexture(textures[key], CLOUD_SPRITE_BBOX[key]));
        }
      }
    }
    // 珊瑚(硬い塊、kind:'coral')は deco-coral.png、海藻(揺れる方、kind:'grass')は
    // deco-grass-*.png。どちらも無ければ shapes.js の手続き形状(CORAL_SHAPES)にフォールバック。
    this._coralTex = [];
    this._grassTex = [];
    if (def.kind === 'coral' && textures.coral) {
      this._coralTex.push(trimTexture(textures.coral, CORAL_SPRITE_BBOX.coral));
    } else if (def.kind === 'grass') {
      for (const key of Object.keys(textures)) {
        if (key.startsWith('grass-') && textures[key]) {
          this._grassTex.push(trimTexture(textures[key], GRASS_SPRITE_BBOX[key]));
        }
      }
    }
    const spriteAnchorY = def.kind === 'cloud' ? 0.5 : 1;

    this.items = [];
    for (let i = 0; i < def.poolSize; i++) {
      const g = new Graphics();
      this.container.addChild(g);
      let sp = null;
      if (this._islandTex.length || this._cloudTex.length || this._coralTex.length || this._grassTex.length) {
        sp = new Sprite();
        sp.anchor.set(0.5, spriteAnchorY);
        sp.visible = false;
        this.container.addChild(sp);
      }
      this.items.push({
        g, sp, itemX: 0, baseY: 0, scale: 1, flip: 1, kindIndex: 0, rot: 0, soft: false,
        phase: 0, jitter: 0, swayPeriod: 0, bobPeriod: 0,
        presetA: 0, presetB: 0, mix: 0, useSprite: false, spTexIndex: 0, spScale: 1,
      });
    }
    this._w = 0;
    this._h = 0;
    this._t = 0;
    this._spanX = 1;
    this._waterLineY = 0;
    this._lastKey = -1;
    // 空気遠近法: 遠いレイヤーほど霞色を強くブレンド(共通ルール)
    this._hazeColor = null;
    this._hazeAmount = def.hazeAmount ?? atmosphereAmount(def.depth ?? 0.5);
  }

  resize(width, height, waterLineY) {
    this._w = width;
    this._h = height;
    this._waterLineY = waterLineY ?? height * 0.62;
    this._spanX = width * this.def.spacingRatio;
    let x = -width * 0.5;
    for (const it of this.items) {
      it.itemX = x;
      this._respawn(it, false);
      x += this._nextGap();
    }
    this._lastKey = -1;
  }

  _nextGap() {
    const j = this.def.spacingJitter ?? 0;
    return this._spanX * randRange(this.rng, 1 - j, 1 + j);
  }

  /** 形の選択。島/雲は「同グループの2プリセット + mix」で中間形をつくる(#14)。 */
  _pickShape(it) {
    const kind = this.def.kind;
    const interp = this.def.interpolate !== false;
    if (kind === 'island') {
      it.useSprite = this._islandTex.length > 0 && this.rng() < (this.def.spriteChance ?? 0);
      if (it.useSprite) {
        it.spTexIndex = (this.rng() * this._islandTex.length) | 0;
      } else {
        const grp = ISLAND_PRESET_GROUPS[(this.rng() * ISLAND_PRESET_GROUPS.length) | 0];
        it.presetA = grp[(this.rng() * grp.length) | 0];
        it.presetB = interp ? grp[(this.rng() * grp.length) | 0] : it.presetA;
        it.mix = interp ? this.rng() : 0;
      }
      it.soft = false;
    } else if (kind === 'cloud') {
      it.useSprite = this._cloudTex.length > 0;
      if (it.useSprite) {
        it.spTexIndex = (this.rng() * this._cloudTex.length) | 0;
      } else {
        it.presetA = (this.rng() * CLOUD_PRESETS.length) | 0;
        it.presetB = interp ? (this.rng() * CLOUD_PRESETS.length) | 0 : it.presetA;
        it.mix = interp ? this.rng() : 0;
      }
      it.soft = false;
    } else if (kind === 'grass') {
      // 海藻(揺れる方)。CORAL_SHAPES の後半(soft)だけを使う独立レイヤー。
      const softCount = CORAL_SHAPES.length - SOFT_CORAL_FROM;
      it.kindIndex = SOFT_CORAL_FROM + ((this.rng() * softCount) | 0);
      it.soft = true;
      it.useSprite = this._grassTex.length > 0 && this.rng() < (this.def.spriteChance ?? 0);
      if (it.useSprite) it.spTexIndex = (this.rng() * this._grassTex.length) | 0;
    } else {
      // 珊瑚(硬い塊)。CORAL_SHAPES の前半だけを使う独立レイヤー。
      it.kindIndex = (this.rng() * SOFT_CORAL_FROM) | 0;
      it.soft = false;
      it.useSprite = this._coralTex.length > 0 && this.rng() < (this.def.spriteChance ?? 0);
      if (it.useSprite) it.spTexIndex = (this.rng() * this._coralTex.length) | 0;
    }
  }

  _bandY() {
    if (this.def.kind === 'island') return this._waterLineY + randRange(this.rng, -5, 8);
    const [a, b] = this.def.yBandRatio;
    return this._h * randRange(this.rng, a, b);
  }

  _tonesFor(it) {
    const j = it.jitter;
    const hz = this._hazeColor;
    const amt = this._hazeAmount;
    const resolve = (c, jj) => {
      let v = jitterBrightness(c, jj);
      if (amt > 0 && hz != null) v = lerpColor(v, hz, amt);
      return v;
    };
    let mid = resolve(this._tones.mid, j);
    let dark = resolve(this._tones.dark, j);
    let rim = resolve(this._tones.rim, j * 0.5);

    // 珊瑚/海藻: 水面から深いほど周りの生き物(魚/サメ等)と同じ depthTint へ暗く寄せる(#周りと合わせる)
    const kind = this.def.kind;
    if ((kind === 'coral' || kind === 'grass') && this.def.depthTint) {
      const belowPx = Math.max(0, it.baseY - this._waterLineY);
      const range = this._h * (this.def.depthFadeRangeRatio ?? 0.3);
      const dK = clamp(belowPx / range, 0, 1) * (this.def.depthTintStrength ?? 0.3);
      mid = lerpColor(mid, this.def.depthTint, dK);
      dark = lerpColor(dark, this.def.depthTint, dK);
      rim = lerpColor(rim, this.def.depthTint, dK);
    }

    return { mid, dark, rim, haze: this._tones.haze };
  }

  _drawShape(it) {
    const size = this._h * (this.def.sizeRatio ?? 0.12) * it.scale;
    const tones = this._tonesFor(it);
    const kind = this.def.kind;

    const isReef = kind === 'coral' || kind === 'grass';
    // 珊瑚/海藻は水面より絶対に上へ出ないよう、高さの上限を接地点(baseY)と水面の距離で縛る
    const reefMaxH = isReef
      ? Math.max(4, it.baseY - this._waterLineY - (this.def.waterMarginPx ?? 6))
      : Infinity;

    if (it.useSprite && it.sp && (kind === 'island' || kind === 'cloud' || isReef)) {
      it.g.visible = false;
      it.g.clear();
      const bank = kind === 'cloud' ? this._cloudTex
        : kind === 'grass' ? this._grassTex
          : kind === 'coral' ? this._coralTex
            : this._islandTex;
      const tex = bank[it.spTexIndex] ?? bank[0];
      if (it.sp.texture !== tex) it.sp.texture = tex;
      const ratio = kind === 'cloud'
        // sizeRatio ~ 雲の高さ比。スプライトは横長なので係数で高さ換算(見た目が大きすぎたので1/3に)
        ? (this.def.sizeRatio ?? 0.14) * (this.def.cloudSpriteScale ?? 1.13)
        : isReef
          ? (this.def.coralSpriteHeightRatio ?? 0.17)
          : (this.def.spriteHeightRatio ?? 0.24);
      let targetH = this._h * ratio * it.scale;
      if (isReef) targetH = Math.min(targetH, reefMaxH);
      it.spScale = targetH / (tex.height || 1);
      it.sp.scale.set(it.spScale * it.flip, it.spScale);
      // 雲は絵の地色が暖色なので、乗算tintを弱く(0.65)かけるだけだと夜でも色が寒色に転びにくい。
      // strength を上げて tones.mid(夜=紺)をそのまま強く乗算し、朝夕昼夜でちゃんと色相が変わるようにする。
      // 海藻(grass)は珊瑚のピンクパレットへ強く寄せると緑が消えてしまうので弱めにかける。
      const tintStrength = kind === 'cloud' ? (this.def.spriteTintStrength ?? 0.88)
        : kind === 'grass' ? (this.def.grassSpriteTintStrength ?? 0.35)
          : (this.def.spriteTintStrength ?? 0.85);
      it.sp.tint = lerpColor(0xffffff, tones.mid, tintStrength);
      it.sp.alpha = this.def.alpha ?? 1;
      it.sp.visible = true;
      return;
    }
    if (it.sp) it.sp.visible = false;

    const g = it.g;
    g.visible = true;
    g.clear();
    if (kind === 'island') {
      drawIslandPreset(g, tones, size, ISLAND_PRESETS[it.presetA], ISLAND_PRESETS[it.presetB], it.mix);
    } else if (kind === 'cloud') {
      drawCloudPreset(g, tones, size, CLOUD_PRESETS[it.presetA], CLOUD_PRESETS[it.presetB], it.mix, this.def.alpha ?? 0.9, this._sunDir ?? -1);
    } else if (isReef) {
      const sz = Math.min(size, reefMaxH);
      CORAL_SHAPES[it.kindIndex % CORAL_SHAPES.length](g, tones, sz);
    }
  }

  _respawn(it, toRight) {
    if (toRight) {
      let maxX = -Infinity;
      for (const o of this.items) if (o.itemX > maxX) maxX = o.itemX;
      it.itemX = maxX + this._nextGap();
    }
    it.baseY = this._bandY();
    it.scale = randRangePair(this.rng, this.def.scaleRange);
    it.flip = this.rng() < 0.5 ? -1 : 1;
    it.phase = this.rng() * TAU;
    it.jitter = randRange(this.rng, -1, 1) * (this.def.colorJitter ?? 0);
    it.rot = (this.def.kind === 'coral' || this.def.kind === 'grass')
      ? randRange(this.rng, -1, 1) * (this.def.rotJitterRad ?? 0.09) : 0;
    it.swayPeriod = this.def.softCoralSwayPeriodSec ? randRangePair(this.rng, this.def.softCoralSwayPeriodSec) : 0;
    it.bobPeriod = this.def.bobPeriodSec ? randRangePair(this.rng, this.def.bobPeriodSec) : 0;
    this._pickShape(it);
    // スプライトの島影は横長なので、右側で流れてくる時だけ手前に余白を足す
    if (it.useSprite && toRight) it.itemX += this._spanX * (this.def.spriteExtraGapRatio ?? 0.6);
    if (this._tones) this._drawShape(it);
    it.g.alpha = this.def.kind === 'cloud' ? 1 : (this.def.alpha ?? 1);
  }

  /**
   * @param {number} worldX
   * @param {number} worldY
   * @param {{mid,dark,rim,haze?}} tones  時間帯パレットで解決済み
   * @param {number} dt
   */
  update(worldX, worldY, tones, dt, hazeColor, sunX) {
    this._t += dt;
    this._tones = tones;
    this._hazeColor = hazeColor ?? null;
    // 太陽の水平位置(0..1)→ 雲のリムライトを寄せる向き(-1 左 / +1 右)
    const sunDir = sunX == null ? this._sunDir ?? -1 : (sunX < 0.5 ? -1 : 1);
    const key = ((tones.mid * 131 + (this._hazeColor ?? 0)) >>> 0) ^ (sunDir < 0 ? 0 : 0x40000000);
    if (key !== this._lastKey || sunDir !== this._sunDir) {
      this._sunDir = sunDir;
      this._lastKey = key;
      for (const it of this.items) this._drawShape(it);
    }
    this._sunDir = sunDir;

    const d = this.def.depth;
    const scrollX = worldX * d;
    const scrollY = worldY * d;
    const leftEdge = -this._w * 0.65;

    for (const it of this.items) {
      let screenX = it.itemX - scrollX;
      if (screenX < leftEdge) {
        this._respawn(it, true);
        screenX = it.itemX - scrollX;
      }

      if (it.useSprite && it.sp) {
        let sy = it.baseY - scrollY;
        if (this.def.kind === 'cloud' && it.bobPeriod) {
          sy += Math.sin(this._t * (TAU / it.bobPeriod) + it.phase) * (this.def.bobAmplitudePx ?? 0);
        }
        it.sp.position.set(screenX, sy);
        it.sp.scale.x = it.spScale * it.flip;
        if (this.def.kind === 'grass' && it.swayPeriod) {
          // 海藻スプライトも手続きのソフトコーラルと同じく左右にそよぐ(根元を軸に)
          it.sp.rotation = Math.sin(this._t * (TAU / it.swayPeriod) + it.phase) * (this.def.softCoralSwayAmpRad ?? 0);
        }
        continue;
      }

      const g = it.g;
      g.position.x = screenX;
      g.position.y = it.baseY - scrollY;
      g.scale.x = it.flip;

      if (it.soft && it.swayPeriod) {
        g.rotation = it.rot + Math.sin(this._t * (TAU / it.swayPeriod) + it.phase) * (this.def.softCoralSwayAmpRad ?? 0);
      } else {
        g.rotation = it.rot;
      }
      if (this.def.kind === 'cloud' && it.bobPeriod) {
        g.position.y += Math.sin(this._t * (TAU / it.bobPeriod) + it.phase) * (this.def.bobAmplitudePx ?? 0);
      }
    }
  }
}
