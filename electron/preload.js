/* The only bridge between the desktop shell and the game.
 *
 * DELIBERATELY ALMOST EMPTY, and it should stay that way. The game must run
 * identically in a browser on GitHub Pages, so nothing in the game may
 * REQUIRE anything exposed here. This publishes one fact — "you are running
 * inside the desktop build" — and the version string behind it, for a future
 * about-box or a bug report footer.
 *
 * If desktop-only behaviour is ever genuinely needed (a native save dialog,
 * a real quit button), add it here behind contextBridge and feature-detect it
 * in the game:
 *
 *     if (window.iceHockeyDesktop) { ... } else { ...the web path... }
 *
 * never the other way round. `contextIsolation` is on, so this object is the
 * only thing the page can see — the page has no `require`, no `process` and
 * no filesystem.
 *
 * The version arrives through `additionalArguments` rather than by reading
 * package.json: `sandbox` is on, and a sandboxed preload's `require` only
 * resolves a handful of built-ins, so requiring a JSON file from disk here
 * would throw and take the whole preload — and with it this object — down.
 */
const { contextBridge } = require('electron');

const flag = (process.argv || []).find((a) => a.startsWith('--ih-version=')) || '';

contextBridge.exposeInMainWorld('iceHockeyDesktop', {
  isDesktop: true,
  version: flag.slice('--ih-version='.length) || '0.0.0',
  platform: process.platform,
});
