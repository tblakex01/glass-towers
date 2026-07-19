import * as THREE from 'three/webgpu';
import { DROP_CLEARANCE, FAIL_Y, MOVE_RANGE, PEDESTAL } from './constants.js';
import {
  challengeSpawnPosition,
  createScaledQueueEntry,
  createSeededRandom,
} from './gameplay-policy.js';
import { createGlassMaterial } from './glass.js';
import { createAimShadow } from './render/aim-shadow.js';
import { getBest, saveBest } from './ui.js';

const AIM_RESPONSE = 12;
const SETTLE_SPEED = 0.12;
const SETTLE_ANGULAR_SPEED = 0.15;
const SETTLE_TIME = 0.7;
const PEDESTAL_FOOTPRINT = Object.freeze({ radius: PEDESTAL.radius });
const PEDESTAL_POSITION = Object.freeze({ x: 0, z: 0 });

function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
}

export function createGame({ env, physics, effects, placementGuide, ui, input, seed = null }) {
  const pieces = [];
  const aimTarget = { x: 0, z: 0 };
  const aimPosition = { x: 0, z: 0 };
  const impactPoint = new THREE.Vector3();
  const structureBounds = new THREE.Box3();
  const objectBounds = new THREE.Box3();
  let state = 'aiming';
  let current = null;
  let currentEntry = null;
  let nextEntry = null;
  let score = 0;
  let best = getBest();
  let bestAtRunStart = best;
  let towerTopY = PEDESTAL.topY;
  let settleTimer = 0;
  let bobTime = 0;
  let aimRailZ = 0;
  let queueIndex = 0;
  let runSeed = seed ?? randomSeed();
  let random = createSeededRandom(runSeed);

  physics.addPedestal();
  ui.setScore(0);
  ui.setBest(best);

  function createQueueEntry(placementIndex, previousShapeId) {
    return createScaledQueueEntry({ placementIndex, previousShapeId, random });
  }

  function advanceQueue() {
    currentEntry = nextEntry ?? createQueueEntry(queueIndex, null);
    queueIndex = currentEntry.placementIndex + 1;
    nextEntry = createQueueEntry(queueIndex, currentEntry.shapeId);
    ui.setNextShape(nextEntry.shape);
  }

  function supportForCurrentPiece() {
    const support = [...pieces].reverse().find((piece) => piece.settled);
    if (!support) {
      return { body: null, position: PEDESTAL_POSITION, footprint: PEDESTAL_FOOTPRINT };
    }
    return {
      body: support.body,
      position: physics.translation(support.body),
      footprint: support.shapeDef.footprint,
      mesh: support.mesh,
    };
  }

  function hoverY(shapeDef) {
    return towerTopY + DROP_CLEARANCE + shapeDef.height / 2 - shapeDef.geometryOffset[1];
  }

  function updatePlacementGuide() {
    placementGuide.update({
      x: aimPosition.x,
      y: towerTopY + DROP_CLEARANCE - 0.38,
      z: aimRailZ,
      movementRange: MOVE_RANGE,
    });
  }

  function spawnPiece() {
    const shapeDef = currentEntry.shape;
    const geometry = shapeDef.createGeometry();
    const material = createGlassMaterial({
      tint: shapeDef.tint,
      thickness: Math.max(0.28, shapeDef.height * 0.72),
      scale: shapeDef.scale,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `glass-${shapeDef.id}-${shapeDef.scale.toFixed(3)}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(...shapeDef.geometryOffset);

    const group = new THREE.Group();
    group.name = `piece-${currentEntry.placementIndex}`;
    group.add(mesh);
    const support = supportForCurrentPiece();
    aimRailZ = support.position.z;
    const spawn = challengeSpawnPosition({
      placementIndex: currentEntry.placementIndex,
      supportPosition: support.position,
      pieceFootprint: shapeDef.footprint,
      supportFootprint: support.footprint,
      seed: runSeed,
      moveRange: MOVE_RANGE,
    });
    aimTarget.x = aimPosition.x = spawn.x;
    aimTarget.z = aimPosition.z = spawn.z;
    group.position.set(spawn.x, hoverY(shapeDef), spawn.z);
    env.scene.add(group);
    const aimShadow = support.mesh ? createAimShadow({ receiver: support.mesh, caster: mesh }) : null;
    aimShadow?.update(spawn.x, spawn.z);
    current = { group, mesh, shapeDef, supportBody: support.body, aimShadow };
    input.setAimPlaneY(group.position.y);
    updatePlacementGuide();
    placementGuide.show();
    bobTime = 0;
  }

  function disposeVisual(piece) {
    piece.aimShadow?.dispose();
    env.scene.remove(piece.group);
    piece.mesh.geometry.dispose();
    piece.mesh.material.dispose();
  }

  function attachImpactListener(piece) {
    piece.removeImpactListener = physics.onImpact(piece.body, (position, intensity) => {
      impactPoint.set(position.x, position.y, position.z);
      effects.onImpact(impactPoint, intensity);
    });
  }

  function setAimTarget(x) {
    if (!Number.isFinite(x)) return;
    aimTarget.x = THREE.MathUtils.clamp(x, -MOVE_RANGE, MOVE_RANGE);
    aimTarget.z = aimRailZ;
  }

  function drop() {
    if (state !== 'aiming' || !current) return;
    ui.setStarted();
    const { group, mesh, shapeDef, supportBody } = current;
    current.aimShadow?.dispose();
    const body = physics.createBody(shapeDef, group.position);
    const piece = {
      group,
      mesh,
      body,
      shapeDef,
      supportBody,
      settled: false,
      removeImpactListener: null,
    };
    pieces.push(piece);
    attachImpactListener(piece);
    current = null;
    placementGuide.hide();
    settleTimer = 0;
    state = 'falling';
  }

  function recalculateTowerTop() {
    towerTopY = PEDESTAL.topY;
    for (const piece of pieces) {
      if (!piece.settled) continue;
      objectBounds.setFromObject(piece.group);
      towerTopY = Math.max(towerTopY, objectBounds.max.y);
    }
  }

  function settlePiece(piece) {
    if (state !== 'falling' || piece.settled) return;
    const position = physics.translation(piece.body);
    const insideAimRange = Math.abs(position.x) <= MOVE_RANGE && Math.abs(position.z) <= MOVE_RANGE;
    if (!insideAimRange || !physics.hasSupportContact(piece.body, piece.supportBody)) {
      gameOver();
      return;
    }

    piece.settled = true;
    state = 'settling';
    score += 1;
    ui.setScore(score);
    if (score > best) {
      best = score;
      saveBest(best);
      ui.setBest(best);
    }
    recalculateTowerTop();
    try {
      advanceQueue();
      spawnPiece();
      state = 'aiming';
    } catch (error) {
      gameOver();
      throw error;
    }
  }

  function gameOver() {
    if (state === 'gameover') return;
    state = 'gameover';
    if (current) {
      disposeVisual(current);
      current = null;
    }
    placementGuide.hide();
    ui.showGameOver(score, best, score > bestAtRunStart);
  }

  function clearPieces() {
    for (const piece of pieces) {
      piece.removeImpactListener?.();
      disposeVisual(piece);
    }
    pieces.length = 0;
    if (current) {
      disposeVisual(current);
      current = null;
    }
  }

  function restart() {
    clearPieces();
    physics.reset();
    effects.reset();
    score = 0;
    bestAtRunStart = best;
    towerTopY = PEDESTAL.topY;
    settleTimer = 0;
    queueIndex = 0;
    runSeed = seed ?? randomSeed();
    random = createSeededRandom(runSeed);
    currentEntry = null;
    nextEntry = null;
    ui.setScore(0);
    ui.hideGameOver();
    state = 'aiming';
    advanceQueue();
    spawnPiece();
  }

  function syncPhysics() {
    for (const piece of pieces) {
      const position = physics.translation(piece.body);
      const rotation = physics.rotation(piece.body);
      piece.group.position.set(position.x, position.y, position.z);
      piece.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
  }

  function structureFrame() {
    structureBounds.makeEmpty();
    structureBounds.expandByPoint(new THREE.Vector3(-PEDESTAL.radius, 0, -PEDESTAL.radius));
    structureBounds.expandByPoint(new THREE.Vector3(PEDESTAL.radius, PEDESTAL.topY, PEDESTAL.radius));
    for (const piece of pieces) {
      objectBounds.setFromObject(piece.group);
      if (objectBounds.max.y > -2.5) structureBounds.union(objectBounds);
    }
    if (current) {
      objectBounds.setFromObject(current.group);
      structureBounds.union(objectBounds);
    }
    return {
      topY: Math.max(PEDESTAL.topY, structureBounds.max.y),
      bottomY: Math.max(-2.5, structureBounds.min.y),
      state,
    };
  }

  function update(dt) {
    physics.step(dt);
    syncPhysics();

    if (state !== 'gameover') {
      for (const piece of pieces) {
        const position = physics.translation(piece.body);
        const lostSupport = piece.settled && physics.isSleeping(piece.body) &&
          !physics.hasSupportContact(piece.body, piece.supportBody);
        if (position.y < FAIL_Y || lostSupport) {
          gameOver();
          break;
        }
      }
    }

    if (state === 'aiming' && current) {
      bobTime += dt;
      const response = 1 - Math.exp(-AIM_RESPONSE * dt);
      aimPosition.x += (aimTarget.x - aimPosition.x) * response;
      aimPosition.z += (aimTarget.z - aimPosition.z) * response;
      current.group.position.set(
        aimPosition.x,
        hoverY(current.shapeDef) + Math.sin(bobTime * 2.2) * 0.05,
        aimPosition.z
      );
      current.aimShadow?.update(aimPosition.x, aimPosition.z);
      updatePlacementGuide();
    } else if (state === 'falling' && pieces.length > 0) {
      const piece = pieces[pieces.length - 1];
      const slow = physics.linearSpeed(piece.body) < SETTLE_SPEED &&
        physics.angularSpeed(piece.body) < SETTLE_ANGULAR_SPEED;
      settleTimer = slow ? settleTimer + dt : 0;
      if (physics.isSleeping(piece.body) || settleTimer >= SETTLE_TIME) settlePiece(piece);
    }

    env.updateCamera(structureFrame(), dt);
  }

  advanceQueue();
  spawnPiece();

  return {
    update,
    restart,
    onAim({ x }) {
      if (state === 'aiming') setAimTarget(x);
    },
    onNudge({ dx }) {
      if (state === 'aiming') setAimTarget(aimTarget.x + dx);
    },
    onDrop: drop,
    getSnapshot: () => Object.freeze({ state, score, best, placementIndex: currentEntry?.placementIndex ?? 0 }),
  };
}
