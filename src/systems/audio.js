/**
 * audio.js
 * --------
 * BGM は <audio>(HTMLMediaElement)+ createMediaElementSource() で鳴らす:
 *
 *   <audio> ─ MediaElementSource ─┬─▶ AnalyserNode(帯域解析タップ、出力はどこにも繋がない)
 *                                 └─▶ bgmFilter ─ bgmGain ─▶ destination
 *   SFX(実サンプル/合成音、AudioBufferSourceNode)──────────────── sfxGain ──▶ destination
 *
 * 一時期 AudioBufferSourceNode(全データを事前デコードして再生)方式を試したが、
 * <audio>要素の「タブ非表示→復帰で自動的に元の位置から再開する」というブラウザ
 * 標準の挙動が失われ、バックグラウンドから戻るとBGMが鳴らなくなる regression が
 * 実機で発生したため撤回した。<audio>要素の方が背景/復帰まわりの面倒を
 * ブラウザ自身が見てくれるため堅牢と判断し、こちらに戻している。
 * (createMediaElementSource() のiOS音声劣化・画面録画ノイズの懸念は、
 * イヤホン使用等の運用でユーザー側が回避できたため許容している)
 *
 * <audio preload="auto"> はiOS Safariではタップされるまで実質バックグラウンド
 * 読み込みが進まない実機不具合があるため、タップ前のプリロードは <audio> の
 * 自動読み込みに頼らず fetch() で本体をまるごとダウンロードし、Blob URL を
 * el.src に差し替える方式にしてある(#preload参照)。
 *
 * - 編集版・11分04秒(664秒)の1本の音源(`public/bgm.mp3`)。ループなし。
 *   ゲーム本編は約8分30秒(`timeOfDay.durationSeconds`)で終わるので、終了画面に入っても
 *   BGMをフェードアウトせずそのまま流し続け、残りの約2分半は終了画面のBGMとして自然に聴かせる
 *   (`endSession()`。曲自体が `loop:false` なので最後まで流れたら自然に停止する)。
 * - ミュートは bgmGain を 0 にするだけ(再生・帯域解析は止めない)。
 * - タブ復帰時は 0 → 目標値へ 1〜2 秒フェードイン。
 * - Web Audio が使えない環境では BGM は諦める(SFXも元々同様のフォールバック方針)。
 *
 * iOSの「消音スイッチ」対策: iOS Safariには「Web Audio API単体の出力は本体側面の
 * 消音スイッチに従って無音化されるが、<audio>要素(HTMLMediaElement)の再生は
 * 消音スイッチを無視して鳴らせる」という仕様がある(WebKit既知の挙動)。
 * BGMをAudioBufferSourceNode化した際に<audio>要素を廃止したことで、この
 * 「消音スイッチを無視する」性質も失われてしまった。定番の回避策として、
 * ごく短い無音の<audio>をループ再生しておくと、ページ全体の音声セッションが
 * <audio>要素側のカテゴリになり、Web Audio側の出力も消音スイッチを無視できる
 * ようになる(参考: https://github.com/feross/unmute-ios-audio)。
 */
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRtYBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgATElTVBoAAABJTkZPSVNGVA0AAABMYXZmNjMuMS4xMDEAAGRhdGGQAQAAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

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
    el.loop = config.loop === true; // このゲームは既定でループなし
    el.crossOrigin = 'anonymous';
    el.volume = this._level; // グラフ成立後は gain 側で制御(el.volume は 1 相当に上げる)
    this.el = el;
    this._available = true;
    el.addEventListener('error', () => {
      console.error('[BGM] <audio> error:', el.error?.code, el.error?.message);
      this._available = false;
    });

    // 帯域解析の状態(署名付き偏差 = 各帯域の緩やかな平均からのズレ)
    this._bandNow = { low: 0, midLow: 0, midHigh: 0, high: 0 };
    this._bandBase = { low: 0, midLow: 0, midHigh: 0, high: 0 };
    this._bandSeeded = { low: false, midLow: false, midHigh: false, high: false };
    this.bands = { low: 0, midLow: 0, midHigh: 0, high: 0 };
  }

  /**
   * ctx.resume() を1回呼ぶだけだと、iOS実機で 'running' になるまで数秒〜
   * 数十秒かかることがあり、しかもその所要時間がかなりバラつく(実測: 3秒台の
   * こともあれば34秒かかることもあった)。ゲームプレイに依存せず、一定間隔で
   * 機械的に resume() を撃ち続けることで、これを運任せにしない。
   */
  _kickResumeUntilRunning() {
    if (!this.ctx || this._resumeKicking) return;
    this._resumeKicking = true;
    let attempts = 0;
    const maxAttempts = 60; // 250ms間隔で最大15秒
    // 無音バッファでのアンロックは最初の1回だけ(画面録画時に新しい音声ノードを
    // 頻繁に作り続けるとiOSの画面録画(ReplayKit)のキャプチャを乱すことがあるため、
    // ノード生成の頻度は最小限に抑える)。以後は resume() の再試行のみ行う。
    try {
      const buf = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch {
      // 無音アンロックに失敗しても致命的ではないので握りつぶす
    }
    const tick = () => {
      attempts++;
      if (!this.ctx || this.ctx.state === 'running' || attempts > maxAttempts) {
        this._resumeKicking = false;
        console.log(`[BGM] resumeキック終了。試行${attempts}回、最終state=${this.ctx?.state}`);
        return;
      }
      this.ctx.resume().catch(() => {});
      setTimeout(tick, 250);
    };
    tick();
  }

  /** #サイレントモードにすると音が消える対策。詳細はファイル先頭コメント参照。 */
  _unmuteSilentSwitch() {
    if (this._silentEl) return;
    try {
      const el = new Audio(SILENT_WAV_DATA_URI);
      el.loop = true;
      el.volume = 0.0001; // 完全に0だとブラウザによっては最適化で止められることがあるための保険
      el.play().catch(() => {});
      this._silentEl = el;
    } catch {
      // 失敗しても致命的ではないので無視(その場合サイレントスイッチ中は無音のまま)
    }
  }

  async start() {
    if (!this._available) return;
    this._unmuteSilentSwitch();
    this._ensureGraph();
    this._kickResumeUntilRunning();
    // #効果音が鳴らないとBGMが鳴らない: resume()の完了を待たず、play()も同じ
    // 呼び出しの中で同時に発行する(どちらもユーザー操作の直接の延長として
    // 扱われやすくするため)。
    const resumePromise = this.ctx && this.ctx.state === 'suspended'
      ? this.ctx.resume()
      : Promise.resolve();
    const playPromise = this.el.play();
    try {
      await Promise.all([resumePromise, playPromise]);
      console.log('[BGM] start() OK. ctx.state=', this.ctx?.state, 'el.paused=', this.el.paused);
    } catch (err) {
      console.error('[BGM] start() failed:', err?.name, err?.message, 'ctx.state=', this.ctx?.state);
      this._available = false;
    }
  }

  /**
   * BGMを事前に読み込んでおく(タップ前のローディング表示用)。
   *
   * <audio preload="auto"> はiOS Safariではタップされるまで実質バックグラウンド
   * 読み込みが進まない実機不具合があるため、<audio>要素の自動読み込みには頼らず
   * fetch() で本体をまるごとダウンロードし、Blob URL を作って el.src に差し替える。
   * fetch() は音声要素向けの読み込み制限を受けないため、確実にタップ前に
   * ダウンロードを終えられる。
   *
   * fetchに失敗した場合は <audio> のネイティブ読み込みにフォールバックする。
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
      console.error('[BGM] fetch preloadに失敗、<audio>src直指定にフォールバック:', err?.message);
      this.el.src = this.config.src;
      onProgress?.(1);
    }
  }

  _ensureGraph() {
    if (this._graph || this._graphFailed) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('no AudioContext');
      // sampleRateを48000に固定してみたが、通常再生(録画なし)まで無音に
      // なる regression が実機で発生したため撤回。検証不十分なまま踏み込んだ
      // ことが原因。ブラウザ既定のサンプルレートに任せる、元の形に戻す。
      this.ctx = new Ctx();
      console.log('[BGM] AudioContext sampleRate=', this.ctx.sampleRate);
      // iOSでは電話の着信やSiri等でAudioContextが 'interrupted' になることがあり、
      // それが絡んでいないか切り分けるためログを残す。
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
      // スリップストリームで「開く」ローパス
      this.bgmFilter = this.ctx.createBiquadFilter();
      this.bgmFilter.type = 'lowpass';
      this.bgmFilter.frequency.value = 20000;

      this.el.volume = 1;
      // analyserは帯域解析専用の「横から覗き見る」タップにする(本線には挟まない)。
      // analyser自身の出力はどこにも繋がない(getByteFrequencyDataで読むだけ)。
      this.srcNode.connect(this.analyser);
      this.srcNode.connect(this.bgmFilter);
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
    this._silentEl?.pause();
    if (!this.el.paused) this.el.pause();
  }

  /** タブ復帰など。0 から目標値へフェードイン。<audio>要素が自動で元の再生位置から再開する。 */
  resume() {
    if (!this._available || this.muted || this._ended) return;
    this._silentEl?.play().catch(() => {});
    if (this.ctx && this.ctx.state === 'suspended') this._kickResumeUntilRunning();
    const wasPaused = this.el.paused;
    if (wasPaused) {
      this._outSet(0);
      this.el.play().catch((err) => console.error('[BGM] resume()のplay()失敗:', err?.name, err?.message));
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
    if (!this._graph || this.muted || this._ended) return;
    if (this.ctx.state === 'suspended') this._kickResumeUntilRunning();
    // 開始時のBGM再生要求が(モバイルブラウザの制約等で)通らなかった場合の保険。
    // 効果音が鳴らせる=ユーザー操作の流れの中にいる状況なので、ここでBGMの
    // 再生も改めて試みる。
    if (this._available && this.el.paused && !this._ended) {
      this.el.play().catch(() => {});
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
