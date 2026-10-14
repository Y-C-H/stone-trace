"""Regression test for Chapter 03 overview / cupmark-light isolation.

Run: python scripts/test-v34-4-regression.py
Dependencies: playwright (Python) and Chromium. WebGL2 is mocked intentionally to
assert draw-path calls without downloading the 700K asset or requiring a GPU.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64
import json
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]


def synthetic_glb():
    obj = {
        'asset': {'version': '2.0'},
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1}]}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3', 'min': [-1, -.4, -1], 'max': [1, .4, 1]},
            {'bufferView': 1, 'componentType': 5125, 'count': 3, 'type': 'SCALAR'},
        ],
        'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 36}, {'buffer': 0, 'byteOffset': 36, 'byteLength': 12}],
        'buffers': [{'byteLength': 48}],
    }
    j = json.dumps(obj, separators=(',', ':')).encode()
    j += b' ' * ((-len(j)) % 4)
    b = struct.pack('<9f3I', -1, -.4, -1, 1, -.4, -1, 0, .4, 1, 0, 1, 2)
    return (struct.pack('<III', 0x46546c67, 2, 12 + 8 + len(j) + 8 + len(b))
            + struct.pack('<II', len(j), 0x4E4F534A) + j + struct.pack('<II', len(b), 0x004E4942) + b)


MOCK_JS = r'''(function(){
const bytes=Uint8Array.from(atob('__GLB64__'),c=>c.charCodeAt(0));
const marks=__MARKERS__;
window.__v344Stats={scene:0,modelDraws:0,beacons:0,markers:0,picks:0,modelRequests:0};
const cvars=['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ARRAY_BUFFER','ELEMENT_ARRAY_BUFFER','STATIC_DRAW','FLOAT','TRIANGLES','UNSIGNED_INT','POINTS','TEXTURE0','TEXTURE_2D','ALIASED_POINT_SIZE_RANGE','DEPTH_TEST','LEQUAL','BLEND','SRC_ALPHA','ONE_MINUS_SRC_ALPHA','FRAMEBUFFER','RENDERBUFFER','DEPTH_COMPONENT16','RGBA8','RGBA','UNSIGNED_BYTE','COLOR_ATTACHMENT0','DEPTH_ATTACHMENT','FRAMEBUFFER_COMPLETE','NO_ERROR','COLOR_BUFFER_BIT','DEPTH_BUFFER_BIT'];
const gl={};cvars.forEach((n,i)=>gl[n]=i+101);gl.NO_ERROR=0;
let n=1;
for(const name of ['createProgram','createShader','createVertexArray','createBuffer','getUniformLocation','createTexture','createFramebuffer','createRenderbuffer'])gl[name]=()=>({id:n++});
for(const name of ['attachShader','shaderSource','compileShader','linkProgram','useProgram','bindVertexArray','bindFramebuffer','bindBuffer','enableVertexAttribArray','vertexAttribPointer','enable','disable','depthFunc','bufferData','bufferSubData','uniformMatrix4fv','uniform3fv','uniform1f','uniform1i','drawBuffers','depthMask','blendFunc','viewport','clearColor','colorMask','texImage2D','texParameteri','framebufferTexture2D','framebufferRenderbuffer','renderbufferStorage','deleteTexture','deleteFramebuffer','deleteRenderbuffer','activeTexture','generateMipmap','texParameterf'])gl[name]=()=>{};
gl.getShaderParameter=()=>true;gl.getProgramParameter=()=>true;gl.getError=()=>0;
gl.checkFramebufferStatus=()=>gl.FRAMEBUFFER_COMPLETE;gl.getExtension=()=>null;
gl.getParameter=k=>k===gl.ALIASED_POINT_SIZE_RANGE?[1,64]:0;
gl.clear=()=>{};gl.drawElements=()=>window.__v344Stats.modelDraws++;
gl.drawArrays=()=>{};gl.readPixels=(x,y,w,h,format,type,pixels)=>pixels.fill(0);
const old=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(what,opt){if(what==='webgl2')return gl;return old.call(this,what,opt);};
window.XMLHttpRequest=class {
 constructor(){this.status=200;this.response=null;this.onload=null;this.onerror=null;this.onprogress=null;this.responseType='';}
 open(method,url){this.url=url;}
 send(){window.__v344Stats.modelRequests++;this.response=bytes.slice().buffer;queueMicrotask(()=>this.onload?.());}
};
window.fetch=async url=>{
 if(String(url).includes('cupmarks-measured.json'))return {ok:true,status:200,json:async()=>marks};
 throw new Error('Texture omitted in isolated draw-path test');
};
})();'''


def state(page):
    return page.evaluate('''() => ({
        dataPage:document.body.dataset.page,
        mode:document.getElementById('chapter-03').dataset.observationMode,
        host:document.getElementById('dolmen3dRoot').parentElement.id,
        marks:window.__dolmenViewerDebug.getCupmarkState(),
        stats:{...window.__v344Stats},
        camera:window.__dolmenViewerDebug.getCamera()
    })''')


def instrument(source):
    replacements = [
        ('function drawScene(picking=false){', 'function drawScene(picking=false){window.__v344Stats.scene++;'),
        ('    const right=[Math.cos(yaw),0,-Math.sin(yaw)];\n    const now=performance.now();',
         '    window.__v344Stats.beacons++;\n    const right=[Math.cos(yaw),0,-Math.sin(yaw)];\n    const now=performance.now();'),
        ('    const u=markerPrograms[picking?1:0];',
         '    window.__v344Stats.markers++;\n    const u=markerPrograms[picking?1:0];'),
        ('    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;',
         '    window.__v344Stats.picks++;\n    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;'),
    ]
    for before, after in replacements:
        assert source.count(before) == 1, ('Missing instrumentation anchor', before[:80])
        source = source.replace(before, after)
    return source


def run_case(browser, path, viewport, expect_isolation):
    page = browser.new_page(viewport=viewport)
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    html = (path / 'index.html').read_text(encoding='utf-8')
    html = re.sub(r'<script[^>]+src=[^>]+></script>', '', html)
    html = re.sub(r'<link[^>]+rel="stylesheet"[^>]*>', '', html)
    page.set_content(html, wait_until='domcontentloaded')
    page.add_style_tag(content=(path / 'css/style.css').read_text(encoding='utf-8'))
    script = MOCK_JS.replace('__GLB64__', base64.b64encode(synthetic_glb()).decode())
    script = script.replace('__MARKERS__', json.dumps(json.loads((path / 'data/cupmarks-measured.json').read_text(encoding='utf-8'))))
    page.evaluate(script)
    page.add_script_tag(content=instrument((path / 'js/dolmenViewer.js').read_text(encoding='utf-8')))
    page.add_script_tag(content=(path / 'js/main.js').read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.evaluate("document.getElementById('exhibitionOpening')?.remove();document.body.classList.remove('is-opening');window.goToPage(2,{instant:true})")
    page.wait_for_timeout(200)
    initial = state(page)
    assert initial['mode'] == 'overview' and initial['host'] == 'dolmenOverviewHost', initial
    assert initial['stats']['modelDraws'] > 0 and initial['stats']['modelRequests'] == 1, initial
    assert initial['marks']['count'] == 46 and initial['marks']['markersLoaded'], initial
    assert initial['stats']['beacons'] == 0 and initial['stats']['markers'] == 0, initial

    # Enter cupmark observation. Select a light by the visitor's actual UI button.
    page.locator('#enterObservation').click()
    page.wait_for_timeout(110)
    page.locator('#cupmarkList button.cupmark-single').first.click()
    page.wait_for_timeout(180)
    lit = state(page)
    assert lit['mode'] == 'observation' and lit['host'] == 'dolmenDetailHost', lit
    assert lit['marks']['illuminatedCupmarkIds'] == ['C01'], lit['marks']
    assert lit['marks']['markersOn'] is True, lit
    assert lit['stats']['beacons'] > 0 and lit['stats']['markers'] > 0, lit
    lit_counts = (lit['stats']['beacons'], lit['stats']['markers'])

    # Leave for artifact overview: model still draws, but cupmark beacons and markers must not.
    page.locator('#returnOverview').click()
    switch_finished = state(page)  # state immediately after the mode-change click
    assert switch_finished['mode'] == 'overview', switch_finished
    page.wait_for_timeout(150)
    page.evaluate('window.__dolmenViewerDebug.requestFrame()')
    page.wait_for_timeout(140)
    hidden = state(page)
    assert hidden['mode'] == 'overview' and hidden['host'] == 'dolmenOverviewHost', hidden
    assert hidden['stats']['modelDraws'] > lit['stats']['modelDraws'], hidden
    if expect_isolation:
        assert hidden['stats']['beacons'] == switch_finished['stats']['beacons'], ('Light leaked into overview', switch_finished, hidden)
        assert hidden['stats']['markers'] == switch_finished['stats']['markers'], ('Marker leaked into overview', switch_finished, hidden)
    else:
        assert hidden['stats']['beacons'] > switch_finished['stats']['beacons'], ('Baseline failure not reproduced',switch_finished,hidden)
    assert hidden['marks']['illuminatedCupmarkIds'] == ['C01'], hidden

    if expect_isolation:
        page.wait_for_timeout(360)
        idle = state(page)
        assert idle['stats']['beacons'] == hidden['stats']['beacons'], ('Pulse leaked while idle', hidden, idle)
        assert idle['stats']['modelDraws'] == hidden['stats']['modelDraws'], ('Hidden light scheduled extra frames', hidden, idle)
        # A tap in overview must not attempt to select a hidden marker.
        rect = page.locator('#stoneViewer').bounding_box()
        assert rect is not None, idle
        page.mouse.click(rect['x']+rect['width']*.5, rect['y']+rect['height']*.5)
        assert state(page)['stats']['picks'] == 0, 'Picking was enabled in overview'

    # Re-entry restores lights without reselecting any individual cupmark.
    page.locator('#enterObservation').click()
    page.wait_for_timeout(200)
    restored = state(page)
    assert restored['marks']['illuminatedCupmarkIds'] == ['C01'], restored
    assert restored['mode'] == 'observation' and restored['host'] == 'dolmenDetailHost', restored
    assert restored['stats']['beacons'] > hidden['stats']['beacons'], restored
    assert restored['stats']['markers'] > hidden['stats']['markers'], restored

    if expect_isolation:
        # Brightness + light mode remain untouched. Verify actual All button as well.
        page.locator('#cupmarkLightSteady').click()
        page.locator('#cupmarkLightBrightness').evaluate('(el)=>{el.value="63";el.dispatchEvent(new Event("input",{bubbles:true}))}')
        page.locator('#cupmarkSelectAll').click()
        page.wait_for_timeout(110)
        all_on = state(page)
        assert len(all_on['marks']['illuminatedIndices']) == 46, all_on
        assert all_on['marks']['lightMode'] == 'steady' and abs(all_on['marks']['lightBrightness']-.63)<.001, all_on
        page.locator('#returnOverview').click()
        all_switched = state(page)
        assert all_switched['mode']=='overview', all_switched
        page.wait_for_timeout(150)
        all_hidden = state(page)
        assert all_hidden['stats']['beacons'] == all_switched['stats']['beacons'], all_hidden
        assert all_hidden['stats']['markers'] == all_switched['stats']['markers'], all_hidden
        page.locator('#enterObservation').click()
        page.wait_for_timeout(140)
        all_restored = state(page)
        assert all_restored['stats']['beacons'] > all_hidden['stats']['beacons'], all_restored
        assert len(all_restored['marks']['illuminatedIndices']) == 46, all_restored
        assert all_restored['marks']['lightMode'] == 'steady' and abs(all_restored['marks']['lightBrightness']-.63)<.001, all_restored
        # OFF/ON button works normally in observation: hiding markers hides illumination, preserving selection.
        page.locator('#cupmarksOff').click()
        page.wait_for_timeout(80)
        off = state(page)
        assert not off['marks']['markersOn'] and len(off['marks']['illuminatedIndices']) == 46, off
        n_beacons = off['stats']['beacons']
        page.evaluate('window.__dolmenViewerDebug.requestFrame()')
        page.wait_for_timeout(80)
        assert state(page)['stats']['beacons'] == n_beacons
        page.locator('#cupmarksOn').click()
        page.wait_for_timeout(100)
        on = state(page)
        assert on['stats']['beacons'] > n_beacons and on['marks']['markersOn'], on
        # Page navigation must not misactivate the 3D Viewer on Chapter 02.
        page.evaluate('window.goToPage(1,{instant:true})')
        page.wait_for_timeout(140)
        left = state(page)
        assert left['dataPage'] == '1', left
        m = left['stats']['modelDraws']
        page.evaluate('window.__dolmenViewerDebug.requestFrame()')
        page.wait_for_timeout(80)
        assert state(page)['stats']['modelDraws'] == m
        page.evaluate('window.goToPage(2,{instant:true})')
        page.wait_for_timeout(140)
        back = state(page)
        assert back['stats']['modelDraws'] > m and back['stats']['beacons'] > left['stats']['beacons'], back
    else:
        all_on = None
        back = None

    assert not errors, errors
    result = {
        'viewport': viewport,
        'baseline': not expect_isolation,
        'geometryLoaded': initial['stats']['modelRequests'] == 1,
        'cupmarksLoaded': initial['marks']['count'],
        'firstLightOn': lit['marks']['illuminatedCupmarkIds'],
        'overviewModelRedraw': hidden['stats']['modelDraws'] > lit['stats']['modelDraws'],
        'beaconCallsAfterLeavingObservation': hidden['stats']['beacons'] - switch_finished['stats']['beacons'],
        'markerCallsAfterLeavingObservation': hidden['stats']['markers'] - switch_finished['stats']['markers'],
        'restoration': restored['stats']['beacons'] > hidden['stats']['beacons'],
        'allLightsRestored': len(back['marks']['illuminatedIndices']) == 46 if back else None,
        'browserErrors': errors,
    }
    page.close()
    return result


if __name__ == '__main__':
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
        # Compare with v34-3 when that baseline directory is available alongside this project.
        results = {}
        previous = ROOT.parent / 'stone-traces-v34-3'
        if previous.is_dir():
            results['v34_3_bug_reproduced'] = run_case(browser, previous, {'width':1440,'height':900}, False)
        results['v34_4_desktop'] = run_case(browser, ROOT, {'width':1440,'height':900}, True)
        results['v34_4_mobile'] = run_case(browser, ROOT, {'width':390,'height':844}, True)
        browser.close()
    print(json.dumps(results, ensure_ascii=False, indent=2))
