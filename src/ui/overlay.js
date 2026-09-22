/**
 * overlay.js
 * ----------
 * DOM で乗せる UI:
 *   - オープニング: 専用キービジュアル1枚絵(turtle-opening-hero.png、Morena do Mar 参照)を
 *     全画面に敷き、その上にタイトルと「タップして開始」を重ねる。
 *   - ミュートボタン(右上、常時)
 *   - 縦持ち案内
 *
 * タップで BGM 再生 + ゲーム開始(自動再生制限の対策)。
 */

const CSS = `
#tc-ui, #tc-ui * { box-sizing: border-box; }
#tc-ui {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #F4EAD4;
}

#tc-open {
  position: absolute; inset: 0; pointer-events: auto; overflow: hidden;
  background: #ECE6D3;
  transition: opacity .9s ease;
}
#tc-open.tc-hidden { opacity: 0; pointer-events: none; }
#tc-hero-bg {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0;
}
#tc-open::after {
  content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background: linear-gradient(rgba(16,22,44,0) 42%, rgba(13,18,38,.62) 72%, rgba(8,12,28,.94) 100%);
}

#tc-title {
  position: absolute; left: 0; right: 0; top: 5.5vh; text-align: center; z-index: 3;
  font-size: clamp(24px, 5.4vw, 44px); font-weight: 400; letter-spacing: .2em;
  color: #14235F;
}
#tc-rule {
  position: absolute; left: 50%; top: calc(6vh + clamp(38px, 8vw, 66px)); z-index: 3;
  transform: translateX(-50%);
  width: min(180px, 40vw); height: 1px;
  background: linear-gradient(90deg, transparent, rgba(20,35,95,.55), transparent);
}
#tc-rule::after {
  content: ""; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px;
  border-radius: 50%; background: #D9A15C; transform: translate(-50%,-50%);
}

#tc-content {
  position: absolute; left: 0; right: 0; bottom: 6vh; z-index: 3;
  display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 0 8vw;
}
#tc-start {
  opacity: 0; transition: opacity .5s ease;
  font-size: clamp(14px, 3.4vw, 18px); letter-spacing: .32em; color: #FCF4E0;
  text-shadow: 0 2px 16px rgba(6,10,26,1);
}
/* #タップしても反応しない: animationはCSSの静的opacity:0より優先されてしまうため、
   ready前から常時 "Tap to Begin" が薄く点滅して見えてタップを誘ってしまっていた。
   アニメーションもready後だけ動くようにする。 */
#tc-start.tc-ready { opacity: 1; animation: tc-pulse 2.6s ease-in-out infinite; }
#tc-hint {
  margin-top: 1.4vh; font-size: clamp(10px, 2.3vw, 12px); letter-spacing: .16em;
  opacity: 0; transition: opacity .5s ease .1s; color: #E9DFC6;
  text-shadow: 0 1px 10px rgba(8,14,34,.9);
}
#tc-hint.tc-ready { opacity: .78; }

/* ゲーム内の操作案内(セッション中1回、数秒でフェード) */
#tc-ctrl-hint {
  position: absolute; left: 0; right: 0; bottom: calc(3.5vh + env(safe-area-inset-bottom, 0px));
  display: flex; justify-content: center; gap: 2.2em; pointer-events: none;
  font-size: clamp(11px, 2.6vw, 13px); letter-spacing: .18em; color: #F4EAD4;
  text-shadow: 0 1px 12px rgba(6,10,26,.95);
  opacity: 0; transition: opacity 1s ease;
}
#tc-ctrl-hint.tc-show { opacity: .82; }
#tc-loading-label {
  margin-top: 1.4vh; margin-bottom: 1vh; font-size: clamp(10px, 2.3vw, 12px); letter-spacing: .22em;
  color: #E9DFC6; text-shadow: 0 1px 10px rgba(8,14,34,.9); transition: opacity .4s ease;
}
#tc-loading-label.tc-nudge { animation: tc-nudge .4s ease; }
@keyframes tc-nudge { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
#tc-bar {
  width: min(220px, 58vw); height: 4px; border-radius: 2px;
  background: rgba(244,234,212,.25); overflow: hidden; transition: opacity .4s ease;
}
#tc-bar > i { display: block; height: 100%; width: 0%; background: #E7B778; transition: width .3s ease; }
@keyframes tc-pulse { 0%,100% { opacity: .72; } 50% { opacity: 1; } }

/* ブーケゲージ(左上、左右タップゾーンの邪魔にならない位置) */
#tc-gauge {
  position: absolute;
  top: calc(46px + env(safe-area-inset-top, 0px));
  left: calc(18px + env(safe-area-inset-left, 0px));
  display: none; align-items: center; gap: 7px; pointer-events: none;
}
#tc-gauge.tc-visible { display: flex; }
#tc-gauge-bar {
  width: clamp(110px, 30vw, 160px); height: 12px; border-radius: 6px;
  border: 1.5px solid #1B2F6E; background: #F4EAD4; overflow: hidden;
  box-shadow: 0 1px 6px rgba(6,10,26,.35);
}
#tc-gauge-fill {
  height: 100%; width: 0%; border-radius: 3px;
  background: linear-gradient(90deg, #F2A65A, #E8674A);
  transition: width .35s ease;
}
#tc-gauge.tc-flash #tc-gauge-bar { animation: tc-gauge-flash .65s ease; }
@keyframes tc-gauge-flash {
  0%, 100% { box-shadow: 0 1px 6px rgba(6,10,26,.35); }
  40% { box-shadow: 0 0 16px 4px rgba(246,200,122,.95); }
}
#tc-gauge-icon {
  width: 28px; height: 28px; object-fit: contain; opacity: .96;
  filter: drop-shadow(0 1px 4px rgba(6,10,26,.4));
}

/* ブーケ受け渡し時の祝福テキスト(画面上部、ふわっと上がりながらフェード) */
#tc-congrats {
  position: absolute; left: 0; right: 0; top: 9vh; z-index: 15;
  text-align: center; pointer-events: none;
  font-size: clamp(22px, 5.4vw, 42px); font-weight: 400; letter-spacing: .18em;
  color: #FCF4E0; text-shadow: 0 2px 18px rgba(6,10,26,.9);
  opacity: 0; transform: translateY(14px);
  transition: opacity 1.1s ease, transform 1.1s ease;
}
#tc-congrats.tc-in { opacity: 1; transform: translateY(0); }

#tc-mute {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top, 0px));
  right: calc(12px + env(safe-area-inset-right, 0px));
  width: 40px; height: 40px;
  border-radius: 50%; border: 1px solid rgba(244,234,212,.4); background: rgba(18,26,52,.4);
  color: #F4EAD4; font-size: 16px; cursor: pointer; pointer-events: auto; display: none;
  align-items: center; justify-content: center; backdrop-filter: blur(6px);
  font-family: sans-serif;
}
#tc-mute.tc-visible { display: flex; }

/* 終了画面(ループなし・1ラン完走で表示) */
#tc-ending {
  position: absolute; inset: 0; z-index: 20; pointer-events: auto;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  gap: 3.4vh; padding: 0 8vw 9vh;
  background-color: #14235F; background-size: cover; background-position: center;
  opacity: 0; transition: opacity 1.8s ease;
}
#tc-ending.tc-in { opacity: 1; }
#tc-ending::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(rgba(10,16,38,0) 30%, rgba(10,16,38,.4) 58%, rgba(10,16,38,.82) 100%);
}
#tc-ending-text {
  position: relative; text-align: center; color: #FCF4E0;
  opacity: 0; transform: translateY(10px); transition: opacity 1.4s ease 1s, transform 1.4s ease 1s;
  text-shadow: 0 2px 20px rgba(6,10,26,.9);
}
#tc-ending.tc-in #tc-ending-text { opacity: 1; transform: none; }
#tc-ending-text p {
  margin: 0; font-size: clamp(22px, 5vw, 40px); letter-spacing: .2em; font-weight: 400;
}
#tc-ending-text span {
  display: block; margin-top: 1.4vh; font-size: clamp(11px, 2.6vw, 14px);
  letter-spacing: .34em; color: #E7C99B;
}
#tc-again {
  position: relative; pointer-events: auto; cursor: pointer;
  padding: 12px 30px; border-radius: 999px;
  border: 1px solid rgba(252,244,224,.5); background: rgba(18,26,52,.4);
  color: #FCF4E0; font-size: clamp(12px, 2.8vw, 15px); letter-spacing: .24em;
  font-family: inherit; backdrop-filter: blur(6px);
  opacity: 0; transition: opacity 1.2s ease 1.8s;
}
#tc-ending.tc-in #tc-again { opacity: 1; }

#tc-rotate {
  position: absolute; inset: 0; z-index: 30; display: none; flex-direction: column; gap: 18px;
  align-items: center; justify-content: center; pointer-events: auto; text-align: center; padding: 24px;
  background: linear-gradient(#1E3E63, #0E2038);
}
#tc-rotate .tc-phone { font-size: 46px; animation: tc-rot 2.6s ease-in-out infinite; }
#tc-rotate div:last-child { letter-spacing: .18em; font-size: 15px; }
@keyframes tc-rot { 0%,40% { transform: rotate(0); } 60%,100% { transform: rotate(-90deg); } }
@media (orientation: portrait) { #tc-rotate.tc-armed { display: flex; } }
`;

export function createUI({ title = 'Turtle Celebration', heroImageUrl, endingImageUrl, bouquetImageUrls = [], onStart, onToggleMute } = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'tc-ui';
  root.innerHTML = `
    <div id="tc-open">
      ${heroImageUrl ? `<img id="tc-hero-bg" src="${heroImageUrl}" alt="" />` : ''}
      <div id="tc-title">${title}</div>
      <div id="tc-rule"></div>
      <div id="tc-content">
        <div id="tc-start">Tap to Begin</div>
        <div id="tc-hint">Tap right to rise · left to dive</div>
        <div id="tc-loading-label">Loading… 0%</div>
        <div id="tc-bar"><i></i></div>
      </div>
    </div>
    <div id="tc-ctrl-hint"><span>← Dive</span><span>Rise →</span></div>
    <div id="tc-gauge">
      <div id="tc-gauge-bar"><div id="tc-gauge-fill"></div></div>
      <img id="tc-gauge-icon" src="" alt="" />
    </div>
    <div id="tc-congrats">Congratulations</div>
    <button id="tc-mute" type="button" aria-label="mute">♪</button>
    <div id="tc-rotate" class="tc-armed">
      <div class="tc-phone">📱</div>
      <div>Please rotate your device</div>
    </div>
  `;
  document.body.appendChild(root);

  const open = root.querySelector('#tc-open');
  const bar = root.querySelector('#tc-bar > i');
  const barWrap = root.querySelector('#tc-bar');
  const loadingLabel = root.querySelector('#tc-loading-label');
  const startEl = root.querySelector('#tc-start');
  const hintEl = root.querySelector('#tc-hint');
  const muteBtn = root.querySelector('#tc-mute');
  const ctrlHint = root.querySelector('#tc-ctrl-hint');
  const congrats = root.querySelector('#tc-congrats');
  const gauge = root.querySelector('#tc-gauge');
  const gaugeFill = root.querySelector('#tc-gauge-fill');
  const gaugeIcon = root.querySelector('#tc-gauge-icon');
  let gaugeStage = 0;
  if (bouquetImageUrls[0]) gaugeIcon.src = bouquetImageUrls[0];

  let assetsReady = false;
  let starting = false;
  const begin = async () => {
    if (!assetsReady) {
      // 読み込み中にタップされた: 何も起きないと壊れてると誤解されるので、
      // 「まだ読み込み中」と分かるよう一瞬点滅させて知らせる(#タップしても反応しない)
      loadingLabel.classList.remove('tc-nudge');
      void loadingLabel.offsetWidth;
      loadingLabel.classList.add('tc-nudge');
      return;
    }
    if (starting) return;
    starting = true;
    if (onStart) {
      // onStart(BGM再生)がiOS Safari等で(オーディオの許可待ちなどにより)
      // いつまでも解決しないことがあり、それを待ってしまうと画面遷移自体が
      // 永遠に起きず「タップしても始まらない」ように見える。一定時間で
      // 見切りをつけて進める(BGM開始のリクエスト自体はこの時点で既にユーザー
      // 操作の延長で発行済みなので、待たずに進めても再生は裏で続く)。
      await Promise.race([onStart(), new Promise((resolve) => setTimeout(resolve, 1200))]);
    }
    open.classList.add('tc-hidden');
    muteBtn.classList.add('tc-visible');
    setTimeout(() => open.remove(), 1000);
  };
  // pointerdown 単独だと、読み込み直後の最初のタップが iOS Safari 側の
  // アドレスバー収納ジェスチャーに食われて反応しないことがあるため、
  // click も併用して取りこぼしを減らす(#最初の画面でタップしても変わらない)
  open.addEventListener('pointerdown', begin);
  open.addEventListener('click', begin);

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const muted = onToggleMute ? onToggleMute() : false;
    muteBtn.textContent = muted ? '🔇' : '♪';
    muteBtn.style.opacity = muted ? '0.5' : '1';
  });

  return {
    setProgress(p) {
      const pct = Math.round(clamp01(p) * 100);
      bar.style.width = `${pct}%`;
      loadingLabel.textContent = `Loading… ${pct}%`;
    },
    ready() {
      assetsReady = true;
      barWrap.style.opacity = '0';
      loadingLabel.style.opacity = '0';
      startEl.classList.add('tc-ready');
      hintEl.classList.add('tc-ready');
    },
    /** ゲーム開始直後に一度だけ「← 下降 / 上昇 →」を数秒表示 */
    showControlHint() {
      requestAnimationFrame(() => ctrlHint.classList.add('tc-show'));
      setTimeout(() => ctrlHint.classList.remove('tc-show'), 5200);
      setTimeout(() => ctrlHint.remove(), 7000);
    },
    showGauge() {
      gauge.classList.add('tc-visible');
    },
    /** ブーケが亀からカップルへ渡る瞬間に一度だけ表示、数秒でふわっとフェードアウト */
    showCongrats() {
      congrats.classList.add('tc-in');
      setTimeout(() => congrats.classList.remove('tc-in'), 3400);
    },
    hideGauge() {
      gauge.classList.remove('tc-visible');
    },
    /** 1ラン完走 → 終了画面。キービジュアルへクロスフェード + 締めのテキスト + 「もう一度みる」。 */
    showEnding() {
      if (root.querySelector('#tc-ending')) return;
      gauge.classList.remove('tc-visible');
      ctrlHint.remove();
      const el = document.createElement('div');
      el.id = 'tc-ending';
      if (endingImageUrl) el.style.backgroundImage = `url("${endingImageUrl}")`;
      el.innerHTML = `
        <div id="tc-ending-text">
          <p>Turtle Celebration</p>
        </div>
        <button id="tc-again" type="button">Watch Again</button>
      `;
      root.appendChild(el);
      el.querySelector('#tc-again').addEventListener('click', () => window.location.reload());
      requestAnimationFrame(() => el.classList.add('tc-in'));
    },
    /** @param {number} fill 0〜1  @param {number} stage 0〜maxStage(現在到達済み段) */
    setGauge(fill, stage) {
      gaugeFill.style.width = `${Math.round(clamp01(fill) * 100)}%`;
      if (stage !== gaugeStage) {
        gaugeStage = stage;
        // アイコンは「次に獲得できるブーケ」の絵(カンスト後は最終段のまま)
        const nextUrl = bouquetImageUrls[Math.min(stage, bouquetImageUrls.length - 1)];
        if (nextUrl) gaugeIcon.src = nextUrl;
        gauge.classList.remove('tc-flash');
        // reflow で animation を再トリガ
        void gauge.offsetWidth;
        gauge.classList.add('tc-flash');
        setTimeout(() => gauge.classList.remove('tc-flash'), 700);
      }
    },
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
