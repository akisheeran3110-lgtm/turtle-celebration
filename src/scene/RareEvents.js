import { Container, Graphics } from 'pixi.js';
import { mulberry32, randRange, clamp } from '../systems/mathUtils.js';

/**
 * RareEvents
 * ----------
 * 1ランに 1〜3 回だけ起きる特別な景色。失敗要素ではなく "毎回少し違う" ための演出。
 *  - whale        : 水平線でクジラがブリーチして水しぶき(海の奥のコンテナ `back`)
 *  - rain         : 通り雨がスクリーンを横切る。くぐると BGM がこもる + 雨脚(最前面 `front`)
 *  - meteors      : 流星群(夜)。SkyLayer に委譲
 *  - shootingStar : 一筋の流れ星(夕〜夜)。SkyLayer に委譲
 *
 * どのイベントが・いつ起きるかは 1ラン開始時に決定的に抽選(this._plan)。
 */
const PHASE_MIN = { whale: 0, rain: 0, meteors: 0.8, shootingStar: 0.5 };

export class RareEvents {
  constructor(cfg, rngSeed, hooks = {}) {
    this.cfg = cfg ?? {};
    this.enabled = this.cfg.enabled !== false;
    this.hooks = hooks; // { meteorShower(n), shootingStar() }
    this.rng = mulberry32(rngSeed ?? 33221);

    this.back = new Container();
    this.front = new Container();
    this.back.eventMode = 'none';
    this.front.eventMode = 'none';
    this.back.visible = false;
    this.front.visible = false;

    this._whaleG = new Graphics();
    this._sprayG = new Graphics();
    this.back.addChild(this._whaleG, this._sprayG);
    this._rainVeil = new Graphics();
    this._rainStreaks = new Graphics();
    this.front.addChild(this._rainVeil, this._rainStreaks);

    this._w = 0;
    this._h = 0;
    this._waterLineY = 0;
    this._plan = this._makePlan();
    this._active = null;
    this._t = 0;
    this.inRain = 0; // 亀が通り雨の中にいる度合い 0..1(BGMこもり用)
  }

  _makePlan() {
    if (!this.enabled) return [];
    const r = this.rng;
    const plan = [
      { at: randRange(r, 0.16, 0.5), type: r() < 0.55 ? 'whale' : 'rain', done: false },
      { at: randRange(r, 0.55, 0.8), type: ['whale', 'rain', 'shootingStar'][(r() * 3) | 0], done: false },
    ];
    if (r() < (this.cfg.meteorChance ?? 0.8)) {
      // 夜が来る頃〜結婚式会場が現れる直前。「空が前ぶれを見せる」演出
      plan.push({ at: randRange(r, 0.8, 0.845), type: 'meteors', done: false });
    }
    return plan.sort((a, b) => a.at - b.at);
  }

  resize(w, h, waterLineY) {
    this._w = w;
    this._h = h;
    this._waterLineY = waterLineY ?? h * 0.62;
  }

  update(progress, dt, turtleX, turtleY) {
    this.inRain = 0;
    if (!this.enabled || !this._h) return;

    if (!this._active) {
      for (const ev of this._plan) {
        if (!ev.done && progress >= ev.at && progress >= PHASE_MIN[ev.type]) {
          ev.done = true;
          this._start(ev.type);
          break;
        }
      }
    }
    if (this._active) this._run(dt, turtleX, turtleY);
  }

  _start(type) {
    this._t = 0;
    this._whaleG.clear();
    this._whaleG.rotation = 0;
    this._sprayG.clear();
    this._rainVeil.clear();
    this._rainStreaks.clear();
    this.back.visible = false;
    this.front.visible = false;
    if (type === 'whale') {
      this._active = { type, dur: this.cfg.whaleDurSec ?? 4.2 };
      this.back.visible = true;
    } else if (type === 'rain') {
      this._active = { type, dur: this.cfg.rainDurSec ?? 15 };
      this.front.visible = true;
    } else if (type === 'meteors') {
      this._active = { type, dur: 9 };
      this.hooks.meteorShower?.(this.cfg.meteorCount ?? 7);
    } else if (type === 'shootingStar') {
      this._active = { type, dur: 1.6 };
      this.hooks.shootingStar?.();
    }
  }

  _run(dt, tx, ty) {
    this._t += dt;
    const a = this._active;
    const k = clamp(this._t / a.dur, 0, 1);
    if (a.type === 'whale') this._drawWhale(k);
    else if (a.type === 'rain') this._drawRain(k);
    if (k >= 1) {
      this._whaleG.clear();
      this._whaleG.rotation = 0;
      this._sprayG.clear();
      this._rainVeil.clear();
      this._rainStreaks.clear();
      this.back.visible = false;
      this.front.visible = false;
      this._active = null;
    }
  }

  _drawWhale(k) {
    const g = this._whaleG;
    const sg = this._sprayG;
    g.clear();
    sg.clear();
    const arc = Math.sin(k * Math.PI); // 0→1→0
    const x = this._w * (0.72 - k * 0.16);
    const baseY = this._waterLineY;
    const y = baseY - arc * this._h * 0.13;
    const s = this._h * 0.1;
    const col = 0x1b2c3c;
    const a = 0.94 * Math.min(1, arc * 1.9);

    // 打ち上がりは頭上げ / 頂点で水平 / 降下は頭下げ
    g.position.set(x, y);
    g.rotation = -0.7 * Math.cos(k * Math.PI);

    // 胴体(ローカル座標。頭 = +x 方向)
    g.moveTo(-s * 1.7, s * 0.05);
    g.quadraticCurveTo(-s * 0.4, -s * 0.64, s * 0.95, -s * 0.26);
    g.quadraticCurveTo(s * 1.55, -s * 0.08, s * 1.42, s * 0.14);
    g.quadraticCurveTo(s * 0.5, s * 0.44, -s * 0.5, s * 0.34);
    g.quadraticCurveTo(-s * 1.2, s * 0.3, -s * 1.7, s * 0.05);
    g.fill({ color: col, alpha: a });
    // 胸びれ
    g.moveTo(s * 0.15, s * 0.22);
    g.quadraticCurveTo(-s * 0.05, s * 0.74, -s * 0.45, s * 0.9);
    g.quadraticCurveTo(-s * 0.12, s * 0.46, s * 0.02, s * 0.22);
    g.fill({ color: col, alpha: a * 0.92 });
    // 尾びれ
    g.moveTo(-s * 1.55, s * 0.05);
    g.quadraticCurveTo(-s * 2.35, -s * 0.34, -s * 2.05, -s * 0.56);
    g.quadraticCurveTo(-s * 2.1, -s * 0.12, -s * 2.4, s * 0.12);
    g.quadraticCurveTo(-s * 2.0, s * 0.22, -s * 1.55, s * 0.05);
    g.fill({ color: col, alpha: a });

    // 潮吹き + 着水の飛沫(非回転)
    if (k > 0.28 && k < 0.78) {
      const sk = 1 - Math.abs(k - 0.5) / 0.24;
      const bx = x + s * 0.9;
      for (let i = 0; i < 8; i++) {
        const ang = -Math.PI / 2 + (i - 3.5) * 0.13;
        sg.circle(
          bx + Math.cos(ang) * s * (0.4 + sk * 1.1),
          y - s * 0.4 - Math.sin(ang) * s * (0.8 + sk * 1.3),
          s * 0.075,
        ).fill({ color: 0xffffff, alpha: 0.6 * sk });
      }
    }
    // 胴が水を切るところの白波
    if (arc > 0.05) {
      sg.ellipse(x - s * 0.2, baseY, s * (1.4 + arc), s * 0.16).fill({ color: 0xffffff, alpha: 0.3 * arc });
    }
  }

  _drawRain(k) {
    const env = k < 0.12 ? k / 0.12 : k > 0.82 ? (1 - k) / 0.18 : 1;
    this.inRain = clamp(env, 0, 1);

    const veil = this._rainVeil;
    veil.clear();
    veil.rect(0, 0, this._w, this._h).fill({ color: 0x9fb0bd, alpha: (this.cfg.rainMaxAlpha ?? 0.16) * env });

    const s = this._rainStreaks;
    s.clear();
    const n = Math.round((this.cfg.rainStreakCount ?? 90) * env);
    const t = this._t;
    for (let i = 0; i < n; i++) {
      const seed = i * 97.13;
      const sx = ((seed * 53 + t * this._w * 0.55) % (this._w + 60)) - 30;
      const sy = ((seed * 71 + t * this._h * 1.8) % (this._h + 60)) - 30;
      const L = 12 + (seed % 10);
      s.moveTo(sx, sy);
      s.lineTo(sx - L * 0.28, sy + L);
    }
    s.stroke({ color: 0xdfe8ef, alpha: 0.34 * env, width: 1.2 });
  }
}
