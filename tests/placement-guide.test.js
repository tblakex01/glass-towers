import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createPlacementGuide } from '../src/render/placement-guide.js';

function markerFor(guide) {
  return guide.group.getObjectByName('placement-guide-marker');
}

test('placement guide validates its scene and update inputs before mutation', () => {
  assert.throws(() => createPlacementGuide(null), /requires a Three\.js Scene/);
  assert.throws(() => createPlacementGuide(new THREE.Group()), /requires a Three\.js Scene/);

  const scene = new THREE.Scene();
  const guide = createPlacementGuide(scene);
  guide.update({ x: 0.5, y: 4, z: -0.25, movementRange: 2.6 });
  const originalPosition = guide.group.position.clone();

  for (const options of [
    null,
    [],
    { x: Number.NaN, y: 4, z: 0, movementRange: 2.6 },
    { x: 0, y: Number.POSITIVE_INFINITY, z: 0, movementRange: 2.6 },
    { x: 0, y: 4, z: undefined, movementRange: 2.6 },
    { x: 0, y: 4, z: 0, movementRange: Number.NaN },
  ]) {
    assert.throws(() => guide.update(options), /finite number|options object/);
    assert.deepEqual(guide.group.position.toArray(), originalPosition.toArray());
  }
  assert.throws(
    () => guide.update({ x: 0, y: 4, z: 0, movementRange: 0 }),
    /greater than zero/
  );

  guide.dispose();
});

test('placement guide updates its world plane, rail span, and clamped marker position', () => {
  const scene = new THREE.Scene();
  const guide = createPlacementGuide(scene);
  const marker = markerFor(guide);
  const leftTick = guide.group.getObjectByName('placement-guide-left-tick');
  const rightTick = guide.group.getObjectByName('placement-guide-right-tick');
  const originalChildren = [...guide.group.children];

  guide.update({ x: 1.25, y: 6.5, z: -0.75, movementRange: 2.6 });
  assert.deepEqual(guide.group.position.toArray(), [0, 6.5, -0.75]);
  assert.equal(marker.position.x, 1.25);
  assert.equal(leftTick.position.x, -2.6);
  assert.equal(rightTick.position.x, 2.6);

  guide.update({ x: 20, y: 7, z: 0.5, movementRange: 3 });
  assert.equal(marker.position.x, 3);
  assert.equal(leftTick.position.x, -3);
  assert.equal(rightTick.position.x, 3);
  assert.deepEqual(guide.group.children, originalChildren, 'update should reuse existing meshes');

  guide.update({ x: -20, y: 7, z: 0.5, movementRange: 3 });
  assert.equal(marker.position.x, -3);

  guide.dispose();
});

test('placement guide visibility is explicit and reusable across placements', () => {
  const scene = new THREE.Scene();
  const guide = createPlacementGuide(scene);
  assert.equal(guide.group.visible, false);

  guide.show();
  assert.equal(guide.group.visible, true);
  guide.update({ x: 0, y: 4, z: 0, movementRange: 2.6 });
  guide.hide();
  assert.equal(guide.group.visible, false);

  guide.update({ x: 1, y: 5, z: 0.25, movementRange: 2.6 });
  guide.show();
  assert.equal(guide.group.visible, true);
  assert.equal(markerFor(guide).position.x, 1);

  guide.dispose();
});

test('placement guide disposal is idempotent and releases shared resources', () => {
  const scene = new THREE.Scene();
  const guide = createPlacementGuide(scene);
  const marker = markerFor(guide);
  let geometryDisposals = 0;
  let coralDisposals = 0;
  marker.geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
  marker.material.addEventListener('dispose', () => { coralDisposals += 1; });

  assert.equal(guide.group.parent, scene);
  guide.dispose();
  guide.dispose();

  assert.equal(guide.group.parent, null);
  assert.equal(guide.group.visible, false);
  assert.equal(geometryDisposals, 1);
  assert.equal(coralDisposals, 1);
  assert.throws(() => guide.show(), /disposed/);
  assert.throws(() => guide.hide(), /disposed/);
  assert.throws(
    () => guide.update({ x: 0, y: 0, z: 0, movementRange: 1 }),
    /disposed/
  );
});
