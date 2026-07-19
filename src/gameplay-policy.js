import { randomShapeId, shapeById } from './shapes.js';

export const BLOCK_SCALE = Object.freeze({
  start: 1.1,
  decay: 0.97,
  minimum: 0.72,
});

export const PERFECT_NORMALIZED_ERROR = 0.22;

const CHALLENGE_START_ERROR = 0.42;
const CHALLENGE_ERROR_STEP = 0.025;
const CHALLENGE_MAX_ERROR = 0.85;
const CHALLENGE_PERFECT_MARGIN = 0.12;
const SAFE_OVERLAP_FRACTION = 0.55;
const UINT32_RANGE = 0x100000000;

function assertFinite(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function assertPlacementIndex(placementIndex) {
  if (!Number.isInteger(placementIndex) || placementIndex < 0) {
    throw new RangeError('placementIndex must be a non-negative integer');
  }
  return placementIndex;
}

function assertScale(scale) {
  assertFinite(scale, 'scale');
  if (scale <= 0) throw new RangeError('scale must be greater than zero');
  return scale;
}

function freezeVector(values) {
  return Object.freeze(values);
}

function scaleVector(vector, scale, name) {
  if (!Array.isArray(vector) || vector.length !== 3) {
    throw new TypeError(`${name} must be a three-element array`);
  }
  return freezeVector(vector.map((value, index) => assertFinite(value, `${name}[${index}]`) * scale));
}

function geometryOffsetForCenterOfMass(comOffset) {
  return freezeVector(comOffset.map((value) => -value));
}

function scalePhysicsPart(part, scale) {
  if (!part || typeof part !== 'object') {
    throw new TypeError('physics part must be an object');
  }

  const scaledOffset = part.offset
    ? { offset: scaleVector(part.offset, scale, 'physics offset') }
    : {};

  if (part.type === 'box') {
    return Object.freeze({
      ...part,
      ...scaledOffset,
      halfExtents: scaleVector(part.halfExtents, scale, 'box halfExtents'),
    });
  }

  if (part.type === 'cylinder') {
    return Object.freeze({
      ...part,
      ...scaledOffset,
      radiusTop: assertFinite(part.radiusTop, 'cylinder radiusTop') * scale,
      radiusBottom: assertFinite(part.radiusBottom, 'cylinder radiusBottom') * scale,
      height: assertFinite(part.height, 'cylinder height') * scale,
    });
  }

  if (part.type === 'compound') {
    if (!Array.isArray(part.shapes) || part.shapes.length === 0) {
      throw new TypeError('compound physics shape must contain parts');
    }
    return Object.freeze({
      ...part,
      ...scaledOffset,
      shapes: Object.freeze(part.shapes.map((shape) => scalePhysicsPart(shape, scale))),
    });
  }

  throw new Error(`Unknown physics shape type: ${part.type}`);
}

function unionBounds(target, bounds) {
  target.minX = Math.min(target.minX, bounds.minX);
  target.maxX = Math.max(target.maxX, bounds.maxX);
  target.minY = Math.min(target.minY, bounds.minY);
  target.maxY = Math.max(target.maxY, bounds.maxY);
  target.minZ = Math.min(target.minZ, bounds.minZ);
  target.maxZ = Math.max(target.maxZ, bounds.maxZ);
}

function physicsPartBounds(part, parentOffset = [0, 0, 0]) {
  const localOffset = part.offset || [0, 0, 0];
  const offset = [
    parentOffset[0] + localOffset[0],
    parentOffset[1] + localOffset[1],
    parentOffset[2] + localOffset[2],
  ];

  if (part.type === 'box') {
    const [halfX, halfY, halfZ] = part.halfExtents;
    return {
      minX: offset[0] - halfX,
      maxX: offset[0] + halfX,
      minY: offset[1] - halfY,
      maxY: offset[1] + halfY,
      minZ: offset[2] - halfZ,
      maxZ: offset[2] + halfZ,
    };
  }

  if (part.type === 'cylinder') {
    const radius = Math.max(part.radiusTop, part.radiusBottom);
    const halfHeight = part.height / 2;
    return {
      minX: offset[0] - radius,
      maxX: offset[0] + radius,
      minY: offset[1] - halfHeight,
      maxY: offset[1] + halfHeight,
      minZ: offset[2] - radius,
      maxZ: offset[2] + radius,
    };
  }

  if (part.type === 'compound') {
    const bounds = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    };
    for (const shape of part.shapes) unionBounds(bounds, physicsPartBounds(shape, offset));
    return bounds;
  }

  throw new Error(`Unknown physics shape type: ${part.type}`);
}

function freezeBounds(bounds) {
  return Object.freeze({
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: bounds.minY,
    maxY: bounds.maxY,
    minZ: bounds.minZ,
    maxZ: bounds.maxZ,
  });
}

export function scaleForPlacement(placementIndex) {
  assertPlacementIndex(placementIndex);
  return Math.max(
    BLOCK_SCALE.minimum,
    BLOCK_SCALE.start * BLOCK_SCALE.decay ** placementIndex
  );
}

export function computePhysicsBounds(physics, comOffset = [0, 0, 0]) {
  const bounds = physicsPartBounds(physics);
  const [comX, comY, comZ] = comOffset;
  return freezeBounds({
    minX: bounds.minX - comX,
    maxX: bounds.maxX - comX,
    minY: bounds.minY - comY,
    maxY: bounds.maxY - comY,
    minZ: bounds.minZ - comZ,
    maxZ: bounds.maxZ - comZ,
  });
}

export function computeFootprint(physics, comOffset = [0, 0, 0]) {
  const bounds = computePhysicsBounds(physics, comOffset);
  const halfX = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX));
  const halfZ = Math.max(Math.abs(bounds.minZ), Math.abs(bounds.maxZ));
  return Object.freeze({
    halfX,
    halfZ,
    radius: Math.min(halfX, halfZ),
    boundingRadius: Math.hypot(halfX, halfZ),
  });
}

export function scaleShapeDefinition(shapeDef, scale) {
  if (!shapeDef || typeof shapeDef.createGeometry !== 'function') {
    throw new TypeError('shapeDef must be a valid shape definition');
  }
  assertScale(scale);

  const comOffset = scaleVector(shapeDef.comOffset || [0, 0, 0], scale, 'comOffset');
  const geometryOffset = geometryOffsetForCenterOfMass(comOffset);
  const physics = scalePhysicsPart(shapeDef.physics, scale);
  const physicsBounds = computePhysicsBounds(physics, comOffset);
  const footprint = computeFootprint(physics, comOffset);
  const createBaseGeometry = shapeDef.createGeometry;

  return Object.freeze({
    ...shapeDef,
    baseMass: shapeDef.mass,
    scale,
    mass: assertFinite(shapeDef.mass, 'shape mass') * scale ** 3,
    height: assertFinite(shapeDef.height, 'shape height') * scale,
    comOffset,
    geometryOffset,
    physics,
    physicsBounds,
    footprint,
    createGeometry() {
      const geometry = createBaseGeometry();
      geometry.scale(scale, scale, scale);
      return geometry;
    },
  });
}

export function normalizeSeed(seed) {
  if (typeof seed === 'number') {
    assertFinite(seed, 'seed');
    return Math.trunc(seed) >>> 0;
  }
  if (typeof seed !== 'string') {
    throw new TypeError('seed must be a finite number or string');
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed) {
  let state = normalizeSeed(seed);
  return function seededRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function createScaledQueueEntry({
  placementIndex,
  previousShapeId = null,
  shapeId = null,
  random = Math.random,
}) {
  assertPlacementIndex(placementIndex);
  const selectedShapeId = shapeId ?? randomShapeId(previousShapeId, random);
  const baseShape = shapeById(selectedShapeId);
  if (!baseShape) throw new RangeError(`Unknown shape id: ${selectedShapeId}`);

  const scale = scaleForPlacement(placementIndex);
  const shape = scaleShapeDefinition(baseShape, scale);
  return Object.freeze({
    placementIndex,
    shapeId: selectedShapeId,
    scale,
    shape,
  });
}

function footprintRadius(footprint, name) {
  if (!footprint || typeof footprint !== 'object') {
    throw new TypeError(`${name} must be a footprint`);
  }
  const radius = assertFinite(footprint.radius, `${name}.radius`);
  if (radius <= 0) throw new RangeError(`${name}.radius must be greater than zero`);
  return radius;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function challengeSpawnPosition({
  placementIndex,
  supportPosition,
  pieceFootprint,
  supportFootprint,
  seed = 0,
  moveRange = Infinity,
}) {
  assertPlacementIndex(placementIndex);
  const supportX = assertFinite(supportPosition?.x, 'supportPosition.x');
  const supportZ = assertFinite(supportPosition?.z, 'supportPosition.z');
  const pieceRadius = footprintRadius(pieceFootprint, 'pieceFootprint');
  const supportRadius = footprintRadius(supportFootprint, 'supportFootprint');
  const referenceRadius = Math.min(pieceRadius, supportRadius);
  const minimumDistance = referenceRadius *
    (PERFECT_NORMALIZED_ERROR + CHALLENGE_PERFECT_MARGIN);
  const maximumDistance = (pieceRadius + supportRadius) * SAFE_OVERLAP_FRACTION;
  const desiredError = Math.min(
    CHALLENGE_MAX_ERROR,
    CHALLENGE_START_ERROR + placementIndex * CHALLENGE_ERROR_STEP
  );
  const distance = Math.min(
    maximumDistance,
    Math.max(minimumDistance, referenceRadius * desiredError)
  );
  const directionSeed = normalizeSeed(seed) ^ Math.imul(placementIndex + 1, 0x9e3779b1);
  const preferredDirection = directionSeed & 1 ? 1 : -1;

  if (moveRange !== Infinity) {
    assertFinite(moveRange, 'moveRange');
    if (moveRange <= 0) throw new RangeError('moveRange must be greater than zero');
    if (Math.abs(supportX) > moveRange || Math.abs(supportZ) > moveRange) {
      throw new RangeError('supportPosition must be inside moveRange');
    }
  }

  let best = null;
  for (const direction of [preferredDirection, -preferredDirection]) {
    const rawX = supportX + direction * distance;
    const x = moveRange === Infinity ? rawX : clamp(rawX, -moveRange, moveRange);
    const actualDistance = Math.abs(x - supportX);
    const candidate = {
      x,
      z: supportZ,
      angle: direction > 0 ? 0 : Math.PI,
      distance: actualDistance,
    };
    if (!best || candidate.distance > best.distance) best = candidate;
    if (actualDistance >= minimumDistance) {
      best = candidate;
      break;
    }
  }

  return Object.freeze({
    x: best.x,
    z: best.z,
    angle: best.angle,
    distance: best.distance,
    normalizedError: best.distance / referenceRadius,
    perfectDistance: referenceRadius * PERFECT_NORMALIZED_ERROR,
    maximumSafeDistance: maximumDistance,
  });
}
