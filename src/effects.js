// Pooled impact feedback: expanding additive rings at the contact point, a
// brief point-light flash for strong hits, and a subtle decaying camera shake.
// Everything is preallocated — onImpact() performs zero allocations.
//
// The shake is applied as a delta (newShake - prevShake) to camera.position
// each update so it composes with environment.js's smoothed camera rig instead
// of fighting it, and reset() removes whatever offset is currently applied.

import * as THREE from 'three';

const RING_COUNT = 12;
const FLASH_DURATION = 0.22;

export function createEffects(scene, camera) {
  // --- Ring pool (shared geometry, per-ring material for opacity) ---
  const ringGeometry = new THREE.RingGeometry(0.5, 0.62, 48);
  ringGeometry.rotateX(-Math.PI / 2);

  const rings = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.visible = false;
    mesh.renderOrder = 10;
    scene.add(mesh);
    rings.push({ mesh, life: 0, duration: 1, startScale: 1, endScale: 2, peakOpacity: 0 });
  }
  let ringCursor = 0;

  // --- Flash light (single pooled light, retriggered on strong hits) ---
  const flash = new THREE.PointLight(0xfff3e2, 0, 7, 2);
  flash.visible = false;
  scene.add(flash);
  let flashLife = 0;
  let flashPeak = 0;

  // --- Camera shake state ---
  let shakeAmp = 0;
  let shakeTime = 0;
  const prevShake = new THREE.Vector3();
  const newShake = new THREE.Vector3();

  function hideRing(ring) {
    ring.mesh.visible = false;
    ring.mesh.material.opacity = 0;
    ring.life = 0;
  }

  function onImpact(position, intensity) {
    const power = THREE.MathUtils.clamp(intensity, 0, 1);
    if (power < 0.05) return;

    const ring = rings[ringCursor];
    ringCursor = (ringCursor + 1) % rings.length;
    ring.mesh.position.copy(position);
    ring.mesh.position.y += 0.02;
    ring.life = 0;
    ring.duration = 0.45 + power * 0.3;
    ring.startScale = 0.35 + power * 0.3;
    ring.endScale = 1.6 + power * 2.2;
    ring.peakOpacity = 0.25 + power * 0.4;
    ring.mesh.scale.setScalar(ring.startScale);
    ring.mesh.material.opacity = ring.peakOpacity;
    ring.mesh.visible = true;

    if (power > 0.55) {
      flash.position.copy(position);
      flash.position.y += 0.35;
      flashPeak = 14 * power;
      flash.intensity = flashPeak;
      flash.visible = true;
      flashLife = FLASH_DURATION;
    }

    shakeAmp = Math.min(0.12, shakeAmp + power * power * 0.09);
  }

  function update(dt) {
    // Rings: expand and fade out.
    for (const ring of rings) {
      if (!ring.mesh.visible) continue;
      ring.life += dt;
      const t = ring.life / ring.duration;
      if (t >= 1) {
        hideRing(ring);
        continue;
      }
      const eased = 1 - (1 - t) * (1 - t); // ease-out expansion
      ring.mesh.scale.setScalar(
        ring.startScale + (ring.endScale - ring.startScale) * eased
      );
      ring.mesh.material.opacity = ring.peakOpacity * (1 - t) * (1 - t);
    }

    // Flash: quick linear decay.
    if (flash.visible) {
      flashLife -= dt;
      if (flashLife <= 0) {
        flash.visible = false;
        flash.intensity = 0;
      } else {
        flash.intensity = flashPeak * (flashLife / FLASH_DURATION);
      }
    }

    // Shake: remove last frame's offset, add this frame's.
    camera.position.sub(prevShake);
    if (shakeAmp > 0.0005) {
      shakeTime += dt;
      shakeAmp *= Math.exp(-6 * dt);
      newShake.set(
        Math.sin(shakeTime * 39.7),
        Math.sin(shakeTime * 45.3 + 1.7) * 0.6,
        Math.cos(shakeTime * 36.1 + 0.4)
      );
      newShake.multiplyScalar(shakeAmp);
    } else {
      shakeAmp = 0;
      newShake.set(0, 0, 0);
    }
    camera.position.add(newShake);
    prevShake.copy(newShake);
  }

  function reset() {
    for (const ring of rings) hideRing(ring);
    flash.visible = false;
    flash.intensity = 0;
    flashLife = 0;
    camera.position.sub(prevShake);
    prevShake.set(0, 0, 0);
    newShake.set(0, 0, 0);
    shakeAmp = 0;
    shakeTime = 0;
  }

  return { onImpact, update, reset };
}
