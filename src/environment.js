import * as THREE from 'three/webgpu';
import { createCameraFraming } from './render/camera-framing.js';
import { createGallery, createReflectionEnvironment } from './render/gallery.js';

const QUALITY_SETTINGS = Object.freeze({
  low: Object.freeze({ pixelRatio: 1, pmremSize: 128, shadows: true }),
  medium: Object.freeze({ pixelRatio: 1.5, pmremSize: 192, shadows: true }),
  high: Object.freeze({ pixelRatio: 2, pmremSize: 256, shadows: true }),
});

function validateOptions(container, quality) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('createEnvironment requires a container element');
  }
  if (!(quality in QUALITY_SETTINGS)) {
    throw new RangeError(`Unknown rendering quality: ${quality}`);
  }
}

function createRenderer({ forceWebGL, quality }) {
  const settings = QUALITY_SETTINGS[quality];
  const renderer = new THREE.WebGPURenderer({
    alpha: false,
    antialias: quality !== 'low',
    forceWebGL,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatio));
  renderer.shadowMap.enabled = settings.shadows;
  renderer.shadowMap.transmitted = settings.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', 'Glass Towers 3D sculptural studio');
  return renderer;
}

export async function createEnvironment(
  container,
  { forceWebGL = true, quality = 'high' } = {}
) {
  validateOptions(container, quality);
  const settings = QUALITY_SETTINGS[quality];
  const renderer = createRenderer({ forceWebGL, quality });
  container.appendChild(renderer.domElement);

  try {
    await renderer.init();
  } catch (error) {
    renderer.dispose();
    renderer.domElement.remove();
    throw new Error('Unable to initialize a WebGPU or WebGL2 renderer', { cause: error });
  }

  const scene = new THREE.Scene();
  scene.name = 'glass-towers-gallery';
  scene.background = new THREE.Color(0xcbb0ba);
  scene.fog = new THREE.Fog(0xcbb0ba, 27, 62);
  scene.environmentIntensity = 1.24;

  const gallery = createGallery({ quality });
  scene.add(gallery.group);

  const reflectionEnvironment = createReflectionEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(
    reflectionEnvironment.scene,
    0.045,
    0.1,
    100,
    { size: settings.pmremSize }
  );
  scene.environment = environmentTarget.texture;
  reflectionEnvironment.dispose();
  pmrem.dispose();

  const cameraFraming = createCameraFraming();
  const { camera } = cameraFraming;

  function updateCamera(frame, deltaSeconds) {
    cameraFraming.updateCamera(frame, deltaSeconds);
    gallery.updateLighting(frame, deltaSeconds);
  }

  function resize() {
    const width = Math.max(1, container.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, container.clientHeight || window.innerHeight || 1);
    cameraFraming.resize(width / height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatio));
    renderer.setSize(width, height);
  }

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  resizeObserver?.observe(container);
  window.addEventListener('resize', resize);
  resize();

  function render() {
    return renderer.render(scene, camera);
  }

  function dispose() {
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resize);
    renderer.setAnimationLoop(null);
    scene.environment = null;
    environmentTarget.dispose();
    gallery.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    renderer,
    scene,
    camera,
    updateCamera,
    updateShadowFocus: gallery.updateLighting,
    orbitCamera: cameraFraming.orbitCamera,
    zoomCamera: cameraFraming.zoomCamera,
    pedestalMesh: gallery.pedestalMesh,
    backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
    quality,
    render,
    resize,
    dispose,
  };
}
