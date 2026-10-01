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
| v0.3.0 | Scene 2, the carnet de bal (new block 3, `page/bloco3_carnet.html`): a cream card on a cord with a tassel, date, time, venue (Google Maps link) and dress code, the giant 19 on desktop and the line about the evening. The engine adds the card's blind emboss in paper colours (a small seal), a paper grain, and pendulum physics: cord and card swing from the top of the section, the card a beat behind, the tassel behind the card; a push when it comes into view (phones too); on desktop the scroll, a brush of the pointer, or a pull with the mouse moves it. Block 3 also paints the MailerLite wrapper oxblood when the engine is on (the white strip under the hero on iPhone) |
| v0.3.1 | Carnet: on desktop it can be held and thrown (the grabbed point follows the pointer, up to about 12 degrees aside and 40 px up or down against the give of the cord; let go and the speed of the gesture goes into the swing). On phones the line sits clear of the tassel |
| v0.4.0 | Scene 3, the box office (new block 4, `page/bloco4_bilheteria.html`): three tickets over the hidden native Products block, the current lot (lowest one present) printed on cream stock, closed lots in blind emboss, the next in line engraving; Reserve clicks the native button. Desktop: the follow spot is struck on the current ticket, velvet drapes come down beside the checkout like a box-office window. Phone: one pass of foil on the ticket, a curtain that closes and opens again in about 0.4 s. A purchase (checkout_complete) closes a curtain on "Your place is confirmed." and opens it again. Sales close by the clock (Nov 11 04:59 UTC); calls to action turn into "Sales are closed.". Review hashes: #closed, #lot2, #lot3 |
| v0.4.1 | Box office passage, desktop: drapes redrawn as tied-back stage curtains (folds fanning from the tie, sagging hem with its shadow, the tail falling to the floor, champagne cord and tassel at the tie, swagged valance); no rule of ours around the checkout box. Phone: the curtain closes and opens in about 1.25 s instead of 0.42 s, so it reads as a curtain |
| v0.4.2 | The stage: the passage and the thanks now use the hero's own curtain (same shader, on a second fixed canvas). Desktop: the curtain comes down already drawn into a tableau around the checkout. Phone: the closed curtain comes down and flies out (about 1.2 s). Thanks: the curtain closes (the tableau closes over the checkout on desktop) and the opening's projector lights "Your place is confirmed." on its pleats, with flicker and glints; then it flies out. The CSS drapes are gone; CSS velvet stays only as a fallback without WebGL |
| v0.5.0 | Scene 4, the dance floor (new block 5, `page/bloco5_pista.html`, last on the page, after the Products block): a marquee arch of bulbs lit from both feet to the crown, a mirror ball at the crown (tile by tile, reflecting the room, two stage lamps and the marquee; four-point glints), reflections sweeping the room once every 48 s, "Until the last song", Reserve your place, the Galleria × Beau Monde Builders signature in the two logos; footer with Pyper Publishing and the music credit (moved out of the hero, block 2). The sax plays as if from the next room between the hero and the dance floor (lowpass on the overture only) |
| v0.5.1 | Scene 4 redone after Luki's review (the v0.5.0 floor read as Christmas): a WebGL mirror ball (each facet a mirror reflecting the room, grout, limb, glints; accumulated turn, no reset), reflections computed from the facets (streaks of light sweeping together with the ball), an Art Deco crown of stepped arches lit by running heads of light; when they meet at the ball it ignites (flare, light bursting into the room, a sunburst fan, a pass of foil on the line). Desktop: the pointer is the lamp; a click or tap spins the ball; on phones the scroll spins it. Footer: Galleria Magazine and Pyper Publishing |
| v0.5.2 | Dance floor, after Luki's review of v0.5.1: the ignition is a warm halo breathing behind the ball (the four-point flare was clipped into a box by the ball's canvas); glints sized to stay inside a larger ball canvas; the lamp no longer follows the pointer (the light answers only the ball; click or tap still spins it); reflections drawn as crisp vector patches aligned to the facet grid instead of a blurred sprite. build.py now refuses to build when galleria.js and galleria.css carry different versions |
| v0.5.3 | Dance floor: the fan of rays is clipped exactly to the inner arch (each ray starts below its top line and stops short of the first step or wall it would cross, or of the words); the Beau Monde wordmark in the signature is sized to about 85% of the Galleria logo's width, on desktop and phones (Galleria unchanged) |
| v0.5.4 | Dance floor: the reflections are soft, faded patches (a rounded square of light fading to its rim, from a 96 px sprite only ever drawn smaller) instead of sharp-edged rectangles snapped to pixels |
