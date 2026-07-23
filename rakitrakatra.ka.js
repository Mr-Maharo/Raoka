/**
 * RAKITRAKATRA V2 — "MOTERA GOAVANA"
 * Moteur de jeu 2D Malagasy — API en malagasy, docs en français.
 *
 * DIFFERENCES vs V1 (35KB) — tout est REEL, zéro mock :
 *  - Boucle à pas de temps fixe (accumulateur) + scènes (Sehatra)
 *  - Loader d'assets avec progression (Mpampiditra)
 *  - Physique arcade complète : gravité, résolution AABB séparée X/Y,
 *    onGround, bounce, friction, raycast RÉEL contre AABB & segments
 *  - Pathfinding A* sur grille (Lalana)
 *  - Eclairage 2D avec VRAIE occlusion (polygone de visibilité par rayons)
 *  - Particules à émetteur continu + burst, météo (pluie/neige/éclairs)
 *  - Entrées : clavier (justPressed), souris, tactile, GAMEPAD, joystick virtuel
 *  - Caméra : deadzone, bornes monde, zoom, shake, world<->screen
 *  - Tweens chaînables + Timeline (repeat / yoyo / delay)
 *  - Audio WebAudio : canaux musique/sfx, synthé, séquenceur
 *  - Tilemap multi-couches + import Tiled JSON + collisions tuiles
 *  - QuadTree, ObjectPool, EventEmitter, Timer, PRNG seedé, bruit 2D
 *  - Dialogues avec CHOIX, quêtes/inventaire/XP, sauvegarde à SLOTS,
 *    i18n (mg/fr/en), minimap réelle, overlay debug (FPS, hitbox)
 *
 * Licence: MIT. (window.R2 / window.Rakitrakatra2)
 */
(function(global){
'use strict';
const R = { VERSION: '2.0.0-goavana' };

/* ============================================================
 * 1. ZANA — Mathématiques de base (vérifié)
 * ============================================================ */
R.Zana = {
  lerp:(a,b,t)=>a+(b-a)*t,
  clamp:(v,lo,hi)=>Math.max(lo,Math.min(hi,v)),
  dist:(x1,y1,x2,y2)=>Math.hypot(x2-x1,y2-y1),
  angle:(x1,y1,x2,y2)=>Math.atan2(y2-y1,x2-x1),
  map:(v,a1,b1,a2,b2)=>a2+(v-a1)*(b2-a2)/(b1-a1),
  smoothstep:(t)=>t*t*(3-2*t),
  degToRad:(d)=>d*Math.PI/180,
  radToDeg:(r)=>r*180/Math.PI,
  wrapAngle:(a)=>{ while(a>Math.PI)a-=Math.PI*2; while(a<-Math.PI)a+=Math.PI*2; return a; },
  sign:(v)=>v>0?1:v<0?-1:0,
  rand:(lo,hi)=>Math.random()*(hi-lo)+lo,
  randInt:(lo,hi)=>Math.floor(Math.random()*(hi-lo+1))+lo,
  choice:(arr)=>arr[Math.floor(Math.random()*arr.length)],
  shuffle:(arr)=>{ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
};

/* Vec2 — vecteur 2D complet */
R.Vec2 = class {
  constructor(x,y){ this.x=x||0; this.y=y||0; }
  set(x,y){ this.x=x; this.y=y; return this; }
  copy(){ return new R.Vec2(this.x,this.y); }
  add(v){ this.x+=v.x; this.y+=v.y; return this; }
  sub(v){ this.x-=v.x; this.y-=v.y; return this; }
  scale(s){ this.x*=s; this.y*=s; return this; }
  dot(v){ return this.x*v.x+this.y*v.y; }
  cross(v){ return this.x*v.y-this.y*v.x; }
  len(){ return Math.hypot(this.x,this.y); }
  len2(){ return this.x*this.x+this.y*this.y; }
  normalize(){ const l=this.len()||1; this.x/=l; this.y/=l; return this; }
  rotate(a){ const c=Math.cos(a),s=Math.sin(a),x=this.x; this.x=x*c-this.y*s; this.y=x*s+this.y*c; return this; }
  perp(){ return new R.Vec2(-this.y,this.x); }
  angle(){ return Math.atan2(this.y,this.x); }
  distTo(v){ return Math.hypot(v.x-this.x,v.y-this.y); }
  limit(max){ const l=this.len(); if(l>max){ this.scale(max/l); } return this; }
  static fromAngle(a,len){ return new R.Vec2(Math.cos(a)*(len||1),Math.sin(a)*(len||1)); }
};

/* Rect — rectangle avec tests d'intersection */
R.Rect = class {
  constructor(x,y,w,h){ this.x=x||0; this.y=y||0; this.w=w||0; this.h=h||0; }
  get cx(){ return this.x+this.w/2; }
  get cy(){ return this.y+this.h/2; }
  get right(){ return this.x+this.w; }
  get bottom(){ return this.y+this.h; }
  contains(px,py){ return px>=this.x&&px<=this.right&&py>=this.y&&py<=this.bottom; }
  intersects(r){ return this.x<r.x+r.w&&this.right>r.x&&this.y<r.y+r.h&&this.bottom>r.y; }
  overlap(r){ // renvoie {x,y} profondeur de chevauchement (0 si aucun)
    const ox=Math.min(this.right,r.x+r.w)-Math.max(this.x,r.x);
    const oy=Math.min(this.bottom,r.y+r.h)-Math.max(this.y,r.y);
    return (ox>0&&oy>0)?{x:ox,y:oy}:{x:0,y:0};
  }
};

/* ============================================================
 * 2. PRNG seedé (mulberry32) + Bruit 2D (value noise + fbm)
 * ============================================================ */
R.PRNG = class {
  constructor(seed){ this.s=(seed>>>0)||123456789; }
  next(){ // mulberry32 — distribution uniforme [0,1)
    this.s|=0; this.s=(this.s+0x6D2B79F5)|0;
    let t=Math.imul(this.s^(this.s>>>15),1|this.s);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return ((t^(t>>>14))>>>0)/4294967296;
  }
  range(lo,hi){ return this.next()*(hi-lo)+lo; }
  int(lo,hi){ return Math.floor(this.range(lo,hi+1)); }
  choice(arr){ return arr[this.int(0,arr.length-1)]; }
};

R.Noise = {
  _hash:(x,y,seed)=>{ // hash 2D déterministe -> [0,1)
    let h=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(seed||1,974634013);
    h=(h^(h>>>13))|0; h=Math.imul(h,1274126177);
    return ((h^(h>>>16))>>>0)/4294967296;
  },
  value2D:function(x,y,seed){ // value noise interpolé (smoothstep)
    const xi=Math.floor(x), yi=Math.floor(y);
    const xf=x-xi, yf=y-yi;
    const u=R.Zana.smoothstep(xf), v=R.Zana.smoothstep(yf);
    const a=this._hash(xi,yi,seed),   b=this._hash(xi+1,yi,seed);
    const c=this._hash(xi,yi+1,seed), d=this._hash(xi+1,yi+1,seed);
    return R.Zana.lerp(R.Zana.lerp(a,b,u), R.Zana.lerp(c,d,u), v);
  },
  fbm:function(x,y,octaves,seed){ // fractal brownian motion
    let sum=0, amp=0.5, freq=1, tot=0;
    for(let i=0;i<(octaves||4);i++){
      sum+=this.value2D(x*freq,y*freq,(seed||1)+i)*amp;
      tot+=amp; amp*=0.5; freq*=2;
    }
    return sum/tot;
  }
};

/* ============================================================
 * 3. HETSIKA — EventEmitter (on/off/once/emit)
 * ============================================================ */
R.Hetsika = class {
  constructor(){ this._ev={}; }
  on(name,fn){ (this._ev[name]=this._ev[name]||[]).push(fn); return this; }
  once(name,fn){ const w=(...a)=>{ this.off(name,w); fn(...a); }; return this.on(name,w); }
  off(name,fn){ const l=this._ev[name]; if(!l) return this; if(!fn){ delete this._ev[name]; return this; } const i=l.indexOf(fn); if(i>=0) l.splice(i,1); return this; }
  emit(name,...args){ const l=this._ev[name]; if(l) l.slice().forEach(fn=>fn(...args)); return this; }
};

/* ============================================================
 * 4. DOBO — ObjectPool (réutilisation d'objets, zéro GC spike)
 * ============================================================ */
R.Dobo = class {
  constructor(factory,reset,size){
    this.factory=factory; this.reset=reset||((o)=>o);
    this.free=[]; this.used=new Set();
    for(let i=0;i<(size||32);i++) this.free.push(factory());
  }
  alaina(...args){ // obtenir un objet
    const o=this.free.pop()||this.factory();
    this.reset(o,...args); this.used.add(o); return o;
  }
  avereno(o){ if(this.used.delete(o)) this.free.push(o); } // rendre
  isany(){ return {free:this.free.length,used:this.used.size}; }
};

/* ============================================================
 * 5. FAMATARANANDRO — Timer / Scheduler
 * ============================================================ */
R.Famataranandro = class {
  constructor(){ this.tasks=[]; this._id=0; }
  aoriana(ms,fn){ // exécuter après N ms (temps de jeu)
    const t={id:++this._id,t:0,ms,fn,repeat:false}; this.tasks.push(t); return t.id;
  }
  isaky(ms,fn){ // exécuter toutes les N ms
    const t={id:++this._id,t:0,ms,fn,repeat:true}; this.tasks.push(t); return t.id;
  }
  esory(id){ this.tasks=this.tasks.filter(t=>t.id!==id); }
  havaozy(dtMs){
    for(let i=this.tasks.length-1;i>=0;i--){
      const t=this.tasks[i]; t.t+=dtMs;
      if(t.t>=t.ms){
        t.fn();
        if(t.repeat) t.t-=t.ms; else this.tasks.splice(i,1);
      }
    }
  }
};

/* ============================================================
 * 6. EASE — bibliothèque d'easing complète (in/out/inOut)
 * ============================================================ */
R.Ease = (function(){
  const E={ linear:t=>t };
  const defs={
    quad:t=>t*t, cubic:t=>t*t*t, quart:t=>t*t*t*t, quint:t=>t*t*t*t*t,
    sine:t=>1-Math.cos(t*Math.PI/2),
    expo:t=>t===0?0:Math.pow(2,10*(t-1)),
    circ:t=>1-Math.sqrt(1-t*t),
    back:t=>t*t*(2.70158*t-1.70158)
  };
  for(const k in defs){
    const f=defs[k];
    E[k+'In']=f;
    E[k+'Out']=t=>1-f(1-t);
    E[k+'InOut']=t=>t<0.5?f(t*2)/2:1-f((1-t)*2)/2;
  }
  E.elasticOut=t=>{ if(t===0||t===1) return t; return Math.pow(2,-10*t)*Math.sin((t-0.075)*(2*Math.PI)/0.3)+1; };
  E.elasticIn=t=>1-E.elasticOut(1-t);
  E.bounceOut=t=>{
    if(t<1/2.75) return 7.5625*t*t;
    if(t<2/2.75) return 7.5625*(t-=1.5/2.75)*t+0.75;
    if(t<2.5/2.75) return 7.5625*(t-=2.25/2.75)*t+0.9375;
    return 7.5625*(t-=2.625/2.75)*t+0.984375;
  };
  E.bounceIn=t=>1-E.bounceOut(1-t);
  return E;
})();

/* ============================================================
 * 7. MPAMPIDITRA — Loader d'assets avec progression
 * ============================================================ */
R.Mpampiditra = class extends R.Hetsika {
  constructor(){ super(); this.queue=[]; this.assets={}; this.loaded=0; this.total=0; }
  sary(key,url){ this.queue.push({type:'image',key,url}); return this; }
  feo(key,url){ this.queue.push({type:'audio',key,url}); return this; }
  json(key,url){ this.queue.push({type:'json',key,url}); return this; }
  alaina(key){ return this.assets[key]; }
  atombohy(){ // démarre le chargement, émet 'progress' et 'vita'
    this.total=this.queue.length; this.loaded=0;
    if(this.total===0){ this.emit('vita',this.assets); return Promise.resolve(this.assets); }
    const done=()=>{ this.loaded++; this.emit('progress',this.loaded/this.total); if(this.loaded>=this.total) this.emit('vita',this.assets); };
    const jobs=this.queue.map(item=>new Promise(res=>{
      if(item.type==='image'){
        const img=new Image(); img.crossOrigin='anonymous';
        img.onload=()=>{ this.assets[item.key]=img; done(); res(); };
        img.onerror=()=>{ console.warn('Sary tsy azo:',item.url); done(); res(); };
        img.src=item.url;
      } else if(item.type==='audio'){
        fetch(item.url).then(r=>r.arrayBuffer())
          .then(buf=>R.Feo._decode(buf))
          .then(ab=>{ this.assets[item.key]=ab; done(); res(); })
          .catch(()=>{ console.warn('Feo tsy azo:',item.url); done(); res(); });
      } else if(item.type==='json'){
        fetch(item.url).then(r=>r.json())
          .then(j=>{ this.assets[item.key]=j; done(); res(); })
          .catch(()=>{ console.warn('JSON tsy azo:',item.url); done(); res(); });
      }
    }));
    this.queue=[];
    return Promise.all(jobs).then(()=>this.assets);
  }
};
  /* ============================================================
 * 8. FEO — Audio WebAudio complet (canaux, synthé, séquenceur)
 * ============================================================ */
R.Feo = {
  _ctx:null, _music:null, _sfxGain:null, _musicGain:null,
  _get(){ 
    if(!this._ctx){
      try{
        this._ctx=new (window.AudioContext||window.webkitAudioContext)();
        this._sfxGain=this._ctx.createGain(); this._sfxGain.connect(this._ctx.destination);
        this._musicGain=this._ctx.createGain(); this._musicGain.connect(this._ctx.destination);
      }catch(e){}
    }
    if(this._ctx&&this._ctx.state==='suspended') this._ctx.resume().catch(()=>{});
    return this._ctx;
  },
  _decode(buf){ const c=this._get(); return c?c.decodeAudioData(buf):Promise.reject(); },
  volumeSfx(v){ const c=this._get(); if(c) this._sfxGain.gain.value=R.Zana.clamp(v,0,1); },
  volumeMusic(v){ const c=this._get(); if(c) this._musicGain.gain.value=R.Zana.clamp(v,0,1); },
  milalao(audioBuffer,opts){ // jouer un AudioBuffer chargé par le loader
    const c=this._get(); if(!c||!audioBuffer) return null;
    const src=c.createBufferSource(); src.buffer=audioBuffer;
    const g=c.createGain(); g.gain.value=(opts&&opts.feo)!=null?opts.feo:1;
    src.playbackRate.value=(opts&&opts.rate)||1;
    src.connect(g); g.connect((opts&&opts.music)?this._musicGain:this._sfxGain);
    if(opts&&opts.loop) src.loop=true;
    src.start();
    return src;
  },
  hira(audioBuffer,opts){ // musique de fond (loop, remplace la précédente)
    if(this._music){ try{ this._music.stop(); }catch(e){} }
    this._music=this.milalao(audioBuffer,Object.assign({loop:true,music:true},opts));
    return this._music;
  },
  ajanonyHira(){ if(this._music){ try{ this._music.stop(); }catch(e){} this._music=null; } },
  mamorona(type,opts){ // synthé de SFX procéduraux
    const c=this._get(); if(!c) return;
    opts=opts||{};
    const presets={
      jump:  {f:330,f2:660, t:'square',   d:0.18},
      coin:  {f:988,f2:1319,t:'square',   d:0.15},
      hit:   {f:220,f2:55,  t:'sawtooth', d:0.25},
      pickup:{f:523,f2:784, t:'sine',     d:0.20},
      power: {f:440,f2:880, t:'triangle', d:0.45},
      laser: {f:1200,f2:300,t:'sawtooth', d:0.20},
      explode:{f:120,f2:30, t:'sawtooth', d:0.50},
      step:  {f:180,f2:140, t:'triangle', d:0.07}
    };
    const p=presets[type]||{f:opts.freq||440,f2:(opts.freq||440)*1.5,t:opts.wave||'sine',d:opts.d||0.3};
    const osc=c.createOscillator(), g=c.createGain();
    osc.type=p.t;
    osc.frequency.setValueAtTime(p.f,c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20,p.f2),c.currentTime+p.d);
    g.gain.setValueAtTime(0.25,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+p.d);
    osc.connect(g); g.connect(this._sfxGain);
    osc.start(); osc.stop(c.currentTime+p.d+0.05);
  },
  gadona(notes,bpm){ // séquenceur : notes = [{n:'C4',d:1},{n:null,d:0.5},...] (n=null => silence)
    const c=this._get(); if(!c) return {stop(){}};
    const NOTE={C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11};
    const freq=(name)=>{
      const m=/^([A-G]#?)(\d)$/.exec(name); if(!m) return 440;
      return 440*Math.pow(2,(NOTE[m[1]]+(+m[2]-4)*12-9)/12);
    };
    const beat=60/(bpm||120);
    let t=c.currentTime+0.05; const nodes=[];
    notes.forEach(nt=>{
      const dur=(nt.d||1)*beat;
      if(nt.n){
        const o=c.createOscillator(), g=c.createGain();
        o.type=nt.wave||'square'; o.frequency.value=freq(nt.n);
        g.gain.setValueAtTime(0.12,t);
        g.gain.exponentialRampToValueAtTime(0.001,t+dur*0.9);
        o.connect(g); g.connect(this._musicGain);
        o.start(t); o.stop(t+dur); nodes.push(o);
      }
      t+=dur;
    });
    return { stop(){ nodes.forEach(o=>{ try{ o.stop(); }catch(e){} }); } };
  }
};

/* ============================================================
 * 9. FANINDRY — Input : clavier / souris / tactile / gamepad
 * ============================================================ */
R.Fanindry = {
  keys:new Set(), _prevKeys:new Set(),
  mouse:{x:0,y:0,down:false,justDown:false,justUp:false,right:false,wheel:0},
  touches:[], _canvas:null, _init:false,
  joystick:{active:false,x:0,y:0,ox:0,oy:0,dx:0,dy:0}, // joystick virtuel tactile
  init(canvas){
    this._canvas=canvas;
    if(this._init) return; this._init=true;
    const pos=(e)=>{
      const c=this._canvas; if(!c) return {x:e.clientX,y:e.clientY};
      const r=c.getBoundingClientRect();
      return { x:(e.clientX-r.left)*(c.width/r.width), y:(e.clientY-r.top)*(c.height/r.height) };
    };
    window.addEventListener('keydown',e=>{
      this.keys.add(e.key.toLowerCase());
      if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur',()=>this.keys.clear());
    window.addEventListener('mousemove',e=>{ const p=pos(e); this.mouse.x=p.x; this.mouse.y=p.y; });
    window.addEventListener('mousedown',e=>{ const p=pos(e); this.mouse.x=p.x; this.mouse.y=p.y; this.mouse.down=true; this.mouse.justDown=true; this.mouse.right=e.button===2; });
    window.addEventListener('mouseup',()=>{ this.mouse.down=false; this.mouse.justUp=true; });
    window.addEventListener('wheel',e=>{ this.mouse.wheel=Math.sign(e.deltaY); },{passive:true});
    window.addEventListener('contextmenu',e=>{ if(e.target===this._canvas) e.preventDefault(); });
    // Tactile + joystick virtuel (moitié gauche de l'écran = joystick)
    const touchPos=(t)=>pos(t);
    window.addEventListener('touchstart',e=>{
      for(const t of e.changedTouches){
        const p=touchPos(t);
        this.touches.push({id:t.identifier,x:p.x,y:p.y});
        if(this._canvas&&p.x<this._canvas.width/2&&!this.joystick.active){
          this.joystick.active=true; this.joystick.id=t.identifier;
          this.joystick.ox=p.x; this.joystick.oy=p.y; this.joystick.x=p.x; this.joystick.y=p.y;
        } else { this.mouse.down=true; this.mouse.justDown=true; this.mouse.x=p.x; this.mouse.y=p.y; }
      }
    },{passive:true});
    window.addEventListener('touchmove',e=>{
      for(const t of e.changedTouches){
        const p=touchPos(t);
        const rec=this.touches.find(o=>o.id===t.identifier);
        if(rec){ rec.x=p.x; rec.y=p.y; }
        if(this.joystick.active&&t.identifier===this.joystick.id){
          this.joystick.x=p.x; this.joystick.y=p.y;
          const dx=p.x-this.joystick.ox, dy=p.y-this.joystick.oy;
          const len=Math.hypot(dx,dy)||1, m=Math.min(len,50);
          this.joystick.dx=(dx/len)*(m/50); this.joystick.dy=(dy/len)*(m/50);
        }
      }
    },{passive:true});
    window.addEventListener('touchend',e=>{
      for(const t of e.changedTouches){
        this.touches=this.touches.filter(o=>o.id!==t.identifier);
        if(this.joystick.active&&t.identifier===this.joystick.id){
          this.joystick.active=false; this.joystick.dx=0; this.joystick.dy=0;
        } else { this.mouse.down=false; this.mouse.justUp=true; }
      }
    },{passive:true});
  },
  isDown(k){ return this.keys.has(k.toLowerCase()); },
  justPressed(k){ return this.keys.has(k.toLowerCase())&&!this._prevKeys.has(k.toLowerCase()); },
  axe(){ // axe de déplacement unifié clavier+gamepad+joystick tactile [-1..1]
    let x=0,y=0;
    if(this.isDown('arrowleft')||this.isDown('q')||this.isDown('a')) x-=1;
    if(this.isDown('arrowright')||this.isDown('d')) x+=1;
    if(this.isDown('arrowup')||this.isDown('z')||this.isDown('w')) y-=1;
    if(this.isDown('arrowdown')||this.isDown('s')) y+=1;
    const gp=this.gamepad();
    if(gp){ if(Math.abs(gp.axes[0])>0.2) x=gp.axes[0]; if(Math.abs(gp.axes[1])>0.2) y=gp.axes[1]; }
    if(this.joystick.active){ x=this.joystick.dx; y=this.joystick.dy; }
    return {x:R.Zana.clamp(x,-1,1),y:R.Zana.clamp(y,-1,1)};
  },
  gamepad(){ 
    if(!navigator.getGamepads) return null;
    const gps=navigator.getGamepads();
    for(const g of gps) if(g&&g.connected) return g;
    return null;
  },
  gamepadButton(i){ const g=this.gamepad(); return !!(g&&g.buttons[i]&&g.buttons[i].pressed); },
  _endFrame(){ // appelé par le moteur à chaque fin de frame
    this._prevKeys=new Set(this.keys);
    this.mouse.justDown=false; this.mouse.justUp=false; this.mouse.wheel=0;
  },
  drawJoystick(ctx){ // affiche le joystick virtuel si actif
    if(!this.joystick.active) return;
    ctx.save(); ctx.globalAlpha=0.35;
    ctx.strokeStyle='#fff'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(this.joystick.ox,this.joystick.oy,50,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(this.joystick.ox+this.joystick.dx*50,this.joystick.oy+this.joystick.dy*50,20,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
};

 /* ============================================================
 * 10. TWEEN — moteur de tweens chaînables + Timeline
 * ============================================================ */
R.Tween = {
  _list:[],
  to(target,props,duration,opts){
    opts=opts||{};
    const tw={
      target,end:props,start:null,duration:duration||1000,elapsed:0,
      ease:(typeof opts==='string')?opts:(opts.ease||'linear'),
      delay:opts.delay||0, repeat:opts.repeat||0, yoyo:!!opts.yoyo,
      onComplete:opts.onComplete||opts.vita||null, onUpdate:opts.onUpdate||null,
      _forward:true, dead:false,
      _next:null,
      avyEo(props2,dur2,opts2){ // chaînage : tween suivant lancé après celui-ci
        this._next={props:props2,dur:dur2,opts:opts2}; return this;
      },
      ajanony(){ this.dead=true; }
    };
    this._list.push(tw); return tw;
  },
  update(dtMs){
    for(let i=this._list.length-1;i>=0;i--){
      const t=this._list[i];
      if(t.dead){ this._list.splice(i,1); continue; }
      if(t.delay>0){ t.delay-=dtMs; continue; }
      if(!t.start){ t.start={}; for(const k in t.end) t.start[k]=t.target[k]||0; }
      t.elapsed+=dtMs;
      let pr=Math.min(t.elapsed/t.duration,1);
      const e=(R.Ease[t.ease]||R.Ease.linear)(t._forward?pr:1-pr);
      for(const k in t.end) t.target[k]=t.start[k]+(t.end[k]-t.start[k])*e;
      if(t.onUpdate) t.onUpdate(pr);
      if(pr>=1){
        if(t.yoyo&&t._forward){ t._forward=false; t.elapsed=0; continue; }
        if(t.repeat>0||t.repeat===-1){
          if(t.repeat>0) t.repeat--;
          t.elapsed=0; t._forward=true;
          for(const k in t.end) t.target[k]=t.start[k];
          continue;
        }
        if(t.onComplete) t.onComplete();
        if(t._next){ const n=t._next; R.Tween.to(t.target,n.props,n.dur,n.opts); }
        this._list.splice(i,1);
      }
    }
  },
  killAll(){ this._list=[]; },
  killOf(target){ this._list=this._list.filter(t=>t.target!==target); }
};

/* Timeline — séquence d'étapes temporisées */
R.Timeline = class {
  constructor(){ this.steps=[]; this.t=0; this.i=0; this.done=false; }
  ampio(atMs,fn){ this.steps.push({at:atMs,fn}); this.steps.sort((a,b)=>a.at-b.at); return this; }
  havaozy(dtMs){
    if(this.done) return;
    this.t+=dtMs;
    while(this.i<this.steps.length&&this.steps[this.i].at<=this.t){ this.steps[this.i].fn(); this.i++; }
    if(this.i>=this.steps.length) this.done=true;
  }
  avereno(){ this.t=0; this.i=0; this.done=false; }
};

/* ============================================================
 * 11. KAMERA — deadzone, bornes monde, zoom, shake, conversions
 * ============================================================ */
R.Kamera = class {
  constructor(viewW,viewH){
    this.x=0; this.y=0; this.zoom=1;
    this.viewW=viewW||800; this.viewH=viewH||600;
    this.target=null; this.lerp=0.1;
    this.deadzone={w:120,h:80};
    this.bounds=null; // {x,y,w,h} du monde
    this._shake=0; this._shakePow=0; this._sx=0; this._sy=0;
  }
  manaraka(t,lerp){ this.target=t; if(lerp!=null) this.lerp=lerp; return this; }
  fetra(x,y,w,h){ this.bounds={x,y,w,h}; return this; }
  manozongozona(power,durMs){ this._shakePow=power||10; this._shake=durMs||300; }
  havaozy(dtMs){
    if(this.target){
      const tx=this.target.x+(this.target.w||0)/2, ty=this.target.y+(this.target.h||0)/2;
      const cx=this.x+this.viewW/(2*this.zoom), cy=this.y+this.viewH/(2*this.zoom);
      let dx=0,dy=0;
      if(tx<cx-this.deadzone.w/2) dx=tx-(cx-this.deadzone.w/2);
      if(tx>cx+this.deadzone.w/2) dx=tx-(cx+this.deadzone.w/2);
      if(ty<cy-this.deadzone.h/2) dy=ty-(cy-this.deadzone.h/2);
      if(ty>cy+this.deadzone.h/2) dy=ty-(cy+this.deadzone.h/2);
      const k=1-Math.pow(1-this.lerp,dtMs/16.666);
      this.x+=dx*k; this.y+=dy*k;
    }
    if(this.bounds){
      const vw=this.viewW/this.zoom, vh=this.viewH/this.zoom;
      this.x=R.Zana.clamp(this.x,this.bounds.x,Math.max(this.bounds.x,this.bounds.x+this.bounds.w-vw));
      this.y=R.Zana.clamp(this.y,this.bounds.y,Math.max(this.bounds.y,this.bounds.y+this.bounds.h-vh));
    }
    if(this._shake>0){
      this._shake-=dtMs;
      const p=this._shakePow*(this._shake>0?1:0);
      this._sx=(Math.random()-0.5)*p; this._sy=(Math.random()-0.5)*p;
    } else { this._sx=0; this._sy=0; }
  }
  apply(ctx){ ctx.save(); ctx.scale(this.zoom,this.zoom); ctx.translate(-this.x+this._sx,-this.y+this._sy); }
  restore(ctx){ ctx.restore(); }
  toWorld(sx,sy){ return {x:sx/this.zoom+this.x,y:sy/this.zoom+this.y}; }
  toScreen(wx,wy){ return {x:(wx-this.x)*this.zoom,y:(wy-this.y)*this.zoom}; }
  hita(rect){ // l'objet est-il visible ? (culling)
    const vw=this.viewW/this.zoom, vh=this.viewH/this.zoom;
    return rect.x+((rect.w)||0)>this.x&&rect.x<this.x+vw&&rect.y+((rect.h)||0)>this.y&&rect.y<this.y+vh;
  }
};

/* ============================================================
 * 12. FIZIKA — physique arcade complète
 * ============================================================ */
R.Vatana = class { // corps physique
  constructor(x,y,w,h,opts){
    opts=opts||{};
    this.x=x; this.y=y; this.w=w; this.h=h;
    this.vx=0; this.vy=0; this.ax=0; this.ay=0;
    this.gravity=opts.gravity!=null?opts.gravity:0.5;
    this.friction=opts.friction!=null?opts.friction:0.85;
    this.bounce=opts.bounce||0;
    this.maxVx=opts.maxVx||12; this.maxVy=opts.maxVy||18;
    this.solid=opts.solid!==false;
    this.static=!!opts.static;
    this.onGround=false; this.onWall=0;
    this.dead=false;
  }
  get rect(){ return new R.Rect(this.x,this.y,this.w,this.h); }
};

R.Fizika = class {
  constructor(){ this.bodies=[]; this.solids=[]; }
  ampio(b){ this.bodies.push(b); if(b.static&&b.solid) this.solids.push(b); return b; }
  esory(b){ b.dead=true; }
  havaozy(dt){
    this.bodies=this.bodies.filter(b=>!b.dead);
    this.solids=this.solids.filter(b=>!b.dead);
    for(const b of this.bodies){
      if(b.static) continue;
      b.vx+=b.ax*dt; b.vy+=(b.ay+b.gravity)*dt;
      b.vx*=Math.pow(b.friction,dt);
      b.vx=R.Zana.clamp(b.vx,-b.maxVx,b.maxVx);
      b.vy=R.Zana.clamp(b.vy,-b.maxVy,b.maxVy);
      b.onGround=false; b.onWall=0;
      // Résolution séparée par axe (méthode robuste des platformers)
      b.x+=b.vx*dt;
      for(const s of this.solids){
        if(s===b) continue;
        const ov=b.rect.overlap(s.rect);
        if(ov.x>0&&ov.y>0){
          if(b.vx>0){ b.x=s.x-b.w; b.onWall=1; } else if(b.vx<0){ b.x=s.x+s.w; b.onWall=-1; }
          b.vx=-b.vx*b.bounce;
        }
      }
      b.y+=b.vy*dt;
      for(const s of this.solids){
        if(s===b) continue;
        const ov=b.rect.overlap(s.rect);
        if(ov.x>0&&ov.y>0){
          if(b.vy>0){ b.y=s.y-b.h; b.onGround=true; } else if(b.vy<0){ b.y=s.y+s.h; }
          b.vy=-b.vy*b.bounce;
          if(Math.abs(b.vy)<0.5) b.vy=0;
        }
      }
    }
  }
  // Collision cercle-cercle élastique AVEC masses (vraie physique)
  static resolveCircles(a,b){
    const dx=b.x-a.x, dy=b.y-a.y;
    const dist=Math.hypot(dx,dy)||0.001;
    const nx=dx/dist, ny=dy/dist;
    const overlap=(a.r+b.r)-dist;
    if(overlap<=0) return false;
    const ma=a.mass||1, mb=b.mass||1, tm=ma+mb;
    a.x-=nx*overlap*(mb/tm); a.y-=ny*overlap*(mb/tm);
    b.x+=nx*overlap*(ma/tm); b.y+=ny*overlap*(ma/tm);
    const rvx=(b.vx||0)-(a.vx||0), rvy=(b.vy||0)-(a.vy||0);
    const velN=rvx*nx+rvy*ny;
    if(velN>0) return true; // s'éloignent déjà
    const e=Math.min(a.bounce!=null?a.bounce:1,b.bounce!=null?b.bounce:1);
    const j=-(1+e)*velN/(1/ma+1/mb);
    a.vx-=(j/ma)*nx; a.vy-=(j/ma)*ny;
    b.vx+=(j/mb)*nx; b.vy+=(j/mb)*ny;
    return true;
  }
  // Raycast RÉEL contre un segment (retourne t & point, null sinon)
  static raySegment(ox,oy,dx,dy,x1,y1,x2,y2){
    const rx=dx, ry=dy, sx=x2-x1, sy=y2-y1;
    const denom=rx*sy-ry*sx;
    if(Math.abs(denom)<1e-9) return null;
    const t=((x1-ox)*sy-(y1-oy)*sx)/denom;
    const u=((x1-ox)*ry-(y1-oy)*rx)/denom;
    if(t>=0&&u>=0&&u<=1) return {t,x:ox+rx*t,y:oy+ry*t};
    return null;
  }
  // Raycast contre un AABB (slab method) — retourne {t,x,y} ou null
  static rayRect(ox,oy,dx,dy,r){
    let tmin=-Infinity, tmax=Infinity;
    if(Math.abs(dx)<1e-9){ if(ox<r.x||ox>r.x+r.w) return null; }
    else {
      let t1=(r.x-ox)/dx, t2=(r.x+r.w-ox)/dx;
      if(t1>t2) [t1,t2]=[t2,t1];
      tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2);
    }
    if(Math.abs(dy)<1e-9){ if(oy<r.y||oy>r.y+r.h) return null; }
    else {
      let t1=(r.y-oy)/dy, t2=(r.y+r.h-oy)/dy;
      if(t1>t2) [t1,t2]=[t2,t1];
      tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2);
    }
    if(tmax<tmin||tmax<0) return null;
    const t=tmin>=0?tmin:tmax;
    return {t,x:ox+dx*t,y:oy+dy*t};
  }
};

/* ============================================================
 * 13. QUADTREE — partition spatiale pour collisions massives
 * ============================================================ */
R.QuadTree = class {
  constructor(bounds,depth){
    this.bounds=bounds; this.depth=depth||0;
    this.objects=[]; this.nodes=null;
    this.MAX_OBJ=8; this.MAX_DEPTH=5;
  }
  clear(){ this.objects=[]; this.nodes=null; }
  _split(){
    const {x,y,w,h}=this.bounds, hw=w/2, hh=h/2, d=this.depth+1;
    this.nodes=[
      new R.QuadTree({x,y,w:hw,h:hh},d), new R.QuadTree({x:x+hw,y,w:hw,h:hh},d),
      new R.QuadTree({x,y:y+hh,w:hw,h:hh},d), new R.QuadTree({x:x+hw,y:y+hh,w:hw,h:hh},d)
    ];
  }
  _index(r){
    if(!this.nodes) return -1;
    for(let i=0;i<4;i++){
      const n=this.nodes[i].bounds;
      if(r.x>=n.x&&r.x+r.w<=n.x+n.w&&r.y>=n.y&&r.y+r.h<=n.y+n.h) return i;
    }
    return -1;
  }
  insert(obj){
    if(this.nodes){
      const i=this._index(obj);
      if(i!==-1){ this.nodes[i].insert(obj); return; }
    }
    this.objects.push(obj);
    if(this.objects.length>this.MAX_OBJ&&this.depth<this.MAX_DEPTH){
      if(!this.nodes) this._split();
      for(let i=this.objects.length-1;i>=0;i--){
        const idx=this._index(this.objects[i]);
        if(idx!==-1) this.nodes[idx].insert(this.objects.splice(i,1)[0]);
      }
    }
  }
  retrieve(r,out){
    out=out||[];
    if(this.nodes){
      const i=this._index(r);
      if(i!==-1) this.nodes[i].retrieve(r,out);
      else this.nodes.forEach(n=>{ if(r.x<n.bounds.x+n.bounds.w&&r.x+r.w>n.bounds.x&&r.y<n.bounds.y+n.bounds.h&&r.y+r.h>n.bounds.y) n.retrieve(r,out); });
    }
    out.push(...this.objects);
    return out;
  }
};
  /* ============================================================
 * 14. LALANA — Pathfinding A* sur grille (diagonales en option)
 * ============================================================ */
R.Lalana = {
  tadiavo(grid,sx,sy,ex,ey,opts){ // grid[y][x], 0=libre 1=mur — renvoie [{x,y},...] ou null
    opts=opts||{};
    const H=grid.length, W=grid[0].length;
    if(sx<0||sy<0||ex<0||ey<0||sx>=W||sy>=H||ex>=W||ey>=H) return null;
    if(grid[sy][sx]||grid[ey][ex]) return null;
    const diag=!!opts.diagonale;
    const key=(x,y)=>y*W+x;
    const open=[{x:sx,y:sy,g:0,f:0,parent:null}];
    const gScore=new Map([[key(sx,sy),0]]);
    const closed=new Set();
    const h=(x,y)=>Math.abs(x-ex)+Math.abs(y-ey);
    const dirs=diag
      ? [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
      : [[1,0],[-1,0],[0,1],[0,-1]];
    while(open.length){
      // extraction du min f (tas simplifié : tri partiel)
      let mi=0;
      for(let i=1;i<open.length;i++) if(open[i].f<open[mi].f) mi=i;
      const cur=open.splice(mi,1)[0];
      if(cur.x===ex&&cur.y===ey){
        const path=[]; let n=cur;
        while(n){ path.push({x:n.x,y:n.y}); n=n.parent; }
        return path.reverse();
      }
      closed.add(key(cur.x,cur.y));
      for(const [dx,dy] of dirs){
        const nx=cur.x+dx, ny=cur.y+dy;
        if(nx<0||ny<0||nx>=W||ny>=H) continue;
        if(grid[ny][nx]) continue;
        if(dx&&dy&&(grid[cur.y][nx]||grid[ny][cur.x])) continue; // pas de coupe de coin
        const k=key(nx,ny);
        if(closed.has(k)) continue;
        const cost=(dx&&dy)?1.4142:1;
        const g=cur.g+cost;
        if(gScore.has(k)&&g>=gScore.get(k)) continue;
        gScore.set(k,g);
        open.push({x:nx,y:ny,g,f:g+h(nx,ny),parent:cur});
      }
      if(closed.size>W*H) break; // garde-fou
    }
    return null;
  },
  hamora(path,tile){ // convertit chemin grille -> coordonnées monde (centres)
    return path?path.map(p=>({x:p.x*tile+tile/2,y:p.y*tile+tile/2})):null;
  }
};

/* ============================================================
 * 15. DRAFITRA — Tilemap multi-couches + Tiled + collisions
 * ============================================================ */
R.Drafitra = class {
  constructor(opts){
    opts=opts||{};
    this.tile=opts.tile||32;
    this.w=opts.w||25; this.h=opts.h||19;
    this.layers=[]; // {name, data[y][x], visible, solid}
    this.tileset=opts.tileset||null; // Image
    this.tilesetCols=opts.tilesetCols||8;
    this.colors=opts.colors||{1:'#2d5a27',2:'#5a4327',3:'#27455a',4:'#5a2740',5:'#444'};
  }
  sosona(name,data,opts2){ // ajouter une couche
    opts2=opts2||{};
    this.layers.push({name,data,visible:opts2.visible!==false,solid:!!opts2.solid});
    return this;
  }
  static avyTiled(json,tilesetImg){ // importe une map Tiled JSON (CSV encoding)
    const m=new R.Drafitra({tile:json.tilewidth,w:json.width,h:json.height,tileset:tilesetImg});
    if(tilesetImg&&json.tilesets&&json.tilesets[0]&&json.tilesets[0].columns) m.tilesetCols=json.tilesets[0].columns;
    (json.layers||[]).forEach(L=>{
      if(L.type!=='tilelayer'||!Array.isArray(L.data)) return;
      const grid=[];
      for(let y=0;y<L.height;y++) grid.push(L.data.slice(y*L.width,(y+1)*L.width));
      const solid=!!(L.properties||[]).find(p=>p.name==='solid'&&p.value);
      m.sosona(L.name,grid,{solid,visible:L.visible!==false});
    });
    return m;
  }
  tileAt(layerName,wx,wy){
    const L=this.layers.find(l=>l.name===layerName)||this.layers[0];
    if(!L) return 0;
    const gx=Math.floor(wx/this.tile), gy=Math.floor(wy/this.tile);
    return (L.data[gy]&&L.data[gy][gx])||0;
  }
  solidAt(wx,wy){
    for(const L of this.layers){
      if(!L.solid) continue;
      const gx=Math.floor(wx/this.tile), gy=Math.floor(wy/this.tile);
      if(L.data[gy]&&L.data[gy][gx]) return true;
    }
    return false;
  }
  solidsAsRects(){ // fusionne les tuiles solides en rectangles (par lignes)
    const rects=[];
    for(const L of this.layers){
      if(!L.solid) continue;
      for(let y=0;y<L.data.length;y++){
        let runStart=-1;
        for(let x=0;x<=L.data[y].length;x++){
          const solid=x<L.data[y].length&&L.data[y][x];
          if(solid&&runStart<0) runStart=x;
          if(!solid&&runStart>=0){
            rects.push(new R.Vatana(runStart*this.tile,y*this.tile,(x-runStart)*this.tile,this.tile,{static:true,gravity:0}));
            runStart=-1;
          }
        }
      }
    }
    return rects;
  }
  soraty(ctx,cam){
    const t=this.tile;
    // culling : ne dessine que les tuiles visibles
    let x0=0,y0=0,x1=this.w,y1=this.h;
    if(cam){
      x0=Math.max(0,Math.floor(cam.x/t)); y0=Math.max(0,Math.floor(cam.y/t));
      x1=Math.min(this.w,Math.ceil((cam.x+cam.viewW/cam.zoom)/t)+1);
      y1=Math.min(this.h,Math.ceil((cam.y+cam.viewH/cam.zoom)/t)+1);
    }
    for(const L of this.layers){
      if(!L.visible) continue;
      for(let y=y0;y<y1;y++){
        if(!L.data[y]) continue;
        for(let x=x0;x<x1;x++){
          const id=L.data[y][x];
          if(!id) continue;
          if(this.tileset){
            const col=(id-1)%this.tilesetCols, row=Math.floor((id-1)/this.tilesetCols);
            ctx.drawImage(this.tileset,col*t,row*t,t,t,x*t,y*t,t,t);
          } else {
            ctx.fillStyle=this.colors[id]||'#333';
            ctx.fillRect(x*t,y*t,t-1,t-1);
          }
        }
      }
    }
  }
};

/* ============================================================
 * 16. SARY & ANIMATION — sprites + spritesheet + machine d'états
 * ============================================================ */
R.Sary = class {
  constructor(imgOrUrl,opts){
    opts=opts||{};
    if(typeof imgOrUrl==='string'){
      this.img=new Image(); this.img.crossOrigin='anonymous';
      this.loaded=false;
      this.img.onload=()=>{ this.loaded=true; };
      this.img.src=imgOrUrl;
    } else { this.img=imgOrUrl; this.loaded=!!(imgOrUrl&&imgOrUrl.width); }
    this.x=opts.x||0; this.y=opts.y||0;
    this.w=opts.w||0; this.h=opts.h||0;
    this.rotation=0; this.alpha=1; this.flipX=false; this.flipY=false;
    this.anchorX=0.5; this.anchorY=0.5;
  }
  soraty(ctx,x,y,w,h){
    if(!this.loaded&&!(this.img&&this.img.width)) return;
    const W=w||this.w||this.img.width, H=h||this.h||this.img.height;
    const X=(x!=null?x:this.x), Y=(y!=null?y:this.y);
    ctx.save();
    ctx.globalAlpha=this.alpha;
    ctx.translate(X+W*this.anchorX,Y+H*this.anchorY);
    ctx.rotate(this.rotation);
    ctx.scale(this.flipX?-1:1,this.flipY?-1:1);
    ctx.drawImage(this.img,-W*this.anchorX,-H*this.anchorY,W,H);
    ctx.restore();
  }
};

R.Animation = class { // machine d'états d'animations sur spritesheet
  constructor(imgOrUrl,frameW,frameH){
    this.sheet=(imgOrUrl instanceof R.Sary)?imgOrUrl:new R.Sary(imgOrUrl);
    this.frameW=frameW||32; this.frameH=frameH||32;
    this.anims={}; // name -> {frames:[idx...], fps, loop}
    this.current=null; this.frame=0; this.time=0; this.finished=false;
    this.flipX=false;
  }
  famaritana(name,frames,fps,loop){ this.anims[name]={frames,fps:fps||10,loop:loop!==false}; return this; }
  milalao(name){ // change d'état seulement si différent
    if(this.current===name) return this;
    this.current=name; this.frame=0; this.time=0; this.finished=false;
    return this;
  }
  havaozy(dtMs){
    const a=this.anims[this.current];
    if(!a||this.finished) return;
    this.time+=dtMs;
    const spf=1000/a.fps;
    while(this.time>=spf){
      this.time-=spf; this.frame++;
      if(this.frame>=a.frames.length){
        if(a.loop) this.frame=0;
        else { this.frame=a.frames.length-1; this.finished=true; }
      }
    }
  }
  soraty(ctx,x,y,w,h){
    const a=this.anims[this.current];
    const img=this.sheet.img;
    if(!a||!img||!img.width) return;
    const idx=a.frames[this.frame];
    const cols=Math.max(1,Math.floor(img.width/this.frameW));
    const sx=(idx%cols)*this.frameW, sy=Math.floor(idx/cols)*this.frameH;
    const W=w||this.frameW, H=h||this.frameH;
    ctx.save();
    if(this.flipX){ ctx.translate(x+W,y); ctx.scale(-1,1); ctx.drawImage(img,sx,sy,this.frameW,this.frameH,0,0,W,H); }
    else ctx.drawImage(img,sx,sy,this.frameW,this.frameH,x,y,W,H);
    ctx.restore();
  }
};
  /* ============================================================
 * 17. VOVOKA — Particules : émetteur continu + burst + presets
 * ============================================================ */
R.Vovoka = class {
  constructor(){
    this.particles=[];
    this.emitters=[];
    this._pool=new R.Dobo(
      ()=>({x:0,y:0,vx:0,vy:0,life:1,decay:0.02,r:3,col:'#fff',grav:0.1,shape:'circle',rot:0,vrot:0}),
      (p,cfg)=>Object.assign(p,cfg)
    );
  }
  mipoaka(x,y,opts){ // explosion instantanée
    opts=opts||{};
    const n=opts.isany||50;
    const colors=opts.loko||['#ff1493','#00ffff','#ffd700'];
    for(let i=0;i<n;i++){
      const a=(opts.angle!=null?opts.angle+(Math.random()-0.5)*(opts.spread||Math.PI*2):Math.random()*Math.PI*2);
      const s=R.Zana.rand(opts.minSpeed||1,opts.maxSpeed||7);
      this.particles.push(this._pool.alaina({
        x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
        life:1,decay:R.Zana.rand(0.008,0.025),
        r:R.Zana.rand(1.5,opts.habe||4.5),
        col:Array.isArray(colors)?R.Zana.choice(colors):colors,
        grav:opts.grav!=null?opts.grav:0.12,
        shape:opts.shape||'circle',rot:Math.random()*Math.PI,vrot:(Math.random()-0.5)*0.2
      }));
    }
  }
  emitter(x,y,opts){ // émetteur continu (fumée, feu, fontaine...)
    const e=Object.assign({x,y,rate:5,life:Infinity,angle:-Math.PI/2,spread:0.5,
      minSpeed:0.5,maxSpeed:2,loko:['#ff8c00','#ff4500'],habe:3,grav:-0.02,_acc:0,active:true},opts||{});
    this.emitters.push(e); return e;
  }
  havaozy(dt){
    // émetteurs
    for(let i=this.emitters.length-1;i>=0;i--){
      const e=this.emitters[i];
      if(!e.active) continue;
      e.life-=dt*16.666;
      if(e.life<=0){ this.emitters.splice(i,1); continue; }
      e._acc+=e.rate*dt;
      while(e._acc>=1){
        e._acc--;
        const a=e.angle+(Math.random()-0.5)*e.spread;
        const s=R.Zana.rand(e.minSpeed,e.maxSpeed);
        this.particles.push(this._pool.alaina({
          x:e.x+(Math.random()-0.5)*(e.width||0),y:e.y,
          vx:Math.cos(a)*s,vy:Math.sin(a)*s,
          life:1,decay:R.Zana.rand(0.01,0.03),
          r:R.Zana.rand(1,e.habe),col:Array.isArray(e.loko)?R.Zana.choice(e.loko):e.loko,
          grav:e.grav,shape:e.shape||'circle',rot:0,vrot:(Math.random()-0.5)*0.1
        }));
      }
    }
    // particules
    for(let i=this.particles.length-1;i>=0;i--){
      const p=this.particles[i];
      p.x+=p.vx*dt; p.y+=p.vy*dt;
      p.vy+=p.grav*dt; p.vx*=0.99; p.rot+=p.vrot*dt;
      p.life-=p.decay*dt;
      if(p.life<=0){ this._pool.avereno(p); this.particles.splice(i,1); }
    }
  }
  soraty(ctx){
    for(const p of this.particles){
      ctx.save();
      ctx.globalAlpha=Math.max(0,p.life);
      ctx.fillStyle=p.col;
      if(p.shape==='square'){
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.r,-p.r,p.r*2,p.r*2);
      } else {
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r*p.life+0.5,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }
};

/* ============================================================
 * 18. TOETRANDRO — Météo : pluie / neige / éclairs / vent
 * ============================================================ */
R.Toetrandro = class {
  constructor(w,h){
    this.w=w||800; this.h=h||600;
    this.mode='tsy'; // 'tsy'(rien) | 'orana'(pluie) | 'oram-panala'(neige) | 'tafio-drivotra'(orage)
    this.drops=[]; this.wind=0; this._flash=0; this._nextFlash=3000;
  }
  ovay(mode,intensity){
    this.mode=mode; this.drops=[];
    const n=(intensity||1)*(mode==='oram-panala'?150:300);
    for(let i=0;i<n;i++){
      this.drops.push({
        x:Math.random()*this.w, y:Math.random()*this.h,
        s:mode==='oram-panala'?R.Zana.rand(0.3,1.2):R.Zana.rand(4,9),
        len:R.Zana.rand(6,16), r:R.Zana.rand(1,3), ph:Math.random()*Math.PI*2
      });
    }
  }
  havaozy(dt){
    this.wind=Math.sin(Date.now()*0.0003)*1.5;
    for(const d of this.drops){
      if(this.mode==='oram-panala'){
        d.y+=d.s*dt; d.x+=Math.sin(d.ph+=0.02*dt)*0.7+this.wind*0.3*dt;
      } else {
        d.y+=d.s*dt; d.x+=this.wind*dt;
      }
      if(d.y>this.h+20){ d.y=-20; d.x=Math.random()*this.w; }
      if(d.x>this.w+20) d.x=-20; if(d.x<-20) d.x=this.w+20;
    }
    if(this.mode==='tafio-drivotra'){
      this._nextFlash-=dt*16.666;
      if(this._nextFlash<=0){ this._flash=1; this._nextFlash=R.Zana.rand(2000,7000); R.Feo.mamorona('explode'); }
      if(this._flash>0) this._flash-=0.05*dt;
    }
  }
  soraty(ctx){
    if(this.mode==='tsy') return;
    ctx.save();
    if(this.mode==='oram-panala'){
      ctx.fillStyle='rgba(255,255,255,0.85)';
      for(const d of this.drops){ ctx.beginPath(); ctx.arc(d.x,d.y,d.r,0,Math.PI*2); ctx.fill(); }
    } else {
      ctx.strokeStyle='rgba(160,210,255,0.55)'; ctx.lineWidth=1;
      ctx.beginPath();
      for(const d of this.drops){ ctx.moveTo(d.x,d.y); ctx.lineTo(d.x+this.wind,d.y+d.len); }
      ctx.stroke();
    }
    if(this._flash>0){
      ctx.fillStyle='rgba(255,255,255,'+(this._flash*0.6)+')';
      ctx.fillRect(0,0,this.w,this.h);
    }
    ctx.restore();
  }
};

/* ============================================================
 * 19. HAZAVANA — éclairage 2D avec VRAIE occlusion
 *  Polygone de visibilité : rayons vers les sommets des obstacles
 * ============================================================ */
R.Hazavana = class {
  constructor(w,h){
    this.w=w||800; this.h=h||600;
    this.jiro=[];   // {x,y,halavirana,loko}
    this.sakana=[]; // rectangles {x,y,w,h}
    this.ambient=0.85; // obscurité ambiante 0..1
    this._buf=document.createElement('canvas');
    this._buf.width=this.w; this._buf.height=this.h;
    this._bctx=this._buf.getContext('2d');
  }
  ampioJiro(x,y,opts){ const j=Object.assign({x,y,halavirana:220,loko:'#ffd070'},opts||{}); this.jiro.push(j); return j; }
  ampioSakana(x,y,w,h){ this.sakana.push({x,y,w,h}); }
  _segments(){
    const segs=[];
    // bords de l'écran
    segs.push([0,0,this.w,0],[this.w,0,this.w,this.h],[this.w,this.h,0,this.h],[0,this.h,0,0]);
    for(const s of this.sakana){
      segs.push([s.x,s.y,s.x+s.w,s.y],[s.x+s.w,s.y,s.x+s.w,s.y+s.h],
                [s.x+s.w,s.y+s.h,s.x,s.y+s.h],[s.x,s.y+s.h,s.x,s.y]);
    }
    return segs;
  }
  _visibility(lx,ly){ // polygone de visibilité par lancer de rayons vers les sommets
    const segs=this._segments();
    const angles=[];
    for(const s of segs){
      for(const [px,py] of [[s[0],s[1]],[s[2],s[3]]]){
        const a=Math.atan2(py-ly,px-lx);
        angles.push(a-0.0001,a,a+0.0001); // 3 rayons par sommet (technique standard)
      }
    }
    const pts=[];
    for(const a of angles){
      const dx=Math.cos(a), dy=Math.sin(a);
      let best=null;
      for(const s of segs){
        const hit=R.Fizika.raySegment(lx,ly,dx,dy,s[0],s[1],s[2],s[3]);
        if(hit&&(!best||hit.t<best.t)) best=hit;
      }
      if(best) pts.push({a,x:best.x,y:best.y});
    }
    pts.sort((p,q)=>p.a-q.a);
    return pts;
  }
  soraty(ctx){
    const b=this._bctx;
    b.clearRect(0,0,this.w,this.h);
    b.fillStyle='rgba(0,0,0,'+this.ambient+')';
    b.fillRect(0,0,this.w,this.h);
    b.globalCompositeOperation='destination-out'; // on "perce" l'obscurité
    for(const j of this.jiro){
      const poly=this._visibility(j.x,j.y);
      if(poly.length<3) continue;
      const g=b.createRadialGradient(j.x,j.y,0,j.x,j.y,j.halavirana);
      g.addColorStop(0,'rgba(255,255,255,1)');
      g.addColorStop(0.7,'rgba(255,255,255,0.5)');
      g.addColorStop(1,'rgba(255,255,255,0)');
      b.fillStyle=g;
      b.beginPath();
      b.moveTo(poly[0].x,poly[0].y);
      for(let i=1;i<poly.length;i++) b.lineTo(poly[i].x,poly[i].y);
      b.closePath(); b.fill();
    }
    b.globalCompositeOperation='source-over';
    ctx.drawImage(this._buf,0,0);
    // halos colorés par-dessus
    ctx.save(); ctx.globalCompositeOperation='lighter';
    for(const j of this.jiro){
      const g=ctx.createRadialGradient(j.x,j.y,0,j.x,j.y,j.halavirana*0.6);
      g.addColorStop(0,j.loko+'44'); g.addColorStop(1,'transparent');
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(j.x,j.y,j.halavirana*0.6,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
};

 /* ============================================================
 * 20. TAHANTARA — Dialogues avec CHOIX + machine à écrire
 * ============================================================ */
R.Tahantara = class extends R.Hetsika {
  constructor(w,h){
    super();
    this.w=w||800; this.h=h||600;
    this.nodes={}; this.current=null;
    this.progress=0; this.speed=1.2;
    this.choiceIndex=0; this.active=false;
    this.speaker='???';
  }
  // Définir un graphe de dialogue :
  // t.node('start',{txt:'Salama!',speaker:'Maharo',next:'q1'})
  // t.node('q1',{txt:'Inona?',choices:[{label:'Eny',next:'yes'},{label:'Tsia',next:null}]})
  node(id,def){ this.nodes[id]=def; return this; }
  atombohy(id){
    this.current=this.nodes[id]||null;
    this.active=!!this.current;
    this.progress=0; this.choiceIndex=0;
    if(this.current) this.speaker=this.current.speaker||this.speaker;
    this.emit('node',id);
  }
  get _txt(){ return this.current?this.current.txt:''; }
  get vita(){ return !this.active; }
  havaozy(dtMs){
    if(!this.active) return;
    if(this.progress<this._txt.length) this.progress+=this.speed*dtMs/16.666*1.6;
    const done=this.progress>=this._txt.length;
    const F=R.Fanindry;
    if(this.current.choices&&done){
      if(F.justPressed('arrowup')) this.choiceIndex=(this.choiceIndex-1+this.current.choices.length)%this.current.choices.length;
      if(F.justPressed('arrowdown')) this.choiceIndex=(this.choiceIndex+1)%this.current.choices.length;
      if(F.justPressed(' ')||F.justPressed('enter')){
        const c=this.current.choices[this.choiceIndex];
        this.emit('safidy',c);
        if(c.action) c.action();
        if(c.next) this.atombohy(c.next); else { this.active=false; this.emit('vita'); }
      }
    } else if(F.justPressed(' ')||F.justPressed('enter')){
      if(!done){ this.progress=this._txt.length; }
      else if(this.current.next){ this.atombohy(this.current.next); }
      else { this.active=false; this.emit('vita'); }
    }
  }
  soraty(ctx){
    if(!this.active) return;
    const bx=20, bh=170, by=this.h-bh-16, bw=this.w-40;
    ctx.save();
    ctx.fillStyle='rgba(10,10,24,0.93)';
    ctx.fillRect(bx,by,bw,bh);
    ctx.strokeStyle='#00ffff'; ctx.lineWidth=2; ctx.strokeRect(bx,by,bw,bh);
    ctx.fillStyle='#ff1493'; ctx.font='bold 13px monospace';
    ctx.fillText(this.speaker.toUpperCase()+' //',bx+18,by+24);
    // machine à écrire + retour à la ligne
    const show=this._txt.slice(0,Math.floor(this.progress));
    ctx.fillStyle='#fff'; ctx.font='14px monospace';
    const words=show.split(' ');
    let line='', y=by+50, maxW=bw-40;
    for(const w of words){
      if(ctx.measureText(line+w+' ').width>maxW){ ctx.fillText(line,bx+18,y); line=w+' '; y+=20; }
      else line+=w+' ';
    }
    ctx.fillText(line,bx+18,y);
    const done=this.progress>=this._txt.length;
    if(done&&this.current.choices){
      let cy=y+28;
      this.current.choices.forEach((c,i)=>{
        ctx.fillStyle=i===this.choiceIndex?'#00ffff':'#888';
        ctx.fillText((i===this.choiceIndex?'▶ ':'  ')+c.label,bx+30,cy);
        cy+=20;
      });
    } else if(done){
      ctx.fillStyle='#00ffff'; ctx.fillText('▶ [ESPACE]',bx+bw-120,by+bh-14);
    }
    ctx.restore();
  }
};

/* ============================================================
 * 21. FABLE — quêtes / inventaire / XP / niveaux / drapeaux
 * ============================================================ */
R.Fable = class extends R.Hetsika {
  constructor(){
    super();
    this.quests=[]; this.inventory=[]; this.flags={};
    this.xp=0; this.level=1;
  }
  xpSeuil(lvl){ return Math.floor(100*Math.pow(1.5,lvl-1)); }
  omeoXp(n){
    this.xp+=n; this.emit('xp',n);
    while(this.xp>=this.xpSeuil(this.level)){
      this.xp-=this.xpSeuil(this.level); this.level++;
      this.emit('niveau',this.level);
      R.Feo.mamorona('power');
    }
  }
  quest(id,title,objectives,reward){
    const q={id,title,objectives:objectives.map(o=>typeof o==='string'?{label:o,need:1,have:0,done:false}:Object.assign({have:0,done:false,need:1},o)),
             completed:false,reward:reward||100};
    this.quests.push(q); this.emit('quest',q);
    return q;
  }
  avance(questId,objIndex,n){
    const q=this.quests.find(q=>q.id===questId);
    if(!q||q.completed) return;
    const o=q.objectives[objIndex];
    if(!o||o.done) return;
    o.have=Math.min(o.need,o.have+(n||1));
    if(o.have>=o.need){ o.done=true; this.emit('objectif',q,o); }
    if(q.objectives.every(o=>o.done)){
      q.completed=true; this.omeoXp(q.reward);
      this.emit('questVita',q); R.Feo.mamorona('coin');
    }
  }
  ampidiro(item){ // inventaire avec empilement
    const ex=this.inventory.find(i=>i.id===item.id);
    if(ex) ex.qty+=(item.qty||1);
    else this.inventory.push(Object.assign({qty:1},item));
    this.emit('item',item);
  }
  esory(itemId,qty){
    const i=this.inventory.findIndex(o=>o.id===itemId);
    if(i<0) return false;
    this.inventory[i].qty-=(qty||1);
    if(this.inventory[i].qty<=0) this.inventory.splice(i,1);
    return true;
  }
  manana(itemId){ const it=this.inventory.find(i=>i.id===itemId); return it?it.qty:0; }
  saina(flag,val){ if(val===undefined) return this.flags[flag]; this.flags[flag]=val; return val; }
  toJSON(){ return {quests:this.quests,inventory:this.inventory,flags:this.flags,xp:this.xp,level:this.level}; }
  avyJSON(d){ if(!d) return; Object.assign(this,{quests:d.quests||[],inventory:d.inventory||[],flags:d.flags||{},xp:d.xp||0,level:d.level||1}); }
};

/* ============================================================
 * 22. TEHIRIZO — Sauvegarde à SLOTS + export/import base64
 * ============================================================ */
R.Tehirizo = class {
  constructor(gameKey){ this.key=gameKey||'rakitrakatra_v2'; }
  _k(slot){ return this.key+'_slot'+(slot||0); }
  mitahiry(slot,data){
    try{
      localStorage.setItem(this._k(slot),JSON.stringify({d:data,t:Date.now(),v:R.VERSION}));
      return true;
    }catch(e){ return false; }
  }
  mampiditra(slot){
    try{ const v=localStorage.getItem(this._k(slot)); return v?JSON.parse(v).d:null; }catch(e){ return null; }
  }
  lisitra(){ // liste des slots existants avec date
    const out=[];
    for(let s=0;s<8;s++){
      try{
        const v=localStorage.getItem(this._k(s));
        if(v){ const p=JSON.parse(v); out.push({slot:s,date:new Date(p.t)}); }
      }catch(e){}
    }
    return out;
  }
  fafao(slot){ try{ localStorage.removeItem(this._k(slot)); }catch(e){} }
  avoahy(slot){ // export base64 (partage de sauvegarde)
    const v=localStorage.getItem(this._k(slot));
    return v?btoa(unescape(encodeURIComponent(v))):null;
  }
  aidiro(slot,b64){ // import base64
    try{
      const v=decodeURIComponent(escape(atob(b64)));
      JSON.parse(v); // validation
      localStorage.setItem(this._k(slot),v);
      return true;
    }catch(e){ return false; }
  }
};

/* ============================================================
 * 23. TENY — i18n (mg / fr / en) avec interpolation {x}
 * ============================================================ */
R.Teny = {
  lang:'mg', dict:{},
  ampio(lang,entries){ this.dict[lang]=Object.assign(this.dict[lang]||{},entries); return this; },
  ovay(lang){ this.lang=lang; },
  t(key,vars){
    let s=(this.dict[this.lang]&&this.dict[this.lang][key])
        ||(this.dict.mg&&this.dict.mg[key])||key;
    if(vars) for(const k in vars) s=s.replace(new RegExp('\\{'+k+'\\}','g'),vars[k]);
    return s;
  }
};
R.Teny.ampio('mg',{hello:'Salama {name}!',start:'Atomboka',quit:'Hiala',score:'Isa: {n}',pause:'Miato'});
R.Teny.ampio('fr',{hello:'Salut {name} !',start:'Commencer',quit:'Quitter',score:'Score : {n}',pause:'Pause'});
R.Teny.ampio('en',{hello:'Hello {name}!',start:'Start',quit:'Quit',score:'Score: {n}',pause:'Paused'});
  /* ============================================================
 * 24. UI — boutons, barres, panneaux, texte flottant, toast
 * ============================================================ */
R.UI = {};
R.UI.Bokotra = class {
  constructor(x,y,w,h,label,cb){
    this.x=x; this.y=y; this.w=w; this.h=h;
    this.label=label; this.cb=cb;
    this.enabled=true; this._wasDown=false;
  }
  havaozy(){
    const m=R.Fanindry.mouse;
    const inside=m.x>=this.x&&m.x<=this.x+this.w&&m.y>=this.y&&m.y<=this.y+this.h;
    this.hover=inside;
    if(this.enabled&&inside&&m.justDown){ R.Feo.mamorona('pickup'); if(this.cb) this.cb(); }
  }
  soraty(ctx){
    ctx.save();
    ctx.globalAlpha=this.enabled?1:0.4;
    ctx.fillStyle=this.hover?'#ff1493':'rgba(255,20,147,0.15)';
    ctx.fillRect(this.x,this.y,this.w,this.h);
    ctx.strokeStyle=this.hover?'#fff':'#ff1493'; ctx.lineWidth=2;
    ctx.strokeRect(this.x,this.y,this.w,this.h);
    ctx.fillStyle='#fff'; ctx.font='bold 13px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(this.label,this.x+this.w/2,this.y+this.h/2);
    ctx.restore();
  }
};
R.UI.Bara = class { // barre générique (HP, mana, XP...)
  constructor(x,y,w,h,opts){
    opts=opts||{};
    this.x=x; this.y=y; this.w=w; this.h=h;
    this.max=opts.max||100; this.value=opts.value!=null?opts.value:this.max;
    this._shown=this.value; // valeur animée
    this.colors=opts.colors||['#ff1493','#00ffff'];
    this.label=opts.label||'';
  }
  havaozy(dt){ this._shown=R.Zana.lerp(this._shown,this.value,0.1*dt); }
  soraty(ctx){
    ctx.save();
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(this.x,this.y,this.w,this.h);
    const pct=R.Zana.clamp(this._shown/this.max,0,1);
    const g=ctx.createLinearGradient(this.x,0,this.x+this.w,0);
    g.addColorStop(0,this.colors[0]); g.addColorStop(1,this.colors[1]);
    ctx.fillStyle=g; ctx.fillRect(this.x+1,this.y+1,(this.w-2)*pct,this.h-2);
    ctx.strokeStyle=this.colors[0]; ctx.strokeRect(this.x,this.y,this.w,this.h);
    if(this.label){
      ctx.fillStyle='#fff'; ctx.font='10px monospace';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(this.label+' '+Math.ceil(this.value)+'/'+this.max,this.x+this.w/2,this.y+this.h/2);
    }
    ctx.restore();
  }
};
R.UI.TextFlottant = class { // dégâts flottants "+10" etc.
  constructor(){ this.items=[]; }
  ampio(x,y,txt,color){ this.items.push({x,y,txt,color:color||'#ffd700',life:1}); }
  havaozy(dt){
    for(let i=this.items.length-1;i>=0;i--){
      const it=this.items[i];
      it.y-=0.8*dt; it.life-=0.02*dt;
      if(it.life<=0) this.items.splice(i,1);
    }
  }
  soraty(ctx){
    ctx.save(); ctx.font='bold 14px monospace'; ctx.textAlign='center';
    for(const it of this.items){
      ctx.globalAlpha=Math.max(0,it.life);
      ctx.fillStyle=it.color; ctx.fillText(it.txt,it.x,it.y);
    }
    ctx.restore();
  }
};
R.UI.Toast = class { // notifications empilées
  constructor(w){ this.w=w||800; this.items=[]; }
  ampio(txt,color){ this.items.push({txt,color:color||'#00ffff',life:3000,y:-30}); }
  havaozy(dtMs){
    let targetY=12;
    for(let i=this.items.length-1;i>=0;i--){
      const it=this.items[i];
      it.life-=dtMs;
      it.y=R.Zana.lerp(it.y,targetY,0.15);
      targetY+=34;
      if(it.life<=0) this.items.splice(i,1);
    }
  }
  soraty(ctx){
    ctx.save(); ctx.font='12px monospace'; ctx.textAlign='center';
    for(const it of this.items){
      const alpha=Math.min(1,it.life/500);
      ctx.globalAlpha=alpha*0.9;
      const tw=ctx.measureText(it.txt).width+30;
      ctx.fillStyle='rgba(10,10,24,0.9)';
      ctx.fillRect(this.w/2-tw/2,it.y,tw,26);
      ctx.strokeStyle=it.color; ctx.strokeRect(this.w/2-tw/2,it.y,tw,26);
      ctx.fillStyle='#fff'; ctx.fillText(it.txt,this.w/2,it.y+17);
    }
    ctx.restore();
  }
};

/* ============================================================
 * 25. SARINTANY — Minimap réelle (entités + fog + viewport)
 * ============================================================ */
R.Sarintany = class {
  constructor(opts){
    opts=opts||{};
    this.habe=opts.habe||150;
    this.worldW=opts.worldW||1600; this.worldH=opts.worldH||1200;
    this.entities=[]; // {ref, color, size}
    this.fog=opts.fog||null; // R.Zavona optionnel
    this.cam=opts.cam||null;
  }
  araho(ref,color,size){ this.entities.push({ref,color:color||'#fff',size:size||3}); return this; }
  soraty(ctx){
    const w=this.habe, h=this.habe*(this.worldH/this.worldW);
    const x=ctx.canvas.width-w-12, y=12;
    const sx=w/this.worldW, sy=h/this.worldH;
    ctx.save();
    ctx.fillStyle='rgba(0,0,0,0.8)'; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='#8a2be2'; ctx.lineWidth=2; ctx.strokeRect(x,y,w,h);
    ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
    if(this.fog){ // zones explorées en teinte claire
      ctx.fillStyle='rgba(0,255,255,0.10)';
      const cs=this.fog.cell||40;
      for(let gy=0;gy<this.fog.h;gy++) for(let gx=0;gx<this.fog.w;gx++)
        if(this.fog.map[gy][gx]) ctx.fillRect(x+gx*cs*sx,y+gy*cs*sy,cs*sx+1,cs*sy+1);
    }
    for(const e of this.entities){ // vraies positions
      if(!e.ref||e.ref.dead) continue;
      ctx.fillStyle=e.color;
      ctx.beginPath();
      ctx.arc(x+e.ref.x*sx,y+e.ref.y*sy,e.size,0,Math.PI*2);
      ctx.fill();
    }
    if(this.cam){ // rectangle du viewport caméra
      ctx.strokeStyle='rgba(255,255,255,0.6)'; ctx.lineWidth=1;
      ctx.strokeRect(x+this.cam.x*sx,y+this.cam.y*sy,
        (this.cam.viewW/this.cam.zoom)*sx,(this.cam.viewH/this.cam.zoom)*sy);
    }
    ctx.restore();
  }
};

/* ============================================================
 * 26. ZAVONA — Fog of war (cellules paramétrables)
 * ============================================================ */
R.Zavona = class {
  constructor(worldW,worldH,cell){
    this.cell=cell||40;
    this.w=Math.ceil(worldW/this.cell); this.h=Math.ceil(worldH/this.cell);
    this.map=Array.from({length:this.h},()=>Array(this.w).fill(false));
  }
  manokatra(wx,wy,radius){ // révéler un disque (pas un carré)
    const r=radius||2;
    const gx=Math.floor(wx/this.cell), gy=Math.floor(wy/this.cell);
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
      if(dx*dx+dy*dy>r*r) continue;
      const X=gx+dx, Y=gy+dy;
      if(X>=0&&Y>=0&&X<this.w&&Y<this.h) this.map[Y][X]=true;
    }
  }
  hita(wx,wy){ 
    const gx=Math.floor(wx/this.cell), gy=Math.floor(wy/this.cell);
    return !!(this.map[gy]&&this.map[gy][gx]);
  }
  soraty(ctx,cam){
    ctx.save();
    ctx.fillStyle='rgba(4,4,12,0.85)';
    const camX=cam?cam.x:0, camY=cam?cam.y:0;
    const vw=cam?cam.viewW/cam.zoom:ctx.canvas.width, vh=cam?cam.viewH/cam.zoom:ctx.canvas.height;
    const x0=Math.max(0,Math.floor(camX/this.cell)), y0=Math.max(0,Math.floor(camY/this.cell));
    const x1=Math.min(this.w,Math.ceil((camX+vw)/this.cell)+1), y1=Math.min(this.h,Math.ceil((camY+vh)/this.cell)+1);
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++)
      if(!this.map[y][x]) ctx.fillRect(x*this.cell,y*this.cell,this.cell+1,this.cell+1);
    ctx.restore();
  }
};

/* ============================================================
 * 27. IK — chaîne à N segments (FABRIK) — bras, tentacules
 * ============================================================ */
R.IK = class {
  constructor(baseX,baseY,lengths){
    this.base={x:baseX,y:baseY};
    this.lengths=lengths||[100,80,60];
    this.joints=[{x:baseX,y:baseY}];
    let x=baseX;
    for(const L of this.lengths){ x+=L; this.joints.push({x,y:baseY}); }
  }
  solve(tx,ty,iterations){ // FABRIK : Forward And Backward Reaching IK
    const total=this.lengths.reduce((a,b)=>a+b,0);
    const d=R.Zana.dist(this.base.x,this.base.y,tx,ty);
    if(d>total){ // cible hors de portée : bras tendu
      const a=Math.atan2(ty-this.base.y,tx-this.base.x);
      let x=this.base.x, y=this.base.y;
      this.joints[0]={x,y};
      for(let i=0;i<this.lengths.length;i++){
        x+=Math.cos(a)*this.lengths[i]; y+=Math.sin(a)*this.lengths[i];
        this.joints[i+1]={x,y};
      }
      return this.joints;
    }
    for(let it=0;it<(iterations||8);it++){
      // backward : dernier joint sur la cible
      const n=this.joints.length;
      this.joints[n-1]={x:tx,y:ty};
      for(let i=n-2;i>=0;i--){
        const a=Math.atan2(this.joints[i].y-this.joints[i+1].y,this.joints[i].x-this.joints[i+1].x);
        this.joints[i]={x:this.joints[i+1].x+Math.cos(a)*this.lengths[i],y:this.joints[i+1].y+Math.sin(a)*this.lengths[i]};
      }
      // forward : premier joint sur la base
      this.joints[0]={x:this.base.x,y:this.base.y};
      for(let i=1;i<n;i++){
        const a=Math.atan2(this.joints[i].y-this.joints[i-1].y,this.joints[i].x-this.joints[i-1].x);
        this.joints[i]={x:this.joints[i-1].x+Math.cos(a)*this.lengths[i-1],y:this.joints[i-1].y+Math.sin(a)*this.lengths[i-1]};
      }
    }
    return this.joints;
  }
  soraty(ctx,colors){
    colors=colors||['#00ffff','#ff1493','#ffd700'];
    for(let i=0;i<this.joints.length-1;i++){
      ctx.strokeStyle=colors[i%colors.length];
      ctx.lineWidth=Math.max(4,14-i*3); ctx.lineCap='round';
      ctx.beginPath();
      ctx.moveTo(this.joints[i].x,this.joints[i].y);
      ctx.lineTo(this.joints[i+1].x,this.joints[i+1].y);
      ctx.stroke();
    }
    for(const j of this.joints){
      ctx.fillStyle='#fff';
      ctx.beginPath(); ctx.arc(j.x,j.y,4,0,Math.PI*2); ctx.fill();
    }
  }
};

 /* ============================================================
 * 28. SPLINE — Catmull-Rom (passe par TOUS les points) + longueur
 * ============================================================ */
R.Spline = class {
  constructor(points,closed){
    this.points=points||[]; this.closed=!!closed;
  }
  _pt(i){
    const n=this.points.length;
    if(this.closed) return this.points[((i%n)+n)%n];
    return this.points[R.Zana.clamp(i,0,n-1)];
  }
  manaraka(t){ // t dans [0,1] sur toute la courbe
    const n=this.closed?this.points.length:this.points.length-1;
    if(n<1) return this.points[0]||{x:0,y:0};
    t=R.Zana.clamp(t,0,0.99999)*n;
    const i=Math.floor(t), f=t-i;
    const p0=this._pt(i-1), p1=this._pt(i), p2=this._pt(i+1), p3=this._pt(i+2);
    const f2=f*f, f3=f2*f;
    return { // Catmull-Rom standard (tension 0.5)
      x:0.5*((2*p1.x)+(-p0.x+p2.x)*f+(2*p0.x-5*p1.x+4*p2.x-p3.x)*f2+(-p0.x+3*p1.x-3*p2.x+p3.x)*f3),
      y:0.5*((2*p1.y)+(-p0.y+p2.y)*f+(2*p0.y-5*p1.y+4*p2.y-p3.y)*f2+(-p0.y+3*p1.y-3*p2.y+p3.y)*f3)
    };
  }
  tangent(t){ const e=0.001; const a=this.manaraka(Math.max(0,t-e)), b=this.manaraka(Math.min(1,t+e)); return Math.atan2(b.y-a.y,b.x-a.x); }
  halava(steps){ // longueur approchée
    let len=0, prev=this.manaraka(0);
    const n=steps||100;
    for(let i=1;i<=n;i++){ const p=this.manaraka(i/n); len+=R.Zana.dist(prev.x,prev.y,p.x,p.y); prev=p; }
    return len;
  }
  soraty(ctx,opts){
    opts=opts||{};
    if(this.points.length<2) return;
    ctx.save();
    ctx.strokeStyle=opts.loko||'#8a2be2'; ctx.lineWidth=opts.tevina||3;
    ctx.beginPath();
    const p0=this.manaraka(0); ctx.moveTo(p0.x,p0.y);
    for(let t=0.01;t<=1;t+=0.01){ const p=this.manaraka(t); ctx.lineTo(p.x,p.y); }
    ctx.stroke();
    if(opts.points!==false){
      for(const p of this.points){
        ctx.fillStyle='#ff1493';
        ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
  }
};

/* ============================================================
 * 29. POLYGON — SAT (Separating Axis Theorem) + point-in-poly
 * ============================================================ */
R.Polygon = class {
  constructor(pts,x,y){
    this.points=pts||[]; this.x=x||0; this.y=y||0;
    this.rotation=0; this.loko='#8a2be2';
  }
  static regular(cx,cy,r,sides){ // polygone régulier
    const pts=[];
    for(let i=0;i<sides;i++){
      const a=i/sides*Math.PI*2-Math.PI/2;
      pts.push({x:Math.cos(a)*r,y:Math.sin(a)*r});
    }
    return new R.Polygon(pts,cx,cy);
  }
  world(){ // points transformés (position + rotation)
    const c=Math.cos(this.rotation), s=Math.sin(this.rotation);
    return this.points.map(p=>({x:this.x+p.x*c-p.y*s,y:this.y+p.x*s+p.y*c}));
  }
  contains(px,py){
    const pts=this.world();
    let inside=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const xi=pts[i].x, yi=pts[i].y, xj=pts[j].x, yj=pts[j].y;
      if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
  }
  static _axes(pts){
    const axes=[];
    for(let i=0;i<pts.length;i++){
      const p1=pts[i], p2=pts[(i+1)%pts.length];
      const nx=-(p2.y-p1.y), ny=p2.x-p1.x;
      const l=Math.hypot(nx,ny)||1;
      axes.push({x:nx/l,y:ny/l});
    }
    return axes;
  }
  static _project(pts,axis){
    let min=Infinity, max=-Infinity;
    for(const p of pts){
      const d=p.x*axis.x+p.y*axis.y;
      if(d<min) min=d; if(d>max) max=d;
    }
    return {min,max};
  }
  mifandona(other){ // SAT — collision convexe exacte
    const a=this.world(), b=other.world();
    for(const axis of [...R.Polygon._axes(a),...R.Polygon._axes(b)]){
      const pa=R.Polygon._project(a,axis), pb=R.Polygon._project(b,axis);
      if(pa.max<pb.min||pb.max<pa.min) return false; // axe séparateur trouvé
    }
    return true;
  }
  soraty(ctx){
    const pts=this.world();
    if(pts.length<3) return;
    ctx.save();
    ctx.fillStyle=this.loko+'55'; ctx.strokeStyle=this.loko; ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
};

/* ============================================================
 * 30. RANO — eau à colonnes ressort (vraies vagues interactives)
 * ============================================================ */
R.Rano = class {
  constructor(x,y,w,h,opts){
    opts=opts||{};
    this.x=x; this.y=y; this.w=w; this.h=h;
    this.loko=opts.loko||'rgba(0,160,230,0.55)';
    this.cols=[]; // colonnes ressort (modèle classique "spring water")
    const n=Math.max(10,Math.floor(w/12));
    for(let i=0;i<=n;i++) this.cols.push({y:0,v:0});
    this.k=0.025; this.damp=0.025; this.spread=0.25;
    this.time=0;
  }
  latsaka(wx,force){ // splash à la position monde wx
    const i=Math.round((wx-this.x)/this.w*(this.cols.length-1));
    if(this.cols[i]) this.cols[i].v+=(force||8);
    R.Feo.mamorona('step');
  }
  havaozy(dt){
    this.time+=dt*0.04;
    // ressorts
    for(const c of this.cols){
      const acc=-this.k*c.y-this.damp*c.v;
      c.v+=acc*dt; c.y+=c.v*dt;
    }
    // propagation aux voisins (2 passes pour la stabilité)
    for(let pass=0;pass<2;pass++){
      const dl=[], dr=[];
      for(let i=0;i<this.cols.length;i++){
        dl[i]=i>0?this.spread*(this.cols[i].y-this.cols[i-1].y):0;
        dr[i]=i<this.cols.length-1?this.spread*(this.cols[i].y-this.cols[i+1].y):0;
      }
      for(let i=0;i<this.cols.length;i++){
        if(i>0) this.cols[i-1].v+=dl[i]*dt;
        if(i<this.cols.length-1) this.cols[i+1].v+=dr[i]*dt;
      }
    }
  }
  surfaceY(wx){ // hauteur de l'eau à wx (pour flottaison)
    const f=(wx-this.x)/this.w*(this.cols.length-1);
    const i=R.Zana.clamp(Math.floor(f),0,this.cols.length-2);
    const y0=this.cols[i].y, y1=this.cols[i+1].y;
    return this.y+R.Zana.lerp(y0,y1,f-i)+Math.sin(wx*0.02+this.time)*2;
  }
  soraty(ctx){
    ctx.save();
    const step=this.w/(this.cols.length-1);
    ctx.fillStyle=this.loko;
    ctx.beginPath();
    ctx.moveTo(this.x,this.y+this.h);
    for(let i=0;i<this.cols.length;i++){
      ctx.lineTo(this.x+i*step,this.y+this.cols[i].y+Math.sin(i*0.5+this.time)*1.5);
    }
    ctx.lineTo(this.x+this.w,this.y+this.h);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=2;
    ctx.beginPath();
    for(let i=0;i<this.cols.length;i++){
      const px=this.x+i*step, py=this.y+this.cols[i].y+Math.sin(i*0.5+this.time)*1.5;
      if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.stroke();
    ctx.restore();
  }
};

                                                              
