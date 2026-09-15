"""Perspective scene candidate from R07 measured architecture; source model stays untouched."""
import bpy, json, hashlib
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'art-candidates'/'reflection-gallery'/'scene'
MODEL=Path.home()/'Projects'/'Unwritten-Coast-Data'/'architecture'/'r07-reflection-gallery-v2.blend'
if OUT.exists():raise RuntimeError('Scene candidate exists; review before replacing')
OUT.mkdir(parents=True)
before=hashlib.sha256(MODEL.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(MODEL));s=bpy.context.scene;F=.3048
s.render.resolution_x=1536;s.render.resolution_y=864;s.render.resolution_percentage=100;s.cycles.samples=64;s.view_settings.exposure=-1.1
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
if any(d.type=='CUDA' for d in prefs.devices):
 for d in prefs.devices:d.use=d.type=='CUDA'
 s.cycles.device='GPU'
# Cutaway wall tops and roof surfaces are restored only for the interior camera.
stone=bpy.data.materials.get('Local SD weathered harbor limestone')
def wall(name,pos,size):
 bpy.ops.mesh.primitive_cube_add(size=1,location=tuple(v*F for v in pos));o=bpy.context.object;o.name=name;o.dimensions=tuple(v*F for v in size);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(stone)
wall('South wall above cut',(40,-.2,6.3),(80,.4,11.4))
for x in [0,80]:
 for y in [3,17]:wall('End wall above cut',(x,y,6.3),(.4,6,11.4))
for o in s.objects:
 if o.name.startswith('Ceiling mirror panel'):o.hide_render=False
 if o.type=='LIGHT':o.data.energy*=.7
cam=s.camera;cam.data.type='PERSP';cam.data.lens=24;cam.data.clip_start=.03
cam.location=Vector((3*F,5*F,5.8*F));cam.rotation_euler=(Vector((48*F,12*F,5*F))-cam.location).to_track_quat('-Z','Y').to_euler()
s.render.filepath=str(OUT/'geometry-scene.png');bpy.ops.render.render(write_still=True)
assert hashlib.sha256(MODEL.read_bytes()).hexdigest()==before
(OUT/'geometry-scene.json').write_text(json.dumps({'roomId':'R07','sourceModel':str(MODEL),'sourceSha256':before,'cameraFeet':[3,5,5.8],'lookAtFeet':[48,12,5],'lensMm':24,'size':[1536,864],'limits':['Interior perspective of the measured candidate; no workers or puzzle answers authored.','Cutaway wall tops restored only for rendering; original model and campaign assets unchanged.']},indent=2),encoding='utf8')
print('GALLERY_SCENE_COMPLETE')
