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
| v0.1.2 | Hero laid out like the printed invitation, with the cartouche in blind emboss (lit height map, as on the save the date) and paper grain. Sound: a sax overture, "Mystery Sax" by Kevin MacLeod (CC BY 4.0, credit at the foot of the hero, details in `dist/audio/CREDITS.md`), started by the opening gesture, its first note aligned with the start of the curtain rise. Synthesized palettes removed; only the velvet swish remains |
| v0.1.3 | Emboss bevel held at about 1.25 screen pixels at any size (crisp on desktop), flat oxblood field without the warm centre, transparent call to action with a double champagne hairline and a foil sheen, smaller music credit |
| v0.2.0 | Scene 1, the open tableau: the emboss sits in half light behind the closed curtain and comes up with the rise; on desktop a follow spot is struck on the title as the curtain settles and then follows the mouse within the stage (colour-dodge light: the field warms, the relief deepens, the type reads as foil); one pass of foil light over the type and the GALLERIA logo |
| v0.2.1 | Scene 1 is desktop only: phones keep the v0.1.3 hero (no house light, no foil pass), which removes the stutter of the rise on iPhone. Desktop house light animates opacity only on its own layer (the emboss filter is drawn once). The opening settles on time again (scroll is not held for the foil pass). The follow spot catches like a lamp: two light stutters as it is struck |
