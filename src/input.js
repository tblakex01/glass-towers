import * as THREE from 'three/webgpu';

const ORBIT_START_PX = 8;
const NUDGE_STEP = 0.18;

export function createInput(domElement, {
  camera,
  onAim,
  onNudge,
  onOrbit,
  onZoom,
  onDrop,
  onRestart,
  onFocus,
}) {
  const raycaster = new THREE.Raycaster();
  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const touchPoints = new Map();
  let down = null;
  let touchGestureWasMulti = false;
  let activated = false;

  domElement.tabIndex = 0;
  domElement.setAttribute('role', 'application');
  domElement.setAttribute('aria-label', 'Glass Towers playfield');
  domElement.setAttribute('aria-describedby', 'tutorial');

  function handlePointerModality() {
    domElement.dataset.inputModality = 'pointer';
  }

  function aim(event) {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(aimPlane, hit)) onAim({ x: hit.x });
  }

  function handlePointerDown(event) {
    if (event.target !== domElement) return;
    domElement.focus({ preventScroll: true });
    const focusOnly = !activated;
    activated = true;
    onFocus();
    if (event.pointerType !== 'mouse') {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size > 1) touchGestureWasMulti = true;
    } else if (!focusOnly) {
      aim(event);
    }
    down = {
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      id: event.pointerId,
      orbiting: false,
      focusOnly,
    };
    try {
      domElement.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic and accessibility-generated pointer events may not be capturable.
    }
  }

  function handlePointerMove(event) {
    if (event.target !== domElement) return;
    if (!activated || (down?.focusOnly && event.pointerId === down.id)) return;
    if (event.pointerType !== 'mouse') {
      const previous = touchPoints.get(event.pointerId);
      if (!previous) return;
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size > 1 || touchGestureWasMulti) {
        touchGestureWasMulti = true;
        onOrbit({ dx: event.clientX - previous.x, dy: event.clientY - previous.y });
      } else {
        aim(event);
      }
      return;
    }
    if (event.pointerType === 'mouse' && down && event.pointerId === down.id) {
      const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (down.orbiting || distance >= ORBIT_START_PX) {
        down.orbiting = true;
        onOrbit({ dx: event.clientX - down.lastX, dy: event.clientY - down.lastY });
        down.lastX = event.clientX;
        down.lastY = event.clientY;
        return;
      }
    }
    aim(event);
  }

  function releasePointer(event) {
    if (domElement.hasPointerCapture?.(event.pointerId)) {
      domElement.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerUp(event) {
    if (event.pointerType !== 'mouse') {
      if (!touchPoints.has(event.pointerId)) return;
      const shouldDrop = !touchGestureWasMulti && touchPoints.size === 1 && !down?.focusOnly;
      touchPoints.delete(event.pointerId);
      releasePointer(event);
      if (touchPoints.size === 0) {
        down = null;
        touchGestureWasMulti = false;
      }
      if (shouldDrop) onDrop();
      return;
    }
    if (!down || event.pointerId !== down.id) return;
    const orbiting = down.orbiting;
    const focusOnly = down.focusOnly;
    down = null;
    releasePointer(event);
    if (!orbiting && !focusOnly) onDrop();
  }

  function handleWheel(event) {
    if (event.target !== domElement) return;
    event.preventDefault();
    activated = true;
    onFocus();
    onZoom({ dy: event.deltaY });
  }

  function cancelPointer(event) {
    if (event.pointerId != null) touchPoints.delete(event.pointerId);
    if (down && (event.pointerId == null || event.pointerId === down.id)) down = null;
    if (touchPoints.size === 0) touchGestureWasMulti = false;
    if (event.pointerId != null) releasePointer(event);
  }

  function cancelTransientInput() {
    down = null;
    touchPoints.clear();
    touchGestureWasMulti = false;
  }

  function isEditableTarget(target) {
    return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function handleKeyDown(event) {
    if (!['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) {
      domElement.dataset.inputModality = 'keyboard';
    }
    if (document.visibilityState !== 'visible' || isEditableTarget(event.target)) return;
    if ((event.code === 'Space' || event.code === 'KeyR') && event.repeat) return;
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return;
    if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) onFocus();
    if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(event.code)) activated = true;

    switch (event.code) {
      case 'Space':
        event.preventDefault();
        onDrop();
        break;
      case 'ArrowLeft':
      case 'KeyA':
        event.preventDefault();
        onNudge({ dx: -NUDGE_STEP });
        break;
      case 'ArrowRight':
      case 'KeyD':
        event.preventDefault();
        onNudge({ dx: NUDGE_STEP });
        break;
      case 'ArrowUp':
      case 'KeyW':
      case 'ArrowDown':
      case 'KeyS':
        break;
      case 'KeyR':
        onRestart();
        break;
    }
  }

  domElement.addEventListener('pointerdown', handlePointerDown);
  domElement.addEventListener('pointermove', handlePointerMove);
  domElement.addEventListener('pointerup', handlePointerUp);
  domElement.addEventListener('pointercancel', cancelPointer);
  domElement.addEventListener('lostpointercapture', cancelPointer);
  domElement.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('pointerdown', handlePointerModality, true);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('blur', cancelTransientInput);
  document.addEventListener('visibilitychange', cancelTransientInput);

  return {
    setAimPlaneY(y) {
      aimPlane.constant = -y;
    },
    dispose() {
      domElement.removeEventListener('pointerdown', handlePointerDown);
      domElement.removeEventListener('pointermove', handlePointerMove);
      domElement.removeEventListener('pointerup', handlePointerUp);
      domElement.removeEventListener('pointercancel', cancelPointer);
      domElement.removeEventListener('lostpointercapture', cancelPointer);
      domElement.removeEventListener('wheel', handleWheel);
      window.removeEventListener('pointerdown', handlePointerModality, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', cancelTransientInput);
      document.removeEventListener('visibilitychange', cancelTransientInput);
    },
  };
}
