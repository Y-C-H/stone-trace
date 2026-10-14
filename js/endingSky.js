/* v33 — Natural night sky; the 46 measured cupmark coordinates, diameters, depths,
 * and the one-scale orthographic projection remain identical to v32.
 * Decorative background stars and artistic aurora are not archaeological data.
 */
(function(){
  'use strict';
  const canvas=document.getElementById('endingSkyCanvas');
  const host=document.getElementById('exhibition-ending');
  if(!canvas||!host){window.initEndingSky=()=>{};return;}
  const ctx=canvas.getContext('2d',{alpha:false});
  let stars=[],backgroundStars=[],active=false,frame=0,enteredAt=0,lastPaint=0,
      viewport={width:0,height:0,scale:1},gesture=null,sourceStatus='pending',
      skyCache=null,auroraCache=null,starCache=null,renderedFrames=0,renderWorkMs=0;
  const SOURCE='data/cupmarks-measured.json';
  // One revolution in 30 minutes, measured stars and decorative sky sharing a rigid turn.
  const ROTATION_PERIOD_MS=1800000;
  let skyElapsedMs=0,previousSkyTick=0;
  const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const reduced=!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function hashId(text){let n=2166136261;for(const c of text){n=Math.imul(n^c.charCodeAt(0),16777619)}return n>>>0;}
  function seededRandom(seed){let n=seed>>>0;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
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

  function makeCanvas(width,height){
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(width));c.height=Math.max(1,Math.round(height));return c;
  }
  function softEllipse(c,x,y,rx,ry,rgb,opacity){
    c.save();c.translate(x,y);c.scale(rx,ry);
    const g=c.createRadialGradient(0,0,0,0,0,1);
    g.addColorStop(0,`rgba(${rgb},${opacity})`);
    g.addColorStop(.44,`rgba(${rgb},${opacity*.4})`);
    g.addColorStop(1,`rgba(${rgb},0)`);
    c.fillStyle=g;c.beginPath();c.arc(0,0,1,0,Math.PI*2);c.fill();c.restore();
  }
  function hash2(a,b){
    let h=(Math.imul(a,374761393)+Math.imul(b,668265263)+1342337)|0;
    h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
  }
  function noise2(x,y){
    const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j;
    const a=u*u*(3-2*u),b=v*v*(3-2*v);
    return lerp(lerp(hash2(i,j),hash2(i+1,j),a),lerp(hash2(i,j+1),hash2(i+1,j+1),a),b);
  }
  function buildBackground(width,height){
    skyCache=makeCanvas(width,height);
    const c=skyCache.getContext('2d');
    const g=c.createLinearGradient(0,0,width*.18,height);
    g.addColorStop(0,'#071225');g.addColorStop(.32,'#09192e');
    g.addColorStop(.72,'#0b1b2c');g.addColorStop(1,'#0b1b28');
    c.fillStyle=g;c.fillRect(0,0,width,height);
    softEllipse(c,width*.26,height*.34,width*.57,height*.53,'34,82,100',.115);
    softEllipse(c,width*.8,height*.62,width*.59,height*.53,'29,64,95',.12);
    softEllipse(c,width*.51,height*.96,width*.74,height*.42,'51,78,97',.08);
    // Very faint vignette defines the night-sky horizon without a dark rectangular panel.
    const vg=c.createRadialGradient(width*.5,height*.46,Math.min(width,height)*.2,
      width*.5,height*.48,Math.max(width,height)*.78);
    vg.addColorStop(0,'rgba(1,5,12,0)');vg.addColorStop(1,'rgba(1,4,12,.32)');
    c.fillStyle=vg;c.fillRect(0,0,width,height);
  }
  function buildAurora(width,height){
    // Fine veils rendered once at 45% resolution; only a slight translation/opacity changes per frame.
    const ratio=.45;
    const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
    auroraCache=makeCanvas(w,h);
    const c=auroraCache.getContext('2d');
    const img=c.createImageData(w,h),data=img.data;
    for(let y=0;y<h;y++){
      const yy=y/h;
      for(let x=0;x<w;x++){
        const xx=x/w;
        const wave=.32+.052*Math.sin(xx*5.6+.35)+.032*Math.sin(xx*11.9+1.4);
        const dist=yy-wave;
        const broad=Math.exp(-Math.pow(dist/.205,2)*.68);
        const inner=Math.exp(-Math.pow((dist+.022)/.063,2)*.65);
        const noise=.54*noise2(xx*8.5,yy*12)+.28*noise2(xx*19+8,yy*21)+.18*noise2(xx*41,yy*39);
        const fold=.6+.4*Math.sin(xx*28+noise*3.2);
        const across=Math.pow(Math.max(0,Math.sin(Math.PI*xx)),.55);
        const strength=(broad*(.20+.37*noise)+inner*.25*fold)*across;
        const alpha=clamp(strength*.30,0,.15);
        const i=(y*w+x)*4;
        data[i]=31+Math.round(10*noise);
        data[i+1]=110+Math.round(30*noise);
        data[i+2]=111+Math.round(34*noise);
        data[i+3]=Math.round(alpha*255);
      }
    }
    c.putImageData(img,0,0);
    // Subtle, curved wisp softened once at cache construction time.
    c.save();c.filter=`blur(${Math.max(7,Math.round(w*.014))}px)`;
    for(let i=0;i<3;i++){
      c.strokeStyle=`rgba(${i===0?'99,172,157':'60,128,153'},${i===0?.04:.023})`;
      c.lineWidth=(9+i*11)*ratio;
      c.beginPath();c.moveTo(-40*ratio,h*(.28+.045*i));
      c.bezierCurveTo(w*.22,h*(.13+.043*i),w*.57,h*(.48+.035*i),w+50*ratio,h*(.28+.025*i));
      c.stroke();
    }
    c.restore();
  }
  function buildBackgroundStars(width,height){
    const rng=seededRandom(0xA510E6);
    const mobile=width<650;
    const count=mobile?185:Math.round(clamp(width*height/3100,260,570));
    backgroundStars=[];
    starCache=makeCanvas(width,height);
    const c=starCache.getContext('2d');
    for(let i=0;i<count;i++){
      let xx=rng(),yy=rng();
      // Modest local density variation, not a grid or regular constellation.
      if(rng()<.24){xx=clamp(.62+(rng()+rng()-1)*.48,0,1);yy=clamp(.48+(rng()+rng()-1)*.49,0,1);}
      const rarity=rng(),radius=rarity>.95?1.08:lerp(.26,.76,rng());
      const alpha=rarity>.95?lerp(.26,.46,rng()):lerp(.085,.29,rng());
      const star={x:xx*width,y:yy*height,radius,alpha,phase:rng()*Math.PI*2,
        period:lerp(6,16,rng()),twinkle:i%9===0};
      backgroundStars.push(star);
      if(!star.twinkle){
        c.fillStyle=`rgba(${rarity>.8?'201,221,242':'157,187,218'},${alpha.toFixed(3)})`;
        c.beginPath();c.arc(star.x,star.y,star.radius,0,Math.PI*2);c.fill();
      }
    }
  }
  function resize(){
    // CSS page transitions may temporarily transform getBoundingClientRect(); client dimensions stay stable.
    const width=Math.max(1,host.clientWidth||innerWidth),height=Math.max(1,host.clientHeight||innerHeight);
    // DPR cap protects mobile GPUs; measured-star coordinates and relative sizes do not change.
    const dpr=Math.min(devicePixelRatio||1,width<650?1.5:1.75);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    canvas.style.width=width+'px';canvas.style.height=height+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const px=stars.map(s=>s.x),py=stars.map(s=>s.y);
    const spanX=stars.length?Math.max(...px)-Math.min(...px):1;
    const spanY=stars.length?Math.max(...py)-Math.min(...py):1;
    viewport={width,height,scale:Math.min(width*.77/Math.max(spanX,1),height*.65/Math.max(spanY,1))};
    buildBackground(width,height);buildAurora(width,height);buildBackgroundStars(width,height);
  }
  function drawMeasuredStars(elapsed,now){
    const {width,height,scale}=viewport;
    const fade=reduced?1:clamp(elapsed/1400,0,1);
    const t=now/1000;
    for(const star of stars){
      const x=width/2+star.x*scale,y=height/2+star.y*scale;
      const core=star.coreSize*(width<480?.83:1);
      const outer=star.haloRadius+core*2.5;
      const glow=ctx.createRadialGradient(x,y,0,x,y,outer*1.16);
      glow.addColorStop(0,`rgba(215,235,255,${(.70*star.haloStrength*fade).toFixed(4)})`);
      glow.addColorStop(.3,`rgba(153,194,236,${(.30*star.haloStrength*fade).toFixed(4)})`);
      glow.addColorStop(1,'rgba(110,164,221,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,outer*1.16,0,Math.PI*2);ctx.fill();
      // Only peripheral light changes with time: core radius and measured brightness remain fixed.
      const shimmer=reduced?.5:.5+.5*Math.sin(t*Math.PI*2/star.period+star.phase);
      const alpha=star.haloStrength*.09*shimmer*fade;
      const fringe=ctx.createRadialGradient(x,y,outer*.60,x,y,outer*1.42);
      fringe.addColorStop(0,`rgba(167,204,248,${alpha.toFixed(4)})`);
      fringe.addColorStop(1,'rgba(167,204,248,0)');
      ctx.fillStyle=fringe;ctx.beginPath();ctx.arc(x,y,outer*1.42,0,Math.PI*2);ctx.fill();
      // Shared 5% contrast lift strictly preserves rank order of all measured values.
      const b=star.brightness;
      ctx.fillStyle=`rgba(243,248,255,${((.05+.95*b)*fade).toFixed(4)})`;
      ctx.beginPath();ctx.arc(x,y,core,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=`rgba(255,255,255,${((.05+.95*b)*.78*fade).toFixed(4)})`;
      ctx.beginPath();ctx.arc(x,y,core*.42,0,Math.PI*2);ctx.fill();
    }
  }
  function drawScene(now){
    const {width,height}=viewport,elapsed=Math.max(0,now-enteredAt);
    if(!skyCache)return;
    ctx.globalAlpha=1;ctx.drawImage(skyCache,0,0,width,height);
    // Rotate around the canvas bottom-center (x=width/2, y=height).
    // Turn the entire star field + aurora as a rigid visual layer.  The gradient
    // night sky is fixed behind it; HTML headings and return control never rotate.
    const rotation=(skyElapsedMs%ROTATION_PERIOD_MS)/ROTATION_PERIOD_MS*Math.PI*2;
    ctx.save();ctx.translate(width * 0.5,height);ctx.rotate(rotation);ctx.translate(-width * 0.5,-height);
    // Atmospheric veil remains gentle and behind all stars and written elements.
    const auroraFade=reduced?1:clamp((elapsed-1050)/1750,0,1);
    const move=reduced?0:Math.sin(now/38000*Math.PI*2);
    const breathe=reduced?1:.96+.04*Math.sin(now/27000*Math.PI*2);
    ctx.globalAlpha=.78*auroraFade*breathe;
    ctx.drawImage(auroraCache,-7+move*7,-5+Math.cos(now/41000*Math.PI*2)*3,width+14,height+10);
    ctx.globalAlpha=1;
    const bgFade=reduced?1:clamp((elapsed-1300)/1500,0,1);
    ctx.globalAlpha=bgFade;
    ctx.drawImage(starCache,0,0,width,height);
    const time=now/1000;
    for(const s of backgroundStars){
      if(!s.twinkle)continue;
      const brightness=reduced?.75:.76+.20*Math.sin(time*Math.PI*2/s.period+s.phase);
      ctx.fillStyle=`rgba(194,215,236,${(s.alpha*brightness).toFixed(4)})`;
      ctx.beginPath();ctx.arc(s.x,s.y,s.radius,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
    if(sourceStatus==='failed'){
      ctx.fillStyle='rgba(234,231,223,.88)';ctx.font='14px sans-serif';ctx.textAlign='center';
      ctx.fillText('성혈 데이터를 불러올 수 없습니다.',width/2,height*.52);
      ctx.restore();return;
    }
    drawMeasuredStars(elapsed,now);
    ctx.restore();
  }
  function paint(now){
    frame=0;if(!active)return;
    if(previousSkyTick)skyElapsedMs+=Math.min(Math.max(0,now-previousSkyTick),100);
    previousSkyTick=now;
    if(!lastPaint||now-lastPaint>=(viewport.width<650?33:22)){
      const before=performance.now();drawScene(now);renderWorkMs+=performance.now()-before;renderedFrames++;lastPaint=now;
    }
    frame=requestAnimationFrame(paint);
  }
  function start(){
    if(active)return;
    active=true;enteredAt=performance.now();lastPaint=0;previousSkyTick=0;
    resize();frame=requestAnimationFrame(paint);
  }
  function stop(){active=false;cancelAnimationFrame(frame);frame=0;lastPaint=0;previousSkyTick=0;}
  function sync(){
    const shouldRun=host.classList.contains('active')&&document.visibilityState!=='hidden';
    if(shouldRun)start();else stop();
  }
  async function load(){
    try{
      const res=await fetch(SOURCE,{cache:'no-store'});
      if(!res.ok)throw Error('HTTP '+res.status);
      toStars(await res.json());sourceStatus='loaded';resize();sync();
    }catch(error){sourceStatus='failed';console.error('엔딩 성혈 데이터를 불러오지 못했습니다:',error);resize();sync();}
  }
  function init(){
    if(!ctx){console.error('2D Canvas 초기화 실패');return;}
    load();
    window.addEventListener('exhibition:pagechange',sync);
    window.addEventListener('exhibition:pageactivated',sync);
    document.addEventListener('visibilitychange',sync);
    window.addEventListener('resize',()=>{resize();});
    // Original swipe-back navigation stays attached to the canvas.
    canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){gesture={id:e.pointerId,x:e.clientX,y:e.clientY};}});
    canvas.addEventListener('pointerup',e=>{if(!gesture||e.pointerId!==gesture.id)return;
      const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;gesture=null;
      if(dx>75&&Math.abs(dx)>Math.abs(dy)*1.35)window.goToPage?.(4);
    });
    canvas.addEventListener('pointercancel',()=>{gesture=null;});
  }
  window.__endingSkyDebug=Object.freeze({
    getStatus:()=>({sourceStatus,measuredCount:stars.length,decorativeCount:backgroundStars.length,
      active,viewport:{...viewport},reducedMotion:reduced,skyRotationDegrees:skyElapsedMs/ROTATION_PERIOD_MS*360,rotationPeriodMs:ROTATION_PERIOD_MS,renderedFrames,averageDrawMs:renderedFrames?renderWorkMs/renderedFrames:0}),
    // Deterministic isolated-browser screenshots of the real Canvas renderer.
    renderAt:(seconds)=>{if(skyCache)drawScene(enteredAt+Math.max(0,seconds)*1000);}
  });
  window.initEndingSky=init;
})();
