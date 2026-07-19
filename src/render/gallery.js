import * as THREE from 'three/webgpu';
import { color, float, mix, mx_noise_float, positionWorld } from 'three/tsl';
import { PEDESTAL } from '../constants.js';

const QUALITY_SEGMENTS = Object.freeze({
  low: 32,
  medium: 48,
  high: 64,
});

const GALLERY = Object.freeze({
  radius: 17,
  wallHeight: 20,
  rearArtZ: -13.8,
  floorRadius: 18,
});

const SHADOW_SETTINGS = Object.freeze({
  low: Object.freeze({ mapSize: 512, radius: 2 }),
  medium: Object.freeze({ mapSize: 1024, radius: 3 }),
  high: Object.freeze({ mapSize: 2048, radius: 4 }),
});
const SHADOW_LIGHT_OFFSET = Object.freeze({ x: 0.8, y: 13, z: 1.1 });
const SHADOW_CAMERA_EXTENT = 4.2;
const SHADOW_FOCUS_RESPONSE = 7;

function assertQuality(quality) {
  if (!(quality in QUALITY_SEGMENTS)) {
    throw new RangeError(`Unknown gallery quality: ${quality}`);
  }
}

function createPlasterMaterial({ name, dark, light, scale = 0.18, roughness = 0.92 }) {
  const material = new THREE.MeshStandardNodeMaterial();
  const broadTone = mx_noise_float(positionWorld.mul(scale * 0.18)).mul(0.5).add(0.5);
  const grain = mx_noise_float(positionWorld.mul(scale)).mul(0.24).add(broadTone.mul(0.76));
  material.name = name;
  material.colorNode = mix(color(dark), color(light), grain);
  material.roughnessNode = mix(float(roughness), float(Math.max(0.62, roughness - 0.1)), grain);
  material.metalness = 0;
  return material;
}

function createSolidMaterial(name, parameters) {
  const material = new THREE.MeshStandardNodeMaterial(parameters);
  material.name = name;
  return material;
}

function addBox(group, name, size, position, material, { cast = false, receive = true } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  group.add(mesh);
  return mesh;
}

function createRibbonGeometry(side = 1) {
  const shape = new THREE.Shape();
  shape.moveTo(side * 11.8, 0);
  shape.bezierCurveTo(side * 11.45, 4.2, side * 10.6, 10.8, side * 7.2, 18.5);
  shape.lineTo(side * 3.7, 18.5);
  shape.bezierCurveTo(side * 7.1, 11.2, side * 8.25, 4.1, side * 7.45, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 20);
}

function createInnerArchGeometry(side = 1) {
  const shape = new THREE.Shape();
  shape.moveTo(side * 7.25, 0);
  shape.bezierCurveTo(side * 7.7, 5, side * 6.55, 11.6, side * 3.55, 18.5);
  shape.lineTo(side * 1.85, 18.5);
  shape.bezierCurveTo(side * 4.5, 11.5, side * 5.35, 5, side * 4.75, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 20);
}

function createFloorBlobGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-1, -0.15);
  shape.bezierCurveTo(-0.92, -0.82, -0.35, -1.08, 0.3, -0.93);
  shape.bezierCurveTo(0.95, -0.78, 1.12, -0.3, 0.93, 0.3);
  shape.bezierCurveTo(0.74, 0.9, 0.12, 1.07, -0.5, 0.82);
  shape.bezierCurveTo(-1.05, 0.6, -1.18, 0.25, -1, -0.15);
  return new THREE.ShapeGeometry(shape, 20);
}

function addFloorBlob(group, name, material, position, scale, rotation) {
  const mesh = new THREE.Mesh(createFloorBlobGeometry(), material);
  mesh.name = name;
  mesh.rotation.set(-Math.PI / 2, 0, rotation);
  mesh.position.set(position[0], 0.012 + position[1], position[2]);
  mesh.scale.set(scale[0], scale[1], 1);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addWallArt(group, name, geometry, material, zOffset = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(0, 0.02, GALLERY.rearArtZ + zOffset);
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addGalleryShell(group, materials, quality) {
  const segments = QUALITY_SEGMENTS[quality];
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(GALLERY.floorRadius, segments * 2),
    materials.floor
  );
  floor.name = 'gallery-floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const backdropMaterial = materials.wall;
  backdropMaterial.side = THREE.BackSide;
  const backdrop = new THREE.Mesh(
    new THREE.CylinderGeometry(
      GALLERY.radius,
      GALLERY.radius,
      GALLERY.wallHeight,
      segments * 2,
      1,
      true
    ),
    backdropMaterial
  );
  backdrop.name = 'curved-plaster-backdrop';
  backdrop.position.y = GALLERY.wallHeight / 2 - 0.03;
  backdrop.receiveShadow = true;
  group.add(backdrop);

  addWallArt(group, 'peach-monumental-ribbon-left', createRibbonGeometry(-1), materials.peach);
  addWallArt(group, 'peach-monumental-ribbon-right', createRibbonGeometry(1), materials.blush);
  addWallArt(group, 'cream-inner-arch-left', createInnerArchGeometry(-1), materials.cream, 0.025);
  addWallArt(group, 'cream-inner-arch-right', createInnerArchGeometry(1), materials.cream, 0.025);

  const floorInlays = [
    ['floor-inlay-coral', materials.floorCoral, [-8.2, 0, 4.4], [7.4, 5.5], 0.22],
    ['floor-inlay-cream', materials.floorCream, [0.2, 0.002, 1.7], [8.7, 4.7], -0.1],
    ['floor-inlay-lilac', materials.floorLilac, [8.8, 0.004, 2.4], [5.6, 4.8], -0.34],
    ['floor-inlay-mint', materials.floorMint, [-0.4, 0.006, -5.3], [9.2, 4], 0.12],
  ];
  for (const inlay of floorInlays) addFloorBlob(group, ...inlay);
}

function addPedestal(group, materials, quality) {
  const segments = QUALITY_SEGMENTS[quality];
  const pedestalMesh = new THREE.Group();
  pedestalMesh.name = 'pedestal';

  const profile = [
    new THREE.Vector2(1.72, 0.12),
    new THREE.Vector2(1.7, 0.2),
    new THREE.Vector2(1.55, 0.31),
    new THREE.Vector2(1.45, 0.55),
    new THREE.Vector2(1.55, 0.72),
    new THREE.Vector2(1.74, 0.79),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, segments), materials.pedestal);
  body.name = 'pedestal-concave-body';
  body.castShadow = true;
  body.receiveShadow = true;
  pedestalMesh.add(body);

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(PEDESTAL.radius - 0.04, PEDESTAL.radius, 0.17, segments),
    materials.pedestalTop
  );
  top.name = 'pedestal-rounded-top';
  top.position.y = PEDESTAL.height - 0.085;
  top.castShadow = true;
  top.receiveShadow = true;
  pedestalMesh.add(top);

  const topEdge = new THREE.Mesh(
    new THREE.TorusGeometry(PEDESTAL.radius - 0.095, 0.095, 12, segments),
    materials.pedestalTop
  );
  topEdge.name = 'pedestal-rounded-top-edge';
  topEdge.rotation.x = Math.PI / 2;
  topEdge.position.y = PEDESTAL.height - 0.1;
  topEdge.castShadow = true;
  pedestalMesh.add(topEdge);

  const bands = [
    ['pedestal-dark-underside', 1.73, 0.066, 0.785],
    ['pedestal-lower-dark-rim', 1.7, 0.074, 0.12],
  ];
  for (const [name, radius, tube, y] of bands) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 10, segments),
      materials.pedestalBand
    );
    band.name = name;
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    band.castShadow = true;
    pedestalMesh.add(band);
  }

  group.add(pedestalMesh);
  return pedestalMesh;
}

function addLighting(group, quality) {
  const shadowSettings = SHADOW_SETTINGS[quality];
  const key = new THREE.DirectionalLight(0xffe0ce, 3.8);
  key.name = 'warm-gallery-key-light';
  key.castShadow = true;
  key.shadow.mapSize.set(shadowSettings.mapSize, shadowSettings.mapSize);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 48;
  key.shadow.camera.left = -SHADOW_CAMERA_EXTENT;
  key.shadow.camera.right = SHADOW_CAMERA_EXTENT;
  key.shadow.camera.top = SHADOW_CAMERA_EXTENT;
  key.shadow.camera.bottom = -SHADOW_CAMERA_EXTENT;
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = shadowSettings.radius;
  let shadowFocusY = PEDESTAL.topY;
  key.position.set(
    SHADOW_LIGHT_OFFSET.x,
    shadowFocusY + SHADOW_LIGHT_OFFSET.y,
    SHADOW_LIGHT_OFFSET.z
  );
  key.target.position.set(0, shadowFocusY, 0);
  group.add(key, key.target);

  const fill = new THREE.HemisphereLight(0xf7eafa, 0xa56f79, 1.15);
  fill.name = 'gallery-fill-light';
  group.add(fill);

  const rim = new THREE.SpotLight(0xbfeeff, 100, 34, 0.5, 0.9, 2);
  rim.name = 'cyan-glass-rim-light';
  rim.position.set(-7.5, 8.5, 3.5);
  rim.target.position.set(0, 4, 0);
  group.add(rim, rim.target);

  const warm = new THREE.SpotLight(0xffb29e, 90, 32, 0.52, 0.9, 2);
  warm.name = 'peach-glass-rim-light';
  warm.position.set(7.5, 10, -2.5);
  warm.target.position.set(0, 4.5, 0);
  group.add(warm, warm.target);

  function update(frame, deltaSeconds = 0) {
    if (!frame || !Number.isFinite(frame.topY)) {
      throw new TypeError('Lighting focus requires a frame with a finite topY');
    }
    const dt = THREE.MathUtils.clamp(
      Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
      0,
      0.1
    );
    const targetY = Math.max(PEDESTAL.topY, frame.topY);
    const response = dt === 0 ? 1 : 1 - Math.exp(-SHADOW_FOCUS_RESPONSE * dt);
    shadowFocusY += (targetY - shadowFocusY) * response;
    key.position.set(
      SHADOW_LIGHT_OFFSET.x,
      shadowFocusY + SHADOW_LIGHT_OFFSET.y,
      SHADOW_LIGHT_OFFSET.z
    );
    key.target.position.set(0, shadowFocusY, 0);
    key.target.updateMatrixWorld();
    key.updateMatrixWorld();
  }

  return { update };
}

function disposeTree(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) if (material) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export function createGallery({ quality = 'high' } = {}) {
  assertQuality(quality);
  const group = new THREE.Group();
  group.name = 'warm-sculptural-gallery';

  const materials = {
    floor: createPlasterMaterial({
      name: 'gallery-floor-plaster',
      dark: 0xc78f8a,
      light: 0xe2b7aa,
      scale: 0.38,
      roughness: 0.9,
    }),
    wall: createPlasterMaterial({
      name: 'gallery-lilac-plaster-wall',
      dark: 0xa995ae,
      light: 0xcbb8c6,
      scale: 0.24,
      roughness: 0.94,
    }),
    peach: createPlasterMaterial({
      name: 'gallery-peach-ribbon',
      dark: 0xc98276,
      light: 0xe8ad97,
      scale: 0.3,
    }),
    blush: createPlasterMaterial({
      name: 'gallery-blush-ribbon',
      dark: 0xcc8f8b,
      light: 0xe6ada1,
      scale: 0.27,
    }),
    cream: createPlasterMaterial({
      name: 'gallery-cream-inner-arch',
      dark: 0xd6b4a2,
      light: 0xe9cfbf,
      scale: 0.3,
    }),
    pedestal: createSolidMaterial('gallery-pedestal-stone', {
      color: 0xa98d95,
      roughness: 0.78,
      metalness: 0,
    }),
    pedestalTop: createSolidMaterial('gallery-pedestal-top', {
      color: 0xe4c2b9,
      roughness: 0.68,
      metalness: 0,
    }),
    pedestalBand: createSolidMaterial('gallery-pedestal-dark-band', {
      color: 0x514154,
      roughness: 0.52,
      metalness: 0.05,
    }),
    floorCoral: createSolidMaterial('floor-coral-inlay', { color: 0xc9867f, roughness: 0.94 }),
    floorCream: createSolidMaterial('floor-cream-inlay', { color: 0xdbb4a6, roughness: 0.94 }),
    floorLilac: createSolidMaterial('floor-lilac-inlay', { color: 0xac96a5, roughness: 0.94 }),
    floorMint: createSolidMaterial('floor-mint-inlay', { color: 0xb0af9f, roughness: 0.94 }),
  };

  addGalleryShell(group, materials, quality);
  const pedestalMesh = addPedestal(group, materials, quality);
  const lighting = addLighting(group, quality);

  return {
    group,
    pedestalMesh,
    updateLighting: lighting.update,
    dispose() {
      disposeTree(group);
      group.removeFromParent();
    },
  };
}

export function createReflectionEnvironment() {
  const scene = new THREE.Scene();
  scene.name = 'glass-reflection-environment';
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(20, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xc8b2bd, side: THREE.BackSide })
  );
  scene.add(room);

  const cards = [
    { color: 0xffffff, size: [5, 9, 0.1], position: [-5, 3, -8] },
    { color: 0xffc4ad, size: [4, 7, 0.1], position: [4.5, 2, -8.5] },
    { color: 0xc8b8ff, size: [0.1, 7, 5], position: [-8.5, 4, 2] },
    { color: 0xaeeeff, size: [6, 0.1, 5], position: [0, 8.5, -1] },
    { color: 0xfff1dd, size: [0.1, 5, 6], position: [8.5, 2, 1] },
  ];
  for (const [index, card] of cards.entries()) {
    addBox(
      scene,
      `reflection-card-${index + 1}`,
      card.size,
      card.position,
      new THREE.MeshBasicMaterial({ color: card.color }),
      { receive: false }
    );
  }

  return {
    scene,
    dispose() {
      disposeTree(scene);
    },
  };
}
