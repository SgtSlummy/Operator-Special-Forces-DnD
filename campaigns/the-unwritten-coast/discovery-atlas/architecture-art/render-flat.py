"""Measured R05 domestic L: one model, three views, existing local SD masonry."""
import bpy, math, json, bmesh
from pathlib import Path
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view
OUT=Path(__file__).resolve().parent.parent/'art'/'architecture'
MODEL=Path.home()/'Projects'/'Unwritten-Coast-Data'/'architecture'/'r05-caretaker-flat.blend'
if MODEL.exists() or any((OUT/(n+'.png')).exists() for n in ['r05-cutaway','r05-floor-slice','r05-low-cutaway']):
 raise RuntimeError('Existing R05 artifacts require explicit review before replacement')
F=.3048
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=48;s.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
if any(d.type=='CUDA' for d in prefs.devices):
 for d in prefs.devices:d.use=d.type=='CUDA'
 s.cycles.device='GPU'
s.render.resolution_x=1600;s.render.resolution_y=1200;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='AgX';s.world.color=(.08,.12,.15)
def mat(name,color,metal=0,image=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;b=n.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=.65
 noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=45
 bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.18;bump.inputs['Distance'].default_value=.006;m.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs['Normal'],b.inputs['Normal'])
 if image:
  tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(OUT/image));tex.projection='BOX';tex.projection_blend=.2;coord=n.new('ShaderNodeTexCoord');m.node_tree.links.new(coord.outputs['Generated'],tex.inputs['Vector']);m.node_tree.links.new(tex.outputs['Color'],b.inputs['Base Color'])
 return m
stone=mat('Existing local SD harbor limestone',(.4,.4,.35),image='harbor-limestone.png')
wood=mat('Oiled brown oak',(.19,.085,.03));dark=mat('Tidal charcoal',(.025,.055,.06));cloth=mat('Faded sea green wool',(.07,.19,.18));linen=mat('Worn flax linen',(.58,.48,.30));rust=mat('Rust red woven patch',(.30,.065,.035));cream=mat('Glazed cream stoneware',(.72,.61,.40));iron=mat('Blackened kettle iron',(.045,.065,.065),.55);paper=mat('Folded visitor paper',(.63,.52,.31))
def box(name,pos,size,m,bevel=.035):
 bpy.ops.mesh.primitive_cube_add(size=1,location=tuple(v*F for v in pos));o=bpy.context.object;o.name=name;o.dimensions=tuple(v*F for v in size);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bevel:
  mod=o.modifiers.new('Soft worn edges','BEVEL');mod.width=bevel*F;mod.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o
def cyl(name,pos,r,depth,m,rot=(0,0,0)):
 bpy.ops.mesh.primitive_cylinder_add(vertices=40,radius=r*F,depth=depth*F,location=tuple(v*F for v in pos),rotation=rot);o=bpy.context.object;o.name=name;o.data.materials.append(m)
 for p in o.data.polygons:p.use_smooth=True
 return o
def tube(name,pts,r,m):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r*F;c.bevel_resolution=3;sp=c.splines.new('POLY');sp.points.add(len(pts)-1)
 for p,v in zip(sp.points,pts):p.co=(*(a*F for a in v),1)
 o=bpy.data.objects.new(name,c);s.collection.objects.link(o);o.data.materials.append(m)
# Southeast recess produces the authored L; neither a hidden room nor another floor.
box('West foundation',(3.5,8.5,-.25),(7.4,17.4,.5),dark)
box('East foundation',(9,11,-.25),(4,12,.5),dark)
for y in range(17):
 for x in range(11):
  if x>=7 and y<5:continue
  box('Individual oak floorboard',(x+.5,y+.5,.01),(.98,.98,.10),wood,.012)
for z in range(8):
 for y in range(17):box('West masonry',(-.16,y+.5,z+.5),(.32,.98,.98),stone)
 for x in range(11):
  if 2<=x<=5 and 3<=z<=5:continue
  box('North masonry',(x+.5,17.16,z+.5),(.98,.32,.98),stone)
for pos,size in [((11.12,11,.18),(.24,12,.36)),((9,4.88,.18),(4,.24,.36)),((7.12,2.5,.18),(.24,5,.36)),((1.2,-.12,.18),(2.4,.24,.36)),((5.8,-.12,.18),(2.4,.24,.36))]:box('Cut wall sill',pos,size,stone)
box('Harbor window shadow',(4,17.29,4.5),(4,.06,3),dark)
for x in [2,4,6]:box('Window mullion',(x,17.02,4.5),(.10,.20,3.2),wood)
for z in [3,6]:box('Window horizontal frame',(4,17.02,z),(4.2,.24,.12),wood)
box('Wide window ledge',(4,16.8,2.94),(4.5,.6,.13),wood)
# Bunk, pillow and loosely draped blanket leave an open central walking route.
for x in [.65,3.05]:
 for y in [9.8,16.1]:box('Bunk post',(x,y,1.4),(.18,.18,2.8),wood)
box('Bunk oak frame',(1.85,12.95,.9),(2.8,6.8,.4),wood)
box('Stuffed mattress',(1.85,12.95,1.3),(2.55,6.55,.5),linen,.16)
box('Faded wool blanket',(1.85,12.25,1.59),(2.58,5,.11),cloth,.08)
box('Flax pillow',(1.85,15.45,1.68),(1.8,.9,.35),linen,.16)
for y in [10.1,10.4,10.7]:box('Blanket woven band',(1.85,y,1.65),(2.55,.045,.015),cream,.002)
box('Mended wool rug',(5,10,.10),(3.2,4.9,.055),cloth,.01)
for pos,size,m in [((4,9,.14),(.65,.8,.025),rust),((5.7,11.4,.14),(.6,.65,.025),linen)]:box('Visible old rug patch',pos,size,m,.005)
for x in [3.5+i*.16 for i in range(20)]:
 for y in [7.42,12.58]:tube('Rug fringe',[(x,y,.12),(x+.04,y+(.2 if y>10 else -.2),.12)],.012,linen)
# Tea table centers the existing R05-a floor anchor (3.3, 6.8).
for x in [2.2,4.4]:
 for y in [6.1,7.5]:box('Tea table leg',(x,y,1.2),(.16,.16,2.4),wood)
box('Tea table top',(3.3,6.8,2.47),(2.6,1.85,.16),wood)
cyl('Kettle body',(3.3,6.8,2.91),.31,.65,iron);cyl('Kettle lid',(3.3,6.8,3.25),.34,.06,iron)
tube('Kettle handle',[(3,6.8,3.1),(3,6.8,3.65),(3.6,6.8,3.65),(3.6,6.8,3.1)],.045,iron)
tube('Kettle spout',[(3.55,6.8,2.9),(3.9,6.8,3.2)],.085,iron)
for x,y in [(2.55,6.5),(4.08,7.1)]:
 cyl('Stoneware mug',(x,y,2.76),.14,.40,cream);cyl('Dark tea surface',(x,y,2.965),.115,.008,dark)
 tube('Mug handle',[(x+.12,y,2.88),(x+.28,y,2.88),(x+.28,y,2.66),(x+.12,y,2.66)],.026,cream)
for x,y in [(3.4,5.1),(5.35,6.9)]:
 cyl('Small stool seat',(x,y,1.4),.48,.15,wood)
 for a in [0,math.tau/3,math.tau*2/3]:box('Stool leg',(x+math.cos(a)*.3,y+math.sin(a)*.3,.7),(.12,.12,1.4),wood)
# Visitor paper is an observable object, without readable solution text.
box('Narrow writing stand',(8.03,11.05,1.35),(1.9,1.5,2.7),wood)
box('Folded visitor directions',(8.03,11.05,2.73),(.65,.85,.025),paper,.003)
for i in range(3):box('Unreadable ink strokes',(8.03,10.85+i*.13,2.75),(.39,.018,.004),iron,0)
for i in range(4):box('Stacked domestic books',(9.4,15.6,.18+i*.19),(1.0,.8,.17),rust if i%2 else linen)
box('Ground',(5.5,8.5,-.65),(90,90,.2),dark,0)
for name,pos,power,col,size in [('Warm room',(3,5,12),380,(1,.70,.40),7),('Window fill',(4,18,6),190,(.45,.70,1),4),('Soft fill',(18,-9,17),600,(.75,.85,1),10)]:
 light=bpy.data.lights.new(name,'AREA');light.energy=power;light.color=col;light.size=size;o=bpy.data.objects.new(name,light);s.collection.objects.link(o);o.location=tuple(v*F for v in pos);o.rotation_euler=(Vector((5*F,9*F,2*F))-o.location).to_track_quat('-Z','Y').to_euler()
c=bpy.data.cameras.new('Room camera');cam=bpy.data.objects.new('Room camera',c);s.collection.objects.link(cam);s.camera=cam;c.type='ORTHO';views={}
def render(name,pos,target,scale):
 cam.location=tuple(v*F for v in pos);cam.rotation_euler=(Vector(tuple(v*F for v in target))-cam.location).to_track_quat('-Z','Y').to_euler();c.ortho_scale=scale*F;bpy.context.view_layer.update()
 def point(x,y,z):
  v=world_to_camera_view(s,cam,Vector((x*F,y*F,z*F)));return [round(v.x*1600,4),round((1-v.y)*1200,4)]
 views[name]={'width':1600,'height':1200,'origin':point(0,0,0),'xAxis':point(11,0,0),'yAxis':point(0,17,0),'zAxis':point(0,0,8)}
 s.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
render('r05-cutaway',(27,-29,30),(5.5,8.5,2.5),31)
bpy.ops.wm.save_as_mainfile(filepath=str(MODEL))
for o in list(s.objects):
 if o.type not in {'MESH','CURVE'} or o.name=='Ground':continue
 bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=o;o.select_set(True)
 if o.type=='CURVE':bpy.ops.object.convert(target='MESH')
 mesh=bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()));mesh.transform(o.matrix_world);o.modifiers.clear();o.data=mesh;o.matrix_world=Matrix.Identity(4)
 bm=bmesh.new();bm.from_mesh(mesh);cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,4*F),plane_no=(0,0,1),clear_outer=True);edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
 if edges:bmesh.ops.holes_fill(bm,edges=edges,sides=0)
 bm.to_mesh(mesh);bm.free()
render('r05-floor-slice',(5.5,8.5,35),(5.5,8.5,0),25)
render('r05-low-cutaway',(27,-29,30),(5.5,8.5,1),29)
meta={'roomId':'R05','name':'Caretaker’s Flat','dimensionsFeet':{'width':11,'depth':17,'height':8},'horizontalSectionFeet':4,'floorPolygonFeet':[[0,0],[7,0],[7,5],[11,5],[11,17],[0,17]],'views':views,'features':[{'id':'R05-a','name':'Kettle and two mugs','x':.3,'y':.4,'z':2.55/8},{'id':'R05-b','name':'Visitor directions note','x':.73,'y':.65,'z':2.75/8}],'generator':'Blender 4.5.9 Cycles with existing local Stable Diffusion limestone','limits':['One domestic L-shaped level; sections are not extra floors.','Window is a dark opening; no undiscovered harbor layout or solution text is painted.']}
(OUT/'r05-projection.json').write_text(json.dumps(meta,indent=2),encoding='utf8')
print('R05_ARCHITECTURE_COMPLETE')
