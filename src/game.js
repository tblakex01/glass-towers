import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PEDESTAL, DROP_CLEARANCE, MOVE_RANGE, FAIL_Y } from './constants.js';
import { shapeById, randomShapeId } from './shapes.js';
import { createGlassMaterial } from './glass.js';
import { getBest, saveBest } from './ui.js';

const AIM_LERP = 12;
const SETTLE_SPEED = 0.12;
const SETTLE_ANGULAR = 0.15;
const SETTLE_TIME = 0.7;
const PRECISION_DIST = 0.25;
const IMPACT_MIN = 1;
const IMPACT_MAX = 8;

export function createGame({ env, physics, effects, ui, input }) {
  const pieces = []; // dropped pieces: { group, mesh, body, shapeDef, settled }
  let state = 'aiming'; // 'aiming' | 'falling' | 'gameover'
  let current = null; // aiming piece: { group, mesh, shapeDef } — visual only, no body yet
  let currentId = null;
  let nextId = null;
  let score = 0;
  let best = getBest();
  let bestAtRunStart = best;
  let towerTopY = PEDESTAL.topY;
  let settleTimer = 0;
  let bobTime = 0;
  const aimTarget = { x: 0, z: 0 };
  const aimPos = { x: 0, z: 0 };
  // Scratch vector reused for every collision's contact point so impact
  // handling stays allocation-free (effects.onImpact copies it eagerly).
  const impactPoint = new THREE.Vector3();

  physics.addPedestal();
  ui.setScore(0);
  ui.setBest(best);

  function hoverY() {
    return towerTopY + DROP_CLEARANCE;
  }

  function advanceQueue() {
    currentId = nextId ?? randomShapeId(null);
    nextId = randomShapeId(currentId);
    ui.setNextShape(shapeById(nextId));
  }

  function spawnPiece() {
    const shapeDef = shapeById(currentId);
    const mesh = new THREE.Mesh(shapeDef.createGeometry(), createGlassMaterial({ tint: shapeDef.tint }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Group origin tracks the (future) body origin, i.e. the center of mass;
    // the mesh sits at comOffset so its geometric center lands in the right spot.
    const comOffset = shapeDef.comOffset || [0, 0, 0];
    mesh.position.set(comOffset[0], comOffset[1], comOffset[2]);
    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(aimPos.x, hoverY(), aimPos.z);
    env.scene.add(group);
    current = { group, mesh, shapeDef };
    input.setAimPlaneY(hoverY());
    bobTime = 0;
  }

  function disposePiece(piece) {
    env.scene.remove(piece.group);
    piece.mesh.geometry.dispose();
    piece.mesh.material.dispose();
  }

  function attachImpactListener(piece) {
    piece.body.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v < IMPACT_MIN) return;
      const intensity = Math.min(1, (v - IMPACT_MIN) / (IMPACT_MAX - IMPACT_MIN));
      const r = e.contact.bi === piece.body ? e.contact.ri : e.contact.rj;
      const p = piece.body.position;
      impactPoint.set(p.x + r.x, p.y + r.y, p.z + r.z);
      effects.onImpact(impactPoint, intensity);
    });
  }

  function setAimTarget(x, z) {
    aimTarget.x = THREE.MathUtils.clamp(x, -MOVE_RANGE, MOVE_RANGE);
    aimTarget.z = THREE.MathUtils.clamp(z, -MOVE_RANGE, MOVE_RANGE);
  }

  function drop() {
    if (state !== 'aiming' || !current) return;
    const { group, mesh, shapeDef } = current;
    const body = physics.createBody(shapeDef, group.position);
    const piece = { group, mesh, body, shapeDef, settled: false };
    pieces.push(piece);
    attachImpactListener(piece);
    current = null;
    settleTimer = 0;
    state = 'falling';
  }

  function settlePiece(piece) {
    piece.settled = true;
    score += 10;
    const below = pieces.length >= 2 ? pieces[pieces.length - 2].body.position : { x: 0, z: 0 };
    const p = piece.body.position;
    if (Math.hypot(p.x - below.x, p.z - below.z) < PRECISION_DIST) {
      score += 5;
      ui.showToast('Perfect! +5');
    }
    ui.setScore(score);
    if (score > best) {
      best = score;
      saveBest(best);
      ui.setBest(best);
    }
    towerTopY = PEDESTAL.topY;
    for (const pc of pieces) {
      if (!pc.settled) continue;
      const com = pc.shapeDef.comOffset || [0, 0, 0];
      // Approximate top of piece, ignoring tilt: geometric center + half height.
      towerTopY = Math.max(towerTopY, pc.body.position.y + com[1] + pc.shapeDef.height / 2);
    }
    advanceQueue();
    spawnPiece();
    state = 'aiming';
  }

  function gameOver() {
    state = 'gameover';
    if (current) {
      disposePiece(current);
      current = null;
    }
    ui.showGameOver(score, best, score > bestAtRunStart);
  }

  function restart() {
    for (const piece of pieces) disposePiece(piece);
    pieces.length = 0;
    if (current) {
      disposePiece(current);
      current = null;
    }
    physics.reset();
    effects.reset();
    score = 0;
    ui.setScore(0);
    bestAtRunStart = best;
    towerTopY = PEDESTAL.topY;
    settleTimer = 0;
    aimTarget.x = aimTarget.z = 0;
    aimPos.x = aimPos.z = 0;
    nextId = null;
    advanceQueue();
    spawnPiece();
    ui.hideGameOver();
    state = 'aiming';
  }

  function update(dt) {
    physics.step(dt);

    for (const piece of pieces) {
      piece.group.position.copy(piece.body.position);
      piece.group.quaternion.copy(piece.body.quaternion);
    }

    if (state !== 'gameover') {
      for (const piece of pieces) {
        const p = piece.body.position;
        // Fell below the pedestal, or dropped past its top while horizontally
        // clear of it (e.g. resting on the floor) — either way it's off.
        const offSide = p.y < PEDESTAL.topY - 0.05 && Math.hypot(p.x, p.z) > PEDESTAL.radius + 0.5;
        if (p.y < FAIL_Y || offSide) {
          gameOver();
          break;
        }
      }
    }

    if (state === 'aiming' && current) {
      bobTime += dt;
      const t = Math.min(1, AIM_LERP * dt);
      aimPos.x += (aimTarget.x - aimPos.x) * t;
      aimPos.z += (aimTarget.z - aimPos.z) * t;
      current.group.position.set(aimPos.x, hoverY() + Math.sin(bobTime * 2.2) * 0.05, aimPos.z);
    } else if (state === 'falling' && pieces.length > 0) {
      const body = pieces[pieces.length - 1].body;
      const slow = body.velocity.length() < SETTLE_SPEED && body.angularVelocity.length() < SETTLE_ANGULAR;
      settleTimer = slow ? settleTimer + dt : 0;
      if (body.sleepState === CANNON.Body.SLEEPING || settleTimer >= SETTLE_TIME) {
        settlePiece(pieces[pieces.length - 1]);
      }
    }

    env.updateCamera(towerTopY, dt);
  }

  advanceQueue();
  spawnPiece();

  return {
    update,
    restart,
    onAim({ x, z }) {
      if (state === 'aiming') setAimTarget(x, z);
    },
    onNudge({ dx, dz }) {
      if (state === 'aiming') setAimTarget(aimTarget.x + dx, aimTarget.z + dz);
    },
    onDrop: drop,
  };
}
