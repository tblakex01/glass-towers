# Glass Towers — Architecture & Module Contracts

Minimalist 3D stacking game: move a translucent glass piece horizontally above a
pedestal, drop it (click / tap / Space), build the tallest stable sculpture.
Run ends when any piece falls off the pedestal.

Stack: **Vite + vanilla Three.js + cannon-es** (no framework). Plain ES modules,
JavaScript only (no TypeScript). All source in `src/`.

## Coordinate system & constants (`src/constants.js`)

```js
export const PEDESTAL = {
  radius: 1.9,     // visual/physics cylinder radius
  height: 1.0,     // pedestal top is at y = PEDESTAL.height
  topY: 1.0,
};
export const DROP_CLEARANCE = 2.2;   // piece hovers this far above current tower top
export const MOVE_RANGE = 2.6;       // aiming clamp: |x| <= MOVE_RANGE, |z| <= MOVE_RANGE
export const FAIL_Y = 0.35;          // a dynamic body whose center falls below this => fell off => game over
export const BEST_KEY = 'glass-towers-best';
```

Ground plane at y=0. Pedestal centered at origin. Camera looks at the tower,
slowly craning up as the tower grows.

## Module map

- Core: `src/physics.js`, `src/game.js`, `src/input.js`, `src/main.js`
- Visuals: `src/environment.js`, `src/glass.js`, `src/shapes.js`, `src/effects.js`
- UI: `src/ui.js`, `src/preview.js`, `src/style.css`

---

## Contracts

### `src/shapes.js` (Group B)

A reusable set of attractive glass shapes with different sizes and centers of mass.

```js
// Each shape definition:
// {
//   id: 'slab',                    // unique string
//   name: 'Slab',
//   tint: 0x8fd7ff,                // pastel-ish tint color (vary across shapes)
//   mass: 2.5,                     // kg-ish; heavier = bigger
//   height: 0.5,                   // total visual height (used for drop clearance / camera)
//   comOffset: [0, -0.1, 0],       // center-of-mass offset from geometric center (may be [0,0,0])
//   createGeometry(): THREE.BufferGeometry   // centered on geometric center, fresh instance each call
//   physics: one of
//     { type: 'box', halfExtents: [hx, hy, hz] }
//     { type: 'cylinder', radiusTop, radiusBottom, height, numSegments }
//     { type: 'compound', shapes: [{ type: 'box'|'cylinder', ..., offset: [x,y,z] }, ...] }
// }
export const SHAPES = [/* 6-8 shape defs */];
export function shapeById(id);
export function randomShapeId(prevId); // avoids returning prevId twice in a row when possible
```

Aim for variety: wide slab, cube, tall column (top-heavy via comOffset), squat
cylinder/puck, capsule-ish rounded piece (visual roundness fine, physics can be
cylinder), an L/T compound piece, a small "gem" (visual octahedron/icosahedron is fine
but physics must be box approximation). Footprints roughly 0.7–2.2 units, heights 0.4–1.6.

### `src/glass.js` (Group B)

```js
export function createGlassMaterial({ tint = 0xffffff } = {});  // THREE.MeshPhysicalMaterial
```

Convincing glass: `transmission` ~1, low roughness, `thickness`, `ior` ~1.5,
subtle `clearcoat`, `envMapIntensity` tuned for studio env. Scene env map comes
from `scene.environment` (set in environment.js) — do not load external HDR files.
Must look good AND stay fast for ~40+ meshes: keep it a shared-settings factory,
no per-frame work.

### `src/environment.js` (Group B)

```js
export function createEnvironment(container /* HTMLElement */) {
  // returns:
  // {
  //   renderer,           // THREE.WebGLRenderer (antialias, shadows PCFSoft, toneMapping ACES)
  //   scene,              // with scene.environment set via PMREMGenerator + RoomEnvironment
  //   camera,             // PerspectiveCamera
  //   updateCamera(towerTopY, dt),  // smoothly track tower height (lerp), gentle orbit drift optional
  //   pedestalMesh,       // visual pedestal (cylinder per PEDESTAL constants) added to scene
  //   render(),           // renderer.render(scene, camera)
  //   resize(),           // handle window resize (also wired internally to window 'resize')
  // }
}
```

Soft studio look: `RoomEnvironment` from `three/addons/environments/RoomEnvironment.js`
through PMREMGenerator, one soft shadow-casting key DirectionalLight, gentle fill,
large soft ground disc/plane that receives shadows, subtle background gradient or
fog. Pixel ratio clamped to 2. No postprocessing passes (performance).

### `src/effects.js` (Group B)

```js
export function createEffects(scene, camera) {
  // returns { onImpact(position: THREE.Vector3, intensity: 0..1), update(dt), reset() }
}
```

Satisfying but cheap impact feedback: expanding/fading ring or shockwave mesh at the
contact point, tiny camera nudge for hard impacts, brief sparkle/point flash. Pool
objects, no allocations per impact. `reset()` clears live effects (used on restart).

### `src/physics.js` (Group A)

Thin cannon-es wrapper.

```js
export function createPhysics() {
  // returns:
  // {
  //   world,                                  // CANNON.World, gravity -9.82, sleep enabled
  //   addPedestal(),                          // static cylinder body per PEDESTAL + ground plane
  //   createBody(shapeDef, position),         // dynamic body from shapes.js def, honoring comOffset
  //   removeBody(body),
  //   step(dt),                               // fixed timestep w/ interpolation
  //   reset(),                                // remove all dynamic bodies
  // }
}
```

comOffset handling: cannon bodies rotate about their origin => add shapes offset by
`-comOffset` so the body origin sits at the center of mass; the paired THREE mesh must
then be attached with the inverse offset (game.js positions mesh from body using a
child-mesh offset or matrix composition).

Contact material tuned for glass-on-glass stacking: moderate friction (~0.4),
low restitution (~0.05) so stacks settle rather than bounce forever.

### `src/input.js` (Group A)

```js
export function createInput(domElement, {
  onAim,       // ({x, z}) desired horizontal position (raycast pointer onto aim plane, clamped by game)
  onNudge,     // ({dx, dz}) keyboard arrows/WASD incremental movement
  onDrop,      // () click / tap / Space
  onRestart,   // () R key
}) { return { setAimPlaneY(y), dispose() }; }
```

- Mouse move / touch drag => `onAim` with pointer unprojected onto horizontal plane at aim height.
- Click or tap (pointerup with < ~6px movement and < ~300ms) => `onDrop`.
- Space => `onDrop`; arrows/WASD => `onNudge`; R => `onRestart`.
- Must not fire `onDrop` for clicks on HUD/overlay elements (check event target is the canvas).

### `src/game.js` (Group A)

```js
export function createGame({ env, physics, effects, ui, input }) {
  // returns { update(dt), restart() }
}
```

State machine: `aiming -> falling -> settling -> aiming` ... -> `gameover`.

- Aiming: current piece (kinematic/visual only, no dynamic body yet) hovers at
  `towerTopY + DROP_CLEARANCE`, follows aim position (lerp for smoothness), clamped to MOVE_RANGE.
- Drop: create dynamic body at piece position, hand mesh to physics sync list.
- Piece "settled" when its body sleeps OR (speed < 0.12 and angularSpeed < 0.15 for ~0.7s).
  On settle: score it, spawn next piece (from queue), update next-piece preview.
- Scoring: +10 per settled piece, +5 precision bonus when horizontal distance to the
  piece below (or pedestal center for the first piece) < 0.25. Update best (localStorage)
  live; ui.setScore/setBest.
- Impact effects: listen to body 'collide' events, call effects.onImpact with contact
  point and impact velocity mapped to 0..1.
- Game over: ANY dynamic body fell off the pedestal — center y < FAIL_Y, or it dropped
  below the pedestal top while horizontally clear of the pedestal (e.g. resting on the
  studio floor). Freeze input drops,
  ui.showGameOver(score, best, isNewBest). Restart (button or R): physics.reset(),
  remove piece meshes, effects.reset(), score 0, fresh queue, ui.hideGameOver().
- Tower top tracking: max settled-body top height; env.updateCamera(towerTopY, dt) each frame.
- Every dynamic body gets a paired mesh (geometry from shapeDef.createGeometry(),
  material from createGlassMaterial({tint})); sync mesh from body each frame respecting comOffset.

### `src/main.js` (Group A)

Bootstrap: build environment, physics, effects, ui, input, game; run
renderer.setAnimationLoop with clock-clamped dt (max 1/30); call game.update(dt),
effects.update(dt), env.render().

### `src/ui.js` (Group C)

Works against the FROZEN ids in index.html.

```js
export function createUI({ onRestart }) {
  // returns:
  // {
  //   setScore(n), setBest(n),
  //   setNextShape(shapeDef),          // updates the 3D preview (see preview.js)
  //   showToast(text),                 // e.g. "Perfect! +5", auto-hides ~1.2s
  //   showGameOver(score, best, isNewBest),
  //   hideGameOver(),
  // }
}
```

Wire `#restart-btn` click to `onRestart`. Also `getBest()/saveBest(n)` helpers using
localStorage BEST_KEY (guard against storage exceptions).

### `src/preview.js` (Group C)

```js
export function createPreview(canvas /* #next-preview */) {
  // returns { setShape(shapeDef), update(dt) }  // slowly rotating glass piece
}
```

Small dedicated THREE.WebGLRenderer on the preview canvas (112x112, alpha), its own
tiny scene + PMREM RoomEnvironment (or a simple 3-light rig if cheaper), reuses
`createGlassMaterial` + `shapeDef.createGeometry()`. Dispose old geometry on swap.

### `src/style.css` (Group C)

Clean minimalist studio aesthetic: white/very light backdrop vibe, thin sans-serif
(system font stack), HUD top corners, frosted-glass panels (backdrop-filter blur),
centered game-over card with fade/scale-in animation, `.hidden { display: none }`,
responsive for mobile (HUD scales, hint hides on small heights), no external fonts.
`#app canvas { display:block; touch-action:none; }` and full-viewport layout.
