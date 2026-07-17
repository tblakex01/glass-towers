import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGlassMaterial } from './glass.js';

// Radius (in world units) the shape's bounding sphere is scaled to fit.
const FIT_RADIUS = 0.62;
const ROTATE_SPEED = 0.6; // rad/s

export function createPreview(canvas /* #next-preview */) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = null; // transparent

  // Studio environment for the glass material (generated once).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  camera.position.set(0, 0.55, 2.4);
  camera.lookAt(0, 0, 0);

  // Pivot so rotation is always about the frame center.
  const pivot = new THREE.Group();
  pivot.rotation.x = 0.18; // slight downward tilt for a nicer angle
  scene.add(pivot);

  let mesh = null;

  function disposeMesh() {
    if (!mesh) return;
    pivot.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
    mesh = null;
  }

  function render() {
    renderer.render(scene, camera);
  }

  function setShape(shapeDef) {
    disposeMesh();
    if (!shapeDef) {
      render();
      return;
    }

    const geometry = shapeDef.createGeometry();
    const material = createGlassMaterial({ tint: shapeDef.tint });
    mesh = new THREE.Mesh(geometry, material);

    // Auto-scale to fit the frame using the bounding sphere.
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (sphere && sphere.radius > 0) {
      const s = FIT_RADIUS / sphere.radius;
      mesh.scale.setScalar(s);
      // Recenter in case the geometry isn't perfectly centered.
      mesh.position.set(
        -sphere.center.x * s,
        -sphere.center.y * s,
        -sphere.center.z * s
      );
    }

    pivot.add(mesh);
    render(); // never show a stale/blank frame
  }

  function update(dt) {
    pivot.rotation.y += ROTATE_SPEED * (dt || 0);
    render();
  }

  return { setShape, update };
}
