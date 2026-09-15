"""Flat-color illustrated R05 candidate from measured geometry and local SD textures."""
import bpy,bmesh,json
from pathlib import Path
from mathutils import Vector,Matrix
DATA=Path.home()/'Projects'/'Unwritten-Coast-Data'
OUT=DATA/'art-candidates'/'caretaker-flat'/'flat-materials-v2'
OUT.mkdir(parents=True,exist_ok=True)
if any(OUT.iterdir()):raise RuntimeError('Candidate exists; inspect instead of overwriting.')
bpy.ops.wm.open_mainfile(filepath=str(DATA/'architecture'/'r05-caretaker-flat.blend'))
s=bpy.context.scene;F=.3048
# Resolve the approved material explicitly after moving a blend between folders.
for image in bpy.data.images:
 if Path(image.filepath).name=='harbor-limestone.png':
  image.filepath=str(Path(__file__).resolve().parent.parent/'art'/'architecture'/'harbor-limestone.png');image.reload()
# Emit the existing painted colors directly: no specular shading or cast shadows.
for m in bpy.data.materials:
 if not m.use_nodes:continue
 nodes=m.node_tree.nodes;links=m.node_tree.links
 bs=nodes.get('Principled BSDF');out=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
 if not bs or not out:continue
 color=bs.inputs['Base Color'];em=nodes.new('ShaderNodeEmission');em.inputs['Strength'].default_value=1
 if color.is_linked:links.new(color.links[0].from_socket,em.inputs['Color'])
 else:em.inputs['Color'].default_value=color.default_value
 links.new(em.outputs[0],out.inputs['Surface'])
s.render.engine='CYCLES';s.cycles.samples=8;s.view_settings.view_transform='Standard'
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
if any(d.type=='CUDA' for d in prefs.devices):
 for d in prefs.devices:d.use=d.type=='CUDA'
 s.cycles.device='GPU'
for o in list(s.objects):
 if o.type not in {'MESH','CURVE'} or o.name=='Ground':continue
 bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=o;o.select_set(True)
 if o.type=='CURVE':bpy.ops.object.convert(target='MESH')
 mesh=bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()));mesh.transform(o.matrix_world);o.modifiers.clear();o.data=mesh;o.matrix_world=Matrix.Identity(4)
 bm=bmesh.new();bm.from_mesh(mesh);cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,4*F),plane_no=(0,0,1),clear_outer=True)
 edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
 if edges:bmesh.ops.holes_fill(bm,edges=edges,sides=0)
 bm.to_mesh(mesh);bm.free()
cam=s.camera;cam.location=(5.5*F,8.5*F,35*F);cam.rotation_euler=(Vector((5.5*F,8.5*F,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=25*F
s.render.use_freestyle=True
style=s.view_layers[0].freestyle_settings.linesets[0].linestyle;style.color=(.065,.08,.065);style.thickness=1.1
s.render.filepath=str(OUT/'r05-flat-floor.png');bpy.ops.render.render(write_still=True)
(OUT/'provenance.json').write_text(json.dumps({'room':'R05','style':'flat emitted local SD materials with ink contours','camera':'unchanged floor slice','approved':False},indent=2))
print('FLAT_ROOM_COMPLETE')
