import { BEST_KEY } from './constants.js';
import { createPreview } from './preview.js';

export function getBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (!raw || !/^[1-9]\d{0,15}$/.test(raw)) return 0;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function saveBest(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Best score must be a non-negative safe integer');
  }
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be unavailable in private or constrained browser contexts.
  }
}

function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required UI element: #${id}`);
  return element;
}

function displayScore(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Score must be a non-negative safe integer');
  }
  return String(value).padStart(2, '0');
}

export function createUI({ onRestart, forceWebGL = true } = {}) {
  if (typeof onRestart !== 'function') {
    throw new TypeError('createUI requires an onRestart callback');
  }
  if (typeof forceWebGL !== 'boolean') {
    throw new TypeError('createUI forceWebGL must be a boolean');
  }

  const appEl = requiredElement('app');
  const scoreEl = requiredElement('score');
  const bestEl = requiredElement('best');
  const gameOverEl = requiredElement('game-over');
  const gameOverSubtitleEl = requiredElement('game-over-subtitle');
  const finalScoreEl = requiredElement('final-score');
  const finalBestEl = requiredElement('final-best');
  const newBestEl = requiredElement('new-best');
  const restartBtn = requiredElement('restart-btn');
  const resetBtn = requiredElement('reset-btn');
  const tutorialEl = requiredElement('tutorial');
  const tutorialPrimaryEl = requiredElement('tutorial-primary');
  const tutorialSecondaryEl = requiredElement('tutorial-secondary');
  const loadingEl = requiredElement('loading');
  const previewCanvas = requiredElement('next-preview');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: 600px), (pointer: coarse)');
  const preview = createPreview(previewCanvas, { forceWebGL });
  let loadingTimer = 0;
  let disposed = false;

  function restart(event) {
    event.stopPropagation();
    onRestart();
  }

  for (const type of ['pointerdown', 'pointerup', 'click']) {
    gameOverEl.addEventListener(type, (event) => event.stopPropagation());
  }
  restartBtn.addEventListener('click', restart);
  resetBtn.addEventListener('click', restart);

  function pop(element) {
    if (reducedMotion.matches) return;
    element.classList.remove('pop');
    void element.offsetWidth;
    element.classList.add('pop');
  }

  function setScore(value) {
    const text = displayScore(value);
    if (scoreEl.textContent === text) return;
    scoreEl.textContent = text;
    pop(scoreEl);
  }

  function setBest(value) {
    const text = displayScore(value);
    if (bestEl.textContent === text) return;
    bestEl.textContent = text;
    pop(bestEl);
  }

  function setNextShape(shapeDef) {
    preview.setShape(shapeDef);
  }

  function setFocused() {
    if (mobile.matches) {
      tutorialPrimaryEl.textContent = 'Drag to place';
      tutorialSecondaryEl.textContent = 'Release to drop · Two fingers to orbit';
    } else {
      tutorialPrimaryEl.textContent = 'Move, then click to drop';
      tutorialSecondaryEl.textContent = 'Drag to orbit';
    }
  }

  function setStarted() {
    tutorialEl.classList.add('is-hidden');
  }

  function hideLoading() {
    document.body.classList.add('is-ready');
    loadingEl.setAttribute('aria-hidden', 'true');
    clearTimeout(loadingTimer);
    loadingTimer = window.setTimeout(() => {
      loadingEl.hidden = true;
    }, reducedMotion.matches ? 0 : 440);
  }

  function showGameOver(score, best, isNewBest) {
    finalScoreEl.textContent = String(score);
    finalBestEl.textContent = String(best);
    const suffix = document.createTextNode(` ${score === 1 ? 'piece' : 'pieces'} held.`);
    gameOverSubtitleEl.replaceChildren(finalScoreEl, suffix);
    newBestEl.classList.toggle('hidden', !isNewBest);
    gameOverEl.classList.remove('hidden');
    gameOverEl.setAttribute('aria-hidden', 'false');
    document.documentElement.dataset.gameState = 'gameover';
    appEl.inert = true;
    requestAnimationFrame(() => restartBtn.focus({ preventScroll: true }));
  }

  function hideGameOver() {
    gameOverEl.classList.add('hidden');
    gameOverEl.setAttribute('aria-hidden', 'true');
    document.documentElement.dataset.gameState = 'playing';
    appEl.inert = false;
    const gameCanvas = appEl.querySelector('canvas');
    if (gameCanvas) requestAnimationFrame(() => gameCanvas.focus({ preventScroll: true }));
  }

  function update(deltaSeconds) {
    if (!reducedMotion.matches) preview.update(deltaSeconds);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(loadingTimer);
    restartBtn.removeEventListener('click', restart);
    resetBtn.removeEventListener('click', restart);
    preview.dispose();
  }

  return {
    ready: preview.ready,
    setScore,
    setBest,
    setNextShape,
    setFocused,
    setStarted,
    hideLoading,
    showGameOver,
    hideGameOver,
    update,
    dispose,
  };
}
