(function(){
  const PROJECT_TITLE_KO='돌에 새겨진 흔적';
  const PROJECT_SUBTITLE='3D 데이터를 활용한 고인돌의 기억과 성혈의 의미 탐색';
  const CHAPTER_TITLES=[
    '고인돌 지식지도',
    '전승된 기억',
    '쌓여 있는 흔적',
    '오늘의 하늘에 비춰 보다',
    '돌에 새겨진 하늘',
    '수치로 다시 그린 하늘'
  ];

  let pages=[];
  let currentPage=0;
  let transitionTimer=null;
  let navigationToken=0;
  let transitionLocked=false;

  const CHAPTER_COUNT=5;
  const ENDING_INDEX=5;
  function updateNavigation(){
    const ending=currentPage===ENDING_INDEX;
    document.body.dataset.page=String(currentPage);
    const counter=document.getElementById('pageIndex');
    counter.textContent=`${String(Math.min(currentPage+1,CHAPTER_COUNT)).padStart(2,'0')} / 05`;
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
    const readIndexFromHash=()=>{
      if(location.hash==='#ending')return ENDING_INDEX;
      const match=location.hash.match(/^#chapter-(0[1-5])$/);
      return match?Number(match[1])-1:0;
    };
    currentPage=readIndexFromHash();
    pages.forEach((p,i)=>p.classList.toggle('active',i===currentPage));
    document.querySelectorAll('[data-goto]').forEach(btn=>btn.addEventListener('click',()=>goToPage(Number(btn.dataset.goto))));
    document.getElementById('pagePrev').addEventListener('click',previousPage);document.getElementById('pageNext').addEventListener('click',nextPage);
    window.addEventListener('popstate',()=>{finishOpening({immediate:true});goToPage(readIndexFromHash(),{replaceHash:true,instant:true});});

    document.addEventListener('keydown',e=>{
      const dialog=document.getElementById('sourcesDialog');if(e.key==='Escape'&&dialog.open){dialog.close();return}if(dialog.open)return;
      const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT','VIDEO'].includes(tag))return;
      if(openingState!=='finished'){
        if(e.key==='Enter'||e.key===' '){
          // The first key activation starts the opening; only later activations skip it.
          e.preventDefault();
          if(openingState==='waiting')startOpening();
          else if(openingState==='playing')finishOpening({immediate:true});
        }
        return;
      }
      if(currentPage===ENDING_INDEX&&e.key==='Escape'){e.preventDefault();goToPage(ENDING_INDEX-1);return;}
      if(e.key==='ArrowRight'){e.preventDefault();nextPage()}if(e.key==='ArrowLeft'){e.preventDefault();previousPage()}
    });

    let sx=null,sy=null;
    const exhibition=document.querySelector('.exhibition');
    exhibition.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'||e.target.closest('canvas,video,button,input,textarea,select,[role="button"],.graph-info-panel'))return;sx=e.clientX;sy=e.clientY;});
    exhibition.addEventListener('pointerup',e=>{if(sx==null)return;const dx=e.clientX-sx,dy=e.clientY-sy;sx=sy=null;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.4){dx<0?nextPage():previousPage();}});
    document.getElementById('endingReturn')?.addEventListener('click',()=>goToPage(ENDING_INDEX-1));
    updateNavigation();
  }

  function initChapterVideo(){
    const video=document.getElementById('chapter05Video');
    if(!video)return;
    const loading=document.getElementById('chapter05Loading');
    const originalSource=video.querySelector('source')?.getAttribute('src');
    let preparation=null;
    let objectUrl=null;

    // Python's simple HTTP server does not support byte ranges. Native <video>
    // seeking may then jump back to the previous position. A local Blob URL
    // gives the browser a fully seekable media resource independent of server
    // support for 206 Partial Content. The original MP4 remains unchanged.
    function prepareSeekableVideo(){
      if(preparation)return preparation;
      preparation=(async()=>{
        if(!originalSource)throw new Error('Chapter 05 video source is missing');
        const response=await fetch(originalSource,{cache:'force-cache'});
        if(!response.ok)throw new Error(`Video HTTP ${response.status}`);
        const blob=await response.blob();
        if(!blob.size)throw new Error('Chapter 05 video is empty');
        objectUrl=URL.createObjectURL(new Blob([blob],{type:'video/mp4'}));
        video.src=objectUrl;
        video.load();
        if(video.readyState<1){
          await new Promise((resolve,reject)=>{
            const ok=()=>{cleanup();resolve();};
            const fail=()=>{cleanup();reject(new Error('Video metadata loading failed'));};
            const cleanup=()=>{video.removeEventListener('loadedmetadata',ok);video.removeEventListener('error',fail);};
            video.addEventListener('loadedmetadata',ok,{once:true});
            video.addEventListener('error',fail,{once:true});
          });
        }
      })().catch(error=>{
        // Do not lock the visitor out of the video if Blob loading fails.
        console.warn('Chapter 05 seekable preparation failed; using original MP4.',error);
        if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
        video.removeAttribute('src');
        video.preload='metadata';
        video.load();
      }).finally(()=>{
        if(loading)loading.hidden=true;
      });
      return preparation;
    }

    const pauseUnlessActive=()=>{
      if(!document.getElementById('chapter-05')?.classList.contains('active')&&!video.paused)video.pause();
    };
    const onChapterChange=event=>{
      pauseUnlessActive();
      // Prepare on Page 4 as a low-priority head start, or on Page 5 itself.
      // Avoid loading the 12 MB video during the opening or earlier chapters.
      if(event.detail?.page===3||event.detail?.page===4)prepareSeekableVideo();
    };
    window.addEventListener('exhibition:pagechange',onChapterChange);
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&!video.paused)video.pause();});
    if(document.getElementById('chapter-05')?.classList.contains('active'))prepareSeekableVideo();
    // The video never auto-resumes after navigation. Keep currentTime for manual play.
  }

  function initInterpretations(){
    const container=document.getElementById('interpretationPanels');
    if(!container)return;
    const buttons=[...document.querySelectorAll('#chapter-02 .interpretation-item')];
    const panels=[...container.querySelectorAll('[data-interpretation-panel]')];
    function closeSources(){
      container.querySelectorAll('[data-interpretation-sources]').forEach(button=>{
        button.setAttribute('aria-expanded','false');
        const source=document.getElementById(button.getAttribute('aria-controls'));
        if(source)source.hidden=true;
      });
    }
    function selectInterpretation(key){
      const selected=panels.find(panel=>panel.dataset.interpretationPanel===key);
      if(!selected)return;
      closeSources();
      buttons.forEach(button=>{
        const active=button.dataset.interpretation===key;
        button.classList.toggle('active',active);
        button.setAttribute('aria-expanded',String(active));
      });
      panels.forEach(panel=>{panel.hidden=panel!==selected;});
      const body=selected.querySelector('.interpretation-body');
      if(body)body.scrollTop=0;
      if(typeof selected.animate==='function'){
        selected.animate([{opacity:.6,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'ease-out'});
      }
    }
    buttons.forEach(button=>button.addEventListener('click',()=>selectInterpretation(button.dataset.interpretation)));
    container.addEventListener('click',event=>{
      const button=event.target.closest('[data-interpretation-sources]');
      if(!button)return;
      const opening=button.getAttribute('aria-expanded')!=='true';
      closeSources();
      const source=document.getElementById(button.getAttribute('aria-controls'));
      if(!source)return;
      source.hidden=!opening;
      button.setAttribute('aria-expanded',String(opening));
    });
    document.addEventListener('pointerdown',event=>{
      if(!event.target.closest('#chapter-02 .interpretation-detail'))closeSources();
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape')closeSources();});
  }

  function initSources(){
    const dialog=document.getElementById('sourcesDialog');const open=()=>{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','')};
    document.getElementById('openSources')?.addEventListener('click',open);document.getElementById('closeSources').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  }


  let observationMode='overview';

  function setObservationMode(mode,{focus=false}={}){
    const chapter=document.getElementById('chapter-03');
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
    // v32: Keep the curatorial introduction constant in both observation modes.
    // The stage headings and interaction help already explain mode-specific actions.
    // Do not overwrite #observationModeQuestion here.
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

  // v35: Exactly one opening instance, with a user gesture to enable its audio.
  let openingState='finished'; // waiting → playing → closing → finished
  let openingTimer=null;
  let openingRemovalTimer=null;
  let openingAudio=null;

  function stopOpeningAudio(){
    if(!openingAudio)return;
    openingAudio.pause();
    try{openingAudio.currentTime=0;}catch(_error){/* Not seekable yet. */}
  }

  function finishOpening({immediate=false}={}){
    if(openingState==='finished'||(openingState==='closing'&&!immediate))return;
    openingState=immediate?'finished':'closing';
    clearTimeout(openingTimer);
    clearTimeout(openingRemovalTimer);
    const overlay=document.getElementById('exhibitionOpening');
    if(immediate)stopOpeningAudio();
    overlay?.classList.add(immediate?'is-skipped':'is-closing');
    overlay?.setAttribute('aria-hidden','true');
    // Leave chapter navigation hidden until the old 600 ms fade-out completes.
    openingRemovalTimer=setTimeout(()=>{
      openingState='finished';
      stopOpeningAudio();
      document.body.classList.remove('is-opening');
      overlay?.remove();
      window.exhibitionBgm?.openingFinished();
    },immediate?0:620);
  }

  function startOpening(){
    if(openingState!=='waiting')return;
    openingState='playing'; // Guard repeated touch/click/keyboard activation.
    const overlay=document.getElementById('exhibitionOpening');
    const button=document.getElementById('openingStart');
    if(button){button.disabled=true;button.hidden=true;}

    // Trigger background music and opening SFX in the same user gesture.
    window.exhibitionBgm?.startFromOpeningGesture();
    overlay?.classList.add('is-playing');
    if(openingAudio){
      openingAudio.volume=.65;
      try{openingAudio.currentTime=0;}catch(_error){/* Still loading; playback can proceed. */}
      try{
        const playback=openingAudio.play();
        if(playback&&typeof playback.catch==='function')playback.catch(()=>{/* Continue silently if blocked. */});
      }catch(_error){/* Audio is optional; never interrupt the exhibition. */}
    }
    // 0.2s black, 0.8s stone, 0.9s logo, 1.1s hold, 0.6s fade.
    openingTimer=setTimeout(()=>finishOpening(),3000);
  }

  function initOpening(){
    const overlay=document.getElementById('exhibitionOpening');
    if(!overlay)return;
    if(location.hash==='#ending'||/^#chapter-0[2-5]$/.test(location.hash)){
      overlay.remove();return;
    }
    openingState='waiting';
    document.body.classList.add('is-opening');
    openingAudio=document.getElementById('openingAudio');
    if(openingAudio){openingAudio.volume=.65;openingAudio.preload='auto';openingAudio.load();}

    document.getElementById('openingStart')?.addEventListener('click',event=>{
      event.stopPropagation(); // The initiating click must NEVER also skip the opening.
      startOpening();
    });
    overlay.addEventListener('click',()=>{
      if(openingState==='playing')finishOpening({immediate:true});
    });

    // HTML image and audio preload during the waiting screen. Broken artwork uses
    // the existing fallback without forcing a second start or re-playing sound.
    overlay.querySelectorAll('.opening-composition img').forEach(img=>{
      if(img.complete&&img.naturalWidth===0)overlay.classList.add('is-fallback');
      else img.addEventListener('error',()=>overlay.classList.add('is-fallback'),{once:true});
    });
  }

  document.addEventListener('DOMContentLoaded',()=>{
    document.title=`${PROJECT_TITLE_KO} — ${PROJECT_SUBTITLE}`;
    initBookNavigation();initConstellationToc();initChapterVideo();initInterpretations();initSources();initUnifiedObservation();
    window.initEndingSky?.();
    window.initDolmenViewer?.();window.initKnowledgeGraph?.();window.setKnowledgeGraphActive?.(currentPage===0);
    updateNavigation();
    window.exhibitionBgm?.init();
    initOpening();
    if(openingState==='finished')window.exhibitionBgm?.tryDirectPageAutoplay();
  });
})();
