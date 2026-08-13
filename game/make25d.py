#!/usr/bin/env python3
"""Generate ice_hockey_25d.html — the 2.5D prototype — FROM the live build.

Never a hand-maintained fork: every run re-derives the prototype from
ice_hockey.html, so the prototype tracks the real game. Each patch below
asserts it matched exactly once; a miss is a hard error rather than a
silently half-applied build (a partial copy reads exactly like a broken
feature — see hoki/CLAUDE.md on deploy/).

What it changes:
  1. rink + goals resized to the reference photo (see rink_calibration.json)
  2. the photo, rectified to a top-down ice texture, laid over the ice
  3. camera angle locked to the photo's angle; zoom free
  4. the picture as TEXTURES on the ice and on a board ring, with the arena
     geometry hidden behind them (still there for collision)
  5. the puck only comes loose from possession on CONTACT
  6. the puck gets its own collision against skaters and goal posts

Usage:  python3 make25d.py
"""
import base64, json, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "ice_hockey.html"
DST = HERE / "ice_hockey_25d.html"
MASK = HERE / "rink_mask.png"
CAL = HERE / "rink_calibration.json"
BOARDS = HERE / "rink_boards.png"
BDJSON = HERE / "rink_boards.json"

G = json.load(open(CAL))["metres"]
CAM = json.load(open(CAL))["camera_metres"]

html = SRC.read_text(encoding="utf-8")
_applied = []


def patch(old, new, label):
    """Exact single-occurrence replacement, or die."""
    global html
    n = html.count(old)
    if n != 1:
        sys.exit("PATCH FAILED [%s]: matched %d times, expected 1\n  %r" % (label, n, old[:120]))
    html = html.replace(old, new, 1)
    _applied.append(label)


# ---------------------------------------------------------------- geometry
patch("roomHalfW:12.954,roomHalfD:30.48,cornerRadius:8.5344,",
      "roomHalfW:%.4f,roomHalfD:%.4f,cornerRadius:%.4f," % (G["halfW"], G["halfD"], G["corner"]),
      "CONFIG room dims")

patch("  blueLineZ:7.62,", "  blueLineZ:%.4f," % G["blueZ"], "CONFIG.blueLineZ (gameplay zones)")

patch("  const blueLineZ=25*FT;", "  const blueLineZ=IH25.blueZ;", "markings: blue line")
patch("  const goalLineZ=CONFIG.roomHalfD-11*FT;", "  const goalLineZ=IH25.goalZ;", "markings: goal line")
patch("  faceoffRing(0,0,15*FT);", "  faceoffRing(0,0,IH25.centreR);", "markings: centre circle")
patch("    faceoffRing(sx*22*FT,sz*(goalLineZ-20*FT),15*FT);}));",
      "    faceoffRing(sx*IH25.foX,sz*IH25.foZ,IH25.foR);}));", "markings: end circles")
patch("dot.position.set(sx*22*FT,0.011,sz*(blueLineZ-5*FT));",
      "dot.position.set(sx*IH25.ndX,0.011,sz*IH25.ndZ);", "markings: neutral dots")

# goals: the on-ice net and the goalie-side net builder
patch("  const halfW=3*FT,height=4*FT,postR=0.05;\n",
      "  const halfW=IH25.goalHalfW,height=IH25.goalHeight,postR=0.05;\n", "goal A: frame size")
patch("  const z=CONFIG.roomHalfD-11*FT; // same real goal-line measurement as the rink markings",
      "  const z=IH25.goalZ;", "goal A: goal-line Z")
patch("  const FT=0.3048,halfW=3*FT,height=4*FT,postR=0.05,z=-(CONFIG.roomHalfD-11*FT);",
      "  const FT=0.3048,halfW=IH25.goalHalfW,height=IH25.goalHeight,postR=0.05,z=-IH25.goalZ;",
      "goal B: frame size + Z")

# net depth: the build's net is 0.55 m deep against the rulebook's 40 in
# (1.016 m). It is also, from a top-down camera, most of what you SEE of a
# goal, so a net 46 % too shallow both breaks 1.6 and reads as a bare frame.
patch("back.position.set(0,height/2,z+0.55)", "back.position.set(0,height/2,z+IH25.goalDepth)",
      "goal A: net depth")
patch("back.position.set(0,height/2,z-0.55)", "back.position.set(0,height/2,z-IH25.goalDepth)",
      "goal B: net depth")
patch("sideL.position.set(-halfW,height/2,z+0.275)",
      "sideL.position.set(-halfW,height/2,z+IH25.goalDepth/2)", "goal A: net side L")
patch("sideR.position.set(halfW,height/2,z+0.275)",
      "sideR.position.set(halfW,height/2,z+IH25.goalDepth/2)", "goal A: net side R")
patch("sideL.position.set(-halfW,height/2,z-0.275)",
      "sideL.position.set(-halfW,height/2,z-IH25.goalDepth/2)", "goal B: net side L")
patch("sideR.position.set(halfW,height/2,z-0.275)",
      "sideR.position.set(halfW,height/2,z-IH25.goalDepth/2)", "goal B: net side R")
assert html.count("const sideGeo=new THREE.PlaneGeometry(0.55,height);") == 2
html = html.replace("const sideGeo=new THREE.PlaneGeometry(0.55,height);",
                    "const sideGeo=new THREE.PlaneGeometry(IH25.goalDepth,height);")
_applied.append("goal net side geometry (x2)")

# creases (two builders, identical text -> patch both)
assert html.count("new THREE.CircleGeometry(6*FT,32,Math.PI,Math.PI)") == 2
html = html.replace("new THREE.CircleGeometry(6*FT,32,Math.PI,Math.PI)",
                    "new THREE.CircleGeometry(IH25.creaseR,32,Math.PI,Math.PI)")
_applied.append("creases (x2)")

# ------------------------------------------------- possession needs contact
patch("    if(offLen>CONFIG.ctrlBreakDist||puck.control<CONFIG.ctrlMin){",
      "    if(IH25.contested()&&(offLen>CONFIG.ctrlBreakDist||puck.control<CONFIG.ctrlMin)){",
      "possession: break requires contact")

patch("    puck.control=clamp(puck.control+(want-puck.control)*Math.min(1,dt*gain),0,1);",
      "    puck.control=clamp(puck.control+(want-puck.control)*Math.min(1,dt*gain),0,1);\n"
      "    /* 2.5D: with nobody on you the bond may WEAKEN (the carry goes sloppy,\n"
      "       the puck lags and swings wide) but it may not BREAK — only contact\n"
      "       takes it off you. Floor it just above ctrlMin so the spring stays\n"
      "       alive and reels the puck back in. */\n"
      "    if(!IH25.contested())puck.control=Math.max(puck.control,CONFIG.ctrlMin+0.02);",
      "possession: control floor when uncontested")

# -------------------------------------------- retire the old camera rig
# The chase camera, the orbit yaw and the first-person branch all still ran
# and all still WROTE the camera, so the build was fighting the locked rig.
# Two user-visible symptoms, one cause each:
#   - "aim and puck jump to a completely different place": the aim ray is
#     unprojected mid-frame with setFromCamera(ndc, camera), and camYaw sets
#     the aim's UV frame. The camera was being moved AFTER that, and camYaw
#     was still the player's heading — so you aimed through a camera that was
#     neither where you were looking nor pointing the way the screen was.
#   - "purple bar moving randomly around the ice": the goalie stamina bar is
#     DOM, anchored by projectToScreen() through that same stale camera.
# (There is no camera SHAKE anywhere in this build — nothing to remove.)

patch("function tick(){requestAnimationFrame(tick);",
      "function tick(){requestAnimationFrame(tick);IH25.applyCam();",
      "camera: set ONCE at the top of the frame")

patch("    camTmp.set(fx,0,fz).addScaledVector(camF,-camDistNow).addScaledVector(up,camHeightNow);\n"
      "    camera.position.lerp(camTmp,CONFIG.camLerp);camera.lookAt(fx,CONFIG.camLook,fz);",
      "    /* 2.5D: chase camera retired — the rig is applied at the top of\n"
      "       tick() so aim, HUD projection and render all see one camera. */",
      "camera: retire the chase rig")

patch("  if(keys[','])camYaw+=CONFIG.orbitSpeed*dt;\n  if(keys['.'])camYaw-=CONFIG.orbitSpeed*dt;",
      "  camYaw=0; // 2.5D: the view never rotates, so the input/aim frame must not either",
      "camera: pin camYaw, drop , / . orbit")

patch("function faceAimNow(){camYaw=player.heading;}",
      "function faceAimNow(){} // 2.5D: no face cam, the angle is locked",
      "camera: drop face cam")

patch("  camYaw=player.heading;", "  camYaw=0;", "camera: boot yaw = 0")

patch("function setFP(v){CONFIG.firstPerson=v;",
      "function setFP(v){v=false;CONFIG.firstPerson=false;",
      "camera: disable first person")

patch("    gStamWrap.style.display='block';",
      "    gStamWrap.style.display='none'; // 2.5D: chase-cam HUD, unreadable from 112 m",
      "HUD: hide goalie stamina bar")

# ------------------------------------------------------------- injected code
geo_js = json.dumps({
    "halfW": G["halfW"], "halfD": G["halfD"], "corner": G["corner"],
    "blueZ": G["blueZ"], "goalZ": G["goalZ"], "foX": G["foX"], "foZ": G["foZ"],
    "foR": G["foR"], "centreR": G["centreR"], "ndX": G["ndX"], "ndZ": G["ndZ"],
    "goalHalfW": G["goalHalfW"], "goalHeight": G["goalHeight"], "creaseR": G["creaseR"],
    "goalDepth": G["goalDepth"], "corner": G["corner"],
    "camPitchDeg": CAM["pitch_deg"], "camFovDeg": CAM["vfov_deg"], "camDist": CAM["dist"],
}, indent=1)

pre = "<script>\nwindow.IH25 = " + geo_js + ";\n" + (HERE / "ih25_pre.js").read_text(encoding="utf-8") + "\n</script>\n"

patch("buildRoom();", "IH25.tagArena(buildRoom);", "arena: tag it so the backdrop can hide it")

mask_b64 = base64.b64encode(MASK.read_bytes()).decode("ascii")
bd_b64 = base64.b64encode(BOARDS.read_bytes()).decode("ascii")
post = ("<script>\nwindow.IH25_MASK_URL = 'data:image/png;base64," + mask_b64 + "';\n"
        + "window.IH25_BOARDS_URL = 'data:image/png;base64," + bd_b64 + "';\n"
        + "window.IH25_BOARDS = " + json.dumps(json.load(open(BDJSON))) + ";\n"
        + (HERE / "ih25_post.js").read_text(encoding="utf-8") + "\n</script>\n")

# IH25 must exist before the game script runs
m = re.search(r"<script\b", html)
if not m:
    sys.exit("no <script> tag found")
html = html[:m.start()] + pre + html[m.start():]
_applied.append("inject IH25 pre-script")

if html.count("</body>") != 1:
    sys.exit("expected exactly one </body>")
html = html.replace("</body>", post + "</body>", 1)
_applied.append("inject IH25 post-script")

html = html.replace("<title>Ice Hockey</title>", "<title>Ice Hockey — 2.5D prototype</title>", 1)

DST.write_text(html, encoding="utf-8")
print("wrote %s  (%.2f MB)" % (DST, DST.stat().st_size / 1e6))
print("patches applied (%d):" % len(_applied))
for a in _applied:
    print("  -", a)
