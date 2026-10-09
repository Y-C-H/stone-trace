"""Lossless geometry conversion of binary STL to indexed GLB, without remeshing or decimation.
Distinct binary float32 XYZ triples become one shared vertex. The original triangle
ordering, vertex locations, winding, axes, origin, and scale are retained exactly.
Face normals are not baked into the GLB: the WebGL2 fragment shader derives the
flat surface normal from geometry derivatives, avoiding synthetic smooth shading.
"""
import hashlib,json,struct,sys,time
from pathlib import Path
import numpy as np

TRI=np.dtype([('normal','<f4',(3,)),('vertices','<f4',(3,3)),('attribute','<u2')])
SOURCES={
 '1m':'dolmen_1M_poly(2).stl',
 '700k':'dolmen_700K_poly(1).stl',
 '400k':'dolmen_400K_poly(1).stl',
}
root=Path(__file__).resolve().parents[2]
out=Path(__file__).resolve().parents[1]/'assets/models';out.mkdir(parents=True,exist_ok=True)
record={}
for kind,filename in SOURCES.items():
 t0=time.monotonic()
 path=root/filename
 with open(path,'rb') as f:header=f.read(84)
 count=struct.unpack_from('<I',header,80)[0]
 assert path.stat().st_size==84+50*count, 'STL byte size mismatch'
 mesh=np.memmap(path,dtype=TRI,mode='r',offset=84,shape=(count,))
 vertex_data=np.ascontiguousarray(mesh['vertices'].reshape((-1,3)))
 assert np.isfinite(vertex_data).all()
 bbox_min=vertex_data.min(axis=0);bbox_max=vertex_data.max(axis=0)
 # Exact bitwise coordinate identity, not rounded spatial welding.
 unique, inverse=np.unique(vertex_data.view('<u4').reshape((-1,3)),axis=0,return_inverse=True)
 unique=unique.view('<f4').reshape((-1,3)).copy()
 indices=inverse.astype('<u4')
 assert len(indices)==count*3
 # Validate every source coordinate is recovered from the indexed buffers.
 assert np.array_equal(unique[indices].view('<u4'),vertex_data.view('<u4'))
 unique_bytes=unique.tobytes();index_bytes=indices.tobytes()
 blob=unique_bytes+index_bytes
 metadata={
  'asset':{'version':'2.0','generator':'Stone Traces v16-A lossless STL->GLB'},
  'scene':0,'scenes':[{'nodes':[0]}],
  'nodes':[{'mesh':0,'name':'Unaltered STL coordinates; Y up'}],
  'meshes':[{'name':'Dolmen scan '+kind,'primitives':[{'attributes':{'POSITION':0},'indices':1,'mode':4}],
     'extras':{'sourceTriangleCount':count,'coordinatePolicy':'exact IEEE754 XYZ; no decimation; no transform'}}],
  'buffers':[{'byteLength':len(blob)}],
  'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(unique_bytes),'target':34962},
                 {'buffer':0,'byteOffset':len(unique_bytes),'byteLength':len(index_bytes),'target':34963}],
  'accessors':[{'bufferView':0,'componentType':5126,'count':len(unique),'type':'VEC3',
    'min':[float(x) for x in bbox_min],'max':[float(x) for x in bbox_max]},
   {'bufferView':1,'componentType':5125,'count':len(indices),'type':'SCALAR'}]
 }
 j=json.dumps(metadata,separators=(',',':'),ensure_ascii=False).encode('utf-8');j+=b' ' * ((4-len(j)%4)%4)
 if len(blob)%4:blob+=b'\0'*((4-len(blob)%4)%4)
 total=12+8+len(j)+8+len(blob)
 op=out/('dolmen-'+kind+'.glb')
 with open(op,'wb') as f:
  f.write(struct.pack('<4sII',b'glTF',2,total));f.write(struct.pack('<I4s',len(j),b'JSON'));f.write(j)
  f.write(struct.pack('<I4s',len(blob),b'BIN\0'));f.write(blob)
 sha=hashlib.sha256()
 with open(path,'rb') as f:
  for part in iter(lambda:f.read(8*1024*1024),b''):sha.update(part)
 record[kind]={'source':filename,'stlBytes':path.stat().st_size,'glbBytes':op.stat().st_size,'triangles':count,'vertices':len(unique),
  'boundsMin':bbox_min.tolist(),'boundsMax':bbox_max.tolist(),'center':((bbox_min+bbox_max)/2).tolist(),
  'extent':(bbox_max-bbox_min).tolist(),'sourceSHA256':sha.hexdigest(),
  'validation':'Every original float32 vertex bit pattern and all ordered triangle indices preserved',
  'conversionSeconds':round(time.monotonic()-t0,2)}
 print(kind,'triangles',count,'unique vertices',len(unique),'GLB MB',round(op.stat().st_size/1e6,2),'time',record[kind]['conversionSeconds'],flush=True)
 (out/'conversion-record.json').write_text(json.dumps(record,indent=2,ensure_ascii=False),encoding='utf-8')
 del indices,inverse,unique,mesh,vertex_data,blob
