/* ============================================================
   SCRIPT.JS
   Ice Hockey — front-end menu behavior
   Sections: data / icons / dom refs / tabs / menu list /
             widgets / indicators / toast / keyboard / gamepad / init
   Wrapped in a single closure — nothing is attached to window.
   ============================================================ */
(function(){
  'use strict';

  /* ---------------- data: sections & submenu items ---------------- */
  var TABS = [
    { id:'home', label:'HOME', items:[
      { icon:'play',   t:'Continue',          s:'Season 3 · Game 24' },
      { icon:'cal',    t:'Next Match',        s:'Wolves vs Bears · Tonight 19:30' },
      { icon:'film',   t:'Latest Highlights', s:'3 new clips from your last game' },
      { icon:'news',   t:"What's New",        s:'Patch 1.4 — goalie tuning' }
    ]},
    { id:'play', label:'PLAY', items:[
      { icon:'play',   t:'Quick Match', s:'Jump into a game' },
      { icon:'bolt',   t:'Match Mode',  s:'Full team lobby · local multiplayer' },
      { icon:'target', t:'Practice',    s:'Free skate with adjustable bots' },
      { icon:'ranked', t:'Ranked',      s:'Compete and climb the ranks' },
      { icon:'club',   t:'Drop-In',     s:'Find a game already in progress' },
      { icon:'cal',    t:'Season',      s:'Play through the season' },
      { icon:'pad',    t:'Mini Games',  s:'Fun challenges and modes' }
    ]},
    { id:'train', label:'TRAIN', items:[
      { icon:'target', t:'Skill Drills',   s:'Timed stickhandling courses' },
      { icon:'skate',  t:'Skating School', s:'Edges, crossovers, pivots' },
      { icon:'goal',   t:'Shooting Range', s:'Accuracy and release speed' },
      { icon:'shield', t:'Goalie Lab',     s:'Track, read, react' },
      { icon:'play',   t:'Free Skate',     s:'Empty rink, no rules' }
    ]},
    { id:'customize', label:'CUSTOMIZE', items:[
      { icon:'person', t:'Player',       s:'Appearance and build' },
      { icon:'shield', t:'Equipment',    s:'Helmet, gloves, pads' },
      { icon:'brush',  t:'Jerseys',      s:'Home, away, alternate' },
      { icon:'bolt',   t:'Sticks',       s:'Curve, flex, tape job' },
      { icon:'film',   t:'Celebrations', s:'Goal celebrations' }
    ]},
    { id:'replay', label:'REPLAY STUDIO', items:[
      { icon:'film',   t:'Recent Replays', s:'Auto-saved from your games' },
      { icon:'brush',  t:'Clip Editor',    s:'Trim, speed, annotate' },
      { icon:'target', t:'Camera Presets', s:'Broadcast, ice-level, drone' },
      { icon:'news',   t:'Exports',        s:'Rendered clips and shares' }
    ]},
    { id:'club', label:'CLUB', items:[
      { icon:'play',   t:'Club Match',    s:'Queue with your lineup' },
      { icon:'club',   t:'Roster',        s:'12 members · 4 online' },
      { icon:'person', t:'Recruitment',   s:'Invites and applications' },
      { icon:'brush',  t:'Club Identity', s:'Crest, colors, arena' }
    ]},
    { id:'profile', label:'PROFILE', items:[
      { icon:'ranked', t:'Career Stats',  s:'Goals, assists, +/-' },
      { icon:'cal',    t:'Match History', s:'Last 50 games' },
      { icon:'target', t:'Milestones',    s:'Progress and records' },
      { icon:'shield', t:'Badges',        s:'Earned achievements' }
    ]},
    { id:'settings', label:'SETTINGS', items:[
      { icon:'film',   t:'Video',         s:'Display, quality, FPS cap' },
      { icon:'news',   t:'Audio',         s:'Mix, commentary, arena' },
      { icon:'pad',    t:'Controls',      s:'Classic / Hybrid scheme, sensitivity' },
      { icon:'person', t:'Accessibility', s:'Assists, contrast, text size' },
      { icon:'gear',   t:'Online',        s:'Privacy and crossplay' }
    ]}
  ];

  /* ---------------- icons: small inline SVG set ---------------- */
  var Icons = (function(){
    function svg(inner){
      return '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
    }
    return {
      play:   svg('<path d="M7 4.5v15l12-7.5z"/>'),
      ranked: svg('<path d="M5 20v-6M12 20V9M19 20V4"/>'),
      club:   svg('<circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="10" r="2.4"/><path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5M14.5 19c.2-2.2 1.6-3.8 3.6-3.8 1.1 0 2 .4 2.6 1.1"/>'),
      bolt:   svg('<path d="M13 2 5 13h5l-1 9 8-11h-5z"/>'),
      cal:    svg('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>'),
      target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>'),
      pad:    svg('<path d="M6 9h12l2.5 8a2 2 0 0 1-3.3 2L14 16h-4l-3.2 3a2 2 0 0 1-3.3-2z"/><path d="M8.5 12v3M7 13.5h3M15.5 12.5h.01M17.5 14h.01"/>'),
      film:   svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
      news:   svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
      skate:  svg('<path d="M4 14h9l5-3 2 3v2H4zM4 20h16"/>'),
      goal:   svg('<path d="M4 20V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13M4 20h16M8 20v-8m4 8v-8m4 8v-8M4 12h16"/>'),
      shield: svg('<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>'),
      gear:   svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>'),
      brush:  svg('<path d="M15 4l5 5-9 9H6v-5z"/><path d="M13 6l5 5"/>'),
      person: svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-6 7-6s6.2 2.4 7 6"/>')
    };
  })();

  /* ---------------- data: right-panel widgets ---------------- */
  function bar(pct){ return '<div class="bar"><span style="width:' + pct + '%"></span></div>'; }
  function shell(title, body){
    return '<section class="widget glass"><h2 class="widget-title">' + title + '</h2>' + body + '</section>';
  }
  var WIDGETS = [
    function nextMatch(){
      return shell('NEXT MATCH',
        '<div class="match-row"><div class="crest home">HW</div><span class="vs">VS</span><div class="crest">TB</div></div>' +
        '<p class="meta-line">Tonight · 19:30<br>Arena Helsinki</p>');
    },
    function seasonProgress(){
      return shell('SEASON PROGRESS',
        '<div class="stat-row"><span>SEASON 3</span><span>LVL 18 → 19</span></div>' +
        bar(62.5) +
        '<div class="stat-row"><b>6,250</b><span>/ 10,000 XP</span></div>');
    },
    function dailyChallenge(){
      return shell('DAILY CHALLENGE',
        '<div class="stat-row"><span>Score 3 goals</span><b>1 / 3</b></div>' +
        bar(33) +
        '<p class="reward-line">Reward <b>250 XP</b></p>');
    },
    function friendsOnline(){
      return shell('FRIENDS ONLINE · 8',
        '<div class="friend"><div class="av">HP</div><div><div class="n">HockeyPro</div><div class="st">In lobby</div></div><div class="dot"></div></div>' +
        '<div class="friend"><div class="av">PM</div><div><div class="n">PuckMaster</div><div class="st">In game</div></div><div class="dot"></div></div>' +
        '<div class="friend"><div class="av">ES</div><div><div class="n">EpicSauce</div><div class="st">Training</div></div><div class="dot"></div></div>' +
        '<p class="more-line">+5 more</p>');
    },
    function clubActivity(){
      return shell('CLUB ACTIVITY',
        '<ul class="activity-list">' +
        '<li><span class="act-dot"></span><span><b>PuckMaster</b> won a Ranked match</span><time>2h</time></li>' +
        '<li><span class="act-dot"></span><span>Club reached <b>Level 9</b></span><time>1d</time></li>' +
        '<li><span class="act-dot"></span><span>3 members are in a Club Match</span><time>now</time></li>' +
        '</ul>');
    },
    function news(){
      return shell('NEWS',
        '<div class="news-line">COMMUNITY CUP<br>FINALS THIS WEEKEND</div>' +
        '<p class="news-sub">Register your club before Friday to lock in a seed.</p>');
    }
  ];

  /* ---------------- dom refs ---------------- */
  var $tabs        = document.getElementById('tabs');
  var $tabIndicator= document.getElementById('tabIndicator');
  var $sectionTitle= document.getElementById('sectionTitle');
  var $menuList    = document.getElementById('menuList');
  var $menuRail    = document.getElementById('menuRail');
  var $widgetRail  = document.getElementById('widgetRail');
  var $capTitle    = document.getElementById('capTitle');
  var $capSub      = document.getElementById('capSub');
  var $stageCaption= document.getElementById('stageCaption');
  var $toast       = document.getElementById('toast');
  var $confirmOverlay = document.getElementById('confirmOverlay');
  var $partyChip    = document.getElementById('partyChip');
  var $partyDots    = document.getElementById('partyDots');
  var $partyLabel   = document.getElementById('partyLabel');
  var $partyPopover = document.getElementById('partyPopover');

  /* ---------------- party: local co-op roster, assembled here in the main
     menu so Quick Match / Practice / Match Mode all launch multiplayer-ready
     instead of needing an in-game "press A to join" step. LOCAL ONLY for
     now (extra gamepads); the data shape ({pad,team}) and the popover's
     "online" note are deliberately kept so a future online-invite path can
     slot in without reworking this. Same P1-red/P2-blue/... convention as
     game.html's P_COLORS, so the color a player sees here is the color
     they'll see in-game. */
  var PARTY_COLORS = ['#ff3b30','#2f6fff','#2ecc40','#ffdc00','#00e5ff','#b14cff'];
  var party = []; // { pad:<gamepad index>, team:'A'|'B' } — P1 (index 0 slot) is implicit, always present, not stored here
  var partyPopoverOpen = false;
  var partyPadPrev = {}; // padIndex -> prev-frame button states, for join edge-detection independent of the menu-nav pad

  // P1 INPUT — same 'p1Input'/'p1PadIdx' localStorage keys game.html's own
  // in-game lobby picker already reads/writes, so a choice made here (or
  // there, on a direct game.html visit) carries over either way. This is
  // the "who is P1 / controller order" control: 'auto' guesses (first
  // connected pad, with the solo-pad+popover-open exception below), 'kbm'
  // locks P1 to keyboard/mouse and frees every pad to join, 'pad' locks P1
  // to one specific chosen pad index regardless of connection order.
  function readP1Input(){
    try { var v = localStorage.getItem('p1Input'); return (v === 'kbm' || v === 'pad') ? v : 'auto'; }
    catch (e) { return 'auto'; }
  }
  function readP1PadIdx(){
    try { return Math.max(0, parseInt(localStorage.getItem('p1PadIdx'), 10) || 0); }
    catch (e) { return 0; }
  }
  function saveP1Input(){
    try {
      localStorage.setItem('p1Input', p1Input);
      localStorage.setItem('p1PadIdx', String(p1PadIdx));
    } catch (e) {}
  }
  var p1Input  = readP1Input();
  var p1PadIdx = readP1PadIdx();

  function connectedPadCount(pads){
    var n = 0;
    for (var i = 0; i < pads.length; i++) if (pads[i]) n++;
    return n;
  }

  // which pad index (if any) is reserved as the menu-nav / P1 device right
  // now. -1 means no pad is reserved (P1 is on keyboard/mouse, or no pad
  // is connected) — every connected pad is then fair game to join.
  function reservedPadIdx(pads){
    if (p1Input === 'kbm') return -1;
    if (p1Input === 'pad') return pads[p1PadIdx] ? p1PadIdx : -1;
    // auto: assume the first connected pad is P1's — unless it's the ONLY
    // pad connected and the party popover is open (an explicit "I'm
    // managing local co-op" gesture), in which case nothing is reserved so
    // that lone pad can join as a second local player instead.
    var first = -1;
    for (var i = 0; i < pads.length; i++) if (pads[i]) { first = i; break; }
    if (first < 0) return -1;
    if (connectedPadCount(pads) === 1 && partyPopoverOpen) return -1;
    return first;
  }

  var tabIdx  = 1;  // PLAY
  var itemIdx = 0;
  var tabButtons  = [];
  var itemButtons = [];

  /* ---------------- top nav: tabs ---------------- */
  function buildTabs(){
    TABS.forEach(function(section, i){
      var b = document.createElement('button');
      b.className = 'tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', 'false');
      b.textContent = section.label;
      b.addEventListener('click', function(){ setTab(i); });
      $tabs.appendChild(b);
      tabButtons.push(b);
    });
  }

  function setTab(i){
    var n = TABS.length;
    tabIdx = (i + n) % n;
    itemIdx = 0;
    tabButtons.forEach(function(b, k){ b.setAttribute('aria-selected', k === tabIdx ? 'true' : 'false'); });
    $sectionTitle.textContent = TABS[tabIdx].label;
    buildMenuList();
    placeTabIndicator();
  }

  function placeTabIndicator(){
    var el = tabButtons[tabIdx];
    if (!el) return;
    el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); // tabs scroll horizontally on narrow screens
    $tabIndicator.style.width = el.offsetWidth + 'px';
    $tabIndicator.style.transform = 'translate(' + el.offsetLeft + 'px,-50%)';
  }

  /* ---------------- left panel: submenu list ---------------- */
  function buildMenuList(){
    itemButtons = [];
    var frag = document.createDocumentFragment();
    TABS[tabIdx].items.forEach(function(item, k){
      var b = document.createElement('button');
      b.className = 'menu-item';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', k === itemIdx ? 'true' : 'false');
      b.innerHTML = Icons[item.icon] +
        '<span><span class="t">' + item.t + '</span><span class="s">' + item.s + '</span></span>';
      b.addEventListener('click', function(){ itemIdx = k; refreshSelection(); activate(); });
      b.addEventListener('mouseenter', function(){ itemIdx = k; refreshSelection(false); });
      frag.appendChild(b);
      itemButtons.push(b);
    });
    // rail stays, items are rebuilt after it
    while ($menuList.lastChild && $menuList.lastChild !== $menuRail) $menuList.removeChild($menuList.lastChild);
    $menuList.appendChild(frag);
    refreshSelection(true);
    updateCaption();
  }

  function refreshSelection(moveFocus){
    itemButtons.forEach(function(b, k){ b.setAttribute('aria-selected', k === itemIdx ? 'true' : 'false'); });
    placeMenuRail();
    if (moveFocus !== false && itemButtons[itemIdx]) itemButtons[itemIdx].focus({ preventScroll:true });
  }

  function placeMenuRail(){
    var el = itemButtons[itemIdx];
    if (!el){ $menuRail.style.opacity = '0'; return; }
    $menuRail.style.opacity = '1';
    $menuRail.style.height = el.offsetHeight + 'px';
    $menuRail.style.transform = 'translateY(' + el.offsetTop + 'px)';
  }

  function moveItem(delta){
    var n = TABS[tabIdx].items.length;
    itemIdx = (itemIdx + delta + n) % n;
    refreshSelection();
    updateCaption();
  }

  function updateCaption(){
    var item = TABS[tabIdx].items[itemIdx];
    if (!item) return;
    $stageCaption.style.opacity = '0';
    setTimeout(function(){
      $capTitle.textContent = item.t;
      $capSub.textContent = item.s;
      $stageCaption.style.opacity = '1';
    }, 90);
  }

  function activate(){
    var el = itemButtons[itemIdx];
    if (el){
      el.classList.add('is-pressed');
      setTimeout(function(){ el.classList.remove('is-pressed'); }, 110);
    }
    var item = TABS[tabIdx].items[itemIdx];
    // PLAY is the only tab wired to the real game so far. Quick Match jumps
    // straight in with sensible defaults; Practice/Match Mode collect their
    // settings HERE (confirm overlay) instead of showing a second start
    // screen after game.html loads. Other PLAY items + other tabs are still
    // placeholder content — toast only, unchanged.
    if (TABS[tabIdx].id === 'play'){
      if (item.t === 'Quick Match'){
        toast('LAUNCHING — QUICK MATCH');
        setTimeout(function(){ launchGame(cloneDefaults('practice')); }, 260);
        return;
      }
      if (item.t === 'Practice'){ openConfirm('practice'); return; }
      if (item.t === 'Match Mode'){ openConfirm('match'); return; }
    }
    // CUSTOMIZE hands off to the standalone Locker Room equipment editor —
    // Player/Equipment/Jerseys/Sticks all live in that one tool (its own
    // sidebar splits them into Team Uniform vs Player categories), so any
    // of those items opens the same page. Celebrations isn't built there
    // yet, so it stays a toast placeholder like every other unbuilt tab.
    if (TABS[tabIdx].id === 'customize' && item.t !== 'Celebrations'){
      toast('OPENING — LOCKER ROOM');
      setTimeout(function(){ location.href = 'ice-hockey-customize.html'; }, 260);
      return;
    }
    toast('LAUNCHING — ' + item.t.toUpperCase());
  }

  /* ---------------- mode confirm overlay + game handoff ----------------
     Practice/Match Mode settings (bots, bot skill, control scheme) are
     picked and confirmed in this overlay, then handed to game.html via a
     one-shot localStorage key so its own start menu never has to reappear. */
  var AUTOSTART_KEY = 'ihAutoStart';
  var SCHEME_KEY = 'padScheme'; // same key game.html already reads on boot

  var MODE_DEFAULTS = {
    practice: { mode: 'practice', botsP: 0, botsO: 0, skill: 99 },
    // full regulation 5-skater sides by default (P1 + 4 bots vs 5 bots) —
    // still adjustable with the steppers before confirming
    match:    { mode: 'match',    botsA: 4, botsB: 5, skill: 99 }
  };
  function cloneDefaults(mode){
    var d = MODE_DEFAULTS[mode], out = {};
    for (var k in d) out[k] = d[k];
    return out;
  }
  var SCHEMES = ['hybrid', 'classic', 'prostick', 'allstar']; // must match game.html's PAD_SCHEMES
  function readScheme(){
    try { var v = localStorage.getItem(SCHEME_KEY); return SCHEMES.indexOf(v) >= 0 ? v : 'hybrid'; }
    catch (e) { return 'hybrid'; }
  }

  var pending = null;          // settings object while the overlay is open, else null
  var pendingScheme = 'hybrid';
  var overlayFocusables = [];
  var overlayFocusIdx = 0;

  function launchGame(settings){
    // every launch path (Quick Match included) carries whatever local party
    // has been assembled via the header chip — team defaults to 'A' until
    // reassigned in the confirm overlay, which Quick Match skips by design
    settings.party = party.map(function(p){ return { pad: p.pad, team: p.team }; });
    try {
      localStorage.setItem(AUTOSTART_KEY, JSON.stringify(settings));
      localStorage.setItem(SCHEME_KEY, pendingScheme);
    } catch (e) {}
    location.href = 'game.html';
  }

  // party members are already assembled via the header chip by the time
  // a mode gets confirmed here — this section is ONLY where their team gets
  // picked (per the chosen design: manual assignment, not auto-split).
  // Solo play (party.length===0) shows nothing extra.
  function renderConfirmPartyRows(isMatch){
    if (!party.length) return '';
    var aLbl = isMatch ? 'A' : 'YOU', bLbl = isMatch ? 'B' : 'OPP';
    var rows = '<div class="confirm-row" style="display:block"><span>YOUR PARTY</span>';
    party.forEach(function(p, k){
      rows += '<div class="confirm-party-row">' +
        '<span class="party-dot" style="background:' + PARTY_COLORS[(k + 1) % 6] + '">' + (k + 2) + '</span>' +
        '<span class="who">Player ' + (k + 2) + ' · Pad ' + (p.pad + 1) + '</span>' +
        '<div class="team-toggle">' +
          '<button data-party-pad="' + p.pad + '" data-team="A" class="' + (p.team === 'A' ? 'sel' : '') + '">' + aLbl + '</button>' +
          '<button data-party-pad="' + p.pad + '" data-team="B" class="' + (p.team === 'B' ? 'sel' : '') + '">' + bLbl + '</button>' +
        '</div></div>';
    });
    return rows + '</div>';
  }

  function renderConfirm(){
    var isMatch = pending.mode === 'match';
    // Match Mode caps at a regulation 5-skater side (C+LW+RW+LD+RD): team A
    // reserves one spot for P1, team B is bots-only so it can fill all 5.
    var aLabel = isMatch ? 'TEAM A BOTS' : 'TEAMMATE BOTS', aKey = isMatch ? 'botsA' : 'botsP', aMax = isMatch ? 4 : 3;
    var bLabel = isMatch ? 'TEAM B BOTS' : 'OPPONENT BOTS', bKey = isMatch ? 'botsB' : 'botsO', bMax = isMatch ? 5 : 3;
    $confirmOverlay.innerHTML =
      '<div class="confirm-card glass">' +
        '<div class="confirm-title">' + (isMatch ? 'MATCH MODE' : 'PRACTICE') + '</div>' +
        '<div class="confirm-sub">Confirm your settings, then start</div>' +
        '<div class="confirm-row"><span>' + aLabel + '</span><div class="stepper">' +
          '<button data-act="dec" data-key="' + aKey + '">−</button><b>' + pending[aKey] + '</b>' +
          '<button data-act="inc" data-key="' + aKey + '" data-max="' + aMax + '">+</button>' +
        '</div></div>' +
        '<div class="confirm-row"><span>' + bLabel + '</span><div class="stepper">' +
          '<button data-act="dec" data-key="' + bKey + '">−</button><b>' + pending[bKey] + '</b>' +
          '<button data-act="inc" data-key="' + bKey + '" data-max="' + bMax + '">+</button>' +
        '</div></div>' +
        '<div class="confirm-row"><span>BOT SKILL — ' + pending.skill + '</span><div class="confirm-slider">' +
          '<input type="range" id="confirmSkill" min="50" max="99" value="' + pending.skill + '">' +
        '</div></div>' +
        '<div class="confirm-row"><span>CONTROL SCHEME</span><div class="scheme-toggle">' +
          '<button data-scheme="hybrid" class="' + (pendingScheme === 'hybrid' ? 'sel' : '') + '">HYBRID</button>' +
          '<button data-scheme="classic" class="' + (pendingScheme === 'classic' ? 'sel' : '') + '">CLASSIC</button>' +
          '<button data-scheme="prostick" class="' + (pendingScheme === 'prostick' ? 'sel' : '') + '">PRO STICK</button>' +
          '<button data-scheme="allstar" class="' + (pendingScheme === 'allstar' ? 'sel' : '') + '">ALL-STAR</button>' +
        '</div></div>' +
        renderConfirmPartyRows(isMatch) +
        '<div class="confirm-actions">' +
          '<button class="confirm-cancel" id="confirmCancel">BACK</button>' +
          '<button class="confirm-start" id="confirmStart">START</button>' +
        '</div>' +
      '</div>';

    [].forEach.call($confirmOverlay.querySelectorAll('.stepper button'), function(btn){
      btn.addEventListener('click', function(){
        var key = btn.dataset.key, max = btn.dataset.max ? parseInt(btn.dataset.max, 10) : null;
        if (btn.dataset.act === 'inc') pending[key] = Math.min(max, pending[key] + 1);
        else pending[key] = Math.max(0, pending[key] - 1);
        renderConfirm();
      });
    });
    var skillInput = document.getElementById('confirmSkill');
    skillInput.addEventListener('input', function(){ pending.skill = parseInt(skillInput.value, 10); });
    skillInput.addEventListener('change', renderConfirm);
    [].forEach.call($confirmOverlay.querySelectorAll('.scheme-toggle button'), function(btn){
      btn.addEventListener('click', function(){ pendingScheme = btn.dataset.scheme; renderConfirm(); });
    });
    [].forEach.call($confirmOverlay.querySelectorAll('.team-toggle button'), function(btn){
      btn.addEventListener('click', function(){
        var member = party.find(function(p){ return p.pad === parseInt(btn.dataset.partyPad, 10); });
        if (member) member.team = btn.dataset.team;
        renderConfirm();
      });
    });
    document.getElementById('confirmCancel').addEventListener('click', closeConfirm);
    document.getElementById('confirmStart').addEventListener('click', function(){ launchGame(pending); });

    overlayFocusables = [].slice.call($confirmOverlay.querySelectorAll('button,input[type=range]'));
    overlayFocusIdx = Math.min(overlayFocusIdx, overlayFocusables.length - 1);
  }

  function openConfirm(mode){
    closePartyPopover();
    pending = cloneDefaults(mode);
    pendingScheme = readScheme();
    renderConfirm();
    $confirmOverlay.classList.add('show');
    overlayFocusIdx = overlayFocusables.length - 1; // focus START by default
    if (overlayFocusables[overlayFocusIdx]) overlayFocusables[overlayFocusIdx].focus({ preventScroll: true });
  }
  function closeConfirm(){
    pending = null;
    $confirmOverlay.classList.remove('show');
    $confirmOverlay.innerHTML = '';
  }
  function overlayOpen(){ return $confirmOverlay.classList.contains('show'); }

  /* ---------------- right panel: widgets ---------------- */
  function buildWidgets(){
    $widgetRail.innerHTML = WIDGETS.map(function(fn){ return fn(); }).join('');
  }

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function toast(msg){
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ $toast.classList.remove('show'); }, 1300);
  }

  /* ---------------- party chip + popover ---------------- */
  function partyDotHTML(color, label, empty){
    return '<span class="party-dot' + (empty ? ' empty' : '') + '"' +
      (empty ? '' : ' style="background:' + color + '"') + '>' + (empty ? '' : label) + '</span>';
  }

  function renderPartyChip(){
    var n = 1 + party.length; // P1 + joined
    var dots = partyDotHTML(PARTY_COLORS[0], '1', false);
    party.forEach(function(p, k){ dots += partyDotHTML(PARTY_COLORS[(k + 1) % 6], String(k + 2), false); });
    $partyDots.innerHTML = dots;
    $partyLabel.textContent = 'PARTY ' + n;
    $partyChip.classList.toggle('has-extra', party.length > 0);
  }

  function connectedJoinablePads(){
    // any connected gamepad that isn't reserved for P1 (see reservedPadIdx)
    // and isn't already in the party
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var reserved = reservedPadIdx(pads);
    var out = [];
    for (var i = 0; i < pads.length; i++){
      if (i === reserved) continue;
      if (pads[i] && !party.some(function(p){ return p.pad === i; })) out.push(i);
    }
    return out;
  }

  function p1DeviceLabel(pads){
    if (p1Input === 'kbm') return 'Keyboard / mouse';
    if (p1Input === 'pad') return pads[p1PadIdx] ? ('Pad ' + (p1PadIdx + 1)) : 'Pad ' + (p1PadIdx + 1) + ' (disconnected)';
    var reserved = reservedPadIdx(pads);
    return reserved >= 0 ? ('Pad ' + (reserved + 1) + ' · auto') : 'Keyboard / mouse · auto';
  }

  function renderPartyPopover(){
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var html = '<div class="party-pop-title">LOCAL PARTY</div>' +
      '<div class="party-pop-sub">Assembled here once — every mode below launches with this roster</div>' +
      '<div class="party-row"><span class="party-dot" style="background:' + PARTY_COLORS[0] + '">1</span>' +
      '<span class="who">You<small>' + p1DeviceLabel(pads) + '</small></span></div>';

    party.forEach(function(p, k){
      html += '<div class="party-row"><span class="party-dot" style="background:' + PARTY_COLORS[(k + 1) % 6] + '">' + (k + 2) + '</span>' +
        '<span class="who">Player ' + (k + 2) + '<small>Pad ' + (p.pad + 1) + '</small></span>' +
        '<span class="reorder">' +
          '<button class="reorder-up" data-i="' + k + '" title="Move up"' + (k === 0 ? ' disabled' : '') + '>&uarr;</button>' +
          '<button class="reorder-down" data-i="' + k + '" title="Move down"' + (k === party.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
        '</span>' +
        '<button class="leave" data-pad="' + p.pad + '" title="Remove from party">&times;</button></div>';
    });

    var joinable = connectedJoinablePads();
    if (joinable.length){
      joinable.forEach(function(i){
        html += '<div class="party-join-hint"><span class="party-dot"></span>Press A on Pad ' + (i + 1) + ' to join</div>';
      });
    } else if (!party.length){
      html += '<div class="party-empty-note">Connect a gamepad and press A to add a local player.</div>';
    }

    // P1 CONTROL — who's in the driver's seat. Same choice game.html's own
    // in-game picker offers, surfaced here since the front-menu autostart
    // flow skips that lobby screen entirely.
    html += '<div class="party-p1-title">P1 CONTROL</div><div class="party-p1-row">' +
      '<button class="p1opt' + (p1Input === 'auto' ? ' sel' : '') + '" data-mode="auto">AUTO</button>' +
      '<button class="p1opt' + (p1Input === 'kbm' ? ' sel' : '') + '" data-mode="kbm">KB/M</button>';
    for (var i = 0; i < pads.length; i++){
      if (pads[i] && !party.some(function(p){ return p.pad === i; })){
        html += '<button class="p1opt' + (p1Input === 'pad' && p1PadIdx === i ? ' sel' : '') + '" data-mode="pad" data-pad="' + i + '">PAD ' + (i + 1) + '</button>';
      }
    }
    html += '</div>';

    // diagnostics — raw connected-pad info, so a controller that Chrome
    // isn't recognizing as a standard layout (buttons won't line up right)
    // is visible without opening devtools
    var anyPad = false;
    for (var d = 0; d < pads.length; d++){
      if (!pads[d]) continue;
      anyPad = true;
      var nonStandard = pads[d].mapping !== 'standard';
      html += '<div class="party-diag' + (nonStandard ? ' warn' : '') + '">Pad ' + (d + 1) + ': ' +
        (pads[d].id || 'unknown') + (nonStandard ? ' — NON-STANDARD MAPPING, buttons may be off' : ' — OK') + '</div>';
    }
    if (!anyPad) html += '<div class="party-diag">No controller detected by the browser yet.</div>';

    html += '<div class="party-online-note">Online party invites — coming soon</div>';
    $partyPopover.innerHTML = html;

    [].forEach.call($partyPopover.querySelectorAll('.leave'), function(btn){
      btn.addEventListener('click', function(){
        removeFromParty(parseInt(btn.dataset.pad, 10));
      });
    });
    [].forEach.call($partyPopover.querySelectorAll('.reorder-up'), function(btn){
      btn.addEventListener('click', function(){
        var i = parseInt(btn.dataset.i, 10);
        swapPartyOrder(i, i - 1);
      });
    });
    [].forEach.call($partyPopover.querySelectorAll('.reorder-down'), function(btn){
      btn.addEventListener('click', function(){
        var i = parseInt(btn.dataset.i, 10);
        swapPartyOrder(i, i + 1);
      });
    });
    [].forEach.call($partyPopover.querySelectorAll('.p1opt'), function(btn){
      btn.addEventListener('click', function(){
        var mode = btn.dataset.mode;
        setP1Input(mode, mode === 'pad' ? parseInt(btn.dataset.pad, 10) : p1PadIdx);
      });
    });
  }

  function positionPartyPopover(){
    var r = $partyChip.getBoundingClientRect();
    $partyPopover.style.top = (r.bottom + 8) + 'px';
    $partyPopover.style.left = Math.max(12, r.right - 300) + 'px';
  }

  function openPartyPopover(){
    partyPopoverOpen = true;
    renderPartyPopover();
    positionPartyPopover();
    $partyPopover.classList.add('show');
    $partyPopover.setAttribute('aria-hidden', 'false');
    $partyChip.classList.add('open');
    $partyChip.setAttribute('aria-expanded', 'true');
  }
  function closePartyPopover(){
    partyPopoverOpen = false;
    $partyPopover.classList.remove('show');
    $partyPopover.setAttribute('aria-hidden', 'true');
    $partyChip.classList.remove('open');
    $partyChip.setAttribute('aria-expanded', 'false');
  }
  function togglePartyPopover(){ if (partyPopoverOpen) closePartyPopover(); else openPartyPopover(); }

  function addToParty(padIndex){
    if (party.some(function(p){ return p.pad === padIndex; })) return;
    party.push({ pad: padIndex, team: 'A' }); // defaults to P1's side; reassigned per-mode in the confirm overlay
    renderPartyChip();
    if (partyPopoverOpen) renderPartyPopover();
    toast('PLAYER ' + (party.length + 1) + ' JOINED — PAD ' + (padIndex + 1));
  }
  function removeFromParty(padIndex){
    var i = party.findIndex(function(p){ return p.pad === padIndex; });
    if (i < 0) return;
    party.splice(i, 1);
    renderPartyChip();
    if (partyPopoverOpen) renderPartyPopover();
  }

  // reorder two party seats (controller order / who's P2 vs P3 etc — does
  // not touch who's P1, that's setP1Input below)
  function swapPartyOrder(i, j){
    if (i < 0 || j < 0 || i >= party.length || j >= party.length) return;
    var tmp = party[i]; party[i] = party[j]; party[j] = tmp;
    renderPartyChip();
    if (partyPopoverOpen) renderPartyPopover();
  }

  // promotes keyboard/mouse or a specific pad into the P1 seat. Persists via
  // the same localStorage keys game.html's own P1 picker uses, so the choice
  // carries straight into the game whether launched via autostart or not.
  function setP1Input(mode, padIdx){
    p1Input = mode;
    if (mode === 'pad'){
      p1PadIdx = padIdx;
      removeFromParty(padIdx); // can't be a party member and P1 at once
    }
    saveP1Input();
    renderPartyChip();
    if (partyPopoverOpen) renderPartyPopover();
  }

  // gamepads can vanish mid-session (unplugged); drop any party member
  // whose pad is no longer present so the roster never lies
  function pruneDisconnectedParty(){
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var before = party.length;
    party = party.filter(function(p){ return !!pads[p.pad]; });
    if (party.length !== before){
      renderPartyChip();
      if (partyPopoverOpen) renderPartyPopover();
    }
  }

  // scans every connected pad except whichever is reserved for P1 (see
  // reservedPadIdx) for a fresh A-button press and joins it — runs alongside
  // the existing single-pad menu-nav polling (pollPad), independent of which
  // pad is driving menu navigation
  var partyPopoverRefreshT = 0;
  function pollPartyJoins(dt){
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var reserved = reservedPadIdx(pads);
    for (var i = 0; i < pads.length; i++){
      if (i === reserved) { delete partyPadPrev[i]; continue; }
      var p = pads[i];
      if (!p) { delete partyPadPrev[i]; continue; }
      var prev = partyPadPrev[i] || [];
      var pressed = p.buttons[0] && p.buttons[0].pressed;
      if (pressed && !prev[0] && !party.some(function(m){ return m.pad === i; })) addToParty(i);
      var snap = [];
      for (var b = 0; b < p.buttons.length; b++) snap[b] = p.buttons[b] && p.buttons[b].pressed;
      partyPadPrev[i] = snap;
    }
    pruneDisconnectedParty();
    // keep the join hints + diagnostics live while the popover is open —
    // a newly connected pad wouldn't otherwise appear until reopened
    if (partyPopoverOpen){
      partyPopoverRefreshT -= (dt || 0);
      if (partyPopoverRefreshT <= 0){ partyPopoverRefreshT = 0.4; renderPartyPopover(); }
    }
  }

  /* ---------------- keyboard ---------------- */
  function onKeydown(e){
    if (overlayOpen()){
      // real <button>/<input type=range> elements already get native Tab/
      // Enter/Space/arrow-key behavior — only Escape needs a hook here
      if (e.key === 'Escape'){ closeConfirm(); e.preventDefault(); }
      return;
    }
    if (partyPopoverOpen && e.key === 'Escape'){ closePartyPopover(); e.preventDefault(); return; }
    switch (e.key){
      case 'ArrowUp':    moveItem(-1); e.preventDefault(); break;
      case 'ArrowDown':  moveItem(1);  e.preventDefault(); break;
      case 'ArrowLeft':  setTab(tabIdx - 1); e.preventDefault(); break;
      case 'ArrowRight': setTab(tabIdx + 1); e.preventDefault(); break;
      case 'Enter':
      case ' ':          activate(); e.preventDefault(); break;
    }
  }

  /* ---------------- gamepad ---------------- */
  var padPrev = [];
  var stickCooldown = 0;
  var padLoopActive = false;
  var lastFrameTime = 0;

  function moveOverlayFocus(delta){
    if (!overlayFocusables.length) return;
    overlayFocusIdx = (overlayFocusIdx + delta + overlayFocusables.length) % overlayFocusables.length;
    overlayFocusables[overlayFocusIdx].focus({ preventScroll: true });
  }
  function adjustOverlayFocused(delta){
    var el = document.activeElement;
    if (el && $confirmOverlay.contains(el) && el.type === 'range'){
      el.value = Math.max(+el.min, Math.min(+el.max, parseInt(el.value, 10) + delta));
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    }
  }

  function pollPad(dt){
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var navIdx = reservedPadIdx(pads);
    var p = navIdx >= 0 ? pads[navIdx] : null;
    if (!p && partyPopoverOpen){
      // no pad is reserved for nav right now (kb/mouse P1, or the lone pad
      // that's free to join) — still let a connected pad close the popover
      // with B, using whichever slot it's actually sitting in
      for (var s = 0; s < pads.length; s++) if (pads[s]) { p = pads[s]; break; }
    }
    if (!p) return;
    var hit = function(i){ return p.buttons[i] && p.buttons[i].pressed && !padPrev[i]; };

    if (overlayOpen()){
      if (hit(12)) moveOverlayFocus(-1);
      if (hit(13)) moveOverlayFocus(1);
      if (hit(14)) adjustOverlayFocused(-1);
      if (hit(15)) adjustOverlayFocused(1);
      if (hit(0)){ var el = document.activeElement; if (el && $confirmOverlay.contains(el)) el.click(); }
      if (hit(1)) closeConfirm(); // B = cancel
      for (var j = 0; j < p.buttons.length; j++) padPrev[j] = p.buttons[j].pressed;
      return;
    }

    if (partyPopoverOpen){
      // the popover floats over the menu grid; don't let background pad
      // nav/activate fire underneath it (this also stops a solo pad 0's
      // join-press from double-firing as an activate() at the same time —
      // see connectedJoinablePads()). B closes it, same as Escape.
      if (hit(1)) closePartyPopover();
      for (var k = 0; k < p.buttons.length; k++) padPrev[k] = p.buttons[k].pressed;
      return;
    }

    if (hit(12)) moveItem(-1);
    if (hit(13)) moveItem(1);
    if (hit(4) || hit(14)) setTab(tabIdx - 1);
    if (hit(5) || hit(15)) setTab(tabIdx + 1);
    if (hit(0)) activate();

    stickCooldown -= dt;
    var ay = p.axes[1] || 0;
    if (Math.abs(ay) > 0.55 && stickCooldown <= 0){
      moveItem(ay > 0 ? 1 : -1);
      stickCooldown = 0.22;
    }
    for (var i = 0; i < p.buttons.length; i++) padPrev[i] = p.buttons[i].pressed;
  }

  function padLoop(now){
    if (!padLoopActive) return;
    var dt = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;
    pollPad(dt);
    pollPartyJoins(dt);
    requestAnimationFrame(padLoop);
  }

  function startPadLoop(){
    if (padLoopActive) return;
    padLoopActive = true;
    lastFrameTime = performance.now();
    requestAnimationFrame(padLoop);
  }
  function stopPadLoop(){ padLoopActive = false; }

  function onPadConnected(){
    document.body.classList.add('pad-active');
    startPadLoop();
  }
  function onPadDisconnected(){
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var any = false;
    for (var i = 0; i < pads.length; i++) if (pads[i]) any = true;
    if (!any){
      document.body.classList.remove('pad-active');
      stopPadLoop();
    }
  }

  /* ---------------- init ---------------- */
  function init(){
    buildTabs();
    setTab(tabIdx);
    buildWidgets();
    renderPartyChip();
    $toast.classList.remove('show');

    window.addEventListener('keydown', onKeydown);
    window.addEventListener('gamepadconnected', onPadConnected);
    window.addEventListener('gamepaddisconnected', onPadDisconnected);
    window.addEventListener('resize', function(){
      placeTabIndicator();
      placeMenuRail();
      if (partyPopoverOpen) positionPartyPopover();
    });
    $confirmOverlay.addEventListener('click', function(e){
      if (e.target === $confirmOverlay) closeConfirm(); // click on the dimmed backdrop cancels
    });
    $partyChip.addEventListener('click', togglePartyPopover);
    document.addEventListener('click', function(e){
      if (!partyPopoverOpen) return;
      if ($partyPopover.contains(e.target) || $partyChip.contains(e.target)) return;
      closePartyPopover();
    });

    // a gamepad may already be connected before this script ran
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++){
      if (pads[i]){ onPadConnected(); break; }
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
