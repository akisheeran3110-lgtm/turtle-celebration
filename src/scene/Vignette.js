import { Sprite, Texture } from 'pixi.js';
import { toHexNumber, lerpColor } from '../systems/colorUtils.js';
import { clamp } from '../systems/mathUtils.js';

/**
 * Vignette
 * --------
 * 画面端をやわらかく減光する固定オーバーレイ。
 * テクスチャは白の放射状グラデ(中心=透明 → 端=不透明)を1回だけ焼き、
 * 色は tint、濃さは alpha で動的に変える。
 *
 * 潜水中は setDive(submersion) で不透明度を上げ、色を濃い青へ寄せる
 * (水圧・深さの感覚)。
 */
export class Vignette {
  constructor(cfg = {}) {
    this.enabled = cfg.enabled !== false;
    this.baseColor = toHexNumber(cfg.color ?? 0x05131f);
    this.baseStrength = cfg.strength ?? 0.45;
    this.diveColor = toHexNumber(cfg.diveColor ?? 0x0a1230);
    this.diveStrength = cfg.diveStrength ?? 0.72;

    this.sprite = new Sprite(
      Vignette._buildTexture(cfg.innerRadiusRatio ?? 0.55, cfg.outerRadiusRatio ?? 1.0),
    );
    this.sprite.visible = this.enabled;
    this.sprite.eventMode = 'none';
    this.sprite.tint = this.baseColor;
    this.sprite.alpha = this.baseStrength;
    this._dive = 0;
  }

  /** @param {number} submersion 0〜1 */
  setDive(submersion) {
    const k = clamp(submersion, 0, 1);
    if (k === this._dive) return;
    this._dive = k;
    this.sprite.tint = lerpColor(this.baseColor, this.diveColor, k);
    this.sprite.alpha = this.baseStrength + (this.diveStrength - this.baseStrength) * k;
  }

  resize(width, height) {
    this.sprite.width = width;
    this.sprite.height = height;
  }

  static _buildTexture(inner, outer) {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, half * inner, half, half, half * outer);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(canvas);
  }
}
