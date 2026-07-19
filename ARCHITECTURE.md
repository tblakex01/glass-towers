# Glass Towers architecture

Glass Towers is a static Vite application with a single production codepath:

- Three.js `WebGPURenderer` using its production WebGL2 backend
- TSL and node materials for backend-neutral gallery and glass shaders
- Rapier 3D WebAssembly for deterministic, fixed-step rigid-body simulation
- DOM-based HUD, dialog, and accessibility semantics

There is no alternate Cannon or WebGL-only game implementation.

## Runtime flow

`src/main.js` starts the renderer and Rapier concurrently, then constructs the
effects, UI, input, and game state machine. The renderer owns the animation loop:

1. remove the previous frame's camera shake
2. advance fixed-step physics and synchronize render transforms
3. update the placement beam, live structure bounds, and camera framing
4. add the current impact shake
5. update the throttled preview and render

Boot failures produce a recoverable, accessible browser message. Page teardown
disposes input listeners, Rapier memory, PMREM targets, materials, geometries,
observers, and renderer resources.

## Module boundaries

### `src/game.js`

Owns the state machine (`aiming -> falling -> aiming -> gameover`), score, queue,
piece lifecycle, settlement, failure, and restart. It depends on narrow physics,
environment, effects, UI, and input contracts; it does not import Rapier types.

Every frame it builds a live world-space structure envelope from the pedestal,
dynamic pieces, and current aiming piece. The envelope continues updating during
game over so the camera follows a collapse downward.

### `src/gameplay-policy.js`

The single source of truth for placement and scaling rules:

- `scaleForPlacement(n) = max(0.72, 1.10 * 0.97 ** n)`
- immutable scaled queue entries
- seeded shape selection and deterministic one-axis challenge offsets
- scaled geometry, mass (`baseMass * scale³`), colliders, offsets, COM, bounds,
  height, and footprint
- one immutable body-frame geometry offset derived from each authored center of
  mass and shared by rendering and Rapier collider placement
- footprint-aware safe-overlap bounds for challenge spawns

The policy rejects invalid indices, RNG results, dimensions, scales, seeds, and
movement ranges before they can reach rendering or physics.

### `src/physics.js`

Owns the Rapier world and no gameplay rules. It provides:

- a 60 Hz accumulator capped at eight catch-up steps
- tuned friction, restitution, damping, sleeping, CCD, and solver iterations
- collider construction for boxes, cylinders, and compound pieces
- explicit mass/inertia centered on each shape's authored COM
- contact-force events translated into bounded impact callbacks
- transform/speed/sleep queries that hide Rapier from `game.js`

The ground and pedestal are added once. Restart removes only dynamic bodies;
page teardown frees the world and event queue.

### `src/environment.js` and `src/render/`

`createEnvironment()` is asynchronous because renderer and PMREM initialization
must complete before use. It returns the renderer, scene, camera, backend name,
quality tier, camera update function, resize function, and disposer.

`render/gallery.js` builds the warm sculptural gallery from curved plaster,
monumental ribbons, organic floor inlays, reflection cards, soft studio lights,
and a multi-band pedestal. Its nearly overhead key follows the tower envelope so
soft shadows stay aligned as the sculpture grows. `render/aim-shadow.js` clips a
moving contact footprint to the current support mesh, preserving readable
alignment on transmissive glass. `render/placement-guide.js` owns the reusable
world-space segmented rail, end ticks, and piece-tracking marker.
`render/camera-framing.js` performs aspect-aware, exponentially smoothed rise,
collapse, and user orbit from `{topY, bottomY, state}`.

### `src/glass.js`

Creates `MeshPhysicalNodeMaterial` glass from validated quality, tint, thickness,
contrast, roughness, attenuation, and dispersion inputs. The same factory is used
by gameplay pieces and the preview, so the optical model has one implementation.

### `src/input.js`, `src/ui.js`, and `src/preview.js`

Input maps pointer rays to a single horizontal placement axis. Mouse hover and
A/D or Left/Right move; click or Space drops; mouse drag orbits. Touch uses
drag/release for placement and a two-finger gesture for orbit. The first pointer
click activates without dropping, vertical drag changes elevation, and the
wheel controls distance. Pointer
cancellation, focus loss, visibility, editable targets, and repeat keys are
guarded explicitly.

The DOM UI owns branded loading, zero-padded score/best announcements,
contextual controls, the sharp in-scene game-over dialog, and focus restoration.
The next-piece preview uses a throttled secondary renderer and stops animating
for reduced-motion users.

### `src/effects.js`

Owns pooled glass contact motes, a restrained impact flash, and bounded camera
shake.
Shake is removed before camera framing and reapplied afterward, preventing the
camera controller from feeding on its own previous offset.

## Rendering and deployment

Vite emits separate app, Three.js, Rapier JS, and Rapier WASM assets. `base: './'`
keeps the standalone build valid on static hosts and nested paths. The universal
`WebGPURenderer` API remains the single rendering implementation, but production
forces its WebGL2 backend because native WebGPU viewport transmission can submit
destroyed textures once a third transmissive piece enters the scene. Native
WebGPU is retained behind `?renderer=webgpu` for diagnosis and future upgrades.

## Verification

- `npm run lint` checks the complete source and automation surface.
- `npm test` covers scaling invariants, compound colliders, deterministic queue
  behavior, one-axis challenge offsets, placement-guide lifecycle, tower-following
  shadow projection, aim-shadow ownership, camera rise/collapse/orbit, and
  narrow-viewport framing.
- `npm run build` produces the standalone artifact.
- `npm run playtest` exercises the built game in Chrome/Chromium and captures
  representative desktop, third-piece stability, failure, and mobile screenshots.
