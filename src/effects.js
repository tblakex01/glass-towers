// Subtle, pooled contact feedback. Each impact emits a handful of short-lived
// white glass motes, a restrained light pulse, and a small decaying camera
// impulse. onImpact() allocates nothing and active bursts render in one draw
// call each.

import * as THREE from 'three/webgpu';

const BURST_COUNT = 6;
const MOTES_PER_BURST = 7;
const FLASH_DURATION = 0.1;
const GRAVITY = 2.8;
const DRAG = 3.2;
const HIDDEN_Y = -1000;

const DIRECTIONS = Object.freeze([
  [-0.82, 0.7, 0.18],
  [-0.48, 1, -0.58],
  [-0.12, 0.82, 0.88],
  [0.28, 1, 0.24],
  [0.54, 0.9, -0.52],
  [0.88, 0.62, 0.2],
  [0.18, 0.72, 0.94],
]);

function hideBurst(burst) {
  burst.points.visible = false;
  burst.material.opacity = 0;
  burst.life = 0;
}

function createBurst(scene, index) {
  const positions = new Float32Array(MOTES_PER_BURST * 3);
  const velocities = new Float32Array(MOTES_PER_BURST * 3);
  positions.fill(HIDDEN_Y);

  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positionAttribute);

  const material = new THREE.PointsMaterial({
    color: 0xfffbf5,
    size: 0.055,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = `impact-motes-${index + 1}`;
  points.visible = false;
  points.frustumCulled = false;
  points.renderOrder = 10;
  scene.add(points);

  return {
    points,
    material,
    positionAttribute,
    positions,
    velocities,
    life: 0,
    duration: 1,
    peakOpacity: 0,
  };
}

export function createEffects(scene, camera) {
  const bursts = Array.from(
    { length: BURST_COUNT },
    (_, index) => createBurst(scene, index)
  );
  let burstCursor = 0;

  const flash = new THREE.PointLight(0xfff5e8, 0, 3.5, 2);
  flash.name = 'impact-light-pulse';
  flash.visible = false;
  scene.add(flash);
  let flashLife = 0;
  let flashPeak = 0;

  let shakeAmp = 0;
  let shakeTime = 0;
  const prevShake = new THREE.Vector3();
  const newShake = new THREE.Vector3();
  let shakeApplied = false;

  function emitMotes(position, power) {
    const burst = bursts[burstCursor];
    const rotation = burstCursor * 1.0472;
    burstCursor = (burstCursor + 1) % bursts.length;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const speed = 0.38 + power * 0.72;

    for (let index = 0; index < MOTES_PER_BURST; index += 1) {
      const offset = index * 3;
      const direction = DIRECTIONS[index];
      const dx = direction[0] * cos - direction[2] * sin;
      const dz = direction[0] * sin + direction[2] * cos;
      const variation = 0.82 + index * 0.045;
      burst.positions[offset] = position.x + dx * 0.025;
      burst.positions[offset + 1] = position.y + 0.025 + direction[1] * 0.018;
      burst.positions[offset + 2] = position.z + dz * 0.025;
      burst.velocities[offset] = dx * speed * variation;
      burst.velocities[offset + 1] = direction[1] * speed * (0.82 + power * 0.18);
      burst.velocities[offset + 2] = dz * speed * variation;
    }

    burst.life = 0;
    burst.duration = 0.22 + power * 0.16;
    burst.peakOpacity = 0.46 + power * 0.28;
    burst.material.size = 0.04 + power * 0.025;
    burst.material.opacity = burst.peakOpacity;
    burst.positionAttribute.needsUpdate = true;
    burst.points.visible = true;
  }

  function onImpact(position, intensity) {
    const power = THREE.MathUtils.clamp(intensity, 0, 1);
    if (power < 0.05) return;

    emitMotes(position, power);
    if (power > 0.72) {
      flash.position.copy(position);
      flash.position.y += 0.18;
      flashPeak = 1.2 + power * 1.4;
      flash.intensity = flashPeak;
      flash.visible = true;
      flashLife = FLASH_DURATION;
    }
    shakeAmp = Math.min(0.035, shakeAmp + power * power * 0.022);
  }

  function beforeCameraUpdate() {
    if (!shakeApplied) return;
    camera.position.sub(prevShake);
    shakeApplied = false;
  }

  function updateBursts(dt) {
    const drag = Math.exp(-DRAG * dt);
    for (const burst of bursts) {
      if (!burst.points.visible) continue;
      burst.life += dt;
      const progress = burst.life / burst.duration;
      if (progress >= 1) {
        hideBurst(burst);
        continue;
      }

      for (let index = 0; index < burst.positions.length; index += 3) {
        burst.velocities[index] *= drag;
        burst.velocities[index + 1] = burst.velocities[index + 1] * drag - GRAVITY * dt;
        burst.velocities[index + 2] *= drag;
        burst.positions[index] += burst.velocities[index] * dt;
        burst.positions[index + 1] += burst.velocities[index + 1] * dt;
        burst.positions[index + 2] += burst.velocities[index + 2] * dt;
      }
      burst.material.opacity = burst.peakOpacity * (1 - progress) ** 1.7;
      burst.positionAttribute.needsUpdate = true;
    }
  }

  function updateFlash(dt) {
    if (!flash.visible) return;
    flashLife -= dt;
    if (flashLife <= 0) {
      flash.visible = false;
      flash.intensity = 0;
      return;
    }
    flash.intensity = flashPeak * (flashLife / FLASH_DURATION) ** 2;
  }

  function updateShake(dt) {
    beforeCameraUpdate();
    if (shakeAmp > 0.00035) {
      shakeTime += dt;
      shakeAmp *= Math.exp(-10 * dt);
      newShake.set(
        Math.sin(shakeTime * 37.7),
        Math.sin(shakeTime * 43.1 + 1.7) * 0.4,
        Math.cos(shakeTime * 35.3 + 0.4)
      ).multiplyScalar(shakeAmp);
    } else {
      shakeAmp = 0;
      newShake.set(0, 0, 0);
    }
    camera.position.add(newShake);
    prevShake.copy(newShake);
    shakeApplied = true;
  }

  function update(dt) {
    updateBursts(dt);
    updateFlash(dt);
    updateShake(dt);
  }

  function reset() {
    for (const burst of bursts) hideBurst(burst);
    flash.visible = false;
    flash.intensity = 0;
    flashLife = 0;
    beforeCameraUpdate();
    prevShake.set(0, 0, 0);
    newShake.set(0, 0, 0);
    shakeAmp = 0;
    shakeTime = 0;
  }

  return { onImpact, beforeCameraUpdate, update, reset };
}
