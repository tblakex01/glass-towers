// Shape catalogue for Glass Towers.
// Each definition is plain data + a factory that returns a FRESH BufferGeometry
// centered on its geometric center. Physics defs are plain objects (no cannon-es
// here) that Group A converts to bodies. Physics volumes are kept slightly
// smaller than the visuals so stacked glass reads as touching tightly.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const SHAPES = [
  {
    // Wide, low foundation piece. Stable and generous.
    id: 'slab',
    name: 'Slab',
    tint: 0x9fd8ff, // icy blue
    mass: 2.5,
    height: 0.45,
    comOffset: [0, 0, 0],
    createGeometry() {
      return new RoundedBoxGeometry(2.0, 0.45, 1.4, 3, 0.06);
    },
    physics: { type: 'box', halfExtents: [0.98, 0.22, 0.68] },
  },
  {
    // Softly beveled cube — the dependable all-rounder.
    id: 'cube',
    name: 'Cube',
    tint: 0xa9edc9, // mint
    mass: 2.2,
    height: 1.05,
    comOffset: [0, 0, 0],
    createGeometry() {
      return new RoundedBoxGeometry(1.05, 1.05, 1.05, 3, 0.09);
    },
    physics: { type: 'box', halfExtents: [0.51, 0.51, 0.51] },
  },
  {
    // Tall slender column, deliberately top-heavy: risky, rewarding.
    id: 'column',
    name: 'Column',
    tint: 0xc9b8f6, // lilac
    mass: 2.0,
    height: 1.6,
    comOffset: [0, 0.32, 0],
    createGeometry() {
      return new RoundedBoxGeometry(0.72, 1.6, 0.72, 3, 0.05);
    },
    physics: { type: 'box', halfExtents: [0.35, 0.79, 0.35] },
  },
  {
    // Squat cylinder — a heavy paperweight of a piece.
    id: 'puck',
    name: 'Puck',
    tint: 0xf6cf96, // amber
    mass: 2.1,
    height: 0.45,
    comOffset: [0, 0, 0],
    createGeometry() {
      return new THREE.CylinderGeometry(0.85, 0.85, 0.45, 56);
    },
    physics: {
      type: 'cylinder',
      radiusTop: 0.84,
      radiusBottom: 0.84,
      height: 0.44,
      numSegments: 20,
    },
  },
  {
    // Rounded standing capsule; physics is a slightly smaller cylinder so the
    // domed ends visually nestle into neighbours.
    id: 'capsule',
    name: 'Capsule',
    tint: 0xf6b9c9, // blush
    mass: 1.7,
    height: 1.47, // 0.55 mid section + 2 * 0.46 caps
    comOffset: [0, 0, 0],
    createGeometry() {
      return new THREE.CapsuleGeometry(0.46, 0.55, 6, 28);
    },
    physics: {
      type: 'cylinder',
      radiusTop: 0.44,
      radiusBottom: 0.44,
      height: 1.32,
      numSegments: 14,
    },
  },
  {
    // T-shaped compound piece: wide cap on a short stem. Slightly top-heavy.
    id: 'tee',
    name: 'Tee',
    tint: 0xa5e8d6, // seafoam
    mass: 1.6,
    height: 1.1, // cap 0.4 + stem 0.7; bounds y in [-0.55, 0.55]
    comOffset: [0, 0.16, 0],
    createGeometry() {
      const cap = new RoundedBoxGeometry(1.6, 0.4, 0.6, 2, 0.05);
      cap.translate(0, 0.35, 0);
      const stem = new RoundedBoxGeometry(0.5, 0.7, 0.6, 2, 0.05);
      stem.translate(0, -0.2, 0);
      const merged = mergeGeometries([cap, stem], false);
      cap.dispose();
      stem.dispose();
      return merged;
    },
    physics: {
      type: 'compound',
      shapes: [
        { type: 'box', halfExtents: [0.78, 0.19, 0.29], offset: [0, 0.35, 0] },
        { type: 'box', halfExtents: [0.24, 0.34, 0.29], offset: [0, -0.2, 0] },
      ],
    },
  },
  {
    // Faceted gem — a squashed octahedron. Physics is a box approximation,
    // slightly bottom-heavy so it prefers to sit rather than roll.
    id: 'gem',
    name: 'Gem',
    tint: 0xb9c6f8, // periwinkle
    mass: 1.5,
    height: 1.152, // octahedron radius 0.72, squashed to 0.8 in y
    comOffset: [0, -0.08, 0],
    createGeometry() {
      const geometry = new THREE.OctahedronGeometry(0.72, 0);
      geometry.scale(1, 0.8, 1);
      return geometry;
    },
    physics: { type: 'box', halfExtents: [0.44, 0.44, 0.44] },
  },
];

export function shapeById(id) {
  return SHAPES.find((shape) => shape.id === id);
}

export function randomShapeId(prevId) {
  const pool =
    SHAPES.length > 1 ? SHAPES.filter((shape) => shape.id !== prevId) : SHAPES;
  return pool[Math.floor(Math.random() * pool.length)].id;
}
