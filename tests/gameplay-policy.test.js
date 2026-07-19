import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLOCK_SCALE,
  PERFECT_NORMALIZED_ERROR,
  challengeSpawnPosition,
  createScaledQueueEntry,
  createSeededRandom,
  scaleForPlacement,
  scaleShapeDefinition,
} from '../src/gameplay-policy.js';
import { SHAPES, randomShapeId, shapeById } from '../src/shapes.js';

const closeTo = (actual, expected, epsilon = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
};

test('preserves the complete seven-shape catalogue', () => {
  assert.deepEqual(
    SHAPES.map(({ id }) => id),
    ['slab', 'cube', 'column', 'puck', 'capsule', 'tee', 'gem']
  );
});

test('scale curve decays by placement and clamps at its minimum', () => {
  closeTo(scaleForPlacement(0), BLOCK_SCALE.start);
  closeTo(scaleForPlacement(5), BLOCK_SCALE.start * BLOCK_SCALE.decay ** 5);
  assert.equal(scaleForPlacement(100), BLOCK_SCALE.minimum);
  assert.throws(() => scaleForPlacement(-1), /placementIndex/);
  assert.throws(() => scaleForPlacement(1.5), /placementIndex/);
});

test('scaled shape keeps visual, physics, COM, mass, height, and footprint in sync', () => {
  const scale = 0.5;
  const base = shapeById('column');
  const scaled = scaleShapeDefinition(base, scale);

  assert.ok(Object.isFrozen(scaled));
  assert.ok(Object.isFrozen(scaled.comOffset));
  assert.ok(Object.isFrozen(scaled.geometryOffset));
  assert.ok(Object.isFrozen(scaled.physics));
  assert.ok(Object.isFrozen(scaled.physics.halfExtents));
  assert.ok(Object.isFrozen(scaled.footprint));
  closeTo(scaled.mass, base.mass * scale ** 3);
  closeTo(scaled.height, base.height * scale);
  closeTo(scaled.comOffset[1], base.comOffset[1] * scale);
  closeTo(scaled.geometryOffset[1], -base.comOffset[1] * scale);
  closeTo(scaled.physics.halfExtents[0], base.physics.halfExtents[0] * scale);
  closeTo(scaled.footprint.radius, 0.35 * scale);

  const geometry = scaled.createGeometry();
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
  closeTo(size, base.height * scale, 1e-6);
  closeTo(
    geometry.boundingBox.min.y + scaled.geometryOffset[1],
    scaled.physicsBounds.minY,
    0.01
  );
  closeTo(
    geometry.boundingBox.max.y + scaled.geometryOffset[1],
    scaled.physicsBounds.maxY,
    0.01
  );
  geometry.dispose();
});

test('scales every nested compound collider dimension and offset immutably', () => {
  const base = shapeById('tee');
  const scaled = scaleShapeDefinition(base, 0.8);

  assert.ok(Object.isFrozen(scaled.physics.shapes));
  assert.ok(Object.isFrozen(scaled.physics.shapes[0]));
  assert.ok(Object.isFrozen(scaled.physics.shapes[0].halfExtents));
  assert.ok(Object.isFrozen(scaled.physics.shapes[0].offset));
  closeTo(scaled.physics.shapes[0].halfExtents[0], 0.78 * 0.8);
  closeTo(scaled.physics.shapes[0].offset[1], 0.35 * 0.8);
  closeTo(scaled.physics.shapes[1].halfExtents[1], 0.34 * 0.8);
  closeTo(scaled.physicsBounds.maxY, (0.35 + 0.19 - 0.16) * 0.8);
});

test('queue entries are deterministic, immutable, scaled, and avoid immediate repeats', () => {
  const makeSequence = (seed) => {
    const random = createSeededRandom(seed);
    const entries = [];
    let previousShapeId = null;
    for (let placementIndex = 0; placementIndex < 20; placementIndex += 1) {
      const entry = createScaledQueueEntry({ placementIndex, previousShapeId, random });
      entries.push(entry);
      previousShapeId = entry.shapeId;
    }
    return entries;
  };

  const first = makeSequence('showcase-seed');
  const second = makeSequence('showcase-seed');
  assert.deepEqual(
    first.map(({ shapeId }) => shapeId),
    second.map(({ shapeId }) => shapeId)
  );
  for (let index = 0; index < first.length; index += 1) {
    assert.ok(Object.isFrozen(first[index]));
    assert.ok(Object.isFrozen(first[index].shape));
    closeTo(first[index].scale, scaleForPlacement(index));
    if (index > 0) assert.notEqual(first[index].shapeId, first[index - 1].shapeId);
  }
});

test('random shape selection accepts injected RNG and rejects invalid samples', () => {
  assert.equal(randomShapeId('slab', () => 0), 'cube');
  assert.throws(() => randomShapeId(null, () => 1), /\[0, 1\)/);
  assert.throws(() => randomShapeId(null, () => Number.NaN), /\[0, 1\)/);
});

test('challenge spawn is deterministic, outside perfect, and inside safe overlap', () => {
  const piece = scaleShapeDefinition(shapeById('column'), 0.8);
  const support = scaleShapeDefinition(shapeById('cube'), 0.9);
  const options = {
    placementIndex: 7,
    supportPosition: { x: 0.2, z: -0.1 },
    pieceFootprint: piece.footprint,
    supportFootprint: support.footprint,
    seed: 'tower-run',
    moveRange: 2.6,
  };
  const first = challengeSpawnPosition(options);
  const second = challengeSpawnPosition(options);

  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(first.distance > first.perfectDistance);
  assert.ok(first.normalizedError > PERFECT_NORMALIZED_ERROR);
  assert.ok(first.distance <= first.maximumSafeDistance);
  assert.ok(Math.abs(first.x) <= options.moveRange);
  closeTo(first.z, options.supportPosition.z);
});

test('challenge spawn remains actionable at the movement boundary', () => {
  const footprint = Object.freeze({ radius: 0.4 });
  const spawn = challengeSpawnPosition({
    placementIndex: 12,
    supportPosition: { x: 2.6, z: 2.6 },
    pieceFootprint: footprint,
    supportFootprint: footprint,
    seed: 1234,
    moveRange: 2.6,
  });

  assert.ok(spawn.distance > spawn.perfectDistance);
  assert.ok(spawn.distance <= spawn.maximumSafeDistance);
  assert.ok(spawn.x <= 2.6 && spawn.z <= 2.6);
  closeTo(spawn.z, 2.6);
});
