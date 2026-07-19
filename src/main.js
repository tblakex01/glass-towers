import * as THREE from 'three/webgpu';
import { createEffects } from './effects.js';
import { createEnvironment } from './environment.js';
import { createGame } from './game.js';
import { createInput } from './input.js';
import { createPhysics } from './physics.js';
import { createPlacementGuide } from './render/placement-guide.js';
import { createUI } from './ui.js';

const app = document.getElementById('app');
const LOADING_STAGES = Object.freeze([
  ['Preparing the gallery', 'Loading the rendering runtime'],
  ['Warming the physics', 'Starting the glass simulation'],
  ['Polishing the glass', 'Building reflections and materials'],
  ['Ready to balance', 'Warming the final rendering pipelines'],
]);

function setLoadingStage(stage) {
  if (!Number.isInteger(stage) || stage < 1 || stage > LOADING_STAGES.length) {
    throw new RangeError('Loading stage is outside the supported range');
  }
  const loading = document.getElementById('loading');
  if (!loading) return;
  const [title, detail] = LOADING_STAGES[stage - 1];
  loading.dataset.stage = String(stage);
  loading.style.setProperty('--loading-progress', `${stage / LOADING_STAGES.length * 100}%`);
  const titleEl = loading.querySelector('.loading-stage strong');
  const countEl = loading.querySelector('.loading-stage span');
  const detailEl = loading.querySelector('.loading-status p');
  if (titleEl) titleEl.textContent = title;
  if (countEl) countEl.textContent = `0${stage} / 0${LOADING_STAGES.length}`;
  if (detailEl) detailEl.textContent = detail;
}

function requestedSeed() {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value >>> 0 : null;
}

function environmentOptions() {
  const backend = new URLSearchParams(window.location.search).get('renderer');
  return { forceWebGL: backend !== 'webgpu' };
}

function showBootError(error) {
  console.error('Glass Towers could not start', error);
  document.getElementById('loading')?.setAttribute('hidden', '');
  document.getElementById('hud')?.setAttribute('hidden', '');
  document.body.classList.add('is-ready');
  const message = document.createElement('section');
  message.id = 'boot-error';
  message.setAttribute('role', 'alert');
  const title = document.createElement('h1');
  title.textContent = 'Unable to open the gallery';
  const detail = document.createElement('p');
  detail.textContent = 'This browser needs WebGPU or WebGL 2. Try updating it, then reload.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => window.location.reload());
  message.append(title, detail, reload);
  app.replaceChildren(message);
}

async function boot() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  setLoadingStage(2);
  const [env, physics] = await Promise.all([
    createEnvironment(app, environmentOptions()),
    createPhysics(),
  ]);
  document.documentElement.dataset.renderer = env.backend;
  env.renderer.domElement.dataset.rendererBackend = env.backend;
  setLoadingStage(3);

  const effects = createEffects(env.scene, env.camera);
  const placementGuide = createPlacementGuide(env.scene);
  let game;
  const ui = createUI({
    forceWebGL: env.backend === 'webgl2',
    onRestart: () => game?.restart(),
  });
  const input = createInput(env.renderer.domElement, {
    camera: env.camera,
    onAim: (position) => game?.onAim(position),
    onNudge: (delta) => game?.onNudge(delta),
    onOrbit: (delta) => env.orbitCamera(delta.dx, delta.dy),
    onZoom: (delta) => env.zoomCamera(delta.dy),
    onFocus: () => ui.setFocused(),
    onDrop: () => game?.onDrop(),
    onRestart: () => game?.restart(),
  });
  game = createGame({
    env,
    physics,
    effects,
    placementGuide,
    ui,
    input,
    seed: requestedSeed(),
  });
  setLoadingStage(4);
  await ui.ready;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  ui.hideLoading();

  const clock = new THREE.Clock();
  let paused = document.hidden;
  function onVisibilityChange() {
    paused = document.hidden;
    if (!paused) clock.start();
  }
  function onPageShow(event) {
    if (!event.persisted) return;
    paused = document.hidden;
    clock.start();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow);

  env.renderer.setAnimationLoop(() => {
    const dt = paused ? 0 : Math.min(clock.getDelta(), 1 / 8);
    effects.beforeCameraUpdate();
    game.update(dt);
    effects.update(dt);
    ui.update?.(dt);
    env.render();
  });

  function onPageHide(event) {
    if (event.persisted) return;
    env.renderer.setAnimationLoop(null);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    input.dispose();
    ui.dispose();
    placementGuide.dispose();
    physics.dispose();
    env.dispose();
  }
  window.addEventListener('pagehide', onPageHide);
}

boot().catch(showBootError);
