# Glass Towers

A minimalist 3D browser game about balancing translucent glass objects. Move the
next glass piece over the pedestal, drop it, and build the tallest stable
sculpture you can. The run ends the moment a piece falls off the pedestal.

Built with **Three.js** (physically-based glass with transmission, PMREM studio
environment, soft shadows) and **cannon-es** for rigid-body physics.

## Play

```bash
npm install
npm run dev      # local dev server
```

### Controls

| Action | Mouse | Touch | Keyboard |
|---|---|---|---|
| Move piece | move pointer | drag | arrows / WASD |
| Drop piece | click | tap | Space |
| Restart | Rebuild button | Rebuild button | R |

### Rules & scoring

- +10 per settled piece, +5 "Perfect!" bonus for landing within 0.25 units of
  the piece below.
- Seven glass shapes with different sizes, masses, and centers of mass (the
  column is top-heavy, the gem is bottom-heavy, the tee is a compound body...).
- Best score is kept in `localStorage`.

## Development

```bash
npm run build    # production build (dist/)
npm run lint     # eslint
npm run preview  # serve the production build
```

`ARCHITECTURE.md` documents the module contracts.

### Automated play-test

`scripts/playtest.mjs` drives a full game in headless Chromium (keyboard,
mouse, and touch runs: settling, scoring, forced failure, restart, best-score
persistence, console-error check):

```bash
npm i --no-save playwright-core
npm run build && npm run preview &
GT_CHROMIUM=/path/to/chromium node scripts/playtest.mjs
```
