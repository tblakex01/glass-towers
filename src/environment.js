// Renderer, scene, lighting, pedestal and camera rig for Glass Towers.
// Soft studio look: RoomEnvironment PMREM for reflections/refraction, one soft
// shadow-casting key light, warm gradient backdrop with matching fog, and a
// camera that gently cranes up as the tower grows.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PEDESTAL } from './constants.js';

const BACKGROUND_TOP = '#fbfaf7';
const BACKGROUND_BOTTOM = '#e7e1d7';
const FOG_COLOR = 0xece7de;

const CAMERA_START = new THREE.Vector3(6.5, 5.5, 8);
const LOOK_START_Y = 2;

function createBackgroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, BACKGROUND_TOP);
  gradient.addColorStop(1, BACKGROUND_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEnvironment(container) {
  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // --- Scene, environment map, backdrop ---
  const scene = new THREE.Scene();
  scene.background = createBackgroundTexture();
  scene.fog = new THREE.Fog(FOG_COLOR, 18, 55);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();

  // --- Lights ---
  const key = new THREE.DirectionalLight(0xfff6ec, 2.4);
  key.position.set(6, 10, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 32;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 6;
  key.target.position.set(0, 3, 0);
  scene.add(key, key.target);

  const fill = new THREE.HemisphereLight(0xffffff, 0xd8d2c6, 0.55);
  scene.add(fill);

  // --- Ground ---
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(34, 72),
    new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Pedestal ---
  const pedestalMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      PEDESTAL.radius,
      PEDESTAL.radius * 1.035,
      PEDESTAL.height,
      96
    ),
    new THREE.MeshStandardMaterial({ color: 0x847e74, roughness: 0.85, metalness: 0.05 })
  );
  pedestalMesh.position.y = PEDESTAL.height / 2;
  pedestalMesh.castShadow = true;
  pedestalMesh.receiveShadow = true;

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(PEDESTAL.radius - 0.02, 0.018, 12, 96),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.45, metalness: 0.25 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = PEDESTAL.height / 2; // local: sits on the pedestal's top edge
  pedestalMesh.add(rim);
  scene.add(pedestalMesh);

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  camera.position.copy(CAMERA_START);
  camera.lookAt(0, LOOK_START_Y, 0);

  // Camera rig state (smoothed internally; positions applied via lerp so the
  // effects module's additive shake offset composes without fighting us).
  const baseRadius = Math.hypot(CAMERA_START.x, CAMERA_START.z);
  const baseAngle = Math.atan2(CAMERA_START.z, CAMERA_START.x);
  let lookY = LOOK_START_Y;
  let rigHeight = CAMERA_START.y;
  let rigRadius = baseRadius;
  let driftTime = 0;
  const desired = new THREE.Vector3();

  function updateCamera(towerTopY, dt) {
    const top = Math.max(towerTopY, PEDESTAL.topY);
    const targetLookY = Math.max(LOOK_START_Y, top * 0.55 + 0.8);
    const targetHeight = CAMERA_START.y + Math.max(0, top - 2) * 0.8;
    const targetRadius = baseRadius + Math.max(0, top - 2) * 0.4;

    driftTime += dt;
    const k = 1 - Math.exp(-2.5 * dt);
    lookY += (targetLookY - lookY) * k;
    rigHeight += (targetHeight - rigHeight) * k;
    rigRadius += (targetRadius - rigRadius) * k;

    // Very slow sinusoidal orbit drift (a few degrees) for a bit of life.
    const angle = baseAngle + Math.sin(driftTime * 0.07) * 0.06;
    desired.set(
      Math.cos(angle) * rigRadius,
      rigHeight,
      Math.sin(angle) * rigRadius
    );
    camera.position.lerp(desired, 1 - Math.exp(-3 * dt));
    camera.lookAt(0, lookY, 0);
  }

  function resize() {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
  }

  window.addEventListener('resize', resize);
  resize();

  function render() {
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, updateCamera, pedestalMesh, render, resize };
}
