import * as CANNON from 'cannon-es';
import { PEDESTAL } from './constants.js';

const FIXED_STEP = 1 / 60;
// Generous substep budget keeps the simulation near real-time even when the
// renderer drops well below 60fps (weak GPUs, software rasterizers).
const MAX_SUB_STEPS = 8;

function buildShape(def) {
  if (def.type === 'box') {
    const [hx, hy, hz] = def.halfExtents;
    return new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
  }
  if (def.type === 'cylinder') {
    // cannon-es cylinders are aligned with the local Y axis, matching THREE.CylinderGeometry.
    return new CANNON.Cylinder(def.radiusTop, def.radiusBottom, def.height, def.numSegments || 12);
  }
  throw new Error(`Unknown physics shape type: ${def.type}`);
}

export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.allowSleep = true;

  const glassMaterial = new CANNON.Material('glass');
  const pedestalMaterial = new CANNON.Material('pedestal');
  const contactOptions = {
    friction: 0.45,
    restitution: 0.05,
    contactEquationStiffness: 1e7,
  };
  world.addContactMaterial(new CANNON.ContactMaterial(glassMaterial, glassMaterial, contactOptions));
  world.addContactMaterial(new CANNON.ContactMaterial(glassMaterial, pedestalMaterial, contactOptions));

  const dynamicBodies = new Set();

  function addPedestal() {
    const pedestal = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: pedestalMaterial,
      shape: new CANNON.Cylinder(PEDESTAL.radius, PEDESTAL.radius, PEDESTAL.height, 24),
      position: new CANNON.Vec3(0, PEDESTAL.topY - PEDESTAL.height / 2, 0),
    });
    world.addBody(pedestal);

    const ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: pedestalMaterial,
      shape: new CANNON.Plane(),
    });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(ground);
  }

  function createBody(shapeDef, position) {
    const comOffset = shapeDef.comOffset || [0, 0, 0];
    const body = new CANNON.Body({
      mass: shapeDef.mass,
      material: glassMaterial,
      position: new CANNON.Vec3(position.x, position.y, position.z),
      allowSleep: true,
      sleepSpeedLimit: 0.15,
      sleepTimeLimit: 0.6,
      linearDamping: 0.01,
      angularDamping: 0.12, // calms post-impact wobble so stacks settle decisively
    });

    // Shapes are shifted by -comOffset so the body origin sits at the center of mass.
    const def = shapeDef.physics;
    const parts = def.type === 'compound' ? def.shapes : [def];
    for (const part of parts) {
      const off = part.offset || [0, 0, 0];
      body.addShape(
        buildShape(part),
        new CANNON.Vec3(off[0] - comOffset[0], off[1] - comOffset[1], off[2] - comOffset[2])
      );
    }

    body.userData = { comOffset };
    world.addBody(body);
    dynamicBodies.add(body);
    return body;
  }

  function removeBody(body) {
    dynamicBodies.delete(body);
    world.removeBody(body);
  }

  function step(dt) {
    world.step(FIXED_STEP, dt, MAX_SUB_STEPS);
  }

  function reset() {
    for (const body of dynamicBodies) world.removeBody(body);
    dynamicBodies.clear();
  }

  return { world, addPedestal, createBody, removeBody, step, reset };
}
