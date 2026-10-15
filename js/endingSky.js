/* v38-2 — Improve measured star visibility and contrast; retain the v38-1 observer sky engine.
 * 46 measured cupmarks are read from the existing dataset.
 * Spherical directions are interpretive visual mapping, not historical star coordinates. */
(function(){
'use strict';

let data=[];
const SOURCE='data/cupmarks-measured.json';
const REFERENCE_GRADES={"C01":[1,2],"C02":[2,3],"C03":[3,4],"C04":[2,2],"C05":[3,3],"C06":[4,4],"C07":[5,5],"C08":[3,3],"C09":[3,3],"C10":[4,2],"C11":[5,4],"C12":[4,4],"C13":[4,1],"C14":[3,3],"C15":[1,1],"C16":[3,2],"C17":[1,1],"C18":[1,3],"C19":[3,4],"C20":[4,4],"C21":[4,4],"C22":[4,3],"C23":[1,2],"C24":[5,5],"C25":[3,5],"C26":[4,3],"C27":[4,2],"C28":[4,3],"C29":[4,3],"C30":[3,4],"C31":[4,4],"C32":[3,5],"C33":[4,5],"C34":[5,4],"C35":[5,4],"C36":[5,4],"C37":[5,4],"C38":[4,5],"C39":[4,5],"C40":[4,4],"C41":[5,5],"C42":[4,5],"C43":[4,5],"C44":[5,5],"C45":[4,5],"C46":[4,3]};
const canvas=document.getElementById('endingSkyCanvas');
const host=document.getElementById('exhibition-ending');
const controls=document.getElementById('endingViewControls');
if(!canvas||!host){window.initEndingSky=()=>{};return;}
const ctx=canvas.getContext('2d',{alpha:false});
if(!ctx){window.initEndingSky=()=>{};return;}
const hint=null;
const D2R=Math.PI/180,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let W=0,H=0,DPR=1;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ================= settings =================
const ROTATION_PERIOD=900;          // seconds for one full turn of the sky (larger = slower)
const SWEEP_EASE=0.6;               // 0 = constant speed; higher = sweeps slowly while the stars are in view and faster while they are out of sight
const PITCH_LOW=50*D2R;             // how high the observer looks up at the normal zoom (degrees above the horizon)
const FOV_DEFAULT=130,FOV_MIN=45;   // field of view (degrees); smaller = zoomed in
let FOV_MAX=250;                    // set in resize(): the zoom-out limit where the whole sky fits inside a circle
let hillK=1;                        // how tall the hills are (they flatten as you zoom out so the black rim becomes a round circle)
const PAN_LIMIT=100*D2R;            // how far left/right the view may turn
// The stars are spread over the whole sky: AZ_SPAN = width in degrees around the observer, ALT_MIN..ALT_MAX = height
// (86 is almost straight overhead). AZ_SPAN 360 = all the way around the observer.
// Star positions are the measured x / z coordinates, only scaled evenly onto this sky range (nothing is moved individually).
const SKY={AZ_SPAN:360,ALT_MIN:8,ALT_MAX:86};
// Like the real night sky seen by an observer facing the equator side: the whole sky sweeps sideways across the view
// (rising on one side, setting behind the hills on the other) around an axis that sits behind the observer, at latitude LAT.
const LAT=36.5*D2R;

// ================= star data → sky directions =================
function prepareStarVectors(){
const xs=data.map(p=>p.x),zs=data.map(p=>p.z);
const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
data.forEach(p=>{p.fx=(p.x-minX)/(maxX-minX||1);p.fz=(p.z-minZ)/(maxZ-minZ||1);});   // exact proportional position
for(const p of data){
  const az=(p.fx-.5)*SKY.AZ_SPAN*D2R;
  const alt=(SKY.ALT_MIN+p.fz*(SKY.ALT_MAX-SKY.ALT_MIN))*D2R;
  p.v=[Math.cos(alt)*Math.sin(az),Math.cos(alt)*Math.cos(az),Math.sin(alt)]; // east, north, up
}
}
const POLE=[0,-Math.cos(LAT),Math.sin(LAT)];   // sky rotation axis: behind the observer, tilted up by the latitude
function rotateAboutPole(v,phi){
  const c=Math.cos(phi),s=Math.sin(phi),P=POLE;
  const cr=[P[1]*v[2]-P[2]*v[1],P[2]*v[0]-P[0]*v[2],P[0]*v[1]-P[1]*v[0]];
  const d=(P[0]*v[0]+P[1]*v[1]+P[2]*v[2])*(1-c);
  return [v[0]*c+cr[0]*s+P[0]*d,v[1]*c+cr[1]*s+P[1]*d,v[2]*c+cr[2]*s+P[2]*d];
}

// ================= camera (stereographic, like Stellarium) =================
const view={az:0,fov:FOV_DEFAULT},target={az:0,fov:FOV_DEFAULT};
let cam={R:[1,0,0],U:[0,0,1],F:[0,1,0],k:400};
const smooth=x=>x*x*(3-2*x);
// Zooming out also tilts the observer's gaze up to the zenith, so at the maximum zoom-out you lie on your back
// and see the whole sky as a round dome with the horizon forming a black circle around it.
function zoomMix(){return smooth(clamp((view.fov-FOV_DEFAULT)/(FOV_MAX-FOV_DEFAULT),0,1));}
function updateCamera(){
  const m=zoomMix(),pitch=PITCH_LOW+(Math.PI/2-PITCH_LOW)*m;hillK=1-0.75*m;
  const sy=Math.sin(view.az),cy=Math.cos(view.az),sp=Math.sin(pitch),cp=Math.cos(pitch);
  cam.R=[cy,-sy,0];cam.U=[-sp*sy,-sp*cy,cp];cam.F=[cp*sy,cp*cy,sp];
  cam.k=(W/2)/(2*Math.tan(view.fov*D2R/4));
}
function projectRaw(v){
  const {R,U,F,k}=cam,cz=v[0]*F[0]+v[1]*F[1]+v[2]*F[2],m=2*k/Math.max(0.03,1+cz);
  return [W/2+m*(v[0]*R[0]+v[1]*R[1]+v[2]*R[2]),H/2-m*(v[0]*U[0]+v[1]*U[1]+v[2]*U[2])];
}
function project(v){
  const {R,U,F,k}=cam,cz=v[0]*F[0]+v[1]*F[1]+v[2]*F[2];
  if(cz<-0.6)return null;
  const m=2*k/(1+cz);
  return [W/2+m*(v[0]*R[0]+v[1]*R[1]+v[2]*R[2]),H/2-m*(v[0]*U[0]+v[1]*U[1]+v[2]*U[2])];
}

// ================= landscape: hills + treeline silhouette =================
const hs=i=>{const v=Math.sin(i*127.1+311.7)*43758.5453;return v-Math.floor(v);};
const md=(i,P)=>((i%P)+P)%P;
function n1(x,P){const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);return hs(md(i,P))*(1-u)+hs(md(i+1,P))*u;}   // repeats every 360° so there is no seam
// Treeline: a ring of individual tree crowns (round broadleaf tops and pointed conifer tops of different sizes) that overlap
// into a natural ragged edge. Built once as a lookup table (0.05° steps) and read with interpolation.
const PROF_N=7200,profile=new Float32Array(PROF_N);
(function(){
  const rnd=rng(77),crowns=[];
  for(let c=0;c<360;c+=0.3+rnd()*0.8)crowns.push({c,w:0.45+rnd()*1.1,h:0.5+Math.pow(rnd(),1.5)*2.3,pointed:rnd()<0.45});
  for(let i=0;i<PROF_N;i++){
    const az=i*360/PROF_N;let m=0;
    for(const k of crowns){
      let d=Math.abs(az-k.c);if(d>180)d=360-d;if(d>=k.w)continue;
      const u=d/k.w,v=k.pointed?k.h*Math.pow(1-u,1.25):k.h*Math.sqrt(1-u*u);
      if(v>m)m=v;
    }
    profile[i]=m;
  }
})();
function profAt(az){
  const x=(((az%360)+360)%360)*PROF_N/360,i=Math.floor(x),f=x-i;
  return profile[i%PROF_N]*(1-f)+profile[(i+1)%PROF_N]*f;
}
// Wind blowing along the ridge: slow swells in strength, gusts that travel from left to right, quick small ripples
function wind(az,t){
  const gust=0.55+0.45*Math.sin(t*0.31)*Math.sin(t*0.13+1.0);
  const wave=0.55*Math.sin(t*1.1-az*0.07)+0.3*Math.sin(t*2.3-az*0.15+1.7)+0.15*Math.sin(t*4.1-az*0.33);
  return gust*(0.55+wave);   // leans downwind most of the time, swaying back and forth as gusts pass
}
// horizon height (degrees) at an azimuth: smooth hills (low valley in front, higher to both sides) plus the swaying treeline
function skyline(az,t){
  const a=az*D2R;
  let h=2.2+hillK*(16*(1-Math.cos(a))+1.6*Math.sin(3*a+1.3)+1.1*Math.sin(7*a+0.4)+0.6*Math.sin(18*a+2));
  h=Math.min(h,30);
  const tree=clamp((h-2.5)/4,0.5,1),w=wind(az,t);
  const top=profAt(az-0.5*w)*(1+0.05*w);                                   // crowns lean and sway sideways, breathing up and down
  const leaf=0.14*Math.abs(w)*(n1(az*12+t*2.6,4320)-.5)*2;                 // leaves fluttering at the edge
  return h+tree*(top+leaf);
}
// outline of the sky region = the horizon seen from the observer (a closed loop; everything outside it is ground)
function horizonPolygon(t){
  const pts=[];
  for(let az=-180;az<180;az+=0.2){
    const a=az*D2R,al=skyline(az,t)*D2R;
    pts.push(projectRaw([Math.cos(al)*Math.sin(a),Math.cos(al)*Math.cos(a),Math.sin(al)]));
  }
  return pts;
}

// ================= star look =================
const STAR_BRIGHTNESS=1;   // measured cupmarks are the only stars; keep every depth grade plainly visible

const radiusByGrade={1:3.1,2:2.85,3:2.6,4:2.3,5:2.05};
const depthStyle={
  1:{color:[133,190,255],core:'#e7f5ff',glow:[67,137,235],brightness:.98},
  2:{color:[115,174,255],core:'#dceeff',glow:[59,122,220],brightness:.91},
  3:{color:[238,242,255],core:'#ffffff',glow:[165,184,222],brightness:.82},
  4:{color:[255,171,137],core:'#fff0e4',glow:[218,100,79],brightness:.73},
  5:{color:[255,137,115],core:'#ffe4d7',glow:[194,66,57],brightness:.64}
};
function rng(seed){let t=(seed*2654435761+1013904223)>>>0;return()=>{t=(t+0x6D2B79F5)>>>0;let n=Math.imul(t^t>>>15,1|t);n=n+Math.imul(n^n>>>7,61|n)^n;return((n^n>>>14)>>>0)/4294967296;};}
function hexRgb(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)].join(',');}
function makeRays(n,base,rnd,spread){
  const rays=[];
  for(let k=0;k<n;k++)rays.push({ang:k*(Math.PI*2/n)+(rnd()-.5)*spread,len:base*(0.45+rnd()*0.75),w:0.10+rnd()*0.07,a:0.45+rnd()*0.4});
  return rays;
}
const kindsByGrade={1:['five','six','burst','cross'],2:['six','five','cross','burst'],3:['cross','five','twin','soft'],4:['soft','twin','soft','cross'],5:['soft','soft','twin','soft']};
const shapeCache={};
function shapeOf(i,grade){
  if(shapeCache[i])return shapeCache[i];
  const rnd=rng(i+7),list=kindsByGrade[grade],kind=list[Math.floor(rnd()*list.length)],rot=rnd()*Math.PI;
  const baseLen={1:3.3,2:3.1,3:2.9,4:2.6,5:2.3}[grade];
  let rays=[],core=1;
  if(kind==='soft')core=1.25;
  else if(kind==='twin')rays=makeRays(2,baseLen,rnd,0.25);
  else if(kind==='cross')rays=makeRays(4,baseLen,rnd,0.35);
  else if(kind==='five')rays=makeRays(5,baseLen,rnd,0.3);
  else if(kind==='six')rays=makeRays(6,baseLen,rnd,0.3);
  else rays=makeRays(8,baseLen*1.05,rnd,0.4);
  return shapeCache[i]={kind,rot,rays,core};
}

// ================= occasional glints: now and then a random seonghyeol star flares up with a + or * shaped spike =================
const GLINT_EVERY=[1.5,3.8]; // seconds between flares (min,max); each flare lasts about 2-3 seconds (smaller numbers = more often)
const GLINT_STRENGTH=1;      // 0 = off, higher = brighter and longer spikes (only existing stars flare; none are added)
let glints=[],nextGlint=1.5;
function scheduleGlints(t,ang){
  if(reducedMotion||GLINT_STRENGTH<=0)return;
  glints=glints.filter(g=>t-g.t0<g.dur);
  if(t<nextGlint||glints.length>=3)return;
  const cand=[];
  for(let i=0;i<data.length;i++){
    if(glints.some(g=>g.i===i))continue;
    const v=rotateAboutPole(data[i].v,-ang),q=project(v);
    if(!q||q[0]<30||q[0]>W-30||q[1]<30||q[1]>H-30)continue;
    if(Math.asin(clamp(v[2],-1,1))/D2R<skyline(Math.atan2(v[0],v[1])/D2R,t)+3)continue;   // not behind the hills
    cand.push(i);
  }
  nextGlint=t+GLINT_EVERY[0]+Math.random()*(GLINT_EVERY[1]-GLINT_EVERY[0]);
  if(!cand.length)return;
  glints.push({i:cand[Math.floor(Math.random()*cand.length)],t0:t,dur:2+Math.random()*1.2,kind:Math.random()<.5?'plus':'star',rot:(Math.random()-.5)*0.1});
}
function glintEnv(p){p=clamp(p,0,1);if(p<0.15)return Math.sin(p/0.15*Math.PI/2);const q=(p-0.15)/0.85;return Math.pow(1-q,1.7);}   // quick flare-up, slow fade
function drawGlint(x,y,r,s,e,kind,rot,zf,grade){
  const base=(11+(6-grade)*3)*zf*(0.6+0.4*GLINT_STRENGTH),w=Math.max(0.55,r*0.3)*(0.7+0.3*e),c=hexRgb(s.core);
  // 'plus' = 4 spikes (+); 'star' = 4 long spikes plus 4 shorter diagonal ones (*)
  const rays=kind==='plus'?[[0,1],[1,1],[2,1],[3,1]]:[[0,1],[1,1],[2,1],[3,1],[0.5,0.55],[1.5,0.55],[2.5,0.55],[3.5,0.55]];
  ctx.save();ctx.translate(x,y);ctx.globalCompositeOperation='lighter';
  for(const [k,len] of rays){
    const L=base*len*e;
    ctx.save();ctx.rotate(rot+k*Math.PI/2);
    const g=ctx.createLinearGradient(0,0,L,0);
    g.addColorStop(0,`rgba(${c},${0.95*e})`);
    g.addColorStop(.35,`rgba(${s.color[0]},${s.color[1]},${s.color[2]},${0.45*e})`);
    g.addColorStop(1,`rgba(${s.color[0]},${s.color[1]},${s.color[2]},0)`);
    ctx.fillStyle=g;ctx.beginPath();
    ctx.moveTo(0,-w);ctx.quadraticCurveTo(L*.25,-w*.4,L,0);ctx.quadraticCurveTo(L*.25,w*.4,0,w);ctx.closePath();ctx.fill();
    ctx.restore();
  }
  const fr=r*(2.2+2.2*e),fg=ctx.createRadialGradient(0,0,0,0,0,fr);
  fg.addColorStop(0,`rgba(255,255,255,${0.9*e})`);
  fg.addColorStop(.4,`rgba(${s.color[0]},${s.color[1]},${s.color[2]},${0.35*e})`);
  fg.addColorStop(1,`rgba(${s.color[0]},${s.color[1]},${s.color[2]},0)`);
  ctx.fillStyle=fg;ctx.beginPath();ctx.arc(0,0,fr,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ================= drawing =================
let skyTimeSeconds=0;
function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2);
  W=Math.max(1,host.clientWidth||innerWidth);H=Math.max(1,host.clientHeight||innerHeight);   // the window can report 0 size while loading
  canvas.width=W*DPR;canvas.height=H*DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const fm=4*Math.atan(W/(0.92*Math.min(W,H)))/D2R;   // horizon circle ends up ~92% of the shorter screen side
  FOV_MAX=isFinite(fm)?clamp(fm,FOV_DEFAULT+30,300):250;
  if(!isFinite(target.fov))target.fov=FOV_DEFAULT;if(!isFinite(view.fov))view.fov=FOV_DEFAULT;
  target.fov=Math.min(target.fov,FOV_MAX);view.fov=Math.min(view.fov,FOV_MAX);
}
function draw(now){
  const t=reducedMotion?0:skyTimeSeconds;
  updateCamera();
  // sky: deep navy at the zenith, lighter bluish glow toward the horizon
  const Zp=projectRaw([0,0,1]),h0=3*D2R,Fp=projectRaw([Math.sin(view.az)*Math.cos(h0),Math.cos(view.az)*Math.cos(h0),Math.sin(h0)]);
  const Rg=Math.max(60,Math.hypot(Fp[0]-Zp[0],Fp[1]-Zp[1]));
  const bg=ctx.createRadialGradient(Zp[0],Zp[1],0,Zp[0],Zp[1],Rg);
  bg.addColorStop(0,'#030814');bg.addColorStop(.55,'#07122a');bg.addColorStop(1,'#243a63');
  ctx.fillStyle='#243a63';ctx.fillRect(0,0,W,H);
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

  // stars: only the seonghyeol data; the whole pattern turns around the pole as the night goes on
  const phi=t*2*Math.PI/ROTATION_PERIOD,ang=phi-SWEEP_EASE*Math.sin(phi),zf=Math.pow(FOV_DEFAULT/view.fov,0.4);
  scheduleGlints(t,ang);const gmap={};for(const g of glints)gmap[g.i]=g;
  for(let i=0;i<data.length;i++){
    const p=data[i],q=project(rotateAboutPole(p.v,-ang));
    if(!q)continue;
    const x=q[0],y=q[1];
    if(x<-40||x>W+40||y<-40||y>H+40)continue;
    const r=radiusByGrade[p.sizeGrade]*zf,s=depthStyle[p.depthGrade];
    const phase=i*2.3999632297,freq=0.42+(i%7)*0.105;
    const wave1=Math.sin(t*freq*2*Math.PI+phase),wave2=Math.sin(t*(freq*1.73)*2*Math.PI+phase*1.61),wave3=Math.sin(t*(freq*.37)*2*Math.PI+phase*.73);
    const shimmer=0.94+0.035*wave1+0.02*wave2+0.01*wave3; // keep faint depth grades readable
    const gg=gmap[i],ge=gg?glintEnv((t-gg.t0)/gg.dur)*GLINT_STRENGTH:0;   // 0..1 while this star is flaring
    const a=Math.max(.52,Math.min(1,s.brightness*STAR_BRIGHTNESS*shimmer+0.35*ge)),pulse=1+0.035*wave2,hr=r*3.9*pulse*(1+0.7*ge);
    const halo=ctx.createRadialGradient(x,y,0,x,y,hr);
    halo.addColorStop(0,`rgba(${s.glow[0]},${s.glow[1]},${s.glow[2]},${a*.27})`);
    halo.addColorStop(.30,`rgba(${s.glow[0]},${s.glow[1]},${s.glow[2]},${a*.12})`);
    halo.addColorStop(1,`rgba(${s.glow[0]},${s.glow[1]},${s.glow[2]},0)`);
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(x,y,hr,0,Math.PI*2);ctx.fill();
    const sh=shapeOf(i,p.sizeGrade),rot=sh.rot+0.03*wave3,rayAlpha=a*(0.62+0.38*(0.5+0.5*wave1));
    ctx.save();ctx.translate(x+0.16*wave2,y+0.16*wave3);
    for(const ray of sh.rays){
      const L=r*ray.len*(0.94+0.06*wave2),w=r*ray.w;
      ctx.save();ctx.rotate(rot+ray.ang);
      const g=ctx.createLinearGradient(0,0,L,0);
      g.addColorStop(0,`rgba(${s.color[0]},${s.color[1]},${s.color[2]},${rayAlpha*ray.a})`);
      g.addColorStop(.45,`rgba(${s.color[0]},${s.color[1]},${s.color[2]},${rayAlpha*ray.a*.35})`);
      g.addColorStop(1,`rgba(${s.color[0]},${s.color[1]},${s.color[2]},0)`);
      ctx.fillStyle=g;ctx.beginPath();
      ctx.moveTo(0,-w);ctx.quadraticCurveTo(L*.3,-w*.45,L,0);ctx.quadraticCurveTo(L*.3,w*.45,0,w);ctx.closePath();ctx.fill();
      ctx.restore();
    }
    const cr=r*sh.core*pulse,core=ctx.createRadialGradient(0,0,0,0,0,cr*1.5);
    core.addColorStop(0,`rgba(255,255,255,${a})`);
    core.addColorStop(.28,`rgba(${hexRgb(s.core)},${a*.95})`);
    core.addColorStop(.62,`rgba(${s.color[0]},${s.color[1]},${s.color[2]},${a*.45})`);
    core.addColorStop(1,`rgba(${s.color[0]},${s.color[1]},${s.color[2]},0)`);
    ctx.fillStyle=core;ctx.beginPath();ctx.arc(0,0,cr*1.5,0,Math.PI*2);ctx.fill();
    ctx.restore();
    if(ge>0.02)drawGlint(x,y,r,s,Math.min(1,ge),gg.kind,gg.rot,zf,p.sizeGrade);
  }

  // ground + treeline silhouette: everything outside the horizon loop is black
  const poly=horizonPolygon(t);
  ctx.fillStyle='rgb(2,4,8)';ctx.beginPath();ctx.rect(-4,-4,W+8,H+8);
  ctx.moveTo(poly[0][0],poly[0][1]);for(let i=1;i<poly.length;i++)ctx.lineTo(poly[i][0],poly[i][1]);
  ctx.closePath();ctx.fill('evenodd');
}

// ================= integration: input and page lifecycle =================
const hold={l:0,r:0,zi:0,zo:0};
const clampAz=()=>{target.az=clamp(target.az,-PAN_LIMIT,PAN_LIMIT);};
const clampFov=()=>{target.fov=clamp(target.fov,FOV_MIN,FOV_MAX);};
const pointers=new Map();let pinchDist=0;
let active=false,initialized=false,last=performance.now(),frameId=0;
const easing=1.0;
function panBy(delta){target.az+=delta;clampAz();}
function zoomBy(factor){target.fov*=factor;clampFov();}
function reset(){target.az=0;target.fov=FOV_DEFAULT;}
function onPointerDown(e){
  if(!active)return;
  if(e.pointerType==='mouse'&&e.button!==0)return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2){const [a,b]=[...pointers.values()];pinchDist=Math.hypot(a.x-b.x,a.y-b.y)||1;}
}
function onPointerMove(e){
  const pt=pointers.get(e.pointerId);if(!pt)return;
  const dx=e.clientX-pt.x;
  pt.x=e.clientX;pt.y=e.clientY;
  if(pointers.size===1){panBy(-dx/(Math.max(80,cam.k)*.85));}
  if(pointers.size===2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y)||1;zoomBy(pinchDist/d);pinchDist=d;}
}
function onPointerEnd(e){pointers.delete(e.pointerId);if(pointers.size<2)pinchDist=0;}
function onWheel(e){if(!active)return;e.preventDefault();zoomBy(Math.exp(e.deltaY*.0012));}
function bindButton(action,key,step){
  const b=controls?.querySelector(`[data-sky-action="${action}"]`);
  if(!b)return;
  let heldAt=0;
  b.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.pointerType==='mouse')return;
    e.preventDefault();heldAt=performance.now();hold[key]=1;
    try{b.setPointerCapture(e.pointerId);}catch(err){}
  });
  const stop=()=>{hold[key]=0;};
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,stop);
  b.addEventListener('click',()=>{
    // Every click is effective, including a short keyboard/button tap.
    if(!heldAt||performance.now()-heldAt<350)step();heldAt=0;
  });
}
function initInput(){
  canvas.addEventListener('pointerdown',onPointerDown);
  canvas.addEventListener('pointermove',onPointerMove);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,onPointerEnd);
  canvas.addEventListener('wheel',onWheel,{passive:false});
  bindButton('pan-left','l',()=>panBy(-8*D2R));
  bindButton('pan-right','r',()=>panBy(8*D2R));
  bindButton('zoom-in','zi',()=>zoomBy(.90));
  bindButton('zoom-out','zo',()=>zoomBy(1.1));
  controls?.querySelector('[data-sky-action="reset"]')?.addEventListener('click',reset);
  const keyMap={ArrowLeft:'l',ArrowRight:'r','+':'zi','=':'zi',ArrowUp:'zi','-':'zo','_':'zo',ArrowDown:'zo'};
  function keyEvent(e,down){
    if(!active||e.altKey||e.ctrlKey||e.metaKey)return;
    if(['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName))return;
    if(e.key==='Home'&&down){reset();e.preventDefault();e.stopImmediatePropagation();return;}
    const k=keyMap[e.key];
    if(k){hold[k]=down?1:0;e.preventDefault();e.stopImmediatePropagation();}
  }
  // Capture events before the site's chapter-arrow key navigation.
  document.addEventListener('keydown',e=>keyEvent(e,true),true);
  document.addEventListener('keyup',e=>keyEvent(e,false),true);
}
function frame(now){
  frameId=0;if(!active)return;
  if(host.clientWidth!==W||host.clientHeight!==H)resize();
  const dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
  if(!reducedMotion)skyTimeSeconds+=dt;
  const sp=45*D2R*(view.fov/FOV_DEFAULT)*dt;
  if(hold.l)target.az-=sp;if(hold.r)target.az+=sp;
  if(hold.zi)target.fov*=Math.exp(-.9*dt);
  if(hold.zo)target.fov*=Math.exp(.9*dt);
  clampAz();clampFov();
  const e=1-Math.exp(-dt*9*easing);
  view.az+=(target.az-view.az)*e;
  view.fov+=(target.fov-view.fov)*e;
  try{draw(now);}catch(err){console.error('Ending sky render:',err);}
  frameId=requestAnimationFrame(frame);
}
function sync(){
  const should=host.classList.contains('active')&&document.visibilityState!=='hidden';
  if(should&&!active){active=true;last=performance.now();resize();frameId=requestAnimationFrame(frame);}
  else if(!should&&active){active=false;cancelAnimationFrame(frameId);frameId=0;pointers.clear();for(const k in hold)hold[k]=0;}
}
async function loadData(){
  try{
    const res=await fetch(SOURCE,{cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const raw=await res.json();
    if(raw.length!==46)throw new Error('46개 성혈 데이터가 아닙니다.');
    data=raw.map(p=>{
      const v=p.sourcePosition||p.displayPosition;
      const grades=REFERENCE_GRADES[p.id];
      if(!grades||!v||![v.x,v.z,p.diameter,p.depth].every(Number.isFinite))throw new Error('측정값 오류: '+p.id);
      return {id:p.id,x:v.x,z:v.z,diameter:p.diameter,depth:p.depth,sizeGrade:grades[0],depthGrade:grades[1]};
    });
    prepareStarVectors();window.__endingSkyInfo={source:SOURCE,measuredCount:data.length,decorativeCount:0,starEmphasis:'high-contrast measured-only',projection:'stereographic',sizeBy:'diameter grade',brightnessBy:'depth grade',skyRotationSeconds:ROTATION_PERIOD};
    resize();sync();
  }catch(err){console.error('Ending data load:',err);}
}
function init(){
  if(initialized)return;initialized=true;
  initInput();
  addEventListener('resize',resize);
  document.addEventListener('visibilitychange',sync);
  addEventListener('exhibition:pagechange',sync);
  addEventListener('exhibition:pageactivated',sync);
  loadData();
}
window.__endingSkyControls={setAz:az=>{target.az=clamp(az,-PAN_LIMIT,PAN_LIMIT);},setFov:fov=>{target.fov=clamp(fov,FOV_MIN,FOV_MAX);},reset};
window.__endingSkyDebug={getStatus:()=>({active,count:data.length,measuredCount:data.length,decorativeCount:0,view:{...view},target:{...target},fovMax:FOV_MAX,rotationPeriodSeconds:ROTATION_PERIOD,skyTimeSeconds,canvas:{width:W,height:H},frameRunning:!!frameId}),getStarData:()=>data.map(p=>({id:p.id,x:p.x,z:p.z,diameter:p.diameter,depth:p.depth,sizeGrade:p.sizeGrade,depthGrade:p.depthGrade})),projectStars:()=>data.map(p=>project(p.v))};
window.initEndingSky=init;

})();
