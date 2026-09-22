import { Container, Sprite } from 'pixi.js';
import { mulberry32, randRange, randRangePair, atmosphereAmount } from '../systems/mathUtils.js';
import { lerpColor } from '../systems/colorUtils.js';

/**
 * SpriteDecorLayer
 * ----------------
 * DecorLayer と同じ「プール + パララックススクロール + 折り返し」の仕組みで、
 * ただし形は Midjourney 生成のスプライトを使う静止装飾。
 *
 *  - カニ / ロブスター … 海底に静止(anchorY=1、画面下寄り)
 *  - フラダンサー / トーテム … 水平線の砂浜に静止(島影の depth 帯)
 *
 * 右から左へ、ワールドスクロールに乗って流れる。夜は nightTint で沈ませる。
 */
export class SpriteDecorLayer {
  constructor(def, rngSeed, textures) {
    this.def = def;
    this.container = new Container();
    this.rng = mulberry32(rngSeed);
    this._keys = def.textureKeys ?? [];
    this._tex = this._keys.map((k) => textures[k]).filter(Boolean);

    this.items = [];
    for (let i = 0; i < (def.poolSize ?? 3); i++) {
      const sp = new Sprite();
      sp.anchor.set(0.5, def.anchorY ?? 1);
      sp.visible = false;
      this.container.addChild(sp);
      this.items.push({ sp, itemX: 0, baseY: 0, scale: 1, flip: 1 });
    }
    this._w = 0;
    this._h = 0;
    this._span = 1;
  }

  resize(width, height, waterLineY) {
    this._w = width;
    this._h = height;
    this._waterLineY = waterLineY ?? height * 0.62;
    this._span = width * (this.def.spacingRatio ?? 1.5);
    let x = -width * 0.4;
    for (const it of this.items) {
      it.itemX = x;
      this._place(it);
      x += this._gap();
    }
  }

  _gap() {
    const j = this.def.spacingJitter ?? 0.5;
    return this._span * randRange(this.rng, 1 - j, 1 + j);
  }

  _bandY() {
    if (this.def.onWaterLine) return this._waterLineY + randRange(this.rng, -3, 4);
    const [a, b] = this.def.yBandRatio;
    return this._h * randRange(this.rng, a, b);
  }

  _place(it) {
    if (!this._tex.length) return;
    const tex = this._tex[(this.rng() * this._tex.length) | 0];
    it.sp.texture = tex;
    it.scale = randRangePair(this.rng, this.def.scaleRange ?? [0.9, 1.1]);
    const s = ((this.def.heightRatio ?? 0.1) * this._h * it.scale) / (tex.height || 1);
    it.flip = this.def.flip && this.rng() < 0.5 ? -1 : 1;
    it.sp.scale.set(s * it.flip, s);
    it.baseY = this._bandY();
    it.sp.visible = true;
  }

  update(worldX, tod, dt) {
    void dt;
    const scroll = worldX * this.def.depth;
    const left = -this._w * 0.55;
    const hazeAmt = this.def.hazeAmount ?? atmosphereAmount(this.def.depth);
    let tintCol = hazeAmt > 0 ? lerpColor(0xffffff, tod.color('skyHorizon'), hazeAmt) : 0xffffff;
    if (this.def.nightTint) {
      tintCol = lerpColor(tintCol, this.def.nightTint, (tod.nightness ?? 0) * 0.7);
    }
    // 海中に居る生き物(カニ/ロブスター等)を一定の強さで少し暗く沈める(#亀/サメと足並みを揃える)
    if (this.def.depthTint) {
      tintCol = lerpColor(tintCol, this.def.depthTint, this.def.depthTintStrength ?? 0.25);
    }
    const applyTint = this.def.nightTint || hazeAmt > 0 || this.def.depthTint;

    for (const it of this.items) {
      let sx = it.itemX - scroll;
      if (sx < left) {
        let maxX = -Infinity;
        for (const o of this.items) if (o.itemX > maxX) maxX = o.itemX;
        it.itemX = maxX + this._gap();
        this._place(it);
        sx = it.itemX - scroll;
      }
      it.sp.position.set(sx, it.baseY);
      if (applyTint) it.sp.tint = tintCol;
    }
  }
}
