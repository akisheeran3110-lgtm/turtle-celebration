import { Sprite, Texture } from 'pixi.js';
import { clamp } from '../systems/mathUtils.js';

/**
 * GrainOverlay
 * ------------
 * 画面全体に薄いフィルムグレイン(ノイズ)を1枚。フラットな塗りに質感を足す。
 *
 * ノイズは **起動時に1回だけ** 生成した固定テクスチャ。毎フレーム位置を
 * 動かすと砂嵐のようにチラつくため、位置も固定(update は何もしない)。
 */
export class GrainOverlay {
  constructor(cfg) {
    this.cfg = cfg;
    this.sprite = new Sprite(GrainOverlay._noiseTexture());
    this.sprite.alpha = clamp(cfg.alpha ?? 0.055, 0, 1);
    this.sprite.eventMode = 'none';
    this.sprite.position.set(0, 0);
    try {
      this.sprite.blendMode = cfg.blend ?? 'overlay';
    } catch {
      /* 未対応環境では通常合成のまま */
    }
  }

  resize(width, height) {
    this.sprite.width = width;
    this.sprite.height = height;
  }

  update() {
    /* 固定グレイン: 何もしない */
  }

  static _noiseTexture() {
    if (GrainOverlay._tex) return GrainOverlay._tex;
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 96 + Math.random() * 64;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = Texture.from(canvas);
    if (tex.source) tex.source.scaleMode = 'nearest';
    GrainOverlay._tex = tex;
    return tex;
  }
}
