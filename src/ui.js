import { BEST_KEY } from './constants.js';
import { createPreview } from './preview.js';

export function getBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveBest(n) {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    // Storage unavailable (private mode, etc.) — best just won't persist.
  }
}

export function createUI({ onRestart } = {}) {
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const toastEl = document.getElementById('toast');
  const gameOverEl = document.getElementById('game-over');
  const finalScoreEl = document.getElementById('final-score');
  const finalBestEl = document.getElementById('final-best');
  const newBestEl = document.getElementById('new-best');
  const restartBtn = document.getElementById('restart-btn');
  const previewCanvas = document.getElementById('next-preview');

  const preview = createPreview(previewCanvas);

  // Never let overlay interactions leak through to the game canvas.
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    gameOverEl.addEventListener(type, (e) => e.stopPropagation());
  }

  restartBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    restartBtn.blur(); // so Space doesn't re-trigger the button
    if (onRestart) onRestart();
  });

  function pop(el) {
    el.classList.remove('pop');
    // Force reflow so the animation restarts on rapid updates.
    void el.offsetWidth;
    el.classList.add('pop');
  }

  function setScore(n) {
    const text = String(n);
    if (scoreEl.textContent !== text) {
      scoreEl.textContent = text;
      pop(scoreEl);
    }
  }

  function setBest(n) {
    const text = String(n);
    if (bestEl.textContent !== text) {
      bestEl.textContent = text;
      pop(bestEl);
    }
  }

  function setNextShape(shapeDef) {
    preview.setShape(shapeDef);
  }

  let toastTimer = 0;
  let toastHideTimer = 0;
  function showToast(text) {
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    // Restart the show transition even when a toast is already visible.
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show'); // fade/slide out first...
      toastHideTimer = setTimeout(() => {
        toastEl.classList.add('hidden'); // ...then remove from layout
      }, 250);
    }, 1200);
  }

  function showGameOver(score, best, isNewBest) {
    finalScoreEl.textContent = String(score);
    finalBestEl.textContent = String(best);
    newBestEl.classList.toggle('hidden', !isNewBest);
    gameOverEl.classList.remove('hidden');
  }

  function hideGameOver() {
    gameOverEl.classList.add('hidden');
  }

  function update(dt) {
    preview.update(dt);
  }

  return {
    setScore,
    setBest,
    setNextShape,
    showToast,
    showGameOver,
    hideGameOver,
    update,
  };
}
