"""R07 Reflection Gallery: measured candidate model, local SD stone, no secret occupants."""
import bpy, math, json, bmesh
from pathlib import Path
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'art-candidates'/'reflection-gallery'/'revision-2'
MODEL=Path.home()/'Projects'/'Unwritten-Coast-Data'/'architecture'/'r07-reflection-gallery-v2.blend'
if MODEL.exists() or (OUT.exists() and any(OUT.iterdir())):raise RuntimeError('Gallery candidate already exists; review before replacement')
OUT.mkdir(parents=True,exist_ok=True);MODEL.parent.mkdir(parents=True,exist_ok=True)
F=.3048;W,H=2048,1024
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=48;s.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
if any(d.type=='CUDA' for d in prefs.devices):
 for device in prefs.devices:device.use=device.type=='CUDA'
 s.cycles.device='GPU'
s.render.resolution_x=W;s.render.resolution_y=H;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.view_settings.view_transform='AgX';s.world.color=(.09,.13,.16)
def mat(name,color,metal=0,rough=.55,image=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=rough
 if image:
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(image));t.projection='BOX';t.projection_blend=.2;c=m.node_tree.nodes.new('ShaderNodeTexCoord');m.node_tree.links.new(c.outputs['Generated'],t.inputs['Vector']);m.node_tree.links.new(t.outputs['Color'],b.inputs['Base Color'])
 return m
stone=mat('Local SD weathered harbor limestone',(.35,.4,.38),image=ROOT/'art'/'architecture'/'harbor-limestone.png')
floor=mat('Blue grey slate',(.13,.21,.23));dark=mat('Tidal charcoal',(.025,.045,.05));brass=mat('Aged brass fittings',(.4,.26,.08),.7,.3);mirror=mat('Polished silver mirror',(.82,.9,.93),1,.09);paper=mat('Ivory diagram paper',(.68,.61,.43));ink=mat('Faded dark ink',(.055,.07,.065));wood=mat('Local SD aged oak',(.2,.1,.04),image=Path.home()/'Projects'/'Unwritten-Coast-Data'/'approved-art'/'materials'/'caretaker-weathered-wood.png')
def box(name,pos,size,m,bevel=.04):
 bpy.ops.mesh.primitive_cube_add(size=1,location=tuple(v*F for v in pos));o=bpy.context.object;o.name=name;o.dimensions=tuple(v*F for v in size);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bevel:
  mod=o.modifiers.new('Worn edge','BEVEL');mod.width=bevel*F;mod.segments=2;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o
def cylinder(name,pos,r,depth,m,rot=(0,0,0)):
 bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=r*F,depth=depth*F,location=tuple(v*F for v in pos),rotation=rot);o=bpy.context.object;o.name=name;o.data.materials.append(m);return o
def stroke(name,points,m=ink,r=.018):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r*F;c.bevel_resolution=2;sp=c.splines.new('POLY');sp.points.add(len(points)-1)
 for p,v in zip(sp.points,points):p.co=(*(a*F for a in v),1)
 o=bpy.data.objects.new(name,c);s.collection.objects.link(o);o.data.materials.append(m)
box('Gallery foundation',(40,10,-.35),(80.7,20.7,.7),dark)
for x in range(0,80,2):
 for y in range(0,20,2):box('Slate floor tile',(x+1,y+1,.015),(1.97,1.97,.12),floor,.015)
for x in range(0,80,2):
 for z in range(0,12,2):box('North stone course',(x+1,20.2,z+1),(1.97,.4,1.97),stone)
box('South cut wall',(40,-.2,.3),(80,.4,.6),stone)
for x in [0,80]:
 for y in [3,17]:box('End wall cut',(x,y,.3),(.4,6,.6),stone)
for x in range(4,74,12):
 box('Pilaster',(x,19.65,5.7),(.9,.7,11.4),stone)
 for z in [.5,10.8]:box('Pilaster molding',(x,19.5,z),(1.3,1.1,.25),brass)
 box('Upper cornice',(x+5.5,19.65,11.5),(11,.7,.4),stone)
 # Adjustable upright mirror with visible pivots and feet. No reflected worker is authored.
 cx=x+5;cy=16.4
 for dx in [-2.3,2.3]:
  box('Mirror support',(cx+dx,cy,3.5),(.18,.18,7),brass)
  box('Mirror foot',(cx+dx,cy,.2),(.7,2,.25),dark)
 for z in [1.6,7.4]:box('Mirror horizontal frame',(cx,cy,z),(4.7,.25,.18),brass)
 for dx in [-2.2,2.2]:box('Mirror vertical frame',(cx+dx,cy,4.5),(.18,.25,5.9),brass)
 panel=box('Adjustable silver mirror',(cx,cy,4.5),(4.25,.08,5.6),mirror,.01);panel.rotation_euler.x=math.radians(-8)
 for dx in [-2.3,2.3]:cylinder('Mirror pivot',(cx+dx,cy,4.5),.24,.35,brass,(0,math.pi/2,0))
 # Ceiling mirrors exist in the saved model, removed for roofless architectural views.
 roof=box('Ceiling mirror panel',(cx,10,11.8),(7.5,12,.08),mirror,.01);roof.hide_render=True
for cx,cy in [(24,8),(58.4,13)]:
 for dx in [-2,2]:
  for dy in [-1,1]:box('Display table leg',(cx+dx,cy+dy,1.5),(.2,.2,3),wood)
 box('Display table top',(cx,cy,3.08),(4.8,2.8,.22),wood)
# Viewpoint diagrams at the authoritative floor anchor (24,8), not readable solutions.
for dx in [-1.15,.8]:
 box('Viewpoint diagram',(24+dx,8,3.21),(1.7,1.8,.02),paper,.002)
 stroke('Optical diagram rays',[(23.5+dx,7.5,3.225),(24+dx,8.4,3.225),(24.5+dx,7.6,3.225)])
 stroke('Diagram baseline',[(23.5+dx,7.5,3.225),(24.5+dx,7.6,3.225)])
cylinder('Brass diagram weight',(24.7,8.55,3.28),.12,.12,brass)
# Linked plate and separate paper, no legible solution or extra point of interest.
box('Linked dark display plate',(57.35,13,3.25),(1.7,1.9,.12),brass)
box('Silver display face',(57.35,13,3.32),(1.5,1.7,.03),mirror)
box('Unchanged paper copy',(59.5,13,3.21),(1.6,1.8,.02),paper,.002)
for i in range(4):
 stroke('Paper notation',[(58.9,12.5+i*.25,3.225),(59.9,12.5+i*.25,3.225)])
for x in [10,35,65]:
 box('Lantern pedestal',(x,3,1.9),(.8,.8,3.8),stone)
 glow=mat('Warm lantern glass '+str(x),(1,.43,.08));b=glow.node_tree.nodes.get('Principled BSDF');b.inputs['Emission Color'].default_value=(1,.32,.045,1);b.inputs['Emission Strength'].default_value=3
 box('Lantern glow',(x,3,4.5),(.55,.55,1),glow)
 for dx in [-.35,.35]:
  for dy in [-.35,.35]:box('Lantern iron corner',(x+dx,3+dy,4.5),(.055,.055,1.25),dark)
 for z in [3.85,5.1]:box('Lantern cap',(x,3,z),(.9,.9,.13),brass)
box('Ground',(40,10,-1),(200,150,.2),dark,0)
for x in [15,40,65]:
 light=bpy.data.lights.new('Warm gallery fill','AREA');light.energy=1700;light.color=(1,.78,.52);light.size=8;o=bpy.data.objects.new('Warm gallery fill',light);s.collection.objects.link(o);o.location=(x*F,5*F,18*F)
light=bpy.data.lights.new('Broad cool fill','AREA');light.energy=3200;light.color=(.55,.75,1);light.size=18;o=bpy.data.objects.new('Broad cool fill',light);s.collection.objects.link(o);o.location=(40*F,-12*F,28*F)
c=bpy.data.cameras.new('Gallery camera');cam=bpy.data.objects.new('Gallery camera',c);s.collection.objects.link(cam);s.camera=cam;c.type='ORTHO';views={}
def render(name,pos,target,scale):
 cam.location=tuple(v*F for v in pos);cam.rotation_euler=(Vector(tuple(v*F for v in target))-cam.location).to_track_quat('-Z','Y').to_euler();c.ortho_scale=scale*F;bpy.context.view_layer.update()
 def point(x,y,z):
  v=world_to_camera_view(s,cam,Vector((x*F,y*F,z*F)));return [round(v.x*W,4),round((1-v.y)*H,4)]
 views[name]={'width':W,'height':H,'origin':point(0,0,0),'xAxis':point(80,0,0),'yAxis':point(0,20,0),'zAxis':point(0,0,12)}
 s.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
render('r07-cutaway',(95,-95,95),(40,10,3),110)
bpy.ops.wm.save_as_mainfile(filepath=str(MODEL))
for o in list(s.objects):
 if o.type not in {'MESH','CURVE'} or o.name=='Ground':continue
 bpy.ops.object.select_all(action='DESELECT');bpy.context.view_layer.objects.active=o;o.select_set(True)
 if o.type=='CURVE':bpy.ops.object.convert(target='MESH')
 mesh=bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()));mesh.transform(o.matrix_world);o.modifiers.clear();o.data=mesh;o.matrix_world=Matrix.Identity(4)
 bm=bmesh.new();bm.from_mesh(mesh);cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,4*F),plane_no=(0,0,1),clear_outer=True);edges=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
 if edges:bmesh.ops.holes_fill(bm,edges=edges,sides=0)
 bm.to_mesh(mesh);bm.free()
render('r07-floor-slice',(40,10,100),(40,10,0),90)
render('r07-low-cutaway',(95,-95,95),(40,10,1),94)
meta={'roomId':'R07','name':'Reflection Gallery','dimensionsFeet':{'width':80,'depth':20,'height':12},'horizontalSectionFeet':4,'views':views,'features':[{'id':'R07-a','name':'Viewpoint diagrams','x':.3,'y':.4,'z':3.2/12},{'id':'R07-b','name':'Linked plate and paper copy','x':.73,'y':.65,'z':3.2/12}],'generator':'Blender 4.5.9 Cycles using existing local Stable Diffusion limestone and oak','limits':['Candidate architectural interpretation; rectangular bounding floor, optical fixtures vary in angle.','Ceiling mirrors retained in model but hidden for cutaway views.','No occupants, secret room layout, or legible puzzle solution rendered.']}
(OUT/'r07-projection.json').write_text(json.dumps(meta,indent=2),encoding='utf8')
print('R07_ARCHITECTURE_COMPLETE')
