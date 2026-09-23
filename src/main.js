import { Application, Assets } from 'pixi.js';
import 'pixi.js/prepare'; // renderer.prepare を有効化(タップ前にテクスチャをGPUへ転送しておく用)
import { ParallaxScene } from './scene/ParallaxScene.js';
import { BgmPlayer } from './systems/audio.js';
import { createUI } from './ui/overlay.js';
import configData from './config.json';

// 亀のパーツ(全て同一キャンバス 1344x896)
import turtleBodyUrl from './assets/turtle-body.png';
import turtleFrontFlipperUrl from './assets/turtle-front-flipper.png';
import turtleBackFlipperUrl from './assets/turtle-back-flipper.png';
import turtleHeadUrl from './assets/turtle-head.png';
import openingHeroUrl from './assets/turtle-opening-hero.png';
import bouquet1Url from './decorations/deco-bouquet-1.png';
import bouquet2Url from './decorations/deco-bouquet-2.png';
import bouquet3Url from './decorations/deco-bouquet-3.png';
import bouquet4Url from './decorations/deco-bouquet-4.png';
import bouquet5Url from './decorations/deco-bouquet-5.png';
import coralUrl from './decorations/deco-coral.png';
import fishTealUrl from './decorations/deco-fish-teal.png';
import fishYellowUrl from './decorations/deco-fish-yellow.png';
import mantaUrl from './decorations/deco-manta.png';
import jellyfishUrl from './decorations/deco-jellyfish.png';
import yachtUrl from './decorations/deco-yacht.png';
import airplaneUrl from './decorations/deco-airplane.png';
import crabUrl from './decorations/deco-crab.png';
import lobsterUrl from './decorations/deco-lobster.png';
import hulaUrl from './decorations/deco-hula-dancer.png';
import totemUrl from './decorations/deco-totem.png';
import palmTreeUrl from './decorations/deco-palm-tree.png';
import cliffRockUrl from './decorations/deco-cliff-rock.png';
import coastalTownUrl from './decorations/deco-coastal-town.png';
import weddingVenueUrl from './decorations/deco-wedding-venue.png';
import weddingIslandUrl from './decorations/deco-wedding-island.png';
import coupleUrl from './decorations/deco-couple.png';
import island1Url from './decorations/deco-island-1.png';
import island2Url from './decorations/deco-island-2.png';
import island3Url from './decorations/deco-island-3.png';
import island4Url from './decorations/deco-island-4.png';
import whaleUrl from './decorations/deco-whale.png';
import dolphinUrl from './decorations/deco-dolphin.png';
import sharkUrl from './decorations/deco-shark.png';
import birdUrl from './decorations/deco-bird.png';
import endingKeyVisualUrl from './assets/ending-key-visual.png';

// 雲スプライト: src/decorations/deco-cloud-*.png を置くだけで自動で読み込まれる。
// 1枚も無ければコード描画(shapes.js drawCloud)にフォールバック。
const cloudGlob = import.meta.glob('./decorations/deco-cloud-*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
// 草(海底の海藻)スプライト: src/decorations/deco-grass-*.png を置くだけで自動で読み込まれる。
const grassGlob = import.meta.glob('./decorations/deco-grass-*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
// 縁の植物(パーム/モンステラ): 数字サフィックスのみ拾う(deco-palm-tree.png は別物なので除外)。
const palmGlob = import.meta.glob('./decorations/deco-palm-[0-9]*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const monsteraGlob = import.meta.glob('./decorations/deco-monstera-*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const hibiscusGlob = import.meta.glob('./decorations/deco-hibiscus-*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

// 長押しでのテキスト選択(Android Chromeの虫眼鏡付きカーソル等)や右クリック/
// 長押しの文脈メニューを、CSS(user-select 等)だけでは塞ぎきれない場合があるため
// イベントレベルでも止める(#タップで虫眼鏡が出る・タップが選択に奪われて反応しない)。
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('selectstart', (e) => e.preventDefault());

async function bootstrap() {
  const bgm = new BgmPlayer(configData.audio, configData.audioReactive);

  let onStart = async () => { await bgm.start(); };
  const ui = createUI({
    title: 'Turtle Celebration',
    heroImageUrl: openingHeroUrl,
    endingImageUrl: endingKeyVisualUrl,
    bouquetImageUrls: [bouquet1Url, bouquet2Url, bouquet3Url, bouquet4Url, bouquet5Url],
    onStart: () => onStart(),
    onToggleMute: () => bgm.toggleMute(),
  });

  const app = new Application();
  await app.init({
    resizeTo: window,
    backgroundAlpha: 1,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.getElementById('app').appendChild(app.canvas);

  // --- アセット読み込み(プリローダーの進捗に反映) ---
  const urls = [
    turtleBodyUrl, turtleFrontFlipperUrl, turtleBackFlipperUrl, turtleHeadUrl,
    bouquet1Url, bouquet2Url, bouquet3Url, bouquet4Url, bouquet5Url,
    coralUrl,
    fishTealUrl, fishYellowUrl, mantaUrl, jellyfishUrl, yachtUrl, airplaneUrl,
    whaleUrl, dolphinUrl, sharkUrl, birdUrl,
    crabUrl, lobsterUrl, hulaUrl, totemUrl,
    palmTreeUrl, cliffRockUrl, coastalTownUrl,
    weddingVenueUrl, weddingIslandUrl, coupleUrl,
    island1Url, island2Url, island3Url, island4Url,
  ];
  // deco-cloud-01.png … → { 'cloud-01': url }
  const cloudUrls = {};
  for (const [path, url] of Object.entries(cloudGlob)) {
    const m = path.match(/deco-(cloud-[\w-]+)\.png$/);
    if (m) { cloudUrls[m[1]] = url; urls.push(url); }
  }
  // deco-grass-1.png … → { 'grass-1': url }
  const grassUrls = {};
  for (const [path, url] of Object.entries(grassGlob)) {
    const m = path.match(/deco-(grass-[\w-]+)\.png$/);
    if (m) { grassUrls[m[1]] = url; urls.push(url); }
  }
  // deco-palm-01.png … → { 'palm-01': url }(deco-palm-tree.png は除外)
  const palmUrls = {};
  for (const [path, url] of Object.entries(palmGlob)) {
    const m = path.match(/deco-(palm-\d+)\.png$/);
    if (m) { palmUrls[m[1]] = url; urls.push(url); }
  }
  // deco-monstera-01.png … → { 'monstera-01': url }
  const monsteraUrls = {};
  for (const [path, url] of Object.entries(monsteraGlob)) {
    const m = path.match(/deco-(monstera-[\w-]+)\.png$/);
    if (m) { monsteraUrls[m[1]] = url; urls.push(url); }
  }
  // deco-hibiscus-01.png … → { 'hibiscus-01': url }
  const hibiscusUrls = {};
  for (const [path, url] of Object.entries(hibiscusGlob)) {
    const m = path.match(/deco-(hibiscus-[\w-]+)\.png$/);
    if (m) { hibiscusUrls[m[1]] = url; urls.push(url); }
  }
  // 画像(0〜55%)+ BGMの再生準備(55〜80%)+ 全テクスチャのGPU転送(80〜100%)を
  // 1本のゲージにまとめる。BGM(11分の1本もの)はタップ後にすぐ鳴らしたいので、
  // "Tap to Begin" が出る時点で既に再生準備が整っている状態にする
  // (#音楽が流れるまで待たせたい)。
  let imgP = 0;
  let bgmP = 0;
  let gpuP = 0;
  const updateProgress = () => ui.setProgress(imgP * 0.55 + bgmP * 0.25 + gpuP * 0.2);
  const loaded = await Assets.load(urls, (p) => { imgP = p; updateProgress(); });
  imgP = 1;
  updateProgress();
  await bgm.preload((p) => { bgmP = p; updateProgress(); });
  bgmP = 1;
  updateProgress();

  const assets = {
    turtle: {
      body: loaded[turtleBodyUrl],
      'front-flipper': loaded[turtleFrontFlipperUrl],
      'back-flipper': loaded[turtleBackFlipperUrl],
      head: loaded[turtleHeadUrl],
      bouquet: [
        loaded[bouquet1Url], loaded[bouquet2Url], loaded[bouquet3Url],
        loaded[bouquet4Url], loaded[bouquet5Url],
      ],
    },
    creatures: {
      'fish-teal': loaded[fishTealUrl],
      'fish-yellow': loaded[fishYellowUrl],
      manta: loaded[mantaUrl],
      jellyfish: loaded[jellyfishUrl],
      yacht: loaded[yachtUrl],
      airplane: loaded[airplaneUrl],
      whale: loaded[whaleUrl],
      dolphin: loaded[dolphinUrl],
      shark: loaded[sharkUrl],
      bird: loaded[birdUrl],
    },
    spriteDecor: {
      crab: loaded[crabUrl],
      lobster: loaded[lobsterUrl],
      'hula-dancer': loaded[hulaUrl],
      totem: loaded[totemUrl],
    },
    vista: {
      'palm-tree': loaded[palmTreeUrl],
      'cliff-rock': loaded[cliffRockUrl],
      'coastal-town': loaded[coastalTownUrl],
    },
    wedding: {
      venue: loaded[weddingVenueUrl],
      island: loaded[weddingIslandUrl],
      couple: loaded[coupleUrl],
    },
    islandSprites: {
      'island-1': loaded[island1Url],
      'island-2': loaded[island2Url],
      'island-3': loaded[island3Url],
      'island-4': loaded[island4Url],
    },
    cloudSprites: Object.fromEntries(
      Object.entries(cloudUrls).map(([k, url]) => [k, loaded[url]]),
    ),
    grassSprites: Object.fromEntries(
      Object.entries(grassUrls).map(([k, url]) => [k, loaded[url]]),
    ),
    coralSprites: {
      coral: loaded[coralUrl],
    },
    foliageSprites: {
      ...Object.fromEntries(Object.entries(palmUrls).map(([k, url]) => [k, loaded[url]])),
      ...Object.fromEntries(Object.entries(monsteraUrls).map(([k, url]) => [k, loaded[url]])),
      ...Object.fromEntries(Object.entries(hibiscusUrls).map(([k, url]) => [k, loaded[url]])),
    },
  };

  const scene = new ParallaxScene(configData, assets, {
    onGauge: (fill, stage) => ui.setGauge(fill, stage),
    onWeddingArrival: () => ui.hideGauge(),
    onBouquetHandoff: () => ui.showCongrats(),
    onEnding: () => {
      // BGMはフェードさせず、そのまま最後まで自然に流し続ける(#終了画面で余った尺を聴かせる)
      bgm.endSession();
      ui.showEnding();
    },
    sfx: {
      orb: (semis) => bgm.playSfx('orb', semis),
      dive: (intensity) => bgm.playSfx('dive', intensity),
      leap: (tier) => bgm.playSfx('leap', tier),
      yacht: () => bgm.playSfx('yacht'),
      airplane: () => bgm.playSfx('airplane'),
      dolphin: () => bgm.playSfx('dolphin'),
      whale: () => bgm.playSfx('whale'),
    },
    audioBands: () => bgm.sampleBands(),
    bgmFilter: (hz) => bgm.setBgmFilter(hz),
  });
  app.stage.addChild(scene.stage);
  scene.resize(app.screen.width, app.screen.height);
  app.renderer.on('resize', (w, h) => scene.resize(w, h));

  // タップした瞬間に大量のスプライトが初めて画面に出て、その場でGPUへの
  // テクスチャ転送が一気に走って固まって見える(それに巻き込まれてBGM/SFXも
  // 遅れる)ことがあるため、タップ前のこの時点で先に全部転送しておく
  // (#タップ後にしばらく固まる・音が遅れる)。
  gpuP = 0.5;
  updateProgress();
  try {
    await app.renderer.prepare.upload(scene.stage);
  } catch {
    // prepare が使えない環境でも致命的ではないので無視して進める
  }
  gpuP = 1;
  updateProgress();
  ui.ready();

  // タップ = BGM 再生 + 時間帯サイクル / 生き物の開始
  let inputArmed = false;
  onStart = async () => {
    // bgm.start() を待ってからゲーム進行を始めると、iOS Safari 等で音声の
    // 許可待ちがいつまでも解決しない場合にゲーム自体が永遠に始まらなくなる
    // (#タップしても始まらない)。BGM開始のリクエストはここで発行しつつ、
    // ゲーム進行はそれを待たずに即座に始める(再生自体は裏で解決次第始まる)。
    bgm.start();
    scene.setRunning(true);
    ui.showControlHint();
    ui.showGauge();
    // 「タップして開始」の指がそのまま操作入力に化けないよう少しだけ遅らせる
    setTimeout(() => { inputArmed = true; }, 400);
  };

  // --- 入力: 左右タップゾーン。画面右半分=上昇 / 左半分=下降 / 無入力=高さ維持 ---
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  let pointerActive = false;
  const zoneFrom = (x) => (x >= app.screen.width / 2 ? 1 : -1);
  const applyPointer = (e) => {
    if (!inputArmed || !pointerActive) return;
    scene.setVerticalInput(zoneFrom(e.global.x));
  };
  app.stage.on('pointerdown', (e) => { pointerActive = true; applyPointer(e); });
  app.stage.on('pointermove', applyPointer);
  const releasePointer = () => { pointerActive = false; scene.setVerticalInput(0); };
  app.stage.on('pointerup', releasePointer);
  app.stage.on('pointerupoutside', releasePointer);
  app.stage.on('pointerleave', releasePointer);

  // キーボード(↑/W = 上昇、↓/S = 下降)
  let keyDir = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); keyDir = 1; scene.setVerticalInput(1); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); keyDir = -1; scene.setVerticalInput(-1); }
  });
  window.addEventListener('keyup', (e) => {
    if ((e.code === 'ArrowUp' || e.code === 'KeyW') && keyDir === 1) { keyDir = 0; if (!pointerActive) scene.setVerticalInput(0); }
    else if ((e.code === 'ArrowDown' || e.code === 'KeyS') && keyDir === -1) { keyDir = 0; if (!pointerActive) scene.setVerticalInput(0); }
  });

  // --- タブ非表示中は描画・音声を止める(バッテリー配慮) ---
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      app.ticker.stop();
      bgm.pause();
    } else {
      app.ticker.start();
      bgm.resume();
    }
  });

  // --- メインループ ---
  app.ticker.add((ticker) => {
    scene.update(ticker.deltaMS / 1000);
  });

  if (import.meta.env.DEV) {
    window.__turtle = { app, scene, bgm };
  }
}

bootstrap();
