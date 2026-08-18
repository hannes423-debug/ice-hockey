# Ice Hockey on Xbox — Developer Mode test target

A thin UWP host that shows the existing web game on an Xbox in Developer Mode.
It is **not** a port, a fork, or a Store build. The game stays HTML + Three.js
and stays in one place; this directory only adds a fourth way to open it.

```
                    index.html + game.html + Three.js
                                  |
        +-----------------+-------+--------+------------------+
        |                 |                |                  |
     browser          Electron          Xbox UWP           (future)
        |                 |                |
   GitHub Pages      AppImage        this directory
                                          |
                              Windows.UI.Xaml.Controls.WebView
                                          |
                        REMOTE: https://…github.io/ice-hockey/
                        LOCAL:  ms-appx-web:///GameLocal/index.html
```

---

## 1. What you need

| | |
|---|---|
| **Windows PC** | UWP cannot be built anywhere else. There is no `dotnet build` path and no Linux path — MSBuild plus the Windows 10 SDK, or nothing. |
| **Visual Studio 2019/2022** | with **Universal Windows Platform development** installed, and the **10.0.22621** SDK (or edit `TargetPlatformVersion` in the `.csproj` to an SDK you have). |
| **An Xbox in Developer Mode** | Microsoft Store → *Dev Mode Activation* app, then activate at <https://partner.microsoft.com/xboxconfig/devices>. Free, and reversible. |
| **Both on the same network** | Deployment is over the LAN. |

The console's **Xbox Device Portal** (Dev Home → Remote Access, note the IP and
the pairing PIN) is used for sideloading, for the file browser, and for reading
crash dumps.

---

## 2. Build and deploy

```
xbox\IceHockeyXbox.sln            ← open this in Visual Studio
```

1. **Set the target.** Configuration `Debug`, platform **x64**. Xbox is x64 only,
   which is why the project offers nothing else — a UWP project that lets you
   pick a platform the console cannot run is how you get a package that builds
   happily and then refuses to deploy.
2. **Make a signing certificate.** Double-click `Package.appxmanifest` →
   *Packaging* → *Choose Certificate…* → *Create…*. A self-signed one is all a
   Developer Mode console wants. It is `.gitignore`d — a signing key never goes
   in a public repository.
3. **Point Visual Studio at the console.** Debug target dropdown → **Remote
   Machine** → enter the console's IP → Authentication **Universal (Unencrypted
   Protocol)**. First deploy asks for the Device Portal PIN.
4. **F5.** It builds, deploys, launches, and attaches the debugger.

Afterwards the app is on the console's home screen and launches on its own.

**Or sideload without Visual Studio:** *Build → Deploy Solution* produces
`xbox\IceHockeyXbox\AppPackages\…\*.appx`; upload it in Device Portal → *Home →
Add* → *Choose File*.

### Before building, if you want LOCAL mode to have anything in it

```bash
npm run xbox:sync      # or: xbox/tools/sync-local.sh
```

Copies the published site into `xbox/IceHockeyXbox/GameLocal/` and md5-verifies
every file. It reads its file list from `package.json`'s `build.files` — the
same list electron-builder uses — so the desktop app and the Xbox package can
never disagree about what the game consists of. The folder is `.gitignore`d: it
is a copy of files already tracked at the repo root, not a second source.

`xbox/tools/sync-local.sh check` reports without copying and exits non-zero if
anything is stale, so it can gate a build.

Regenerate the tile art after changing `build/icon.png` with `npm run xbox:assets`.

---

## 3. REMOTE and LOCAL

One file, `xbox/IceHockeyXbox/config.json`:

```json
{
  "mode": "REMOTE",
  "remoteUrl": "https://hannes423-debug.github.io/ice-hockey/",
  "localUrl": "ms-appx-web:///GameLocal/index.html",
  "cacheBust": true
}
```

**Three ways to change it, in increasing order of convenience:**

| | How | Needs a rebuild? |
|---|---|---|
| Edit `config.json` in the repo | the committed default | yes |
| Drop a `config.json` into the app's **LocalState** folder (Device Portal → *File explorer* → *LocalAppData* → the app → *LocalState*) | overrides the packaged one at next launch | no |
| Hold **LB + RB + View** for ~1 second | flips REMOTE↔LOCAL and reloads, for this run | no |

The pad combo is polled in C# rather than handled in the page on purpose: a
remote build that fails to load cannot offer you a button to escape itself.
Reading the pad in the host does not take it away from the game — both are
readers of the same state. On a PC, **F5** reloads and **F6** toggles.

### The development loop this exists for

```
edit  →  test in the browser  →  git push  →  GitHub Pages rebuilds
      →  LB+RB+View on the console (or just relaunch)  →  the new build is on the TV
```

The Xbox package only has to be rebuilt when something in **this directory**
changes. JavaScript, HTML, CSS, Three.js and every asset come down the wire.

### Caching

`cacheBust` appends `?ih=<unix time>` to the remote URL at each load, so the
HTML is always fresh. A reload additionally calls `WebView.ClearTemporaryWebDataAsync()`,
which drops the cached sub-resources — needed because `style.css`, `script.js`
and `menu-player.js` do not have hashed filenames and GitHub Pages serves them
with a long `max-age`. None of this touches the public site: the parameter only
ever exists on this app's own requests.

---

## 4. Controller

**No Xbox-specific input code exists, and none is needed.** The game already
polls `navigator.getGamepads()` every frame — in `script.js` for the menu and
in `game.html` for play, including a `mapping !== 'standard'` branch — and that
API is what the WebView exposes. The controls are the ones you already tuned:
left stick skating, right stick skill stick / aim, triggers, bumpers, face
buttons, D-pad, the EA Hybrid and EA Skill Stick presets, all of it.

The one line that makes this work is in `App.xaml.cs`:

```csharp
RequiresPointerMode = ApplicationRequiresPointerMode.WhenRequested;
```

Without it a UWP app on Xbox runs in **mouse mode** — the left stick drives an
on-screen cursor owned by XAML and the D-pad drives XY-focus navigation — and
both consume the pad before the page ever sees it. The symptom is precise and
misleading: the game runs, and every stick reads dead centre.

**Verify on hardware with `xbox/probe.html`** (see §7). It shows every connected
pad live: `id`, `mapping`, axis values and which button indices are down. If
`mapping` does not say `standard`, button indices will not line up and *that* is
the moment to write an Xbox adapter — not before.

---

## 5. Multiplayer — read this before planning any

**This game has no networking of any kind.** Measured, not assumed:

```
$ grep -c "WebSocket\|RTCPeerConnection\|new EventSource" game.html
0
```

No WebSocket, no WebRTC, no `fetch`, no `XMLHttpRequest`, no server anywhere in
the repository. VS mode is *same-console* play: one person controlling a whole
five-man side, switching between skaters. It is not networked and never was.

So there is nothing for the Xbox to connect to, no protocol to reuse, and no
LAN or internet match to test. Xbox↔PC and Xbox↔Xbox play are not blocked by
anything in this host — they are blocked by the game not having multiplayer.

**What the network capabilities in the manifest are actually for:**

| Capability | Why it is there |
|---|---|
| `internetClient` | REMOTE mode fetching the game over HTTPS from GitHub Pages. Without it the host cannot load anything. |
| `privateNetworkClientServer` | Pointing `remoteUrl` at a dev server on your own LAN — `npm run dev` on the PC, then `"remoteUrl": "http://192.168.1.x:8000/"` — so a change reaches the TV without a push and a Pages rebuild. |

`internetClientServer` is deliberately **not** requested. It grants *inbound*
connections from the internet, which nothing here accepts. If peer-to-peer
multiplayer is ever built on WebRTC, that is when to add it — and not before,
because a capability you cannot justify is one a reviewer will ask about and
you will not be able to answer.

When multiplayer does get built, build it once, in the shared web code, and all
four targets get it at the same time. That is the entire point of this
architecture.

---

## 6. What changed outside this directory

Four small changes, and one new shared file. Nothing in the game's logic,
rendering, physics, input or UI was touched.

| File | Change | Why |
|---|---|---|
| **`compat/es2019.js`** | new | The Xbox WebView is EdgeHTML, which has no `Array.prototype.flatMap`. See below. |
| `index.html`, `game/ice_hockey.html`, `customizer/ice-hockey-customize.html` | one `<script>` tag, first | Loads the shim. EdgeHTML's WebView has no `AddScriptToExecuteOnDocumentCreated` — that is a WebView2 API — so the host **cannot** inject anything ahead of the page's own inline scripts. It has to be in the page. |
| `game/make25d.py` | one more `patch()` | Rewrites the shim's path from `../compat/` to `compat/` in the published copy, exactly as it already does for three.js, and dies loudly if the tag ever moves. |
| `deploy.sh` | `compat` added to `DEPLOY_ONLY` | So the shim is published and accounted for rather than silently absent. |
| `package.json` | `compat/**/*` added to `build.files`; `xbox:sync`, `xbox:assets` scripts | **The AppImage would have shipped a 404 without this** — the pages now reference a file electron-builder did not know about. |
| `tools/electron_smoke.js` | one assertion | The shim does nothing in Chromium, so nothing *looks* different when it fails to ship. This is the only thing that would catch it before an AppImage reached anyone. |

### Why the shim, exactly

`xbox/tools/edgehtml_sim.sh` runs the real published `game.html` twice on an
engine with `flatMap` deleted — once without the shim, once with — and reports
what actually happens rather than what ought to:

```
-- A: shim ABSENT  (what the Xbox would have got)
   errors      Uncaught TypeError: groups.flatMap is not a function @14283
   startMenu   built
-- B: shim PRESENT (what the Xbox gets now)
   errors      none
   startMenu   built
```

Note that **A still boots**. The throw is at the tail of the 10,783-line main
script, so the game comes up, the rink renders and it plays — and the last 347
lines never run, which means the in-game tuning panel is never built and
`applyVals(loadSaved())` never restores the player's saved settings. On a TV,
with no F12, that presents as "the Xbox one keeps forgetting my settings" and
would have cost an evening to find. Fifteen lines, behind feature tests, doing
nothing at all on every other target.

---

## 7. Measuring the console instead of guessing at it

Everything anyone can tell you about "what the Xbox WebView supports" is a claim
about EdgeHTML in general, on some firmware, from some year. `xbox/probe.html`
is the only statement about *your* console worth having. Point the host at it:

```json
"remoteUrl": "https://hannes423-debug.github.io/ice-hockey/xbox/probe.html"
```

It reports, in TV-sized text: the user agent; the window size (which is how you
confirm the layout-scaling opt-out worked — see below); WebGL context version,
renderer string, limits and the specific extensions three.js r128 wants; a long
list of JS features including syntax-level ones; `CSS.supports` for everything
the menu leans on, plus a *measured* flex-gap test because `CSS.supports` can
report a property the engine parses and then ignores; localStorage and origin;
a live gamepad readout; and a frame-rate ceiling.

### The two things most likely to be wrong, and neither is fatal

**CSS `clamp()` — the site uses 129 of them.** EdgeHTML predates `clamp()`,
`min()` and `max()` in CSS. Where it does not parse the declaration it drops it
and falls back to whatever came before, so text and panels get the wrong size
rather than disappearing.

**Flexbox `gap` — the site uses 35.** EdgeHTML implemented `gap` for Grid only.
Flex containers lose their spacing and items sit flush against each other.

Both affect the menus and HUD, not the rink: the game itself is a WebGL canvas
and does not care. Read the probe first. If a row comes back red, fix it in
`style.css` with a fallback declaration *before* the modern one — the standard
cascade trick, which costs modern browsers nothing:

```css
.row { margin: 0 12px; }   /* EdgeHTML keeps this */
.row { margin: 0; gap: 24px; }
```

Do not start rewriting the CSS on the strength of this paragraph. Measure.

### Two Xbox-only lines in `App.xaml.cs` worth knowing about

```csharp
view.SetDesiredBoundsMode(ApplicationViewBoundsMode.UseCoreWindow);
ApplicationViewScaling.TrySetDisableLayoutScaling(true);
```

The first claims the whole panel instead of sitting inside the TV safe-area
letterbox. The second opts out of Xbox's 2× UWP layout scaling — correct for a
XAML app read from across a room, and a straight halving of a Three.js canvas's
render resolution that the game never asked for. Without it the probe reports a
window of roughly 1280×720 on a 1080p console.

---

## 8. Debugging

**JavaScript in the WebView.** Visual Studio attaches a real script debugger:
*Debug → Attach to Process* → connection type **Universal (Unencrypted
Protocol)**, the console's IP, then pick **Script** for `IceHockeyXbox.exe`.
Breakpoints, the console and the DOM explorer all work. This is the EdgeHTML
debugger, not Chrome DevTools — WebView2 tooling does not apply.

**The host itself.** F5 from Visual Studio is a normal managed debug session;
`System.Diagnostics.Debug.WriteLine` output (every navigation, every cache
clear, every unhandled exception) lands in the Output window.

**Without a PC.** The status card is the fallback: on any failed navigation it
puts the error status, the URL, the mode, where the config came from, and the
pad combo on screen in large type. A console showing a black screen and nothing
else is the thing this host must never do.

**Crash dumps.** Device Portal → *Crash dumps*.

**Performance.** The probe's frame-rate row is the ceiling with nothing drawn.
If the game is well under it, that is the renderer, not the host.

---

## 9. What still has to happen on real hardware

Everything below needs a console and a TV. None of it can be checked on Linux,
and none of it has been:

- [ ] the package builds and deploys (needs Windows + the SDK — **not yet built once**)
- [ ] REMOTE mode reaches GitHub Pages and the game loads
- [ ] LOCAL mode loads the bundled copy with the network off
- [ ] `RequiresPointerMode` really does hand the pad to the page
- [ ] `mapping === "standard"` on an Xbox pad, and every button index lines up
- [ ] the layout-scaling opt-out gives a full-resolution window
- [ ] WebGL: does three.js r128 get a context, and at what frame rate
- [ ] `clamp()` and flex `gap` — how badly is the menu affected
- [ ] the LB+RB+View combo does not collide with anything in play
- [ ] localStorage persists across app restarts, and the menu→game handoff works

**What *has* been verified here:** the game and the Locker Room still load with
no off-box requests and no failed resources; the Electron app still passes all
17 of its smoke assertions including a new one for the shim; and the shim
demonstrably fixes the one break an ES2018 engine would have caused.
