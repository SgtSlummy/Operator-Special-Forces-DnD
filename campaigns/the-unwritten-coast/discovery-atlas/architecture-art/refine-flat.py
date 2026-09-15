"""Apply reviewed local SD grain to existing R05 geometry; preserve original artifacts."""
import bpy, bmesh, json, hashlib, math
from pathlib import Path
from mathutils import Vector, Matrix
DATA=Path.home()/'Projects'/'Unwritten-Coast-Data'
MODEL=DATA/'architecture'/'r05-caretaker-flat.blend'
TEXTURE=DATA/'approved-art'/'materials'/'caretaker-weathered-wood.png'
OUT=DATA/'art-candidates'/'caretaker-flat'/'material-pass'
OUT.mkdir(parents=True,exist_ok=True)
if any(OUT.iterdir()):raise RuntimeError('Material pass exists; review before replacement')
before=hashlib.sha256(MODEL.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(MODEL))
s=bpy.context.scene;F=.3048
m=bpy.data.materials['Oiled brown oak'];n=m.node_tree.nodes;l=m.node_tree.links;bs=n.get('Principled BSDF')
coord=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeMapping');mapping.inputs['Rotation'].default_value[2]=-math.pi/4;mapping.inputs['Scale'].default_value=(1,1,1)
tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(TEXTURE));tex.projection='BOX';tex.projection_blend=.2;l.new(coord.outputs['Generated'],mapping.inputs['Vector']);l.new(mapping.outputs['Vector'],tex.inputs['Vector'])
mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.85;mix.inputs[1].default_value=(.33,.18,.075,1);l.new(tex.outputs['Color'],mix.inputs[2]);l.new(mix.outputs[0],bs.inputs['Base Color'])
bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.26;bump.inputs['Distance'].default_value=.012;l.new(tex.outputs['Color'],bump.inputs['Height']);l.new(bump.outputs['Normal'],bs.inputs['Normal'])
# Per-board tonal variation does not alter geometry or discovery positions.
info=n.new('ShaderNodeObjectInfo');ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.65,.65,.65,1);ramp.color_ramp.elements[1].color=(1,1,1,1);l.new(info.outputs['Random'],ramp.inputs['Fac'])
variation=n.new('ShaderNodeMixRGB');variation.blend_type='MULTIPLY';variation.inputs[0].default_value=.45;l.new(mix.outputs[0],variation.inputs[1]);l.new(ramp.outputs['Color'],variation.inputs[2]);l.new(variation.outputs[0],bs.inputs['Base Color'])
cam=s.camera
s.render.filepath=str(OUT/'r05-cutaway.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'r05-caretaker-flat-materials.blend'))
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
(OUT/'provenance.json').write_text(json.dumps({'sourceModel':str(MODEL),'sourceSha256':before,'texture':str(TEXTURE),'textureSha256':hashlib.sha256(TEXTURE.read_bytes()).hexdigest(),'geometryChanged':False,'cameras':'Identical to render-flat.py','approved':False},indent=2),encoding='utf8')
print('R05_MATERIAL_PASS_COMPLETE')
