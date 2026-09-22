import { Container, Graphics } from 'pixi.js';
import { clamp, randRange, randRangePair, TAU } from './mathUtils.js';
import { toHexNumber } from './colorUtils.js';

/**
 * ParticlePool
 * ------------
 * 泡・水しぶき・航跡・花びらをまとめて扱う、上限付きのプール。
 *
 *  - Graphics を使い回す(生成しっぱなしにしない = 長時間セッション対策)。
 *  - 上限は種類ごとに個別(config.particles.caps)。加えて全体の安全上限 globalCap。
 *    超過時はその種類の最古を再利用。
 *  - kind ごとに簡単な物理(上昇・重力・横揺れ・落下)を持つ。
 *
 * 座標は「ワールド」ではなく、呼び出し側が渡したコンテナ内のローカル座標。
 * このプールの container は worldContainer に載る想定なので、
 * スクロールは親側で処理される。
 */
export class ParticlePool {
  constructor(config, rng) {
    this.config = config;
    this.rng = rng;
    this.container = new Container();
    this.caps = config.caps ?? {};
    this.globalCap = config.globalCap ?? 80;

    /** @type {Particle[]} */
    this.active = [];
    /** @type {Graphics[]} */
    this._free = [];
  }

  _acquire() {
    let g = this._free.pop();
    if (!g) {
      g = new Graphics();
      this.container.addChild(g);
    }
    g.visible = true;
    return g;
  }

  _release(p) {
    p.g.visible = false;
    p.g.clear();
    this._free.push(p.g);
  }

  _makeRoom(kind) {
    const cap = this.caps[kind] ?? this.globalCap;
    let count = 0;
    for (const p of this.active) if (p.kind === kind) count++;
    if (count >= cap) {
      const i = this.active.findIndex((p) => p.kind === kind);
      if (i >= 0) this._release(this.active.splice(i, 1)[0]);
    }
    if (this.active.length >= this.globalCap) {
      const old = this.active.shift();
      if (old) this._release(old);
    }
  }

  /** 泡: ゆっくり上昇しながら横に揺れる */
  spawnBubble(x, y) {
    const c = this.config.bubble;
    this._makeRoom('bubble');
    const p = new Particle(this._acquire(), 'bubble');
    p.x = x;
    p.y = y;
    p.vy = -randRangePair(this.rng, c.riseSpeedPx);
    p.radius = randRangePair(this.rng, c.radiusPx);
    p.maxLife = p.life = randRangePair(this.rng, c.lifeSec);
    p.color = toHexNumber(c.color);
    p.baseAlpha = c.alpha;
    p.wobble = c.wobblePx;
    p.seed = this.rng() * TAU;
    this.active.push(p);
    return p;
  }

  /** 水しぶき: 上外向きに飛んで重力で落ちる。1回で数粒。 */
  spawnSplash(x, y) {
    const c = this.config.splash;
    const n = Math.round(randRangePair(this.rng, c.count));
    for (let i = 0; i < n; i++) {
      this._makeRoom('splash');
      const p = new Particle(this._acquire(), 'splash');
      const ang = -Math.PI / 2 + randRange(this.rng, -0.9, 0.9);
      const spd = randRangePair(this.rng, c.speedPx);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.gravity = c.gravityPx;
      p.radius = randRangePair(this.rng, c.radiusPx);
      p.maxLife = p.life = randRangePair(this.rng, c.lifeSec);
      p.color = toHexNumber(c.color);
      p.baseAlpha = 0.9;
      this.active.push(p);
    }
  }

  /** 航跡: その場に小さく残ってフェード。lifeScale はオーブチェインで伸ばす用(#13)。 */
  spawnWake(x, y, lifeScale = 1) {
    const c = this.config.wake;
    this._makeRoom('wake');
    const p = new Particle(this._acquire(), 'wake');
    p.x = x;
    p.y = y;
    p.radius = randRangePair(this.rng, c.radiusPx);
    p.maxLife = p.life = randRangePair(this.rng, c.lifeSec) * lifeScale;
    p.color = toHexNumber(c.color);
    p.baseAlpha = c.alpha;
    this.active.push(p);
  }

  /** 花びら: ふわふわ落ちながら左右に流れる */
  spawnPetals(x, y, count) {
    const c = this.config.petal;
    const n = count ?? Math.round(randRangePair(this.rng, c.count));
    for (let i = 0; i < n; i++) {
      this._makeRoom('petal');
      const p = new Particle(this._acquire(), 'petal');
      p.x = x + randRange(this.rng, -40, 40);
      p.y = y + randRange(this.rng, -20, 20);
      p.vy = randRangePair(this.rng, c.fallSpeedPx);
      p.vx = randRange(this.rng, -20, 20);
      p.radius = randRangePair(this.rng, c.radiusPx);
      p.maxLife = p.life = randRangePair(this.rng, c.lifeSec);
      const cols = c.colors.map(toHexNumber);
      p.color = cols[(this.rng() * cols.length) | 0];
      p.baseAlpha = 0.95;
      p.sway = c.swayPx;
      p.seed = this.rng() * TAU;
      this.active.push(p);
    }
  }

  /**
   * きらめきバースト: 音楽の高音のヒットで海面全幅にパッと散る単発の光の粒(#8)。
   * 常時ある speckle と違い、ヒットの瞬間にだけ生まれてすぐ消える「イベント」として
   * はっきり分かるようにする。
   * @param {number} count
   * @param {number} y      水面ライン付近の基準y
   * @param {number} width  散らす横幅(通常は画面幅)
   */
  spawnGlints(count, y, width) {
    const c = this.config.glint ?? {};
    for (let i = 0; i < count; i++) {
      this._makeRoom('glint');
      const p = new Particle(this._acquire(), 'glint');
      p.x = randRange(this.rng, 0, width);
      p.y = y + randRange(this.rng, -6, 6);
      p.radius = randRangePair(this.rng, c.radiusPx ?? [1.5, 3]);
      p.maxLife = p.life = randRangePair(this.rng, c.lifeSec ?? [0.4, 0.8]);
      p.color = toHexNumber(c.color ?? 0xffffff);
      p.baseAlpha = 1;
      this.active.push(p);
    }
  }

  /**
   * @param {number} dt
   * @param {number} driftX  このフレームのワールド前進量。全パーティクルを後方へ流す。
   */
  update(dt, driftX = 0, driftY = 0) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this._release(p);
        this.active.splice(i, 1);
        continue;
      }
      p.age += dt;
      p.x -= driftX;
      p.y -= driftY;

      switch (p.kind) {
        case 'bubble':
          p.y += p.vy * dt;
          p.x += Math.sin(p.seed + p.age * 3) * p.wobble * dt;
          break;
        case 'splash':
          p.vy += p.gravity * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        case 'wake':
          // 動かない
          break;
        case 'petal':
          p.y += p.vy * dt;
          p.x += (p.vx + Math.sin(p.seed + p.age * 2) * p.sway) * dt;
          break;
      }

      const lifeT = p.life / p.maxLife;
      const fade = p.kind === 'bubble' || p.kind === 'petal' || p.kind === 'glint'
        ? Math.min(1, lifeT * 3) * Math.min(1, (1 - lifeT) * 6 + 0.15)
        : lifeT;

      const g = p.g;
      g.clear();
      g.circle(0, 0, p.radius).fill({ color: p.color, alpha: clamp(p.baseAlpha * fade, 0, 1) });
      g.position.set(p.x, p.y);
    }
  }

  get count() {
    return this.active.length;
  }
}

class Particle {
  constructor(g, kind) {
    this.g = g;
    this.kind = kind;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.gravity = 0;
    this.radius = 2;
    this.life = 1;
    this.maxLife = 1;
    this.age = 0;
    this.color = 0xffffff;
    this.baseAlpha = 1;
    this.wobble = 0;
    this.sway = 0;
    this.seed = 0;
  }
}
