import assert from 'node:assert/strict';
import test from 'node:test';
import { createCameraFraming } from '../src/render/camera-framing.js';

function advance(framing, frame, seconds = 3) {
  const frames = Math.round(seconds * 60);
  for (let index = 0; index < frames; index += 1) {
    framing.updateCamera(frame, 1 / 60);
  }
}

test('camera rises with tower growth and descends with a collapse', () => {
  const framing = createCameraFraming({ aspect: 16 / 9 });
  const baselineY = framing.camera.position.y;
  advance(framing, { topY: 11, bottomY: 0, state: 'aiming' });
  const grownY = framing.camera.position.y;
  assert.ok(grownY > baselineY + 1, `expected growth framing above ${baselineY}, got ${grownY}`);

  advance(framing, { topY: 2, bottomY: 0, state: 'gameover' }, 4);
  assert.ok(
    framing.camera.position.y < grownY - 1,
    `expected collapse framing below ${grownY}, got ${framing.camera.position.y}`
  );
});

test('narrow viewports back the camera away to preserve the structure', () => {
  const wide = createCameraFraming({ aspect: 16 / 9 });
  const narrow = createCameraFraming({ aspect: 9 / 16 });
  const frame = { topY: 8, bottomY: 0, state: 'aiming' };
  advance(wide, frame);
  advance(narrow, frame);
  assert.ok(narrow.camera.position.length() > wide.camera.position.length());
});

test('pointer orbit rotates around the tower without changing framing distance', () => {
  const framing = createCameraFraming({ aspect: 16 / 9 });
  const frame = { topY: 6, bottomY: 0, state: 'aiming' };
  advance(framing, frame);
  const before = framing.camera.position.clone();
  framing.orbitCamera(120);
  advance(framing, frame, 1);
  const after = framing.camera.position.clone();

  assert.ok(after.distanceTo(before) > 2, 'expected orbit input to move the camera');
  assert.ok(Math.abs(after.length() - before.length()) < 0.4, 'expected orbit to preserve distance');
  assert.throws(() => framing.orbitCamera(Number.NaN), /finite/);
});

test('vertical orbit and wheel zoom remain bounded around the live target', () => {
  const framing = createCameraFraming({ aspect: 16 / 9 });
  const frame = { topY: 6, bottomY: 0, state: 'aiming' };
  advance(framing, frame);
  const baseline = framing.camera.position.clone();

  framing.orbitCamera(0, 120);
  advance(framing, frame, 1);
  assert.ok(framing.camera.position.y > baseline.y + 1, 'vertical drag raises the orbit');

  const beforeZoom = framing.camera.position.length();
  framing.zoomCamera(500);
  advance(framing, frame, 1);
  assert.ok(framing.camera.position.length() > beforeZoom + 1, 'wheel input changes distance');
  assert.throws(() => framing.zoomCamera(Number.NaN), /finite/);
});
