/* ih25_post.js — loaded AFTER the game script.
   Adds: the rectified photo as the ice skin, the locked camera rig, and the
   puck's own collision against skaters and goal posts. */
(function () {
  var IH25 = window.IH25;
  function g(name) { try { return eval(name); } catch (e) { return undefined; } }

  IH25.bodyRadius = 0.34;   // m, skater collision cylinder
  IH25.bodyHeight = 1.75;   // m, above this the puck flies over
  IH25.bodyRestitution = 0.35;
  IH25.postRestitution = 0.55;
  IH25.postRadius = 0.05;

  IH25.zoom = 0;            // 0 = whole rink (the photo's framing), 1 = tight
  IH25.maskOpacity = 1;
  var mask = null, lastT = 0, wired = false;

  /* ---------------------------------------------------------------- mask
     The photo is a PERSPECTIVE render, so it cannot simply be pasted on the
     ice — it is rectified offline (rectify.py) through the fitted camera
     into a true top-down texture. That is what makes it register under ANY
     camera: the picture becomes the ice surface itself rather than a
     screen-space overlay that only lines up at one zoom. Because the mask
     is opaque over the whole ice footprint it also covers the build's own
     painted lines, so the photo is authoritative for every marking; the 3D
     line positions still exist underneath for gameplay (zones, offside). */
  function buildMask(scene, THREE) {
    var tex = new THREE.TextureLoader().load(window.IH25_MASK_URL, function () {
      if (g('renderer')) g('renderer').render(scene, g('camera'));
    });
    tex.flipY = false;                       // row 0 of the texture is the +Z (far) end
    /* Only declare the texture sRGB if the RENDERER re-encodes on output.
       This build is three r128 with a default WebGLRenderer, i.e.
       outputEncoding = LinearEncoding — no colour management at all. Marking
       the texture sRGB there decodes it to linear and nothing ever encodes it
       back, so the whole sheet renders about 15 % dark and the mask's own void
       corners came out (1,2,4) against a (10,20,32) background: a black gash
       around the rink that looks like a geometry bug and is a gamma bug. Every
       other material in the build is a raw hex colour that passes through
       untouched, so passing the photo through untouched is also what MATCHES. */
    var R = g('renderer');
    var srgbOut = !!R && (
      (THREE.SRGBColorSpace && R.outputColorSpace === THREE.SRGBColorSpace) ||
      (THREE.sRGBEncoding !== undefined && R.outputEncoding === THREE.sRGBEncoding));
    if (srgbOut) {
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      else tex.encoding = THREE.sRGBEncoding;
    }
    IH25._maskSRGB = srgbOut;
    tex.anisotropy = 8;
    var m = new THREE.Mesh(
      new THREE.PlaneGeometry(IH25.halfW * 2, IH25.halfD * 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 1, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.014, 0);
    m.renderOrder = 2;
    scene.add(m);
    return m;
  }

  /* ------------------------------------------------------------ the board ring
     The picture hides the geometry as a TEXTURE ON that geometry, not as a
     poster in front of it. That is the difference between this and the
     screen-locked backdrop it replaces: a poster is only true from one camera,
     so it had to be dropped the moment you zoomed, and the picture vanished
     exactly when you leaned in to look at it. A texture is true from every
     camera. The 3-D arena underneath stays where it is and keeps doing
     collision; it is simply never the thing you see.

     The ice half of this is rink_mask.png on the ice plane, which already
     worked that way. This is the other half: one ring of quads standing on the
     rink outline, carrying the boards and the glass.

     UV: u runs once round the perimeter, v is 0 at the top of the glass and 1
     at the ice, which is exactly how boards.py lays the strip out. */
  var ring = null;
  function buildBoardRing(scene, THREE) {
    var B = window.IH25_BOARDS;
    if (!B || !window.IH25_BOARDS_URL) return null;
    var hw = IH25.halfW, hd = IH25.halfD, cr = IH25.corner, top = B.glass_top;

    // the rink outline, anticlockwise, as a run of points with arc length
    var pts = [], i, a, N = 24;
    function push(x, z) { pts.push([x, z]); }
    push(hw, -(hd - cr));
    push(hw, hd - cr);
    for (i = 1; i <= N; i++) { a = i / N * Math.PI / 2; push(hw - cr + cr * Math.cos(a), hd - cr + cr * Math.sin(a)); }
    push(-(hw - cr), hd);
    for (i = 1; i <= N; i++) { a = Math.PI / 2 + i / N * Math.PI / 2; push(-(hw - cr) + cr * Math.cos(a), hd - cr + cr * Math.sin(a)); }
    push(-hw, -(hd - cr));
    for (i = 1; i <= N; i++) { a = Math.PI + i / N * Math.PI / 2; push(-(hw - cr) + cr * Math.cos(a), -(hd - cr) + cr * Math.sin(a)); }
    push(hw - cr, -hd);
    for (i = 1; i <= N; i++) { a = 1.5 * Math.PI + i / N * Math.PI / 2; push(hw - cr + cr * Math.cos(a), -(hd - cr) + cr * Math.sin(a)); }

    var arc = [0], total = 0;
    for (i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      arc.push(total);
    }
    var pos = [], uv = [], idx = [];
    for (i = 0; i < pts.length; i++) {
      var u = arc[i] / total;
      pos.push(pts[i][0], 0, pts[i][1], pts[i][0], top, pts[i][1]);
      /* Row 0 of the strip is the GLASS TOP (boards.py lays it out that way and
         flipY is off), so the ice vertex takes v=1 and the top vertex v=0.
         Getting this the natural way round hangs the kickplate in the sky. */
      uv.push(u, 1, u, 0);
    }
    for (i = 0; i < pts.length - 1; i++) {
      var b = i * 2;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    var gm = new THREE.BufferGeometry();
    gm.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gm.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    gm.setIndex(idx);
    gm.computeVertexNormals();

    var tex = new THREE.TextureLoader().load(window.IH25_BOARDS_URL);
    tex.wrapS = THREE.RepeatWrapping;
    tex.flipY = false;                     // row 0 of the strip is the glass top
    tex.anisotropy = 8;
    var m = new THREE.Mesh(gm, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false
    }));
    m.renderOrder = 3;                     // over the ice mask, under the actors
    scene.add(m);
    return m;
  }

  var arenaShown = true;
  function setArenaVisible(scene, vis) {
    if (arenaShown === vis) return;        // called every frame; traverse only on change
    arenaShown = vis;
    scene.traverse(function (o) {
      if (o.userData && o.userData.ih25Arena) o.visible = vis;
    });
  }

  /* ------------------------------------------------------ the nets from above
     Three separate things were wrong, and only the first was the one I
     originally reported.

     1. THERE IS NO NEAR GOAL AT ALL outside a match. buildGoalB() is called
        only from startMatch(), so in free skate the -Z end has a crease and
        nothing standing on it. What looked like a faint near net in the old
        build was the REFERENCE PHOTO's painted net in the mask, not geometry.
        A locked camera that shows the whole sheet has to have both. Scoring at
        goal B stays gated on GAME.mode === 'match', and this build's own
        puck-vs-post collision was already two-ended, so building it changes
        what you SEE, not what scores.
     2. The net planes are white 0xe8f4ff at 0.22 opacity. Against the dark
        background beyond the FAR boards that reads as a net; against the
        bright white ice behind the NEAR one it is invisible. Darkened.
     3. There is no TOP panel on either goal. Looking down from a top-down
        camera you were looking through the open top of the goal at the ice
        underneath. A net seen from above is mostly its roof, so the roof has
        to exist — plus a darkened pocket, because the roof alone still lets
        ice through and the goal reads as a smudge rather than a hole. */
  var netDone = {};
  function fixNets(scene, THREE) {
    var made = 0;
    if (!g('GOAL_B') && typeof g('buildGoalB') === 'function') {
      try { g('buildGoalB')(); made++; } catch (e) { /* match not ready yet */ }
    }
    var MA = g('MATCH');
    if (MA && MA.goalBGroup) MA.goalBGroup.visible = true;   // matchTeardown hides it
    [g('GOAL_ZONE'), g('GOAL_B')].forEach(function (G, i) {
      if (!G || netDone[i]) return;            // idempotent: the 1 Hz sweep
      netDone[i] = true;                       // must not stack roofs
      var sz = i ? -1 : 1;                     // GOAL_B is the -Z goal
      var depth = IH25.goalDepth, hw = G.halfW, h = G.height, z = G.z;
      var mat = new THREE.MeshBasicMaterial({
        color: 0x8fa8c4, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false
      });
      // roof: crossbar back to the top of the back panel
      var roof = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, depth), mat);
      roof.rotation.x = -Math.PI / 2;
      roof.position.set(0, h, z + sz * depth / 2);
      scene.add(roof);
      /* pocket: the ice inside a goal is in the net's shadow and reads as a
         dark mouth from above. Without it the roof alone still lets bright ice
         through and the goal reads as a smudge rather than a hole. Sits above
         the mask (y 0.014) but below the crossbar. */
      var pocket = new THREE.Mesh(
        new THREE.PlaneGeometry(hw * 2, depth),
        new THREE.MeshBasicMaterial({ color: 0x39506b, transparent: true,
                                      opacity: 0.42, depthWrite: false }));
      pocket.rotation.x = -Math.PI / 2;
      pocket.position.set(0, 0.02, z + sz * depth / 2);
      pocket.renderOrder = 3;
      scene.add(pocket);
      made += 2;
      IH25._netParts = (IH25._netParts || []).concat([roof, pocket]);
    });
    // restyle the existing net planes wherever they are in the graph
    scene.traverse(function (o) {
      if (!o.isMesh || !o.material || !o.material.color) return;
      if (o.material.color.getHex() === 0xe8f4ff && o.material.opacity === 0.22) {
        o.material.color.setHex(0x8fa8c4);
        o.material.opacity = 0.5;
        o.material.depthWrite = false;
        o.material.needsUpdate = true;
      }
    });
    return made;
  }

  /* The build paints its own lines/circles/dots/creases on the ice at
     y = 0.010..0.012. They are drawn AFTER the mask (transparent sorting)
     and would show through it as a second set of markings. The mask carries
     the regulation set (drawn analytically by rectify.py from nhl_spec.py),
     so the painted set is hidden — the positions still exist in CONFIG and
     drive zones/offside, they just are not drawn. puck.shadow lives in the
     same band and must survive (it is the puck's exact ground projection). */
  function hidePaintedMarkings() {
    var S = g('scene'), pk = g('puck'), n = 0;
    if (!S) return 0;
    S.traverse(function (o) {
      if (!o.isMesh || o === mask) return;
      if (pk && (o === pk.shadow || o === pk.mesh)) return;
      var y = o.position.y;
      if (y >= 0.008 && y <= 0.0135) { o.visible = false; n++; }
    });
    return n;
  }

  /* ---------------------------------------------------- puck indicator
     From 112 m the puck is about two pixels of dark grey on white ice. This
     is a PRESENTATION layer only — nothing gameplay-side reads it, and the
     puck mesh keeps its true 0.11 m radius so the sim stays honest about how
     big the puck is. The indicator does the seeing for you:

       glow   soft amber pool, dark at the rim so it separates from white ice
       ring   crisp ring + a dark outer ring for definition at any zoom
       dot    solid centre marking the puck's exact ground point
       stem   vertical beacon when the puck is in the air, so a flipped puck
              still reads as "over there and up" rather than vanishing

     Loose pucks pulse and run bright amber; a carried puck sits calm and
     dimmer, so "where is the loose puck" is answerable at a glance. */
  var ind = null;
  function buildIndicator(scene, THREE) {
    var c = document.createElement('canvas'); c.width = c.height = 256;
    var x = c.getContext('2d');
    var rg = x.createRadialGradient(128, 128, 6, 128, 128, 128);
    /* DONUT, not a disc. First pass filled the centre at 0.95 alpha and the
       puck simply vanished inside its own indicator — you could see where it
       was but not what it was doing. Centre stays clear so the puck token
       below reads through it. */
    rg.addColorStop(0.00, 'rgba(255,190,60,0.00)');
    rg.addColorStop(0.34, 'rgba(255,190,60,0.10)');
    rg.addColorStop(0.55, 'rgba(255,168,40,0.46)');
    rg.addColorStop(0.72, 'rgba(210,104,0,0.34)');
    rg.addColorStop(0.90, 'rgba(60,22,0,0.14)');
    rg.addColorStop(1.00, 'rgba(0,0,0,0)');
    x.fillStyle = rg; x.fillRect(0, 0, 256, 256);
    var tex = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

    var g0 = new THREE.Group(), flat = -Math.PI / 2;
    function add(mesh, order) {
      mesh.rotation.x = flat; mesh.renderOrder = order;
      mesh.material.depthWrite = false; mesh.material.depthTest = false;
      g0.add(mesh); return mesh;
    }
    var glow = add(new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.9),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95 })), 3);
    var dark = add(new THREE.Mesh(new THREE.RingGeometry(0.80, 0.90, 48),
      new THREE.MeshBasicMaterial({ color: 0x2a1400, transparent: true, opacity: 0.55 })), 4);
    var ring = add(new THREE.Mesh(new THREE.RingGeometry(0.62, 0.79, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.95 })), 5);
    /* the puck TOKEN: a dark disc with a bright rim, ~4x the puck's radius.
       Reads as a puck rather than as a blob of light, and it is the thing
       that is actually legible at 112 m. */
    var core = add(new THREE.Mesh(new THREE.CircleGeometry(0.30, 28),
      new THREE.MeshBasicMaterial({ color: 0x14161c, transparent: true, opacity: 0.92 })), 6);
    var rim = add(new THREE.Mesh(new THREE.RingGeometry(0.30, 0.40, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 1 })), 7);
    var dot = rim;
    g0.position.y = 0.020;
    scene.add(g0);

    /* Height cue. A vertical beacon was the obvious idea and it does not
       work: from 65 deg of pitch a vertical line foreshortens to a couple of
       pixels, so an airborne puck looked identical to one on the ice. This
       ring expands with air height instead, which reads from straight above. */
    var stem = add(new THREE.Mesh(new THREE.RingGeometry(0.94, 1.04, 44),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.7 })), 8);
    return { g: g0, glow: glow, ring: ring, dark: dark, dot: dot, core: core, stem: stem };
  }

  function updateIndicator(dist) {
    var pk = g('puck');
    if (!ind || !pk) return;
    var show = !pk.outOfPlay;
    ind.g.visible = show;
    if (!show) { ind.stem.visible = false; return; }

    var carried = !!pk.possessed;
    var f = g('getAICarrier'); if (typeof f === 'function' && f()) carried = true;
    var t = performance.now() / 1000;
    // pulse only when loose — that is when you need to find it
    var pulse = carried ? 1 : 1 + 0.10 * Math.sin(t * 5.0);
    /* hold a roughly constant SCREEN size: shrink with zoom so it never
       swamps the skater up close, but stay big enough to spot at full out */
    var k = Math.max(0.42, Math.min(1, dist / (IH25._fit || dist))) * pulse;
    ind.g.scale.set(k, k, k);
    ind.g.position.set(pk.pos.x, 0.020, pk.pos.z);

    ind.ring.material.color.setHex(carried ? 0xff8a3a : 0xffc23a);
    ind.ring.material.opacity = carried ? 0.62 : 0.98;
    ind.glow.material.opacity = carried ? 0.45 : 0.95;
    ind.dark.material.opacity = carried ? 0.34 : 0.58;
    ind.dot.material.opacity = carried ? 0.75 : 1;
    ind.core.material.opacity = carried ? 0.80 : 0.92;

    var air = Math.max(0, pk.pos.y - 0.11);
    if (air > 0.08) {
      var e = 1 + Math.min(2.2, air * 0.85);
      ind.stem.visible = true;
      ind.stem.scale.set(e, e, 1);
      ind.stem.material.opacity = Math.max(0.12, 0.75 - air * 0.16);
    } else ind.stem.visible = false;
  }

  /* ------------------------------------------------------- locked camera
     Angle is LOCKED to the photo's: pitch fixed, yaw 0, no roll. Only the
     distance moves, so the view is always the same shot. Because the rig
     places the camera at exactly L + (0,sin p,-cos p)*dist, lookAt(L) can
     only ever reproduce that pitch — the lock is structural, not clamped. */
  /* Called from the FIRST LINE of tick(), not from the render wrapper.
     That ordering is the whole point: the build unprojects the aim ray with
     setFromCamera(ndc, camera) and anchors DOM HUD with projectToScreen(),
     both mid-frame. Moving the camera afterwards (which is what the render
     wrapper used to do) meant the shot was aimed through the OLD chase
     camera while the player was looking through this one — the aim and the
     puck landed somewhere else entirely. Set once, at the top of the frame,
     so aim, HUD and render all agree. */
  function applyCam() {
    var cam = g('camera'), P = g('player'), pk = g('puck'), C = g('CONFIG');
    if (!cam || !P) return;
    var p = IH25.camPitchDeg * Math.PI / 180;
    var z = IH25.zoom;
    /* zoom 0 IS the photo's own rig — its fitted distance, not a framing
       heuristic — so the locked view reproduces the reference picture rather
       than merely resembling it. The old heuristic solved for a distance that
       fits halfD into the vertical FOV, which ignores that the view is oblique
       and put the camera in a different place than the photo's camera was.
       Only widen if the window is so tall and narrow that the rink's WIDTH
       would not fit; the photo is portrait and a game window rarely is. */
    var fit = IH25.camDist;
    var need = (IH25.halfW * 1.06) / Math.tan(IH25.camFovDeg * Math.PI / 360 * (cam.aspect || 1.6));
    if (need > fit) fit = need;
    var dist = fit + (fit * 0.20 - fit) * z;
    IH25._dist = dist; IH25._fit = fit;   // presentation layers scale off this
    // focus drifts from centre ice out to the player as you zoom in
    var src = (g('cameraFocus') === 'puck' && pk) ? pk.pos : P.pos;
    var lx = src.x * z, lz = src.z * z;
    var mx = IH25.halfW * 0.9, mz = IH25.halfD * 0.9;
    lx = Math.max(-mx, Math.min(mx, lx)); lz = Math.max(-mz, Math.min(mz, lz));
    /* The build's fog (45..110 m) and far plane (220) were tuned for a 14 m
       chase camera. This rig sits ~112 m up, which put the ENTIRE rink past
       fogFar — the sheet rendered as flat dark blue and read exactly like a
       broken build. Both now scale with the rig's own distance, so the view
       is clear at every zoom and still keeps a little depth falloff up close. */
    var far = dist * 2.6 + IH25.halfD * 2;
    if (cam.fov !== IH25.camFovDeg || cam.far !== far) {
      cam.fov = IH25.camFovDeg; cam.far = far; cam.updateProjectionMatrix();
    }
    var S = g('scene');
    if (S && S.fog) { S.fog.near = dist * 1.40; S.fog.far = dist * 3.50; }
    cam.position.set(lx, Math.sin(p) * dist, lz - Math.cos(p) * dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(lx, 0, lz);
  }

  /* -------------------------------------------------- the puck's collision
     A free puck was already solid against boards, glass and the ice. It now
     also collides with skater bodies and with the goal posts, as a real
     cylinder-vs-cylinder resolve against the OTHER body's velocity (so a
     puck fired into a moving skater carries his momentum away, and a puck
     rung off the post comes back out). Any such bump also marks the puck
     contested, which is what lets a carry actually be broken up. */
  function puckCollide() {
    var pk = g('puck'), C = g('CONFIG');
    if (!pk || !C || pk.possessed || pk.outOfPlay) return;
    var f = g('getAICarrier'); if (typeof f === 'function' && f()) return;
    var r = C.puckRadius, gk = g('goalie');

    var sk = IH25.skaters(), i;
    for (i = 0; i < sk.length; i++) {
      var e = sk[i];
      if (!e || !e.pos || e === gk) continue;          // goalie has its own save logic
      if (pk.pos.y > IH25.bodyHeight) continue;
      var R = IH25.bodyRadius + r;
      var dx = pk.pos.x - e.pos.x, dz = pk.pos.z - e.pos.z, d2 = dx * dx + dz * dz;
      if (d2 > R * R || d2 < 1e-9) continue;
      var d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
      pk.pos.x = e.pos.x + nx * R; pk.pos.z = e.pos.z + nz * R;
      var evx = e.vel ? e.vel.x : 0, evz = e.vel ? e.vel.z : 0;
      var rvn = (pk.vel.x - evx) * nx + (pk.vel.z - evz) * nz;
      if (rvn < 0) {
        var j = -(1 + IH25.bodyRestitution) * rvn;
        pk.vel.x += j * nx; pk.vel.z += j * nz;
      }
      IH25.bump();
    }

    if (pk.pos.y < IH25.goalHeight) {
      var sides = [-1, 1], xs = [-IH25.goalHalfW, IH25.goalHalfW], a, b;
      for (a = 0; a < 2; a++) for (b = 0; b < 2; b++) {
        var px = xs[b], pz = sides[a] * IH25.goalZ, PR = IH25.postRadius + r;
        var qx = pk.pos.x - px, qz = pk.pos.z - pz, q2 = qx * qx + qz * qz;
        if (q2 > PR * PR || q2 < 1e-9) continue;
        var q = Math.sqrt(q2), ux = qx / q, uz = qz / q;
        pk.pos.x = px + ux * PR; pk.pos.z = pz + uz * PR;
        var vn = pk.vel.x * ux + pk.vel.z * uz;
        if (vn < 0) {
          var k = -(1 + IH25.postRestitution) * vn;
          pk.vel.x += k * ux; pk.vel.z += k * uz;
        }
        IH25.bump();
        if (typeof flashMsg === 'function') flashMsg('POST!');
      }
    }
  }

  /* ------------------------------------------------------------------ HUD */
  function hud() {
    var el = document.getElementById('ih25hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ih25hud';
      el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:11px/1.5 monospace;' +
        'color:#9fe8ff;background:rgba(6,10,18,.72);padding:6px 9px;border-radius:5px;' +
        'pointer-events:none;white-space:pre';
      document.body.appendChild(el);
    }
    var pk = g('puck');
    el.textContent =
      '2.5D  pitch ' + IH25.camPitchDeg.toFixed(1) + '° LOCKED   zoom ' + IH25.zoom.toFixed(2) + ' (wheel)\n' +
'mask ' + IH25.maskOpacity.toFixed(2) + ' (M)   rink ' + (IH25.halfW * 2).toFixed(1) + ' x ' + (IH25.halfD * 2).toFixed(1) + ' m\n' +
      'puck ' + (pk && pk.possessed ? 'CARRIED ctrl ' + pk.control.toFixed(2) : 'loose') +
      '   contested ' + (IH25.contested() ? 'YES' : 'no');
  }

  function wire() {
    if (wired) return;
    var R = g('renderer'), S = g('scene'), THREE = g('THREE');
    if (!R || !S || !THREE) return;
    wired = true;
    mask = buildMask(S, THREE);
    ind = buildIndicator(S, THREE);

    /* nets/creases for a match are built later, so re-sweep at 1 Hz rather
       than once — a few-hundred-object traverse per second is free. The net
       fix rides the same sweep for the same reason: GOAL_B does not exist
       until a match starts, so a one-shot call fixes the far goal only, which
       is exactly the near-goal-is-invisible bug it is there to fix. */
    hidePaintedMarkings();
    fixNets(S, THREE);
    ring = buildBoardRing(S, THREE);
    /* The arena is hidden ONCE and stays hidden. It is still there for
       collision, scoring and every zone test; it is just never drawn. */
    setArenaVisible(S, false);
    setInterval(function () {
      hidePaintedMarkings();
      fixNets(S, THREE);
    }, 1000);

    var inner = R.render.bind(R);
    R.render = function (sc, cam) {
      var now = performance.now(), dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
      lastT = now;
      if (IH25.contactT > 0) IH25.contactT = Math.max(0, IH25.contactT - dt);
      if (cam === g('camera')) { puckCollide(); updateIndicator(IH25._dist || 0); }
      if (mask) mask.material.opacity = IH25.maskOpacity;
      /* M cycles the picture off to reveal the geometry under it. Nothing
         else ever does: the picture is a texture, so it is true at every
         zoom. */
      var show = IH25.maskOpacity > 0.02;
      if (ring) { ring.visible = show; ring.material.opacity = IH25.maskOpacity; }
      setArenaVisible(sc, !show);
      hud();
      return inner(sc, cam);
    };

    addEventListener('wheel', function (e) {
      IH25.zoom = Math.max(0, Math.min(1, IH25.zoom + (e.deltaY > 0 ? -0.06 : 0.06)));
    }, { passive: true });

    addEventListener('keydown', function (e) {
      if (e.code === 'KeyM') {
        IH25.maskOpacity = IH25.maskOpacity > 0.75 ? 0.5 : (IH25.maskOpacity > 0.2 ? 0 : 1);
      }
    });
    console.log('[IH25] 2.5D prototype wired — rink ' + (IH25.halfW * 2).toFixed(2) +
      ' x ' + (IH25.halfD * 2).toFixed(2) + ' m, camera pitch ' + IH25.camPitchDeg.toFixed(3) + ' deg');
  }

  IH25.applyCam = applyCam;

  var tries = 0;
  (function poll() {
    wire();
    if (!wired && tries++ < 600) setTimeout(poll, 50);
  })();
})();
