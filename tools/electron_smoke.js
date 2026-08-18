/* Smoke test for the desktop wrapper. Run it with:
 *
 *     npm run test:electron
 *
 * It does NOT reimplement the wrapper — it requires the real
 * electron/main.js and spies on the BrowserWindow it creates. Testing a copy
 * of the code under test is how a wrapper passes its own suite and still fails
 * on the desktop, so the only thing this file adds is the spy and the
 * assertions.
 *
 * What it proves, in order of how badly each one bites:
 *
 *  1. The window loads the site at all, over the packaged `app://` path — not
 *     the dev server. (IH_PACKAGED_PREVIEW makes an unpackaged run take the
 *     packaged branch.)
 *  2. `location.origin` is a REAL origin, not "null". This is the whole reason
 *     the wrapper registers a scheme instead of calling loadFile(): under
 *     file:// Chromium hands out opaque origins.
 *  3. localStorage works AND SURVIVES A NAVIGATION between the two pages. The
 *     menu writes `ihAutoStart` and the game reads it; if that handoff is
 *     dropped, pressing START lands you in the default mode with no error
 *     anywhere — the failure is completely silent, which is exactly why it
 *     gets a test.
 *  4. three.js and its loader are present, from vendor/, with no network.
 *  5. The renderer really is locked down: no `require`, no `process`.
 */
const { app, BrowserWindow } = require('electron');

/* Keep the test window off the user's screen. Swapping the BrowserWindow
   export itself is not possible — Electron defines it non-configurable, and
   the attempt throws before any handler is installed, which presents as a
   process that starts and then simply hangs. Neutering `show` on the
   prototype gets the same result in two lines: main.js still constructs its
   real window with its real options, `ready-to-show` still fires, and the
   window it would have raised stays hidden. */
BrowserWindow.prototype.show = function () {};

process.env.IH_PACKAGED_PREVIEW = process.env.IH_PACKAGED_PREVIEW || '1';

require('../electron/main.js');

const results = [];
let failures = 0;
function chk(name, ok, detail) {
  results.push((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' :: ' + detail : ''));
  if (!ok) failures++;
}

/* Waiting on `did-finish-load` alone deadlocks: the first page can easily be
   done loading before this listener is attached, and then nothing ever fires
   again. Check the state first, and never wait forever — a hung probe reads
   exactly like a hung app. */
function loaded(win, url, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; clearTimeout(t); fn(arg); } };
    const t = setTimeout(() =>
      done(reject, new Error('timed out waiting for ' + (label || 'load'))), 30000);
    win.webContents.once('did-finish-load', () => done(resolve));
    win.webContents.once('did-fail-load', (_e, code, desc, u) =>
      done(reject, new Error('did-fail-load ' + code + ' ' + desc + ' ' + u)));
    if (url) win.loadURL(url);
    else if (!win.webContents.isLoading() && win.webContents.getURL()) done(resolve);
  });
}

/* An exception before the report leaves a running Electron with no output,
   which reads as a hung app rather than a failed test. */
process.on('uncaughtException', (e) => {
  process.stdout.write('UNCAUGHT ' + (e && e.stack) + '\nFAILURES=1\n');
  app.exit(1);
});

app.whenReady().then(async () => {
  // give main.js's own whenReady handler a turn to create the window
  await new Promise((r) => setImmediate(r));
  const win = BrowserWindow.getAllWindows()[0];
  try {
    if (!win) throw new Error('main.js created no BrowserWindow');

    /* the renderer console is the only place a page-level error shows up in a
       headless run — surface it instead of letting it vanish */
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) results.push('CONSOLE(' + level + ')=' + message);
    });

    await loaded(win);
    const url = win.webContents.getURL();
    chk('loads the packaged site', /^app:\/\//.test(url), url);

    const menu = await win.webContents.executeJavaScript(`(() => ({
      origin: location.origin,
      three: typeof THREE,
      revision: (typeof THREE !== 'undefined' && THREE.REVISION) || null,
      gltf: !!(typeof THREE !== 'undefined' && THREE.GLTFLoader),
      items: document.querySelectorAll('#menuList .menu-item').length,
      bg: (() => { const b = document.querySelector('.bg-locker .base');
        return b ? (getComputedStyle(b).backgroundImage.match(/url\\(["']?([^"')]+)/) || [])[1] || 'none' : '-'; })(),
      desktop: !!(window.iceHockeyDesktop && window.iceHockeyDesktop.isDesktop),
      version: window.iceHockeyDesktop && window.iceHockeyDesktop.version,
      hasRequire: typeof require !== 'undefined',
      hasProcess: typeof process !== 'undefined',
      /* The ES2019 shim is shared with the Xbox host and does nothing in
         Chromium, so nothing about the page LOOKS different when it fails to
         ship — which is exactly why it needs its own assertion here. If
         package.json's build.files ever stops matching compat/, this is the
         only thing that would say so before an AppImage reached a user. */
      /* Not resource timing: under the app:// scheme Chromium reports no
         resource entries at all, so the request is invisible to a test. The
         shim leaves a marker instead — see compat/es2019.js. */
      shim: window.__ihCompat,
      store: (() => { try { localStorage.setItem('__smoke', 'menu-wrote-this'); return 'ok'; }
                      catch (e) { return 'THREW ' + e.name; } })(),
    }))()`);

    chk('origin is real, not opaque', menu.origin && menu.origin !== 'null', menu.origin);
    // THREE.REVISION is the STRING '128' in r128, not a number
    chk('three.js loaded from vendor/', menu.three === 'object' && String(menu.revision) === '128',
        menu.three + ' r' + menu.revision);
    chk('GLTFLoader loaded from vendor/', menu.gltf === true);
    chk('menu built', menu.items >= 8, menu.items + ' items');
    chk('locker-room backdrop resolved', /locker-room\.jpg$/.test(menu.bg || ''), menu.bg);
    chk('preload bridge present', menu.desktop === true, 'version ' + menu.version);
    chk('es2019 shim shipped and ran', menu.shim === 'es2019', String(menu.shim));
    chk('renderer has no require', menu.hasRequire === false);
    chk('renderer has no process', menu.hasProcess === false);
    chk('localStorage is writable', menu.store === 'ok', menu.store);

    /* THE ONE THAT MATTERS: index.html -> game.html is a real navigation, and
       the mode handoff rides localStorage across it. */
    const gameUrl = new URL('game.html', url).toString();
    await loaded(win, gameUrl);
    const game = await win.webContents.executeJavaScript(`(() => ({
      origin: location.origin,
      carried: localStorage.getItem('__smoke'),
      three: typeof THREE,
      startMenu: !!document.querySelector('#smStart'),
      vsButton: !!document.querySelector('#smVs'),
      canvas: (() => { const c = document.querySelector('canvas');
        return c ? c.width + 'x' + c.height : 'none'; })(),
    }))()`);

    chk('game page shares the menu origin', game.origin === menu.origin,
        menu.origin + ' -> ' + game.origin);
    chk('localStorage survives the page handoff', game.carried === 'menu-wrote-this',
        String(game.carried));
    chk('game booted three.js', game.three === 'object');
    chk('game start menu built', game.startMenu === true);
    chk('VS mode is in the packaged build', game.vsButton === true);
    chk('game rendered a canvas', /^\d+x\d+$/.test(game.canvas) && game.canvas !== '0x0', game.canvas);

    await win.webContents.executeJavaScript(`localStorage.removeItem('__smoke')`);
  } catch (e) {
    chk('smoke run completed', false, e.message);
  }

  results.push('FAILURES=' + failures);
  process.stdout.write(results.join('\n') + '\n');
  app.exit(failures ? 1 : 0);
});
