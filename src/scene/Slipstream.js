import { Container, Graphics } from 'pixi.js';
import { mulberry32, randRange, randRangePair, clamp } from '../systems/mathUtils.js';

/**
 * Slipstream (#13 上昇気流)
 * ------------------------
 * 光の粒が立ちのぼる縦の柱。中を通ると上向きのゆるいリフト(this.updraftInside)。
 * 気持ちよさのための上達要素で、失敗要素ではない。
 *
 * (以前は横長の帯 = "flow"(前進加速)もあったが、亀は横位置固定・上下操作のみで
 *  横方向の手応えに繋がらず地味だったため撤去。上下操作とかみ合う updraft だけに絞った。)
 */
export class Slipstream {
  constructor(cfg, rngSeed) {
    this.cfg = cfg ?? {};
    this.enabled = this.cfg.enabled !== false;
    this.depth = this.cfg.depth ?? 0.82;
    this.container = new Container();
    this.container.eventMode = 'none';
    this.rng = mulberry32(rngSeed ?? 24680);

    this.streams = [];
    const n = this.cfg.streakCount ?? 16;
    for (let i = 0; i < (this.cfg.poolSize ?? 3); i++) {
      const wrap = new Container();
      wrap.visible = false;
      const streaks = [];
      for (let s = 0; s < n; s++) {
        const g = new Graphics();
        wrap.addChild(g);
        streaks.push({ g, fx: 0, fy: 0, len: 0, w: 0, seed: 0 });
      }
      this.container.addChild(wrap);
      this.streams.push({ wrap, streaks, active: false, worldX0: 0, len: 0, yc: 0, colW: 0, colH: 0, t: 0 });
    }

    this._w = 0;
    this._h = 0;
    this._timer = randRangePair(this.rng, this.cfg.firstSpawnSec ?? [8, 18]);
    this.updraftInside = 0; // updraft 柱の内側度合い 0..1
  }

  resize(w, h) {
    this._w = w;
    this._h = h;
  }

  _spawn(worldX) {
    const st = this.streams.find((s) => !s.active);
    if (!st) return;
    st.t = 0;
    st.active = true;
    st.wrap.visible = true;

    st.colW = this._h * (this.cfg.updraftColWidthRatio ?? 0.085);
    st.colH = this._h * (this.cfg.updraftColHeightRatio ?? 0.52);
    st.yc = this._h * randRange(this.rng, 0.28, 0.6);
    st.len = st.colW * 2;
    st.worldX0 = worldX * this.depth + this._w * 1.12 + st.len;
    for (const k of st.streaks) {
      k.seed = this.rng() * 1000;
      k.fx = randRange(this.rng, -1, 1);
      k.fy = this.rng();
      k.len = randRange(this.rng, 10, 26);
      k.w = randRange(this.rng, 1.4, 3);
      k.g.clear();
      k.g.roundRect(-k.w / 2, -k.len / 2, k.w, k.len, k.w / 2).fill({ color: 0xe8f2ff, alpha: 0.5 });
    }
  }

  /**
   * @returns {number} 亀が updraft 柱の内側にいる度合い 0..1
   */
  update(worldX, dt, turtleX, turtleY) {
    this.updraftInside = 0;
    if (!this.enabled || !this._h) return 0;

    this._timer -= dt;
    if (this._timer <= 0) {
      this._spawn(worldX);
      this._timer = randRangePair(this.rng, this.cfg.spawnEverySec ?? [24, 46]);
    }

    for (const st of this.streams) {
      if (!st.active) continue;
      st.t += dt;
      const headX = st.worldX0 - worldX * this.depth;
      if (headX < -this._w * 0.3) {
        st.active = false;
        st.wrap.visible = false;
        continue;
      }

      const cx = headX - st.colW; // 柱の中心
      const rise = st.t * this._h * 0.4;
      for (const k of st.streaks) {
        const lx = cx + k.fx * st.colW;
        const ly = st.yc + st.colH * 0.5 - ((k.fy * st.colH + rise) % st.colH);
        k.g.position.set(lx, ly);
        const efade = clamp(Math.min(cx + this._w * 0.12, this._w * 1.05 - cx) / (this._w * 0.14), 0, 1);
        const vfade = clamp(1 - Math.abs((ly - st.yc) / (st.colH * 0.5)), 0, 1);
        k.g.alpha = 0.5 * efade * vfade;
      }
      if (Math.abs(turtleX - cx) < st.colW && Math.abs(turtleY - st.yc) < st.colH * 0.5) {
        this.updraftInside = Math.max(
          this.updraftInside,
          clamp(1 - Math.abs(turtleX - cx) / st.colW, 0, 1),
        );
      }
    }
    return this.updraftInside;
  }
}
