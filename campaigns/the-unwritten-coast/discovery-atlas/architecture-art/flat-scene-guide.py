"""Render a candidate eye-level guide from R05; never save changes to the model."""
import bpy,json,hashlib,time
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
DATA=Path.home()/'Projects'/'Unwritten-Coast-Data'
MODEL=DATA/'architecture'/'r05-caretaker-flat.blend'
OUT=DATA/'art-candidates'/'caretaker-flat'/('measured-scene-'+time.strftime('%Y%m%d-%H%M%S'))
OUT.mkdir(parents=True,exist_ok=False)
before=hashlib.sha256(MODEL.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(MODEL))
s=bpy.context.scene;F=.3048
bed=bpy.data.objects['Bunk oak frame']
assert abs(bed.dimensions.y/F-6.8)<.001
textures=[]
for image in bpy.data.images:
 if image.source!='FILE':continue
 if not image.packed_file:raise RuntimeError('Scene guide requires portable packed materials: '+image.name)
 textures.append(image.name)
# Complete the walls intentionally omitted by the cutaway model. No furniture changes.
stone=bpy.data.materials['Existing local SD harbor limestone']
wood=bpy.data.materials['Oiled brown oak']
def slab(name,position,size,material):
 bpy.ops.mesh.primitive_cube_add(size=1,location=tuple(v*F for v in position));o=bpy.context.object;o.name=name;o.dimensions=tuple(v*F for v in size);o.data.materials.append(material)
slab('Scene east wall',(11.16,11,4),(.32,12,8),stone)
slab('Scene recess north wall',(9,4.84,4),(4,.32,8),stone)
slab('Scene recess west wall',(7.16,2.5,4),(.32,5,8),stone)
slab('Scene ceiling',(5.5,8.5,8.15),(11.32,17.32,.3),wood)
for m in bpy.data.materials:
 if not m.use_nodes:continue
 nodes=m.node_tree.nodes;links=m.node_tree.links
 bs=nodes.get('Principled BSDF');output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
 if not bs or not output:continue
 color=bs.inputs['Base Color'];em=nodes.new('ShaderNodeEmission');em.inputs['Strength'].default_value=1
 if color.is_linked:links.new(color.links[0].from_socket,em.inputs['Color'])
 else:em.inputs['Color'].default_value=color.default_value
 links.new(em.outputs[0],output.inputs['Surface'])
s.render.engine='CYCLES';s.cycles.samples=8;s.view_settings.view_transform='Standard'
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
if any(d.type=='CUDA' for d in prefs.devices):
 for device in prefs.devices:device.use=device.type=='CUDA'
 s.cycles.device='GPU'
s.render.resolution_x=1216;s.render.resolution_y=832;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.use_freestyle=True
style=s.view_layers[0].freestyle_settings.linesets[0].linestyle;style.color=(.04,.045,.04);style.thickness=1.4
cam=s.camera;cam.data.type='PERSP';cam.data.lens=22;cam.data.clip_start=.03;cam.data.shift_x=0;cam.data.shift_y=0
cam.location=Vector((5.6*F,.8*F,5.2*F));target=Vector((4.9*F,12*F,2.9*F));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.context.view_layer.update();s.render.filepath=str(OUT/'flat-guide.png');bpy.ops.render.render(write_still=True)
assert hashlib.sha256(MODEL.read_bytes()).hexdigest()==before
(OUT/'provenance.json').write_text(json.dumps({'roomId':'R05','model':str(MODEL),'modelSHA256':before,'cameraFeet':[5.6,.8,5.2],'targetFeet':[4.9,12,2.9],'lensMM':22,'bedLengthFeet':bed.dimensions.y/F,'packedTextures':textures,'candidateOnly':True,'additions':'Walls and ceiling complete the cutaway envelope only; furniture unchanged.','limits':'Dark window; no hidden harbor geography or readable clue text. Style guide, not approved campaign image.'},indent=2))
print('MEASURED_FLAT_SCENE_COMPLETE '+str(OUT))
