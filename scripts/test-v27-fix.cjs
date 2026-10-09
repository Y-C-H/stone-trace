const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const path=require('node:path').resolve(__dirname,'..');
let now=0;let events=new Map();let logs=[],cw=1080,ch=650,mobilePanelY=410;
class E {
 constructor(id=''){this.id=id;this._listeners={};this.dataset={};this.attrs={};this.value='';this.disabled=false;this.children=[];this.classList={add(){},remove(){},toggle(){}};this.style={};this.textContent='';this.innerHTML='';this._tag=''}
 addEventListener(a,f){(this._listeners[a]??=[]).push(f)}
 fire(a,e={}){for(const f of (this._listeners[a]??[]))f({target:this,preventDefault(){},stopPropagation(){},...e})}
 setAttribute(a,v){this.attrs[a]=v}
 appendChild(e){this.children.push(e)}
 remove(){}
 querySelectorAll(sel){return []}
 getBoundingClientRect(){return {width:cw,height:ch,top:100,left:0}}
 getContext(){return makeCtx()}
}
function makeCtx(){let m={};let ctx={canvas:{},fillText(t,x,y){m.texts.push({t,x,y})},measureText(t){return {width:t.length*13}},_m:m,setTransform(){},createRadialGradient(){return {addColorStop(){}}},createLinearGradient(){return {addColorStop(){}}},getStats(){return m}};m.texts=[];return new Proxy(ctx,{get(t,k){return k in t?t[k]:(()=>{})},set(t,k,v){t[k]=v;return true}})}
const elements=new Map();function elt(id){if(!elements.has(id))elements.set(id,new E(id));return elements.get(id)}
let panel=elt('panel');panel.getBoundingClientRect=()=>({top:100+mobilePanelY,left:0,width:320,height:300});
const document={readyState:'complete',getElementById:elt,createDocumentFragment(){return new E('fragment')},createElement(){return new E()},querySelector(q){if(q==='.sky-control-panel')return panel;if(q==='.sky-layer-legend')return new E();return null},querySelectorAll(){return []},addEventListener(){}};
const window={devicePixelRatio:1,matchMedia(){return{matches:false}},addEventListener(a,fn){(events.get(a)||events.set(a,[]).get(a)).push(fn)},__easternAsterismDebug:null};
const canvas=elt('skyOverlayCanvas');canvas.getBoundingClientRect=()=>({width:cw,height:ch,top:100,left:0});canvas.setPointerCapture=()=>{};
const shell=elt('skyCanvasShell');shell.getBoundingClientRect=()=>({top:100,left:0,width:cw,height:ch});
const ctx=makeCtx();canvas.getContext=()=>ctx;
const confirm=elt('skyConfirmCanvas');confirm.getContext=()=>makeCtx();
const fetch=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path+'/'+url,'utf8'))});
const raf=f=>{ /* Manual advancement via window resize event for deterministic testing. */};
const sandbox={document,window,fetch,requestAnimationFrame:raf,performance:{now:()=>now},console,Set,Map,Math,Error,Number,String,Array,Promise};
vm.runInNewContext(fs.readFileSync(path+'/js/skyOverlay.js','utf8'),sandbox);
const get=()=>window.__easternAsterismDebug();
const tick=(dt)=>{now+=dt;for(const f of events.get('resize')||[])f()};
(async()=>{
 await new Promise(setImmediate);
 assert.equal(window.__skyMeasuredStatus.count,46);
 elt('easternOn').fire('click'); await new Promise(setImmediate);await new Promise(setImmediate);
 assert.equal(get().count,12);assert.equal(get().enabled,true);
 const base=get();console.log('PASS data and asterism load',base.count,window.__skyMeasuredStatus.count);
 const tx=base.cupmarkTransform;
 const firstScale=base.view.scale;
 elt('easternFocusSelect').value='CON korean 219';elt('easternFocusSelect').fire('change');
 tick(600);
 const focused=get();assert.equal(focused.focusId,'CON korean 219');assert(focused.view.scale>firstScale);
 assert.deepEqual(focused.cupmarkTransform,tx);
 console.log('PASS focus',focused.focusId,'scale',+(focused.view.scale/firstScale).toFixed(2),'cupmarks unchanged');
 elt('easternOverview').fire('click');tick(600);
 const overview=get();assert.equal(overview.focusId,null);assert(Math.abs(overview.view.scale-firstScale)<1e-6);
 console.log('PASS overview restores scale');
 // simulate cupmark drag / rotate via existing controls, ensure independent of Eastern camera view
 elt('skyRotation').value='97';elt('skyRotation').fire('input');
 const rotated=get();assert.equal(rotated.cupmarkTransform.rotation,97);assert.equal(rotated.focusId,null);
 console.log('PASS independent rotation');
 elt('easternOff').fire('click');assert.equal(get().enabled,false);
 elt('easternOn').fire('click');assert.equal(get().enabled,true);
 console.log('PASS on/off');
 // all labeled boxes are collision free in desktop mock
 const labs=overview.labels;for(let i=0;i<labs.length;i++)for(let j=i+1;j<labs.length;j++)assert(!(Math.abs(labs[i].x-labs[j].x)*2<labs[i].w+labs[j].w && Math.abs(labs[i].y-labs[j].y)*2<labs[i].h+labs[j].h),'label overlap');
 console.log('PASS desktop no label bounding overlaps, visible',labs.length);
 const groups=JSON.parse(fs.readFileSync(path+'/data/eastern-asterisms.json','utf8')).asterisms;
 for(const g of groups){
  elt('easternFocusSelect').value=String(g.id);elt('easternFocusSelect').fire('change');tick(600);
  const v=get();assert.equal(v.focusId,String(g.id));assert(v.view.scale>firstScale);
  for(const k of ['panX','panY','scale'])assert.equal(v.cupmarkTransform[k],tx[k]);
  assert.equal(v.cupmarkTransform.rotation,97);
 }
 console.log('PASS individual focus for all',groups.length,'asterisms and independent cupmark transform');
 elt('easternOverview').fire('click');tick(600);
 // Clicking a projected label directly on the canvas must focus the eastern layer.
 const target=get().labels.find(x=>x.id==='AST exhibit gyeonu');
 assert(target,'expected a selectable asterism label');
 const click={pointerId:33,pointerType:'mouse',clientX:target.x,clientY:target.y+100};
 canvas.fire('pointerdown',click);canvas.fire('pointerup',click);tick(600);
 assert.equal(get().focusId,'AST exhibit gyeonu');
 console.log('PASS label pointer activation without touching cupmark controls');
 elt('easternOverview').fire('click');tick(600);

 cw=355;ch=590;mobilePanelY=330;tick(100);
 const mobile=get();for(let i=0;i<mobile.labels.length;i++)for(let j=i+1;j<mobile.labels.length;j++)assert(!(Math.abs(mobile.labels[i].x-mobile.labels[j].x)*2<mobile.labels[i].w+mobile.labels[j].w && Math.abs(mobile.labels[i].y-mobile.labels[j].y)*2<mobile.labels[i].h+mobile.labels[j].h),'mobile overlap');
 console.log('PASS mobile no labels overlap, visible',mobile.labels.length);
 console.log('BASE_SCALE',firstScale,'MOBILE_SCALE',mobile.view.scale,'JS_ERRORS',logs.length);
})().catch(e=>{console.error(e.stack);process.exitCode=1});
