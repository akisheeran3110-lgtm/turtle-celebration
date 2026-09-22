import { Container, Sprite, Texture } from 'pixi.js';
import { clamp, lerp, TAU } from '../systems/mathUtils.js';
import { toHexNumber, lerpColor } from '../systems/colorUtils.js';

let BOUQUET_GLOW_TEX = null;
function bouquetGlowTexture() {
  if (BOUQUET_GLOW_TEX) return BOUQUET_GLOW_TEX;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  BOUQUET_GLOW_TEX = Texture.from(canvas);
  return BOUQUET_GLOW_TEX;
}

/**
 * Turtle
 * ------
 * プレイヤーの亀。切り紙アニメ方式(パーツ単位の回転)。
 * 4パーツ(body / front-flipper / back-flipper / head)は同一キャンバス
 * (1344 x 896)・座標系共通。
 *
 * 羽ばたき:
 *   - 前ヒレ: 上向き小さめ / 下向き大きめ(非対称ストローク)
 *   - 後ヒレ: 逆位相、振幅は前ヒレの backAmplitudeScale 倍
 *   - 縦の動きが小さい(漂っている)ときは周期を idlePeriodSec へ寄せる
 *   - 頭: 縦に動いているときだけ進行方向へ headTurnRad
 *   - 下向きストローク開始のフレームで this.downstroke = true(水しぶき用)
 *
 * 傾き(tilt)は上昇=頭上げ / 下降=頭下げ。scene が vy から算出して渡す。
 */

const CANVAS_W = 1344;
const CANVAS_H = 896;
const PIVOTS = {
  frontFlipper: { x: 890, y: 350 },
  backFlipper: { x: 307, y: 505 },
  head: { x: 957, y: 264 },
};

export class Turtle {
  constructor(config, textures) {
    this.config = config;
    this.container = new Container();

    this.backFlipper = this._makePart(textures['back-flipper'], PIVOTS.backFlipper);
    this.body = this._makePart(textures['body'], null);
    this.head = this._makePart(textures['head'], PIVOTS.head);
    this.frontFlipper = this._makePart(textures['front-flipper'], PIVOTS.frontFlipper);
    this.container.addChild(this.backFlipper, this.body, this.head, this.frontFlipper);

    // ブーケ: 甲羅の上・中央よりやや前寄り。ステージで texture 差し替え(0=非表示)。
    this._bouquetTex = textures.bouquet ?? [];
    this._bouquetCfg = config.bouquet ?? {};
    this._bouquetAnchorPx = this._bouquetCfg.anchorPx ?? { x: 580, y: 250 };
    this._bouquetSizePx = this._bouquetCfg.sizePx ?? 360;

    // 満開(最終段)だけの控えめな常時グロー。ブーケの奥に置く。
    this.bouquetGlow = new Sprite(bouquetGlowTexture());
    this.bouquetGlow.anchor.set(0.5);
    this.bouquetGlow.visible = false;
    this.bouquetGlow.tint = toHexNumber(this._bouquetCfg.finalGlow?.color ?? 0xffefc2);
    this.container.addChild(this.bouquetGlow);

    this.bouquet = new Sprite();
    this.bouquet.anchor.set(0.5);
    this.bouquet.position.set(this._bouquetAnchorPx.x, this._bouquetAnchorPx.y);
    this.bouquet.visible = false;
    this.container.addChild(this.bouquet);
    this.bouquetStage = 0;

    this.container.pivot.set(CANVAS_W / 2, CANVAS_H / 2);

    this._phase = 0;
    this._period = config.flap.frontPeriodSec;
    this._prevSin = 0;
    this._armed = true;
    this.downstroke = false;
    this._baseScale = 1;
    this._t = 0;
    this.applyScale();
  }

  _makePart(texture, pivot) {
    const sprite = new Sprite(texture);
    if (pivot) {
      sprite.pivot.set(pivot.x, pivot.y);
      sprite.position.set(pivot.x, pivot.y);
    }
    return sprite;
  }

  applyScale() {
    this._baseScale = this.config.sizePx / CANVAS_W;
    this.container.scale.set(this._baseScale);
  }

  /**
   * 潜水演出: 画面全体ではなく亀のパーツだけを水色に沈める(#水中感は亀の色で)。
   * @param {number} submersion 0(水面上)〜1(深く潜っている)
   */
  setSubmersionTint(submersion) {
    const cfg = this.config.underwaterTint ?? {};
    const k = clamp(submersion, 0, 1) * (cfg.maxStrength ?? 0.6);
    const col = k > 0.001 ? lerpColor(0xffffff, toHexNumber(cfg.color ?? 0x14344c), k) : 0xffffff;
    this.backFlipper.tint = col;
    this.body.tint = col;
    this.head.tint = col;
    this.frontFlipper.tint = col;
    this.bouquet.tint = col; // ブーケも潜水中は沈んだ色に(#水中感)
  }

  /** @param {number} n  0(なし) 〜 config.bouquet.maxStage(既定5、段階的に大きく/豪華に) */
  setBouquetStage(n) {
    const maxStage = this._bouquetCfg.maxStage ?? this._bouquetTex.length ?? 5;
    this.bouquetStage = clamp(n | 0, 0, maxStage);
    if (this.bouquetStage === 0 || !this._bouquetTex[this.bouquetStage - 1]) {
      this.bouquet.visible = false;
      this.bouquetGlow.visible = false;
      return;
    }
    const stageIdx = this.bouquetStage - 1;
    const growth = this._bouquetCfg.growthScale?.[stageIdx] ?? 1;
    const shiftX = this._bouquetCfg.anchorShiftPerStage?.x?.[stageIdx] ?? 0;
    const shiftY = this._bouquetCfg.anchorShiftPerStage?.y?.[stageIdx] ?? 0;

    const tex = this._bouquetTex[this.bouquetStage - 1];
    this.bouquet.texture = tex;
    const w = tex.width || 1024;
    this.bouquet.scale.set((this._bouquetSizePx * growth) / w);
    this.bouquet.position.set(this._bouquetAnchorPx.x + shiftX, this._bouquetAnchorPx.y + shiftY);
    this.bouquet.visible = true;

    const isFinal = this.bouquetStage >= maxStage;
    const glowCfg = this._bouquetCfg.finalGlow ?? {};
    this.bouquetGlow.visible = isFinal && glowCfg.enabled !== false;
    if (this.bouquetGlow.visible) {
      this.bouquetGlow.position.copyFrom(this.bouquet.position);
      this.bouquetGlow.width = this.bouquetGlow.height = this._bouquetSizePx * growth * 1.7;
    }
  }

  /** 甲羅上のブーケのスクリーン座標(レベルアップ演出の発生源) */
  bouquetScreenPos() {
    const s = this._baseScale;
    return {
      x: this.container.x + (this.bouquet.x - CANVAS_W / 2) * s,
      y: this.container.y + (this.bouquet.y - CANVAS_H / 2) * s,
    };
  }

  setPosition(x, y) {
    this.container.position.set(x, y);
  }

  /** 前ヒレ先端あたりのスクリーン座標(水しぶきの発生源) */
  flipperTip() {
    const s = this._baseScale;
    return {
      x: this.container.x + (PIVOTS.frontFlipper.x - CANVAS_W / 2) * s,
      y: this.container.y + (PIVOTS.frontFlipper.y - CANVAS_H / 2 + 130) * s,
    };
  }

  /**
   * @param {number} dt
   * @param {{verticalSpeedRatio:number, tilt:number}} motion
   */
  update(dt, { verticalSpeedRatio, tilt, flapRateScale = 1 }) {
    this._t += dt;
    if (this.bouquetGlow.visible) {
      const period = this._bouquetCfg.finalGlow?.pulsePeriodSec ?? 3.2;
      const maxAlpha = this._bouquetCfg.finalGlow?.maxAlpha ?? 0.4;
      this.bouquetGlow.alpha = maxAlpha * (0.6 + 0.4 * Math.sin((this._t * TAU) / period));
    }
    const flap = this.config.flap;

    const idle = verticalSpeedRatio <= flap.idleSpeedThresholdRatio;
    const targetPeriod = idle ? flap.idlePeriodSec : flap.frontPeriodSec;
    this._period = lerp(this._period, targetPeriod, flap.periodLerp);

    // 音楽の中高域振幅で羽ばたき速度を ±(1 未満で遅く / 1 超で速く)
    const effPeriod = this._period / clamp(flapRateScale, 0.6, 1.6);
    this._phase = (this._phase + (dt * TAU) / effPeriod) % TAU;
    const s = Math.sin(this._phase);
    const up = Math.abs(flap.frontUpRad);

    this.frontFlipper.rotation = s >= 0 ? s * flap.frontDownRad : s * up;
    const sb = Math.sin(this._phase + (flap.backPhaseOffsetRad ?? Math.PI));
    const scale = flap.backAmplitudeScale ?? 0.6;
    this.backFlipper.rotation = (sb >= 0 ? sb * flap.frontDownRad : sb * up) * scale;

    const headActive = verticalSpeedRatio > (flap.headTurnSpeedThresholdRatio ?? 0.04);
    const headTarget = headActive ? clamp(tilt, -1, 1) * (flap.headTurnRad ?? 0.05) : 0;
    this.head.rotation = lerp(this.head.rotation, headTarget, 0.1);

    this.downstroke = false;
    if (this._armed && this._prevSin < 0 && s >= 0) {
      this.downstroke = true;
      this._armed = false;
    }
    if (s < -0.3) this._armed = true;
    this._prevSin = s;

    this.container.rotation = tilt;
  }
}
