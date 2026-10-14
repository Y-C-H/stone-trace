#!/usr/bin/env python3
"""Rebuild Chapter 01's knowledgeData.js from a workbook using Python stdlib.

Usage (run in project root):
    python scripts/convert_knowledge_map_v29.py
    python scripts/convert_knowledge_map_v29.py newer.xlsx

Previous image associations are retained by matching node IDs. The workbook's
'성혈' worksheet is intentionally ignored: Chapters 02 and 04 are untouched.
"""
import json
import re
import shutil
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'data' / 'knowledge-map-source.xlsx'
OUTPUT = ROOT / 'js' / 'knowledgeData.js'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'p': 'http://schemas.openxmlformats.org/package/2006/relationships'}


def read_workbook(src):
    with zipfile.ZipFile(src) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            shared = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in shared.findall('m:si', NS):
                strings.append(''.join(t.text or '' for t in si.findall('.//m:t', NS)))
        book = ET.fromstring(z.read('xl/workbook.xml'))
        rel_root = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        rels = {r.attrib['Id']: r.attrib['Target'] for r in rel_root}
        out = {}
        for sheet in book.findall('m:sheets/m:sheet', NS):
            name = sheet.attrib['name']
            if name not in ('노드', '연결', '분류'):
                continue
            target = rels[sheet.attrib['{' + NS['r'] + '}id']]
            path = ('xl/' + target.lstrip('/')) if not target.startswith('/') else target.lstrip('/')
            if path.startswith('xl/xl/'):
                path = path[3:]
            root = ET.fromstring(z.read(path))
            matrix = []
            for row in root.findall('.//m:sheetData/m:row', NS):
                values = {}
                for cell in row.findall('m:c', NS):
                    ref = cell.attrib.get('r', '')
                    letters = re.match(r'^([A-Z]+)', ref)
                    if letters is None:
                        continue
                    idx = 0
                    for ch in letters.group(1):
                        idx = idx * 26 + ord(ch) - 64
                    idx -= 1
                    v = cell.find('m:v', NS)
                    typ = cell.attrib.get('t')
                    if typ == 'inlineStr':
                        val = ''.join((t.text or '') for t in cell.findall('.//m:is/m:t', NS))
                    elif v is not None and v.text is not None:
                        val = strings[int(v.text)] if typ == 's' else v.text
                    else:
                        val = ''
                    values[idx] = val
                if values:
                    matrix.append([values.get(i, '') for i in range(max(values) + 1)])
            out[name] = matrix
        return out


def at(row, pos):
    return str(row[pos]).strip() if pos < len(row) and row[pos] is not None else ''


def main():
    source = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else TARGET
    sheets = read_workbook(source)
    prev = {}
    if OUTPUT.exists():
        src = OUTPUT.read_text(encoding='utf-8')
        marker = 'window.STONE_GRAPH_DATA = '
        if marker in src:
            prev = {n['id']: n for n in json.loads(src.split(marker, 1)[1].rsplit(';', 1)[0])['nodes']}
    categories = {}
    for row in sheets['분류'][1:]:
        code, name, color = at(row, 0), at(row, 1), at(row, 2)
        if code:
            categories[code] = {'name': name, 'color': color, 'source': 'spreadsheet'}
    nodes = []
    for row in sheets['노드'][1:]:
        nid, label, code = (at(row, i) for i in range(3))
        if not nid:
            continue
        if code not in categories:
            raise ValueError('Unknown category: ' + code)
        existing = prev.get(nid, {})
        paths = [t.strip() for t in re.split(r'[,;\n]+', at(row, 4)) if t.strip()]
        paths = [p for p in paths if (ROOT / p).is_file()]
        if not paths:
            paths = [p for p in existing.get('images', []) if (ROOT / p).is_file()]
        nodes.append({'id':nid, 'sheetId':nid, 'label':label, 'g':code,
                      'text':at(row, 3), 'image':paths[0] if paths else None,
                      'images':paths, 'memoryRole':at(row, 5),
                      'memoryLens':at(row, 6), 'source':'spreadsheet'})
    idset = {n['id'] for n in nodes}
    if len(idset) != len(nodes):
        raise ValueError('Duplicate node IDs')
    links = []
    for row in sheets['연결'][1:]:
        a, b = at(row, 0), at(row, 1)
        if not a or not b:
            continue
        if a not in idset or b not in idset:
            raise ValueError('Invalid link: ' + repr([a, b]))
        links.append({'source':a, 'target':b, 'sourceType':'spreadsheet',
                      'relationType':at(row, 4), 'reason':at(row, 5)})
    if not any(n['id'] == 'b14' and n['label'] == '암각화' for n in nodes):
        raise ValueError('Expected b14 암각화 node missing')
    data = {'meta':{'title':'고인돌 지식지도','sheetSource':'data/knowledge-map-source.xlsx',
                    'sheetNames':['안내','노드','연결','분류','성혈'],
                    'nodeSource':'spreadsheet','counts':{
                        'sheetRows':len(nodes),'retainedNodes':len(nodes),
                        'retainedLinks':len(links),'groups':len(categories),
                        'embeddedImages':sum(bool(n['images']) for n in nodes)}},
            'groups':categories,'nodes':nodes,'links':links}
    if source != TARGET:
        shutil.copy2(source, TARGET)
    OUTPUT.write_text('/* v29 — generated from data/knowledge-map-source.xlsx; photos preserved by node ID. */\nwindow.STONE_GRAPH_DATA = '+json.dumps(data, ensure_ascii=False, indent=2)+';\n', encoding='utf-8')
    print(f'Updated {OUTPUT.relative_to(ROOT)}: {len(nodes)} nodes, {len(links)} links, {len(categories)} groups')


if __name__ == '__main__':
    main()
