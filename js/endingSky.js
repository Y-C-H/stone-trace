/* v21 — night sky from actual measured cupmarks; no generated or repositioned stars. */
(function(){
  'use strict';
  const canvas=document.getElementById('endingSkyCanvas');
  const host=document.getElementById('exhibition-ending');
  if(!canvas||!host){window.initEndingSky=()=>{};return;}
  const ctx=canvas.getContext('2d',{alpha:false});
  let stars=[],active=false,frame=0,enteredAt=0,viewport={width:0,height:0,scale:1},gesture=null;
  let sourceStatus='pending';
  const SOURCE='data/cupmarks-measured.json';
  const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
  const lerp=(a,b,t)=>a+(b-a)*t;
  function hashId(text){let n=2166136261;for(const c of text){n=Math.imul(n^c.charCodeAt(0),16777619)}return n>>>0;}
  function toStars(measurements){
    if(!Array.isArray(measurements)||!measurements.length)throw Error('측정 성혈 데이터가 없습니다.');
    const seen=new Set();
    const records=measurements.map(c=>{
      const pos=c.sourcePosition||c.displayPosition;
      if(!c.id||seen.has(c.id)||!pos||![pos.x,pos.z,c.diameter,c.depth].every(Number.isFinite)||c.diameter<=0||c.depth<0){
        throw Error('성혈 측정값 누락 또는 중복 ID: '+String(c.id));
      }
      seen.add(c.id);
      return {id:c.id,x:pos.x,z:pos.z,diameter:c.diameter,depth:c.depth};
    });
    const ds=records.map(r=>r.diameter),hs=records.map(r=>r.depth);
    const dMin=Math.min(...ds),dMax=Math.max(...ds),hMin=Math.min(...hs),hMax=Math.max(...hs);
    const xs=records.map(r=>r.x),zs=records.map(r=>r.z);
    const xMin=Math.min(...xs),xMax=Math.max(...xs),zMin=Math.min(...zs),zMax=Math.max(...zs);
    const xMid=(xMin+xMax)*.5,zMid=(zMin+zMax)*.5;
    const norm=(v,min,max)=>max===min?.5:(v-min)/(max-min);
    stars=records.map(r=>{
      const d=norm(r.diameter,dMin,dMax),h=norm(r.depth,hMin,hMax),hash=hashId(r.id);
      return {
        id:r.id,
        // Top-down projection: world X -> right; world Z -> down. Single uniform scale at draw time.
        x:r.x-xMid,y:r.z-zMid,
        coreSize:lerp(1.25,3.55,d),
        brightness:lerp(.45,.99,h),
        haloStrength:lerp(.12,.48,h),
        haloRadius:lerp(7,19,d),
        phase:(hash%6283)/1000,
        period:lerp(4.3,7.9,((hash>>>9)%1000)/1000)
      };
    });
    window.__endingSkyInfo=Object.freeze({source:SOURCE,count:stars.length,diameterRange:[dMin,dMax],depthRange:[hMin,hMax],projection:'X -> screen right; Z -> screen down',uniformScale:true});
  }
  function resize(){
    const rect=host.getBoundingClientRect();
    const width=Math.max(1,rect.width||innerWidth),height=Math.max(1,rect.height||innerHeight);
    const dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    canvas.style.width=width+'px';canvas.style.height=height+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const px=stars.map(s=>s.x),py=stars.map(s=>s.y);
    const spanX=stars.length?Math.max(...px)-Math.min(...px):1;
    const spanY=stars.length?Math.max(...py)-Math.min(...py):1;
    viewport={width,height,scale:Math.min(width*.77/Math.max(spanX,1),height*.65/Math.max(spanY,1))};
  }
  function paint(now){
    if(!active)return;
    const {width,height,scale}=viewport;
    ctx.fillStyle='#040912';ctx.fillRect(0,0,width,height);
    const fade=clamp((now-enteredAt)/1400,0,1);
    const t=now/1000;
    for(const star of stars){
      const x=width/2+star.x*scale,y=height/2+star.y*scale;
      const core=star.coreSize*(width<480?.83:1);
      // Main halo and core brightness remain data-ordered and stable.
      const outer=star.haloRadius+core*2.5;
      const glow=ctx.createRadialGradient(x,y,0,x,y,outer);
      glow.addColorStop(0,`rgba(208,224,246,${(.50*star.haloStrength*fade).toFixed(3)})`);
      glow.addColorStop(.28,`rgba(139,172,219,${(.18*star.haloStrength*fade).toFixed(3)})`);
      glow.addColorStop(1,'rgba(100,146,209,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,outer,0,Math.PI*2);ctx.fill();
      // Only the secondary outer scintillation changes; position, core size and measured brightness do not.
      {
        const oscillation=.5+.5*Math.sin(t*Math.PI*2/star.period+star.phase);
        const alpha=star.haloStrength*.065*oscillation*fade;
        ctx.beginPath();ctx.arc(x,y,outer*1.23,0,Math.PI*2);
        const extra=ctx.createRadialGradient(x,y,outer*.45,x,y,outer*1.23);
        extra.addColorStop(0,`rgba(156,189,237,${alpha.toFixed(4)})`);
        extra.addColorStop(1,'rgba(156,189,237,0)');
        ctx.fillStyle=extra;ctx.fill();
      }
      const b=star.brightness;
      ctx.fillStyle=`rgba(239,245,255,${(b*fade).toFixed(4)})`;
      ctx.beginPath();ctx.arc(x,y,core,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=`rgba(255,255,255,${(b*.77*fade).toFixed(4)})`;
      ctx.beginPath();ctx.arc(x,y,core*.42,0,Math.PI*2);ctx.fill();
    }
    frame=requestAnimationFrame(paint);
  }
  function start(){
    if(active)return;
    active=true;enteredAt=performance.now();resize();
    frame=requestAnimationFrame(paint);
  }
  function stop(){active=false;cancelAnimationFrame(frame);frame=0;}
  function sync(){
    const shouldRun=host.classList.contains('active')&&document.visibilityState!=='hidden';
    if(shouldRun)start();else stop();
  }
  async function load(){
    try{
      const res=await fetch(SOURCE,{cache:'no-store'});
      if(!res.ok)throw Error('HTTP '+res.status);
      toStars(await res.json());sourceStatus='loaded';resize();sync();
    }catch(error){sourceStatus='failed';console.error('엔딩 성혈 데이터를 불러오지 못했습니다:',error);}
  }
  function init(){
    if(!ctx){console.error('2D Canvas 초기화 실패');return;}
    load();
    window.addEventListener('exhibition:pagechange',sync);
    window.addEventListener('exhibition:pageactivated',sync);
    document.addEventListener('visibilitychange',sync);
    window.addEventListener('resize',()=>{resize();});
    // The ending canvas owns touch gestures, so it can return to Chapter 04 on a right swipe.
    canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){gesture={id:e.pointerId,x:e.clientX,y:e.clientY};}});
    canvas.addEventListener('pointerup',e=>{if(!gesture||e.pointerId!==gesture.id)return;
      const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;gesture=null;
      if(dx>75&&Math.abs(dx)>Math.abs(dy)*1.35)window.goToPage?.(3);
    });
    canvas.addEventListener('pointercancel',()=>{gesture=null;});
  }
  window.initEndingSky=init;
})();
