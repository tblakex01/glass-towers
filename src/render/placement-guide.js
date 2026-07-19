import * as THREE from 'three/webgpu';

const SEGMENT_COUNT = 10;
const SEGMENT_FILL = 0.82;
const RAIL_HEIGHT = 0.055;
const RAIL_DEPTH = 0.07;
const TICK_WIDTH = 0.055;
const TICK_HEIGHT = 0.3;
const TICK_DEPTH = 0.1;
const MARKER_SIZE = 0.18;
const MARKER_DEPTH = 0.085;
const MARKER_Y = -0.19;

const COLORS = Object.freeze({
  navy: 0x172b3d,
  coral: 0xf36f62,
});

function assertScene(scene) {
  if (!scene?.isScene) {
    throw new TypeError('createPlacementGuide requires a Three.js Scene');
  }
}

function assertFinite(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Placement guide ${name} must be a finite number`);
  }
}

function validateUpdate(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Placement guide update requires an options object');
  }

  const { x, y, z, movementRange } = options;
  assertFinite(x, 'x');
  assertFinite(y, 'y');
  assertFinite(z, 'z');
  assertFinite(movementRange, 'movementRange');
  if (movementRange <= 0) {
    throw new RangeError('Placement guide movementRange must be greater than zero');
  }

  return options;
}

function createGuideMaterial(name, color) {
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  material.name = name;
  return material;
}

function configureMesh(mesh, name, renderOrder) {
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

/**
 * Creates a reusable world-space placement rail. The returned guide starts hidden.
 * update() moves the rail plane to y/z and positions its marker at the clamped world x.
 */
export function createPlacementGuide(scene) {
  assertScene(scene);

  const group = new THREE.Group();
  group.name = 'placement-guide';
  group.visible = false;
  group.frustumCulled = false;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.name = 'placement-guide-unit-box';
  const navyMaterial = createGuideMaterial('placement-guide-navy', COLORS.navy);
  const coralMaterial = createGuideMaterial('placement-guide-coral', COLORS.coral);

  const segments = [];
  for (let index = 0; index < SEGMENT_COUNT; index += 1) {
    const material = index % 2 === 0 ? navyMaterial : coralMaterial;
    const segment = configureMesh(
      new THREE.Mesh(geometry, material),
      `placement-guide-segment-${index + 1}`,
      20
    );
    group.add(segment);
    segments.push(segment);
  }

  const leftTick = configureMesh(
    new THREE.Mesh(geometry, navyMaterial),
    'placement-guide-left-tick',
    20
  );
  const rightTick = configureMesh(
    new THREE.Mesh(geometry, navyMaterial),
    'placement-guide-right-tick',
    20
  );
  leftTick.scale.set(TICK_WIDTH, TICK_HEIGHT, TICK_DEPTH);
  rightTick.scale.copy(leftTick.scale);
  group.add(leftTick, rightTick);

  const marker = configureMesh(
    new THREE.Mesh(geometry, coralMaterial),
    'placement-guide-marker',
    21
  );
  marker.rotation.z = Math.PI / 4;
  marker.position.set(0, MARKER_Y, RAIL_DEPTH);
  marker.scale.set(MARKER_SIZE, MARKER_SIZE, MARKER_DEPTH);
  group.add(marker);
  scene.add(group);

  let lastRange = -1;
  let disposed = false;

  function assertActive() {
    if (disposed) {
      throw new Error('Placement guide has been disposed');
    }
  }

  function layoutRail(movementRange) {
    if (movementRange === lastRange) return;

    const pitch = movementRange * 2 / SEGMENT_COUNT;
    const segmentWidth = pitch * SEGMENT_FILL;
    const leftEdge = -movementRange;
    for (let index = 0; index < SEGMENT_COUNT; index += 1) {
      const segment = segments[index];
      segment.position.x = leftEdge + pitch * (index + 0.5);
      segment.scale.set(segmentWidth, RAIL_HEIGHT, RAIL_DEPTH);
    }
    leftTick.position.set(-movementRange, 0, 0);
    rightTick.position.set(movementRange, 0, 0);
    lastRange = movementRange;
  }

  function show() {
    assertActive();
    group.visible = true;
  }

  function update(options) {
    assertActive();
    const { x, y, z, movementRange } = validateUpdate(options);
    layoutRail(movementRange);
    group.position.set(0, y, z);
    marker.position.x = THREE.MathUtils.clamp(x, -movementRange, movementRange);
  }

  function hide() {
    assertActive();
    group.visible = false;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    group.visible = false;
    group.removeFromParent();
    geometry.dispose();
    navyMaterial.dispose();
    coralMaterial.dispose();
  }

  return { group, show, update, hide, dispose };
}
