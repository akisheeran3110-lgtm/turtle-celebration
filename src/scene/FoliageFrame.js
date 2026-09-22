import { Container, Sprite } from 'pixi.js';
import { mulberry32, randRange, TAU, clamp } from '../systems/mathUtils.js';
import { lerpColor } from '../systems/colorUtils.js';
import { trimTexture } from './textureTrim.js';

/** 生成イラストの不透明部分 bbox(実測)。追加時はここに足す。 */
const PALM_BBOX = {
  'palm-01': { x0: 0.078, y0: 0.101, x1: 0.923, y1: 0.906 },
  'palm-02': { x0: 0.078, y0: 0.093, x1: 0.917, y1: 0.858 },
  'palm-03': { x0: 0.064, y0: 0.093, x1: 0.938, y1: 0.907 },
};
const MONSTERA_BBOX = {
  'monstera-01': { x0: 0.09, y0: 0.069, x1: 0.909, y1: 0.921 },
};
const HIBISCUS_BBOX = {
  'hibiscus-01': { x0: 0.089, y0: 0.116, x1: 0.914, y1: 0.881 },
  'hibiscus-02': { x0: 0.087, y0: 0.11, x1: 0.894, y1: 0.89 },
  'hibiscus-03': { x0: 0.071, y0: 0.122, x1: 0.926, y1: 0.898 },
};

/**
 * 各パーム画像は「まっすぐ育つ絵」ではなく、それぞれ根元(茎)の位置と伸びる向きが違う
 * (palm-01/02は下端中央が根元で素直に真上へ、palm-03は上寄りが根元で右下へ弧を描く)。
 * ここを画像ごとに実測して anchor(根元位置)を合わせないと、回転を揃えた瞬間に
 * どれかが不自然な向き(逆さ/あらぬ方向)になる。#椰子の葉が逆
 */
const PALM_ANCHOR = {
  'palm-01': [0.5, 1.0],
  'palm-02': [0.5, 1.0],
  'palm-03': [0.16, 0.07],
};
/** モンステラは上端の切れ込み(2房が分かれてる側=茎の付け根)を接地点にする。#モンステラが逆 */
const MONSTERA_ANCHOR = [0.5, 0.08];

/**
 * FoliageFrame
 * ------------
 * 画面四隅から差し込む前景の植物と花。全部 Midjourney 生成イラストの Sprite
 * (手続き描画の "big"/プルメリア/ブーゲンビリアは撤去済み、生成してない物は出さない方針)。
 *
 * 4隅は1つのレイアウトのミラーではなく、隅ごとに手作りで組んだ別々の構成(CORNER_DEFS)。
 * 各葉は layer:'back'(奥・小さめ・少し暗い) / 'front'(手前・主役級) を持たせて奥行きを出す。
 * 花(ハイビスカス)は余白に散らすのではなく、その隅の主役の葉の根元に寄り添わせて置く。
 *
 *  - 揺れ(sway)・音楽リアクティブの kick は Container(コーナーnode)単位なので、
 *    中身が何であっても無改造でそのまま効く。
 *  - 最前面(グレイン/ビネットの下)。亀は葉の奥を通る。
 */
export class FoliageFrame {
  constructor(cfg, textures = {}) {
    this.cfg = cfg;
    this.container = new Container();
    this.container.eventMode = 'none';

    this._palmTex = {};
    this._monsteraTex = {};
    this._hibiscusTex = [];
    for (const key of Object.keys(textures)) {
      if (key.startsWith('palm-') && PALM_BBOX[key]) {
        this._palmTex[key] = trimTexture(textures[key], PALM_BBOX[key]);
      } else if (key.startsWith('monstera-') && MONSTERA_BBOX[key]) {
        this._monsteraTex[key] = trimTexture(textures[key], MONSTERA_BBOX[key]);
      } else if (key.startsWith('hibiscus-')) {
        this._hibiscusTex.push(trimTexture(textures[key], HIBISCUS_BBOX[key]));
      }
    }

    this.corners = [];
    this._w = 0;
    this._h = 0;
    this._t = 0;
    this._lastMid = -1;
  }

  /** 隅ごとの手作り構成。x,y,h は size(コーナー基準サイズ)比。rot はラジアン(このコーナー内座標系)。 */
  _cornerDefs() {
    const P = (tex, x, y, h, rot, layer = 'front') => ({ kind: 'palm', tex, x, y, h, rot, layer });
    const M = (x, y, h, rot, layer = 'front') => ({ kind: 'monstera', tex: 'monstera-01', x, y, h, rot, layer });
    const F = (x, y, h) => ({ kind: 'hibiscus', x, y, h });

    return [
      // TL: モンステラが主役。奥にパームを重ね、根元にハイビスカスを寄り添わせる。
      [
        P('palm-01', 0.0, 0.0, 0.95, 1.55, 'back'),
        P('palm-02', 0.05, 0.02, 0.8, 1.85, 'back'),
        P('palm-03', 0.1, 0.03, 0.75, 1.4, 'back'),
        P('palm-02', 0.02, 0.07, 0.85, 1.65, 'back'),
        P('palm-01', 0.15, 0.0, 0.7, 1.3, 'back'),
        M(0.19, 0.13, 0.62, -0.5, 'front'),
        F(0.13, 0.3, 0.26),
      ],
      // TR: palm-03の大きな弧を主役に。奥にパームを支え、モンステラは控えめな小物として奥へ。
      [
        P('palm-01', 0.09, 0.03, 0.75, 1.4, 'back'),
        P('palm-02', 0.15, 0.01, 0.65, 1.75, 'back'),
        P('palm-01', 0.03, 0.08, 0.7, 1.95, 'back'),
        P('palm-03', 0.18, 0.06, 0.6, 0.25, 'back'),
        M(0.28, 0.19, 0.5, -0.6, 'back'),
        P('palm-03', 0.0, 0.0, 1.15, 0.15, 'front'),
        F(0.1, 0.3, 0.24),
      ],
      // BL: パームを密に重ねてふさふさ感、モンステラは奥の彩り、花は根元に2輪クラスタ。
      [
        P('palm-03', 0.1, 0.06, 0.7, -0.05, 'back'),
        P('palm-01', 0.16, 0.02, 0.65, 1.35, 'back'),
        P('palm-02', 0.06, 0.09, 0.6, 1.7, 'back'),
        M(0.08, 0.06, 0.55, -0.55, 'back'),
        P('palm-02', 0.0, 0.0, 1.05, 1.55, 'front'),
        P('palm-01', 0.04, 0.02, 0.92, 1.9, 'front'),
        F(0.12, 0.32, 0.24),
        F(0.22, 0.27, 0.2),
      ],
      // BR: モンステラとpalm-03を半々の主役にして左右のバランスを取る。
      [
        P('palm-02', 0.08, 0.0, 0.75, 1.6, 'back'),
        P('palm-01', 0.13, 0.05, 0.65, 1.4, 'back'),
        P('palm-03', 0.2, 0.1, 0.55, 0.3, 'back'),
        P('palm-02', 0.02, 0.09, 0.6, 1.8, 'back'),
        M(0.17, 0.1, 0.85, -0.5, 'front'),
        P('palm-03', 0.0, 0.02, 1.0, 0.2, 'front'),
        F(0.27, 0.2, 0.26),
      ],
    ];
  }

  resize(width, height) {
    this._w = width;
    this._h = height;

    for (const c of this.corners) c.node.destroy({ children: true });
    this.corners.length = 0;
    this.container.removeChildren();

    const rng = mulberry32(8123);
    const s = Math.min(width, height) * this.cfg.cornerScaleRatio;
    const cornerDefs = this._cornerDefs();

    const specs = [
      { x: 0, y: 0, sx: 1, sy: 1 },
      { x: width, y: 0, sx: -1, sy: 1 },
      { x: 0, y: height, sx: 1, sy: -1 },
      { x: width, y: height, sx: -1, sy: -1 },
    ];

    specs.forEach((spec, ci) => {
      const node = new Container();
      node.position.set(spec.x, spec.y);
      node.scale.set(spec.sx, spec.sy);
      const baseRot = randRange(rng, -0.06, 0.06);
      node.rotation = baseRot;
      this.container.addChild(node);

      const size = s * randRange(rng, 0.97, 1.1);
      const leafG = [];

      for (const def of cornerDefs[ci]) {
        const jitterRot = randRange(rng, -0.04, 0.04);
        const jitterScale = randRange(rng, 0.96, 1.05);

        if (def.kind === 'hibiscus') {
          if (!this._hibiscusTex.length) continue;
          const tex = this._hibiscusTex[(rng() * this._hibiscusTex.length) | 0];
          const sp = new Sprite(tex);
          sp.anchor.set(0.5, 0.5);
          const targetH = def.h * size * jitterScale;
          // 下2隅は親ノードが縦反転(spec.sy=-1)しているので、花が逆さ(下向き)に
          // ならないよう子側で打ち消して常に上向きを保つ。#下隅のハイビスカスが逆
          sp.scale.set(targetH / (tex.height || 1), (targetH / (tex.height || 1)) * spec.sy);
          sp.position.set(def.x * size, def.y * size);
          sp.rotation = randRange(rng, -0.3, 0.3);
          node.addChild(sp);
          leafG.push({ sp, layer: 'front' });
          continue;
        }

        const bank = def.kind === 'monstera' ? this._monsteraTex : this._palmTex;
        const anchor = def.kind === 'monstera' ? MONSTERA_ANCHOR : PALM_ANCHOR[def.tex];
        const tex = bank[def.tex];
        if (!tex) continue; // 未配置の素材は静かにスキップ(procedural フォールバックはしない)

        const sp = new Sprite(tex);
        sp.anchor.set(anchor[0], anchor[1]);
        const targetH = def.h * size * jitterScale;
        sp.scale.set(targetH / (tex.height || 1));
        sp.position.set(def.x * size, def.y * size);
        sp.rotation = def.rot + jitterRot;
        node.addChild(sp);
        leafG.push({ sp, layer: def.layer, swayPhase: rng() * TAU, swayPeriod: 3 + rng() * 2.5 });
      }

      this.corners.push({
        node, leafG, baseRot, baseSx: spec.sx, baseSy: spec.sy,
        sway: 6 + rng() * 4, phase: rng() * TAU,
      });
    });

    this._lastMid = -1;
  }

  _drawLeaves(tones) {
    const tintStrength = this.cfg.leafSpriteTintStrength ?? 0.35;
    const nearTint = lerpColor(0xffffff, tones.mid, tintStrength);
    // 奥(back)の葉は少し暗く沈めて、手前(front)の主役と奥行きの差を出す(#4: 手前と奥の差)
    const farTint = lerpColor(nearTint, tones.dark, 0.4);
    for (const c of this.corners) {
      for (const entry of c.leafG) {
        entry.sp.tint = entry.layer === 'back' ? farTint : nearTint;
        entry.sp.alpha = entry.layer === 'back' ? 0.92 : 1;
      }
    }
  }

  /**
   * @param {number} audioLevel 中高音域の偏差(#8)。音楽の勢いに合わせて葉が大きく揺れる/膨らむ。
   */
  update(tones, dt, audioLevel = 0) {
    this._t += dt;
    if (tones.mid !== this._lastMid) {
      this._lastMid = tones.mid;
      this._drawLeaves(tones);
    }
    // 音楽のヒットで一気に揺れて、バネで元に戻る(単純なsinよりパッと反応して分かりやすい)。
    // 帯域の値は無音時もノイズレベルで常にわずかに揺れてるので、しきい値未満は0扱いにして
    // 「常に小刻みに動いてる」感じを消す(#最低限の動く基準)。
    const threshold = this.cfg.audioSwayThreshold ?? 0.15;
    const raw = clamp(audioLevel, -1, 1);
    const kick = Math.abs(raw) < threshold ? 0 : raw;
    this._leafVel = (this._leafVel ?? 0) + (kick - (this._leafBoost ?? 0)) * 26 * dt;
    this._leafVel *= Math.exp(-9 * dt);
    this._leafBoost = (this._leafBoost ?? 0) + this._leafVel * dt;

    for (const c of this.corners) {
      const sway = Math.sin(this._t * (TAU / c.sway) + c.phase) * this.cfg.swayAmpRad;
      c.node.rotation = c.baseRot + sway + this._leafBoost * (this.cfg.audioSwayGainRad ?? 0.5);
      const s = 1 + Math.max(0, this._leafBoost) * (this.cfg.audioScaleGain ?? 0.1);
      c.node.scale.set(c.baseSx * s, c.baseSy * s);
    }
  }
}
