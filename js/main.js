(function(){
  const PROJECT_TITLE_KO='돌에 새겨진 흔적';
  const PROJECT_SUBTITLE='3D 데이터를 활용한 고인돌의 기억과 성혈의 의미 탐색';
  const interpretationData={
    fertility:{index:'INTERPRETATION 01',name:'풍요·다산',body:'일부 연구에서는 성혈을 풍요·다산과 관련된 것으로 해석했습니다.',boundary:'이 설명은 성혈의 의미를 확정하는 결론이 아니라 선행 연구에서 제시된 해석 가능성입니다.',type:'해석 · 가설',illustration:'assets/illustrations/fertility.svg'},
    ritual:{index:'INTERPRETATION 02',name:'제의·의례',body:'일부 연구에서는 성혈을 공동체의 제의·의례 행위와 관련된 것으로 해석했습니다.',boundary:'의례와의 관계는 유물의 배치, 주변 맥락, 비교 사례 등과 함께 검토해야 하는 해석 영역입니다.',type:'해석 · 가설',illustration:'assets/illustrations/ritual.svg'},
    sun:{index:'INTERPRETATION 03',name:'태양·자연의 상징',body:'일부 연구에서는 돌에 남은 원형의 홈을 태양 또는 자연의 상징과 연결해 해석했습니다.',boundary:'원형이라는 형태만으로 특정 상징을 단정하지 않고, 선행 연구의 한 관점으로 제시합니다.',type:'해석 · 가설',illustration:'assets/illustrations/sun.svg'},
    folk:{index:'INTERPRETATION 04',name:'민간신앙',body:'일부 연구에서는 성혈을 민간신앙 또는 주술적 행위와 관련된 것으로 해석했습니다.',boundary:'민간신앙과의 관련성 역시 하나의 해석 가능성이며, 대상 유물의 제작 의도를 확정하는 설명으로 사용하지 않습니다.',type:'해석 · 가설',illustration:'assets/illustrations/folk-belief.svg'},
    astronomy:{index:'INTERPRETATION 05',name:'별자리 관련 가능성',body:'일부 연구에서는 성혈 또는 돌에 남은 점·홈의 배열을 별자리와 연결해 해석한 사례가 있습니다. 하나의 해석 가능성일 뿐 결론이 아닙니다.',boundary:'형태적 유사성과 과거 제작자의 의도는 서로 다른 문제이므로, 분석 결과와 역사적 해석을 구분합니다.',type:'해석 · 가설',illustration:'assets/illustrations/astronomy.svg'},
    other:{index:'INTERPRETATION 06',name:'그 밖의 가능성',body:'일부 연구에서는 성혈을 인구나 수량의 기록, 장소 표식 등으로 해석했습니다.',boundary:'서로 다른 해석의 근거와 한계를 함께 보여주고, 하나의 설명으로 수렴시키지 않습니다.',type:'해석 · 가설',illustration:'assets/illustrations/other.svg'}
  };

  const CHAPTER_TITLES=[
    '고인돌 지식지도',
    '고인돌과 성혈 관찰',
    '여러가지 해석',
    '성혈을 밤하늘에 겹쳐보기',
    '마지막 장면'
  ];

  let pages=[];
  let currentPage=0;
  let transitionTimer=null;
  let navigationToken=0;
  let transitionLocked=false;

  const CHAPTER_COUNT=4;
  const ENDING_INDEX=4;
  function updateNavigation(){
    const ending=currentPage===ENDING_INDEX;
    document.body.dataset.page=String(currentPage);
    const counter=document.getElementById('pageIndex');
    counter.textContent=`${String(Math.min(currentPage+1,CHAPTER_COUNT)).padStart(2,'0')} / 04`;
    const prev=document.getElementById('pagePrev'),next=document.getElementById('pageNext');
    prev.disabled=currentPage===0||ending;
    next.disabled=ending;
    prev.classList.toggle('is-hidden',currentPage===0||ending);
    next.classList.toggle('is-hidden',ending);
    const prevTitle=CHAPTER_TITLES[currentPage-1]||'이전 장';
    const nextTitle=CHAPTER_TITLES[currentPage+1]||'다음 장';
    const prevStrong=prev.querySelector('.nav-copy strong'),nextStrong=next.querySelector('.nav-copy strong');
    if(prevStrong)prevStrong.textContent=prevTitle;
    if(nextStrong)nextStrong.textContent=nextTitle;
    prev.setAttribute('aria-label',currentPage>0?`이전 장: ${prevTitle}`:'이전 장으로 이동');
    next.setAttribute('aria-label',ending?'이동 없음':`다음 장: ${nextTitle}`);
    document.querySelectorAll('.constellation-toc [data-goto]').forEach(btn=>btn.classList.toggle('active',Number(btn.dataset.goto)===currentPage));
  }

  function notifyPageChange(previous){
    window.setKnowledgeGraphActive?.(currentPage===0);
    window.dispatchEvent(new CustomEvent('exhibition:pagechange',{detail:{page:currentPage,previous}}));
  }

  function goToPage(index,{replaceHash=false,instant=false}={}){
    index=Math.max(0,Math.min(pages.length-1,Number(index)));
    if(!instant&&transitionLocked)return;
    if(index===currentPage&&pages[index].classList.contains('active'))return;
    const token=++navigationToken,previous=currentPage,oldPage=pages[previous],newPage=pages[index],forward=index>previous;
    clearTimeout(transitionTimer);
    pages.forEach(p=>p.classList.remove('leaving-left','leaving-right','from-left'));

    if(instant){
      transitionLocked=false;document.body.classList.remove('page-turning');
      pages.forEach(p=>p.classList.remove('active','from-left','leaving-left','leaving-right'));
      newPage.classList.add('active');
      window.dispatchEvent(new CustomEvent('exhibition:pageactivated',{detail:{page:index}}));
    }else{
      transitionLocked=true;document.body.classList.add('page-turning');
      newPage.classList.toggle('from-left',!forward);
      if(oldPage&&oldPage!==newPage){oldPage.classList.remove('active','from-left');oldPage.classList.add(forward?'leaving-left':'leaving-right');}
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        if(token!==navigationToken)return;
        newPage.classList.add('active');
        window.dispatchEvent(new CustomEvent('exhibition:pageactivated',{detail:{page:index}}));
        /* Remove the backward-entry staging class at the moment the page becomes active.
           Keeping it until transition cleanup caused a second transform at the end (the visible 'bounce'). */
        newPage.classList.remove('from-left');
      }));
    }

    currentPage=index;updateNavigation();
    const toc=document.getElementById('constellationToc'),tocToggle=document.getElementById('tocToggle');
    if(toc?.classList.contains('open')){toc.classList.remove('open');tocToggle?.setAttribute('aria-expanded','false');}
    notifyPageChange(previous);
    const hash=index===ENDING_INDEX?'#ending':`#chapter-${String(index+1).padStart(2,'0')}`;
    if(replaceHash)history.replaceState(null,'',hash);else history.pushState(null,'',hash);

    transitionTimer=setTimeout(()=>{
      if(token!==navigationToken)return;
      pages.forEach((p,i)=>{p.classList.remove('leaving-left','leaving-right','from-left');if(i!==currentPage)p.classList.remove('active');});
      transitionLocked=false;document.body.classList.remove('page-turning');
    },720);
  }

  function nextPage(){if(currentPage<pages.length-1)goToPage(currentPage+1)}
  function previousPage(){if(currentPage>0)goToPage(currentPage-1)}
  window.goToPage=goToPage;window.nextPage=nextPage;window.previousPage=previousPage;

  function initConstellationToc(){
    const toc=document.getElementById('constellationToc'),toggle=document.getElementById('tocToggle');if(!toc||!toggle)return;
    toggle.addEventListener('click',()=>{const open=toc.classList.toggle('open');toggle.setAttribute('aria-expanded',open?'true':'false');});
    toc.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>{if(matchMedia('(max-width:760px)').matches){toc.classList.remove('open');toggle.setAttribute('aria-expanded','false');}}));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&toc.classList.contains('open')){toc.classList.remove('open');toggle.setAttribute('aria-expanded','false');}});
  }

  function initBookNavigation(){
    pages=[...document.querySelectorAll('.exhibition-page')];
    const readIndexFromHash=()=>location.hash==='#ending'?ENDING_INDEX:(location.hash.match(/^#chapter-(0[1-4])$/)?.[1]?Number(location.hash.match(/^#chapter-(0[1-4])$/)[1])-1:0);
    currentPage=readIndexFromHash();
    pages.forEach((p,i)=>p.classList.toggle('active',i===currentPage));
    document.querySelectorAll('[data-goto]').forEach(btn=>btn.addEventListener('click',()=>goToPage(Number(btn.dataset.goto))));
    document.getElementById('pagePrev').addEventListener('click',previousPage);document.getElementById('pageNext').addEventListener('click',nextPage);
    window.addEventListener('popstate',()=>{finishOpening({immediate:true});goToPage(readIndexFromHash(),{replaceHash:true,instant:true});});

    document.addEventListener('keydown',e=>{
      const dialog=document.getElementById('sourcesDialog');if(e.key==='Escape'&&dialog.open){dialog.close();return}if(dialog.open)return;
      const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;
      if(openingActive&&(e.key==='Enter'||e.key===' ')){e.preventDefault();finishOpening({immediate:true});return;}
      if(openingActive)return;
      if(currentPage===ENDING_INDEX&&e.key==='Escape'){e.preventDefault();goToPage(3);return;}
      if(e.key==='ArrowRight'){e.preventDefault();nextPage()}if(e.key==='ArrowLeft'){e.preventDefault();previousPage()}
    });

    let sx=null,sy=null;
    const exhibition=document.querySelector('.exhibition');
    exhibition.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'||e.target.closest('canvas,button,input,textarea,select,[role="button"],.graph-info-panel'))return;sx=e.clientX;sy=e.clientY;});
    exhibition.addEventListener('pointerup',e=>{if(sx==null)return;const dx=e.clientX-sx,dy=e.clientY-sy;sx=sy=null;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.4){dx<0?nextPage():previousPage();}});
    document.getElementById('endingReturn')?.addEventListener('click',()=>goToPage(3));
    updateNavigation();
  }

  function initInterpretations(){
    const detail=document.getElementById('interpretationDetail'),visual=document.getElementById('interpretationIllustration');
    document.querySelectorAll('.interpretation-item').forEach(btn=>btn.addEventListener('click',()=>{
      const d=interpretationData[btn.dataset.interpretation];
      document.querySelectorAll('.interpretation-item').forEach(b=>{b.classList.toggle('active',b===btn);b.setAttribute('aria-expanded',b===btn?'true':'false');});
      if(!document.body.classList.contains('motion-reduced'))detail.animate([{opacity:.55,transform:'translateY(4px)'},{opacity:1,transform:'none'}],{duration:280,easing:'ease-out'});
      document.getElementById('interpretationIndex').textContent=d.index;document.getElementById('interpretationName').textContent=d.name;document.getElementById('interpretationBody').textContent=d.body;detail.querySelector('.type-label').textContent=d.type;
      if(visual)visual.src=d.illustration;
    }));
  }

  function initSources(){
    const dialog=document.getElementById('sourcesDialog');const open=()=>{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','')};
    document.getElementById('openSources')?.addEventListener('click',open);document.getElementById('closeSources').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  }

  function initMotionPreference(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)document.body.classList.add('motion-reduced');}

  let observationMode='overview';

  function setObservationMode(mode,{focus=false}={}){
    const chapter=document.getElementById('chapter-02');
    if(!chapter||!['overview','observation'].includes(mode))return;
    observationMode=mode;
    chapter.dataset.observationMode=mode;
    const overview=chapter.querySelector('[data-observation-panel="overview"]');
    const observation=chapter.querySelector('[data-observation-panel="observation"]');
    const isOverview=mode==='overview';
    overview?.classList.toggle('is-active',isOverview);
    observation?.classList.toggle('is-active',!isOverview);
    overview?.setAttribute('aria-hidden',isOverview?'false':'true');
    observation?.setAttribute('aria-hidden',isOverview?'true':'false');
    const question=document.getElementById('observationModeQuestion');
    if(question)question.textContent=isOverview
      ?'우리는 이 돌을 어떻게 지각하는가? 눈앞의 물질과 그 표면에 축적된 시간을 함께 바라봅니다.'
      :'실측 좌표로 등록한 성혈 위치를 켜고 선택하여 직경과 깊이 등의 측정 정보를 살펴보실 수 있습니다.';
    requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent('exhibition:observationchange',{detail:{mode}})));
    if(focus){
      const target=isOverview?document.getElementById('enterObservation'):document.getElementById('returnOverview');
      target?.focus({preventScroll:true});
    }
  }
  window.setObservationMode=setObservationMode;

  function initUnifiedObservation(){
    document.getElementById('enterObservation')?.addEventListener('click',()=>setObservationMode('observation',{focus:true}));
    document.getElementById('returnOverview')?.addEventListener('click',()=>setObservationMode('overview',{focus:true}));
    setObservationMode('overview');
  }

  let openingActive=false;
  let openingTimer=null;
  let openingRemovalTimer=null;
  function finishOpening({immediate=false}={}){
    if(!openingActive)return;
    openingActive=false;
    clearTimeout(openingTimer);
    clearTimeout(openingRemovalTimer);
    const overlay=document.getElementById('exhibitionOpening');
    overlay?.classList.add(immediate?'is-skipped':'is-closing');
    overlay?.setAttribute('aria-hidden','true');
    // Keep the Chapter navigation hidden until the overlay finishes fading.
    openingRemovalTimer=setTimeout(()=>{
      document.body.classList.remove('is-opening');
      overlay?.remove();
    },immediate?0:620);
  }
  function initOpening(){
    const overlay=document.getElementById('exhibitionOpening');
    if(!overlay)return;
    if(location.hash==='#ending'||/^#chapter-0[2-4]$/.test(location.hash)){
      overlay.remove();return;
    }
    openingActive=true;
    document.body.classList.add('is-opening');
    overlay.addEventListener('click',()=>finishOpening({immediate:true}));
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const images=[...overlay.querySelectorAll('.opening-composition img')];
    const imageReady=Promise.all(images.map(img=>{
      if(img.complete)return Promise.resolve(img.naturalWidth>0);
      return new Promise(resolve=>{
        img.addEventListener('load',()=>resolve(true),{once:true});
        img.addEventListener('error',()=>resolve(false),{once:true});
      });
    }));
    // Limit asset waiting so even a slow or failed image cannot block exhibition entry.
    Promise.race([imageReady,new Promise(resolve=>setTimeout(()=>resolve(null),900))]).then(()=>{
      if(!openingActive)return;
      const loaded=images.length===2&&images.every(img=>img.complete&&img.naturalWidth>0);
      overlay.classList.add(loaded?'is-playing':'is-fallback');
      // 0.2s black, 0.8s stone, 0.9s logo, 1.1s hold, 0.6s fade.
      openingTimer=setTimeout(()=>finishOpening(),reduced?320:3000);
    });
  }

  document.addEventListener('DOMContentLoaded',()=>{
    document.title=`${PROJECT_TITLE_KO} — ${PROJECT_SUBTITLE}`;
    initMotionPreference();initBookNavigation();initConstellationToc();initInterpretations();initSources();initUnifiedObservation();
    window.initEndingSky?.();
    window.initDolmenViewer?.();window.initKnowledgeGraph?.();window.setKnowledgeGraphActive?.(currentPage===0);
    updateNavigation();initOpening();
  });
})();
