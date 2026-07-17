import * as THREE from 'three';
import { createEnvironment } from './environment.js';
import { createPhysics } from './physics.js';
import { createEffects } from './effects.js';
import { createUI } from './ui.js';
import { createInput } from './input.js';
import { createGame } from './game.js';

const env = createEnvironment(document.getElementById('app'));
const physics = createPhysics();
const effects = createEffects(env.scene, env.camera);

let game;
const ui = createUI({ onRestart: () => game?.restart() });
const input = createInput(env.renderer.domElement, {
  camera: env.camera,
  onAim: (pos) => game?.onAim(pos),
  onNudge: (delta) => game?.onNudge(delta),
  onDrop: () => game?.onDrop(),
  onRestart: () => game?.restart(),
});
game = createGame({ env, physics, effects, ui, input });

const clock = new THREE.Clock();
env.renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 8);
  game.update(dt);
  effects.update(dt);
  ui.update?.(dt); // drives the next-piece preview if ui exposes a frame hook
  env.render();
});
