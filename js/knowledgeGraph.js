/*
 * CHAPTER 01 — 고인돌의 별자리
 * Content derives from the existing project; visual design follows the user-supplied
 * "별자리페이지프롬프트" and interaction uses click-drag elasticity.
 */
(function(){
  const DATA=window.STONE_GRAPH_DATA||{groups:{},nodes:[],links:[]};
  const BASE_NODES=(DATA.nodes||[]).map(n=>[n.id,n.label,n.g,n.text,n.image,n.images,n.source]);
  const BASE_LINKS=(DATA.links||[]).map(l=>[l.source,l.target,l.sourceType]);

  /* Visual system follows the user-supplied "별자리페이지프롬프트":
   * radial night-sky background, spherical nodes, subtle depth fading,
   * seeded 3D placement, thin constellation links and restrained gold accents.
   */
  function shadowColor(hex,factor=.43){
    const v=parseInt((hex||'#dfe8f5').slice(1),16);
    const r=Math.round((v>>16)*factor),g=Math.round((v>>8&255)*factor),b=Math.round((v&255)*factor);
    return `#${[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('')}`;
  }
  const GR=Object.fromEntries(Object.entries(DATA.groups||{}).map(([code,g])=>[code,[g.name,g.color,shadowColor(g.color)]]));
  const CLUSTER_CENTER={
    c:[0,0,-55],
    a:[-540,-180,-255],
    b:[425,-275,35],
    p:[-270,315,265],
    u:[385,245,-220],
    s:[35,-420,255],
    k:[640,70,235],
    n:[-75,405,-235],
    d:[475,455,315],
    e:[-575,145,95],
    w:[-360,445,-85]
  };
  const GROUP_SPREAD={c:0,a:84,b:70,p:86,u:82,s:74,k:76,e:75,n:60,w:85,d:74};
  const HUB_BY_GROUP={c:'dol',a:'a5',b:'b2',p:'p1',u:'u1',s:'s1',k:'k1',e:'e0',n:'n1',w:'w2',d:'d0'};
  const CORE_LINKS=new Set([
    'b2|dol','b2|b5','b5|u8','k1|u1','d0|dol','dol|n1',
    'k1|k9','dol|s1','p2|s1','p4|s4','p6|s7','p7|s8','p9|s9'
  ]);
  const STORAGE='dolmen-added';
  // v26: exhibition animation does not depend on OS/browser motion preferences.
  const LABEL_FONT='"Noto Serif KR", "Nanum Myeongjo", Georgia, serif';
  const F=1000;
  const RAD={3:15,2:7.5,1:3.8,0:2.8};
  const LABEL_BASE={3:20,2:13,1:10,0:8};

  let nodes=[],links=[],adj={},on=Object.fromEntries(Object.keys(GR).map(k=>[k,1]));
  let focusId=null,hoverId=null,active=false,initialized=false,raf=0,alpha=.18;
  let canvas,ctx,sky,skyCtx,labelLayer,glowLayer,panel,filters;
  let W=0,H=0,DPR=1,fitDistance=1250;
  let yaw=.35,pitch=.2,dist=1250,targetDist=1250,autoRotate=true,lastInteraction=0;
  let pointers=new Map(),pinchDistance=0;
  let draggedNodeId=null;
  const projected=new Map(),labels=new Map(),clusterLabels={};
  const dust=[];

  function seeded(seed){return()=>((seed=(seed*16807)%2147483647)/2147483647)}
  const dustRand=seeded(20261001);
  for(let i=0;i<320;i++)dust.push({x:dustRand(),y:dustRand(),r:.2+dustRand()*dustRand()*1.1,p:dustRand()*6.28,s:.45+dustRand()*1.35,a:.16+dustRand()*.48});

  function rgba(hex,a){const v=parseInt(hex.slice(1),16);return`rgba(${v>>16},${v>>8&255},${v&255},${a})`}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
  function linkKey(a,b){return [a,b].sort().join('|')}
  function groupOf(id){return nodes.find(n=>n.id===id)?.g}
  function nodeById(id){return nodes.find(n=>n.id===id)}
  function linkedToFocus(n){return !focusId||n.id===focusId||(adj[focusId]&&adj[focusId].has(n.id))}
  function visibleNode(n){return !!on[n.g]}
  function nodeOpacity(n){if(!visibleNode(n))return 0;return linkedToFocus(n)?1:.18}

  function rebuildAdj(){
    adj={};
    for(const n of nodes)adj[n.id]=new Set();
    for(const l of links){if(adj[l.source]&&adj[l.target]){adj[l.source].add(l.target);adj[l.target].add(l.source)}}
  }

  function rankNodes(){
    for(const n of nodes){
      const degree=adj[n.id]?.size||0;
      n.rank=n.id==='dol'?3:(HUB_BY_GROUP[n.g]===n.id||degree>=4?2:(degree<=1?0:1));
      if(n.id.startsWith('custom-'))n.rank=1;
    }
  }

  function seedPositions(){
    const r=seeded(8801),golden=2.399;
    const groups={};
    for(const n of nodes)(groups[n.g]||(groups[n.g]=[])).push(n);
    for(const [g,list] of Object.entries(groups)){
      const center=CLUSTER_CENTER[g]||[0,0,0],hubId=HUB_BY_GROUP[g],spread=GROUP_SPREAD[g]||80;
      const hub=list.find(n=>n.id===hubId);
      if(hub){hub.hx=center[0];hub.hy=center[1];hub.hz=center[2];}
      const rest=list.filter(n=>n!==hub);
      rest.forEach((n,i)=>{
        const a=(i+1)*golden+Object.keys(CLUSTER_CENTER).indexOf(g)*.58;
        const d=spread*Math.sqrt(i+1)*(0.82+r()*.22);
        n.hx=center[0]+Math.cos(a)*d*1.12;
        n.hy=center[1]+Math.sin(a)*d*.78;
        n.hz=center[2]+(r()-.5)*300;
      });
    }
    for(const n of nodes){
      n.x=n.hx;n.y=n.hy;n.z=n.hz;n.vx=0;n.vy=0;n.vz=0;
      n.phase=(n.phase??(r()*6.283));
    }
  }

  function loadData(){
    nodes=BASE_NODES.map(([id,label,g,text,image,images,source])=>({id,label,g,text,image,images:Array.isArray(images)?images:(image?[image]:[]),source}));
    links=BASE_LINKS.map(([source,target,sourceType])=>({source,target,sourceType}));
    try{
      const saved=JSON.parse(localStorage.getItem(STORAGE)||'[]');
      saved.forEach((r,i)=>addNode(r,false,i));
    }catch(_){/* localStorage may be unavailable */}
    rebuildAdj();rankNodes();seedPositions();
  }

  function triangular(min,max){return min+(max-min)*((Math.random()+Math.random())*.5)}
  function randomizeStars(){
    nodes.forEach(n=>{
      const rank=n.rank??1;
      let size=triangular(.55,1.80);
      if(rank===3)size=clamp(size,.92,1.42);
      else if(rank===2)size=clamp(size,.68,1.66);
      else if(rank===1)size=clamp(size,.55,1.80);
      else size=clamp(size,.55,1.72);
      n.randSize=size;
      let bright=.40+Math.random()*.90;
      if(rank===3)bright=clamp(bright,.78,1.30);
      else if(rank===2)bright=clamp(bright,.52,1.30);
      n.randBright=bright;
      n.randGlow=.60+Math.random()*1.10;
    });
  }

  function makeLayersForNode(n){
    if(labels.has(n.id))return;
    const label=document.createElement('div');
    label.className='graph-node-label';label.textContent=n.label;label.style.color=(GR[n.g]?.[1]||'#dfe8f5');label.style.fontFamily=LABEL_FONT;
    labelLayer.appendChild(label);labels.set(n.id,label);
  }

  function buildClusterLabels(){
    Object.entries(GR).forEach(([g,[name,color]])=>{
      if(g==='c')return;
      const el=document.createElement('div');el.className='graph-cluster-label';el.textContent=`${name} 성좌`;el.style.color=color;el.style.fontFamily=LABEL_FONT;labelLayer.appendChild(el);clusterLabels[g]=el;
    });
  }

  function renderFilters(){
    filters.innerHTML='';
    Object.entries(GR).forEach(([g,[name,color]])=>{
      const b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed',on[g]?'true':'false');
      const i=document.createElement('i');i.style.background=color;b.append(i,document.createTextNode(name));
      b.addEventListener('click',()=>{on[g]=!on[g];b.setAttribute('aria-pressed',on[g]?'true':'false');if(focusId&&!on[groupOf(focusId)])closePanel();});
      filters.appendChild(b);
    });
    const add=document.createElement('button');add.type='button';add.className='graph-add-star';add.textContent='별 추가하기';add.addEventListener('click',openAddPanel);filters.appendChild(add);
  }

  function calculateFitDistance(){
    const xs=nodes.map(n=>n.hx),ys=nodes.map(n=>n.hy),zs=nodes.map(n=>n.hz);
    const gw=Math.max(...xs)-Math.min(...xs)+180,gh=Math.max(...ys)-Math.min(...ys)+190,minZ=Math.min(...zs);
    const den=Math.max(F*gw/Math.max(320,W*.92),F*gh/Math.max(260,H*.88));
    return clamp(den-minZ,820,5200);
  }

  function resize(){
    if(!canvas||!sky)return;
    DPR=Math.min(devicePixelRatio||1,2);const r=canvas.getBoundingClientRect();W=r.width||innerWidth;H=r.height||innerHeight;
    canvas.width=W*DPR;canvas.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);
    sky.width=W*DPR;sky.height=H*DPR;skyCtx.setTransform(DPR,0,0,DPR,0,0);
    fitDistance=calculateFitDistance();
    if(!Number.isFinite(dist)||Math.abs(targetDist-dist)<1){dist=targetDist=fitDistance;}
  }

  function transformPoint(n){
    const c1=Math.cos(yaw),s1=Math.sin(yaw),c2=Math.cos(pitch),s2=Math.sin(pitch);
    const x=n.x*c1+n.z*s1;
    let z=-n.x*s1+n.z*c1;
    const y=n.y*c2-z*s2;z=n.y*s2+z*c2;
    const den=dist+z;
    if(den<80)return{x:0,y:0,s:0,z,visible:false};
    const s=F/den;
    return{x:W/2+x*s,y:H/2+y*s,s,z,visible:true};
  }

  function simulate(){
    const heat=.25+alpha;
    const now=performance.now();
    for(const n of nodes){
      if(draggedNodeId===n.id)continue;
      const boost=n.springBoostUntil&&n.springBoostUntil>now?1.85:1;
      const homeK=(n.id==='dol'?.025:(n.rank>=2?.012:.009))*boost;
      n.vx+=(n.hx-n.x)*homeK*heat;n.vy+=(n.hy-n.y)*homeK*heat;n.vz+=(n.hz-n.z)*homeK*heat;
    }
    for(const l of links){
      const a=nodeById(l.source),b=nodeById(l.target);if(!a||!b)continue;
      const hdx=b.hx-a.hx,hdy=b.hy-a.hy,hdz=b.hz-a.hz,target=Math.hypot(hdx,hdy,hdz)||1;
      let dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,d=Math.hypot(dx,dy,dz)||1;
      const delta=d-target,f=delta*.0011*heat;dx/=d;dy/=d;dz/=d;
      if(draggedNodeId!==a.id){a.vx+=dx*f;a.vy+=dy*f;a.vz+=dz*f;}
      if(draggedNodeId!==b.id){b.vx-=dx*f;b.vy-=dy*f;b.vz-=dz*f;}
    }
    for(const n of nodes){
      if(draggedNodeId===n.id){n.vx=n.vy=n.vz=0;continue;}
      n.x+=n.vx;n.y+=n.vy;n.z+=n.vz;
      const damp=.89;n.vx*=damp;n.vy*=damp;n.vz*=damp;
      if(n.id==='dol'){n.x+=(n.hx-n.x)*.12;n.y+=(n.hy-n.y)*.12;n.z+=(n.hz-n.z)*.12;}
    }
    alpha=Math.max(.025,alpha*.965);
  }

  function drawSky(t){
    skyCtx.clearRect(0,0,W,H);
    const ox=Math.sin(yaw)*13,oy=Math.sin(pitch)*8;
    for(const s of dust){
      const aa=s.a*(.72+.28*Math.sin(t/1050*s.s+s.p));
      skyCtx.fillStyle=`rgba(207,214,230,${aa})`;skyCtx.beginPath();skyCtx.arc(s.x*W+ox*s.r,s.y*H+oy*s.r,s.r,0,Math.PI*2);skyCtx.fill();
    }
  }

  function depthFade(p){
    const base=F/fitDistance;return clamp(.28+.72*(p.s/base)*.82,.2,1);
  }

  function linkStyle(l){
    const a=nodeById(l.source),b=nodeById(l.target);if(!a||!b||!on[a.g]||!on[b.g])return null;
    const hot=focusId&&(l.source===focusId||l.target===focusId);
    const core=CORE_LINKS.has(linkKey(l.source,l.target));
    if(focusId&&!hot)return{color:'#7d88a6',alpha:.035,width:.55};
    if(hot)return{color:'#f0e3bd',alpha:.82,width:1.15};
    if(core)return{color:'#c9a862',alpha:.42,width:1.05};
    return{color:'#7d88a6',alpha:.16,width:.66};
  }

  function mixTowardWhite(hex,amount){
    const v=parseInt(hex.slice(1),16),r=v>>16,g=v>>8&255,b=v&255,a=clamp(amount,0,1);
    const rr=Math.round(r+(255-r)*a),gg=Math.round(g+(255-g)*a),bb=Math.round(b+(255-b)*a);
    return `rgb(${rr},${gg},${bb})`;
  }


  // v25-fix — real model surface samples (precomputed offline from Chapter 02's GLB).
  // Only the existing 'dol' node is changed visually. Its ID, center, hit test and links remain intact.
  const DOLMEN_POINTS=(window.STONE_DOLMEN_SCAN_CLOUD?.points||[]).map((r,i)=>({
    x:r[0],y:r[1],z:r[2],height:r[3],kind:r[4],r:r[4]===1?.79:.60
  }));
  function dolmenCloudScale(p){return clamp(p.s*1.65,.95,2.25);}
  function dolmenCloudRadius(p){return 65*dolmenCloudScale(p);}
  function drawDolmenCloud(n,p,t){
    const opacity=nodeOpacity(n)*depthFade(p);
    if(!opacity||!p.visible)return;
    const k=dolmenCloudScale(p),cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const isFocused=focusId===n.id||hoverId===n.id||draggedNodeId===n.id;
    // Same 3D graph camera as every other node. The point positions came from the real scan.
    const pts=DOLMEN_POINTS.map(dot=>{
      const x=dot.x*cy+dot.z*sy,z=-dot.x*sy+dot.z*cy;
      return {dot,sx:p.x+x*k,sy:p.y+(dot.y*cp-z*sp)*k,sz:dot.y*sp+z*cp};
    }).sort((a,b)=>b.sz-a.sz);
    for(const {dot,sx,sy} of pts){
      const contour=dot.kind===1,rear=dot.kind===2;
      const alpha=contour?.98:rear?.55:(.68+.26*dot.height);
      ctx.globalAlpha=clamp(opacity*alpha*(isFocused?1.13:1),0,1);
      ctx.fillStyle=rear?'#92754d':contour?'#e4cb92':dot.height>.52?'#dac08b':'#bea06c';
      ctx.beginPath();ctx.arc(sx,sy,Math.max(.44,dot.r*k*(isFocused?1.25:1.1)),0,Math.PI*2);ctx.fill();
    }
    if(isFocused){
      ctx.strokeStyle='rgba(232,207,157,.27)';ctx.lineWidth=.7;ctx.globalAlpha=.68;
      ctx.beginPath();ctx.ellipse(p.x,p.y,61*k,38*k,0,0,Math.PI*2);ctx.stroke();
    }
    ctx.globalAlpha=1;
  }

  function drawSphere(n,p,t){
    if(!p.visible||!visibleNode(n))return;
    if(n.id==='dol'){drawDolmenCloud(n,p,t);return;}
    const rank=n.rank??1,twinkle=.85+.15*Math.sin(t/900+n.phase);
    const bright=clamp(n.randBright??1,.4,1.3),glow=clamp(n.randGlow??1,.6,1.7);
    const base=nodeOpacity(n)*depthFade(p)*twinkle;
    const opacity=clamp(base*(.38+.62*bright),0,1);
    const r=Math.max(1.1,RAD[rank]*p.s*(n.randSize??1));
    const color=GR[n.g]?.[1]||'#dfe8f5',shadow=GR[n.g]?.[2]||'#4f5f78';
    const showHalo=rank>=2||bright>1.02;
    if(showHalo){
      const haloScale=(rank===3?3.4:2.45)*glow;
      const halo=ctx.createRadialGradient(p.x,p.y,r*.52,p.x,p.y,r*haloScale);
      halo.addColorStop(0,rgba(color,clamp((rank===3?.34:.17)*bright,0,.52)));
      halo.addColorStop(1,'rgba(0,0,0,0)');
      ctx.globalAlpha=clamp(opacity*(rank===3?.92:.72),0,1);ctx.fillStyle=halo;ctx.beginPath();ctx.arc(p.x,p.y,r*haloScale,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=opacity;
    if(r>2.2){
      const highlight=mixTowardWhite(color,clamp(.10+(bright-.4)*.34,.10,.42));
      const gd=ctx.createRadialGradient(p.x-r*.34,p.y-r*.38,Math.max(.2,r*.07),p.x,p.y,r);
      gd.addColorStop(0,mixTowardWhite('#ffffff',clamp((bright-1)*.2,0,.08)));
      gd.addColorStop(clamp(.18+.10/bright,.18,.34),highlight);
      gd.addColorStop(1,shadow);ctx.fillStyle=gd;
    }else ctx.fillStyle=color;
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    if(bright>1.08&&r>2.2){
      ctx.globalAlpha=clamp((bright-1.02)*.62,0,.18);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(p.x-r*.28,p.y-r*.3,Math.max(.7,r*.18),0,Math.PI*2);ctx.fill();
    }
    if(n.id===focusId||n.id===hoverId||n.id===draggedNodeId){ctx.globalAlpha=.94;ctx.strokeStyle='#f0e3bd';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,r+4,0,Math.PI*2);ctx.stroke();}
    ctx.globalAlpha=1;
  }

  function drawGraph(t){
    ctx.clearRect(0,0,W,H);projected.clear();
    nodes.forEach(n=>projected.set(n.id,transformPoint(n)));
    for(const l of links){
      const a=projected.get(l.source),b=projected.get(l.target),sty=linkStyle(l);if(!a?.visible||!b?.visible||!sty)continue;
      const fade=(depthFade(a)+depthFade(b))*.5;ctx.globalAlpha=sty.alpha*fade;ctx.strokeStyle=sty.color;ctx.lineWidth=sty.width*clamp((a.s+b.s)/(2*(F/fitDistance)),.65,1.5);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    const ordered=[...nodes].sort((a,b)=>projected.get(b.id).z-projected.get(a.id).z);
    for(const n of ordered)drawSphere(n,projected.get(n.id),t);
    ctx.globalAlpha=1;
  }

  function updateOverlays(){
    const clusterPos={};
    for(const n of nodes){
      const p=projected.get(n.id),label=labels.get(n.id);if(!p||!label)continue;
      if(!p.visible||!visibleNode(n)){label.style.opacity=0;continue;}
      const rank=n.rank??1,fp=LABEL_BASE[rank]*p.s*1.4;
      const related=!focusId||n.id===focusId||adj[focusId]?.has(n.id);
      const show=rank===3||n.id===focusId||n.id===hoverId||(related&&rank===2&&fp>=11)||(related&&rank===1&&fp>=12)||(related&&rank===0&&fp>=12.5);
      label.style.transform=`translate(${p.x}px,${p.y+(n.id==='dol'?dolmenCloudRadius(p)*.83:Math.max(5,RAD[rank]*p.s*n.randSize))+fp*.9}px) translateX(-50%)`;
      label.style.fontSize=`${clamp(fp,6.5,26)}px`;label.style.opacity=show?nodeOpacity(n)*depthFade(p):0;label.style.fontWeight=rank===3?'700':'400';
      if(n.g!=='c'){const c=clusterPos[n.g]=clusterPos[n.g]||{x:0,y:0,n:0};c.x+=p.x;c.y+=p.y;c.n++;}
    }
    for(const g in clusterLabels){
      const el=clusterLabels[g],c=clusterPos[g];if(!c){el.style.opacity=0;continue;}
      el.style.transform=`translate(${c.x/c.n}px,${c.y/c.n-54}px) translate(-50%,-50%)`;el.style.opacity=focusId?.12:.48;
    }
  }

  function frame(t){
    if(!active){raf=0;return;}
    if(autoRotate&&!pointers.size&&performance.now()-lastInteraction>2200)yaw+=.0009;
    dist+=(targetDist-dist)*.14;
    simulate();drawSky(t);drawGraph(t);updateOverlays();raf=requestAnimationFrame(frame);
  }
  function startLoop(){if(!raf)raf=requestAnimationFrame(frame)}
  function stopLoop(){if(raf){cancelAnimationFrame(raf);raf=0}}

  function visualRadius(n,p){return n.id==='dol'?dolmenCloudRadius(p):Math.max(1.1,RAD[n.rank??1]*p.s*(n.randSize??1))}
  function pickNode(x,y,pointerType='mouse'){
    let best=null,bestScore=Infinity,bestDepth=Infinity;
    const minHit=pointerType==='touch'?20:14;
    for(const n of nodes){
      if(!visibleNode(n))continue;
      const p=projected.get(n.id);if(!p?.visible)continue;
      const vr=visualRadius(n,p),hit=Math.max(vr+8,minHit),d=Math.hypot(p.x-x,p.y-y);
      if(d>hit)continue;
      const score=d/hit;
      if(score<bestScore-.035||(Math.abs(score-bestScore)<=.035&&p.z<bestDepth)){
        best=n;bestScore=score;bestDepth=p.z;
      }
    }
    return best;
  }

  function closePanel(){panel.classList.remove('on');panel.setAttribute('aria-hidden','true');focusId=null;}
  function closeButton(){const b=document.createElement('button');b.type='button';b.className='graph-panel-close';b.textContent='×';b.setAttribute('aria-label','닫기');b.addEventListener('click',closePanel);return b;}
  function connectedButtons(id){
    const wrap=document.createElement('div');wrap.className='graph-connected-links';
    for(const x of (adj[id]||[])){const n=nodeById(x);if(!n)continue;const b=document.createElement('button');b.type='button';b.textContent=n.label;b.addEventListener('click',()=>selectNode(n.id));wrap.appendChild(b);}
    return wrap;
  }
  function showInfo(id){
    const n=nodeById(id);if(!n)return;panel.innerHTML='';panel.appendChild(closeButton());
    const h=document.createElement('h2');h.textContent=n.label;const tag=document.createElement('div');tag.className='graph-panel-tag';tag.textContent=(GR[n.g]?.[0]||'분류 미정')+(n.g==='p'?' · 연구자 해석 초안':'');
    panel.append(h,tag);
    const imageList=(Array.isArray(n.images)&&n.images.length?n.images:(n.image?[n.image]:[]));
    if(imageList.length){
      const gallery=document.createElement('div');gallery.className='graph-node-photo-gallery';
      imageList.forEach((src,index)=>{
        const figure=document.createElement('figure');figure.className='graph-node-photo';
        const img=document.createElement('img');img.src=src;img.alt=`${n.label} 사진${imageList.length>1?` ${index+1}`:''}`;img.loading='lazy';img.decoding='async';
        img.addEventListener('error',()=>{figure.hidden=true;});
        figure.appendChild(img);gallery.appendChild(figure);
      });
      panel.appendChild(gallery);
    }
    if(n.text){const p=document.createElement('p');p.textContent=n.text;panel.appendChild(p);}
    else{const pending=document.createElement('div');pending.className='graph-panel-note graph-data-pending';pending.textContent='설명 데이터 입력 예정';panel.appendChild(pending);}
    if(adj[id]?.size){const s=document.createElement('div');s.className='graph-panel-tag';s.textContent='연결된 별';panel.append(s,connectedButtons(id));}
    if(n.g==='p'){const note=document.createElement('div');note.className='graph-panel-note';note.textContent='철학 노드와 그 연결은 자료의 내용이 아니라 연구 방향을 정리한 해석 초안입니다. 인용 전에 원전으로 확인하세요.';panel.appendChild(note);}
    if(n.g==='s'){const note=document.createElement('div');note.className='graph-panel-note';note.textContent='스캔 데이터 노드는 실제 3D 스캔 후 값이 입력될 자리입니다. 현재 설명은 데이터 구조와 전시 연결 방식을 보여주는 안내입니다.';panel.appendChild(note);}
    panel.appendChild(buildAddDetails());panel.classList.add('on');panel.setAttribute('aria-hidden','false');
  }
  function selectNode(id){focusId=id;hoverId=id;lastInteraction=performance.now();showInfo(id);targetDist=Math.max(fitDistance*.58,fitDistance*(id==='dol'?.72:.82));}

  function buildAddDetails(){
    const d=document.createElement('details');d.className='graph-add-details';d.innerHTML='<summary>별 추가하기</summary><form><input name="l" placeholder="이름" required maxlength="40" aria-label="이름"><textarea name="t" rows="3" placeholder="설명" maxlength="400" aria-label="설명"></textarea><select name="g" aria-label="분류"></select><select name="to" aria-label="연결할 별"></select><button type="submit">추가하기</button></form>';
    const f=d.querySelector('form');Object.entries(GR).filter(([k])=>k!=='c').forEach(([k,v])=>f.g.add(new Option(v[0],k)));nodes.forEach(n=>f.to.add(new Option(`${n.label}과 연결`,n.id)));
    f.addEventListener('submit',e=>{e.preventDefault();const r={l:f.l.value.trim(),t:f.t.value.trim(),g:f.g.value,to:f.to.value};if(!r.l)return;const node=addNode(r,true);renderFilters();selectNode(node.id);});return d;
  }
  function openAddPanel(){panel.innerHTML='';panel.appendChild(closeButton());const h=document.createElement('h2');h.textContent='별 추가하기';const d=buildAddDetails();d.open=true;panel.append(h,d);panel.classList.add('on');panel.setAttribute('aria-hidden','false');}

  function addNode(r,persist,index){
    const id=`custom-${Date.now()}-${index??nodes.length}`,target=nodeById(r.to),g=r.g||'u';
    const n={id,label:r.l,g,text:r.t||'설명이 아직 없습니다.',image:null,images:[],source:'visitor'};nodes.push(n);links.push({source:id,target:r.to});rebuildAdj();rankNodes();
    const home=target||nodeById(HUB_BY_GROUP[g]);const rj=seeded(9100+nodes.length*17),center=CLUSTER_CENTER[g]||[0,0,0];n.hx=(home?.hx??center[0])+(rj()-.5)*70;n.hy=(home?.hy??center[1])+(rj()-.5)*58;n.hz=(home?.hz??center[2])+(rj()-.5)*80;n.x=n.hx;n.y=n.hy;n.z=n.hz;n.vx=n.vy=n.vz=0;n.phase=rj()*6.283;n.randSize=1;n.randBright=1;n.randGlow=1;
    if(initialized)makeLayersForNode(n);
    if(persist){try{const arr=JSON.parse(localStorage.getItem(STORAGE)||'[]');arr.push(r);localStorage.setItem(STORAGE,JSON.stringify(arr));}catch(_){}}
    alpha=.5;return n;
  }

  function screenDeltaToWorld(dx,dy,n){
    const p=projected.get(n.id)||transformPoint(n),s=Math.max(.0001,p.s||F/fitDistance);
    const cx=dx/s,cy=dy/s,cp=Math.cos(pitch),sp=Math.sin(pitch),cyaw=Math.cos(yaw),syaw=Math.sin(yaw);
    const iy=cy*cp,iz1=-cy*sp;
    return{x:cx*cyaw-iz1*syaw,y:iy,z:cx*syaw+iz1*cyaw};
  }

  function beginNodeDrag(state){
    const n=nodeById(state.nodeId);if(!n)return;
    state.mode='node-drag';state.samples=[];draggedNodeId=n.id;n.vx=n.vy=n.vz=0;alpha=Math.max(alpha,.28);
  }

  function recordDragSample(state,worldDelta,dt){
    if(dt<=0)return;
    state.samples.push({x:worldDelta.x/dt,y:worldDelta.y/dt,z:worldDelta.z/dt,w:performance.now()});
    if(state.samples.length>5)state.samples.shift();
  }

  function releaseDraggedNode(state){
    const n=nodeById(state.nodeId);if(!n)return;
    const samples=state.samples||[];
    if(samples.length){
      let sx=0,sy=0,sz=0,sw=0;
      samples.forEach((v,i)=>{const w=i+1;sx+=v.x*w;sy+=v.y*w;sz+=v.z*w;sw+=w;});
      let vx=(sx/sw)*16*0.68,vy=(sy/sw)*16*0.68,vz=(sz/sw)*16*0.68;
      const mag=Math.hypot(vx,vy,vz),maxV=11.5;
      if(mag>maxV){const k=maxV/mag;vx*=k;vy*=k;vz*=k;}
      n.vx=vx;n.vy=vy;n.vz=vz;
    }else n.vx=n.vy=n.vz=0;
    n.springBoostUntil=performance.now()+1450;
    draggedNodeId=null;alpha=Math.max(alpha,.82);
  }

  function bindPointerEvents(){
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    /* Wheel is intentionally zoom-only. */
    canvas.addEventListener('wheel',e=>{if(!active)return;e.preventDefault();lastInteraction=performance.now();const min=fitDistance*.48,max=fitDistance*1.8;targetDist=clamp(targetDist*Math.exp(e.deltaY*.0007),min,max);},{passive:false});

    canvas.addEventListener('pointerdown',e=>{
      if(!active)return;
      canvas.setPointerCapture(e.pointerId);
      const rect=canvas.getBoundingClientRect(),node=pickNode(e.clientX-rect.left,e.clientY-rect.top,e.pointerType);
      const now=performance.now();
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,lastT:now,nodeId:node?.id||null,mode:node?'node-candidate':'camera',samples:[]});
      lastInteraction=now;
      if(pointers.size===2){
        const a=[...pointers.values()];pinchDistance=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
        if(draggedNodeId){const dn=nodeById(draggedNodeId);if(dn)dn.vx=dn.vy=dn.vz=0;draggedNodeId=null;}
        a.forEach(s=>s.mode='pinch');
      }
      canvas.classList.add('drag');
      canvas.style.cursor=node?'grab':'grabbing';
    });

    canvas.addEventListener('pointermove',e=>{
      if(!active)return;
      const state=pointers.get(e.pointerId);
      if(state){
        const now=performance.now(),dx=e.clientX-state.x,dy=e.clientY-state.y,dt=Math.max(1,now-state.lastT);
        state.x=e.clientX;state.y=e.clientY;state.lastT=now;lastInteraction=now;
        const travel=Math.hypot(e.clientX-state.startX,e.clientY-state.startY);

        if(pointers.size===2||state.mode==='pinch'){
          const a=[...pointers.values()];
          if(a.length===2){const d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);if(pinchDistance>0){const min=fitDistance*.48,max=fitDistance*1.8;targetDist=clamp(targetDist*(pinchDistance/d),min,max);}pinchDistance=d;}
          return;
        }

        if(state.mode==='node-candidate'&&travel>=7)beginNodeDrag(state);
        if(state.mode==='node-drag'){
          const n=nodeById(state.nodeId);if(!n)return;
          const delta=screenDeltaToWorld(dx,dy,n);
          n.x+=delta.x;n.y+=delta.y;n.z+=delta.z;n.vx=n.vy=n.vz=0;
          recordDragSample(state,delta,dt);alpha=Math.max(alpha,.34);canvas.style.cursor='grabbing';
          return;
        }
        if(state.mode==='camera'){
          yaw+=dx*.0048;pitch=clamp(pitch+dy*.0048,-1.15,1.15);canvas.style.cursor='grabbing';
          return;
        }
        return;
      }

      if(e.pointerType==='mouse'){
        const r=canvas.getBoundingClientRect(),n=pickNode(e.clientX-r.left,e.clientY-r.top,'mouse');hoverId=n?.id||null;canvas.style.cursor=n?'grab':'grab';
      }
    });

    function end(e){
      const state=pointers.get(e.pointerId);if(!state)return;
      pointers.delete(e.pointerId);pinchDistance=0;
      if(state.mode==='node-drag')releaseDraggedNode(state);
      else if(state.mode==='node-candidate')selectNode(state.nodeId);
      else if(state.mode==='camera'){
        const travel=Math.hypot((state.x??e.clientX)-state.startX,(state.y??e.clientY)-state.startY);
        if(travel<7)closePanel();
      }
      if(!pointers.size){canvas.classList.remove('drag');draggedNodeId=null;}
      try{canvas.releasePointerCapture(e.pointerId)}catch(_){}
      if(e.pointerType==='mouse'){
        const r=canvas.getBoundingClientRect(),n=pickNode(e.clientX-r.left,e.clientY-r.top,'mouse');hoverId=n?.id||null;canvas.style.cursor=n?'grab':'grab';
      }
    }
    canvas.addEventListener('pointerup',end);
    canvas.addEventListener('pointercancel',e=>{const state=pointers.get(e.pointerId);if(state?.mode==='node-drag'){const n=nodeById(state.nodeId);if(n)n.vx=n.vy=n.vz=0;}pointers.delete(e.pointerId);draggedNodeId=null;pinchDistance=0;if(!pointers.size)canvas.classList.remove('drag');});
    canvas.addEventListener('pointerleave',e=>{if(!pointers.has(e.pointerId))hoverId=null;});
  }

  function fitView(){yaw=.35;pitch=.2;fitDistance=calculateFitDistance();targetDist=dist=fitDistance;alpha=Math.max(alpha,.24);lastInteraction=performance.now();}

  window.initKnowledgeGraph=function(){
    if(initialized)return;initialized=true;
    canvas=document.getElementById('constellationGraph');sky=document.getElementById('graphSky');labelLayer=document.getElementById('graphLabelLayer');glowLayer=document.getElementById('graphGlowLayer');panel=document.getElementById('graphPanel');filters=document.getElementById('graphGroupFilters');
    if(!canvas||!sky||!labelLayer||!panel||!filters)return;
    ctx=canvas.getContext('2d');skyCtx=sky.getContext('2d');loadData();nodes.forEach(makeLayersForNode);buildClusterLabels();renderFilters();resize();fitView();bindPointerEvents();
    document.getElementById('graphRotate')?.addEventListener('click',e=>{autoRotate=!autoRotate;e.currentTarget.textContent=autoRotate?'자동 회전 끄기':'자동 회전 켜기';lastInteraction=0;});
    document.getElementById('graphFit')?.addEventListener('click',fitView);
    document.getElementById('graphOpenAdd')?.addEventListener('click',openAddPanel);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel.classList.contains('on'))closePanel();});
    window.addEventListener('resize',()=>{resize();fitDistance=calculateFitDistance();});
  };

  window.__knowledgeGraphV25={sourceModel:window.STONE_DOLMEN_SCAN_CLOUD?.source,cloudNodeId:'dol',pointCount:DOLMEN_POINTS.length,getPointCloudPoints:()=>DOLMEN_POINTS.map(p=>({...p})),getNodeCount:()=>nodes.length,getLinkCount:()=>links.length,getCenterNode:()=>{const n=nodeById('dol');return n?{id:n.id,group:n.g,rank:n.rank,neighbors:[...(adj.dol||[])],position:{x:n.x,y:n.y,z:n.z}}:null},selectCenter:()=>selectNode('dol')};
  window.setKnowledgeGraphActive=function(next){
    if(!initialized)return;
    if(next&&!active){active=true;randomizeStars();alpha=Math.max(alpha,.35);resize();startLoop();}
    else if(!next&&active){active=false;stopLoop();pointers.clear();canvas.classList.remove('drag');}
  };
})();
