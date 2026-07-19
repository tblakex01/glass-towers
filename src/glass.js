import * as THREE from 'three/webgpu';
import { float, materialReference, vec4 } from 'three/tsl';

const WHITE = new THREE.Color(0xffffff);

export const GLASS_QUALITY = Object.freeze({
  low: Object.freeze({
    transmission: 0.82,
    roughness: 0.14,
    clearcoat: 0.32,
    dispersion: 0,
    envMapIntensity: 1.75,
    attenuationScale: 1.05,
  }),
  medium: Object.freeze({
    transmission: 0.89,
    roughness: 0.09,
    clearcoat: 0.48,
    dispersion: 0.012,
    envMapIntensity: 2.05,
    attenuationScale: 0.96,
  }),
  high: Object.freeze({
    transmission: 0.92,
    roughness: 0.065,
    clearcoat: 0.62,
    dispersion: 0.024,
    envMapIntensity: 2.35,
    attenuationScale: 0.88,
  }),
});

function finiteOption(value, fallback, { name, min, max }) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return THREE.MathUtils.clamp(value, min, max);
}

function resolveTint(tint, contrast) {
  const source = new THREE.Color(tint);
  const hsl = {};
  source.getHSL(hsl);
  const attenuationColor = new THREE.Color().setHSL(
    hsl.h,
    THREE.MathUtils.clamp(0.72 + hsl.s * 0.3 + contrast * 0.05, 0, 1),
    THREE.MathUtils.clamp(hsl.l - 0.18 * contrast, 0.3, 0.58)
  );
  const surfaceColor = attenuationColor.clone().lerp(WHITE, 0.24);
  return { attenuationColor, surfaceColor };
}

export function createGlassMaterial({
  tint = 0xffffff,
  thickness = 0.8,
  quality = 'high',
  contrast = 1,
  attenuationDistance,
  roughness,
  dispersion,
} = {}) {
  const preset = GLASS_QUALITY[quality];
  if (!preset) throw new RangeError(`Unknown glass quality: ${quality}`);

  const effectiveThickness = finiteOption(thickness, 0.8, {
    name: 'Glass thickness',
    min: 0.05,
    max: 3,
  });
  const effectiveContrast = finiteOption(contrast, 1, {
    name: 'Glass contrast',
    min: 0.5,
    max: 2,
  });
  const effectiveAttenuation = finiteOption(
    attenuationDistance,
    Math.max(0.34, (effectiveThickness * preset.attenuationScale) / effectiveContrast),
    { name: 'Glass attenuation distance', min: 0.18, max: 8 }
  );
  const effectiveRoughness = finiteOption(roughness, preset.roughness, {
    name: 'Glass roughness',
    min: 0.04,
    max: 0.35,
  });
  const effectiveDispersion = finiteOption(dispersion, preset.dispersion, {
    name: 'Glass dispersion',
    min: 0,
    max: 0.08,
  });
  const { attenuationColor, surfaceColor } = resolveTint(tint, effectiveContrast);

  const material = new THREE.MeshPhysicalNodeMaterial({
    color: surfaceColor,
    transmission: preset.transmission,
    roughness: effectiveRoughness,
    metalness: 0,
    ior: 1.48,
    thickness: effectiveThickness,
    attenuationColor,
    attenuationDistance: effectiveAttenuation,
    clearcoat: preset.clearcoat,
    clearcoatRoughness: Math.min(0.18, effectiveRoughness + 0.045),
    dispersion: effectiveDispersion,
    envMapIntensity: preset.envMapIntensity,
    specularIntensity: 1.25,
    specularColor: WHITE,
    emissive: attenuationColor,
    emissiveIntensity: 0.035,
    opacity: 1,
    transparent: false,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  const shadowTint = materialReference('attenuationColor', 'color', material);
  material.castShadowNode = vec4(
    shadowTint.mul(float(0.18)),
    float(0.86)
  );
  material.name = `glass-${quality}-${new THREE.Color(tint).getHexString()}`;
  material.userData.glass = Object.freeze({
    quality,
    thickness: effectiveThickness,
    contrast: effectiveContrast,
    attenuationDistance: effectiveAttenuation,
  });
  return material;
}
