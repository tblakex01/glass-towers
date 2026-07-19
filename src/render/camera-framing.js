import * as THREE from 'three/webgpu';
import { MOVE_RANGE, PEDESTAL } from '../constants.js';

const COLLAPSE_STATES = new Set(['collapse', 'collapsing', 'gameover']);
const CAMERA_DIRECTION = new THREE.Vector3(0.62, 0.34, 0.72).normalize();
const ORBIT_SENSITIVITY = 0.005;
const PITCH_SENSITIVITY = 0.004;
const ZOOM_SENSITIVITY = 0.001;
const MIN_PITCH = 0.08;
const MAX_PITCH = 1.05;
const MIN_ZOOM = 0.72;
const MAX_ZOOM = 1.55;
const MIN_TARGET_Y = PEDESTAL.topY + 0.75;
const MIN_DISTANCE = 10.25;

function validateFrame(frame) {
  if (!frame || typeof frame !== 'object') {
    throw new TypeError('updateCamera requires a frame object');
  }
  if (!Number.isFinite(frame.topY) || !Number.isFinite(frame.bottomY)) {
    throw new TypeError('Camera frame topY and bottomY must be finite numbers');
  }
  if (typeof frame.state !== 'string' || frame.state.length === 0) {
    throw new TypeError('Camera frame state must be a non-empty string');
  }
}

function calculateDistance(camera, aspect, topY, bottomY) {
  const span = Math.max(2.6, topY - bottomY);
  const verticalHalf = span * 0.62 + 1.2;
  const horizontalHalf = Math.max(PEDESTAL.radius + 0.9, MOVE_RANGE + 0.85);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.35, aspect));
  const verticalDistance = verticalHalf / Math.tan(verticalFov / 2);
  const horizontalDistance = horizontalHalf / Math.tan(horizontalFov / 2);
  return Math.max(MIN_DISTANCE, verticalDistance, horizontalDistance) * 1.08;
}

export function createCameraFraming({ aspect = 1 } = {}) {
  const camera = new THREE.PerspectiveCamera(39, aspect, 0.1, 140);
  const target = new THREE.Vector3(0, MIN_TARGET_Y, 0);
  const desiredTarget = target.clone();
  const desiredPosition = new THREE.Vector3();
  let currentAspect = Math.max(0.35, aspect);
  let distance = MIN_DISTANCE;
  let orbitAngle = Math.atan2(CAMERA_DIRECTION.z, CAMERA_DIRECTION.x);
  let desiredOrbitAngle = orbitAngle;
  let orbitPitch = Math.asin(CAMERA_DIRECTION.y);
  let desiredOrbitPitch = orbitPitch;
  let zoomScale = 1;
  let desiredZoomScale = 1;

  desiredPosition.copy(target).addScaledVector(CAMERA_DIRECTION, distance);
  camera.position.copy(desiredPosition);
  camera.lookAt(target);

  function resize(nextAspect) {
    if (!Number.isFinite(nextAspect) || nextAspect <= 0) {
      throw new RangeError('Camera aspect must be a positive finite number');
    }
    currentAspect = nextAspect;
    camera.aspect = nextAspect;
    camera.updateProjectionMatrix();
  }

  function updateCamera(frame, deltaSeconds) {
    validateFrame(frame);
    const dt = THREE.MathUtils.clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 0.1);
    const collapsing = COLLAPSE_STATES.has(frame.state);
    const topY = Math.max(PEDESTAL.topY, frame.topY);
    const bottomY = THREE.MathUtils.clamp(frame.bottomY, -2, topY);
    const visibleBottom = collapsing ? bottomY : PEDESTAL.topY;
    const span = Math.max(0, topY - visibleBottom);
    const targetY = collapsing
      ? Math.max(0.7, visibleBottom + span * 0.48)
      : Math.max(MIN_TARGET_Y, PEDESTAL.topY + span * 0.52);

    desiredTarget.set(0, targetY, 0);
    const wantedDistance = calculateDistance(camera, currentAspect, topY, visibleBottom);
    const response = collapsing ? 4.5 : 2.8;
    const smoothing = 1 - Math.exp(-response * dt);
    target.lerp(desiredTarget, smoothing);
    distance += (wantedDistance - distance) * smoothing;

    const orbitDelta = Math.atan2(
      Math.sin(desiredOrbitAngle - orbitAngle),
      Math.cos(desiredOrbitAngle - orbitAngle)
    );
    orbitAngle += orbitDelta * (1 - Math.exp(-8 * dt));
    orbitPitch += (desiredOrbitPitch - orbitPitch) * (1 - Math.exp(-8 * dt));
    zoomScale += (desiredZoomScale - zoomScale) * (1 - Math.exp(-8 * dt));
    const horizontalLength = Math.cos(orbitPitch);
    const x = Math.cos(orbitAngle) * horizontalLength;
    const z = Math.sin(orbitAngle) * horizontalLength;
    const renderedDistance = distance * zoomScale;
    desiredPosition.set(
      target.x + x * renderedDistance,
      target.y + Math.sin(orbitPitch) * renderedDistance,
      target.z + z * renderedDistance
    );
    camera.position.lerp(desiredPosition, 1 - Math.exp(-3.4 * dt));
    camera.lookAt(target);
  }

  function orbitCamera(deltaX, deltaY = 0) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      throw new TypeError('Camera orbit deltas must be finite');
    }
    desiredOrbitAngle -= deltaX * ORBIT_SENSITIVITY;
    desiredOrbitPitch = THREE.MathUtils.clamp(
      desiredOrbitPitch + deltaY * PITCH_SENSITIVITY,
      MIN_PITCH,
      MAX_PITCH
    );
  }

  function zoomCamera(deltaY) {
    if (!Number.isFinite(deltaY)) throw new TypeError('Camera zoom delta must be finite');
    desiredZoomScale = THREE.MathUtils.clamp(
      desiredZoomScale * Math.exp(deltaY * ZOOM_SENSITIVITY),
      MIN_ZOOM,
      MAX_ZOOM
    );
  }

  resize(currentAspect);
  return { camera, updateCamera, resize, orbitCamera, zoomCamera };
}
