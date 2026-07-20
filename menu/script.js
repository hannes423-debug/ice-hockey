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
    toast('LAUNCHING — ' + item.t.toUpperCase());
  }

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

  /* ---------------- keyboard ---------------- */
  function onKeydown(e){
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

  function pollPad(dt){
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var p = pads[0];
    if (!p) return;
    var hit = function(i){ return p.buttons[i] && p.buttons[i].pressed && !padPrev[i]; };

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
    $toast.classList.remove('show');

    window.addEventListener('keydown', onKeydown);
    window.addEventListener('gamepadconnected', onPadConnected);
    window.addEventListener('gamepaddisconnected', onPadDisconnected);
    window.addEventListener('resize', function(){
      placeTabIndicator();
      placeMenuRail();
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
