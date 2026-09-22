import { Sprite, Texture } from 'pixi.js';
import { clamp } from '../systems/mathUtils.js';
import { toHexNumber } from '../systems/colorUtils.js';

/**
 * DiveOverlay
 * -----------
 * 「軽い潜り」の演出。専用の水中背景は作らず、既存レイヤーの上に
 * 薄い青のティントを1枚重ねるだけ。
 *
 *  submersion(0〜1): 水面ラインからどれだけ潜っているか。
 *    scene 側が亀のYと waterLineRatio から算出して渡す。
 *
 *  submersion に応じて:
 *    - 青ティントの alpha
 *    - 泡の発生レート(scene が this.bubbleRate を読む)
 *    - 太陽/月のフェード係数(scene が this.celestialDim を読む)
 */
export class DiveOverlay {
  constructor(config) {
    this.config = config;
    this.sprite = new Sprite(Texture.WHITE);
    this.sprite.tint = toHexNumber(config.tintColor);
    this.sprite.alpha = 0;
    this.sprite.eventMode = 'none';

    this.submersion = 0;
    this.bubbleRate = 0;
    this.celestialDim = 1;
  }

  resize(width, height) {
    this.sprite.width = width;
    this.sprite.height = height;
  }

  update(submersion) {
    this.submersion = clamp(submersion, 0, 1);
    this.sprite.alpha = this.submersion * this.config.tintMaxAlpha;
    this.bubbleRate = this.submersion * this.config.bubbleRatePerSec;
    this.celestialDim = this.config.celestialFadeByDepth ? 1 - this.submersion * 0.85 : 1;
  }
}
