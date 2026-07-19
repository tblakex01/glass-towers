import * as THREE from 'three/webgpu';
import {
  color,
  normalWorldGeometry,
  positionWorld,
  smoothstep,
  uniform,
} from 'three/tsl';

const SHADOW_COLOR = 0x233848;
const SHADOW_OPACITY = 0.42;
const MIN_RADIUS = 0.16;
const shadowSize = new THREE.Vector3();

function shadowRadiiFor(mesh) {
  mesh.geometry.computeBoundingBox();
  mesh.geometry.boundingBox.getSize(shadowSize);
  return new THREE.Vector2(
    Math.max(MIN_RADIUS, shadowSize.x * 0.44),
    Math.max(MIN_RADIUS, shadowSize.z * 0.44)
  );
}

export function createAimShadow({ receiver, caster }) {
  if (!receiver?.isMesh || !caster?.isMesh) {
    throw new TypeError('Aim shadow requires mesh receiver and caster objects');
  }

  const center = uniform(new THREE.Vector2());
  const radii = uniform(shadowRadiiFor(caster));
  const distance = positionWorld.xz.sub(center).div(radii).length();
  const footprint = smoothstep(1, 0.68, distance);
  const upwardSurface = smoothstep(0.56, 0.82, normalWorldGeometry.y);
  const material = new THREE.MeshBasicNodeMaterial({
    color: SHADOW_COLOR,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.name = 'glass-aim-shadow-material';
  material.colorNode = color(SHADOW_COLOR);
  material.opacityNode = footprint.mul(upwardSurface).mul(SHADOW_OPACITY);

  const overlay = new THREE.Mesh(receiver.geometry, material);
  overlay.name = 'glass-aim-shadow';
  overlay.position.copy(receiver.position);
  overlay.position.y += 0.012;
  overlay.quaternion.copy(receiver.quaternion);
  overlay.scale.copy(receiver.scale);
  overlay.renderOrder = 4;
  receiver.parent.add(overlay);

  return {
    update(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      center.value.set(x, z);
    },
    dispose() {
      overlay.removeFromParent();
      material.dispose();
    },
  };
}
