// Production smoke test for placement, one-point scoring, failure/recovery,
// responsive controls, accessibility, stable rendering, and runtime errors.
import { mkdirSync } from 'node:fs';

const APP_URL = process.env.GT_URL || 'http://127.0.0.1:4173/';
const SHOTS = process.env.GT_SHOTS || '/tmp/gt-shots';
const ACTION_TIMEOUT = Number(process.env.GT_ACTION_TIMEOUT || 45000);
const HEADLESS = process.env.GT_HEADLESS !== '0';
mkdirSync(SHOTS, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (playwrightError) {
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw new Error(
      `Playwright is required. Add it as a dev dependency or provide playwright-core: ${playwrightError.message}`
    );
  }
}

const launchOptions = {
  headless: HEADLESS,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'],
};
if (process.env.GT_CHROMIUM) launchOptions.executablePath = process.env.GT_CHROMIUM;
if (process.env.GT_BROWSER_CHANNEL) launchOptions.channel = process.env.GT_BROWSER_CHANNEL;

const browser = await chromium.launch(launchOptions);
const failures = [];
const runtimeErrors = [];

function check(condition, message) {
  if (condition) {
    console.log(`OK ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failures.push(message);
  }
}

function hasOnlyTinyDurations(value) {
  return value.split(',').every((entry) => {
    const duration = entry.trim();
    const milliseconds = duration.endsWith('ms')
      ? Number.parseFloat(duration)
      : Number.parseFloat(duration) * 1000;
    return Number.isFinite(milliseconds) && milliseconds <= 0.01;
  });
}

function seededRandom(seed) {
  let state = seed >>> 0;
  Math.random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function captureDiagnostics(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`${label} console: ${message.text()}`);
  });
  page.on('pageerror', (error) => runtimeErrors.push(`${label} pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    runtimeErrors.push(`${label} request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) runtimeErrors.push(`${label} HTTP ${response.status()}: ${response.url()}`);
  });
}

async function newGameSession(label, options = {}) {
  const {
    seed = 0x47544f57,
    viewport = { width: 1100, height: 760 },
    hasTouch = false,
    isMobile = false,
    reducedMotion = 'no-preference',
    backend = null,
  } = options;
  const context = await browser.newContext({
    viewport,
    hasTouch,
    isMobile,
    reducedMotion,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(seededRandom, seed);
  const page = await context.newPage();
  captureDiagnostics(page, label);
  const sessionUrl = new URL(APP_URL);
  sessionUrl.searchParams.set('seed', String(seed));
  if (backend) sessionUrl.searchParams.set('renderer', backend);
  await page.goto(sessionUrl.href, { waitUntil: 'domcontentloaded' });
  await page.locator('#app canvas').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#app canvas');
    return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
  }, undefined, { timeout: 15000 });
  await page.waitForTimeout(750);
  return { context, page };
}

async function readScore(page) {
  return Number.parseInt(await page.locator('#score').innerText(), 10);
}

async function readBest(page) {
  return Number.parseInt(await page.locator('#best').innerText(), 10);
}

async function gameOverVisible(page) {
  return page.locator('#game-over').isVisible();
}

async function waitForOutcome(page, previousScore, timeout = ACTION_TIMEOUT) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await gameOverVisible(page)) return { type: 'gameover', score: await readScore(page) };
    const currentScore = await readScore(page);
    if (currentScore > previousScore) return { type: 'score', score: currentScore };
    await page.waitForTimeout(250);
  }
  return { type: 'timeout', score: await readScore(page) };
}

async function dropWithKeyboard(page) {
  const previousScore = await readScore(page);
  await page.keyboard.press('Space');
  return waitForOutcome(page, previousScore);
}

async function detectRenderer(page) {
  return page.locator('#app canvas').evaluate((canvas) => {
    const declared = canvas.dataset.renderer || canvas.dataset.rendererBackend;
    if (declared) return declared.toLowerCase();
    try {
      if (canvas.getContext('webgl2')) return 'webgl2';
    } catch {
      // The canvas may already be configured for WebGPU.
    }
    try {
      if (globalThis.navigator.gpu && canvas.getContext('webgpu')) return 'webgpu';
    } catch {
      // Report unknown below rather than changing an established context.
    }
    return 'unknown';
  });
}

async function forceFailure(page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const previousScore = await readScore(page);
    for (let nudge = 0; nudge < 24; nudge++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    const outcome = await waitForOutcome(page, previousScore);
    if (outcome.type === 'gameover') return true;
    if (outcome.type === 'timeout') return false;
  }
  return gameOverVisible(page);
}

try {
  const stationarySession = await newGameSession('stationary-baseline');
  const stationary = await dropWithKeyboard(stationarySession.page);
  check(stationary.type === 'score', 'stationary baseline produces a scored piece');
  check(stationary.score === 1, 'each stable piece awards exactly one point');
  await stationarySession.context.close();

  const missSession = await newGameSession('opening-platform-miss', { seed: 12 });
  const missPage = missSession.page;
  for (let nudge = 0; nudge < 24; nudge++) await missPage.keyboard.press('ArrowRight');
  await missPage.waitForTimeout(500);
  const missOutcome = await dropWithKeyboard(missPage);
  check(missOutcome.type === 'gameover', 'first piece missing the pedestal ends the run');
  const scoreAfterMiss = await readScore(missPage);
  await missPage.waitForTimeout(1500);
  check(
    scoreAfterMiss === 0 && await readScore(missPage) === scoreAfterMiss,
    'missed first piece awards no points and the score remains stable'
  );
  await missPage.screenshot({ path: `${SHOTS}/05-opening-platform-miss.png` });
  await missSession.context.close();

  const thirdPieceSession = await newGameSession('third-piece-regression', { seed: 3885 });
  const thirdPiecePage = thirdPieceSession.page;
  const thirdPieceRenderer = await detectRenderer(thirdPiecePage);
  check(thirdPieceRenderer === 'webgl2', `stable renderer is WebGL2 (actual: ${thirdPieceRenderer})`);
  const firstStacked = await dropWithKeyboard(thirdPiecePage);
  const secondStacked = await dropWithKeyboard(thirdPiecePage);
  check(
    firstStacked.type === 'score' && secondStacked.type === 'score' && secondStacked.score === 2,
    'deterministic tee and rounded bar settle before the third piece'
  );
  const thirdPieceCanvas = thirdPiecePage.locator('#app canvas');
  const thirdPieceBefore = await thirdPieceCanvas.screenshot();
  await thirdPiecePage.waitForTimeout(1200);
  const thirdPieceAfter = await thirdPieceCanvas.screenshot();
  check(!thirdPieceBefore.equals(thirdPieceAfter), 'third hovering piece keeps rendering and bobbing');
  await thirdPiecePage.keyboard.press('ArrowRight');
  const thirdStacked = await dropWithKeyboard(thirdPiecePage);
  check(thirdStacked.type === 'score' && thirdStacked.score === 3, 'third capsule remains responsive and scores');
  await thirdPiecePage.screenshot({ path: `${SHOTS}/04-third-piece-stable.png` });
  await thirdPieceSession.context.close();

  const mainSession = await newGameSession('desktop-parity');
  const page = mainSession.page;
  const renderer = await detectRenderer(page);
  check(renderer === 'webgl2', `canonical renderer is stable WebGL2 (actual: ${renderer})`);
  check(await page.title() === 'Glass Towers', 'page identity is Glass Towers');
  check(await page.locator('#loading').getAttribute('data-stage') === '4', 'branded loader completes all four runtime stages');
  const securityPolicy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  check(Boolean(securityPolicy), 'static build declares a Content Security Policy');
  check(
    securityPolicy?.includes("script-src 'self' 'wasm-unsafe-eval'") &&
      !/(?:^|[;\s])'unsafe-(?:eval|inline)'(?:[;\s]|$)/.test(securityPolicy),
    'CSP permits WebAssembly without general unsafe eval or inline script'
  );
  const referrerPolicy = await page.locator('meta[name="referrer"]').getAttribute('content');
  check(referrerPolicy === 'no-referrer', 'referrer policy is no-referrer');
  check(await page.locator('#app canvas[role="application"][aria-label]').count() === 1, 'playfield has an accessible application label');
  check(await page.locator('#game-over[role="dialog"][aria-modal="true"]').count() === 1, 'failure overlay has dialog semantics');
  check(await page.locator('#tutorial').isVisible(), 'contextual placement tutorial is visible before the first drop');
  check(await page.locator('#score').innerText() === '00', 'score uses the reference zero-padded format');

  const playfield = page.locator('#app canvas');
  const focusBox = await playfield.boundingBox();
  await page.mouse.click(focusBox.x + focusBox.width / 2, focusBox.y + focusBox.height / 2);
  await page.waitForTimeout(350);
  check(await readScore(page) === 0, 'initial pointer click focuses without dropping');
  check(
    (await page.locator('#tutorial-primary').innerText()).toLowerCase().includes('move'),
    'focused tutorial advances to placement controls'
  );

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  check(await page.locator('#app canvas').count() === 1, 'BFCache restoration preserves the live game');

  const keyboardDrop = await dropWithKeyboard(page);
  check(keyboardDrop.type === 'score' && keyboardDrop.score === 1, 'Space drops one stable piece for one point');
  check(!(await page.locator('#tutorial').isVisible()), 'tutorial clears after the first drop');

  const sceneBefore = await playfield.screenshot();
  await page.waitForTimeout(1400);
  const sceneAfter = await playfield.screenshot();
  check(!sceneBefore.equals(sceneAfter), 'rendered scene/camera remains in motion');

  const preview = page.locator('#next-preview');
  const previewBefore = await preview.screenshot();
  await page.waitForTimeout(900);
  const previewAfter = await preview.screenshot();
  check(!previewBefore.equals(previewAfter), 'next-piece preview animates');
  await page.screenshot({ path: `${SHOTS}/01-desktop-parity.png` });

  await page.keyboard.press('r');
  await page.waitForFunction(() => document.querySelector('#score')?.textContent === '00');
  check(!(await gameOverVisible(page)) && await readScore(page) === 0, 'keyboard R resets the run');

  const canvasBox = await playfield.boundingBox();
  const clickX = canvasBox.x + canvasBox.width / 2 + 16;
  const clickY = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(clickX, clickY, { steps: 6 });
  const scoreBeforeMouse = await readScore(page);
  await page.mouse.click(clickX, clickY);
  const mouseOutcome = await waitForOutcome(page, scoreBeforeMouse);
  check(mouseOutcome.type === 'score', 'mouse aim and click produce a scored piece');

  await page.keyboard.press('r');
  const orbitBefore = await playfield.screenshot();
  await page.mouse.move(clickX - 80, clickY);
  await page.mouse.down();
  await page.mouse.move(clickX + 80, clickY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const orbitAfter = await playfield.screenshot();
  check(!orbitBefore.equals(orbitAfter), 'mouse drag orbits without dropping the aiming piece');
  check(await readScore(page) === 0, 'orbit gesture does not award or drop a piece');

  const verticalOrbitBefore = await playfield.screenshot();
  await page.mouse.move(clickX, clickY - 60);
  await page.mouse.down();
  await page.mouse.move(clickX, clickY + 80, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const verticalOrbitAfter = await playfield.screenshot();
  check(!verticalOrbitBefore.equals(verticalOrbitAfter), 'vertical mouse drag changes camera elevation');
  const zoomBefore = await playfield.screenshot();
  await page.mouse.wheel(0, 480);
  await page.waitForTimeout(400);
  const zoomAfter = await playfield.screenshot();
  check(!zoomBefore.equals(zoomAfter), 'mouse wheel changes camera distance');

  check(await forceFailure(page), 'edge-directed keyboard input triggers failure');
  await page.waitForFunction(() => document.activeElement?.id === 'restart-btn');
  check(await page.locator('#restart-btn').evaluate((button) => document.activeElement === button), 'failure moves focus to Try Again');
  const finalScore = Number.parseInt(await page.locator('#final-score').innerText(), 10);
  const finalBest = Number.parseInt(await page.locator('#final-best').innerText(), 10);
  check(Number.isFinite(finalScore) && finalBest >= finalScore, 'failure statistics are internally consistent');
  await page.screenshot({ path: `${SHOTS}/02-gameover.png` });

  await page.locator('#restart-btn').click();
  await page.waitForFunction(() => document.activeElement?.matches('#app canvas'));
  check(!(await gameOverVisible(page)) && await readScore(page) === 0, 'Try Again resets score and hides failure');
  check(await playfield.evaluate((canvas) => document.activeElement === canvas), 'restart restores focus to the playfield');

  const postRestart = await dropWithKeyboard(page);
  check(postRestart.type === 'score', 'post-restart drop keeps the loop alive');
  const bestBeforeReload = await readBest(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#app canvas').waitFor({ state: 'visible' });
  check(await readBest(page) === bestBeforeReload && bestBeforeReload > 0, 'best score persists across reload');
  await mainSession.context.close();

  const mobileSession = await newGameSession('mobile-touch', {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mobile = mobileSession.page;
  const mobileCanvas = mobile.locator('#app canvas');
  const mobileBox = await mobileCanvas.boundingBox();
  const mobileScore = await readScore(mobile);
  await mobileCanvas.dispatchEvent('pointerdown', {
    pointerId: 41, pointerType: 'touch', isPrimary: true,
    clientX: mobileBox.x + mobileBox.width / 2, clientY: mobileBox.y + mobileBox.height / 2,
  });
  await mobileCanvas.dispatchEvent('pointercancel', {
    pointerId: 41, pointerType: 'touch', isPrimary: true,
  });
  await mobileCanvas.dispatchEvent('pointerup', {
    pointerId: 41, pointerType: 'touch', isPrimary: true,
    clientX: mobileBox.x + mobileBox.width / 2, clientY: mobileBox.y + mobileBox.height / 2,
  });
  await mobile.waitForTimeout(500);
  check(await readScore(mobile) === mobileScore, 'pointer cancellation does not drop a piece');

  const mobileOrbitBefore = await mobileCanvas.screenshot();
  await mobileCanvas.dispatchEvent('pointerdown', {
    pointerId: 51, pointerType: 'touch', isPrimary: true,
    clientX: mobileBox.x + 130, clientY: mobileBox.y + 360,
  });
  await mobileCanvas.dispatchEvent('pointerdown', {
    pointerId: 52, pointerType: 'touch', isPrimary: false,
    clientX: mobileBox.x + 250, clientY: mobileBox.y + 360,
  });
  await mobileCanvas.dispatchEvent('pointermove', {
    pointerId: 52, pointerType: 'touch', isPrimary: false,
    clientX: mobileBox.x + 295, clientY: mobileBox.y + 360,
  });
  await mobileCanvas.dispatchEvent('pointerup', {
    pointerId: 52, pointerType: 'touch', isPrimary: false,
    clientX: mobileBox.x + 295, clientY: mobileBox.y + 360,
  });
  await mobileCanvas.dispatchEvent('pointerup', {
    pointerId: 51, pointerType: 'touch', isPrimary: true,
    clientX: mobileBox.x + 130, clientY: mobileBox.y + 360,
  });
  await mobile.waitForTimeout(400);
  const mobileOrbitAfter = await mobileCanvas.screenshot();
  check(!mobileOrbitBefore.equals(mobileOrbitAfter), 'two-finger touch gesture orbits the gallery');
  check(await readScore(mobile) === mobileScore, 'two-finger orbit does not drop a piece');
  check(
    (await mobile.locator('#tutorial-secondary').innerText()).toLowerCase().includes('two fingers'),
    'mobile tutorial explains two-finger orbit'
  );

  const dragStartX = mobileBox.x + mobileBox.width / 2 - 36;
  const dragEndX = mobileBox.x + mobileBox.width / 2 + 12;
  const dragY = mobileBox.y + mobileBox.height / 2;
  await mobileCanvas.dispatchEvent('pointerdown', {
    pointerId: 42, pointerType: 'touch', isPrimary: true,
    clientX: dragStartX, clientY: dragY,
  });
  await mobileCanvas.dispatchEvent('pointermove', {
    pointerId: 42, pointerType: 'touch', isPrimary: true,
    clientX: dragEndX, clientY: dragY,
  });
  await mobileCanvas.dispatchEvent('pointerup', {
    pointerId: 42, pointerType: 'touch', isPrimary: true,
    clientX: dragEndX, clientY: dragY,
  });
  const touchOutcome = await waitForOutcome(mobile, mobileScore);
  check(touchOutcome.type === 'score', 'touch drag aims and release drops a scored piece');
  const touchFocus = await mobileCanvas.evaluate((canvas) => ({
    modality: canvas.dataset.inputModality,
    outlineStyle: getComputedStyle(canvas).outlineStyle,
  }));
  check(
    touchFocus.modality === 'pointer' && touchFocus.outlineStyle === 'none',
    'touch focus does not show keyboard focus chrome'
  );
  const mobileLayout = await mobile.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    overflowY: document.documentElement.scrollHeight > window.innerHeight + 1,
    zoomBlocked: /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(
      document.querySelector('meta[name="viewport"]')?.content || ''
    ),
  }));
  check(!mobileLayout.overflowX && !mobileLayout.overflowY, 'mobile viewport has no document overflow');
  check(!mobileLayout.zoomBlocked, 'viewport allows browser zoom');
  await mobile.screenshot({ path: `${SHOTS}/03-mobile-touch.png` });
  await mobileSession.context.close();

  const reducedSession = await newGameSession('reduced-motion', { reducedMotion: 'reduce' });
  const reduced = reducedSession.page;
  const reducedStyles = await reduced.evaluate(() => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    gameOverAnimation: getComputedStyle(document.querySelector('#game-over-copy')).animationDuration,
    tutorialTransition: getComputedStyle(document.querySelector('#tutorial')).transitionDuration,
  }));
  check(reducedStyles.matches, 'reduced-motion preference reaches the app');
  check(hasOnlyTinyDurations(reducedStyles.gameOverAnimation), 'reduced motion suppresses game-over animation');
  check(hasOnlyTinyDurations(reducedStyles.tutorialTransition), 'reduced motion suppresses tutorial transitions');
  await reducedSession.context.close();
} catch (error) {
  console.error(error);
  failures.push(`uncaught playtest error: ${error.message}`);
} finally {
  await browser.close();
}

for (const error of runtimeErrors) console.error(`RUNTIME ERROR ${error}`);
if (runtimeErrors.length) failures.push(`${runtimeErrors.length} browser runtime error(s)`);

if (failures.length) {
  console.error(`\nPLAYTEST FAILED (${failures.length})`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\nPLAYTEST PASSED; screenshots: ${SHOTS}`);
}
