import { Container, Sprite, Texture } from 'pixi.js';
import { mulberry32, randRange, randRangePair, TAU, clamp } from '../systems/mathUtils.js';
import { lerpColor } from '../systems/colorUtils.js';
import { trimTexture } from './textureTrim.js';

/** deco-whale/dolphin/shark/bird.png の不透明部分 bbox(pngbbox.mjs で実測)。余白を詰めてサイズ/中心を正確に。 */
const CREATURE_SPRITE_BBOX = {
  whale: { x0: 0.051, y0: 0.259, x1: 0.951, y1: 0.833 },
  dolphin: { x0: 0.089, y0: 0.189, x1: 0.917, y1: 0.813 },
  shark: { x0: 0.071, y0: 0.23, x1: 0.929, y1: 0.77 },
  bird: { x0: 0, y0: 0.105, x1: 0.901, y1: 0.901 },
};

let GLOW_TEXTURE = null;
function glowTexture() {
  if (GLOW_TEXTURE) return GLOW_TEXTURE;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,244,210,0.9)');
  grad.addColorStop(0.45, 'rgba(255,238,190,0.32)');
  grad.addColorStop(1, 'rgba(255,238,190,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  GLOW_TEXTURE = Texture.from(canvas);
  return GLOW_TEXTURE;
}

/**
 * CreatureLayer
 * -------------
 * 画面を横切る装飾生物・乗り物(スプライト)。全員 **右から左へ**。
 * アセットは左向きに描かれているので反転不要。
 *
 *  kind: fish(群れ) / manta / jellyfish(発光・亀に反応) / yacht / airplane(飛行機雲付き)
 *  時間帯 phase("always" または dawn/midday/sunset/night)でだけ出現。
 *  夜は nightTint で少しだけ沈ませて全体の色調に馴染ませる。
 *
 *  onSpawn(id): 画面外でスポーンした瞬間に呼ばれる(ヨット/飛行機の汽笛・エンジン音向け)。
 *  onCenterPass(id): def.sfxAtCenter な kind だけ、画面中央あたり(def.sfxCenterRatio, 既定0.55)
 *    を通過した瞬間に1回だけ呼ばれる(イルカ/鯨の鳴き声のように、近くに来てから鳴らしたい音向け)。
 */
export class CreatureLayer {
  constructor(def, rngSeed, textures) {
    this.def = def;
    const rawTex = textures[def.textureKey] ?? Texture.EMPTY;
    this.tex = trimTexture(rawTex, CREATURE_SPRITE_BBOX[def.textureKey]) ?? rawTex;
    this.container = new Container();
    this.rng = mulberry32(rngSeed);
    this._spawning = true;
    this.particles = null;

    const poolSize = def.school ? Math.round(def.school[1]) + 3 : 3;
    this.items = [];
    for (let i = 0; i < poolSize; i++) {
      const wrap = new Container();
      wrap.visible = false;
      let glow = null;
      if (def.glow) {
        glow = new Sprite(glowTexture());
        glow.anchor.set(0.5);
        wrap.addChild(glow);
      }
      const sprite = new Sprite(this.tex);
      sprite.anchor.set(0.5, def.anchorY ?? 0.5);
      wrap.addChild(sprite);
      this.container.addChild(wrap);
      this.items.push({ wrap, sprite, glow, active: false, x: 0, baseY: 0, vx: 0, seed: 0, phase: 0, glowBase: 0.5, _react: 0, _reactCd: 0, _avoidX: 0, _avoidY: 0, _sfxFired: false });
    }

    this._w = 0;
    this._h = 0;
    this._t = 0;
    this._timer = this._nextInterval();
  }

  setSpawning(v) { this._spawning = v; }

  resize(width, height, waterLineY) {
    this._w = width;
    this._h = height;
    this.waterLineY = waterLineY ?? height * 0.62;
  }

  _nextInterval() {
    return randRangePair(this.rng, this.def.spawnEverySec);
  }

  _sizeSprite(sprite, scale) {
    const th = this.tex.height || 1;
    const s = ((this.def.heightRatio ?? 0.1) * this._h * scale) / th;
    sprite.scale.set(s);
  }

  _spawnOne(speed, yBase, delayX, scrollX) {
    const it = this.items.find((i) => !i.active);
    if (!it) return;
    it.active = true;
    it.wrap.visible = true;
    it.sprite.texture = this.tex;
    const scale = randRangePair(this.rng, this.def.scaleRange ?? [0.9, 1.1]);
    this._sizeSprite(it.sprite, scale);
    it._scale = scale; // サイズのばらつき係数(0.6〜1.1等の比率。sprite.scaleの実値ではない)
    it._baseScale = it.sprite.scale.x; // 実際の見た目スケール(反応演出はこちらを基準にする)

    // 稀に左→右へ亀を追い抜いていく「逆走」個体(#9)
    it.reverse = this.rng() < (this.def.reverseChance ?? 0);
    const dirSpeed = it.reverse ? speed * (this.def.reverseSpeedMult ?? 1.15) : speed;
    it.vx = it.reverse ? dirSpeed : -dirSpeed;
    // scrollXを足さないと、セッション経過で蓄積したワールド座標とズレて
    // 画面の左寄りに出現してしまう(#長時間セッションでの座標肥大化バグ)
    it.x = it.reverse
      ? scrollX - this._w * 0.16 - delayX
      : scrollX + this._w * 1.16 + delayX;
    const yJitter = this._h * (this.def.yJitterRatio ?? 0.02);
    it.baseY = yBase + randRange(this.rng, -yJitter, yJitter);
    it.seed = this.rng() * TAU;
    it.phase = this.rng() * TAU;
    it.glowBase = randRange(this.rng, 0.35, 0.55);
    it._react = 0;
    it._reactCd = 0;
    it._avoidX = 0;
    it._avoidY = 0;
    it._sfxFired = false;
    it.sprite.rotation = 0;
    it.sprite.skew.set(0, 0);
    it.sprite.tint = 0xffffff;
    // 素材は基本「左向き」に描かれている(faceRight=trueの飛行機だけ右向き素材)。
    // 進行方向(通常=左へ / 逆走=右へ)と絵の向きが一致するように反転符号を決める。
    const drawnFacesLeft = !this.def.faceRight;
    const shouldFaceLeft = !it.reverse;
    it._facingSign = drawnFacesLeft === shouldFaceLeft ? 1 : -1;
    it.sprite.scale.x = it._baseScale * it._facingSign;
    if (it.glow) {
      it.glow.width = it.glow.height = this._h * this.def.heightRatio * 3.4 * scale;
      it.glow.alpha = it.glowBase;
    }
  }

  _spawn(scrollX) {
    const speed = this._w * this.def.speedRatioPerSec;
    const [a, b] = this.def.yBandRatio;
    const yBase = this._h * randRange(this.rng, a, b);
    const n = this.def.school ? Math.round(randRangePair(this.rng, this.def.school)) : 1;
    for (let i = 0; i < n; i++) {
      this._spawnOne(speed * randRange(this.rng, 0.9, 1.15), yBase, i * this._w * (this.def.school ? 0.05 : 0.1), scrollX);
    }
    this.onSpawn?.(this.def.id);
  }

  update(tod, worldX, worldY, dt, ctx) {
    this._t += dt;
    const scrollX = worldX * this.def.depth * 0.14;
    const phaseOk = this.def.phase === 'always' || tod.phaseName === this.def.phase;
    if (this._spawning && phaseOk) {
      this._timer -= dt;
      if (this._timer <= 0) {
        this._spawn(scrollX);
        this._timer = this._nextInterval();
      }
    }

    const nightTint = this.def.nightTint;
    const tx = ctx?.turtleX ?? -9999;
    const ty = ctx?.turtleY ?? -9999;

    for (const it of this.items) {
      if (!it.active) continue;
      it.x += it.vx * dt;
      let y = it.baseY;

      if (this.def.kind === 'fish') {
        y += Math.sin(this._t * 1.6 + it.phase) * this._h * 0.012;
        // 尾振り(群れ全体が位相ずれでばらけて見えるように、既存の個体位相 it.phase を流用)
        it.sprite.skew.x = Math.sin(this._t * 5.5 + it.phase) * 0.16;
      } else if (this.def.kind === 'jellyfish') {
        y += Math.sin(this._t * 0.9 + it.phase) * 14;
        it.sprite.scale.y = it.sprite.scale.x * (1 + Math.sin(this._t * 2.0 + it.phase) * 0.06);
        it.sprite.skew.x = Math.sin(this._t * 1.3 + it.phase) * 0.05; // 触手のゆらぎ
      } else if (this.def.kind === 'manta') {
        it.sprite.rotation = Math.sin(this._t * 0.6 + it.phase) * 0.06;
        // 翼のように上下に羽ばたく(鳥と同じ手法)
        const flap = Math.sin(this._t * 1.4 + it.phase);
        it.sprite.scale.y = it.sprite.scale.x * (1 + flap * 0.12);
      } else if (this.def.kind === 'yacht') {
        it.sprite.rotation = Math.sin(this._t * 1.1 + it.phase) * 0.03;
      } else if (this.def.kind === 'whale') {
        // ゆったり浮き沈み(呼吸するように)+ わずかな傾き + 体幹のしなり
        y += Math.sin(this._t * 0.32 + it.phase) * this._h * 0.02;
        it.sprite.rotation = Math.sin(this._t * 0.32 + it.phase) * 0.03;
        it.sprite.skew.x = Math.sin(this._t * 0.32 + it.phase + 0.6) * 0.05;
      } else if (this.def.kind === 'dolphin') {
        // 周期的に弧を描いて跳ねる(水中/水上の見た目の差は depthTint の暗さで表現)
        const leapPhase = (this._t * 0.55 + it.phase) % TAU;
        const arc = Math.max(0, Math.sin(leapPhase));
        const jump = Math.pow(arc, 1.6);
        y -= jump * this._h * 0.09;
        it.sprite.rotation = Math.cos(leapPhase) * 0.4 * arc;
        it.sprite.skew.y = Math.sin(leapPhase * 2) * 0.08 * arc; // 跳躍中だけ体をしならせる
      } else if (this.def.kind === 'shark') {
        // 静かに巡回。控えめなうねりとロール + 遊泳らしいS字のうねり + 尾の一振りで推進感
        y += Math.sin(this._t * 0.8 + it.phase) * this._h * 0.007;
        it.sprite.rotation = Math.sin(this._t * 0.8 + it.phase) * 0.035;
        it.sprite.skew.y = Math.sin(this._t * 2.2 + it.phase) * 0.09;
        it.sprite.scale.x = it._baseScale * (1 + Math.sin(this._t * 2.2 + it.phase) * 0.03) * (it._facingSign ?? 1);
      } else if (this.def.kind === 'bird') {
        // 滑空 + 時々の羽ばたき(縦スケールで表現)
        y += Math.sin(this._t * 1.3 + it.phase) * this._h * 0.012;
        const flap = Math.max(0, Math.sin(this._t * 6.5 + it.phase * 3));
        it.sprite.scale.y = it.sprite.scale.x * (1 - flap * 0.16);
        it.sprite.rotation = Math.sin(this._t * 1.3 + it.phase) * 0.08;
      }

      const sx = it.x - scrollX;

      // 鳴き声などは spawn直後(画面外)ではなく、画面中央あたりを通る時に鳴らす(#イルカ/鯨)
      if (this.def.sfxAtCenter && !it._sfxFired) {
        const centerRatio = this.def.sfxCenterRatio ?? 0.55;
        const triggerX = it.reverse ? this._w * (1 - centerRatio) : this._w * centerRatio;
        const crossed = it.reverse ? sx >= triggerX : sx <= triggerX;
        if (crossed) {
          it._sfxFired = true;
          this.onCenterPass?.(this.def.id);
        }
      }

      // 小魚の群れが亀の周りで割れる(#世界の反応)
      if (this.def.kind === 'fish' && this.schoolAvoid) {
        const av = this.schoolAvoid;
        const r = this._h * (av.radiusRatio ?? 0.15);
        const ddx = sx - tx;
        const ddy = y - ty;
        const dist = Math.hypot(ddx, ddy) || 1;
        let taX = 0;
        let taY = 0;
        if (dist < r) {
          const push = (r - dist) / r;
          taX = (ddx / dist) * push * (av.strengthPx ?? 52);
          taY = (ddy / dist) * push * (av.strengthPx ?? 52) * 1.4;
        }
        const ease = clamp(6 * dt, 0, 1);
        it._avoidX += (taX - it._avoidX) * ease;
        it._avoidY += (taY - it._avoidY) * ease;
      }

      it.wrap.position.set(sx + it._avoidX, y + it._avoidY);

      // 夜の沈み込み + 深さによる暗さ(#サメ等の深い位置の生物が明るすぎて浮いて見える対策)
      // イルカも透明フェードではなく、周りの魚/サメと同じ depthTint の暗さで水中感を出す(#周りと違って浮く対策)
      if (nightTint || this.def.depthTint) {
        let col = 0xffffff;
        if (nightTint) col = lerpColor(col, nightTint, (tod.nightness ?? 0) * 0.7);
        if (this.def.depthTint) {
          const belowPx = Math.max(0, y - this.waterLineY);
          const range = this._h * (this.def.depthFadeRangeRatio ?? 0.22);
          const depthK = clamp(belowPx / range, 0, 1) * (this.def.depthTintStrength ?? 0.5);
          col = lerpColor(col, this.def.depthTint, depthK);
        }
        it.sprite.tint = col;
      }

      if (it.glow) {
        const dist = Math.hypot(sx - tx, y - ty);
        const near = clamp(1 - dist / (this._h * 0.5), 0, 1);
        const pulse = 0.85 + 0.15 * Math.sin(this._t * 3 + it.phase);
        it.glow.alpha = (it.glowBase + near * 0.95) * pulse;
        it.glow.width = it.glow.height = this._h * this.def.heightRatio * 3.4 * it._scale * (1 + near * 0.55);
      }

      // 環境の微反応(#13): 亀が近くをかすめるとマンタは一度バンク、クラゲは強く脈動
      if (this.react) {
        it._reactCd -= dt;
        if (it._react > 0) {
          it._react -= dt;
          const k = 1 - Math.max(0, it._react) / this.react.durationSec;
          const s = Math.sin(k * Math.PI); // 0→1→0
          if (this.def.kind === 'manta') {
            it.sprite.rotation = s * 0.95;
          } else if (this.def.kind === 'jellyfish') {
            // #バグ: it._scale(サイズのばらつき係数, 例0.6〜1.1)を使うと実スケールの
            // 何倍にもなって一瞬で巨大化していた。実スケール(_baseScale)を基準にする。
            it.sprite.scale.set(it._baseScale * (1 - s * 0.2), it._baseScale * (1 + s * 0.14));
            if (it.glow) it.glow.alpha += s * 0.7;
          }
        } else if (it._reactCd <= 0) {
          const d = Math.hypot(sx - tx, y - ty);
          if (d < this._h * this.react.reactRadiusRatio) {
            it._react = this.react.durationSec;
            it._reactCd = this.react.cooldownSec;
          }
        }
      }

      // 再利用判定はスクリーン座標 sx で行う(it.x はワールド座標で経過とともに増え続けるため)
      // 逆走個体(右へ抜けていく)は右端で回収する。
      if (it.reverse ? sx > this._w * 1.4 : sx < -this._w * 0.4) {
        it.active = false;
        it.wrap.visible = false;
      }
    }
  }
}
