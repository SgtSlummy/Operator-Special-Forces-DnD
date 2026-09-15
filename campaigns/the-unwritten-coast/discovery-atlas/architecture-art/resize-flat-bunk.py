"""Prepare a measured adult bunk revision without replacing approved room artifacts."""
import bpy, bmesh, json, hashlib
from pathlib import Path
from mathutils import Vector, Matrix
DATA=Path.home()/'Projects'/'Unwritten-Coast-Data'
MODEL=DATA/'art-candidates'/'caretaker-flat'/'material-pass'/'r05-caretaker-flat-materials.blend'
OUT=DATA/'art-candidates'/'caretaker-flat'/'adult-bunk-materials'
OUT.mkdir(parents=True,exist_ok=True)
if any(OUT.iterdir()):raise RuntimeError('Adult bunk candidate already exists; review it before rerunning.')
before=hashlib.sha256(MODEL.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(MODEL))
s=bpy.context.scene;F=.3048
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
if any(d.type=='CUDA' for d in prefs.devices):
 for d in prefs.devices:d.use=d.type=='CUDA'
 s.cycles.device='GPU'
# Keep the head against its existing north-wall position; extend the foot south.
for name,length in [('Bunk oak frame',6.8),('Stuffed mattress',6.55)]:
 o=bpy.data.objects[name];o.location.y-=.35*F;o.dimensions.y=length*F
 bpy.context.view_layer.objects.active=o;bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
for o in bpy.data.objects:
 if o.name.startswith('Bunk post') and o.location.y/F<13:o.location.y-=.7*F
 if o.name.startswith('Blanket woven band'):o.location.y-=.7*F
blanket=bpy.data.objects['Faded wool blanket'];blanket.location.y-=.35*F;blanket.dimensions.y=5*F
bpy.context.view_layer.update()
assert abs(bpy.data.objects['Stuffed mattress'].dimensions.y/F-6.55)<.001
assert abs(bpy.data.objects['Bunk oak frame'].dimensions.y/F-6.8)<.001
cam=s.camera
s.render.filepath=str(OUT/'r05-cutaway.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'r05-caretaker-flat.blend'))
for o in list(s.objects):
 if o.type not in {'MESH','CURVE'} or o.name=='Ground':continue
 bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=o;o.select_set(True)
 if o.type=='CURVE':bpy.ops.object.convert(target='MESH')
 mesh=bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()));mesh.transform(o.matrix_world);o.modifiers.clear();o.data=mesh;o.matrix_world=Matrix.Identity(4)
 bm=bmesh.new();bm.from_mesh(mesh);cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,4*F),plane_no=(0,0,1),clear_outer=True)
 edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
 if edges:bmesh.ops.holes_fill(bm,edges=edges,sides=0)
 bm.to_mesh(mesh);bm.free()
for name,pos,target,scale in [('r05-floor-slice',(5.5,8.5,35),(5.5,8.5,0),25),('r05-low-cutaway',(27,-29,30),(5.5,8.5,1),29)]:
 cam.location=tuple(v*F for v in pos);cam.rotation_euler=(Vector(tuple(v*F for v in target))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale*F;bpy.context.view_layer.update();s.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
assert hashlib.sha256(MODEL.read_bytes()).hexdigest()==before
(OUT/'provenance.json').write_text(json.dumps({'sourceModel':str(MODEL),'sourceSha256':before,'frameLengthFeet':6.8,'mattressLengthFeet':6.55,'headPositionPreserved':True,'camerasUnchanged':True,'approved':False},indent=2),encoding='utf8')
print('R05_ADULT_BUNK_COMPLETE')
