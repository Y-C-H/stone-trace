"""Isolated Chromium DOM tests for v35 opening controls.

Run: python scripts/test-v35-opening.py
Requires: playwright, Chromium. Since this test uses page.set_content(), CSS and
JavaScript are injected from disk; network, actual media output and WebGL aren't
being tested. Audio playback/stop calls are instrumented. Use real HTTP hosting
and a real device for final deployed-site verification.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import re
import sys

ROOT=Path(__file__).resolve().parents[1]
HTML=re.sub(r'<script[^>]+src=[^>]+></script>','',(ROOT/'index.html').read_text())
HTML=re.sub(r'<link[^>]+(?:rel="stylesheet"|rel="preload")[^>]*>','',HTML)
CSS=(ROOT/'css/style.css').read_text()
JS=(ROOT/'js/main.js').read_text()
STUB_AUDIO='''() => {
  window.__audioCalls={play:0,pause:0};
  HTMLMediaElement.prototype.play=function(){window.__audioCalls.play++;return Promise.resolve()};
  HTMLMediaElement.prototype.pause=function(){window.__audioCalls.pause++};
  HTMLMediaElement.prototype.load=function(){};
}'''


def check(case):
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
        viewport={'width':390,'height':844} if case=='mobile' else {'width':1440,'height':900}
        page=browser.new_page(viewport=viewport)
        errors=[]
        page.on('pageerror',lambda err:errors.append(str(err)))
        page.set_content(HTML,wait_until='domcontentloaded')
        page.add_style_tag(content=CSS)
        if case.startswith('deep:'):
            page.evaluate('(hash)=>{location.hash=hash}',case[5:])
        page.evaluate(STUB_AUDIO)
        page.add_script_tag(content=JS)
        page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
        overlay=page.locator('#exhibitionOpening')
        if case.startswith('deep:'):
            target=('#exhibition-ending' if case=='deep:#ending' else case[5:])
            assert overlay.count()==0,case
            assert page.locator(target+'.active').count()==1,case
            assert page.evaluate('window.__audioCalls.play')==0
        elif case in ['desktop','mobile']:
            button=page.locator('#openingStart')
            assert button.inner_text()=='화면을 클릭하여 시작하세요'
            assert page.evaluate('getComputedStyle(document.querySelector("#openingStart")).backgroundColor')=='rgb(0, 0, 0)'
            assert page.evaluate('document.querySelector("#openingStart").getBoundingClientRect().width')==viewport['width']
            assert page.evaluate('window.__audioCalls.play')==0
            button.click()
            assert button.is_hidden()
            assert 'is-playing' in overlay.get_attribute('class')
            assert page.evaluate('window.__audioCalls.play')==1
            assert page.evaluate('document.querySelector("#openingAudio").volume')==.65
            page.wait_for_timeout(3900)
            assert overlay.count()==0
            assert page.locator('#chapter-01.active').count()==1
        elif case=='skip':
            page.locator('#openingStart').click()
            overlay.click(position={'x':20,'y':20})
            page.wait_for_timeout(150)
            assert overlay.count()==0
            assert page.evaluate('window.__audioCalls.pause')>=1
        elif case=='keyboard':
            page.keyboard.press('Enter')
            assert 'is-playing' in overlay.get_attribute('class')
            page.keyboard.press('Space')
            page.wait_for_timeout(150)
            assert overlay.count()==0
        elif case=='double-start':
            page.locator('#openingStart').dispatch_event('click')
            page.locator('#openingStart').dispatch_event('click')
            assert page.evaluate('window.__audioCalls.play')==1
        elif case=='audio-denied':
            page.evaluate('''() => {document.querySelector("#openingAudio").play=()=>Promise.reject(new Error("blocked"));}''')
            page.locator('#openingStart').click()
            page.wait_for_timeout(3900)
            assert overlay.count()==0
            assert page.locator('#chapter-01.active').count()==1
        elif case.startswith('popstate:'):
            if case.endswith('playing'):page.locator('#openingStart').click()
            page.evaluate("window.dispatchEvent(new PopStateEvent('popstate'))")
            page.wait_for_timeout(100)
            assert overlay.count()==0
        else:
            raise ValueError(case)
        assert not errors,(case,errors)
        page.close()
        browser.close()
        return {'ok':True,'pageErrors':errors}

if __name__=='__main__':
    cases=sys.argv[1:] or ['desktop','mobile','skip','keyboard','double-start','audio-denied']
    # Run deep-link and popstate cases separately when needed, e.g.:
    # python scripts/test-v35-opening.py 'deep:#ending' 'popstate:playing'
    results={}
    for c in cases:
        results[c]=check(c)
        print(c,': passed',flush=True)
    print(json.dumps(results,ensure_ascii=False,indent=2))
