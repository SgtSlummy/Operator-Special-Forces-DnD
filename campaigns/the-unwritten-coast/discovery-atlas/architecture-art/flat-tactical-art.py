"""Render flat tactical art through each approved measured floor camera."""
import bpy,bmesh,json,sys,hashlib
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view
ROOT=Path(__file__).resolve().parent.parent
DATA=Path.home()/'Projects'/'Unwritten-Coast-Data'
MODELS={'R01':'r01-brass-vestibule.blend','R02':'r02-valve-throat.blend','R05':'r05-caretaker-flat.blend','R07':'r07-reflection-gallery-v2.blend'}
room=sys.argv[sys.argv.index('--')+1]
if room not in MODELS:raise RuntimeError('Unsupported modeled room')
model=DATA/'architecture'/MODELS[room]
geometry=json.loads((ROOT/'art'/'architecture'/(room.lower()+'-projection.json')).read_text())
layer=room.lower()+'-floor-slice';camera=geometry['views'][layer];dimensions=geometry['dimensionsFeet']
OUT=DATA/'art-candidates'/'flat-tactical'/room
OUT.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=str(model));s=bpy.context.scene;F=.3048
textures=[]
for image in bpy.data.images:
 if image.source!='FILE':continue
 if not image.packed_file:
  path=Path(bpy.path.abspath(image.filepath))
  if not path.is_file():
   name=Path(image.filepath.replace('\\','/')).name
   path=next((p for p in [ROOT/'art'/'architecture'/name,DATA/'approved-art'/'materials'/name] if p.is_file()),None)
   if path is None:raise RuntimeError('Missing approved texture: '+name)
   image.filepath=str(path);image.reload()
 textures.append(image.name)
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
for obj in list(s.objects):
 if obj.type not in {'MESH','CURVE'} or obj.name=='Ground':continue
 bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=obj;obj.select_set(True)
 if obj.type=='CURVE':bpy.ops.object.convert(target='MESH')
 mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()));mesh.transform(obj.matrix_world);obj.modifiers.clear();obj.data=mesh;obj.matrix_world=Matrix.Identity(4)
 bm=bmesh.new();bm.from_mesh(mesh);cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,geometry['horizontalSectionFeet']*F),plane_no=(0,0,1),clear_outer=True)
 edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
 if edges:bmesh.ops.holes_fill(bm,edges=edges,sides=0)
 bm.to_mesh(mesh);bm.free()
origin=camera['origin'];xaxis=camera['xAxis'];yaxis=camera['yAxis']
assert abs(xaxis[1]-origin[1])<.001 and abs(yaxis[0]-origin[0])<.001
px=(xaxis[0]-origin[0])/dimensions['width'];py=(origin[1]-yaxis[1])/dimensions['depth']
assert px>0 and py>0 and abs(px-py)<.001
s.render.resolution_x=camera['width'];s.render.resolution_y=camera['height'];s.render.resolution_percentage=100
cam=s.camera;cam.data.type='ORTHO';cam.data.shift_x=0;cam.data.shift_y=0
cam.location=((camera['width']/2-origin[0])/px*F,(origin[1]-camera['height']/2)/py*F,(dimensions['height']+40)*F)
cam.rotation_euler=(0,0,0);cam.data.ortho_scale=camera['width']/px*F;bpy.context.view_layer.update()
errors=[]
for point,expected in [((0,0,0),origin),((dimensions['width'],0,0),xaxis),((0,dimensions['depth'],0),yaxis)]:
 p=world_to_camera_view(s,cam,Vector(tuple(v*F for v in point)));actual=(p.x*camera['width'],(1-p.y)*camera['height']);errors.append(max(abs(actual[i]-expected[i]) for i in range(2)))
assert max(errors)<.05,errors
s.render.use_freestyle=True;style=s.view_layers[0].freestyle_settings.linesets[0].linestyle;style.color=(.065,.08,.065);style.thickness=1.1
s.render.filepath=str(OUT/(layer+'.png'));bpy.ops.render.render(write_still=True)
(OUT/'provenance.json').write_text(json.dumps({'roomId':room,'model':str(model),'modelSha256':hashlib.sha256(model.read_bytes()).hexdigest(),'textures':textures,'style':'Flat color and ink contours with existing local SD materials','maxProjectionErrorPixels':max(errors),'approved':False},indent=2))
print('FLAT_TACTICAL_COMPLETE '+room)
