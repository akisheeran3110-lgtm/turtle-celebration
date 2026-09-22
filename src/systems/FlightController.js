import { clamp, lerp } from './mathUtils.js';

/**
 * FlightController
 * ----------------
 * 移動・操作の中枢(左右タップゾーン方式)。
 *
 *  - 前進速度は常に一定。worldX が一定レートで増え続けるだけ。左右操作は無い。
 *  - 縦は「押しているゾーン」で決まる:
 *      verticalInput = +1 … 上昇方向へ加速(画面右半分)
 *      verticalInput = -1 … 下降方向へ加速(画面左半分)
 *      verticalInput =  0 … 重力なし。垂直速度を ~0.3 秒で 0 へ減衰し、その高さを維持
 *  - 上昇/下降とも最大速度をクランプ(非対称可)。
 *  - 上下限はシンプルな非対称のソフト壁:
 *      上限 = ceilingRatio(画面上端に少しだけ余白)
 *      下限 = 水面ライン + maxDiveBelowWaterRatio(潜水の下限と共通)
 *  - 結婚式(wedding): setDestination() の pull>0 で y を目的地の高さへブレンドし、
 *    操作の効きを弱める。
 *  - 潜水チャージ & 段階リープ: 画面の一番下(_maxDiveY)まで下がって下入力を保持すると
 *    _charge が最大 chargeMaxSec まで溜まる(1/2/3秒 = tier 1/2/3)。下入力を離す(or 上入力)と
 *    tier に応じた勢いで水面から飛び出し、放物線を描く(弧の処理はブリーチ機構を流用)。
 *  - 滑空: 高所を無入力でいると前進がわずかに伸びる(glideMaxBonus)。
 *  - 上昇気流: addUpdraftLift() で一時的な上向きのリフト。
 */
export class FlightController {
  constructor(cfg) {
    this.cfg = cfg;

    this.worldX = 0;
    this.y = 0;
    this.vy = 0;
    this.verticalInput = 0; // -1 / 0 / +1
    this.submersion = 0;
    this.cruiseSpeedPx = 0;

    this._w = 1;
    this._h = 1;
    this._waterLineY = 0;
    this._ceilingY = 0;
    this._maxDiveY = 0;

    this._pull = 0;
    this._destWorldX = null;
    this._destScreenY = null;
    this.forwardScale = 1;
    this._boost = 1;        // スリップストリーム等の一時的な前進加速(滑らかに追従)
    this._boostTarget = 1;
    this._glide = 0;        // 高所を無入力で滑空 → 前進がわずかに伸びる
    this._breachT = 0;      // リープ(放物線)の残り時間。ブリーチ機構を流用
    this._updraftLift = 0;  // このフレームの上昇気流リフト(消費で 0 へ)
    this._prevInput = 0;
    this.breachTriggered = false; // 1フレームだけ true(飛沫・SFX用)

    // 潜水チャージ
    this._charge = 0;      // 底で下入力を保持した秒数(0..chargeMaxSec)
    this.chargeTier = 0;   // 0(未満)/ 1 / 2 / 3
    this.chargeNorm = 0;   // 0..1(エフェクトの強度用)
    this.leapTier = 0;     // リープした瞬間だけ 1..3、それ以外 0
  }

  setForwardScale(s) {
    this.forwardScale = s;
  }

  /** スリップストリーム内などでの一時的な前進加速(1 = 通常)。 */
  setSpeedBoost(k) {
    this._boostTarget = k || 1;
  }

  /** 上昇気流の中: このフレームだけ働く上向きのゆるいリフト(0..1程度)。 */
  addUpdraftLift(k) {
    this._updraftLift = Math.max(this._updraftLift, k || 0);
  }

  /** @param {number} dir  -1(下降) / 0(維持) / +1(上昇) */
  setVerticalInput(dir) {
    this.verticalInput = dir > 0 ? 1 : dir < 0 ? -1 : 0;
  }

  resize(w, h, waterLineY) {
    this._w = w;
    this._h = h;
    this._waterLineY = waterLineY;
    this._ceilingY = h * this.cfg.ceilingRatio;
    this._maxDiveY = waterLineY + h * this.cfg.maxDiveBelowWaterRatio;
    if (this.y === 0) {
      this.y = waterLineY - h * (this.cfg.spawnAboveWaterRatio ?? 0.28);
    }
  }

  setDestination(worldX, screenY, pull) {
    this._destWorldX = worldX;
    this._destScreenY = screenY;
    this._pull = clamp(pull ?? 0, 0, 1);
  }

  update(dt) {
    const h = this._h;
    const c = this.cfg;
    this.breachTriggered = false;
    this.leapTier = 0;

    // --- 前進(常に一定。boost は滑らかに追従。高所滑空でわずかに伸びる) ---
    this._boost += (this._boostTarget - this._boost) * clamp(5 * dt, 0, 1);
    const altAbove = clamp(
      (this._waterLineY - this.y) / (h * (c.glideRefHeightRatio ?? 0.42)),
      0,
      1,
    );
    const glideTarget = this.verticalInput === 0 ? altAbove * (c.glideMaxBonus ?? 0.09) : 0;
    this._glide += (glideTarget - this._glide) * clamp(2.5 * dt, 0, 1);
    this.cruiseSpeedPx =
      this._w * c.forwardSpeedRatioPerSec * this.forwardScale * this._boost * (1 + this._glide);
    this.worldX += this.cruiseSpeedPx * dt;

    const inputScale = 1 - this._pull * 0.85; // wedding 中は効きを弱める

    // --- 潜水チャージ: 画面の底で下入力を保持している間だけ溜まる ---
    const chargeMax = c.chargeMaxSec ?? 3.0;
    const nearFloor = this.y >= this._maxDiveY - h * (c.chargeZoneRatio ?? 0.05);
    if (this._breachT <= 0 && this._pull <= 0.01 && this.verticalInput < 0 && nearFloor) {
      this._charge = Math.min(this._charge + dt, chargeMax);
    } else if (this.verticalInput < 0 && !nearFloor) {
      // まだ底へ潜っている途中 — チャージは進めない(維持)
    } else if (this._charge > 0 && this.verticalInput >= 0) {
      // 底を離れた or 入力を戻した — 発射しない場合はゆっくり抜ける
    }
    const tierSec = c.chargeTierSec ?? [1, 2, 3];
    this.chargeNorm = clamp(this._charge / chargeMax, 0, 1);
    this.chargeTier = this._charge < 0.05 ? 0
      : this._charge < tierSec[0] ? 0
        : this._charge < tierSec[1] ? 1
          : this._charge < tierSec[2] ? 2 : 3;

    // --- リープ: 下入力を離した / 上を押した 瞬間、tier に応じて水面から飛び出す ---
    const released = this._prevInput < 0 && this.verticalInput === 0;
    const pressedUp = this._prevInput <= 0 && this.verticalInput > 0;
    if (
      this._breachT <= 0 &&
      (released || pressedUp) &&
      this._charge >= (c.chargeMinSec ?? 0.4) &&
      this._pull <= 0.01
    ) {
      const byTier = c.leapImpulseByTier ?? [0.34, 0.52, 0.74, 0.98];
      this.vy = -h * (byTier[this.chargeTier] ?? byTier[byTier.length - 1]);
      this._breachT = c.leapDurationSec ?? c.breachDurationSec ?? 1.9;
      this.leapTier = Math.max(1, this.chargeTier);
      this.breachTriggered = true;
      this._charge = 0;
    } else if (released || pressedUp) {
      // チャージ不足で離した → 何もせず通常上昇。チャージは捨てる
      this._charge = 0;
    }
    // 飛翔中に方向入力したら即座に通常制御へ戻す
    if (this._breachT > 0 && this.verticalInput !== 0) this._breachT = 0;
    this._prevInput = this.verticalInput;

    // --- 縦速度 ---
    if (this.verticalInput > 0) {
      this.vy -= h * c.accelUpRatioPerSec2 * inputScale * dt;
      this.vy *= Math.exp(-c.activeDampPerSec * dt); // 終端速度
    } else if (this.verticalInput < 0) {
      // 潜り始めたら底へ向かって少し速く沈む(水面付近の下げ操作はそのまま穏やか)
      const diveBoost = this.submersion > 0.1 ? (c.diveAccelBoost ?? 1.9) : 1;
      this.vy += h * c.accelDownRatioPerSec2 * diveBoost * inputScale * dt;
      this.vy *= Math.exp(-c.activeDampPerSec * dt);
      if (this.submersion > 0.1) {
        this.vy = Math.min(this.vy, h * (c.maxDiveDownRatioPerSec ?? 0.62));
      }
    } else if (this._breachT > 0) {
      // ブリーチ中は弱い減衰だけ(勢いを残す)
      this.vy *= Math.exp(-(c.breachDampPerSec ?? 0.9) * dt);
    } else {
      // 無入力: 重力なし。速度を減衰させてその高さを維持
      this.vy *= Math.exp(-c.neutralDampPerSec * dt);
    }

    // 上昇気流: このフレームだけ働くゆるい上向きリフト
    if (this._updraftLift > 0) {
      this.vy -= h * this._updraftLift * dt;
    }
    this._updraftLift = 0;

    // ブリーチの弧: 窓の間だけ下向きの引き戻しを加えて放物線にする
    if (this._breachT > 0) {
      this._breachT -= dt;
      this.vy += h * (c.breachGravityRatio ?? 0.93) * dt;
      // 頂点を越えて水面より下へ戻ってきたら終了。着水で勢いを落として浅く受け止める
      if (this.vy > 0 && this.y > this._waterLineY) {
        this._breachT = 0;
        this.vy *= 0.4;
      }
    }

    // 上下限に近づくとソフトに減速(クッション)
    const cushion = h * 0.12;
    const decel = c.boundDecelPerSec ?? 9;
    if (this.vy < 0 && this.y < this._ceilingY + cushion) {
      this.vy *= Math.exp(-(1 - (this.y - this._ceilingY) / cushion) * decel * dt);
    }
    if (this.vy > 0 && this.y > this._maxDiveY - cushion) {
      this.vy *= Math.exp(-(1 - (this._maxDiveY - this.y) / cushion) * decel * dt);
    }

    // ブリーチ中は通常の上限を超えて打ち上がれる
    const vUp = h * (this._breachT > 0 ? (c.breachMaxUpRatio ?? 0.72) : c.maxUpSpeedRatioPerSec);
    const vDown = h * c.maxDownSpeedRatioPerSec;
    this.vy = clamp(this.vy, -vUp, vDown);

    this.y += this.vy * dt;

    // ハード壁(絶対に画面外へ出さない)
    if (this.y < this._ceilingY) { this.y = this._ceilingY; if (this.vy < 0) this.vy = 0; }
    if (this.y > this._maxDiveY) { this.y = this._maxDiveY; if (this.vy > 0) this.vy = 0; }

    // --- wedding: 目的地の高さへブレンド ---
    if (this._pull > 0 && this._destScreenY != null) {
      this.y = lerp(this.y, this._destScreenY, clamp(this._pull * 3 * dt, 0, 1));
      this.vy *= 1 - this._pull * 0.5;
    }

    this.submersion = clamp(
      (this.y - this._waterLineY) / (this._maxDiveY - this._waterLineY),
      0,
      1,
    );
  }

  distanceToDestination() {
    return this._destWorldX == null ? Infinity : this._destWorldX - this.worldX;
  }
}
