/* Stone Traces v19 (based on shader-fixed v16-C): standalone WebGL2 viewer for lossless, triangle-preserving GLB.
 * No frameworks, no decimation. Measured C-series cupmarks only. Geometry stays in STL coordinates.
 * Focus camera calculations use unchanged measured positions and precomputed surface offsets.
 */
(function(){
 'use strict';
 const SHADER_V=`#version 300 es
 precision highp float;
 layout(location=0) in vec3 a_position;
 uniform mat4 u_proj, u_view;
 uniform vec3 u_center;
 uniform float u_scale;
 out vec3 v_position;
 void main(){
   vec3 p=(a_position-u_center)*u_scale;
   v_position=p;
   gl_Position=u_proj*u_view*vec4(p,1.0);
 }`;
 const SHADER_F=`#version 300 es
 precision highp float;
 in vec3 v_position;
 uniform int u_mode;
 uniform float u_lightAngle;
 uniform vec3 u_eye;
 out vec4 color;
 void main(){
   vec3 normal=normalize(cross(dFdx(v_position),dFdy(v_position)));
   vec3 eyeDirection=normalize(u_eye-v_position);
   if(dot(normal,eyeDirection)<0.0)normal=-normal;
   vec3 lightDir= u_mode==1 ? normalize(vec3(cos(u_lightAngle),0.17,sin(u_lightAngle)))
                             : normalize(vec3(-0.40,0.82,0.55));
   float nd=max(dot(normal,lightDir),0.0);
   float softFill=0.25+0.15*max(normal.y,0.0);
   float sideFill=0.13*max(dot(normal,normalize(vec3(.66,.26,-.7))),0.0);
   float intensity=softFill+nd*(u_mode==1?0.76:0.63)+sideFill;
   vec3 stone=(u_mode==2) ? vec3(.64,.65,.65) : vec3(.57,.565,.535);
   if(u_mode==1)stone=vec3(.61,.59,.55);
   color=vec4(pow(clamp(stone*intensity,0.0,1.0),vec3(.93)),1.0);
 }`;
 const TEXTURED_VERTEX=`#version 300 es
 precision highp float;
 layout(location=0) in vec3 a_position;
 layout(location=1) in vec2 a_uv;
 uniform mat4 u_proj,u_view;
 uniform vec3 u_center,u_texTranslation;
 uniform float u_scale,u_texYaw;
 out vec3 v_position;
 out vec2 v_uv;
 void main(){
   float c=cos(u_texYaw),s=sin(u_texYaw);
   vec3 q=vec3(c*a_position.x+s*a_position.z,a_position.y,-s*a_position.x+c*a_position.z)+u_texTranslation;
   vec3 p=(q-u_center)*u_scale;
   v_position=p;
   v_uv=a_uv; // Unchanged Geomagic OBJ vt. JPEG upload is flipped to OBJ's v-up orientation.
   gl_Position=u_proj*u_view*vec4(p,1.0);
 }`;
 const TEXTURED_FRAGMENT=`#version 300 es
 precision highp float;
 in vec3 v_position;
 in vec2 v_uv;
 uniform sampler2D u_tex;
 uniform vec3 u_eye;
 out vec4 color;
 void main(){
   vec3 n=normalize(cross(dFdx(v_position),dFdy(v_position)));
   if(dot(n,normalize(u_eye-v_position))<0.0)n=-n;
   float diffuse=max(dot(n,normalize(vec3(-.36,.80,.53))),0.0);
   float illumination=clamp(.70+.25*diffuse,0.0,1.0);
   // RGBA8 stores source JPEG sRGB bytes directly; decode sRGB for light calculation.
   vec3 texel=pow(clamp(texture(u_tex,v_uv).rgb,0.0,1.0),vec3(2.2));
   color=vec4(pow(clamp(texel*illumination,0.0,1.0),vec3(1.0/2.2)),1.0);
 }`;

 // v22: selected measured cupmark geyser/halo; all coordinates are unchanged model positions.
 const BEACON_VERTEX=`#version 300 es
 precision highp float;
 uniform mat4 u_proj,u_view;
 uniform vec3 u_point,u_right;
 uniform float u_height,u_width,u_time;
 out vec2 v_uv;
 void main(){
   int i=gl_VertexID%6;
   vec2 uv=(i==0||i==3||i==5)?vec2(0.,i==0?0.:1.):vec2(1.,i==1?0.:1.);
   // vertices: bottom-left, bottom-right, top-right, bottom-left, top-right, top-left
   if(i==3)uv=vec2(0.,0.);
   if(i==4)uv=vec2(1.,1.);
   if(i==5)uv=vec2(0.,1.);
   v_uv=uv;
   float halfW=u_width*(.66+.34*uv.y)*.5;
   vec3 pos=u_point+u_right*((uv.x*2.-1.)*halfW+sin(u_time*2.1+uv.y*6.0)*uv.y*uv.y*u_width*.12)+vec3(0.,uv.y*u_height,0.);
   gl_Position=u_proj*u_view*vec4(pos,1.);
 }`;
 const BEACON_FRAGMENT=`#version 300 es
 precision highp float;
 in vec2 v_uv;
 uniform float u_opacity;
 out vec4 color;
 void main(){
   float q=abs(2.*v_uv.x-1.);
   float falloff=pow(max(0.,1.-q*q),2.5)*pow(max(0.,1.-v_uv.y),.68);
   float alpha=u_opacity*falloff;
   if(alpha<.012)discard;
   color=vec4(.99,.80,.48,alpha);
 }`;
 const HALO_VERTEX=`#version 300 es
 precision highp float;
 uniform mat4 u_proj,u_view;
 uniform vec3 u_point;
 uniform float u_size;
 void main(){gl_Position=u_proj*u_view*vec4(u_point,1.);gl_PointSize=u_size;}`;
 const HALO_FRAGMENT=`#version 300 es
 precision highp float;
 uniform float u_opacity;
 out vec4 color;
 void main(){
    float radius=length(gl_PointCoord-vec2(.5));
    float outer=1.0-smoothstep(.16,.50,radius);
    float clearCenter=smoothstep(.04,.22,radius);
    float alpha=u_opacity*outer*clearCenter;
    if(alpha<.012)discard;
    color=vec4(.99,.80,.47,alpha);
 }`;

 const TEXTURE_TRANSFORM=Object.freeze({yaw:0.00181612185,translation:[89.8768916,26.4378170,654.565736]});
 const MARKER_VERTEX=`#version 300 es
 precision highp float;
 precision highp int;
 layout(location=0) in vec3 a_position;
 uniform mat4 u_proj,u_view;
 uniform vec3 u_center;
 uniform float u_scale,u_pointSize;
 uniform int u_selectedIndex,u_focusMode;
 flat out int v_index;
 flat out int v_selected;
 void main(){
  v_index=gl_VertexID+1;
  v_selected=(gl_VertexID==u_selectedIndex)?1:0;
  vec3 p=(a_position-u_center)*u_scale;
  gl_Position=u_proj*u_view*vec4(p,1.0);
  gl_PointSize=u_pointSize*(v_selected==1?(u_focusMode==1?0.94:1.5):1.0);
 }`;
 const MARKER_FRAGMENT=`#version 300 es
 precision highp float;
 precision highp int;
 flat in int v_index;
 flat in int v_selected;
 uniform int u_focusMode;
 out vec4 color;
 void main(){
   float radius=length(gl_PointCoord-vec2(.5));
   float ring=(1.0-smoothstep(.41,.46,radius))*smoothstep(.25,.31,radius);
   float dotCircle=1.0-smoothstep(.105,.15,radius);
   float a=(u_focusMode==1&&v_selected==1)?ring:max(ring,dotCircle);
   if(a<.10)discard;
   vec3 gold=v_selected==1?vec3(1.,.87,.60):vec3(.86,.69,.37);
   color=vec4(gold,a*(u_focusMode==1?(v_selected==1?.55:.27):(v_selected==1?1.0:.88)));
 }`;
 const PICK_FRAGMENT=`#version 300 es
 precision highp float;
 precision highp int;
 flat in int v_index;
 flat in int v_selected;
 uniform int u_focusMode;
 out vec4 color;
 void main(){
  if(length(gl_PointCoord-vec2(.5))>.48)discard;
  color=vec4(float(v_index & 255)/255.0,float((v_index >> 8) & 255)/255.0,0.0,1.0);
 }`;
 function programFromSources(gl,vertex,fragment){
  const p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
 }
 const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
 const v3=(x,y,z)=>[x,y,z];
 const vecCross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const vecNorm=a=>{const l=Math.hypot(...a)||1;return a.map(x=>x/l)};
 function lookAt(eye,target,up){
   const z=vecNorm(eye.map((v,i)=>v-target[i]));
   const x=vecNorm(vecCross(up,z));const y=vecCross(z,x);
   return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,
     -x.reduce((a,v,i)=>a+v*eye[i],0),-y.reduce((a,v,i)=>a+v*eye[i],0),-z.reduce((a,v,i)=>a+v*eye[i],0),1]);
 }
 function projection(fovy,aspect,near,far){
  const f=1/Math.tan(fovy/2);const z=1/(near-far);
  return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*z,-1,0,0,2*far*near*z,0]);
 }
 function shader(gl,kind,source){
  const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;
 }
 function newProgram(gl){
  const p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,SHADER_V));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,SHADER_F));gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
 }
 function parseGlb(raw){
   const dv=new DataView(raw);if(dv.getUint32(0,true)!==0x46546c67||dv.getUint32(4,true)!==2||dv.getUint32(8,true)!==raw.byteLength)throw Error('GLB 헤더 오류');
   let offset=12,json=null,binStart=-1;
   while(offset<raw.byteLength){const len=dv.getUint32(offset,true),type=dv.getUint32(offset+4,true);offset+=8;
      if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(new Uint8Array(raw,offset,len)));
      if(type===0x004e4942)binStart=offset;
      offset+=len;
   }
   if(!json||binStart<0)throw Error('GLB 구성 데이터 오류');
   const prim=json.meshes[0].primitives[0];const va=json.accessors[prim.attributes.POSITION],ia=json.accessors[prim.indices];
   const vb=json.bufferViews[va.bufferView],ib=json.bufferViews[ia.bufferView];
   if(va.componentType!==5126||va.type!=='VEC3'||ia.componentType!==5125||ia.type!=='SCALAR'||ia.count%3)throw Error('GLB 지오메트리 형식 오류');
   const positions=new Float32Array(raw,binStart+(vb.byteOffset||0)+(va.byteOffset||0),va.count*3);
   const indices=new Uint32Array(raw,binStart+(ib.byteOffset||0)+(ia.byteOffset||0),ia.count);
   return {positions,indices,boxMin:va.min,boxMax:va.max,triangles:ia.count/3};
 }
 function parseTexturedGlb(buffer){
   const dv=new DataView(buffer);if(dv.getUint32(0,true)!==0x46546c67||dv.getUint32(4,true)!==2||dv.getUint32(8,true)!==buffer.byteLength)throw Error('실사 GLB 헤더 오류');
   let offset=12,json=null,binStart=-1;
   while(offset<buffer.byteLength){const size=dv.getUint32(offset,true),type=dv.getUint32(offset+4,true);offset+=8;
     if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,offset,size)));
     if(type===0x004e4942)binStart=offset;
     offset+=size;
   }
   if(!json||binStart<0)throw Error('실사 GLB 파일 구성 오류');
   const attrs=json.meshes[0].primitives[0].attributes;
   function attribute(key,components){
     const a=json.accessors[attrs[key]],v=json.bufferViews[a.bufferView];
     if(a.componentType!==5126||a.count<=0)throw Error('실사 '+key+' 형식 오류');
     return new Float32Array(buffer,binStart+(v.byteOffset||0)+(a.byteOffset||0),a.count*components);
   }
   const positions=attribute('POSITION',3),uv=attribute('TEXCOORD_0',2),n=positions.length/3;
   if(uv.length!==n*2||n%3)throw Error('실사 UV와 Vertex 수 불일치');
   if(!Number.isInteger(n)||n%3)throw Error('실사 GLB 삼각형 구조 오류');
   return {positions,uv,vertices:n,triangles:n/3};
 }
 function initialize(){
  const canvas=document.getElementById('stoneViewer');if(!canvas)return;
  const root=document.getElementById('dolmen3dRoot'),overview=document.getElementById('dolmenOverviewHost'),detail=document.getElementById('dolmenDetailHost');
  const loading=document.getElementById('dolmenLoading'),loadingTitle=document.getElementById('dolmenLoadingTitle'),percent=document.getElementById('dolmenLoadingPercent'),bar=document.getElementById('dolmenLoadingBar'),status=document.getElementById('dolmenModelStatus');
  const modeBtns=[...document.querySelectorAll('[data-viewer-mode]')],slider=document.getElementById('dolmenLightAngle'),lightControl=document.getElementById('dolmenLightControl');
  const params=new URLSearchParams(window.location.search),forced=params.get('v16aModel');
  const isMobile=window.matchMedia('(pointer:coarse)').matches||window.innerWidth<=760;
  const textureNotice=document.getElementById('dolmenTextureNotice');
  const model=(forced==='1m'?'1m':'700k'); // v16-B: 1M reference; 700K regular viewer. Never use 400K.
  const modelLabels={'1m':'1M · 2,014,719 Triangles','700k':'700K · 1,207,909 Triangles','400k':'400K · 399,219 Triangles'};
  document.documentElement.dataset.dolmenModel=model;
  status.textContent=`${modelLabels[model]} · 실제 스캔`;
  const gl=canvas.getContext('webgl2',{alpha:true,depth:true,antialias:true,desynchronized:false,powerPreference:'high-performance'});
  if(!gl){loadingTitle.textContent='WebGL2를 지원하는 브라우저가 필요합니다.';percent.textContent='';bar.hidden=true;loading.classList.add('is-error');return;}
  let program,vao,vertexBuffer,indexBuffer,uniforms,vertexCount=0,loaded=false,requested=false,needsFrame=false;
  let textureProgram,textureVao,textureVertexBuffer,textureUvBuffer,textureUniforms,textureImage,textureVertexCount=0,textureReady=false,textureStatus='idle';
  let markProgram,pickProgram,markerVao,markerBuffer,markerPrograms;
  let beamProgram,haloProgram,beamUniforms,haloUniforms,beaconVao;
  let markerData=[],markersLoaded=false,markersOn=false,selectedIndex=-1;
  const illuminatedIndices=new Set(),lightActivationTimes=new Map();
  let lightMode='pulse',lightBrightness=.75;
  const brightnessSlider=document.getElementById('cupmarkLightBrightness');
  const brightnessValue=document.getElementById('cupmarkLightValue');
  const lightPulseButton=document.getElementById('cupmarkLightPulse'),lightSteadyButton=document.getElementById('cupmarkLightSteady');
  const illuminatedCount=document.getElementById('cupmarkIlluminatedCount');
  let focusPresets=[],viewMode='overview',focusDistance=.2,cameraTransition=null;
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const focusToolbar=document.getElementById('cupmarkFocusToolbar');
  const focusCounter=document.getElementById('cupmarkFocusCounter');
  const focusPrev=document.getElementById('cupmarkPrevious'),focusNext=document.getElementById('cupmarkNext');
  const panel=document.getElementById('cupmarkPanel'),panelToggle=document.getElementById('cupmarkPanelToggle');
  const panelSelection=document.getElementById('cupmarkCompactSelection');
  const listWrap=document.getElementById('cupmarkPickerWrap'),listToggle=document.getElementById('cupmarkListToggle');
  let pickFramebuffer=null,pickTexture=null,pickDepth=null,pickW=0,pickH=0;
  const markerList=document.getElementById('cupmarkList'), markerCount=document.getElementById('cupmarkCount');
  const markerOff=document.getElementById('cupmarksOff'),markerOn=document.getElementById('cupmarksOn');
  let center=v3(0,0,0),scale=1,modelRadius=.7,modelHalfExtents=[.5,.12,.29],maxNormalizedY=.15,mode='realistic',lightAngle=35*Math.PI/180;
  let yaw=.23,pitch=.68,distance=2.5,pan=v3(0,0,0),defaultDistance=2.5;
  const POINTERS=new Map();let lastPinch=null,active=false;let tapStart=null,tapAborted=false;
  function rebuild(){
    program=newProgram(gl);gl.useProgram(program);
    textureProgram=programFromSources(gl,TEXTURED_VERTEX,TEXTURED_FRAGMENT);
    textureUniforms={proj:gl.getUniformLocation(textureProgram,'u_proj'),view:gl.getUniformLocation(textureProgram,'u_view'),center:gl.getUniformLocation(textureProgram,'u_center'),scale:gl.getUniformLocation(textureProgram,'u_scale'),eye:gl.getUniformLocation(textureProgram,'u_eye'),yaw:gl.getUniformLocation(textureProgram,'u_texYaw'),translation:gl.getUniformLocation(textureProgram,'u_texTranslation'),sampler:gl.getUniformLocation(textureProgram,'u_tex')};
    textureVao=gl.createVertexArray();textureVertexBuffer=gl.createBuffer();textureUvBuffer=gl.createBuffer();
    gl.bindVertexArray(textureVao);gl.bindBuffer(gl.ARRAY_BUFFER,textureVertexBuffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,textureUvBuffer);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,8,0);
    gl.bindVertexArray(null);
    uniforms={proj:gl.getUniformLocation(program,'u_proj'),view:gl.getUniformLocation(program,'u_view'),center:gl.getUniformLocation(program,'u_center'),scale:gl.getUniformLocation(program,'u_scale'),mode:gl.getUniformLocation(program,'u_mode'),light:gl.getUniformLocation(program,'u_lightAngle'),eye:gl.getUniformLocation(program,'u_eye')};
    vao=gl.createVertexArray();vertexBuffer=gl.createBuffer();indexBuffer=gl.createBuffer();
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
    markProgram=programFromSources(gl,MARKER_VERTEX,MARKER_FRAGMENT);
    pickProgram=programFromSources(gl,MARKER_VERTEX,PICK_FRAGMENT);
    markerPrograms=[markProgram,pickProgram].map(p=>({program:p,proj:gl.getUniformLocation(p,'u_proj'),view:gl.getUniformLocation(p,'u_view'),center:gl.getUniformLocation(p,'u_center'),scale:gl.getUniformLocation(p,'u_scale'),pointSize:gl.getUniformLocation(p,'u_pointSize'),selectedIndex:gl.getUniformLocation(p,'u_selectedIndex'),focusMode:gl.getUniformLocation(p,'u_focusMode')}));
    beamProgram=programFromSources(gl,BEACON_VERTEX,BEACON_FRAGMENT);
    haloProgram=programFromSources(gl,HALO_VERTEX,HALO_FRAGMENT);
    const locate=(p,n)=>gl.getUniformLocation(p,n);
    beamUniforms={proj:locate(beamProgram,'u_proj'),view:locate(beamProgram,'u_view'),point:locate(beamProgram,'u_point'),right:locate(beamProgram,'u_right'),height:locate(beamProgram,'u_height'),width:locate(beamProgram,'u_width'),time:locate(beamProgram,'u_time'),opacity:locate(beamProgram,'u_opacity')};
    haloUniforms={proj:locate(haloProgram,'u_proj'),view:locate(haloProgram,'u_view'),point:locate(haloProgram,'u_point'),size:locate(haloProgram,'u_size'),opacity:locate(haloProgram,'u_opacity')};
    beaconVao=gl.createVertexArray();
    markerVao=gl.createVertexArray();markerBuffer=gl.createBuffer();
    gl.bindVertexArray(markerVao);gl.bindBuffer(gl.ARRAY_BUFFER,markerBuffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
    gl.bindVertexArray(null);
  }
  try{rebuild();}catch(err){loadingTitle.textContent=err.message;loading.classList.add('is-error');return;}
  function fitDistance(){
    // Perspective-fit the actual oriented bounding box, rather than a loose sphere:
    // the very broad, flat capstone should fill most of the viewport.
    const rect=canvas.getBoundingClientRect(),aspect=Math.max(.3,rect.width/Math.max(1,rect.height));
    const orbit=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
    const right=[Math.cos(yaw),0,-Math.sin(yaw)];
    const up=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),-Math.cos(yaw)*Math.sin(pitch)];
    const extent=(basis)=>basis.reduce((sum,v,i)=>sum+Math.abs(v)*modelHalfExtents[i],0);
    const depth=extent(orbit),horizontal=extent(right),vertical=extent(up);
    return Math.max(modelRadius*1.25,(depth+Math.max(vertical/Math.tan(.44),horizontal/(Math.tan(.44)*aspect)))*1.13);
  }
  // All positions are in the exact shader model coordinates: (source XYZ - center)*scale.
  // The height safety bound keeps the camera above the *entire* capstone during close-up.
  // It is conservative when the camera is tilted, but never changes the artifact geometry.
  const normPosition=p=>[p.x,p.y,p.z].map((v,i)=>(v-center[i])*scale);
  const wrapNear=(newYaw,oldYaw)=>oldYaw+Math.atan2(Math.sin(newYaw-oldYaw),Math.cos(newYaw-oldYaw));
  const smooth=t=>t*t*(3-2*t);
  function safeFocusDistance(target,pitch,desired){
    const safeVerticalClearance=Math.max(0,maxNormalizedY-target[1]+.012);
    return Math.max(desired,.125,safeVerticalClearance/Math.max(.18,Math.sin(pitch)));
  }
  function updateFocusControls(){
    const focused=viewMode==='cupmark-focus'&&selectedIndex>=0;
    focusToolbar.hidden=!focused;
    focusCounter.textContent=focused?`${markerData[selectedIndex].id} · ${selectedIndex+1} / ${markerData.length}`:'';
    focusPrev.disabled=!focused||selectedIndex===0;
    focusNext.disabled=!focused||selectedIndex===markerData.length-1;
    document.getElementById('chapter-02').dataset.viewMode=viewMode;
    panelSelection.textContent=focused?`관찰 중 · ${markerData[selectedIndex].id}`:'';
    if(focused&&!panel.dataset.userExpanded&&isMobile){panel.classList.add('is-collapsed');panelToggle.setAttribute('aria-expanded','false');panelToggle.textContent='측정 정보 펼치기';}
    if(!focused){panel.classList.remove('is-collapsed');panelToggle.setAttribute('aria-expanded','true');panelToggle.textContent='측정 정보 접기';delete panel.dataset.userExpanded;}
  }
  function cancelCameraMove(){cameraTransition=null;}
  function transitionCamera(target,{animate=true}={}){
    cancelCameraMove();
    const goal={yaw:wrapNear(target.yaw,yaw),pitch:target.pitch,distance:target.distance,pan:target.pan.slice()};
    if(!animate||reducedMotion.matches){({yaw,pitch,distance,pan}=goal);requestFrame();return;}
    cameraTransition={from:{yaw,pitch,distance,pan:pan.slice()},to:goal,start:performance.now(),duration:750};
    requestFrame();
  }
  function tickCamera(now){
    if(!cameraTransition)return;
    const a=cameraTransition,t=clamp((now-a.start)/a.duration,0,1),u=smooth(t);
    yaw=a.from.yaw+(a.to.yaw-a.from.yaw)*u;
    pitch=a.from.pitch+(a.to.pitch-a.from.pitch)*u;
    distance=a.from.distance+(a.to.distance-a.from.distance)*u;
    pan=a.from.pan.map((v,i)=>v+(a.to.pan[i]-v)*u);
    if(t>=1)cameraTransition=null;
    else requestFrame();
  }
  function updateLightUI(){
    illuminatedCount.textContent=`켜진 성혈 ${illuminatedIndices.size} / ${markerData.length}`;
    brightnessValue.textContent=`${Math.round(lightBrightness*100)}%`;
    brightnessSlider.value=String(Math.round(lightBrightness*100));
    lightPulseButton.setAttribute('aria-pressed',String(lightMode==='pulse'));
    lightSteadyButton.setAttribute('aria-pressed',String(lightMode==='steady'));
    markerList.querySelectorAll('button').forEach((b,i)=>{
      const lit=illuminatedIndices.has(i);
      b.dataset.lightOn=String(lit);
      b.setAttribute('aria-label',`성혈 ${markerData[i]?.id||i+1} 선택 · 불빛 ${lit?'끄기':'켜기'}`);
    });
  }
  function activateLight(index){
    if(!illuminatedIndices.has(index)){
      illuminatedIndices.add(index);lightActivationTimes.set(index,performance.now());
    }
  }
  function toggleLight(index){
    if(illuminatedIndices.has(index)){
      illuminatedIndices.delete(index);lightActivationTimes.delete(index);
    }else activateLight(index);
  }
  function clearSelected(){
    selectedIndex=-1;
    markerList.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed','false'));
    document.getElementById('cupmarkSelectedId').textContent='성혈을 선택해 주세요';
    document.getElementById('cupmarkDiameter').textContent='—';
    document.getElementById('cupmarkDepth').textContent='—';
  }
  function fitCamera(animate=false){
    const oldYaw=yaw,oldPitch=pitch;
    yaw=.23;pitch=.68;defaultDistance=fitDistance();yaw=oldYaw;pitch=oldPitch;
    viewMode='overview';focusDistance=.2;clearSelected();updateFocusControls();
    transitionCamera({yaw:.23,pitch:.68,pan:[0,0,0],distance:defaultDistance},{animate});
  }
  function zoom(factor){
    cancelCameraMove();
    const minimum=viewMode==='cupmark-focus'?safeFocusDistance(pan,pitch,focusDistance*.78):modelRadius*1.05;
    distance=clamp(distance*factor,minimum,defaultDistance*8);requestFrame();
  }
  function focusOnMarker(index,{animate=true}={}){
    if(index<0||index>=focusPresets.length||!loaded)return;
    const fp=focusPresets[index];
    viewMode='cupmark-focus';
    focusDistance=safeFocusDistance(fp.target,fp.pitch,fp.distance);
    updateFocusControls();
    transitionCamera({yaw:fp.yaw,pitch:fp.pitch,pan:fp.target,distance:focusDistance},{animate});
  }
  function buildFocusPresets(){
    if(!loaded||!markersLoaded)return;
    // v16-B renderPositions were generated as nearest surface point + 0.8*normal.
    // Their difference supplies a stable, already-validated face normal for both meshes.
    focusPresets=markerData.map(m=>{
      const surf=m.surfacePoints?.[model],render=m.renderPositions?.[model];
      if(!surf||!render)return null;
      const diff=[render.x-surf.x,render.y-surf.y,render.z-surf.z];
      const len=Math.hypot(...diff);if(len<.01||!Number.isFinite(len))return null;
      const normal=diff.map(v=>v/len);
      // World up is +Y; if normal happens to lean sideways, retain its azimuth,
      // but keep positive elevation and no camera roll.
      const pitch=clamp(Math.asin(clamp(normal[1],-1,1)),.45,1.42);
      const yaw=Math.atan2(normal[0],normal[2]);
      const target=normPosition(render);
      // 5–7 observed diameters + surrounding fracture/texture, bounded for usability.
      const estimatedDiameter=Number.isFinite(m.diameter)?m.diameter*scale:null;
      const visibleHeight=clamp(estimatedDiameter?estimatedDiameter*5.5:.16,.16,.26);
      const focusDistance=clamp(visibleHeight/(2*Math.tan(.44)),.17,.31);
      return {target,normal,yaw,pitch,distance:focusDistance,surfaceOffset:len};
    });
    window.__dolmenFocusStatus={count:focusPresets.filter(Boolean).length,total:markerData.length,sourceDataChanged:false};
  }
  function panBy(dx,dy){
    const ratio=distance*2*Math.tan(.44)/Math.max(1,canvas.clientHeight);
    const right=[Math.cos(yaw),0,-Math.sin(yaw)],up=[-Math.sin(yaw)*Math.sin(pitch),Math.cos(pitch),-Math.cos(yaw)*Math.sin(pitch)];
    for(let k=0;k<3;k++)pan[k]+=(-dx*right[k]+dy*up[k])*ratio;
    if(viewMode==='cupmark-focus')distance=safeFocusDistance(pan,pitch,distance);
    requestFrame();
  }
  function requestFrame(){if(!needsFrame){needsFrame=true;requestAnimationFrame(render);}}
  function cameraMatrices(w,h){
    const orbit=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
    const eye=orbit.map((v,i)=>v*distance+pan[i]);
    return {eye,proj:projection(.88,w/h,Math.max(.0015,Math.min(.008,distance*.012)),100),view:lookAt(eye,pan,[0,1,0])};
  }
  function drawSelectedBeacon(matrices){
    // v25: each illuminated cupmark is drawn at its existing measured surface position.
    if(!markersOn||!markersLoaded||!illuminatedIndices.size)return;
    const focused=viewMode==='cupmark-focus'&&!cameraTransition;
    const right=[Math.cos(yaw),0,-Math.sin(yaw)];
    const now=performance.now();
    const range=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
    gl.bindVertexArray(beaconVao);
    gl.useProgram(beamProgram);
    gl.uniformMatrix4fv(beamUniforms.proj,false,matrices.proj);
    gl.uniformMatrix4fv(beamUniforms.view,false,matrices.view);
    gl.uniform3fv(beamUniforms.right,right);
    for(const index of illuminatedIndices){
      const datum=markerData[index]?.renderPositions?.[model]||markerData[index]?.displayPosition;
      if(!datum)continue;
      const point=normPosition(datum),isClose=focused&&selectedIndex===index;
      const age=Math.max(0,(now-(lightActivationTimes.get(index)??now))*.001);
      const wave=lightMode==='pulse'&&!reducedMotion.matches?(.36+.64*(.5+.5*Math.cos(age*2.1))):1;
      const intensity=lightBrightness*wave;
      gl.uniform3fv(beamUniforms.point,point);
      gl.uniform1f(beamUniforms.height,isClose?.09:.15);
      gl.uniform1f(beamUniforms.width,isClose?.020:.028);
      gl.uniform1f(beamUniforms.time,lightMode==='pulse'&&!reducedMotion.matches?now*.001:0);
      gl.uniform1f(beamUniforms.opacity,(isClose?.56:.75)*intensity);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
    gl.useProgram(haloProgram);
    gl.uniformMatrix4fv(haloUniforms.proj,false,matrices.proj);
    gl.uniformMatrix4fv(haloUniforms.view,false,matrices.view);
    for(const index of illuminatedIndices){
      const datum=markerData[index]?.renderPositions?.[model]||markerData[index]?.displayPosition;
      if(!datum)continue;
      const isClose=focused&&selectedIndex===index;
      const age=Math.max(0,(now-(lightActivationTimes.get(index)??now))*.001);
      const wave=lightMode==='pulse'&&!reducedMotion.matches?(.36+.64*(.5+.5*Math.cos(age*2.1))):1;
      gl.uniform3fv(haloUniforms.point,normPosition(datum));
      gl.uniform1f(haloUniforms.size,Math.min(range[1],isClose?36:58));
      gl.uniform1f(haloUniforms.opacity,(isClose?.36:.50)*lightBrightness*wave);
      gl.drawArrays(gl.POINTS,0,1);
    }
    gl.bindVertexArray(null);gl.depthMask(true);gl.disable(gl.BLEND);
  }
  function drawMarkers(matrices,picking){
    if(!markersOn||!markersLoaded||!markerData.length)return;
    const u=markerPrograms[picking?1:0];
    gl.useProgram(u.program);
    gl.uniformMatrix4fv(u.proj,false,matrices.proj);gl.uniformMatrix4fv(u.view,false,matrices.view);
    gl.uniform3fv(u.center,center);gl.uniform1f(u.scale,scale);
    gl.uniform1i(u.selectedIndex,selectedIndex);
    gl.uniform1i(u.focusMode,viewMode==='cupmark-focus'&&!cameraTransition&&!picking?1:0);
    const sizes=gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    gl.uniform1f(u.pointSize,Math.min(sizes[1],(isMobile?12:13)*(canvas.width/Math.max(1,canvas.clientWidth))));
    gl.depthMask(false);
    if(!picking){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);}
    gl.bindVertexArray(markerVao);gl.drawArrays(gl.POINTS,0,markerData.length);gl.bindVertexArray(null);
    gl.disable(gl.BLEND);gl.depthMask(true);
  }
  function drawTextured(matrices){
    const u=textureUniforms;
    gl.useProgram(textureProgram);gl.uniformMatrix4fv(u.proj,false,matrices.proj);gl.uniformMatrix4fv(u.view,false,matrices.view);
    gl.uniform3fv(u.center,center);gl.uniform1f(u.scale,scale);gl.uniform3fv(u.eye,matrices.eye);
    gl.uniform3fv(u.translation,TEXTURE_TRANSFORM.translation);gl.uniform1f(u.yaw,TEXTURE_TRANSFORM.yaw);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,textureImage);gl.uniform1i(u.sampler,0);
    gl.bindVertexArray(textureVao);gl.drawArrays(gl.TRIANGLES,0,textureVertexCount);gl.bindVertexArray(null);
  }
  function drawScene(picking=false){
    if(!loaded||!active||!canvas.isConnected)return;
    const rect=canvas.getBoundingClientRect();if(rect.width<5||rect.height<5)return;
    const dpr=Math.min(window.devicePixelRatio||1,isMobile?1.2:1.5);
    const w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    if(picking)preparePickTarget(w,h);
    gl.bindFramebuffer(gl.FRAMEBUFFER,picking?pickFramebuffer:null);
    gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const matrices=cameraMatrices(w,h);
    const realistic=mode==='realistic'&&textureReady&&!picking;
    if(realistic){
      drawTextured(matrices);
      // v16-C interaction mesh supplies unmodified marker occlusion, depth-only.
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    gl.useProgram(program);gl.uniformMatrix4fv(uniforms.proj,false,matrices.proj);gl.uniformMatrix4fv(uniforms.view,false,matrices.view);
    gl.uniform3fv(uniforms.center,center);gl.uniform1f(uniforms.scale,scale);
    gl.uniform1i(uniforms.mode,mode==='raking'?1:mode==='gray'?2:0);gl.uniform1f(uniforms.light,lightAngle);
    gl.uniform3fv(uniforms.eye,matrices.eye);gl.bindVertexArray(vao);
    if(picking||realistic)gl.colorMask(false,false,false,false);
    gl.drawElements(gl.TRIANGLES,vertexCount,gl.UNSIGNED_INT,0);gl.bindVertexArray(null);
    if(picking||realistic)gl.colorMask(true,true,true,true);
    if(!picking)drawSelectedBeacon(matrices);
    drawMarkers(matrices,picking);
  }
  let beaconTick=null;
  function render(now){needsFrame=false;tickCamera(now);drawScene(false);
    // Only pulse mode requires animation frames; steady lights are static between camera/UI updates.
    if(active&&markersOn&&illuminatedIndices.size&&lightMode==='pulse'&&!reducedMotion.matches&&!beaconTick)
      beaconTick=setTimeout(()=>{beaconTick=null;if(active&&markersOn&&illuminatedIndices.size&&lightMode==='pulse')requestFrame();},95);
  }
  function preparePickTarget(w,h){
    if(pickFramebuffer&&w===pickW&&h===pickH)return;
    if(pickTexture)gl.deleteTexture(pickTexture);
    if(pickDepth)gl.deleteRenderbuffer(pickDepth);
    if(pickFramebuffer)gl.deleteFramebuffer(pickFramebuffer);
    pickW=w;pickH=h;pickFramebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,pickFramebuffer);
    pickTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,pickTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    pickDepth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,pickTexture,0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,pickDepth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Marker picking framebuffer unavailable');
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  function pickMarker(clientX,clientY){
    if(!markersOn||!markersLoaded||!loaded||!active)return;
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    try{
      drawScene(true);
      const x=clamp(Math.floor((clientX-rect.left)/rect.width*canvas.width),0,canvas.width-1);
      const y=clamp(Math.floor((rect.bottom-clientY)/rect.height*canvas.height),0,canvas.height-1);
      const pix=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pix);
      const index=(pix[0]+256*pix[1])-1;
      if(index>=0&&index<markerData.length)selectMarker(index);
    }catch(err){console.warn('성혈 선택 검사:',err);}
    finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);requestFrame();}
  }
  function fillMarkerBuffer(){
    if(!markersLoaded)return;
    const coords=new Float32Array(markerData.length*3);
    markerData.forEach((m,i)=>{
      const p=m.renderPositions[model]||m.displayPosition;
      coords.set([p.x,p.y,p.z],i*3);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER,markerBuffer);gl.bufferData(gl.ARRAY_BUFFER,coords,gl.STATIC_DRAW);
    requestFrame();
  }
  function setMarkerVisibility(value){
    markersOn=!!value;markerOff.setAttribute('aria-pressed',String(!markersOn));markerOn.setAttribute('aria-pressed',String(markersOn));
    requestFrame();
  }
  function selectMarker(index,{lighting='toggle'}={}){
    if(index<0||index>=markerData.length)return;
    if(lighting==='toggle')toggleLight(index);
    else if(lighting==='ensure')activateLight(index);
    selectedIndex=index;const item=markerData[index];
    updateLightUI();
    markerList.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
    const b=markerList.children[index];if(b)b.scrollIntoView({block:'nearest',inline:'nearest'});
    document.getElementById('cupmarkSelectedId').textContent=`성혈 ${item.id}`;
    document.getElementById('cupmarkDiameter').textContent=typeof item.diameter==='number'?`${item.diameter.toFixed(2)} mm`:'—';
    document.getElementById('cupmarkDepth').textContent=typeof item.depth==='number'?`${item.depth.toFixed(2)} mm`:'—';
    focusOnMarker(index);
    requestFrame();
  }
  function loadMarkers(){
    fetch('data/cupmarks-measured.json').then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(data=>{
      if(!Array.isArray(data)||!data.length||!data.every(m=>m.id&&m.sourcePosition&&m.renderPositions&&m.renderPositions['700k']))throw Error('실측 데이터 구조 오류');
      markerData=data;markersLoaded=true;
      markerCount.textContent=`${data.length}개`;
      const fragment=document.createDocumentFragment();
      data.forEach((m,i)=>{
        const b=document.createElement('button');b.type='button';b.textContent=m.id;b.setAttribute('aria-pressed','false');b.setAttribute('aria-label',`성혈 ${m.id} 선택`);
        b.addEventListener('click',()=>{setMarkerVisibility(true);selectMarker(i);});fragment.appendChild(b);
      });
      markerList.replaceChildren(fragment);
      updateLightUI();fillMarkerBuffer();buildFocusPresets();updateFocusControls();
      window.__cupmarkStatus={count:data.length,coordinateSystem:'XYZ identity',loaded:true};
    }).catch(err=>{
      markerCount.textContent='로드 실패';
      document.getElementById('markDesc').textContent=`성혈 좌표 로딩 실패: ${err.message}`;
      window.__cupmarkStatus={loaded:false,error:err.message};
    });
  }
  function updateModeButtons(){
    modeBtns.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.viewerMode===mode)));
    lightControl.hidden=mode!=='raking';requestFrame();
  }
  // Transfer v19 textured geometry as independently-valid ~6MB GLBs.
  // The original OBJ corner position/UV bytes, triangle order and JPG atlas are unchanged.
  const TEXTURE_MANIFEST='assets/models/dolmen-textured-manifest.json';
  let lastTextureFailure='';
  function showSurfaceFallback(message){
    textureStatus='error';textureReady=false;mode='surface';updateModeButtons();
    loading.classList.add('is-hidden');
    lastTextureFailure=message||'실사 텍스처를 불러오지 못했습니다.';
    textureNotice.textContent=lastTextureFailure+' 표면 보기로 전환했습니다. [실사]를 누르면 다시 시도합니다.';
    status.textContent=`${modelLabels[model]} · 표면 보기`;
    console.error('[Stone Traces] 실사 텍스처 로딩 실패:',lastTextureFailure);
    window.__dolmenTextureStatus={state:'failed',error:lastTextureFailure,fallback:'surface',manifest:TEXTURE_MANIFEST};
    requestFrame();
  }
  async function readTextureAsset(path,expectBinary=false){
    const fullUrl=new URL(path,document.baseURI).href;
    let lastError;
    for(let attempt=0;attempt<2;attempt++){
      try{
        const response=await fetch(fullUrl,{cache:attempt?'reload':'default'});
        if(!response.ok)throw Error(`HTTP ${response.status}`);
        return expectBinary?await response.arrayBuffer():await response.json();
      }catch(err){lastError=err;}
    }
    throw Error(`${path} (${lastError?.message||'네트워크 오류'}). HTTP 서버 주소와 파일 배치를 확인해 주세요.`);
  }
  async function loadTextureAtlas(path){
    const url=new URL(path,document.baseURI).href;
    const image=new Image();image.decoding='async';
    await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=()=>reject(Error(`텍스처 이미지 로딩 실패: ${path}`));
      image.src=url;
    });
    const width=image.naturalWidth,height=image.naturalHeight;
    if(!width||!height)throw Error('텍스처 이미지 크기 오류');
    const maxSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if(width>maxSize||height>maxSize)throw Error(`GPU 텍스처 한계 초과 (${width}×${height}, 최대 ${maxSize})`);

    // Do not misattribute a prior rendering error to the texture upload.
    const oldErrors=[];
    for(let i=0;i<8;i++){const e=gl.getError();if(e===gl.NO_ERROR)break;oldErrors.push(e);}
    if(oldErrors.length)console.warn('[Stone Traces] 업로드 이전 WebGL 오류:',oldErrors);
    // DOM TexImageSource uploads are invalid while a PIXEL_UNPACK_BUFFER is bound.
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);
    gl.activeTexture(gl.TEXTURE0);
    if(textureImage)gl.deleteTexture(textureImage);
    textureImage=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,textureImage);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    let uploadPath='image-rgba8';
    let uploadError=gl.NO_ERROR;
    try{
      // WebGL2 RGBA8/RGBA is widely compatible; avoid RGB/SRGB8 DOM conversion issues.
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,image);
      uploadError=gl.getError();
    }catch(err){
      console.warn('[Stone Traces] 이미지 직접 업로드 예외:',err);
      uploadError=gl.INVALID_OPERATION;
    }finally{
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    }
    if(uploadError!==gl.NO_ERROR){
      console.warn(`[Stone Traces] 직접 업로드 실패 (WebGL ${uploadError}); ImageData 방식으로 재시도합니다.`);
      // Software decoded original image -> identical pixels, manually flipped for OBJ v-up.
      // No texture resizing/cropping, UV edits or source file changes.
      gl.bindTexture(gl.TEXTURE_2D,null);gl.deleteTexture(textureImage);
      textureImage=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,textureImage);
      const bitmap=document.createElement('canvas');bitmap.width=width;bitmap.height=height;
      const ctx=bitmap.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw Error('텍스처 ImageData 변환을 위한 Canvas 2D를 사용할 수 없습니다.');
      ctx.drawImage(image,0,0);
      const src=ctx.getImageData(0,0,width,height).data;
      const rowBytes=width*4;
      const flipped=new Uint8Array(src.length);
      for(let y=0;y<height;y++){
        const row=y*rowBytes;
        flipped.set(src.subarray(row,row+rowBytes),(height-y-1)*rowBytes);
      }
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,flipped);
      const fallbackError=gl.getError();
      if(fallbackError!==gl.NO_ERROR)throw Error(`실사 텍스처 ImageData GPU 업로드 실패 (WebGL ${fallbackError}; 직접 업로드 ${uploadError})`);
      uploadPath='imagedata-rgba8';
    }
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    let setupError=gl.getError();
    if(setupError!==gl.NO_ERROR)throw Error(`실사 텍스처 필터 설정 실패 (WebGL ${setupError})`);
    // Prefer mipmaps when the driver supports them; a failure must not disable real mode.
    gl.generateMipmap(gl.TEXTURE_2D);
    const mipError=gl.getError();
    if(mipError===gl.NO_ERROR){
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    }else{
      console.warn(`[Stone Traces] Mipmap 생성 오류 (WebGL ${mipError}); LINEAR 필터로 계속합니다.`);
    }
    const aniso=gl.getExtension('EXT_texture_filter_anisotropic');
    if(aniso){
      const limit=gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      if(Number.isFinite(limit)&&limit>=1)gl.texParameterf(gl.TEXTURE_2D,aniso.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(4,limit));
    }
    setupError=gl.getError();
    if(setupError!==gl.NO_ERROR){
      // Anisotropic filtering is optional, not a reason to fall back to gray mode.
      console.warn('[Stone Traces] 선택형 텍스처 필터 오류:',setupError);
    }
    window.__dolmenTextureUpload={uploadPath,mipmaps:mipError===gl.NO_ERROR,width,height,preUploadErrors:oldErrors};
    return image;
  }
  async function startTextureLoad(){
    if(textureStatus!=='idle')return;
    textureStatus='loading';lastTextureFailure='';textureNotice.textContent='';
    loading.classList.remove('is-hidden');
    loadingTitle.textContent='실사 텍스처 불러오는 중';bar.value=0;percent.textContent='0%';
    try{
      const manifest=await readTextureAsset(TEXTURE_MANIFEST);
      if(manifest.format!=='stone-traces-texture-glb-parts-v1'||!Array.isArray(manifest.chunks)||!manifest.chunks.length||
         !Number.isInteger(manifest.vertexCount)||manifest.vertexCount<=0||manifest.vertexCount%3)throw Error('텍스처 모델 목록 형식 오류');
      const totalVertices=manifest.chunks.reduce((a,c)=>a+c.vertices,0);
      if(totalVertices!==manifest.vertexCount)throw Error('텍스처 모델 총 정점 수 오류');
      const bytesPosition=manifest.vertexCount*3*4,bytesUv=manifest.vertexCount*2*4;
      gl.bindBuffer(gl.ARRAY_BUFFER,textureVertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,bytesPosition,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,textureUvBuffer);gl.bufferData(gl.ARRAY_BUFFER,bytesUv,gl.STATIC_DRAW);
      if(gl.getError()!==gl.NO_ERROR)throw Error('실사 메쉬 GPU 메모리 할당 실패');
      let vertexOffset=0;
      for(let i=0;i<manifest.chunks.length;i++){
        const part=manifest.chunks[i];
        if(!/^[a-zA-Z0-9._-]+\.glb$/.test(part.file)||!Number.isInteger(part.vertices)||part.vertices<=0||part.vertices%3)throw Error('텍스처 파트 정보 오류');
        const path='assets/models/'+part.file;
        loadingTitle.textContent=`실사 모델 불러오는 중 (${i+1}/${manifest.chunks.length})`;
        const buffer=await readTextureAsset(path,true);
        if(part.bytes&&buffer.byteLength!==part.bytes)throw Error(`${path}: 파일 크기 불일치 (${buffer.byteLength}/${part.bytes})`);
        const data=parseTexturedGlb(buffer);
        if(data.vertices!==part.vertices)throw Error(`${path}: 정점 수 불일치`);
        gl.bindBuffer(gl.ARRAY_BUFFER,textureVertexBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER,vertexOffset*3*4,data.positions);
        gl.bindBuffer(gl.ARRAY_BUFFER,textureUvBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER,vertexOffset*2*4,data.uv);
        const err=gl.getError();
        if(err!==gl.NO_ERROR)throw Error(`${path}: GPU 버퍼 오류 (WebGL ${err})`);
        vertexOffset+=data.vertices;
        const pct=Math.round(vertexOffset/manifest.vertexCount*90);
        bar.value=pct;percent.textContent=`${pct}%`;
      }
      if(vertexOffset!==manifest.vertexCount)throw Error('텍스처 파트 합계 오류');
      loadingTitle.textContent='실사 텍스처 이미지 불러오는 중';
      const image=await loadTextureAtlas('assets/models/'+manifest.image);
      textureVertexCount=vertexOffset;textureReady=true;textureStatus='ready';
      loading.classList.add('is-hidden');textureNotice.textContent='';
      status.textContent=`실사 스캔 텍스처 · ${manifest.triangleCount.toLocaleString('ko-KR')} Triangles`;
      window.__dolmenTextureStatus={state:'ready',triangles:manifest.triangleCount,parts:manifest.chunks.length,textureWidth:image.naturalWidth,textureHeight:image.naturalHeight,globalTransform:TEXTURE_TRANSFORM};
      requestFrame();
    }catch(err){showSurfaceFallback(err.message||String(err));}
  }
  function startLoad(){
    if(requested)return;requested=true;loadingTitle.textContent='3D 스캔 불러오는 중';bar.value=0;percent.textContent='0%';
    const xhr=new XMLHttpRequest();xhr.open('GET',`assets/models/dolmen-${model}.glb`,true);xhr.responseType='arraybuffer';
    const t0=performance.now();
    xhr.onprogress=e=>{if(e.lengthComputable){const progress=Math.floor((e.loaded/e.total)*100);bar.value=progress;percent.textContent=`${progress}%`;}};
    xhr.onerror=()=>error('모델 다운로드에 실패했습니다. 로컬 웹 서버에서 실행해 주세요.');
    xhr.onload=()=>{
     if((xhr.status!==0&&(xhr.status<200||xhr.status>=300))||!xhr.response){error(`모델을 불러오지 못했습니다 (HTTP ${xhr.status}).`);return;}
     try{
      const data=parseGlb(xhr.response);vertexCount=data.indices.length;
      gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,data.positions,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data.indices,gl.STATIC_DRAW);
      const ext=data.boxMax.map((m,i)=>m-data.boxMin[i]);const maxExtent=Math.max(...ext);
      center=data.boxMin.map((m,i)=>(m+data.boxMax[i])/2);scale=1/maxExtent;modelRadius=Math.hypot(...ext)/2/maxExtent;modelHalfExtents=ext.map(v=>v/(2*maxExtent));maxNormalizedY=(data.boxMax[1]-center[1])*scale;
      const pendingSelection=selectedIndex;
      loaded=true;fitCamera();buildFocusPresets();startTextureLoad();
      if(pendingSelection>=0&&markersLoaded&&markersOn)selectMarker(pendingSelection,{lighting:'preserve'});
      window.__dolmenViewerStatus={model,triangles:data.triangles,geometryLoaded:true,loadMilliseconds:Math.round(performance.now()-t0),coordinatesUnchanged:true};
     }catch(err){error('3D 모델 형식을 읽지 못했습니다: '+err.message);}
    };
    xhr.send();
  }
  function error(message){loadingTitle.textContent=message;percent.textContent='';bar.hidden=true;loading.classList.add('is-error');window.__dolmenViewerStatus={model,error:message};}
  function activateIfNeeded(){
    active=document.body.dataset.page==='1';if(!active)return;
    const stage=document.getElementById('chapter-02').dataset.observationMode||'overview';
    const host=stage==='observation'?detail:overview;
    if(root.parentElement!==host){
      host.appendChild(root);
      if(loaded){const previousDefault=defaultDistance;defaultDistance=fitDistance();if(viewMode==='overview')distance*=defaultDistance/Math.max(.0001,previousDefault);}
    }
    if(stage==='overview'&&viewMode==='cupmark-focus')fitCamera(false);
    startLoad();requestFrame();
  }
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{cancelCameraMove();e.preventDefault();canvas.setPointerCapture(e.pointerId);POINTERS.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType,button:e.button});canvas.classList.add('dragging');if(POINTERS.size===1){tapStart={x:e.clientX,y:e.clientY,id:e.pointerId,button:e.button};tapAborted=false;}else tapAborted=true;lastPinch=null;});
  canvas.addEventListener('pointermove',e=>{
   if(!POINTERS.has(e.pointerId))return;e.preventDefault();
   const prev=POINTERS.get(e.pointerId),dx=e.clientX-prev.x,dy=e.clientY-prev.y;POINTERS.set(e.pointerId,{...prev,x:e.clientX,y:e.clientY});
   if(tapStart&&Math.hypot(e.clientX-tapStart.x,e.clientY-tapStart.y)>7)tapAborted=true;
   if(POINTERS.size===1){if(prev.button===2||((e.buttons&2)!==0)){panBy(dx,dy);}else{yaw-=dx*.006;pitch=clamp(pitch+dy*.006,viewMode==='cupmark-focus'?.32:-1.48,1.48);if(viewMode==='cupmark-focus')distance=safeFocusDistance(pan,pitch,distance);requestFrame();}}
   else if(POINTERS.size===2){const pts=[...POINTERS.values()];const sep=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
     const mid=[(pts[0].x+pts[1].x)/2,(pts[0].y+pts[1].y)/2];
     if(lastPinch){if(sep>10)zoom(clamp(lastPinch.sep/sep,.7,1.3));panBy(mid[0]-lastPinch.mid[0],mid[1]-lastPinch.mid[1]);}
     lastPinch={sep,mid};}
  });
  function pointerEnd(e){const isTap=e.type==='pointerup'&&POINTERS.size===1&&tapStart&&tapStart.id===e.pointerId&&!tapAborted&&tapStart.button===0;POINTERS.delete(e.pointerId);lastPinch=null;if(!POINTERS.size)canvas.classList.remove('dragging');if(isTap)pickMarker(e.clientX,e.clientY);if(!POINTERS.size)tapStart=null;}
  ['pointerup','pointercancel','lostpointercapture'].forEach(evt=>canvas.addEventListener(evt,pointerEnd));
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(e.deltaY*.0012));},{passive:false});
  document.querySelectorAll('[data-viewer-action]').forEach(b=>b.addEventListener('click',()=>{
    switch(b.dataset.viewerAction){case'zoom-in':zoom(.8);break;case'zoom-out':zoom(1.25);break;case'reset':fitCamera(true);break;}
  }));
  modeBtns.forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.viewerMode==='realistic'&&textureStatus==='error'){
      textureStatus='idle';mode='realistic';updateModeButtons();startTextureLoad();return;
    }
    mode=b.dataset.viewerMode;updateModeButtons();
    if(mode==='realistic'&&!textureReady){loading.classList.remove('is-hidden');loadingTitle.textContent='실사 Texture 불러오는 중';}
    else loading.classList.add('is-hidden');
  }));
  slider.addEventListener('input',()=>{lightAngle=Number(slider.value)*Math.PI/180;requestFrame();});
  markerOff.addEventListener('click',()=>setMarkerVisibility(false));
  markerOn.addEventListener('click',()=>setMarkerVisibility(true));
  focusPrev.addEventListener('click',()=>{if(selectedIndex>0){setMarkerVisibility(true);selectMarker(selectedIndex-1,{lighting:'ensure'});}});
  focusNext.addEventListener('click',()=>{if(selectedIndex>=0&&selectedIndex<markerData.length-1){setMarkerVisibility(true);selectMarker(selectedIndex+1,{lighting:'ensure'});}});
  brightnessSlider.addEventListener('input',()=>{lightBrightness=clamp(Number(brightnessSlider.value)/100,.25,1);updateLightUI();requestFrame();});
  lightPulseButton.addEventListener('click',()=>{lightMode='pulse';updateLightUI();requestFrame();});
  lightSteadyButton.addEventListener('click',()=>{lightMode='steady';updateLightUI();requestFrame();});
  document.getElementById('cupmarkWholeStone').addEventListener('click',()=>fitCamera(true));
  panelToggle.addEventListener('click',()=>{const collapse=!panel.classList.contains('is-collapsed');panel.classList.toggle('is-collapsed',collapse);panel.dataset.userExpanded=String(!collapse);panelToggle.setAttribute('aria-expanded',String(!collapse));panelToggle.textContent=collapse?'측정 정보 펼치기':'측정 정보 접기';});
  listToggle.addEventListener('click',()=>{const fold=!listWrap.classList.contains('is-folded');listWrap.classList.toggle('is-folded',fold);listToggle.setAttribute('aria-expanded',String(!fold));listToggle.textContent=fold?'성혈 목록 펼치기':'성혈 목록 접기';});
  loadMarkers();
  window.addEventListener('exhibition:pagechange',activateIfNeeded);
  window.addEventListener('exhibition:observationchange',activateIfNeeded);
  window.addEventListener('resize',()=>{if(loaded){defaultDistance=fitDistance();requestFrame();}});
  new ResizeObserver(()=>requestFrame()).observe(root);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();active=false;loading.classList.remove('is-hidden');error('그래픽 장치 연결이 끊겼습니다. 페이지를 새로고침해 주세요.');});
  activateIfNeeded();
  window.__dolmenViewerDebug={getTextureStatus:()=>({mode,textureStatus,textureReady,globalTransform:TEXTURE_TRANSFORM}),fitCamera,zoom,focusOnMarker,getFocusPresets:()=>focusPresets.map(x=>x?{...x,target:x.target.slice(),normal:x.normal.slice()}:null),getViewMode:()=>viewMode,getMode:()=>mode,getCamera:()=>({yaw,pitch,distance,pan:pan.slice(),isAnimating:!!cameraTransition}),requestFrame,setMarkerVisibility,selectMarker,getCupmarkState:()=>({count:markerData.length,markersLoaded,markersOn,selectedIndex,illuminatedIndices:[...illuminatedIndices].sort((a,b)=>a-b),illuminatedCupmarkIds:[...illuminatedIndices].sort((a,b)=>a-b).map(i=>markerData[i]?.id),lightMode,lightBrightness}),getLightIntensityAt:(index,atMs=performance.now())=>{if(!illuminatedIndices.has(index))return 0;const age=Math.max(0,(atMs-(lightActivationTimes.get(index)??atMs))*.001);return lightBrightness*(lightMode==='pulse'&&!reducedMotion.matches?(.36+.64*(.5+.5*Math.cos(age*2.1))):1);},setLightBrightness:(x)=>{lightBrightness=clamp(x,.25,1);updateLightUI();requestFrame();},setLightMode:(x)=>{if(x==='pulse'||x==='steady'){lightMode=x;updateLightUI();requestFrame();}}};
 }
 window.initDolmenViewer=initialize;
})();
