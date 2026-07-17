// Glass material factory. One MeshPhysicalMaterial instance per piece, tuned
// for the RoomEnvironment PMREM set up in environment.js. Transmission carries
// the see-through look (no `transparent` flag needed), and the tint mostly
// lives in the attenuation so pieces gain colour with depth like real glass.

import * as THREE from 'three';

const WHITE = new THREE.Color(0xffffff);

export function createGlassMaterial({ tint = 0xffffff } = {}) {
  const tintColor = new THREE.Color(tint);
  // Surface colour stays close to white so highlights read as glass, while
  // the pure tint drives the coloured absorption through the volume.
  const surfaceColor = tintColor.clone().lerp(WHITE, 0.55);

  return new THREE.MeshPhysicalMaterial({
    color: surfaceColor,
    transmission: 1,
    roughness: 0.08,
    metalness: 0,
    ior: 1.5,
    thickness: 0.9,
    attenuationColor: tintColor,
    attenuationDistance: 1.9,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.2,
    specularIntensity: 1,
    side: THREE.FrontSide,
    transparent: false,
  });
}
