/* ih25_pre.js — loaded BEFORE the game script.
   Only definitions here; every body resolves the game's globals lazily at
   call time (top-level const/let live in the shared global lexical scope,
   so a function defined here sees them once the game script has run). */
(function () {
  var IH25 = window.IH25;

  /* ---- possession is only broken by CONTACT -----------------------------
     The sim-first carry (see updatePuck) rebuilds puck.control every frame
     from offset / yaw rate / speed / backhand stance. That is kept: control
     still IS the spring rate, so a hard carve still loosens the carry and
     the puck still swings wide. What changes is that a weak bond alone no
     longer HANDS THE PUCK OVER. Something has to touch it:
       - an opponent's stick tip inside the puck's pocket   (poke / lift)
       - an opponent's body inside the carrier's box        (hit / rub out)
       - the puck itself striking a body or a post          (IH25.bump)
     Every scripted strip already in the build (goalie poke, bot poke, AI
     steal, the player's own jab/sweep) sets possessed=false directly and so
     is unaffected by this gate — those ARE contact. */
  IH25.stickReach = 0.62;   // m, opponent blade to puck
  IH25.bodyRange = 1.35;   // m, opponent body to carrier
  IH25.contactHold = 0.35;   // s, a bump keeps the puck contestable this long
  IH25.contactT = 0;

  function g(name) { try { return eval(name); } catch (e) { return undefined; } }

  /* Real implementation lands in ih25_post.js. It is stubbed HERE because
     tick() calls IH25.applyCam() on its very first line and tick() starts as
     soon as the stick GLTF resolves — which can beat the post-script. */
  IH25.applyCam = function () { };

  IH25.skaters = function () {
    var out = [], i, e;
    var p = g('player'); if (p) out.push(p);
    var b = g('bot'); if (b) out.push(b);
    var M = g('MATCH');
    if (M && M.skaters) for (i = 0; i < M.skaters.length; i++) {
      e = M.skaters[i] && M.skaters[i].ent;
      if (e && out.indexOf(e) < 0) out.push(e);
    }
    var gk = g('goalie'); if (gk) out.push(gk);
    return out;
  };

  IH25.carrier = function () {
    var pk = g('puck'), p = g('player');
    if (pk && pk.possessed && p) return p;
    var f = g('getAICarrier');
    if (typeof f === 'function') { try { return f(); } catch (e) { } }
    return null;
  };

  /* something hit the puck (or the carrier) — keep it contestable a beat */
  IH25.bump = function () { IH25.contactT = IH25.contactHold; };

  IH25.contested = function () {
    if (IH25.contactT > 0) return true;
    var c = IH25.carrier();
    if (!c) return true;                       // loose puck: gate is irrelevant
    var pk = g('puck'); if (!pk) return true;
    var sk = IH25.skaters(), i, e, dx, dz;
    for (i = 0; i < sk.length; i++) {
      e = sk[i];
      if (!e || e === c || !e.pos) continue;
      if (e.stickTip && e.stickTip.distanceTo(pk.pos) < IH25.stickReach) return true;
      dx = e.pos.x - c.pos.x; dz = e.pos.z - c.pos.z;
      if (dx * dx + dz * dz < IH25.bodyRange * IH25.bodyRange) return true;
    }
    return false;
  };
})();

/* Tag everything buildRoom() makes, so the 2.5D layer can hide the arena in one
   sweep when the backdrop is up. It all goes straight onto `scene` with no
   group and no names, and guessing at it by size or height is the kind of
   heuristic that silently starts hiding a player. Wrapping the one call site is
   exact. */
window.IH25.tagArena = function (build) {
  var add = scene.add.bind(scene), n = 0;
  scene.add = function (o) { o.userData.ih25Arena = true; n++; return add(o); };
  try { build(); } finally { scene.add = add; }
  window.IH25._arenaTagged = n;
};
