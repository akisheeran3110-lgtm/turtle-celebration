/**
 * BouquetGauge
 * ------------
 * オーブ収集の主な「報われ方」。数値は出さないが、バーは可視化する。
 *
 *  - fill: 現ステージ内の進捗 0〜1
 *  - stage: 0(ブーケなし)→ 1..maxStage(段階的に大きく/豪華に)
 *  - オーブ収集ごとに fill += 1/orbsPerStage[stage]。満タンで stage++、fill=0。
 *  - stage maxStage 到達後はカンスト(fill は満タン表示のまま、以降変化なし)。
 */
export class BouquetGauge {
  constructor(cfg = {}) {
    this.maxStage = cfg.maxStage ?? 5;
    this._orbsPerStage = cfg.orbsPerStage ?? 8;
    this.fill = 0;
    this.stage = 0;
  }

  /** stage(1-indexed、これから到達する段)に必要なオーブ数 */
  _orbsFor(stage) {
    if (Array.isArray(this._orbsPerStage)) {
      const i = Math.min(stage, this._orbsPerStage.length) - 1;
      return this._orbsPerStage[Math.max(0, i)] ?? 8;
    }
    return this._orbsPerStage ?? 8;
  }

  /** @returns {{leveledUp:boolean, stage:number, fill:number}} */
  addOrb() {
    if (this.stage >= this.maxStage) {
      return { leveledUp: false, stage: this.stage, fill: 1 };
    }
    this.fill += 1 / this._orbsFor(this.stage + 1);
    let leveledUp = false;
    if (this.fill >= 1) {
      this.stage += 1;
      leveledUp = true;
      this.fill = this.stage >= this.maxStage ? 1 : 0;
    }
    return { leveledUp, stage: this.stage, fill: this.fill };
  }

  reset() {
    this.fill = 0;
    this.stage = 0;
  }
}
