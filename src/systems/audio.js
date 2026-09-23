/**
 * audio.js
 * --------
 * BGM は素の <audio>(HTMLMediaElement)でストリーミング再生し、
 * ユーザー操作(タップ開始)の中で Web Audio グラフを組む:
 *
 *   <audio> ─ MediaElementSource ─ AnalyserNode ─ bgmGain ─▶ destination
 *                                       │
 *                                  (帯域別振幅の解析タップ。gain より前なので
 *                                   ミュートしても解析は生き続ける)
 *   SFX(合成音)───────────────── sfxGain ──────────────▶ destination
 *
 * - 編集版・11分04秒(664秒)の1本の音源(`public/bgm.mp3`)。ループなし。
 *   ゲーム本編は約8分30秒(`timeOfDay.durationSeconds`)で終わるので、終了画面に入っても
 *   BGMをフェードアウトせずそのまま流し続け、残りの約2分半は終了画面のBGMとして自然に聴かせる
 *   (`endSession()`。曲自体が `loop:false` なので最後まで流れたら自然に停止する)。
 * - ミュートは bgmGain を 0 にするだけ(再生・帯域解析は止めない)。
 * - タブ復帰時は 0 → 目標値へ 1〜2 秒フェードイン。
 * - Web Audio が使えない環境では el.volume 直接制御にフォールバック(SFX/解析なし)。
 */
export class BgmPlayer {
  constructor(config, reactiveConfig) {
    this.config = config;
    this.reactive = reactiveConfig ?? {};
    this.muted = false;
    this._level = config.volume ?? 0.85; // 目標 BGM レベル(ミュート状態とは独立)
    this._ended = false;
    this._ramp = null;
    this._graph = false;
    this._graphFailed = false;

    const el = new Audio();
    el.src = config.src;
    el.loop = config.loop !== false;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.volume = this._level; // グラフ成立後は gain 側で制御(el.volume は 1 相当に上げる)
    this.el = el;
    this._available = true;
    el.addEventListener('error', () => {
      console.error('[BGM] <audio> error:', el.error?.code, el.error?.message);
      this._available = false;
    });
    // #効果音が鳴った後にだけBGMが鳴り出す、の原因切り分け用ログ。
    // 一定期間残す想定(原因特定でき次第まとめて削除する)。
    for (const ev of ['play', 'playing', 'pause', 'stalled', 'waiting', 'suspend', 'ended']) {
      el.addEventListener(ev, () => console.log(`[BGM] <audio> event: ${ev} (paused=${el.paused}, currentTime=${el.currentTime.toFixed(2)})`));
    }

    // 帯域解析の状態(署名付き偏差 = 各帯域の緩やかな平均からのズレ)
    this._bandNow = { low: 0, midLow: 0, midHigh: 0, high: 0 };
    this._bandBase = { low: 0, midLow: 0, midHigh: 0, high: 0 };
    this._bandSeeded = { low: false, midLow: false, midHigh: false, high: false };
    this.bands = { low: 0, midLow: 0, midHigh: 0, high: 0 };

    // (以前はここで _ensureGraph() を呼び、ページ読み込み時に前もって
    // AudioContext を作っていたが、実機ログで「ユーザー操作より前に作った
    // context は resume() が30秒以上効かないことがある」ことが判明したため
    // 撤回。グラフはタップ処理(start())の中で作る、元の形に戻す。)
  }

  async start() {
    if (!this._available) return;
    this._ensureGraph();
    // iOS Safari等では、AudioContext.resume() + <audio>.play() だけだと
    // 実際の音声出力経路が開通しないことがあり、AudioBufferSourceNode を
    // ユーザー操作の延長で一度 start() するまで音が出ないことがある。
    // (このアンロックはグラフ生成そのものより後、ここ = 実際のタップ処理の
    // 中で行う必要がある。ページ読み込み時に前もってグラフだけ作っておく
    // ように変更したため、アンロックはここに残す)
    if (this.ctx) {
      try {
        const unlockBuf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
        const unlockSrc = this.ctx.createBufferSource();
        unlockSrc.buffer = unlockBuf;
        unlockSrc.connect(this.ctx.destination);
        unlockSrc.start(0);
      } catch {
        // 無音アンロックに失敗しても致命的ではないので握りつぶす
      }
    }
    // #効果音が鳴らないとBGMが鳴らない: ctx.resume() を await してから el.play() を
    // 呼ぶと、el.play() の呼び出しが「ユーザー操作の直接の延長」ではなく
    // 「awaitを挟んだ後の非同期処理」とみなされ、一部のモバイルブラウザで
    // NotAllowedError として拒否されることがある(拒否されると _available=false
    // になり、以後BGMは二度と再生されない)。resume() の完了を待たず、
    // play() も同じ呼び出しの中で同時に発行することで、どちらもユーザー操作の
    // 直接の延長として扱われるようにする。
    const resumePromise = this.ctx && this.ctx.state === 'suspended'
      ? this.ctx.resume()
      : Promise.resolve();
    const playPromise = this.el.play();
    try {
      await Promise.all([resumePromise, playPromise]);
      // eslint-disable-next-line no-console
      console.log('[BGM] start() OK. ctx.state=', this.ctx?.state, 'el.paused=', this.el.paused);
    } catch (err) {
      // #なぜBGMが鳴らないか特定するため、握りつぶさず理由を残す
      console.error('[BGM] start() failed:', err?.name, err?.message, 'ctx.state=', this.ctx?.state);
      this._available = false;
    }
  }

  /**
   * BGMを事前に読み込んでおく(タップ前のローディング表示用)。
   *
   * 実機での検証で、<audio preload="auto"> はiOS Safariではタップされる
   * まで実質バックグラウンド読み込みが進まないことが判明した(#ゲージが
   * ちゃんと機能してない: canplaythrough/buffered が20秒待っても0のまま)。
   * <audio> 要素の自動読み込みには頼らず、fetch() でファイル本体を直接
   * まるごとダウンロードし、Blob URL を作って el.src に差し替える。
   * fetch() は音声要素向けの読み込み制限を受けないため、確実にタップ前に
   * ダウンロードを終えられる。タップ時点で全データがメモリ上にあるので、
   * 以後は途中で待たされる(waiting)ことが構造的に起きなくなる。
   *
   * fetch自体が使えない/失敗する場合は、従来の <audio> ネイティブ読み込み
   * 待ちにフォールバックする(安全弁は20秒のまま維持)。
   * @param {(p:number)=>void} [onProgress] 0..1
   */
  async preload(onProgress) {
    if (!this._available) return;
    try {
      const resp = await fetch(this.config.src);
      if (!resp.ok || !resp.body) throw new Error(`fetch not ok: ${resp.status}`);
      const total = Number(resp.headers.get('content-length')) || 0;
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (total) onProgress?.(clamp01(received / total));
      }
      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      this.el.src = URL.createObjectURL(blob);
      onProgress?.(1);
      console.log('[BGM] fetchでのpreload完了。size=', received, 'bytes / total=', total);
    } catch (err) {
      console.error('[BGM] fetch preloadに失敗、<audio>ネイティブ読み込みにフォールバック:', err?.message);
      await this._legacyElementPreload(onProgress);
    }
  }

  /** preload() のフォールバック。従来の <audio> のバッファ状況を見て待つ方式。 */
  _legacyElementPreload(onProgress) {
    const MIN_BUFFER_SEC = 45;
    return new Promise((resolve) => {
      const el = this.el;
      let done = false;
      const bufferedEnd = () => {
        try {
          return el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0;
        } catch {
          return 0;
        }
      };
      const target = () => Math.min(MIN_BUFFER_SEC, el.duration || MIN_BUFFER_SEC);
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener('progress', check);
        el.removeEventListener('canplaythrough', check);
        el.removeEventListener('error', onErr);
        clearTimeout(timer);
        resolve();
      };
      const check = () => {
        const be = bufferedEnd();
        const t = target();
        onProgress?.(clamp01(t ? be / t : 1));
        if (be >= t) finish();
      };
      const onErr = () => finish();
      el.addEventListener('progress', check);
      el.addEventListener('canplaythrough', check);
      el.addEventListener('error', onErr);
      const timer = setTimeout(finish, 20000);
      check();
    });
  }

  _ensureGraph() {
    if (this._graph || this._graphFailed) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('no AudioContext');
      this.ctx = new Ctx();
      // iOSでは電話の着信やSiri等でAudioContextが 'interrupted' になることがあり、
      // それが今回の症状(効果音のタイミングでだけBGMが鳴り出す)に絡んでいないか
      // 切り分けるためログを残す。
      this.ctx.addEventListener('statechange', () => {
        console.log('[BGM] ctx.statechange →', this.ctx.state);
      });
      this.srcNode = this.ctx.createMediaElementSource(this.el);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.35; // 0.7だと反応が鈍いので下げて素早く追従させる
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = this._level;
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = (this.config.sfx?.masterVolume ?? 0.5);
      // スリップストリームで「開く」ローパス(解析は filter より前でタップ)
      this.bgmFilter = this.ctx.createBiquadFilter();
      this.bgmFilter.type = 'lowpass';
      this.bgmFilter.frequency.value = 20000;

      this.el.volume = 1;
      this.srcNode.connect(this.analyser);
      this.analyser.connect(this.bgmFilter);
      this.bgmFilter.connect(this.bgmGain);
      this.bgmGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);

      this._freq = new Uint8Array(this.analyser.frequencyBinCount);
      this._graph = true;
      this._sfxBuf = {};
      this._loadSfxSamples();
      console.log('[BGM] _ensureGraph() OK. ctx.state=', this.ctx.state);
    } catch (err) {
      console.error('[BGM] _ensureGraph() failed:', err?.name, err?.message);
      this._graphFailed = true;
      this.el.volume = this.muted ? 0 : this._level;
    }
  }

  /**
   * 実サンプル SFX(#WS4)。`config.audio.sfx.samples` = { name: [url, ...] } を非同期で
   * fetch → decodeAudioData。1音につき複数URLを置けて、再生時にランダムで1つ選ぶ
   * (ダイブ音3種のランダム再生など)。読み込み失敗したスロットは黙って諦める
   * (そのスロットは合成音フォールバックのまま)。
   */
  async _loadSfxSamples() {
    const samples = this.config.sfx?.samples ?? {};
    for (const [name, urls] of Object.entries(samples)) {
      const list = Array.isArray(urls) ? urls : [urls];
      const bucket = [];
      for (const url of list) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const arr = await res.arrayBuffer();
          const buf = await this.ctx.decodeAudioData(arr);
          bucket.push(buf);
        } catch {
          // このファイルだけ諦める(未配置 / デコード失敗など)
        }
      }
      if (bucket.length) this._sfxBuf[name] = bucket;
    }
  }

  /** 実サンプルをBufferSourceで1回再生。name/argで軽くピッチ・音量に表情をつける(合成音の踏襲)。 */
  _playSfxBuffer(name, arg, vol) {
    const bucket = this._sfxBuf?.[name];
    if (!bucket || !bucket.length) return false;
    const buffer = bucket[(Math.random() * bucket.length) | 0];
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    let rate = 1;
    let gainMul = 1;
    if (name === 'orb') rate = Math.pow(2, (arg ?? 0) / 12); // オーブチェインで半音ずつ上がる
    else if (name === 'dive') gainMul = 0.85 + clamp01(arg ?? 1) * 0.15;
    else if (name === 'leap') rate = 0.94 + clamp01((arg ?? 1) / 3) * 0.08; // tierで気持ち高く
    // 音源によって収録レベルがバラバラなので、音ごとの個別ゲインで微調整できるようにする
    const perNameGain = this.config.sfx?.sampleGainByName?.[name] ?? 1;
    src.playbackRate.value = rate;
    g.gain.value = vol * gainMul * perNameGain;
    src.connect(g);
    g.connect(this.sfxGain);
    src.start();
    return true;
  }

  // --- 出力レベル(bgm)。グラフがあれば bgmGain、無ければ el.volume ---
  _outGet() {
    return this._graph ? this.bgmGain.gain.value : this.el.volume;
  }

  _outSet(v) {
    const c = clamp01(v);
    if (this._graph) this.bgmGain.gain.value = c;
    else this.el.volume = c;
  }

  _target() {
    return this.muted ? 0 : this._level;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(m) {
    this.muted = m;
    this._rampOut(this._target(), 0.3);
  }

  pause() {
    if (!this.el.paused) this.el.pause();
  }

  /** タブ復帰など。0 から目標値へフェードイン。 */
  resume() {
    if (!this._available || this.muted || this._ended) return;
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    const wasPaused = this.el.paused;
    if (wasPaused) {
      this._outSet(0);
      this.el.play().catch(() => {});
    }
    this._rampOut(this._target(), 1.6);
  }

  /** 終了画面へ: 数秒でフェードアウトして停止。(現在は endSession() を使用、必要なら再利用可) */
  fadeOut(seconds = 1.6) {
    this._ended = true;
    if (!this._available) return;
    this._rampOut(0, seconds);
    setTimeout(() => this.pause(), Math.ceil(seconds * 1000) + 60);
  }

  /**
   * 終了画面へ: BGMはフェード/停止させず、そのまま最後まで自然に流し続ける
   * (#ゲーム本編より長い尺のBGMを、終了画面の余韻として聴かせる)。
   * SFXだけ止める(操作不可になった後にダイブ/鳴き声等が鳴り続けないように)。
   */
  endSession() {
    this._ended = true;
  }

  _rampOut(to, seconds) {
    if (this._ramp) { clearInterval(this._ramp); this._ramp = null; }
    const from = this._outGet();
    if (Math.abs(to - from) < 0.001 || seconds <= 0) {
      this._outSet(to);
      return;
    }
    const t0 = performance.now();
    this._ramp = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      this._outSet(from + (to - from) * k);
      if (k >= 1) { clearInterval(this._ramp); this._ramp = null; }
    }, 33);
  }

  /** スリップストリーム(#13): BGM ローパスのカットオフ Hz へ滑らかにグライド。 */
  setBgmFilter(hz) {
    if (!this._graph || !this.bgmFilter) return;
    const clamped = Math.max(200, Math.min(20000, hz));
    this.bgmFilter.frequency.setTargetAtTime(clamped, this.ctx.currentTime, 0.12);
  }

  // ================= 帯域別振幅の解析(#8) =================
  /**
   * 毎フレーム呼ぶ。各帯域の「緩やかな平均からのズレ」を返す(概ね -0.3〜0.3)。
   * 消費側は factor = 1 + dev * gain のように使う。
   */
  sampleBands() {
    if (!this._graph || !this.analyser) return this.bands;
    this.analyser.getByteFrequencyData(this._freq);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const rc = this.reactive.bands ?? {};
    const ranges = {
      low: rc.low?.hz ?? [20, 150],
      midLow: rc.midLow?.hz ?? [150, 500],
      midHigh: rc.midHigh?.hz ?? [1000, 4000],
      high: rc.high?.hz ?? [4000, 8000],
    };
    const sm = this.reactive.smoothing ?? 0.16;
    const baseAlpha = this.reactive.baselineRate ?? 0.004;
    for (const k in ranges) {
      const [lo, hi] = ranges[k];
      const i0 = Math.max(1, Math.floor(lo / binHz));
      const i1 = Math.min(this._freq.length - 1, Math.ceil(hi / binHz));
      let sum = 0;
      let n = 0;
      for (let i = i0; i <= i1; i++) { sum += this._freq[i]; n++; }
      const raw = n ? sum / n / 255 : 0;
      if (!this._bandSeeded[k]) {
        // 最初に有意な信号を得た時点で「今」と「緩やかな平均」を揃える
        // (再生開始直後の 0 埋めバッファで基準がズレるのを防ぐ)
        if (raw <= 0.02) continue;
        this._bandNow[k] = raw;
        this._bandBase[k] = raw;
        this._bandSeeded[k] = true;
        this.bands[k] = 0;
        continue;
      }
      this._bandNow[k] += (raw - this._bandNow[k]) * sm;
      this._bandBase[k] += (this._bandNow[k] - this._bandBase[k]) * baseAlpha;
      this.bands[k] = this._bandNow[k] - this._bandBase[k];
    }
    return this.bands;
  }

  // ===================== SFX(実サンプル優先 → 無ければ合成、#7/#WS4) =====================
  /** @param {'orb'|'dive'|'leap'|'yacht'|'airplane'|'dolphin'|'whale'} name */
  playSfx(name, arg) {
    console.log(`[SFX] playSfx('${name}') 呼び出し。el.paused=${this.el.paused}, el.currentTime=${this.el.currentTime.toFixed(2)}, ctx.state=${this.ctx?.state}`);
    if (!this._graph || this.muted || this._ended) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // 開始時のBGM再生要求が(モバイルブラウザの制約等で)通らなかった場合の保険。
    // 効果音が鳴らせる=ユーザー操作の流れの中にいる状況なので、ここでBGMの
    // 再生も改めて試みる(#効果音が鳴らないとBGMが鳴らない、の恒久対策)。
    if (this._available && this.el.paused && !this._ended) {
      console.log('[BGM] playSfx()経由でel.paused=trueを検知、再生をリトライ');
      this.el.play()
        .then(() => console.log('[BGM] リトライ成功'))
        .catch((err) => console.error('[BGM] リトライも失敗:', err?.name, err?.message));
    }
    const t = this.ctx.currentTime;
    const cfg = this.config.sfx ?? {};
    const v = cfg.eventVolume ?? 0.35;
    if (this._playSfxBuffer(name, arg, v)) return;
    if (name === 'orb') this._chime(t, v, arg ?? 0);
    else if (name === 'dive') this._dive(t, v * 1.1, arg ?? 1);
    else if (name === 'leap') this._leap(t, v * 1.2, arg ?? 1);
    else if (name === 'yacht') this._swell(t, v * 0.8);
    else if (name === 'airplane') this._airplane(t, v * 0.7);
    // dolphin/whale: 合成音の用意はしていない。サンプル未配置の間は無音のまま。
  }

  _noise(dur) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** オーブ収集: 短いサイン系のチャイム(semis で半音上げ = orb flow chain 用) */
  _chime(t, vol, semis) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    const f = 880 * Math.pow(2, (semis || 0) / 12);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + 0.32);
  }

  /** リープ(段階): 上昇スイープの whoosh + ドンという弾み。tier 1..3 で強く高く。 */
  _leap(t, vol, tier) {
    const k = clamp01((tier || 1) / 3);
    const dur = 0.5 + k * 0.25;
    // whoosh: ノイズ + ローパスの上昇スイープ
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(dur);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(1400 + k * 2200, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * (0.5 + k * 0.5), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur);
    // 弾み: 低いサインのドン
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150 + k * 90, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    og.gain.setValueAtTime(vol * (0.6 + k * 0.5), t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(og);
    og.connect(this.sfxGain);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** 潜水: ノイズ + ローパスの下降スイープ */
  _dive(t, vol, intensity) {
    const dur = 0.55;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(dur);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1900, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * clamp01(intensity), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur);
  }

  /** ヨットの通過: バンドパスしたノイズのスウェル */
  _swell(t, vol) {
    const dur = 1.8;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise(dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 360;
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur);
  }

  /** 飛行機の通過: 低いノコギリ + ノイズ、ローパス、ドップラー的な音量/ピッチ変化 */
  _airplane(t, vol) {
    const dur = 2.6;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(122, t);
    o.frequency.linearRampToValueAtTime(74, t + dur);
    const ns = this.ctx.createBufferSource();
    ns.buffer = this._noise(dur);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 360;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.42);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    ns.connect(lp);
    lp.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur);
    ns.start(t);
    ns.stop(t + dur);
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
