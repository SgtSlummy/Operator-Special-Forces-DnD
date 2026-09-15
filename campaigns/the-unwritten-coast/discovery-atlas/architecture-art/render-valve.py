"""R02: a measured 4 x 6 x 5 ft service throat. Reuses locally generated SD surfaces.
Full and horizontal-section views are rendered from one scene, never separate AI plans.
"""
import bpy, math, json, bmesh
from pathlib import Path
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'art'/'architecture'
F=.3048
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
if any(d.type=='CUDA' for d in prefs.devices):
 for d in prefs.devices:d.use=d.type=='CUDA'
 scene.cycles.device='GPU'
scene.render.resolution_x=1600;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.world.color=(.08,.12,.14);scene.view_settings.view_transform='AgX'
def material(name,color,metal=0,image=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;bs=n.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=.55
 if image:
  tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(OUT/image),check_existing=True);tex.projection='BOX';tex.projection_blend=.2
  coord=n.new('ShaderNodeTexCoord');m.node_tree.links.new(coord.outputs['Generated'],tex.inputs['Vector'])
  if metal:
   mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.24;mix.inputs[1].default_value=(*color,1)
   m.node_tree.links.new(tex.outputs['Color'],mix.inputs[2]);m.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
  else:m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
 noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=65
 bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.18;bump.inputs['Distance'].default_value=.008
 m.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs['Normal'],bs.inputs['Normal']);return m
stone=material('Local SD harbor limestone',(.4,.4,.35),image='harbor-limestone.png')
brass=material('Local SD tidal brass',(.4,.25,.08),.65,'tidal-brass.png')
iron=material('Oxidized midnight iron',(.035,.065,.07),.6)
copper=material('Weathered copper jackets',(.24,.12,.045),.65)
slate=material('Deep tidal slate',(.027,.065,.07))
red=material('Worn red enamel',(.27,.035,.02),.3)
paper=material('Aged instruction enamel',(.68,.58,.34))
def finish(o,name,mat):o.name=name;o.data.materials.append(mat);return o
def box(name,pos,size,mat,bevel=.03):
 bpy.ops.mesh.primitive_cube_add(size=1,location=tuple(v*F for v in pos));o=finish(bpy.context.object,name,mat);o.dimensions=tuple(v*F for v in size);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  b=o.modifiers.new('Worn edges','BEVEL');b.width=bevel*F;b.segments=3;o.modifiers.new('Normals','WEIGHTED_NORMAL')
 return o
def cylinder(name,pos,radius,depth,mat,rot=(0,0,0),vertices=48):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius*F,depth=depth*F,location=tuple(v*F for v in pos),rotation=rot);o=finish(bpy.context.object,name,mat)
 b=o.modifiers.new('Machined edges','BEVEL');b.width=.012*F;b.segments=3
 for p in o.data.polygons:p.use_smooth=True
 return o
def tube(name,points,radius,mat):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=radius*F;c.bevel_resolution=4
 s=c.splines.new('POLY');s.points.add(len(points)-1)
 for p,v in zip(s.points,points):p.co=(*(a*F for a in v),1)
 o=bpy.data.objects.new(name,c);scene.collection.objects.link(o);o.data.materials.append(mat);return o
box('Foundation',(2,3,-.2),(4.4,6.4,.4),slate)
for x in range(4):
 for y in range(6):box('Worn floor flag',(x+.5,y+.5,-.015),(.97,.97,.12),stone)
for course in range(5):
 for y in range(6):box('West damp masonry',(-.15,y+.5,course+.5),(.3,.98,.97),stone)
 for x in range(4):
  if x in [1,2] and course<3:continue
  box('North masonry',(x+.5,6.15,course+.5),(.98,.3,.97),stone)
box('West ceiling edge',(-.15,3,5.03),(.4,6.4,.16),stone)
box('North ceiling edge',(2,6.15,5.03),(4.4,.4,.16),stone)
box('East cut sill',(4.1,3,.12),(.2,6,.24),stone)
for x in [.35,3.65]:box('South entrance sill',(x,-.1,.12),(.7,.2,.24),stone)
# Oversized longitudinal pipe and a smaller opposing jacket leave a crooked crouching route.
cylinder('Immense west pipe',(.48,3,2.8),.72,6,copper,(math.pi/2,0,0))
cylinder('East return pipe',(3.73,3,3.45),.42,6,iron,(math.pi/2,0,0))
for y in [.65,2.2,4.5,5.45]:
 cylinder('West bolted flange',(.48,y,2.8),.83,.14,brass,(math.pi/2,0,0))
 for i in range(10):
  a=i*math.tau/10;cylinder('Flange bolt',(.48+math.cos(a)*.77,y-.10,2.8+math.sin(a)*.77),.045,.10,iron,(math.pi/2,0,0),6)
 cylinder('Return collar',(3.73,y,3.45),.47,.15,brass,(math.pi/2,0,0))
 box('Pipe saddle',(.45,y,1.23),(.6,.35,1.35),iron)
# Public plate and lever align with the current catalog normalized coordinates.
box('Maintenance inscription plate',(1.2,2.4,3.15),(.045,1.05,.72),paper)
for y in [2.0,2.8]:
 for z in [2.9,3.4]:cylinder('Inscription fastener',(1.24,y,z),.028,.04,brass,(0,math.pi/2,0),8)
for i in range(4):box('Engraved public instruction line',(1.227,2.4,3.37-i*.14),(.006,.73-i*.045,.017),iron,0)
tube('Visible lever cable',[(2.92,3.9,2.2),(3.3,4.15,2.3),(3.45,5.7,2.5),(2.6,5.86,2.6)],.025,brass)
box('Hatch control pedestal',(2.92,3.9,1.3),(.3,.35,2.6),iron)
cylinder('Reachable hatch lever pivot',(2.92,3.9,2.2),.13,.22,brass,(math.pi/2,0,0))
tube('Reachable hatch lever',[(2.92,3.9,2.2),(2.65,3.4,2.75)],.055,iron)
cylinder('Red lever grip',(2.65,3.4,2.75),.095,.38,red,(math.pi/2,0,0))
# North hatch is open enough to read as an exit; dark beyond contains no invented room.
box('Dark hatch threshold',(2,6.18,1.4),(1.9,.08,2.8),slate)
for x in [1,3]:box('Hatch jamb',(x,5.97,1.45),(.14,.22,2.9),brass)
box('Hatch lintel',(2,5.97,2.94),(2.15,.22,.15),brass)
box('Unoccupied presentation ground',(2,3,-.55),(80,80,.2),slate,0)
for name,pos,energy,color,size in [('Warm inspection lamp',(2,1,7),80,(1,.64,.28),2),('Coastal fill',(7,-5,8),160,(.62,.79,1),4),('Soft overhead',(1,4,9),100,(1,.9,.7),3)]:
 light=bpy.data.lights.new(name,'AREA');light.energy=energy;light.color=color;light.size=size
 o=bpy.data.objects.new(name,light);scene.collection.objects.link(o);o.location=tuple(v*F for v in pos);o.rotation_euler=(Vector((2*F,3*F,1.5*F))-o.location).to_track_quat('-Z','Y').to_euler()
camdata=bpy.data.cameras.new('Room camera');cam=bpy.data.objects.new('Room camera',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.type='ORTHO'
views={}
def render(name,pos,target,scale):
 cam.location=tuple(v*F for v in pos);cam.rotation_euler=(Vector(tuple(v*F for v in target))-cam.location).to_track_quat('-Z','Y').to_euler();camdata.ortho_scale=scale*F;bpy.context.view_layer.update()
 def point(x,y,z):
  p=world_to_camera_view(scene,cam,Vector((x*F,y*F,z*F)));return [round(p.x*1600,4),round((1-p.y)*1200,4)]
 views[name]={'width':1600,'height':1200,'origin':point(0,0,0),'xAxis':point(4,0,0),'yAxis':point(0,6,0),'zAxis':point(0,0,5)}
 scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
render('r02-cutaway',(10,-12,12),(1.8,3,2),12)
model=Path.home()/'Projects'/'Unwritten-Coast-Data'/'architecture'/'r02-valve-throat.blend';bpy.ops.wm.save_as_mainfile(filepath=str(model))
# One exact 2.5-foot plane through the saved room, not another floor.
bpy.ops.object.select_all(action='DESELECT')
for obj in list(scene.objects):
 if obj.type not in {'MESH','CURVE'} or obj.name=='Unoccupied presentation ground':continue
 bpy.context.view_layer.objects.active=obj;obj.select_set(True)
 if obj.type=='CURVE':bpy.ops.object.convert(target='MESH')
 mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()));mesh.transform(obj.matrix_world);obj.modifiers.clear();obj.data=mesh;obj.matrix_world=Matrix.Identity(4)
 bm=bmesh.new();bm.from_mesh(mesh);cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,2.5*F),plane_no=(0,0,1),clear_outer=True)
 edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
 if edges:bmesh.ops.holes_fill(bm,edges=edges,sides=0)
 bm.to_mesh(mesh);bm.free();obj.select_set(False)
render('r02-floor-slice',(2,3,18),(2,3,0),10)
render('r02-low-cutaway',(10,-12,12),(1.8,3,.6),10)
metadata={'roomId':'R02','name':'Valve Throat','dimensionsFeet':{'width':4,'depth':6,'height':5},'horizontalSectionFeet':2.5,'views':views,'features':[{'id':'R02-a','name':'Maintenance inscription','x':.3,'y':.4,'z':3.15/5},{'id':'R02-b','name':'Reachable hatch lever','x':.73,'y':.65,'z':2.2/5}],'generator':'Blender 4.5.9 Cycles with existing local Stable Diffusion surface images','limits':['One occupied level; horizontal sections are views of the same room.','Schematic connection beyond the hatch is intentionally not illustrated.','No discoveries, secret content or resolved checks are painted into the room.']}
(OUT/'r02-projection.json').write_text(json.dumps(metadata,indent=2),encoding='utf8')
print('R02_ARCHITECTURE_COMPLETE')
