(function(){
  'use strict';

  const PAGE_INDEX=3;
  const DATA_URL='data/cupmarks-measured.json';
  const EASTERN_URL='data/eastern-asterisms.json';
  const eastern={enabled:false,loading:false,loaded:false,data:null,error:null};
  const MIN_SCALE=.32, MAX_SCALE=4.5;
  const state={panX:0,panY:0,scale:1,rotation:0,hovered:null,handleHovered:false,points:[],active:new Set(),stars:[],ready:false};
  const pointers=new Map();
  let canvas,ctx,confirmCanvas,confirmCtx,shell,markList,rotationInput,gesture=null,confirmOpen=false,fullscreenRequested=false;

  function seeded(seed){let s=seed>>>0;return()=>((s=Math.imul(1664525,s)+1013904223>>>0)/4294967296)}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
  function deg(rad){return rad*180/Math.PI}
  function rad(deg){return deg*Math.PI/180}
  function normalizeAngle(v){while(v>180)v-=360;while(v<-180)v+=360;return v}
  function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
  function midpoint(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2}}
  function angle(a,b){return Math.atan2(b.y-a.y,b.x-a.x)}

  function generateStars(){
    const r=seeded(20261008),stars=[];
    for(let i=0;i<1150;i++){
      const bright=r();
      const size=bright>.988?1.8+r()*1.5:bright>.94?.9+r()*1.1:.28+r()*.7;
      const alpha=bright>.988?.88:bright>.94?.62+r()*.25:.18+r()*.48;
      const tint=r();
      stars.push({x:r(),y:r(),size,alpha,tint});
    }
    state.stars=stars;
  }

  function resizeCanvas(c,context){
    const rect=c.getBoundingClientRect();
    if(!rect.width||!rect.height)return null;
    const dpr=Math.min(window.devicePixelRatio||1,2.5);
    const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
    if(c.width!==w||c.height!==h){c.width=w;c.height=h}
    context.setTransform(dpr,0,0,dpr,0,0);
    return{w:rect.width,h:rect.height,dpr};
  }

  function drawSky(context,w,h){
    const bg=context.createRadialGradient(w*.52,h*.42,0,w*.52,h*.45,Math.max(w,h)*.78);
    bg.addColorStop(0,'#0b1728');bg.addColorStop(.42,'#050b16');bg.addColorStop(1,'#010309');
    context.fillStyle=bg;context.fillRect(0,0,w,h);
    // Very faint broad band to suggest the density variation of an observing sky, not a mapped Milky Way.
    context.save();context.translate(w*.48,h*.5);context.rotate(-.32);
    const haze=context.createLinearGradient(0,-h*.34,0,h*.34);
    haze.addColorStop(0,'rgba(96,118,151,0)');haze.addColorStop(.48,'rgba(96,118,151,.025)');haze.addColorStop(.52,'rgba(180,185,176,.02)');haze.addColorStop(1,'rgba(96,118,151,0)');
    context.fillStyle=haze;context.fillRect(-w,-h*.34,w*2,h*.68);context.restore();
    for(const s of state.stars){
      const x=s.x*w,y=s.y*h;
      if(s.size>1.55){
        const g=context.createRadialGradient(x,y,0,x,y,s.size*4.2);
        const glow=s.tint<.25?'190,214,255':s.tint>.78?'255,226,176':'244,248,255';
        g.addColorStop(0,`rgba(${glow},${s.alpha*.32})`);g.addColorStop(1,`rgba(${glow},0)`);
        context.fillStyle=g;context.beginPath();context.arc(x,y,s.size*4.2,0,Math.PI*2);context.fill();
      }
      const color=s.tint<.22?`rgba(190,215,255,${s.alpha})`:s.tint>.82?`rgba(255,228,181,${s.alpha})`:`rgba(242,246,255,${s.alpha})`;
      context.fillStyle=color;context.beginPath();context.arc(x,y,s.size,0,Math.PI*2);context.fill();
    }
  }

  // Korean traditional constellations: celestial coordinates are independent of the draggable measured-stone overlay.
  // The original star field is decorative; the marked groups use approximate catalog celestial coordinates.
  function easternToPixel(star,w,h){
    // Equirectangular bounded viewport for the three documented asterisms; RA increases to the left.
    return {x:w*(.91-(star.ra-155)/150*.82),y:h*(.12+(72-star.dec)/79*.76)};
  }
  function drawEastern(context,w,h){
    if(!eastern.enabled||!eastern.loaded||!eastern.data)return;
    const stars=new Map(eastern.data.stars.map(s=>[s.hip,s]));
    context.save();context.lineWidth=Math.max(.8,Math.min(1.35,w/850));
    for(const group of eastern.data.asterisms){
      context.strokeStyle='rgba(164,194,219,.34)';
      for(const seq of group.lines){
        const coords=seq.map(hip=>stars.get(hip)).filter(Boolean).map(s=>easternToPixel(s,w,h));
        if(coords.length<2)continue;
        context.beginPath();context.moveTo(coords[0].x,coords[0].y);
        for(let j=1;j<coords.length;j++)context.lineTo(coords[j].x,coords[j].y);
        context.stroke();
      }
      const all=[...new Set(group.lines.flat())].map(hip=>stars.get(hip)).filter(Boolean).map(s=>easternToPixel(s,w,h));
      if(!all.length)continue;
      for(const q of all){
        context.fillStyle='rgba(189,213,233,.86)';context.beginPath();context.arc(q.x,q.y,Math.max(1.8,Math.min(2.55,w/400)),0,Math.PI*2);context.fill();
      }
      const minX=Math.min(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y));
      context.font='12px system-ui, sans-serif';context.fillStyle='rgba(166,195,217,.75)';context.textAlign='left';
      context.fillText(group.name,minX,Math.max(15,minY-12));
    }
    context.restore();
  }
  function updateEasternControls(){
    document.getElementById('easternOn')?.setAttribute('aria-pressed',String(eastern.enabled));
    document.getElementById('easternOff')?.setAttribute('aria-pressed',String(!eastern.enabled));
  }
  async function setEasternEnabled(on){
    if(!on){eastern.enabled=false;updateEasternControls();draw();if(confirmOpen)drawConfirm();return;}
    if(eastern.loaded){eastern.enabled=true;updateEasternControls();draw();if(confirmOpen)drawConfirm();return;}
    if(eastern.loading)return;
    eastern.loading=true;
    try{
      const response=await fetch(EASTERN_URL);if(!response.ok)throw Error('HTTP '+response.status);
      const data=await response.json();
      if(!data||!Array.isArray(data.stars)||!Array.isArray(data.asterisms))throw Error('Invalid constellation data');
      eastern.data=data;eastern.loaded=true;eastern.error=null;eastern.enabled=true;
    }catch(err){eastern.enabled=false;eastern.error=String(err)}
    finally{eastern.loading=false;updateEasternControls();draw();if(confirmOpen)drawConfirm();}
  }
  window.__easternAsterismDebug=()=>({enabled:eastern.enabled,loaded:eastern.loaded,loading:eastern.loading,error:eastern.error,count:eastern.data?.asterisms?.length||0});

  function pointBounds(){
    if(!state.points.length)return{minX:-.5,maxX:.5,minY:-.25,maxY:.25,rx:1,ry:.5};
    const xs=state.points.map(p=>p.x),ys=state.points.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    return{minX,maxX,minY,maxY,rx:maxX-minX,ry:maxY-minY};
  }

  function pointExtent(){const b=pointBounds();return{rx:b.rx,ry:b.ry}}

  function transformMetrics(w,h){
    const e=pointExtent();
    const base=Math.min((w*.78)/Math.max(.001,e.rx),(h*.62)/Math.max(.001,e.ry));
    return{base,cx:w*(.5+state.panX),cy:h*(.5+state.panY)};
  }

  function projectPoint(p,w,h){
    const {base,cx,cy}=transformMetrics(w,h),a=rad(state.rotation),c=Math.cos(a),s=Math.sin(a);
    const x=p.x*base*state.scale,y=p.y*base*state.scale;
    return{x:cx+x*c-y*s,y:cy+x*s+y*c};
  }


  function rotationHandleGeometry(w,h){
    const b=pointBounds(),{base,cx,cy}=transformMetrics(w,h),a=rad(state.rotation),c=Math.cos(a),s=Math.sin(a);
    const localGap=Math.max(.045,b.ry*.18),lx=0,ly=b.minY-localGap;
    const x=lx*base*state.scale,y=ly*base*state.scale;
    return{center:{x:cx,y:cy},handle:{x:cx+x*c-y*s,y:cy+x*s+y*c},radius:w<520?15:13};
  }

  function rotationHandleHit(x,y,w,h){
    const g=rotationHandleGeometry(w,h),hit=window.matchMedia('(pointer:coarse)').matches?30:23;
    return Math.hypot(x-g.handle.x,y-g.handle.y)<=hit;
  }

  // Measured C-series: display radius = diameter; brightness + halo = depth.
  function drawCupmarkStar(context,x,y,p,hover){
    const core=p.coreSize*(hover?1.16:1),halo=8+core*3+(hover?3:0);
    const glow=context.createRadialGradient(x,y,0,x,y,halo);
    glow.addColorStop(0,`rgba(255,247,223,${(.48*p.haloStrength).toFixed(4)})`);
    glow.addColorStop(.27,`rgba(251,212,132,${(.32*p.haloStrength).toFixed(4)})`);
    glow.addColorStop(1,'rgba(225,145,39,0)');
    context.fillStyle=glow;context.beginPath();context.arc(x,y,halo,0,Math.PI*2);context.fill();
    context.fillStyle=`rgba(255,242,207,${p.brightness.toFixed(4)})`;
    context.beginPath();context.arc(x,y,core,0,Math.PI*2);context.fill();
    if(hover){context.strokeStyle='rgba(255,213,129,.84)';context.lineWidth=1.2;context.beginPath();context.arc(x,y,core+4,0,Math.PI*2);context.stroke()}
  }

  function drawRotationHandle(context,w,h){
    const g=rotationHandleGeometry(w,h),{center,handle}=g,active=state.handleHovered||gesture?.mode==='rotate';
    context.save();
    context.setLineDash([4,7]);context.strokeStyle=active?'rgba(229,187,103,.42)':'rgba(209,181,126,.18)';context.lineWidth=1;
    context.beginPath();context.moveTo(center.x,center.y);context.lineTo(handle.x,handle.y);context.stroke();context.setLineDash([]);
    const rr=g.radius;
    context.fillStyle=active?'rgba(15,16,17,.88)':'rgba(7,10,16,.72)';context.strokeStyle=active?'rgba(242,196,103,.95)':'rgba(211,177,112,.62)';context.lineWidth=active?1.5:1.1;context.beginPath();context.arc(handle.x,handle.y,rr,0,Math.PI*2);context.fill();context.stroke();
    context.strokeStyle=active?'rgba(255,215,132,.98)':'rgba(231,195,127,.82)';context.lineWidth=1.4;context.lineCap='round';
    context.beginPath();context.arc(handle.x,handle.y,rr*.48,-Math.PI*.72,Math.PI*.55);context.stroke();
    const aa=Math.PI*.55,ax=handle.x+Math.cos(aa)*rr*.48,ay=handle.y+Math.sin(aa)*rr*.48;
    context.fillStyle=active?'#ffd78f':'#d7b77b';context.beginPath();context.moveTo(ax,ay);context.lineTo(ax-5,ay-1);context.lineTo(ax-1,ay-5);context.closePath();context.fill();
    const labelX=handle.x+rr+7,labelY=handle.y;
    context.font=`${active?'600':'500'} 11px system-ui,sans-serif`;context.textAlign='left';context.textBaseline='middle';context.fillStyle=active?'rgba(248,214,151,.98)':'rgba(204,185,151,.84)';context.shadowColor='rgba(0,0,0,.9)';context.shadowBlur=5;context.fillText(active?`회전 ${Math.round(state.rotation)}°`:'회전',labelX,labelY);context.shadowBlur=0;
    context.restore();
  }

  function drawPoints(context,w,h,{labels=true}={}){
    for(const p of state.points){
      if(!state.active.has(p.id))continue;
      const q=projectPoint(p,w,h),hover=state.hovered===p.id;
      if(q.x<-22||q.y<-22||q.x>w+22||q.y>h+22)continue;
      drawCupmarkStar(context,q.x,q.y,p,hover);
      if(hover&&labels){context.save();context.font='11px system-ui,sans-serif';context.textAlign='left';context.textBaseline='middle';context.fillStyle='#f4cf83';context.shadowColor='rgba(0,0,0,.9)';context.shadowBlur=5;context.fillText(p.id,q.x+12,q.y-11);context.restore()}
    }
  }

  function draw(){
    if(!canvas||!ctx||!state.ready)return;
    const s=resizeCanvas(canvas,ctx);if(!s)return;
    drawSky(ctx,s.w,s.h);drawEastern(ctx,s.w,s.h);drawPoints(ctx,s.w,s.h);drawRotationHandle(ctx,s.w,s.h);
    updateReadouts();
  }

  function drawConfirm(){
    if(!confirmCanvas||!confirmCtx||!state.ready)return;
    const s=resizeCanvas(confirmCanvas,confirmCtx);if(!s)return;
    drawSky(confirmCtx,s.w,s.h);drawEastern(confirmCtx,s.w,s.h);drawPoints(confirmCtx,s.w,s.h,{labels:false});
    const t=document.getElementById('skyConfirmTransform');
    if(t)t.textContent=`크기 ${Math.round(state.scale*100)}% · 회전 ${Math.round(state.rotation)}° · 표시 ${state.active.size}/${state.points.length}`;
  }

  function updateReadouts(){
    const v=state.active.size,total=state.points.length;
    const a=document.getElementById('skyVisibleCount'),b=document.getElementById('skyTotalCount'),c=document.getElementById('skyManagerCount'),sv=document.getElementById('skyScaleValue'),rv=document.getElementById('skyRotationValue');
    if(a)a.textContent=String(v);if(b)b.textContent=`/ ${total} 표시`;if(c)c.textContent=`${v} / ${total}`;if(sv)sv.textContent=`${Math.round(state.scale*100)}%`;if(rv)rv.textContent=`${Math.round(state.rotation)}°`;
    if(rotationInput&&Number(rotationInput.value)!==Math.round(state.rotation))rotationInput.value=String(Math.round(state.rotation));
  }

  function renderManager(){
    if(!markList)return;markList.textContent='';
    const frag=document.createDocumentFragment();
    for(const p of state.points){
      const on=state.active.has(p.id),btn=document.createElement('button');
      btn.type='button';btn.className=`sky-mark-toggle${on?'':' is-off'}`;btn.dataset.pointId=p.id;btn.setAttribute('aria-pressed',on?'true':'false');btn.setAttribute('aria-label',`${p.id} ${on?'숨기기':'다시 표시'}`);
      btn.innerHTML=`<span>${p.id}</span><i aria-hidden="true"></i>`;frag.appendChild(btn);
    }
    markList.appendChild(frag);updateReadouts();
  }

  function resetState(){state.panX=0;state.panY=0;state.scale=1;state.rotation=0;state.hovered=null;state.handleHovered=false;state.active=new Set(state.points.map(p=>p.id));renderManager();draw()}
  function setAll(on){state.active=new Set(on?state.points.map(p=>p.id):[]);renderManager();draw()}
  function togglePoint(id){if(state.active.has(id))state.active.delete(id);else state.active.add(id);renderManager();draw()}

  function nearestPoint(x,y,w,h,activeOnly=true){
    let best=null,bestD=Infinity;
    for(const p of state.points){if(activeOnly&&!state.active.has(p.id))continue;const q=projectPoint(p,w,h),d=Math.hypot(q.x-x,q.y-y);if(d<bestD){bestD=d;best=p}}
    const hitRadius=window.matchMedia('(pointer:coarse)').matches?19:14;
    return bestD<=hitRadius?best:null;
  }

  function localPointer(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  function beginOnePointer(p){gesture={mode:'pan',start:p,startPanX:state.panX,startPanY:state.panY,moved:0}}
  function beginRotationPointer(p,w,h){const g=rotationHandleGeometry(w,h);gesture={mode:'rotate',center:g.center,startAngle:angle(g.center,p),startRotation:state.rotation,moved:999};state.handleHovered=true}
  function beginTwoPointers(){
    const a=[...pointers.values()][0],b=[...pointers.values()][1];
    gesture={mode:'pinch',startDist:Math.max(10,dist(a,b)),startAngle:angle(a,b),startMid:midpoint(a,b),startScale:state.scale,startRotation:state.rotation,startPanX:state.panX,startPanY:state.panY,moved:999};
  }

  function onPointerDown(e){
    if(!state.ready)return;e.preventDefault();e.stopPropagation();canvas.setPointerCapture?.(e.pointerId);const r=canvas.getBoundingClientRect(),p=localPointer(e);p.id=e.pointerId;pointers.set(e.pointerId,p);
    if(pointers.size===1&&rotationHandleHit(p.x,p.y,r.width,r.height)){canvas.classList.add('is-rotating');canvas.classList.remove('is-dragging');beginRotationPointer(p,r.width,r.height)}
    else{canvas.classList.add('is-dragging');canvas.classList.remove('is-rotating');if(pointers.size===1)beginOnePointer(p);else if(pointers.size===2)beginTwoPointers()}
  }
  function onPointerMove(e){
    if(!state.ready)return;const r=canvas.getBoundingClientRect(),p={x:e.clientX-r.left,y:e.clientY-r.top,id:e.pointerId};
    if(!pointers.has(e.pointerId)){
      if(e.pointerType==='mouse'){
        const hh=rotationHandleHit(p.x,p.y,r.width,r.height);canvas.classList.toggle('is-rotation-hover',hh);
        const n=hh?null:nearestPoint(p.x,p.y,r.width,r.height,true),id=n?.id||null;
        if(id!==state.hovered||hh!==state.handleHovered){state.hovered=id;state.handleHovered=hh;draw()}
      }
      return;
    }
    e.preventDefault();e.stopPropagation();pointers.set(e.pointerId,p);
    if(pointers.size>=2){if(!gesture||gesture.mode!=='pinch')beginTwoPointers();canvas.classList.remove('is-rotating');canvas.classList.add('is-dragging');const [a,b]=[...pointers.values()],d=Math.max(10,dist(a,b)),ang=angle(a,b),mid=midpoint(a,b);state.scale=clamp(gesture.startScale*d/gesture.startDist,MIN_SCALE,MAX_SCALE);state.rotation=normalizeAngle(gesture.startRotation+deg(ang-gesture.startAngle));state.panX=clamp(gesture.startPanX+(mid.x-gesture.startMid.x)/r.width,-.82,.82);state.panY=clamp(gesture.startPanY+(mid.y-gesture.startMid.y)/r.height,-.82,.82);draw();return}
    if(gesture?.mode==='rotate'){
      state.rotation=normalizeAngle(gesture.startRotation+deg(angle(gesture.center,p)-gesture.startAngle));state.handleHovered=true;draw();return;
    }
    if(gesture?.mode==='pan'){
      const only=[...pointers.values()][0],dx=only.x-gesture.start.x,dy=only.y-gesture.start.y;gesture.moved=Math.hypot(dx,dy);state.panX=clamp(gesture.startPanX+dx/r.width,-.82,.82);state.panY=clamp(gesture.startPanY+dy/r.height,-.82,.82);draw();
    }
  }
  function onPointerUp(e){
    if(!pointers.has(e.pointerId))return;e.preventDefault();e.stopPropagation();const r=canvas.getBoundingClientRect(),p=localPointer(e),wasClick=pointers.size===1&&gesture?.mode==='pan'&&gesture.moved<7;
    pointers.delete(e.pointerId);if(wasClick){const n=nearestPoint(p.x,p.y,r.width,r.height,true);if(n)togglePoint(n.id)}
    if(pointers.size===1)beginOnePointer([...pointers.values()][0]);else if(pointers.size===0){gesture=null;state.handleHovered=rotationHandleHit(p.x,p.y,r.width,r.height);canvas.classList.remove('is-dragging','is-rotating');canvas.classList.toggle('is-rotation-hover',state.handleHovered);draw()}
  }

  function setScale(v){state.scale=clamp(v,MIN_SCALE,MAX_SCALE);draw()}
  function setRotation(v){state.rotation=normalizeAngle(v);draw()}

  async function openConfirm(){
    const view=document.getElementById('skyConfirmView');if(!view)return;confirmOpen=true;view.classList.add('is-open');view.setAttribute('aria-hidden','false');drawConfirm();
    fullscreenRequested=false;
    try{if(view.requestFullscreen){await view.requestFullscreen();fullscreenRequested=true;requestAnimationFrame(drawConfirm)}}catch(_){fullscreenRequested=false}
  }
  function finishCloseConfirm(){const view=document.getElementById('skyConfirmView');confirmOpen=false;fullscreenRequested=false;view?.classList.remove('is-open');view?.setAttribute('aria-hidden','true')}
  async function closeConfirm(){
    if(document.fullscreenElement){try{await document.exitFullscreen()}catch(_){finishCloseConfirm()}}else finishCloseConfirm();
  }

  function bindControls(){
    canvas.addEventListener('pointerdown',onPointerDown);canvas.addEventListener('pointermove',onPointerMove);canvas.addEventListener('pointerup',onPointerUp);canvas.addEventListener('pointercancel',onPointerUp);canvas.addEventListener('pointerleave',()=>{if(!pointers.size&&(state.hovered||state.handleHovered)){state.hovered=null;state.handleHovered=false;canvas.classList.remove('is-rotation-hover');draw()}});
    canvas.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();setScale(state.scale*Math.exp(-e.deltaY*.0012))},{passive:false});
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    document.querySelectorAll('[data-sky-action]').forEach(btn=>btn.addEventListener('click',()=>{const a=btn.dataset.skyAction;if(a==='zoom-in')setScale(state.scale*1.14);if(a==='zoom-out')setScale(state.scale/1.14);if(a==='reset')resetState();if(a==='all-on')setAll(true);if(a==='all-off')setAll(false);if(a==='confirm')openConfirm()}));
    document.querySelectorAll('[data-sky-rotate]').forEach(btn=>btn.addEventListener('click',()=>setRotation(state.rotation+Number(btn.dataset.skyRotate))));
    rotationInput?.addEventListener('input',()=>setRotation(Number(rotationInput.value)));
    document.getElementById('easternOn')?.addEventListener('click',()=>setEasternEnabled(true));
    document.getElementById('easternOff')?.addEventListener('click',()=>setEasternEnabled(false));
    markList?.addEventListener('click',e=>{const b=e.target.closest('[data-point-id]');if(b)togglePoint(b.dataset.pointId)});
    document.getElementById('skyConfirmClose')?.addEventListener('click',closeConfirm);
    document.addEventListener('fullscreenchange',()=>{if(fullscreenRequested&&!document.fullscreenElement&&confirmOpen)finishCloseConfirm();else if(confirmOpen)requestAnimationFrame(drawConfirm)});
    window.addEventListener('resize',()=>{draw();if(confirmOpen)drawConfirm()});
    window.addEventListener('exhibition:pagechange',e=>{if(e.detail.page===PAGE_INDEX)requestAnimationFrame(draw)});
  }

  async function loadData(){
    const response=await fetch(DATA_URL,{cache:'no-store'});
    if(!response.ok)throw Error(`실측 성혈 JSON HTTP ${response.status}`);
    const records=await response.json();
    if(!Array.isArray(records)||!records.length)throw Error('실측 성혈 데이터가 없습니다.');
    const ids=new Set();
    const data=records.map(p=>{
      const pos=p.sourcePosition||p.displayPosition;
      if(!p.id||ids.has(p.id)||!pos||![pos.x,pos.z,p.diameter,p.depth].every(Number.isFinite)||p.diameter<=0||p.depth<0)throw Error(`성혈 데이터 오류: ${p.id}`);
      ids.add(p.id);
      return{id:String(p.id),x:pos.x,z:pos.z,diameter:p.diameter,depth:p.depth,status:'measured'};
    });
    const dia=data.map(p=>p.diameter),dep=data.map(p=>p.depth);
    const [dMin,dMax]=[Math.min(...dia),Math.max(...dia)],[hMin,hMax]=[Math.min(...dep),Math.max(...dep)];
    const xMid=(Math.min(...data.map(p=>p.x))+Math.max(...data.map(p=>p.x)))/2;
    const zMid=(Math.min(...data.map(p=>p.z))+Math.max(...data.map(p=>p.z)))/2;
    const norm=(v,a,b)=>a===b?.5:(v-a)/(b-a);
    state.points=data.map(p=>({
      ...p,x:p.x-xMid,y:p.z-zMid,
      coreSize:1.5+2.7*norm(p.diameter,dMin,dMax),
      brightness:.43+.55*norm(p.depth,hMin,hMax),
      haloStrength:.22+.78*norm(p.depth,hMin,hMax)
    }));
    state.active=new Set(state.points.map(p=>p.id));state.ready=true;renderManager();draw();requestAnimationFrame(draw);
    window.__skyMeasuredStatus={count:state.points.length,source:DATA_URL,axes:'X/Z',uniformScale:true,diameterRange:[dMin,dMax],depthRange:[hMin,hMax],pointMetrics:state.points.map(p=>({id:p.id,x:p.x,y:p.y,coreSize:p.coreSize,brightness:p.brightness,haloStrength:p.haloStrength}))};
  }

  function init(){
    canvas=document.getElementById('skyOverlayCanvas');if(!canvas)return;ctx=canvas.getContext('2d');confirmCanvas=document.getElementById('skyConfirmCanvas');confirmCtx=confirmCanvas?.getContext('2d');shell=document.getElementById('skyCanvasShell');markList=document.getElementById('skyMarkList');rotationInput=document.getElementById('skyRotation');
    generateStars();bindControls();loadData().catch(err=>{console.error(err);const n=document.querySelector('.sky-layer-legend');if(n)n.textContent='실측 성혈 데이터를 불러오지 못했습니다.'});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
