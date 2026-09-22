import { Container, Sprite, Texture } from 'pixi.js';
import gsap from 'gsap';
import { SeaLayer } from './SeaLayer.js';
import { SkyLayer } from './SkyLayer.js';
import { DecorLayer } from './DecorLayer.js';
import { CreatureLayer } from './CreatureLayer.js';
import { SpriteDecorLayer } from './SpriteDecorLayer.js';
import { CoastalVista } from './CoastalVista.js';
import { Slipstream } from './Slipstream.js';
import { ChargeAura } from './ChargeAura.js';
import { RareEvents } from './RareEvents.js';
import { Turtle } from './Turtle.js';
import { Vignette } from './Vignette.js';
import { GrainOverlay } from './GrainOverlay.js';
import { FoliageFrame } from './FoliageFrame.js';
import { DiveOverlay } from './DiveOverlay.js';
import { WeddingClimax } from './WeddingClimax.js';
import { MotionLines } from './MotionLines.js';
import { FlightController } from '../systems/FlightController.js';
import { TimeOfDay } from '../systems/TimeOfDay.js';
import { ParticlePool } from '../systems/ParticlePool.js';
import { OrbField } from '../systems/OrbField.js';
import { BouquetGauge } from '../systems/BouquetGauge.js';
import { toHexNumber } from '../systems/colorUtils.js';
import { clamp } from '../systems/mathUtils.js';

/**
 * ParallaxScene
 * -------------
 * 全表示・全システムのオーケストレーター。
 *
 * 操作モデル(1軸):
 *   前進は常に一定。押している間は上昇、離すと基準高度(水面すぐ上)へ下降。
 *   高所から離すと勢いで水面を突き抜けて「軽い潜り」。
 *
 * 表示ツリー(奥→手前):
 *   backgroundTint → worldContainer( 空 → 雲 → イルカ → 島 → 結婚式 →
 *     マンタ/小魚 → 珊瑚 → クラゲ → 水面 → 影 → パーティクル → 亀 )
 *   → 潜水ティント → オーブ → ビネット → 前景の植物フレーム → グレイン
 */
export class ParallaxScene {
  constructor(config, assets, hooks = {}) {
    this.config = config;
    this.hooks = hooks; // { onGauge(fill, stage, leveledUp) }
    this.stage = new Container();

    this.backgroundTint = new Sprite(Texture.WHITE);
    this.backgroundTint.tint = toHexNumber(config.world.backgroundColor);
    this.stage.addChild(this.backgroundTint);

    this.worldContainer = new Container();
    this.stage.addChild(this.worldContainer);

    this.timeOfDay = new TimeOfDay(config.timeOfDay);
    this.waterLineRatio = config.world.waterLineRatio;

    this.sky = new SkyLayer(config.sky, config.timeOfDay);
    this.sea = new SeaLayer(config.sea);

    const decorTex = {
      ...(assets.islandSprites ?? {}),
      ...(assets.cloudSprites ?? {}),
      ...(assets.coralSprites ?? {}),
      ...(assets.grassSprites ?? {}),
    };
    this.decorLayers = config.decorLayers.map((def, i) => new DecorLayer(def, 1000 + i * 37, decorTex));
    this.decorByKind = {};
    this.decorLayers.forEach((l) => (this.decorByKind[l.def.kind] = l));
    this.cloudLayers = this.decorLayers.filter((l) => l.def.kind === 'cloud'); // 3層(遠→近)

    this.coastalVista = new CoastalVista(
      config.coastalVista,
      9090,
      { ...(assets.vista ?? {}), ...(assets.spriteDecor ?? {}) },
    );

    this.creatureLayers = config.creatureLayers.map((def, i) => new CreatureLayer(def, 5000 + i * 91, assets.creatures ?? {}));
    const mr = config.contemplative?.microReactions;
    const schoolAvoid = config.contemplative?.schoolAvoid;
    this.creatureLayers.forEach((l) => {
      l.onSpawn = (id) => {
        if (id === 'yacht') this.hooks.sfx?.yacht?.();
        else if (id === 'airplane') this.hooks.sfx?.airplane?.();
      };
      // イルカ/鯨の鳴き声は spawn直後(画面外)ではなく画面中央あたりを通る時に鳴らす
      l.onCenterPass = (id) => {
        if (id === 'dolphin') this.hooks.sfx?.dolphin?.();
        else if (id === 'whale') this.hooks.sfx?.whale?.();
      };
      if (mr?.enabled !== false) l.react = mr?.[l.def.kind] ?? null;
      if (l.def.kind === 'fish') l.schoolAvoid = schoolAvoid ?? null;
    });
    this.slipstream = new Slipstream(config.contemplative?.slipstream, 2468);
    this.chargeAura = new ChargeAura(config.flight);
    this.rareEvents = new RareEvents(config.rareEvents, 33221, {
      meteorShower: (n) => this.sky.spawnMeteorShower(n),
      shootingStar: () => this.sky.spawnShootingStar(),
    });
    this._audioWave = 1;
    this._audioFlap = 1;
    this._audioBlink = 0;
    this._audioSparkle = 0;
    this._waveBoost = 0;
    this._waveVel = 0;
    this._sparkleBoost = 0;
    this._sparkleVel = 0;
    this._lastSparkleBoost = 0;
    this._prevSubmersion = 0;
    this._skimT = 0;
    this._skimBonus = 0;
    this._formationT = 0;
    this._formationBonus = 0;
    this.spriteDecorLayers = (config.spriteDecorLayers ?? []).map(
      (def, i) => new SpriteDecorLayer(def, 7000 + i * 53, assets.spriteDecor ?? {}),
    );
    this.spriteDecorById = {};
    this.spriteDecorLayers.forEach((l) => (this.spriteDecorById[l.def.id] = l));

    this.particles = new ParticlePool(config.particles, Math.random);
    this.creatureLayers.forEach((l) => (l.particles = this.particles));
    this.turtle = new Turtle(config.turtle, assets.turtle);
    this.bouquetGauge = new BouquetGauge(config.turtle.bouquet);
    // ゲージ→亀の背中へ、ブーケがふわっと飛んでいく演出用の一時スプライト(画面固定=stage直下)
    this._bouquetTex = assets.turtle?.bouquet ?? [];
    this._bouquetFlourish = new Sprite();
    this._bouquetFlourish.anchor.set(0.5);
    this._bouquetFlourish.visible = false;
    this._bouquetFlourish.alpha = 0;
    // ゲージアイコンのおおよその画面位置(overlay.jsの#tc-gauge-iconと合わせる。ズレたらconfigで微調整)
    this._gaugeIconScreenPos = config.turtle.bouquet.gaugeIconScreenPos ?? { x: 145, y: 60 };
    this.wedding = new WeddingClimax(config.wedding, this.particles, assets.wedding ?? {}, {
      onBouquetHandoff: (stage) => this._onBouquetHandoff(stage),
    });
    this._inputLocked = false;
    this._endingFired = false;

    this.turtleShadow = new Sprite(ParallaxScene._shadowTexture());
    this.turtleShadow.anchor.set(0.5);
    this.turtleShadow.tint = toHexNumber(config.turtle.shadow.color);

    this.motionLines = new MotionLines(config.turtle.motionLines);

    // --- worldContainer 構築(奥→手前) ---
    this.worldContainer.addChild(this.sky.container);
    this._addCreatureById('airplane');
    this._addCreatureById('bird'); // 鳥は飛行機と同じく雲の奥
    for (const l of this.cloudLayers) this.worldContainer.addChild(l.container); // 雲 遠→近
    this._addDecor('island');
    this.worldContainer.addChild(this.sea.distant); // 遠景の海(水平線の霞)
    this.worldContainer.addChild(this.rareEvents.back); // クジラのブリーチ(前景の波の奥)
    this.worldContainer.addChild(this.coastalVista.container); // 沿岸ヴィスタ(島より手前)
    this.worldContainer.addChild(this.wedding.container);
    this._addCreatureById('whale'); // 迷い鯨(水面をゆったり泳ぐ個体)。結婚式会場の島より手前に
    this.worldContainer.addChild(this.sea.container);
    this._addCreatureById('yacht');
    this._addCreatureById('dolphin'); // 水面を跳ねるので波の手前
    this._addDecor('coral');      // 水面の手前 = 浅瀬に立つ珊瑚として見える
    this._addDecor('grass');      // 海藻(珊瑚より頻度高め)
    this._addSpriteDecor('reef-critters'); // カニ / ロブスター(海底)
    this._addCreatureById('manta');
    this._addCreatureById('shark');
    this._addCreatureById('fish-teal');
    this._addCreatureById('fish-yellow');
    this._addCreatureById('jellyfish');
    this.worldContainer.addChild(this.slipstream.container); // 光の流れ(亀の少し奥)
    this.worldContainer.addChild(this.chargeAura.container); // 潜水チャージのオーラ(亀の奥)
    this.worldContainer.addChild(this.turtleShadow);
    this.worldContainer.addChild(this.particles.container);
    this.worldContainer.addChild(this.motionLines.g);
    this.worldContainer.addChild(this.turtle.container);

    // --- オーバーレイ ---
    this.dive = new DiveOverlay(config.dive);
    // 画面全体の青ティントは廃止(亀だけを沈める方式に変更、#Turtle.setSubmersionTint)。
    // bubbleRate / celestialDim は引き続き使うので DiveOverlay 自体は残すが、sprite は stage に乗せない。

    this.orbs = new OrbField(config.orbs, (semis) => this._onOrbCollected(semis));
    this.stage.addChild(this.orbs.container);
    this.stage.addChild(this._bouquetFlourish);

    this.vignette = new Vignette(config.vignette);
    this.stage.addChild(this.vignette.sprite);

    if (config.foliage?.enabled) {
      this.foliage = new FoliageFrame(config.foliage, assets.foliageSprites ?? {});
      this.stage.addChild(this.foliage.container);
    }
    this.stage.addChild(this.rareEvents.front); // 通り雨(最前面。植物フレームより前)

    if (config.grain?.enabled) {
      this.grain = new GrainOverlay(config.grain);
      this.stage.addChild(this.grain.sprite);
    }

    this.flight = new FlightController(config.flight);
    this.currentTilt = 0;
    this.started = false; // オープニング(attract)中は時間を止めて生き物を出さない
    this.flight.setForwardScale(0.3);

    this._width = 0;
    this._height = 0;
    this._prevWorldX = 0;
    this._t = 0;
  }

  /** 「タップして開始」後に呼ぶ。時間帯サイクルと生き物の出現が動き出す。 */
  setRunning(v) {
    this.started = v;
    this.flight.setForwardScale(v ? 1 : 0.3);
    this.creatureLayers.forEach((l) => l.setSpawning(v));
  }

  /** オーブ収集時: 夜空の星 + ブーケゲージ。満タンでブーケが1段階進む。 */
  _onOrbCollected(semis = 0) {
    this.sky.addOrbStar();
    this.hooks.sfx?.orb?.(semis); // オーブチェイン: 連続収集で半音上がる(#13)
    const r = this.bouquetGauge.addOrb();
    if (r.leveledUp) this._flyBouquetToTurtle(r.stage);
    this.hooks.onGauge?.(this.bouquetGauge.fill, this.bouquetGauge.stage, r.leveledUp);
  }

  /** ゲージのブーケが、弧を描きながら亀の背中へふわっと飛んでいく演出。 */
  _flyBouquetToTurtle(stage) {
    const tex = this._bouquetTex[stage - 1];
    if (!tex) { this.turtle.setBouquetStage(stage); return; }

    const start = this._gaugeIconScreenPos;
    const fl = this._bouquetFlourish;
    fl.texture = tex;
    const targetW = (this.turtle.config?.bouquet?.sizePx ?? 300) * (this.turtle.container.scale.x ?? 1);
    const baseScale = targetW / (tex.width || 1);

    fl.position.set(start.x, start.y);
    fl.scale.set(baseScale * 0.4);
    fl.rotation = -0.3;
    fl.alpha = 0;
    fl.visible = true;

    const end = this.turtle.bouquetScreenPos();
    const midX = (start.x + end.x) / 2;
    const midY = Math.min(start.y, end.y) - this._height * 0.16;

    const path = { t: 0 };
    gsap.killTweensOf(fl);
    gsap.killTweensOf(path);
    const tl = gsap.timeline({
      onComplete: () => {
        fl.visible = false;
        this.turtle.setBouquetStage(stage);
        this.orbs.burstAt(end.x, end.y);
      },
    });
    tl.to(fl, { alpha: 1, duration: 0.18, ease: 'sine.out' }, 0);
    tl.to(path, {
      t: 1,
      duration: 0.85,
      ease: 'power2.inOut',
      onUpdate: () => {
        const t = path.t;
        const x = (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * midX + t * t * end.x;
        const y = (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * midY + t * t * end.y;
        fl.position.set(x, y);
      },
    }, 0);
    tl.to(fl.scale, { x: baseScale, y: baseScale, duration: 0.85, ease: 'back.out(1.4)' }, 0);
    tl.to(fl, { rotation: 0.12, duration: 0.85, ease: 'sine.inOut' }, 0);
    tl.to(fl, { alpha: 0.85, duration: 0.15, ease: 'sine.in' }, 0.7);
  }

  /** 到着ビート: ブーケが甲羅から離れ、カップルの傍らへ(ゲージ未達ならスキップ)。 */
  _onBouquetHandoff(stage) {
    if (stage > 0) {
      this._flyBouquetToCouple(stage);
      this.hooks.onBouquetHandoff?.();
    }
    this.hooks.onWeddingArrival?.();
  }

  /** ブーケが亀の背中から離れ、風に乗るようにゆっくり漂ってカップルの元へ届く演出。 */
  _flyBouquetToCouple(stage) {
    const tex = this._bouquetTex[stage - 1];
    const start = this.turtle.bouquetScreenPos();
    this.turtle.setBouquetStage(0); // 甲羅からはここで離れる

    if (!tex) return;

    const fl = this._bouquetFlourish;
    const targetW = (this.turtle.config?.bouquet?.sizePx ?? 300) * (this.turtle.container.scale.x ?? 1);
    const baseScale = targetW / (tex.width || 1);

    fl.texture = tex;
    fl.position.set(start.x, start.y);
    fl.scale.set(baseScale);
    fl.rotation = 0;
    fl.alpha = 1;
    fl.visible = true;

    const couple = this.wedding.couple;
    const end = { x: couple.position.x + this._width * 0.015, y: couple.position.y - couple.height * 0.32 };
    const bow = start.x < end.x ? -1 : 1;
    const midX = (start.x + end.x) / 2 + bow * this._width * 0.03;
    const midY = Math.min(start.y, end.y) - this._height * 0.15;

    const path = { t: 0 };
    gsap.killTweensOf(fl);
    gsap.killTweensOf(path);
    const tl = gsap.timeline({
      onComplete: () => {
        fl.visible = false;
        this.orbs.burstAt(end.x, end.y);
      },
    });
    // 弧を描く放物線に、風に揺れるような小さな上下の揺らぎを重ねる(直線的な"投げ"ではなく漂う感じ)
    tl.to(path, {
      t: 1,
      duration: 1.8,
      ease: 'sine.inOut',
      onUpdate: () => {
        const t = path.t;
        const x = (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * midX + t * t * end.x;
        const y = (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * midY + t * t * end.y;
        const drift = Math.sin(t * Math.PI * 2.4) * this._height * 0.014 * Math.sin(t * Math.PI);
        fl.position.set(x, y + drift);
      },
    }, 0);
    tl.to(fl, { rotation: bow * 0.55, duration: 1.8, ease: 'sine.inOut' }, 0);
    tl.to(fl.scale, { x: baseScale * 0.5, y: baseScale * 0.5, duration: 1.8, ease: 'sine.inOut' }, 0);
    tl.to(fl, { alpha: 0, duration: 0.4, ease: 'sine.in' }, 1.4);
  }

  _addDecor(kind) {
    const l = this.decorLayers.find((d) => d.def.kind === kind);
    if (l) this.worldContainer.addChild(l.container);
  }

  _addCreatureById(id) {
    const l = this.creatureLayers.find((c) => c.def.id === id);
    if (l) this.worldContainer.addChild(l.container);
  }

  _addSpriteDecor(id) {
    const l = this.spriteDecorById[id];
    if (l) this.worldContainer.addChild(l.container);
  }

  resize(width, height) {
    this._width = width;
    this._height = height;
    const waterLineY = height * this.waterLineRatio;

    this.backgroundTint.width = width;
    this.backgroundTint.height = height;

    this.sky.resize(width, height);
    this.sea.resize(width, height, waterLineY);
    this.decorLayers.forEach((l) => l.resize(width, height, waterLineY));
    this.creatureLayers.forEach((l) => l.resize(width, height, waterLineY));
    this.spriteDecorLayers.forEach((l) => l.resize(width, height, waterLineY));
    this.coastalVista.resize(width, height, waterLineY);
    this.slipstream.resize(width, height);
    this.rareEvents.resize(width, height, waterLineY);
    this.wedding.resize(width, height, waterLineY);
    this.dive.resize(width, height);
    this.orbs.resize(width, height);
    this.vignette.resize(width, height);
    this.foliage?.resize(width, height);
    this.grain?.resize(width, height);
    this.flight.resize(width, height, waterLineY);
    this.turtle.applyScale(height);

    this._anchorX = width * this.config.turtle.spawnXRatio;
    this.turtle.setPosition(this._anchorX, this.flight.y);
  }

  /** 押している = 上昇 / 離している = 下降 */
  /** @param {number} dir  -1(下降ゾーン) / 0(維持) / +1(上昇ゾーン) */
  setVerticalInput(dir) {
    if (this._inputLocked) return;
    this.flight.setVerticalInput(dir);
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    this._t += dt;
    const w = this._width;
    const h = this._height;
    const tod = this.timeOfDay;

    if (this.started && !this.wedding.freezeTime) {
      tod.update(dt);
    }

    // --- 音楽の帯域別振幅リアクティブ(#8): 帯域ごとに別の見た目へ、はっきり分かるように ---
    const ar = this.config.audioReactive;
    if (this.started && ar?.enabled && this.hooks.audioBands) {
      const bands = this.hooks.audioBands();
      this.sky.setAudioLevel(bands.low * (ar.sunPulseGain ?? 6));        // 重低音 → 太陽/月が膨らむ
      this._audioLeaf = bands.midHigh * (ar.leafSwayGain ?? 6);          // 中高音 → 縁の葉が揺れる/膨らむ
      this._audioFlap = clamp(1 + bands.midHigh * (ar.flapSpeedGain ?? 1.1), 0.7, 1.4);

      // 波(低中音): 太陽/葉と同じ「キック&バネ」方式。生の偏差を振幅に直接掛けるだけだと
      // 波が常にゆらいでるノイズに埋もれて分からないので、ヒットで一気にうねり、ゆっくり収まる。
      const waveTarget = clamp(bands.midLow * (ar.waveKickGain ?? 7), -1, 1);
      this._waveVel += (waveTarget - this._waveBoost) * 20 * dt;
      this._waveVel *= Math.exp(-7 * dt);
      this._waveBoost += this._waveVel * dt;
      this._audioWave = clamp(1 + Math.max(0, this._waveBoost) * (ar.waveAmplitudeGain ?? 0.9), 0.85, 2.0);

      // きらめき(高音): オーブの点滅だけだと画面にオーブが無い瞬間は何も起きて見えない。
      // 常時表示されてる海面のスパークル(SeaLayer.speckle)を主役にする。オーブ点滅は従として残す。
      const sparkleTarget = clamp(bands.high * (ar.sparkleKickGain ?? 7), -1, 1);
      this._sparkleVel += (sparkleTarget - this._sparkleBoost) * 22 * dt;
      this._sparkleVel *= Math.exp(-8 * dt);
      this._sparkleBoost += this._sparkleVel * dt;
      this._audioSparkle = clamp(Math.max(0, this._sparkleBoost), 0, 1);
      this._audioBlink = bands.high * (ar.blinkGain ?? 2.3);

      // 高音のヒットで海面にきらめきバースト(#8: 常時の微妙な変化ではなく単発イベントで)
      const glintThresh = ar.glintThreshold ?? 0.5;
      if (this._sparkleBoost >= glintThresh && this._lastSparkleBoost < glintThresh) {
        this.particles.spawnGlints(ar.glintCount ?? 10, h * this.waterLineRatio, w);
      }
      this._lastSparkleBoost = this._sparkleBoost;
    } else {
      this._audioWave = 1;
      this._audioLeaf = 0;
      this._audioFlap = 1;
      this._audioBlink = 0;
      this._audioSparkle = 0;
      this.sky.setAudioLevel(0);
    }

    this.flight.update(dt);
    const worldX = this.flight.worldX;
    const y = this.flight.y;
    const vy = this.flight.vy;
    const dWorldX = worldX - this._prevWorldX;
    const waterLineY = h * this.waterLineRatio;

    this.wedding.update(tod, worldX, this.flight, dt, {
      anchorX: this._anchorX,
      turtle: this.turtle,
      bouquetStage: this.bouquetGauge.stage,
    });
    this._inputLocked = this.wedding.inputLocked;
    if (this._inputLocked) this.flight.setVerticalInput(0);
    if (this.started) this.flight.setForwardScale(this.wedding.forwardScaleOverride ?? 1);
    if (this.wedding.phase === 'done' && !this._endingFired) {
      this._endingFired = true;
      this.hooks.onEnding?.();
    }

    // --- 亀の傾き: vy に比例、maxTiltRad で tanh 飽和(上限を絶対に超えない) ---
    const tc = this.config.turtle.tilt;
    const m = tc.maxTiltRad;
    const tiltTarget = m * Math.tanh((vy * tc.velocityToTilt) / m);
    this.currentTilt += (tiltTarget - this.currentTilt) * tc.smoothing;
    this.currentTilt = clamp(this.currentTilt, -m, m);
    const vRatio = Math.abs(vy) / h;

    // 水面近くでのゆるやかな上下(視覚のみ、flight 状態には影響しない)
    const nearWater = clamp(1 - Math.abs(y - waterLineY) / (h * 0.25), 0, 1);
    const bob = Math.sin(this._t * 1.2) * h * 0.008 * nearWater;

    // 到着ビート/エピローグ中は wedding が亀の位置・傾きを制御
    const ov = this.wedding.turtleOverride;
    const turtleX = ov ? ov.x : this._anchorX;
    const turtleY = ov ? ov.y : y + bob;
    if (ov) this.currentTilt += ((ov.tilt ?? 0) - this.currentTilt) * 0.1;

    // --- レア演出(クジラ/通り雨/流星): 1ランに数回だけ ---
    if (this.started) this.rareEvents.update(tod.progress, dt, turtleX, turtleY);
    const inRain = this.rareEvents.inRain;

    // --- 上昇気流(#13): 内側に入ると軽いリフト。BGM は上昇気流でわずかに開き雨でこもる ---
    const upDraft = this.started ? this.slipstream.update(worldX, dt, turtleX, turtleY) : 0;
    if (this.started && !ov) {
      const sc = this.config.contemplative?.slipstream ?? {};
      if (upDraft > 0) this.flight.addUpdraftLift(upDraft * (sc.updraftLiftRatio ?? 0.6));
      const base = sc.bgmFilterBaseHz ?? 6500;
      const open = sc.bgmFilterOpenHz ?? 20000;
      let hz = base + (open - base) * upDraft;
      hz *= 1 - inRain * 0.5; // 通り雨はこもらせる
      this.hooks.bgmFilter?.(hz);
    }

    this.turtle.setPosition(turtleX, turtleY);
    this.turtle.update(dt, {
      verticalSpeedRatio: ov ? 0.02 : vRatio,
      tilt: this.currentTilt,
      flapRateScale: this._audioFlap,
    });

    this.motionLines.update(dt, {
      x: turtleX,
      y: turtleY,
      vy: ov ? 0 : vy,
      holding: !ov && this.flight.verticalInput > 0,
      sizePx: this.config.turtle.sizePx,
    });

    // --- 潜水 ---
    const submersion = this.flight.submersion;
    if (!ov && submersion > 0.08 && this._prevSubmersion <= 0.08) {
      this.hooks.sfx?.dive?.(clamp(0.4 + Math.abs(vy) / (h * 0.4), 0.3, 1));
    }
    this._prevSubmersion = submersion;

    // --- 潜水チャージのオーラ + リープ ---
    this.chargeAura.update(dt, {
      x: turtleX,
      y: turtleY,
      tier: ov ? 0 : this.flight.chargeTier,
      norm: this.flight.chargeNorm,
      leapTier: ov ? 0 : this.flight.leapTier,
      sizePx: this.config.turtle.sizePx,
    });
    if (!ov && this.flight.leapTier > 0) {
      this.hooks.sfx?.leap?.(this.flight.leapTier);
    }

    // --- リープ: 水面を勢いよく突き抜けた瞬間の飛沫 ---
    if (!ov && this._prevBreachSub > 0.04 && submersion <= 0.04 && vy < -h * 0.12) {
      this.hooks.sfx?.dive?.(0.9);
      const n = 2 + Math.round(Math.min(1, Math.abs(vy) / (h * 0.8)) * 3);
      for (let i = 0; i < n; i++) {
        this.particles.spawnSplash(turtleX + (Math.random() - 0.5) * 120, waterLineY);
      }
    }
    this._prevBreachSub = submersion;
    this.dive.update(submersion);
    this.sky.setCelestialDim(this.dive.celestialDim);
    // 画面全体を暗くするのはやめて、亀のパーツだけを水色に沈める(#潜水は亀の色で表現)
    this.turtle.setSubmersionTint(submersion);

    // --- 水面スキム・ボーナス(#13): 水面すれすれを維持すると飛沫 + 収集半径が広がる ---
    const skimCfg = this.config.contemplative?.skimming ?? {};
    let skimActive = false;
    if (skimCfg.enabled !== false && !ov) {
      const top = waterLineY - h * (skimCfg.bandTopRatio ?? 0.085);
      const bot = waterLineY - h * (skimCfg.bandBottomRatio ?? 0.006);
      const inBand = submersion < 0.03 && turtleY > top && turtleY < bot && Math.abs(vy) < h * 0.12;
      this._skimT = inBand ? this._skimT + dt : 0;
      skimActive = this._skimT > (skimCfg.thresholdSec ?? 0.9);
    } else {
      this._skimT = 0;
    }
    const skimRamp = dt / (skimCfg.rampSec ?? 1.4);
    this._skimBonus = clamp(this._skimBonus + (skimActive ? skimRamp : -skimRamp), 0, 1);
    if (skimActive) {
      this._skimSplashAcc = (this._skimSplashAcc ?? 0) + dt * (skimCfg.splashPerSec ?? 14);
      while (this._skimSplashAcc >= 1) {
        this._skimSplashAcc -= 1;
        this.particles.spawnSplash(turtleX + (Math.random() - 0.5) * 64, waterLineY);
      }
    }

    // --- 並走ボーナス(#8): イルカ/鳥/鯨に一定時間近づき続けると、水面スキムと同じ軽い視覚ボーナス ---
    const fcfg = this.config.contemplative?.formation ?? {};
    let formationActive = false;
    let formationX = turtleX;
    let formationY = turtleY;
    if (fcfg.enabled !== false && this.started && !ov) {
      const r = h * (fcfg.formationRadiusRatio ?? 0.14);
      let bestDist = Infinity;
      for (const id of fcfg.companionIds ?? ['dolphin', 'bird', 'whale']) {
        const l = this.creatureLayers.find((c) => c.def.id === id);
        if (!l) continue;
        for (const it of l.items) {
          if (!it.active) continue;
          const d = Math.hypot(it.wrap.position.x - turtleX, it.wrap.position.y - turtleY);
          if (d < bestDist) {
            bestDist = d;
            formationX = it.wrap.position.x;
            formationY = it.wrap.position.y;
          }
        }
      }
      this._formationT = bestDist < r ? (this._formationT ?? 0) + dt : 0;
      formationActive = this._formationT > (fcfg.thresholdSec ?? 1.4);
    } else {
      this._formationT = 0;
    }
    const formationRamp = dt / (fcfg.rampSec ?? 1.6);
    this._formationBonus = clamp((this._formationBonus ?? 0) + (formationActive ? formationRamp : -formationRamp), 0, 1);
    if (formationActive) {
      this._formationSparkleAcc = (this._formationSparkleAcc ?? 0) + dt * (fcfg.sparklePerSec ?? 3);
      while (this._formationSparkleAcc >= 1) {
        this._formationSparkleAcc -= 1;
        this.particles.spawnWake(formationX + (Math.random() - 0.5) * 40, formationY + (Math.random() - 0.5) * 40);
      }
    }

    // スキム・並走のどちらか強い方をオーブ収集半径に反映(数値UIには出さない)
    const collectBonusK = Math.max(this._skimBonus, this._formationBonus);
    this.orbs.setCollectRadiusScale(1 + collectBonusK * ((skimCfg.collectRadiusScale ?? 1.9) - 1));

    // --- 影(水面に落ちる) ---
    const altitude = clamp((waterLineY - turtleY) / (h * 0.35), 0, 1);
    const sh = this.config.turtle.shadow;
    if (sh.enabled) {
      this.turtleShadow.visible = submersion < 0.9 && !ov;
      this.turtleShadow.position.set(turtleX, waterLineY + 4);
      this.turtleShadow.width = this.config.turtle.sizePx * (0.5 + altitude * 0.7);
      this.turtleShadow.height = this.turtleShadow.width * 0.26;
      this.turtleShadow.alpha = sh.maxAlpha * (1 - altitude) * (1 - submersion);
    }

    // --- パーティクル ---
    // チャージ中は泡が増える(圧が溜まる感じ)
    const chargeBub = 1 + this.flight.chargeNorm * 2.5;
    this._bubbleAcc = (this._bubbleAcc ?? 0) + dt * submersion * this.config.dive.bubbleRatePerSec * chargeBub;
    while (this._bubbleAcc >= 1) {
      this._bubbleAcc -= 1;
      this.particles.spawnBubble(this._anchorX + (Math.random() - 0.5) * 40, y + 10);
    }
    // オーブチェイン(#13): 連続収集中は航跡がわずかに増える・長持ちする
    const chainBoost = 1 + this.orbs.chainLevel * (this.config.contemplative?.orbChain?.wakeBoostPerLevel ?? 0.22);
    this._wakeAcc = (this._wakeAcc ?? 0) + dt * this.config.particles.wake.spawnPerSec * (0.4 + vRatio * 5) * chainBoost;
    while (this._wakeAcc >= 1) {
      this._wakeAcc -= 1;
      if (!ov) this.particles.spawnWake(this._anchorX - 34 + (Math.random() - 0.5) * 22, y + (Math.random() - 0.5) * 26, chainBoost);
    }
    if (!ov && this.turtle.downstroke && submersion < 0.12 && altitude < 0.25) {
      const tip = this.turtle.flipperTip();
      this.particles.spawnSplash(tip.x, waterLineY);
    }

    // --- 背景 ---
    this.sky.update(tod, dt);
    this.sky.scroll(worldX);

    const pal = this.config.palette;
    const haze = tod.color('skyHorizon'); // 空気遠近法の霞色(共通)
    const cloudTones = tod.phaseTones(pal.cloud);
    const sunX = tod.celestialPos(w, h).x / Math.max(1, w);
    for (const l of this.cloudLayers) l.update(worldX, 0, cloudTones, dt, haze, sunX);
    this.decorByKind.island?.update(worldX, 0, tod.phaseTones(pal.island), dt, haze);
    this.decorByKind.coral?.update(worldX, 0, tod.phaseTones(pal.coral), dt, haze);
    this.decorByKind.grass?.update(worldX, 0, tod.phaseTones(pal.coral), dt, haze);

    if (this.started) this.coastalVista.update(worldX, tod, dt);

    const creatureCtx = { turtleX, turtleY };
    for (const c of this.creatureLayers) {
      c.update(tod, worldX, 0, dt, creatureCtx);
    }
    for (const l of this.spriteDecorLayers) l.update(worldX, tod, dt);

    this.sea.setSeaColor(tod.color('sea'));
    this.sea.update(worldX, dt, haze, this._audioWave, this._audioSparkle, Math.max(0, this._waveBoost));

    this.orbs.setAudioBlink(this._audioBlink);
    this.orbs.update(dt, this._anchorX, y);
    this.particles.update(dt, dWorldX, 0);

    this.foliage?.update(tod.phaseTones(pal.foliage), dt, this._audioLeaf);
    this.grain?.update();

    this._prevWorldX = worldX;
  }


  static _shadowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return Texture.from(canvas);
  }
}
