// Reusable glass-piece catalogue. Every factory returns a fresh geometry
// centered on its visual center. Physics proxies are kept just inside the
// rendered surfaces so settled pieces read as clean glass-on-glass contact.

import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function createHorizontalCapsule() {
  const geometry = new THREE.CapsuleGeometry(0.39, 0.88, 8, 32);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}

function createRoundedFrustum() {
  const profile = [
    new THREE.Vector2(0, -0.41),
    new THREE.Vector2(0.77, -0.41),
    new THREE.Vector2(0.84, -0.36),
    new THREE.Vector2(0.86, -0.29),
    new THREE.Vector2(0.67, 0.33),
    new THREE.Vector2(0.62, 0.39),
    new THREE.Vector2(0, 0.39),
  ];
  return new THREE.LatheGeometry(profile, 64);
}

function createCounterweightedPlank() {
  const plank = new RoundedBoxGeometry(1.6, 0.4, 0.6, 4, 0.07);
  plank.translate(0, 0.35, 0);
  const ballast = new RoundedBoxGeometry(0.5, 0.7, 0.6, 4, 0.07);
  ballast.translate(0, -0.2, 0);
  const geometry = mergeGeometries([plank, ballast], false);
  plank.dispose();
  ballast.dispose();
  return geometry;
}

export const SHAPES = [
  {
    id: 'slab',
    name: 'Wide Slab',
    tint: 0x63ddec,
    mass: 2.5,
    height: 0.48,
    comOffset: [0, 0, 0],
    createGeometry() {
      return new RoundedBoxGeometry(2.08, 0.48, 1.24, 5, 0.11);
    },
    physics: { type: 'box', halfExtents: [1.01, 0.23, 0.59] },
  },
  {
    id: 'cube',
    name: 'Small Prism',
    tint: 0xff7f9d,
    mass: 1.25,
    height: 0.64,
    comOffset: [0.04, -0.04, 0],
    createGeometry() {
      return new RoundedBoxGeometry(0.82, 0.64, 0.78, 5, 0.1);
    },
    physics: { type: 'box', halfExtents: [0.39, 0.3, 0.37] },
  },
  {
    // A deliberately top-heavy vertical prism for risky narrow landings.
    id: 'column',
    name: 'Tall Prism',
    tint: 0x9e82ef,
    mass: 2,
    height: 1.6,
    comOffset: [0, 0.32, 0],
    createGeometry() {
      return new RoundedBoxGeometry(0.72, 1.6, 0.72, 5, 0.09);
    },
    physics: { type: 'box', halfExtents: [0.35, 0.79, 0.35] },
  },
  {
    id: 'puck',
    name: 'Amber Frustum',
    tint: 0xffb15f,
    mass: 2.25,
    height: 0.8,
    comOffset: [0, -0.12, 0],
    createGeometry: createRoundedFrustum,
    physics: {
      type: 'cylinder',
      radiusTop: 0.64,
      radiusBottom: 0.85,
      height: 0.78,
      numSegments: 24,
    },
  },
  {
    id: 'capsule',
    name: 'Horizontal Capsule',
    tint: 0x78ded5,
    mass: 1.6,
    height: 0.78,
    comOffset: [0.1, 0, 0],
    createGeometry: createHorizontalCapsule,
    physics: { type: 'box', halfExtents: [0.81, 0.38, 0.38] },
  },
  {
    // The lower glass keel keeps the familiar compound collider and gives this
    // thin plank an intentionally displaced center of mass.
    id: 'tee',
    name: 'Counterweighted Plank',
    tint: 0xb2de69,
    mass: 1.6,
    height: 1.1,
    comOffset: [0, 0.16, 0],
    createGeometry: createCounterweightedPlank,
    physics: {
      type: 'compound',
      shapes: [
        { type: 'box', halfExtents: [0.78, 0.19, 0.29], offset: [0, 0.35, 0] },
        { type: 'box', halfExtents: [0.24, 0.34, 0.29], offset: [0, -0.2, 0] },
      ],
    },
  },
  {
    id: 'gem',
    name: 'Rounded Bar',
    tint: 0xd875ef,
    mass: 1.45,
    height: 0.58,
    comOffset: [-0.12, -0.04, 0],
    createGeometry() {
      return new RoundedBoxGeometry(1.5, 0.58, 0.86, 5, 0.15);
    },
    physics: { type: 'box', halfExtents: [0.72, 0.27, 0.4] },
  },
];

export function shapeById(id) {
  return SHAPES.find((shape) => shape.id === id);
}

export function randomShapeId(prevId, random = Math.random) {
  if (typeof random !== 'function') {
    throw new TypeError('random must be a function');
  }
  const pool = SHAPES.length > 1
    ? SHAPES.filter((shape) => shape.id !== prevId)
    : SHAPES;
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('random must return a finite number in [0, 1)');
  }
  return pool[Math.floor(sample * pool.length)].id;
}
