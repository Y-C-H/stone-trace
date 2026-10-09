"""Rebuild Chapter 02's measured cupmark JSON from the retained original workbook.
Run from the project root: python scripts/build-v16b-data.py
Requirements: artifact_tool, numpy, scipy, trimesh. The web exhibition itself
has no Python/runtime dependency. The script never edits the source workbook.
"""
from pathlib import Path
from collections import Counter
import json
import math
import struct
import statistics
import numpy as np
from scipy.spatial import cKDTree
import trimesh
from artifact_tool import Blob, SpreadsheetFile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/cupmarks-measured-source.xlsx'
DEST = ROOT / 'data/cupmarks-measured.json'
VAL = ROOT / 'data/v16b-validation.json'
MODEL_NAMES = {'1m':'dolmen-1m.glb','700k':'dolmen-700k.glb'}
SURFACE_TOLERANCE = 1.0  # GLB source-coordinate units, not assumed millimeters
MARKER_ELEVATION = 0.8  # GLB source-coordinate units, visual marker only


def model_geometry(file):
    binary = file.read_bytes()
    offset = 12
    gltf = None
    binary_offset = None
    while offset < len(binary):
        length, chunk_type = struct.unpack_from('<II', binary, offset)
        offset += 8
        if chunk_type == 0x4e4f534a:
            gltf = json.loads(binary[offset:offset + length])
        elif chunk_type == 0x004e4942:
            binary_offset = offset
        offset += length
    if gltf is None or binary_offset is None:
        raise ValueError(f'Not a supported GLB: {file}')
    primitive = gltf['meshes'][0]['primitives'][0]
    position_accessor = gltf['accessors'][primitive['attributes']['POSITION']]
    index_accessor = gltf['accessors'][primitive['indices']]
    pos_view = gltf['bufferViews'][position_accessor['bufferView']]
    index_view = gltf['bufferViews'][index_accessor['bufferView']]
    pos_offset = binary_offset + pos_view.get('byteOffset', 0) + position_accessor.get('byteOffset', 0)
    ix_offset = binary_offset + index_view.get('byteOffset', 0) + index_accessor.get('byteOffset', 0)
    vertices = np.frombuffer(binary, dtype='<f4', count=position_accessor['count'] * 3, offset=pos_offset).reshape(-1, 3)
    indices = np.frombuffer(binary, dtype='<u4', count=index_accessor['count'], offset=ix_offset).reshape(-1, 3)
    return vertices, indices


def nearest_surface(vertices, indices, coords):
    triangles = vertices[indices]
    centers = triangles.mean(axis=1)
    tree = cKDTree(centers)
    projections, normals, distances = [], [], []
    for p in coords:
        _, candidates = tree.query(p, k=min(512, len(triangles)))
        candidates = np.atleast_1d(candidates)
        candidate_faces = triangles[candidates]
        closest = trimesh.triangles.closest_point(candidate_faces, np.repeat(p[None, :], len(candidates), axis=0))
        dist = np.linalg.norm(closest - p[None, :], axis=1)
        best = int(np.argmin(dist))
        triangle = candidate_faces[best]
        normal = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
        normal /= max(float(np.linalg.norm(normal)), 1e-12)
        if normal[1] < 0:
            normal *= -1
        projections.append(closest[best].tolist())
        normals.append(normal.tolist())
        distances.append(float(dist[best]))
    return projections, normals, distances


def position(vec):
    return {k: round(float(x), 8) for k, x in zip(('x', 'y', 'z'), vec)}


def main():
    wb = SpreadsheetFile.import_xlsx(Blob.load(str(SOURCE)))
    sheet = wb.worksheets.get_item_at(0)
    # Data rows are determined by the actual workbook, never by a presumed 46.
    spreadsheet_rows = sheet.get_range('A1:G1024').values
    header = spreadsheet_rows[0]
    active_rows = [(i, r) for i, r in enumerate(spreadsheet_rows[1:], start=2) if any(v is not None and str(v).strip() for v in r)]
    points, errors, anomalies = [], [], []
    id_list = []
    for excel_row, row in active_rows:
        id_, dia, diameter_grade, depth, depth_grade, position_raw, note = row
        if not id_:
            errors.append({'row': excel_row, 'reason':'missing ID'})
            continue
        id_list.append(id_)
        if not isinstance(position_raw, str):
            errors.append({'row':excel_row, 'id':id_, 'reason':'missing coordinate string'})
            continue
        fields = [f.strip() for f in position_raw.split(',')]
        if len(fields)==4 and fields[0]=='' and all(fields[1:]):
            fields = fields[1:]
            anomalies.append({'row':excel_row,'id':id_,'field':'F','originalValue':position_raw,'resolution':'Removed one extraneous leading comma; no coordinate value was inferred'})
        try:
            if len(fields) != 3 or not all(fields):
                raise ValueError('Expected three valid XYZ values')
            values = np.array([float(x) for x in fields], dtype=np.float64)
            if not np.isfinite(values).all():
                raise ValueError('Non-finite coordinate value')
        except ValueError as error:
            errors.append({'row':excel_row,'id':id_,'reason':str(error)})
            continue
        points.append({'id':str(id_), 'row':excel_row, 'original':str(position_raw),'position':values,'diameter':dia,'depth':depth,'diameterGrade':diameter_grade,'depthGrade':depth_grade,'note':note})
    if not points:
        raise ValueError('No valid measured coordinates found')
    if len(set(id_list)) != len(id_list):
        raise ValueError('Duplicate measured IDs — resolve IDs before regeneration')
    coords = np.stack([p['position'] for p in points], axis=0)
    per_model = {}
    for key,name in MODEL_NAMES.items():
        vertices, indices = model_geometry(ROOT / 'assets/models' / name)
        projections, normals, distances = nearest_surface(vertices, indices, coords)
        per_model[key] = {'points':projections, 'normals':normals,'distances':distances}
        print(key, 'triangles',len(indices),'max surface distance',max(distances))
    output = []
    for i, p in enumerate(points):
        marker_positions, surface_positions, surface_distances = {}, {}, {}
        for key, geom in per_model.items():
            d = geom['distances'][i]
            snapped = (np.array(geom['points'][i]) + MARKER_ELEVATION*np.array(geom['normals'][i])) if d <= SURFACE_TOLERANCE else p['position']
            marker_positions[key] = position(snapped)
            surface_positions[key] = position(geom['points'][i])
            surface_distances[key] = round(d, 6)
        output.append({'id':p['id'],'legacyId':None,'status':'measured','sourceRow':p['row'],'sourcePositionRaw':p['original'],
            'sourcePosition':position(p['position']),'displayPosition':position(p['position']),
            'renderPositions':marker_positions,'surfacePoints':surface_positions,'surfaceDistance':surface_distances,
            'diameter':p['diameter'],'depth':p['depth'],'measurementUnit':'mm','diameterUnit':'mm','depthUnit':'mm',
            'diameterGrade':p['diameterGrade'],'depthGrade':p['depthGrade'],'note':p['note']})
    DEST.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    reference = json.loads(VAL.read_text(encoding='utf8'))
    reference['excel'].update({'file':SOURCE.name,'sheet':sheet.name,'header':header,'rowCount':len(active_rows),'validPointCount':len(output),
         'duplicateIdCount':len(id_list)-len(set(id_list)),'missingCoordinateCount':len(errors),'invalidRows':errors,'formatAnomalies':anomalies})
    refdist=per_model['1m']['distances']
    reference['surfaceValidation'].update({'pointsChecked':len(points),'pointsNearSurface':sum(d<=SURFACE_TOLERANCE for d in refdist),
        'pointsOutsideTolerance':sum(d>SURFACE_TOLERANCE for d in refdist),'maxDistance':max(refdist),
        'meanDistance':statistics.mean(refdist),'medianDistance':statistics.median(refdist),
        'perModel':{k:{'pointsChecked':len(v['distances']),'maxDistance':max(v['distances']),'meanDistance':statistics.mean(v['distances']),
        'medianDistance':statistics.median(v['distances']),'withinTolerance':sum(d<=SURFACE_TOLERANCE for d in v['distances'])} for k,v in per_model.items()},
        'transformValidated':all(d<=SURFACE_TOLERANCE for k in per_model for d in per_model[k]['distances'])})
    reference['chapter02']['markerCount']=len(output)
    VAL.write_text(json.dumps(reference,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('Done:',len(output),'valid points,',len(errors),'errors,',len(anomalies),'noted formatting anomalies')

if __name__=='__main__':
    main()
