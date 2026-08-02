/* Shared fullscreen toggle for the menu, the customizer and the game.
   game.html can't load this (it is deliberately one self-contained file) and
   carries a hand-synced copy of the same logic — keep the two equal.

   The browser will only grant fullscreen from a real user gesture, so the
   preference CANNOT simply be re-applied on load: navigating from the menu to
   the game drops fullscreen, and a requestFullscreen() in an load handler is
   rejected. Instead the preference is remembered and re-entered on the first
   interaction the user makes on the new page (see arm()), which is the closest
   thing to "it follows you between pages" that the platform allows. */
(function(){
  'use strict';
  var KEY='ih.fullscreen';

  function want(){try{return localStorage.getItem(KEY)==='1';}catch(e){return false;}}
  function setWant(v){try{localStorage.setItem(KEY,v?'1':'0');}catch(e){}}

  function fsEl(){return document.fullscreenElement||document.webkitFullscreenElement||null;}
  function isOn(){return !!fsEl();}

  function enter(){
    var el=document.documentElement;
    var fn=el.requestFullscreen||el.webkitRequestFullscreen;
    if(!fn)return;
    /* Safari's prefixed form returns undefined rather than a promise, and the
       standard one REJECTS when there is no user activation — unhandled, that
       prints an error on every armed page load. */
    try{var p=fn.call(el);if(p&&p.catch)p.catch(function(){});}catch(e){}
  }
  function leave(){
    if(!isOn())return;
    var fn=document.exitFullscreen||document.webkitExitFullscreen;
    if(!fn)return;
    try{var p=fn.call(document);if(p&&p.catch)p.catch(function(){});}catch(e){}
  }

  var buttons=[];
  function paint(){
    var on=isOn();
    for(var i=0;i<buttons.length;i++){
      var b=buttons[i];
      b.classList.toggle('is-on',on);
      b.setAttribute('aria-pressed',on?'true':'false');
      b.title=(on?'Leave fullscreen':'Enter fullscreen')+' (F11)';
      var lbl=b.querySelector('[data-fs-label]');
      if(lbl)lbl.textContent=on?'WINDOWED':'FULLSCREEN';
      var ico=b.querySelector('[data-fs-icon]');
      if(ico)ico.textContent=on?'⤡':'⛶';
    }
  }

  function toggle(){
    if(isOn()){leave();setWant(false);}
    else{enter();setWant(true);}
  }

  /* If the user leaves fullscreen by Esc or F11 rather than our button, stop
     wanting it — otherwise every later page would drag them back in and the
     escape hatch would feel broken. */
  function onChange(){
    if(!isOn()&&want())setWant(false);
    paint();
  }

  function arm(){
    if(!want()||isOn())return;
    var types=['pointerdown','keydown','touchstart'];
    function once(){
      teardown();
      if(want()&&!isOn())enter();
    }
    function teardown(){
      for(var i=0;i<types.length;i++)document.removeEventListener(types[i],once,true);
    }
    for(var i=0;i<types.length;i++)document.addEventListener(types[i],once,true);
  }

  function attach(el){
    if(!el||buttons.indexOf(el)>=0)return;
    buttons.push(el);
    el.addEventListener('click',function(e){e.preventDefault();toggle();});
    paint();
  }

  document.addEventListener('fullscreenchange',onChange);
  document.addEventListener('webkitfullscreenchange',onChange);

  window.IHFullscreen={toggle:toggle,isOn:isOn,attach:attach,want:want,arm:arm};

  function boot(){
    var els=document.querySelectorAll('[data-fullscreen-toggle]');
    for(var i=0;i<els.length;i++)attach(els[i]);
    paint();
    arm();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
  else boot();
})();
