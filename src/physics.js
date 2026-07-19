import RAPIER from '@dimforge/rapier3d';
import { PEDESTAL } from './constants.js';

const FIXED_STEP = 1 / 60;
const MAX_SUB_STEPS = 8;
const MAX_FRAME_TIME = FIXED_STEP * MAX_SUB_STEPS;
const IMPACT_FORCE_FLOOR = 45;
const IMPACT_FORCE_RANGE = 900;
const IMPACT_COOLDOWN = 0.1;
const MIN_SUPPORT_NORMAL_Y = 0.45;
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

function colliderDescriptor(def) {
  if (def.type === 'box') {
    const [hx, hy, hz] = def.halfExtents;
    return RAPIER.ColliderDesc.cuboid(hx, hy, hz);
  }
  if (def.type === 'cylinder') {
    return RAPIER.ColliderDesc.cylinder(def.height / 2, Math.max(def.radiusTop, def.radiusBottom));
  }
  throw new Error(`Unknown physics shape type: ${def.type}`);
}

function inertiaFor(shapeDef) {
  const parts = shapeDef.physics.type === 'compound'
    ? shapeDef.physics.shapes
    : [shapeDef.physics];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const part of parts) {
    const offset = part.offset || [0, 0, 0];
    const half = part.type === 'box'
      ? part.halfExtents
      : [Math.max(part.radiusTop, part.radiusBottom), part.height / 2, Math.max(part.radiusTop, part.radiusBottom)];
    minX = Math.min(minX, offset[0] - half[0]);
    minY = Math.min(minY, offset[1] - half[1]);
    minZ = Math.min(minZ, offset[2] - half[2]);
    maxX = Math.max(maxX, offset[0] + half[0]);
    maxY = Math.max(maxY, offset[1] + half[1]);
    maxZ = Math.max(maxZ, offset[2] + half[2]);
  }

  const width = Math.max(0.05, maxX - minX);
  const height = Math.max(0.05, maxY - minY);
  const depth = Math.max(0.05, maxZ - minZ);
  const mass = shapeDef.mass;
  return {
    x: mass * (height * height + depth * depth) / 12,
    y: mass * (width * width + depth * depth) / 12,
    z: mass * (width * width + height * height) / 12,
  };
}

export async function createPhysics() {
  const world = new RAPIER.World({ x: 0, y: -9.82, z: 0 });
  world.timestep = FIXED_STEP;
  world.lengthUnit = 1;
  world.numSolverIterations = 8;
  world.numInternalPgsIterations = 2;
  world.maxCcdSubsteps = 2;

  const eventQueue = new RAPIER.EventQueue(true);
  const dynamicBodies = new Set();
  const impactListeners = new Map();
  const lastImpactAt = new Map();
  let accumulator = 0;
  let simulationTime = 0;
  let pedestalAdded = false;
  let pedestalCollider = null;

  function addPedestal() {
    if (pedestalAdded) return;
    pedestalAdded = true;
    const surface = (desc) => desc
      .setFriction(0.48)
      .setRestitution(0.035)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);

    pedestalCollider = world.createCollider(surface(
      RAPIER.ColliderDesc.cylinder(PEDESTAL.height / 2, PEDESTAL.radius)
        .setTranslation(0, PEDESTAL.topY - PEDESTAL.height / 2, 0)
    ));
    world.createCollider(surface(
      RAPIER.ColliderDesc.cuboid(40, 0.05, 40).setTranslation(0, -0.05, 0)
    ));
  }

  function createBody(shapeDef, position) {
    if (!shapeDef || !shapeDef.physics || !Number.isFinite(shapeDef.mass)) {
      throw new TypeError('createBody requires a validated scaled shape definition');
    }
    const geometryOffset = shapeDef.geometryOffset;
    if (!Array.isArray(geometryOffset) || geometryOffset.length !== 3) {
      throw new TypeError('createBody requires a body-frame geometry offset');
    }
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setAdditionalMassProperties(
        shapeDef.mass,
        { x: 0, y: 0, z: 0 },
        inertiaFor(shapeDef),
        IDENTITY_ROTATION
      )
      .setLinearDamping(0.035)
      .setAngularDamping(0.2)
      .setCanSleep(true)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(2)
      .setUserData({ shapeId: shapeDef.id });
    const body = world.createRigidBody(bodyDesc);
    const parts = shapeDef.physics.type === 'compound'
      ? shapeDef.physics.shapes
      : [shapeDef.physics];

    for (const part of parts) {
      const offset = part.offset || [0, 0, 0];
      const desc = colliderDescriptor(part)
        .setTranslation(
          offset[0] + geometryOffset[0],
          offset[1] + geometryOffset[1],
          offset[2] + geometryOffset[2]
        )
        .setDensity(0)
        .setFriction(0.48)
        .setRestitution(0.035)
        .setContactSkin(0.002)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Average)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(IMPACT_FORCE_FLOOR);
      world.createCollider(desc, body);
    }

    dynamicBodies.add(body);
    return body;
  }

  function removeBody(body) {
    if (!body || !dynamicBodies.delete(body)) return;
    impactListeners.delete(body.handle);
    lastImpactAt.delete(body.handle);
    world.removeRigidBody(body);
  }

  function emitImpact(event) {
    const magnitude = event.totalForceMagnitude();
    const intensity = Math.min(1, Math.max(0, (magnitude - IMPACT_FORCE_FLOOR) / IMPACT_FORCE_RANGE));
    if (intensity <= 0) return;

    for (const handle of [event.collider1(), event.collider2()]) {
      const body = world.getCollider(handle)?.parent();
      const listener = body && impactListeners.get(body.handle);
      if (!listener) continue;
      const previous = lastImpactAt.get(body.handle) ?? -Infinity;
      if (simulationTime - previous < IMPACT_COOLDOWN) continue;
      lastImpactAt.set(body.handle, simulationTime);
      listener(body.translation(), intensity);
    }
  }

  function step(dt) {
    accumulator = Math.min(accumulator + Math.max(0, dt), MAX_FRAME_TIME);
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_SUB_STEPS) {
      world.step(eventQueue);
      simulationTime += FIXED_STEP;
      accumulator -= FIXED_STEP;
      steps += 1;
      eventQueue.drainContactForceEvents(emitImpact);
    }
  }

  function reset() {
    for (const body of [...dynamicBodies]) removeBody(body);
    accumulator = 0;
    eventQueue.clear();
  }

  function onImpact(body, listener) {
    if (!dynamicBodies.has(body) || typeof listener !== 'function') {
      throw new TypeError('onImpact requires a live body and callback');
    }
    impactListeners.set(body.handle, listener);
    return () => impactListeners.delete(body.handle);
  }

  function hasSupportContact(body, supportBody = null) {
    if (!dynamicBodies.has(body)) {
      throw new TypeError('hasSupportContact requires a live dynamic body');
    }
    if (supportBody !== null && (!dynamicBodies.has(supportBody) || supportBody === body)) {
      throw new TypeError('supportBody must be a different live dynamic body or null');
    }
    if (!pedestalCollider) {
      throw new Error('addPedestal must be called before checking support contacts');
    }

    const supportColliders = supportBody === null
      ? [pedestalCollider]
      : Array.from({ length: supportBody.numColliders() }, (_, index) => supportBody.collider(index));

    for (let bodyIndex = 0; bodyIndex < body.numColliders(); bodyIndex += 1) {
      const bodyCollider = body.collider(bodyIndex);
      for (const supportCollider of supportColliders) {
        let supported = false;
        world.contactPair(bodyCollider, supportCollider, (manifold) => {
          if (supported || manifold.numContacts() === 0) return;
          supported = Math.abs(manifold.normal().y) >= MIN_SUPPORT_NORMAL_Y;
        });
        if (supported) return true;
      }
    }
    return false;
  }

  function dispose() {
    reset();
    eventQueue.free();
    world.free();
  }

  return {
    world,
    addPedestal,
    createBody,
    removeBody,
    step,
    reset,
    dispose,
    onImpact,
    hasSupportContact,
    translation: (body) => body.translation(),
    rotation: (body) => body.rotation(),
    linearSpeed: (body) => Math.hypot(body.linvel().x, body.linvel().y, body.linvel().z),
    angularSpeed: (body) => Math.hypot(body.angvel().x, body.angvel().y, body.angvel().z),
    isSleeping: (body) => body.isSleeping(),
  };
}
