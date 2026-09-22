import { Container, Sprite, Graphics, Texture } from 'pixi.js';
import { mulberry32, randRange, clamp, TAU } from './mathUtils.js';
import { toHexNumber } from './colorUtils.js';

let ORB_GLOW = null;
function orbGlowTexture() {
  if (ORB_GLOW) return ORB_GLOW;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ORB_GLOW = Texture.from(canvas);
  return ORB_GLOW;
}

/**
 * OrbField
 * --------
 * アンビエントな光のオーブ。**右から左へ** ゆっくり横切る。
 *  - 亀が collectRadiusPx 以内に入ると自動収集(タップ不要)。
 *  - 収集時: 光のバースト(リング + 粒)+ onCollect(夜空へ星を蓄積)。
 *  - スコア表示はしない。スクリーン座標で動く。
 */
export class OrbField {
  constructor(config, onCollect) {
    this.config = config;
    this.onCollect = onCollect;
    this.container = new Container();
    this.burstContainer = new Container();
    this.container.addChild(this.burstContainer);
    this.rng = mulberry32(97531);

    this.orbs = [];
    this._free = [];
    this.bursts = [];
    this._burstFree = [];
    this._spawnAcc = 0;
    this._w = 0;
    this._h = 0;
    this._t = 0;
    this._blink = 0; // 音楽の高域振幅の偏差(明滅の振れ幅に加算)
    this._rCScale = 1; // 水面スキム中の収集半径スケール(#13)
    this._chainLevel = 0; // オーブチェイン(#13): 連続収集で増える。数値表示なし
    this._chainTimer = 0;
  }

  /** 音楽の高域振幅の偏差(概ね -0.3〜0.3)。オーブの明滅に効かせる。 */
  setAudioBlink(dev) {
    this._blink = clamp(dev || 0, -0.22, 0.22);
  }

  /** 水面スキム・ボーナス(#13): 収集半径の倍率(1 = 通常)。 */
  setCollectRadiusScale(k) {
    this._rCScale = k || 1;
  }

  get chainLevel() {
    return this._chainLevel;
  }

  resize(w, h) {
    this._w = w;
    this._h = h;
  }

  _acquire() {
    let o = this._free.pop();
    if (o) {
      o.wrap.visible = true;
      return o;
    }
    const wrap = new Container();
    const glow = new Sprite(orbGlowTexture());
    glow.anchor.set(0.5);
    glow.width = glow.height = this.config.glowRadiusPx * 2;
    glow.tint = toHexNumber(this.config.color);
    const core = new Graphics();
    core.circle(0, 0, this.config.coreRadiusPx).fill({ color: 0xffffff, alpha: 0.95 });
    wrap.addChild(glow, core);
    this.container.addChild(wrap);
    return { wrap, glow, core, x: 0, y: 0, vx: 0, seed: 0, collected: false, t: 0 };
  }

  _spawn() {
    if (this.orbs.length >= this.config.maxAlive) return;
    const o = this._acquire();
    const speed = this._w * this.config.driftSpeedRatioPerSec;
    o.vx = -speed * randRange(this.rng, 0.7, 1.3); // 常に左へ
    o.x = this._w + 40;
    // 上下に散らす。lowBiasChance の割合で下寄り(水面付近〜潜水域)に置き、潜る動機付けにする。
    const [a, b] = this.config.yBandRatio;
    const low = this.config.lowBiasBandRatio ?? [0.56, 0.92];
    if (this.rng() < (this.config.lowBiasChance ?? 0.4)) {
      o.y = this._h * randRange(this.rng, low[0], low[1]);
    } else {
      o.y = this._h * randRange(this.rng, a, b);
    }
    o.baseY = o.y;
    o.seed = this.rng() * TAU;
    o.collected = false;
    o.t = 0;
    o.wrap.alpha = 0;
    o.wrap.scale.set(1);
    o.wrap.position.set(o.x, o.y);
    this.orbs.push(o);
  }

  /** 外部から光のバーストを起こす(ブーケ段階アップ演出など)。 */
  burstAt(x, y) {
    this._burst(x, y);
  }

  _burst(x, y) {
    const color = toHexNumber(this.config.color);
    const mk = () => {
      let b = this._burstFree.pop();
      if (!b) {
        b = { g: new Graphics(), kind: '', x: 0, y: 0, vx: 0, vy: 0, r: 0, life: 0, maxLife: 0 };
        this.burstContainer.addChild(b.g);
      }
      b.g.visible = true;
      return b;
    };
    const ring = mk();
    ring.kind = 'ring';
    ring.x = x; ring.y = y; ring.r = 4; ring.vx = 150;
    ring.life = ring.maxLife = 0.5;
    ring.color = color;
    this.bursts.push(ring);
    for (let i = 0; i < 7; i++) {
      const p = mk();
      const ang = (i / 7) * TAU + randRange(this.rng, -0.3, 0.3);
      const spd = randRange(this.rng, 70, 160);
      p.kind = 'dot';
      p.x = x; p.y = y;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.r = randRange(this.rng, 1.4, 3);
      p.life = p.maxLife = randRange(this.rng, 0.35, 0.7);
      p.color = color;
      this.bursts.push(p);
    }
  }

  update(dt, turtleX, turtleY) {
    this._t += dt;
    this._spawnAcc += dt * this.config.spawnRatePerSecond;
    while (this._spawnAcc >= 1) {
      this._spawnAcc -= 1;
      this._spawn();
    }

    if (this._chainTimer > 0) {
      this._chainTimer -= dt;
      if (this._chainTimer <= 0) this._chainLevel = 0;
    }

    const rC = this.config.collectRadiusPx * this._rCScale;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.t += dt;

      if (o.collected) {
        o.wrap.alpha -= dt * 4;
        o.wrap.scale.set(o.wrap.scale.x + dt * 3);
        if (o.wrap.alpha <= 0) {
          o.wrap.visible = false;
          o.wrap.scale.set(1);
          this._free.push(o);
          this.orbs.splice(i, 1);
        }
        continue;
      }

      o.x += o.vx * dt;
      o.y = o.baseY + Math.sin(o.seed + o.t * 0.8) * 14;
      o.wrap.position.set(o.x, o.y);
      o.wrap.alpha = clamp(Math.min(o.t * 1.5, 1), 0, 1)
        * clamp(0.75 + (0.25 + this._blink) * Math.sin(o.seed + o.t * 2), 0.2, 1.25);

      const dx = o.x - turtleX;
      const dy = o.y - turtleY;
      if (dx * dx + dy * dy <= rC * rC) {
        o.collected = true;
        this._burst(o.x, o.y);
        this._chainLevel = Math.min(this._chainLevel + 1, this.config.chainMax ?? 5);
        this._chainTimer = this.config.chainWindowSec ?? 1.7;
        if (this.onCollect) this.onCollect(this._chainLevel - 1); // semis(0 = チェイン最初)
        continue;
      }

      if (o.x < -60) {
        o.wrap.visible = false;
        this._free.push(o);
        this.orbs.splice(i, 1);
      }
    }

    // バースト更新
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      const lt = Math.max(0, b.life / b.maxLife);
      if (b.life <= 0) {
        b.g.visible = false;
        b.g.clear();
        this._burstFree.push(b);
        this.bursts.splice(i, 1);
        continue;
      }
      b.g.clear();
      if (b.kind === 'ring') {
        b.r += b.vx * dt;
        b.g.circle(0, 0, b.r).stroke({ color: b.color, alpha: 0.85 * lt, width: 2 });
      } else {
        b.vx *= Math.pow(0.02, dt);
        b.vy *= Math.pow(0.02, dt);
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.g.circle(0, 0, b.r).fill({ color: b.color, alpha: lt });
      }
      b.g.position.set(b.x, b.y);
    }
  }

  get aliveCount() {
    return this.orbs.length;
  }
}
