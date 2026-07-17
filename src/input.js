import * as THREE from 'three';

const TAP_MAX_MS = 300;
const TAP_MAX_PX = 6;
const NUDGE_STEP = 0.18;

export function createInput(domElement, { camera, onAim, onNudge, onDrop, onRestart }) {
  const raycaster = new THREE.Raycaster();
  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  let down = null;

  function aim(event) {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(aimPlane, hit)) onAim({ x: hit.x, z: hit.z });
  }

  function handlePointerDown(event) {
    if (event.target !== domElement) return;
    down = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId };
    domElement.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (event.target !== domElement) return;
    aim(event);
  }

  function handlePointerUp(event) {
    if (!down || event.pointerId !== down.id) return;
    const dist = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    const elapsed = performance.now() - down.time;
    down = null;
    if (elapsed < TAP_MAX_MS && dist < TAP_MAX_PX) onDrop();
  }

  function handleKeyDown(event) {
    switch (event.code) {
      case 'Space':
        event.preventDefault();
        onDrop();
        break;
      case 'ArrowLeft':
      case 'KeyA':
        onNudge({ dx: -NUDGE_STEP, dz: 0 });
        break;
      case 'ArrowRight':
      case 'KeyD':
        onNudge({ dx: NUDGE_STEP, dz: 0 });
        break;
      case 'ArrowUp':
      case 'KeyW':
        onNudge({ dx: 0, dz: -NUDGE_STEP });
        break;
      case 'ArrowDown':
      case 'KeyS':
        onNudge({ dx: 0, dz: NUDGE_STEP });
        break;
      case 'KeyR':
        onRestart();
        break;
    }
  }

  domElement.addEventListener('pointerdown', handlePointerDown);
  domElement.addEventListener('pointermove', handlePointerMove);
  domElement.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('keydown', handleKeyDown);

  return {
    setAimPlaneY(y) {
      aimPlane.constant = -y;
    },
    dispose() {
      domElement.removeEventListener('pointerdown', handlePointerDown);
      domElement.removeEventListener('pointermove', handlePointerMove);
      domElement.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
    },
  };
}
