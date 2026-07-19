# Glass Towers

A minimalist 3D balancing game built from translucent forms. Move each glass
piece over the pedestal, correct its offset, and drop it to build the tallest
stable sculpture you can.

The production runtime uses Three.js `WebGPURenderer` on its stable WebGL2
backend, TSL/node materials, and Rapier's WebAssembly rigid-body engine. Native
WebGPU remains an explicit diagnostic mode while Three's viewport-transmission
path can invalidate render textures when several glass objects share a scene.

## Run locally

```bash
npm install
npm run dev
```

### Controls

| Action | Mouse | Touch | Keyboard |
|---|---|---|---|
| Move piece | move pointer | drag | Left/Right or A/D |
| Drop piece | click | release | Space |
| Orbit gallery | drag | two-finger drag | — |
| Zoom gallery | wheel | — | — |
| Restart | Reset / Try Again | Reset / Try Again | R |

The segmented world-space beam shows the entire placement range, and its coral
diamond tracks the current piece. Each stable piece scores one point. Pieces
enter at a deterministic one-axis challenge offset and gradually scale from
1.10× toward a 0.72× floor while mass, geometry, colliders, center of mass, and
footprint stay synchronized. The best score is stored locally in the browser.
The first pointer click activates the playfield without releasing a piece.
An overhead studio key casts a soft footprint onto the pedestal, while a clipped
aim shadow remains readable on the top glass surface for precise alignment.

## Quality gates

```bash
npm run check     # lint + deterministic tests + production build
```

The production build is a static, subpath-safe artifact in `dist/`. Rapier is
emitted as a cacheable `.wasm` asset, separate from the app and Three.js chunks.

### Browser playtest

Start the built artifact:

```bash
npm run preview -- --host 127.0.0.1
```

Then run the real-browser matrix in another terminal. When using the declared
`playwright-core` dependency, point it at an installed Chromium or Chrome:

```bash
GT_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
npm run playtest
```

The suite runs multiple towers and covers one-point scoring, a deterministic
three-piece regression for the former score-02 freeze, keyboard/mouse/touch
placement, focus-only activation, horizontal and vertical orbit, wheel zoom,
two-finger orbit, release to drop, collision settlement, failure, restart,
local-best persistence,
back/forward-cache restoration, responsive layouts, reduced motion,
accessibility focus, and console/network errors. Screenshots default to
`/tmp/gt-shots`; set `GT_SHOTS` to choose another artifact directory.

For deterministic manual debugging, use `?seed=<uint32>`. Add
`&renderer=webgpu` only to exercise Three's experimental native WebGPU backend;
the default and production backend is WebGL2.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module contracts and invariants.
