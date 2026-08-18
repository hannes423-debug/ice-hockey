/* Ice Hockey — desktop wrapper.
 *
 * This file is a WINDOW, not a game. It contains no gameplay logic, no asset
 * paths and no knowledge of how the game works; it opens index.html and gets
 * out of the way. The web version at
 * https://hannes423-debug.github.io/ice-hockey/ and this desktop build run the
 * exact same files.
 *
 * THE ONE DECISION WORTH EXPLAINING: the packaged app serves the site over a
 * custom `app://` scheme instead of loading it with `file://`.
 *
 * The game is spread over three pages that hand state to each other through
 * localStorage — index.html writes `ihAutoStart` and game.html consumes it,
 * the Locker Room writes the loadout and the game reads it. Under `file://`
 * Chromium gives every page an opaque origin, so that shared storage is not
 * reliably shared and the handoff silently does nothing: you would press START
 * in the menu and land in the default mode, with no error anywhere. `app://`
 * is a registered standard scheme, so the three pages share one real origin
 * and behave exactly as they do on a web server.
 *
 * In development it loads http://localhost:8000 instead, so editing a file and
 * pressing reload is the whole loop — no rebuild, no repackage.
 */
const { app, BrowserWindow, shell, protocol, net, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.IH_DEV_URL || 'http://localhost:8000';
/* IH_PACKAGED_PREVIEW runs the PACKAGED path (app://, files from disk) out of
   the source tree, so the protocol handler can be tested in a second instead
   of after a two-minute AppImage build. `npm run electron:start`. */
const isDev = !app.isPackaged && !process.env.IH_PACKAGED_PREVIEW;

/* The site itself: the repo root in development, the app.asar root once
   packaged. Both hold index.html at the top, which is the point — the desktop
   build ships the published web files unchanged. */
const SITE_ROOT = path.join(__dirname, '..');

/* Must be called before `ready`. `standard` gives the scheme a real origin
   (so localStorage, relative URLs and history all behave); `secure` puts it in
   a secure context, which WebGL and pointer lock expect; `supportFetchAPI`
   lets fetch() reach the site's own files. */
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    // app://ice-hockey/foo -> <SITE_ROOT>/foo, and bare / -> index.html
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.join(SITE_ROOT, rel);
    /* Containment check. Nothing in this app builds a URL from user input, but
       a path handler that can be talked into `../../etc/passwd` is not a thing
       to leave lying around for whatever gets added later. */
    if (target !== SITE_ROOT && !target.startsWith(SITE_ROOT + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

/* A content policy for the DESKTOP build only, attached as a response header
   here rather than as a <meta> tag in the pages.
 *
 * That split is the point: the web build must stay a pile of static files that
 * GitHub Pages can serve with no configuration, and a <meta> CSP would apply
 * there too — where it buys nothing and could only ever break something. This
 * one exists to say the desktop app never talks to the network: `connect-src
 * 'self'` and `default-src 'self'` mean a stray fetch or an accidentally
 * re-added CDN tag FAILS instead of quietly working on the developer's
 * machine and dying on a plane.
 *
 * 'unsafe-inline' is not negotiable and not a compromise here: the game is one
 * 5 MB HTML file whose entire program is inline <script>, and its model,
 * animations and rink textures are inline data: URLs. There is no remote
 * origin to protect against — everything is local and shipped in the package.
 * 'unsafe-eval' is deliberately NOT granted. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  /* `blob:` and `data:` are REQUIRED, not slack. Every skater model, the
     animation pack and the stick are base64 inside the HTML, and the loader
     turns each one into a Blob and fetches its blob: URL. A `connect-src
     'self'` alone blocks exactly that, and the failure is the quietest
     possible one: the page paints, three.js is fine, the canvas renders — and
     no players ever appear because the start menu is built in the model's
     load callback. Caught by tools/electron_smoke.js, which is why it asserts
     on the start menu rather than on "the page loaded". */
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function applyCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 480,
    backgroundColor: '#05070b', // the menu's own darkest tone: no white flash on open
    autoHideMenuBar: true,      // Alt still reveals it; the game uses Alt itself, see below
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // the game is a single trusted local app; nothing here loads remote content
      webSecurity: true,
      // the sandboxed preload cannot read package.json off disk — hand it the
      // version as a switch instead (see electron/preload.js)
      additionalArguments: ['--ih-version=' + app.getVersion()],
    },
  });

  /* ALT IS A GAMEPLAY KEY (defense/offense toggle, and the reverse-hit
     modifier while carrying). Electron's default menu bar takes Alt for
     itself, so without this a mode toggle mid-rush opens the window menu
     instead — the same class of bug the web build already had to fix by
     preventDefault-ing Alt on keyup as well as keydown. */
  win.setMenuBarVisibility(false);
  win.setMenu(null);

  win.once('ready-to-show', () => win.show());

  // Any http(s) link goes to the real browser, never inside the game window.
  const external = (url) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  };
  win.webContents.setWindowOpenHandler(({ url }) => external(url));
  win.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/i.test(url) && !url.startsWith(DEV_URL)) { e.preventDefault(); shell.openExternal(url); }
  });

  win.loadURL(isDev ? DEV_URL : 'app://ice-hockey/index.html');
  if (process.env.IH_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

// One instance. A second launch focuses the window that is already open.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    if (!isDev) { registerAppProtocol(); applyCsp(); }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
