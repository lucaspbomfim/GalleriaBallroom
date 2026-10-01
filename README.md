# GalleriaBallroom

Front-end engine for the Galleria Thanksgiving Ball RSVP page (Pyper Publishing), served through jsDelivr.

## How it loads

The MailerLite page loads one tagged version:

```
https://cdn.jsdelivr.net/gh/lucaspbomfim/GalleriaBallroom@<tag>/dist/<file>
```

- One tag per version (`v0.0.1`, `v0.1.0`, ...). Tags are immutable, so every version gets a fresh URL and no cache problem.
- Never load from a branch URL in production: jsDelivr caches branches.
- A new version means: commit, create the tag, change the tag in the page's first block, republish the page.

## Rules

- No font files in this repository. The display face comes from an Adobe Fonts web project, which forbids self-hosting.
- `src/` holds the readable source; `dist/` holds what the page loads; `page/` holds the MailerLite code blocks.
- Build: `python3 build.py <tag> <path to the designer's clean SVGs>` (needs `terser` 5).

## Versions

| Tag | What changed |
|---|---|
| v0.0.1 | Smoke test: `dist/smoke.js` and `dist/smoke.css` |
| v0.1.0 | Iteration 1, the curtain: `dist/galleria.min.js` (WebGL velvet, projector, cord, knocks, tableau opening, settled frame, synthesized sounds), `dist/galleria.css` (sentinel and hero art styles), `dist/galleria-art.js` (the cartouche). Block 1 v0.1.0 and the provisional static hero (block 2) live in `page/`. `build.py` regenerates `dist/` and `page/bloco1.html` |
| v0.1.1 | Refinements after the first live review: projector flicker (24 fps shutter, lamp sag, dropped frames, gate weave), cloth that follows the cord through springs, heavier rise with trailing cloth and a settling swing, a more realistic tassel whose skirt swings and flares, two whimsical sound palettes (champagne-flute taps by default, `#musicbox` as an alternative), hero that scales with the screen. Review hashes: `#curtain`, `#purpose`, `#musicbox` |
