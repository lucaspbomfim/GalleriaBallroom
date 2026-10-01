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
- `src/` holds the readable source; `dist/` holds what the page loads.

## Versions

| Tag | What changed |
|---|---|
| v0.0.1 | Smoke test: `dist/smoke.js` and `dist/smoke.css` |
