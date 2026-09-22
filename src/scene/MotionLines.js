import { Graphics } from 'pixi.js';
import { clamp } from '../systems/mathUtils.js';
import { toHexNumber } from '../systems/colorUtils.js';

/**
 * MotionLines
 * -----------
 * ホールドで上昇している間、亀の後方に 2〜3 本の軽いモーションライン(速度線)を出す。
 * 上昇速度が大きいほど濃く・長く。下降中や漂っている間は出さない。
 *
 * container は亀のすぐ奥(worldContainer)に置く。
 */
export class MotionLines {
  constructor(cfg = {}) {
    this.g = new Graphics();
    this.g.eventMode = 'none';
    this.count = cfg.count ?? 3;
    this.thresholdPxPerSec = cfg.thresholdPxPerSec ?? 40;
    this.maxRefPxPerSec = cfg.maxRefPxPerSec ?? 200;
    this.baseLenPx = cfg.baseLenPx ?? 26;
    this.maxAlpha = cfg.maxAlpha ?? 0.5;
    this.color = cfg.color != null ? toHexNumber(cfg.color) : 0xffffff;
    this._t = 0;
  }

  /**
   * @param {number} dt
   * @param {{x:number, y:number, vy:number, holding:boolean, sizePx:number}} s
   */
  update(dt, s) {
    this._t += dt;
    const g = this.g;
    g.clear();

    const rising = -s.vy; // 上昇 = 正
    if (!s.holding || rising < this.thresholdPxPerSec) return;

    const k = clamp(
      (rising - this.thresholdPxPerSec) / (this.maxRefPxPerSec - this.thresholdPxPerSec),
      0,
      1,
    );
    const alpha = this.maxAlpha * (0.5 + 0.5 * k);
    const len = this.baseLenPx * (0.85 + 0.9 * k) * (s.sizePx / 220);
    const half = s.sizePx * 0.16;
    const w = Math.max(2, s.sizePx * 0.016);

    for (let i = 0; i < this.count; i++) {
      const f = this.count === 1 ? 0 : i / (this.count - 1) - 0.5; // -0.5..0.5
      const wob = Math.sin(this._t * 18 + i * 2.1) * 2.5;
      // 亀の後方(左)やや下から、後方・下へ尾を引く
      const nx = s.x - half - Math.abs(f) * s.sizePx * 0.08;
      const ny = s.y + f * s.sizePx * 0.26 + wob + s.sizePx * 0.04;
      const ex = nx - len;
      const ey = ny + len * 0.42;
      const a = alpha * (1 - Math.abs(f) * 0.25);
      // 近い端が濃く、後端でフェード(2セグメントで擬似グラデ)
      g.moveTo(nx, ny);
      g.lineTo((nx + ex) / 2, (ny + ey) / 2);
      g.stroke({ color: this.color, alpha: a, width: w, cap: 'round' });
      g.moveTo((nx + ex) / 2, (ny + ey) / 2);
      g.lineTo(ex, ey);
      g.stroke({ color: this.color, alpha: a * 0.4, width: w * 0.8, cap: 'round' });
    }
  }
}
