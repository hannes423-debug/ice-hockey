# Ice Hockey

A single-file Three.js ice hockey practice game with realistic EA-NHL-style skating and shooting physics.

**Play it:** https://hannes423-debug.github.io/ice-hockey/

## Features

- Stance-gated wrist / backhand / slap / pass shots with swipe-gesture release (curve depth controls saucer & chip loft)
- NHL 25 style energy model: only sprint/hustle drains stamina — normal skating slowly regenerates, gliding recovers faster, standing still refills very fast
- Pivot / backskate, puck protect, dives
- Glass and over-the-boards puck physics
- AR aim visualization: trajectory ribbon, climbing ring, d20-roll info card

## Running locally

No build step — it's one HTML file.

```bash
python3 -m http.server 8000
# open http://localhost:8000/index.html
```

## Deploying updates

The source of truth is `~/Lataukset/ice_hockey.html`. To publish a new version:

```bash
cp ~/Lataukset/ice_hockey.html ~/Työpöytä/ice-hockey/index.html
cd ~/Työpöytä/ice-hockey
git add -A && git commit -m "Update build" && git push
```

GitHub Pages redeploys automatically within a minute or two.
