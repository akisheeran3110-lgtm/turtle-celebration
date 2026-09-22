import { sampleGradient, lerpColor } from './colorUtils.js';
import { clamp, smoothstep, easeInOut, TAU } from './mathUtils.js';

/**
 * TimeOfDay
 * ---------
 * 1セッション = 1サイクル(朝→昼→夕→夜→朝…)。
 * progress は 0〜1 でループし、durationSeconds(既定 1980 = BGM 33分)で一周する。
 *
 * 提供するもの:
 *   - progress / phaseName        現在の進行度と時間帯名
 *   - skyTop / skyHorizon / sea   グラデーション色(ease-in-out 補間済み)
 *   - celestialPos(w,h)           太陽/月のスクリーン座標(弧を描く)
 *   - celestialColor / isMoon     太陽・月の色と切り替え
 *   - starAlpha                   夜の星の不透明度(フェードのみ)
 */
export class TimeOfDay {
  constructor(config) {
    this.config = config;
    this.progress = ((config.startProgress ?? 0) % 1 + 1) % 1;
    this._elapsed = this.progress * config.durationSeconds;
  }

  update(dt) {
    if (!this.config.enabled) return;
    this._elapsed += dt;
    const raw = this._elapsed / this.config.durationSeconds;
    // ループ廃止: 1ラン = 朝→夜 の一本道。progress は 1 で頭打ち。
    this.progress = this.config.loop === false ? Math.min(raw, 1) : raw % 1;
  }

  /** テスト/デバッグ用 */
  setProgress(p) {
    this.progress = ((p % 1) + 1) % 1;
    this._elapsed = this.progress * this.config.durationSeconds;
  }

  get phaseName() {
    const phases = this.config.phases;
    let name = phases[0].name;
    for (const ph of phases) {
      if (this.progress >= ph.t) name = ph.name;
    }
    return name;
  }

  color(key) {
    return sampleGradient(this.config.gradientStops, this.progress, key);
  }

  /**
   * { dawn, midday, sunset, night } の色マップを、現在の progress で
   * 時間帯どうし ease-in-out 補間して返す。night→dawn(周回)もつなぐ。
   */
  phaseColor(map) {
    const [cur, next, lt] = this._phaseSpan();
    return lerpColor(map[cur], map[next], lt);
  }

  /**
   * { dawn:{mid,dark,rim,...}, ... } のトーンマップを、各キーごとに補間して返す。
   */
  phaseTones(map) {
    const [cur, next, lt] = this._phaseSpan();
    const a = map[cur];
    const b = map[next];
    const out = {};
    for (const k of Object.keys(a)) out[k] = lerpColor(a[k], b[k] ?? a[k], lt);
    return out;
  }

  _phaseSpan() {
    const phases = this.config.phases;
    const p = this.progress;
    for (let i = 0; i < phases.length; i++) {
      const cur = phases[i];
      const next = phases[i + 1];
      const hi = next ? next.t : 1;
      const nextName = next ? next.name : phases[0].name;
      if (p >= cur.t && p <= hi) {
        return [cur.name, nextName, easeInOut((p - cur.t) / (hi - cur.t || 1))];
      }
    }
    return [phases[0].name, phases[0].name, 0];
  }

  /**
   * 太陽/月の位置。朝=左下、昼=頂点、夕=右下 の弧。夜は月が同じ弧を辿る。
   * 昼夜それぞれの区間内で 0→1 に正規化して弧を進める。
   */
  celestialPos(width, height) {
    const c = this.config.celestial;
    const margin = width * c.arcMarginRatio;
    const nightStart = this._nightStart();

    let seg; // 0..1 その天体の弧の進行度
    if (this.progress < nightStart) {
      seg = this.progress / nightStart;
    } else {
      seg = (this.progress - nightStart) / (1 - nightStart);
    }
    const x = margin + (width - margin * 2) * seg;
    const arc = Math.sin(seg * Math.PI); // 0→1→0
    // 弧の基準は水平線。日の出/日の入りは水平線すれすれから昇る。
    const horizonY = height * (c.horizonRatio ?? 0.6);
    const y = horizonY + height * 0.03 - arc * height * c.arcHeightRatio;
    return { x, y };
  }

  get isMoon() {
    return this.progress >= this._nightStart();
  }

  celestialColor() {
    const c = this.config.celestial;
    if (this.isMoon) return c.moonColor;
    // 朝夕は暖色、昼は白に近い黄
    const p = this.progress;
    const noon = this._nightStart() * 0.5;
    const toNoon = smoothstep(0, noon, p) * (1 - smoothstep(noon, this._nightStart(), p));
    return toNoon > 0.5 ? c.sunColorMidday : p < noon ? c.sunColorDawn : c.sunColorSunset;
  }

  get starAlpha() {
    const s = this.config.stars;
    // 夜に向けてフェードイン、朝に向けてフェードアウト(sunset→night→dawn)
    const inA = smoothstep(s.fadeInFrom, s.fullyVisibleAt, this.progress);
    const outA = 1 - smoothstep(0.97, 1.0, this.progress); // 周回直前で軽く落とす
    return clamp(inA * outA, 0, 1);
  }

  _nightStart() {
    const night = this.config.phases.find((p) => p.name === 'night');
    return night ? night.t : 0.82;
  }

  /** 進行度から夜らしさ 0〜1(潜水以外のティント等に使える) */
  get nightness() {
    return this.starAlpha;
  }

  /** 弧の "太陽高度" 0〜1(1=頂点)。潜水フェード等の参考に。 */
  daylight() {
    const nightStart = this._nightStart();
    if (this.progress >= nightStart) return 0;
    return Math.sin((this.progress / nightStart) * Math.PI);
  }

  static twinklePhase(i) {
    return (i * 12.9898) % TAU;
  }
}
