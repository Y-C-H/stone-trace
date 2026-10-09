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
    context.save();
    if(eastern.enabled)context.globalAlpha=.72;
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
    context.restore();
  }

  // v28: illustrated, per-asterism layout. Keep the original points and edges intact;
  // only a uniform similarity transform is applied to each complete asterism.
  const easternView={focusId:null,transition:null,hitTargets:[],labelBoxes:[],lastView:null,lastGroupViews:null};
  const EASTERN_FOCUS_MS=560;
  // Curated, deliberately irregular positions. These are SCREEN positions, not celestial coordinates.
  const EASTERN_DESKTOP={
    '북두':[.16,.26,.190], '직녀':[.45,.17,.127], '하고':[.71,.26,.137],
    '북극':[.89,.15,.145], '구진':[.12,.51,.176], '문창':[.36,.47,.172],
    '남두':[.63,.51,.190], '견우':[.88,.57,.150], '각':[.18,.83,.147],
    '심':[.42,.77,.136], '묘':[.63,.83,.132], '삼':[.86,.85,.169]
  };
  // On phones the visible sky is shorter because the controls overlay its lower edge.
  // The compact map retains every asterism and provides individually legible detail on tap.
  const EASTERN_MOBILE={
    '북두':[.20,.18,.190], '직녀':[.49,.16,.172], '하고':[.81,.18,.162],
    '구진':[.16,.40,.172], '문창':[.50,.37,.180], '북극':[.84,.39,.155],
    '남두':[.19,.63,.179], '묘':[.50,.61,.167], '견우':[.83,.63,.170],
    '각':[.16,.86,.160], '심':[.49,.84,.163], '삼':[.83,.85,.190]
  };
  function easternArea(context,w,h){
    let visibleH=h;
    if(context===ctx && w<760 && shell){
      const panel=document.querySelector('.sky-control-panel');
      if(panel){
        const clear=panel.getBoundingClientRect().top-shell.getBoundingClientRect().top-8;
        if(clear>175)visibleH=Math.min(h,clear);
      }
    }
    return {w,h,visibleH,cx:w*.5,cy:visibleH*.51};
  }
  function easternSourcePoint(star){
    const radius=(90-star.dec)/135,theta=rad(star.ra);
    return{x:radius*Math.sin(theta),y:-radius*Math.cos(theta)};
  }
  function easternItems(group){
    if(!eastern.data)return [];
    const stars=new Map(eastern.data.stars.map(s=>[String(s.id??s.hip),s]));
    const groups=group?[group]:eastern.data.asterisms;
    return [...new Set(groups.flatMap(g=>g.lines.flat().map(String)))].map(id=>stars.get(id)).filter(Boolean).map(easternSourcePoint);
  }
  function easternBounds(points){
    if(!points.length)return{minX:-.5,maxX:.5,minY:-.5,maxY:.5,midX:0,midY:0,rx:1,ry:1};
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    return{minX,maxX,minY,maxY,midX:(minX+maxX)/2,midY:(minY+maxY)/2,rx:maxX-minX,ry:maxY-minY};
  }
  function easternOverviewLayouts(w,h,context=ctx){
    if(!eastern.data)return {};
    const area=easternArea(context,w,h),mobile=w<760;
    const config=mobile?EASTERN_MOBILE:EASTERN_DESKTOP;
    const footprint=Math.min(w,area.visibleH*(mobile?1.45:1.55));
    const views={};
    for(const group of eastern.data.asterisms){
      const id=String(group.id),b=easternBounds(easternItems(group));
      const [anchorX,anchorY,size]=config[group.name]||[.5,.5,.135];
      // Uniform scale within each asterism: no non-uniform resizing or per-star repositioning.
      const maxSpan=Math.max(b.rx,b.ry,.000001);
      const span=Math.max(mobile?48:85,footprint*size);
      const scale=span/maxSpan;
      const halfW=b.rx*scale/2,halfH=b.ry*scale/2;
      const marginX=mobile?14:34,top=mobile?61:72,bottom=mobile?27:40;
      const centerX=clamp(w*anchorX,marginX+halfW,w-marginX-halfW);
      const centerY=clamp(area.visibleH*anchorY,top+halfH,area.visibleH-bottom-halfH);
      views[id]={scale,tx:centerX-b.midX*scale,ty:centerY-b.midY*scale};
    }
    return views;
  }
  function easternFocusLayout(group,w,h,context=ctx){
    const area=easternArea(context,w,h),b=easternBounds(easternItems(group)),mobile=w<760;
    const fitScale=Math.min((w*(mobile?.64:.59))/Math.max(.00001,b.rx),(area.visibleH*.56)/Math.max(.00001,b.ry));
    // Limit excessive magnification while maintaining shape for very tightly packed clusters.
    const overview=easternOverviewLayouts(w,h,context)[String(group.id)];
    const scale=Math.max(overview.scale,Math.min(fitScale,overview.scale*5.5));
    return{scale,tx:area.cx-b.midX*scale,ty:area.cy-b.midY*scale};
  }
  function easternTargetLayouts(w,h,context=ctx){
    const layouts=easternOverviewLayouts(w,h,context);
    if(easternView.focusId){
      const g=eastern.data?.asterisms.find(q=>String(q.id)===easternView.focusId);
      if(g)layouts[String(g.id)]=easternFocusLayout(g,w,h,context);
    }
    return layouts;
  }
  function easternCurrentLayouts(w,h,context=ctx){
    const to=easternTargetLayouts(w,h,context),t=easternView.transition;
    if(!t)return to;
    const u=clamp((performance.now()-t.start)/EASTERN_FOCUS_MS,0,1);
    if(u>=1){easternView.transition=null;return to}
    const ease=u*u*(3-2*u),out={};
    for(const [id,goal] of Object.entries(to)){
      const from=t.from[id]||goal;
      out[id]={scale:from.scale+(goal.scale-from.scale)*ease,
        tx:from.tx+(goal.tx-from.tx)*ease,ty:from.ty+(goal.ty-from.ty)*ease};
    }
    return out;
  }
  function easternPixel(star,view){
    const p=easternSourcePoint(star);
    return{x:view.tx+p.x*view.scale,y:view.ty+p.y*view.scale};
  }
  function setEasternFocus(id){
    if(!eastern.loaded||!eastern.enabled)return;
    const next=id==null?null:String(id);
    if(next===easternView.focusId&&!easternView.transition)return;
    if(next&&!eastern.data.asterisms.some(g=>String(g.id)===next))return;
    const r=canvas.getBoundingClientRect();
    const from=easternCurrentLayouts(r.width,r.height);
    easternView.focusId=next;
    easternView.transition={from,start:performance.now()};
    updateEasternControls();draw();
    if(confirmOpen)drawConfirm();
  }
  function hitEastern(x,y,labelsOnly=false){
    if(!eastern.enabled||!eastern.loaded)return null;
    for(const q of [...easternView.hitTargets].reverse()){
      if(q.kind==='label'&&x>=q.x-q.w/2-5&&x<=q.x+q.w/2+5&&y>=q.y-q.h/2-5&&y<=q.y+q.h/2+5)return q.id;
    }
    if(labelsOnly)return null;
    let best=null,distBest=Infinity;
    for(const q of easternView.hitTargets){
      if(q.kind!=='star')continue;
      const d=Math.hypot(x-q.x,y-q.y);
      if(d<distBest){best=q.id;distBest=d}
    }
    return distBest <= (window.matchMedia('(pointer:coarse)').matches?21:13)?best:null;
  }
  function drawEastern(context,w,h){
    if(!eastern.enabled||!eastern.loaded||!eastern.data)return;
    const stars=new Map(eastern.data.stars.map(s=>[String(s.id??s.hip),s]));
    const views=easternCurrentLayouts(w,h,context),area=easternArea(context,w,h),mobile=w<760;
    const recording=context===ctx,targets=[],labels=[];
    const ordered=[...eastern.data.asterisms].sort((a,b)=>Number(String(a.id)===easternView.focusId)-Number(String(b.id)===easternView.focusId));
    const focus=easternView.focusId, fading=easternView.transition!==null;
    context.save();context.lineCap='round';context.lineJoin='round';
    for(const group of ordered){
      const id=String(group.id),focused=id===focus;
      if(focus&&!focused&&!fading)continue;
      const view=views[id];if(!view)continue;
      const softened=focus&&!focused;
      context.globalAlpha=softened?.19:1;
      const ids=[...new Set(group.lines.flat().map(String))];
      const all=ids.map(key=>stars.get(key)).filter(Boolean).map(s=>easternPixel(s,view));
      if(!all.length)continue;
      context.lineWidth=focused?2.5:mobile?1.7:2.0;
      context.strokeStyle=focused?'rgba(216,238,255,.90)':'rgba(156,207,242,.73)';
      for(const seq of group.lines){
        const pts=seq.map(key=>stars.get(String(key))).filter(Boolean).map(s=>easternPixel(s,view));
        if(pts.length<2)continue;
        context.beginPath();context.moveTo(pts[0].x,pts[0].y);
        for(let i=1;i<pts.length;i++)context.lineTo(pts[i].x,pts[i].y);
        context.stroke();
      }
      for(let j=0;j<all.length;j++){
        const q=all[j];
        if(q.x< -18||q.x>w+18||q.y< -18||q.y>h+18)continue;
        const radius=focused?4.15:mobile?3.15:3.65;
        const halo=context.createRadialGradient(q.x,q.y,0,q.x,q.y,radius*3.2);
        halo.addColorStop(0,'rgba(181,224,255,.39)');halo.addColorStop(.36,'rgba(136,193,238,.16)');halo.addColorStop(1,'rgba(117,178,228,0)');
        context.fillStyle=halo;context.beginPath();context.arc(q.x,q.y,radius*3.2,0,Math.PI*2);context.fill();
        context.fillStyle=j%3===0?'rgba(239,248,255,.99)':'rgba(203,232,252,.95)';
        context.beginPath();context.arc(q.x,q.y,radius*(j%4===1?.82:1),0,Math.PI*2);context.fill();
        if(recording&&!softened)targets.push({kind:'star',id,x:q.x,y:q.y});
      }
      const midX=all.reduce((a,p)=>a+p.x,0)/all.length;
      const minY=Math.min(...all.map(p=>p.y));
      const maxY=Math.max(...all.map(p=>p.y));
      labels.push({id,name:group.name,x:midX,y:minY,top:minY,bottom:maxY,focused,softened});
    }
    context.globalAlpha=1;
    const placed=[],fs=mobile?12:15;
    context.font=`500 ${fs}px system-ui,sans-serif`;
    context.textAlign='center';context.textBaseline='middle';
    labels.sort((a,b)=>Number(b.focused)-Number(a.focused));
    const edgeTop=mobile?52:55,edgeBottom=area.visibleH-12;
    for(const label of labels){
      if(label.softened)continue;
      if(label.x < -40||label.x > w+40||label.top < -40||label.top > area.visibleH+40)continue;
      const lw=context.measureText(label.name).width+17,lh=fs+11;
      const offset=mobile?19:22;
      const proposals=[
        [label.x,label.top-offset],[label.x+37,label.top-offset],
        [label.x-37,label.top-offset],[label.x,label.bottom+offset],
        [label.x+42,label.bottom+offset],[label.x-42,label.bottom+offset],
        [label.x+50,label.top],[label.x-50,label.top]
      ];
      let position=null;
      for(const [candidateX,candidateY] of proposals){
        const x=clamp(candidateX,lw/2+4,w-lw/2-4),y=candidateY;
        if(y-lh/2<edgeTop||y+lh/2>edgeBottom)continue;
        if(placed.some(q=>Math.abs(x-q.x)*2<q.w+lw+11&&Math.abs(y-q.y)*2<q.h+lh+12))continue;
        position={x,y,w:lw,h:lh};break;
      }
      // A label must not obliterate another constellation; if crowded, selection stays in the menu.
      if(!position)continue;
      placed.push({...position,id:label.id});
      context.fillStyle='rgba(4,10,19,.77)';
      context.fillRect(position.x-lw/2,position.y-lh/2,lw,lh);
      context.fillStyle=label.focused?'#f1faff':'rgba(221,238,249,.95)';
      context.fillText(label.name,position.x,position.y);
      if(recording)targets.push({kind:'label',id:label.id,...position});
    }
    context.restore();
    if(recording){
      easternView.hitTargets=targets;
      easternView.labelBoxes=placed;
      easternView.lastView={mode:focus?'focus':'curated',groupViews:views};
      easternView.lastGroupViews=views;
    }
    if(easternView.transition)requestAnimationFrame(()=>{draw();if(confirmOpen)drawConfirm()});
  }
  function updateEasternControls(){
    document.getElementById('easternOn')?.setAttribute('aria-pressed',String(eastern.enabled));
    document.getElementById('easternOff')?.setAttribute('aria-pressed',String(!eastern.enabled));
    document.querySelector('.sky-control-panel')?.classList.toggle('eastern-active',eastern.enabled);
    const selector=document.getElementById('easternFocusSelect'),overview=document.getElementById('easternOverview');
    if(selector){selector.disabled=!eastern.enabled;selector.value=easternView.focusId||''}
    if(overview)overview.disabled=!eastern.enabled||easternView.focusId===null;
  }
  async function setEasternEnabled(on){
    if(!on){eastern.enabled=false;easternView.hitTargets=[];updateEasternControls();draw();if(confirmOpen)drawConfirm();return;}
    if(eastern.loaded){eastern.enabled=true;updateEasternControls();draw();if(confirmOpen)drawConfirm();return;}
    if(eastern.loading)return;
    eastern.loading=true;
    try{
      const response=await fetch(EASTERN_URL);if(!response.ok)throw Error('HTTP '+response.status);
      const data=await response.json();
      if(!data||!Array.isArray(data.stars)||!Array.isArray(data.asterisms))throw Error('Invalid constellation data');
      eastern.data=data;eastern.loaded=true;eastern.error=null;eastern.enabled=true;
      const select=document.getElementById('easternFocusSelect');
      if(select){
        select.querySelectorAll('option:not([value=""])').forEach(n=>n.remove());
        for(const group of data.asterisms){const opt=document.createElement('option');opt.value=String(group.id);opt.textContent=group.name;select.appendChild(opt)}
      }
    }catch(err){eastern.enabled=false;eastern.error=String(err)}
    finally{eastern.loading=false;updateEasternControls();draw();if(confirmOpen)drawConfirm();}
  }
  window.__easternAsterismDebug=()=>({enabled:eastern.enabled,loaded:eastern.loaded,loading:eastern.loading,error:eastern.error,count:eastern.data?.asterisms?.length||0,focusId:easternView.focusId,overview:easternView.focusId===null,view:easternView.lastView,labels:easternView.labelBoxes,hitTargets:easternView.hitTargets.length,cupmarkTransform:{panX:state.panX,panY:state.panY,scale:state.scale,rotation:state.rotation}});

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
    drawSky(ctx,s.w,s.h);if(eastern.enabled)drawEastern(ctx,s.w,s.h);else easternView.hitTargets=[];
    drawPoints(ctx,s.w,s.h);drawRotationHandle(ctx,s.w,s.h);
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
    pointers.delete(e.pointerId);if(wasClick){
      // Labels are intentional controls even if a gold cupmark visually crosses one.
      const labelId=hitEastern(p.x,p.y,true);
      if(labelId)setEasternFocus(labelId);
      else{const n=nearestPoint(p.x,p.y,r.width,r.height,true);if(n)togglePoint(n.id);else{const id=hitEastern(p.x,p.y);if(id)setEasternFocus(id)}}
    }
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
    document.getElementById('skyMobileControlsCue')?.addEventListener('click',()=>document.querySelector('.sky-control-panel')?.scrollIntoView({behavior:'smooth',block:'start'}));
    document.getElementById('easternOn')?.addEventListener('click',()=>setEasternEnabled(true));
    document.getElementById('easternOff')?.addEventListener('click',()=>setEasternEnabled(false));
    document.getElementById('easternOverview')?.addEventListener('click',()=>setEasternFocus(null));
    document.getElementById('easternFocusSelect')?.addEventListener('change',e=>setEasternFocus(e.target.value||null));
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
