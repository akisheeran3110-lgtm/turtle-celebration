import { Container, Sprite } from 'pixi.js';
import { clamp, lerp, easeInOut, TAU } from '../systems/mathUtils.js';
import { lerpColor } from '../systems/colorUtils.js';
import { trimTexture } from './textureTrim.js';

const BBOX = {
  venue: { x0: 0.196, y0: 0.181, x1: 0.76, y1: 0.835 },
  island: { x0: 0.1, y0: 0.246, x1: 0.93, y1: 0.73 },
  couple: { x0: 0.128, y0: 0.16, x1: 0.86, y1: 0.848 },
};

/**
 * WeddingClimax
 * -------------
 * EP は制作者の姉の結婚式(ハワイ)のための曲。1ラン(15:39)の締めくくり。
 * 「亀を島へ誘導する」旧設計は廃止(前進一定 + 上下のみ の操作と矛盾するため)。
 * 代わりにスケジュール制の一本道:
 *
 *   idle      : 通常巡航。会場は出ない。
 *   incoming  : venueAppearProgress で会場(deco-wedding-venue / -island)が
 *               右から流れて近づく。操作は通常どおり効く。
 *   arrival   : 到着ビート(数秒・自動・入力不可)。ブーケが甲羅から消え、
 *               光の粒とともにカップル(deco-couple)の傍らへ。ゲージ未達なら
 *               受け渡し演出はスキップ(エラーにしない)。前進はここで停止へ。
 *   epilogue  : ワールドスクロール停止・時間帯も停止。亀がアーチの前を
 *               ゆっくり旋回。花びらが舞う。入力不可。
 *   done      : ここで ParallaxScene が終了画面へ(ループなし)。
 */
export class WeddingClimax {
  constructor(config, particlePool, textures = {}, hooks = {}) {
    this.config = config;
    this.particles = particlePool;
    this.hooks = hooks; // { onBouquetHandoff() }
    this.container = new Container();
    this.container.visible = false;

    this.island = new Sprite(trimTexture(textures.island, BBOX.island));
    this.island.anchor.set(0.5, 1);
    this.venue = new Sprite(trimTexture(textures.venue, BBOX.venue));
    this.venue.anchor.set(0.5, 1);
    this.couple = new Sprite(trimTexture(textures.couple, BBOX.couple));
    this.couple.anchor.set(0.5, 1);
    this.couple.visible = false;
    this.couple.alpha = 0;
    this.container.addChild(this.island, this.venue, this.couple);

    this.phase = 'idle';
    this.inputLocked = false;
    this.freezeTime = false;
    this.forwardScaleOverride = null;
    this.turtleOverride = null;
    this.pull = 0;

    this._w = 0;
    this._h = 0;
    this._waterLineY = 0;
    this._destWorldX = null;
    this._beatT = 0;
    this._epiT = 0;
    this._handoffDone = false;
    this._petalTimer = 0;
    this._epiPetalAcc = 0;
    this._epiCenter = { x: 0, y: 0 };
  }

  resize(width, height, waterLineY) {
    this._w = width;
    this._h = height;
    this._waterLineY = waterLineY ?? height * 0.62;
    this._sizeSprites();
  }

  _sizeSprites() {
    const c = this.config;
    const h = this._h;
    const fit = (sp, ratio) => {
      if (!sp.texture || !sp.texture.height) return;
      sp.scale.set((h * ratio) / sp.texture.height);
    };
    fit(this.island, c.islandSizeRatio ?? 0.26);
    fit(this.venue, c.venueSizeRatio ?? 0.3);
    fit(this.couple, c.coupleSizeRatio ?? 0.2);
  }

  /**
   * @param {object} tod   TimeOfDay
   * @param {number} worldX
   * @param {object} flight FlightController
   * @param {number} dt
   * @param {{anchorX:number, turtle:object, bouquetStage:number}} ctx
   */
  update(tod, worldX, flight, dt, ctx) {
    if (!this.config.enabled) return;
    const c = this.config;
    const p = tod.progress;
    const cx = this._w / 2;

    // 夜は会場を少しだけ沈める(カップルは明るめに残す)
    const nt = tod.nightness ?? 0;
    const tint = lerpColor(0xffffff, 0x2a3a56, nt * 0.5);
    this.island.tint = tint;
    this.venue.tint = tint;
    this.couple.tint = lerpColor(0xffffff, 0x3a4a66, nt * 0.3);

    // --- フェーズ遷移 ---
    if (this.phase === 'idle' && p >= (c.venueAppearProgress ?? 0.85)) {
      const secs = Math.max(2, (c.arriveProgress - p) * tod.config.durationSeconds);
      this._destWorldX = worldX + flight.cruiseSpeedPx * secs;
      this.container.visible = true;
      this.phase = 'incoming';
    }

    if (this.phase === 'incoming') {
      const archX = cx + (this._destWorldX - worldX) * (c.archDepth ?? 0.36);
      // #会場がカクカク動く: この閾値は _layout() の arrival 時クランプ幅(±0.04w)と
      // 揃えておかないと、'near' が先に成立してからクランプ幅に収まるまでの差分が
      // 遷移の瞬間に一気に補正されてカクつく。必ず同じ値を使う。
      const near = Math.abs(archX - cx) < this._w * 0.04;
      if (p >= c.arriveProgress || near) {
        this.phase = 'arrival';
        this._beatT = 0;
      }
    }

    // --- フェーズごとの挙動 ---
    if (this.phase === 'incoming') {
      this.pull = 0;
      this.inputLocked = false;
      this.forwardScaleOverride = null;
      this._layout(worldX, this._destWorldX - worldX);
      this._incomingPetals(dt);
    } else if (this.phase === 'arrival') {
      this._beatT += dt;
      const k = clamp(this._beatT / (c.arrivalBeatSec ?? 3.2), 0, 1);
      this.inputLocked = true;
      // 前進を 1→0 へ、アーチを中央へ寄せて固定
      this.forwardScaleOverride = 1 - easeInOut(k);
      this.pull = easeInOut(k);
      const dx = (this._destWorldX - worldX) * (1 - easeInOut(k));
      this._layout(worldX, dx, /*clampCenter*/ true);

      // 亀をアーチの手前(やや左)へ
      const tx = lerp(ctx.anchorX, cx - this._w * 0.19, easeInOut(k));
      const ty = lerp(flight.y, this._h * (c.targetYRatio ?? 0.52), easeInOut(k));
      this.turtleOverride = { x: tx, y: ty, tilt: -0.04 * Math.sin(this._beatT * 1.4) };

      // ビート 40% 地点でブーケの受け渡し
      if (!this._handoffDone && k >= 0.4) {
        this._handoffDone = true;
        this.couple.visible = true;
        this.hooks.onBouquetHandoff?.(ctx.bouquetStage);
      }
      if (this.couple.visible) this.couple.alpha = clamp((k - 0.4) / 0.4, 0, 1);

      if (k >= 1) {
        this.phase = 'epilogue';
        this._epiT = 0;
        // #亀がワープしたように見える: epilogue の周回は a=0 で
        // (epiCenter.x + w*0.07) から始まる。arrival の着地点(cx - w*0.19)と
        // 一致させないと、遷移の瞬間に亀が横に飛ぶ。
        this._epiCenter = { x: cx - this._w * 0.19 - this._w * 0.07, y: this._h * (c.targetYRatio ?? 0.52) };
      }
    } else if (this.phase === 'epilogue') {
      this._epiT += dt;
      this.inputLocked = true;
      this.freezeTime = true;
      this.forwardScaleOverride = 0;
      this.pull = 1;
      this._layout(worldX, 0, true);
      this.couple.alpha = 1;

      // 亀がアーチの前をゆっくり旋回
      const a = this._epiT * (TAU / (c.epilogueCirclePeriodSec ?? 11));
      this.turtleOverride = {
        x: this._epiCenter.x + Math.cos(a) * this._w * 0.07,
        y: this._epiCenter.y + Math.sin(a) * this._h * 0.03,
        tilt: Math.cos(a) * 0.12,
      };

      this._epiPetalAcc += dt * (c.epiloguePetalRatePerSec ?? 0.9);
      while (this._epiPetalAcc >= 1) {
        this._epiPetalAcc -= 1;
        this.particles.spawnPetals(cx + (Math.random() - 0.5) * this._w * 0.5, -20, 2);
      }

      if (this._epiT >= (c.epilogueSec ?? 40)) this.phase = 'done';
    } else if (this.phase === 'done') {
      this.inputLocked = true;
      this.freezeTime = true;
      this.forwardScaleOverride = 0;
      this._layout(worldX, 0, true);
    }
  }

  _layout(worldX, dxWorld, clampCenter = false) {
    const cx = this._w / 2;
    const lineY = this._waterLineY;
    let archX = cx + dxWorld * (this.config.archDepth ?? 0.36);
    let islandX = cx + dxWorld * (this.config.islandDepth ?? 0.3);
    if (clampCenter) {
      archX = clamp(archX, cx - this._w * 0.04, cx + this._w * 0.04);
      islandX = clamp(islandX, cx - this._w * 0.08, cx + this._w * 0.08);
    }
    this.island.position.set(islandX, lineY + this._h * 0.012);
    this.venue.position.set(archX, lineY - this._h * 0.004);
    this.couple.position.set(archX + this._w * 0.02, lineY - this._h * 0.006);
  }

  _incomingPetals(dt) {
    this._petalTimer -= dt;
    if (this._petalTimer <= 0) {
      this._petalTimer = this.config.petalBurstIntervalSec ?? 2.2;
      this.particles.spawnPetals(this.venue.position.x, this.venue.position.y - this._h * 0.12, 3);
    }
  }

  /** テスト用: 明示リセット(通常はループが無いので呼ばれない) */
  reset() {
    this.phase = 'idle';
    this.inputLocked = false;
    this.freezeTime = false;
    this.forwardScaleOverride = null;
    this.turtleOverride = null;
    this.pull = 0;
    this._destWorldX = null;
    this._handoffDone = false;
    this.container.visible = false;
    this.couple.visible = false;
    this.couple.alpha = 0;
  }
}
