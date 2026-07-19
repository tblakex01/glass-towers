import * as THREE from 'three/webgpu';
import { createGlassMaterial } from './glass.js';
import { createReflectionEnvironment } from './render/gallery.js';

const FIT_RADIUS = 0.62;
const ROTATE_SPEED = 0.6;
const FRAME_INTERVAL = 1 / 20;

export function createPreview(
  canvas,
  { forceWebGL = true, quality = 'medium' } = {}
) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('createPreview requires a canvas element');
  }

  const renderer = new THREE.WebGPURenderer({
    canvas,
    alpha: true,
    antialias: true,
    forceWebGL,
    powerPreference: 'high-performance',
  });
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.background = null;
  scene.environmentIntensity = 1.35;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  camera.position.set(0, 0.55, 2.4);
  camera.lookAt(0, 0, 0);

  const pivot = new THREE.Group();
  pivot.rotation.x = 0.18;
  scene.add(pivot);

  const key = new THREE.DirectionalLight(0xffdfcf, 3.1);
  key.position.set(-3, 4, 4);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xf2e6ff, 0x8b6677, 1.45));
  const rim = new THREE.PointLight(0xb8efff, 6.5, 6, 2);
  rim.position.set(2, 0.8, -1.5);
  scene.add(rim);

  let mesh = null;
  let environmentTarget = null;
  let pendingShape = null;
  let frameAccumulator = 0;
  let initialized = false;
  let disposed = false;

  function disposeMesh() {
    if (!mesh) return;
    pivot.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    mesh = null;
  }

  function render() {
    if (initialized && !disposed) renderer.render(scene, camera);
  }

  function applyShape(shapeDef) {
    disposeMesh();
    if (!shapeDef) {
      render();
      return;
    }

    const geometry = shapeDef.createGeometry();
    const material = createGlassMaterial({
      tint: shapeDef.tint,
      thickness: THREE.MathUtils.clamp((shapeDef.height || 1) * 0.65, 0.3, 1.2),
      quality,
      contrast: 1.32,
    });
    mesh = new THREE.Mesh(geometry, material);

    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (sphere && sphere.radius > 0) {
      const scale = FIT_RADIUS / sphere.radius;
      mesh.scale.setScalar(scale);
      mesh.position.set(
        -sphere.center.x * scale,
        -sphere.center.y * scale,
        -sphere.center.z * scale
      );
    }
    pivot.add(mesh);
    render();
  }

  const ready = renderer
    .init()
    .then(() => {
      if (disposed) return;
      const reflectionEnvironment = createReflectionEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      try {
        environmentTarget = pmrem.fromScene(
          reflectionEnvironment.scene,
          0.05,
          0.1,
          100,
          { size: 128 }
        );
        scene.environment = environmentTarget.texture;
      } finally {
        reflectionEnvironment.dispose();
        pmrem.dispose();
      }
      initialized = true;
      applyShape(pendingShape);
    })
    .catch((error) => {
      if (!disposed) console.error('Next-piece preview renderer failed to initialize', error);
    });

  function setShape(shapeDef) {
    pendingShape = shapeDef || null;
    if (initialized) applyShape(pendingShape);
  }

  function update(deltaSeconds) {
    if (!initialized || disposed) return;
    const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.1);
    pivot.rotation.y += ROTATE_SPEED * dt;
    frameAccumulator += dt;
    if (frameAccumulator >= FRAME_INTERVAL) {
      frameAccumulator %= FRAME_INTERVAL;
      render();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    disposeMesh();
    scene.environment = null;
    environmentTarget?.dispose();
    renderer.dispose();
  }

  return { setShape, update, dispose, ready };
}
