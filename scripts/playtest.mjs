// Glass Towers automated play-test: collisions, scoring, failure, restart, console errors.
// Note: headless SwiftShader renders at ~2fps, so waits are generous; the game
// clamps frame dt at 1/8s with up to 8 physics substeps, so sim time still advances.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const URL = process.env.GT_URL || 'http://localhost:4173/';
const SHOTS = process.env.GT_SHOTS || '/tmp/gt-shots';
const CHROMIUM = process.env.GT_CHROMIUM || '/opt/pw-browsers/chromium';
mkdirSync(SHOTS, { recursive: true });

const errors = [];
let failures = 0;
function fail(msg) {
  console.error('FAIL: ' + msg);
  failures++;
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function newGamePage(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 }, ...opts });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app canvas', { timeout: 15000 });
  await page.waitForTimeout(3000);
  return page;
}

const page = await newGamePage();
await page.screenshot({ path: SHOTS + '/01-initial.png' });

const score = async (p = page) => parseInt(await p.locator('#score').innerText(), 10);
const best = async (p = page) => parseInt(await p.locator('#best').innerText(), 10);
const gameOverVisible = async (p = page) => p.locator('#game-over').isVisible();

async function waitScoreAbove(prev, timeout = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await gameOverVisible()) return 'gameover';
    const s = await score();
    if (s > prev) return s;
    await page.waitForTimeout(500);
  }
  return null;
}

// ---------- RUN 1: keyboard drops, centered ----------
console.log('RUN 1: keyboard drops (Space), centered');
let placed = 0;
for (let i = 0; i < 4; i++) {
  const prev = await score();
  await page.keyboard.press('Space');
  const r = await waitScoreAbove(prev);
  if (r === 'gameover') { console.log('  run1 unexpected gameover at piece', i + 1); break; }
  if (r === null) { fail(`run1 piece ${i + 1}: score never increased`); break; }
  placed++;
  console.log(`  piece ${i + 1} settled, score=${r}`);
}
if (placed >= 3) console.log('OK run1: keyboard drop, settling & scoring work');
else fail('run1: fewer than 3 pieces placed');
await page.screenshot({ path: SHOTS + '/02-tower.png' });

// If run1 ended in a topple, restart so the HUD is visible again
if (await gameOverVisible()) {
  await page.locator('#restart-btn').click();
  await page.waitForTimeout(1500);
}

// ---------- Next-piece preview: must be live (piece rotates, frames differ) ----------
{
  const box = await page.locator('#next-preview').boundingBox();
  const shotA = await page.screenshot({ clip: box });
  await page.waitForTimeout(2500);
  const shotB = await page.screenshot({ clip: box });
  if (!shotA.equals(shotB)) console.log('OK next-piece preview renders and animates');
  else fail('next-piece preview appears static/blank');
}

// ---------- Mouse aiming + click drop ----------
console.log('Mouse aim + click drop');
const cbox = await page.locator('#app canvas').boundingBox();
await page.mouse.move(cbox.x + cbox.width / 2 + 30, cbox.y + cbox.height / 2, { steps: 8 });
await page.waitForTimeout(1200);
{
  const prev = await score();
  await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  const r = await waitScoreAbove(prev);
  if (r === 'gameover') console.log('  click drop toppled the tower — acceptable physics outcome');
  else if (r === null) fail('mouse click drop: score never increased');
  else console.log('OK mouse click drop, score=' + r);
}

// ---------- Force failure: aim far right with arrows, drop ----------
if (!(await gameOverVisible())) {
  console.log('Forcing failure: aim far right, drop until game over');
  for (let attempt = 0; attempt < 4 && !(await gameOverVisible()); attempt++) {
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Space');
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      if (await gameOverVisible()) break;
      await page.waitForTimeout(600);
    }
  }
}
if (await gameOverVisible()) console.log('OK game over triggered (piece fell off pedestal)');
else fail('could not trigger game over by dropping at the edge');
await page.screenshot({ path: SHOTS + '/03-gameover.png' });

const finalScore = parseInt(await page.locator('#final-score').innerText(), 10);
const finalBest = parseInt(await page.locator('#final-best').innerText(), 10);
console.log('final score', finalScore, 'best', finalBest);
if (Number.isNaN(finalScore) || Number.isNaN(finalBest) || finalBest < finalScore) fail('final stats look wrong');

// ---------- Restart via button ----------
await page.locator('#restart-btn').click();
await page.waitForTimeout(1500);
if (await gameOverVisible()) fail('restart did not hide game-over overlay');
if ((await score()) !== 0) fail('restart did not reset score');
console.log('OK restart resets state');
await page.screenshot({ path: SHOTS + '/04-restarted.png' });

// One more drop after restart to prove the loop is alive
{
  const prev = await score();
  await page.keyboard.press('Space');
  const r = await waitScoreAbove(prev);
  if (r === null || r === 'gameover') fail('post-restart drop did not score');
  else console.log('OK post-restart drop, score=' + r);
}

// ---------- Best persistence across reload ----------
const bestBefore = await best();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#app canvas');
await page.waitForTimeout(2000);
const bestAfter = await best();
if (bestAfter === bestBefore && bestAfter > 0) console.log('OK best persisted across reload:', bestAfter);
else fail(`best not persisted (before=${bestBefore} after=${bestAfter})`);
await page.close();

// ---------- Touch: tap to drop ----------
console.log('Touch run (mobile viewport)');
const tp = await newGamePage({ viewport: { width: 420, height: 760 }, hasTouch: true, isMobile: true });
const tbox = await tp.locator('#app canvas').boundingBox();
await tp.touchscreen.tap(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
{
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < 90000) {
    if (parseInt(await tp.locator('#score').innerText(), 10) > 0) { ok = true; break; }
    await tp.waitForTimeout(600);
  }
  if (ok) console.log('OK touch tap drops a piece');
  else fail('touch tap did not drop/score');
}
await tp.screenshot({ path: SHOTS + '/05-mobile.png' });
await tp.close();

console.log('\n--- console errors:', errors.length);
errors.forEach((e) => console.log('  ERR:', e));
if (errors.length) failures++;

await browser.close();
console.log(failures ? `\nPLAYTEST FAILED (${failures})` : '\nPLAYTEST PASSED');
process.exit(failures ? 1 : 0);
