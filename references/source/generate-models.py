"""Original Crown & Dust low-poly miniatures. Run with Blender 4.3+ in background.
Models face -Y in Blender, +Z in glTF. z=0 is the bottom of each miniature.
All art, geometry, palettes, and names authored for this prototype.
"""
import bpy, math, os, sys, json
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, 'assets', 'models')
PORTRAITS = os.path.join(ROOT, 'assets', 'portraits')
os.makedirs(MODELS, exist_ok=True); os.makedirs(PORTRAITS, exist_ok=True)
with open(os.path.join(ROOT, 'assets', 'art-direction.json')) as art_file:
    ART_DIRECTION = json.load(art_file)
P = ART_DIRECTION['model']['palette']
def mat(name):
    if name in bpy.data.materials: return bpy.data.materials[name]
    material = bpy.data.materials.new(name); material.use_nodes = True
    h=P.get(name,name)
    def linear(value):
        v=value/255
        return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
    c=tuple(linear(int(h[i:i+2],16)) for i in (0,2,4))+(1,)
    material.diffuse_color=c
    bs=material.node_tree.nodes.get('Principled BSDF'); bs.inputs['Base Color'].default_value=c
    bs.inputs['Roughness'].default_value=ART_DIRECTION['model'].get('metalRoughness',.38) if name in ART_DIRECTION['model']['metalNames'] else ART_DIRECTION['model']['roughness']
    bs.inputs['Metallic'].default_value=ART_DIRECTION['model']['metallic'] if name in ART_DIRECTION['model']['metalNames'] else 0
    return material
root=None
parts=[]
def finish(obj,name,color,parent=None):
    obj.name=name; obj.data.materials.append(mat(color)); obj.parent=parent or root;parts.append(obj);return obj

def cube(name,loc,scale,color,bevel=.05,parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o=bpy.context.object;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        m=o.modifiers.new('Soft carved edges','BEVEL'); m.width=bevel;m.segments=1
        bpy.ops.object.modifier_apply(modifier=m.name)
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return finish(o,name,color,parent)

def ball(name,loc,scale,color,ico=True,parent=None):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2 if ico else 1,radius=1,location=loc)
    o=bpy.context.object;o.scale=scale;return finish(o,name,color,parent)

def cyl(name,loc,radius,depth,color,vertices=10,r2=None,parent=None):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    else: bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=radius,radius2=r2,depth=depth,location=loc)
    return finish(bpy.context.object,name,color,parent)

def rod(name,a,b,radius,color,parent=None,r2=None):
    a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,radius,(b-a).length,color,8,r2,parent)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def mesh(name,verts,faces,color,parent=None):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);return finish(o,name,color,parent)

def pivot(name,loc,children):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=root;o.location=loc
    bpy.context.view_layer.update()
    for c in children:
        world=c.matrix_world.copy();c.parent=o;c.matrix_world=world
    return o

def base():
    cyl('Pedestal',(0,0,.045),.56,.09,'black',32)
    cyl('PedestalRim',(0,0,.087),.54,.03,'gold',32)
    cyl('PedestalTop',(0,0,.11),.51,.03,'darksteel',32)

def eyes(z=1.75, y=-.215, wide=.10):
    for s in [-1,1]:
        cube('Eye', (s*wide,y,z),(.045,.018,.045),'black',.005)

def humanoid(body='blue',skin='pale',armor=False):
    base()
    for s in [-1,1]:
        cube('Boot',(.18*s,-.07,.23),(.23,.40,.24),'brown',.035)
        cube('Leg',(.18*s,0,.56),(.22,.24,.48),'darksteel' if armor else body,.03)
        if armor: cube('Knee',(.18*s,-.14,.64),(.23,.09,.20),'steel',.03)
    cyl('Coat',(0,0,.85),.36,.32,body,8,r2=.29)
    cube('Torso',(0,0,1.13),(.65,.37,.50),'steel' if armor else body,.06)
    cube('Belt',(0,-.01,.91),(.66,.4,.08),'brown',.01)
    cube('Buckle',(0,-.225,.91),(.12,.04,.11),'gold',.01)
    cyl('Neck',(0,0,1.48),.12,.18,skin)
    ball('Head',(0,-.015,1.72),(.25,.24,.29),skin)
    eyes()
    for s,side in [(-1,'Left'),(1,'Right')]:
        start=len(parts)
        ball(side+'Shoulder',(.40*s,0,1.30),(.19,.22,.20),'steel' if armor else body)
        rod(side+'UpperArm',(.42*s,0,1.28),(.49*s,-.025,.99),.11,body)
        rod(side+'Forearm',(.49*s,-.025,1.03),(.47*s,-.15,.82),.12,'darksteel' if armor else body)
        ball(side+'Hand',(.47*s,-.15,.80),(.12,.12,.13),skin)
        pivot(side+'Arm',(.40*s,0,1.32),parts[start:])

def cape(color):
    mesh('Cape',[(-.28,.21,1.40),(.28,.21,1.40),(.42,.36,.39),(-.42,.36,.39),(0,.45,.75)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],color)

def crown(z=2.0):
    cyl('CrownBand',(0,-.015,z),.255,.10,'gold',12)
    for i in range(5):
        a=i*2*math.pi/5
        cyl('CrownPoint',(.22*math.cos(a),.22*math.sin(a)-.015,z+.10),.06,.19,'gold',4,r2=0)
    ball('CrownGem',(0,-.274,z),(.044,.025,.04),'red',False)

def blade(x=.48,y=-.25,z=1.25,parent_name='RightArm'):
    parent=bpy.data.objects.get(parent_name)
    start=len(parts)
    rod('SwordGrip',(x,y,.72),(x,y,1.01),.04,'brown')
    cube('SwordGuard',(x,y,1.02),(.31,.08,.055),'gold',.015)
    mesh('Blade',[(x-.055,y-.025,1.05),(x+.055,y-.025,1.05),(x+.055,y+.025,1.05),(x-.055,y+.025,1.05),(x,y,1.76)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(0,3,2,1)],'steel')
    if parent:
        bpy.context.view_layer.update()
        for o in parts[start:]: world=o.matrix_world.copy();o.parent=parent;o.matrix_world=world

def shield(color='blue'):
    start=len(parts)
    verts=[(-.75,-.32,1.35),(-.22,-.32,1.35),(-.22,-.32,1.02),(-.48,-.32,.75),(-.75,-.32,1.02),(-.48,-.41,1.13)]
    mesh('Shield',verts,[(0,1,5),(1,2,5),(2,3,5),(3,4,5),(4,0,5)],color)
    rod('ShieldCross',(-.48,-.425,.91),(-.48,-.425,1.27),.025,'gold')
    rod('ShieldCross',(-.65,-.425,1.15),(-.31,-.425,1.15),.025,'gold')
    parent=bpy.data.objects.get('LeftArm')
    bpy.context.view_layer.update()
    for o in parts[start:]: world=o.matrix_world.copy();o.parent=parent;o.matrix_world=world

def knight(who):
    humanoid('red' if who=='arthur' else 'blue',armor=True)
    cape('red' if who=='arthur' else 'blue')
    if who=='arthur':
        ball('Hair',(0,.06,1.85),(.255,.21,.23),'brown');crown(2.01)
        cube('Beard',(0,-.21,1.55),(.27,.10,.22),'brown',.05)
    else:
        cube('GreatHelm',(0,0,1.79),(.64,.55,.61),'steel',.085)
        # A broad T-shaped visor keeps the old project's knight silhouette.
        cube('VisorSlit',(0,-.279,1.85),(.46,.018,.075),'black',.008)
        cube('VisorStem',(0,-.279,1.69),(.09,.018,.31),'black',.008)
        for side in [-1,1]:
            ball('HelmRivet',(.26*side,-.267,1.71),(.026,.018,.026),'gold',False)
        for x in [-.045,0,.045]:
            mesh('BluePlume',[(x,-.12,2.09),(x,-.14,2.42),(x,.05,2.48),(x,.35,2.31),(x,.34,2.04)],[(0,1,2,3,4)],'blue')
    for side in [-1,1]:
        cube('ArmoredBoot',(.18*side,-.08,.27),(.25,.43,.20),'steel',.04)
        cube('BreastTrim',(.18*side,-.204,1.12),(.026,.02,.30),'gold',.005)
    blade();shield('red' if who=='arthur' else 'blue')

def queen(fae=False):
    humanoid('green' if fae else 'purple');cape('moss' if fae else 'red')
    cyl('Gown',(0,0,.66),.43,1.02,'green' if fae else 'purple',10,r2=.25)
    for s in [-1,1]:
        rod('Hair',(s*.20,.04,1.87),(s*.25,.07,1.30),.11,'cream' if fae else 'brown')
    crown(1.99)
    parent=bpy.data.objects.get('RightArm');start=len(parts)
    rod('Staff',(.49,-.17,.20),(.49,-.17,1.90),.035,'brown')
    ball('StaffCrystal',(.49,-.17,1.92),(.11,.11,.17),'leaf' if fae else 'purple',False)
    if fae:
        for s in [-1,1]:
            rod('Antler',(s*.16,0,2.05),(s*.37,.02,2.35),.026,'gold',r2=.008)
            rod('AntlerTip',(s*.28,.01,2.20),(s*.17,.02,2.35),.018,'gold',r2=0)
            mesh('Petal',[(0,.18,1.35),(s*.65,.28,1.65),(s*.51,.29,.77),(0,.22,.87)],[(0,1,2,3)],'leaf')
    else:
        ball('Rose',(-.48,-.22,1.00),(.11,.11,.11),'red')
    bpy.context.view_layer.update()
    for o in parts[start:start+2]:
        world=o.matrix_world.copy();o.parent=parent;o.matrix_world=world

def cowboy(who):
    cloth={'sheriff':'copper','outlaw':'red','sage':'purple'}[who]
    humanoid(cloth,skin='skin' if who!='sage' else 'pale')
    cape('brown' if who=='sheriff' else cloth)
    ball('Hair',(0,.065,1.80),(.255,.22,.25),'black')
    cyl('HatBrim',(0,0,1.96),.43,.055,'brown',16)
    cyl('HatTop',(0,0,2.075),.25,.23,'brown',10,r2=.22)
    cyl('HatBand',(0,0,2.0),.252,.055,'gold' if who=='sheriff' else 'cream',10)
    mesh('Bandana',[(-.18,-.23,1.46),(.18,-.23,1.46),(0,-.24,1.19)],[(0,1,2)],'red' if who!='outlaw' else 'black')
    if who=='sheriff':
        vs=[]
        for i in range(10):
            a=i*math.pi/5; r=.09 if i%2==0 else .04;vs.append((-.18+r*math.sin(a),-.209,1.23+r*math.cos(a)))
        mesh('Badge',vs,[tuple(range(10))],'gold')
        # Lasso loop oriented in the plane facing the player.
        bpy.ops.mesh.primitive_torus_add(major_segments=16,minor_segments=5,location=(.52,-.2,.89),major_radius=.18,minor_radius=.018,rotation=(math.pi/2,0,0));finish(bpy.context.object,'Lasso','gold')
    elif who=='outlaw':
        cube('FaceCover',(0,-.22,1.63),(.35,.08,.14),'red',.02)
        blade()
    else:
        rod('Wand',(.47,-.15,.82),(.55,-.18,1.54),.025,'gold')
        ball('WandStar',(.55,-.18,1.60),(.11,.06,.13),'purple',False)
        for s in [-1,1]:
            ball('SilverHair',(.21*s,.08,1.56),(.09,.12,.30),'cream')

def golem():
    base()
    for s in [-1,1]:
        cube('StoneFoot',(.25*s,-.03,.27),(.34,.43,.3),'stone',.06)
        ball('StoneLeg',(.25*s,0,.65),(.21,.23,.34),'stone')
    ball('StoneTorso',(0,0,1.08),(.51,.32,.48),'lightstone')
    cube('ChestRune',(0,-.33,1.1),(.11,.035,.26),'gold',.02)
    cube('StoneHead',(0,0,1.69),(.60,.48,.48),'stone',.09)
    for s in [-1,1]:
        cube('GlowingEye',(.13*s,-.25,1.73),(.10,.025,.045),'gold',.01)
        start=len(parts)
        ball('StoneShoulder',(.57*s,.0,1.30),(.29,.29,.30),'stone')
        ball('StoneForearm',(.64*s,-.02,.91),(.24,.27,.32),'stone')
        ball('StoneFist',(.66*s,-.08,.65),(.25,.27,.23),'lightstone')
        pivot('LeftArm' if s<0 else 'RightArm',(.55*s,0,1.31),parts[start:])
    for x,y,z in [(-.21,-.03,1.97),(.26,.02,1.95),(-.35,0,1.40)]:
        ball('Moss',(x,y,z),(.16,.15,.055),'moss',False)
        cyl('Sprout',(x,y,z+.09),.04,.15,'leaf',5,r2=0)

def dragon():
    base()
    ball('Body',(0,.02,.82),(.40,.30,.49),'red')
    ball('Belly',(0,-.22,.79),(.27,.12,.36),'copper')
    for s in [-1,1]:
        ball('Haunch',(.29*s,.04,.44),(.23,.24,.28),'red')
        ball('Foot',(.30*s,-.14,.25),(.24,.31,.12),'red')
        for offset in [-.10,0,.10]:
            rod('Claw',(.30*s+offset,-.27,.25),(.30*s+offset,-.45,.21),.035,'cream',r2=0)
        start=len(parts)
        rod('Arm',(.30*s,-.03,1.0),(.50*s,-.25,.83),.09,'red')
        ball('Hand',(.5*s,-.25,.83),(.12,.12,.10),'red')
        pivot('LeftArm' if s<0 else 'RightArm',(.30*s,-.03,1.0),parts[start:])
        start=len(parts)
        verts=[(.21*s,.15,1.15),(.53*s,.17,1.91),(1.02*s,.18,1.57),(.83*s,.18,.92),(.47*s,.15,1.05)]
        mesh('WingMembrane',verts,[(0,1,2),(0,2,4),(4,2,3)],'orange')
        for a,b in [(0,1),(1,2),(2,3),(0,4)]:rod('WingBone',verts[a],verts[b],.028,'darksteel')
        pivot('LeftWing' if s<0 else 'RightWing',(.21*s,.15,1.15),parts[start:])
    rod('Neck',(0,-.03,1.10),(0,-.18,1.52),.18,'red',r2=.16)
    ball('Head',(0,-.22,1.62),(.25,.34,.23),'red')
    cube('Snout',(0,-.49,1.54),(.36,.38,.20),'red',.05)
    for s in [-1,1]:
        ball('Eye',(.205*s,-.36,1.70),(.04,.06,.045),'gold',False)
        rod('Horn',(.18*s,-.1,1.76),(.27*s,.05,2.00),.07,'cream',r2=0)
        ball('Nostril',(.10*s,-.689,1.59),(.023,.013,.023),'black',False)
    tail=[(0,.23,.65),(.25,.58,.36),(.52,.74,.25),(.72,.69,.36)]
    for i in range(3):rod('Tail',tail[i],tail[i+1],.13-i*.035,'red',r2=max(.01,.1-i*.04))
    for y,z in [(0,1.37),(.18,1.14),(.31,.88),(.51,.49)]:
        cyl('BackSpine',(0,y,z),.075,.19,'gold',5,r2=0)

def setup_render():
    sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.samples=48;sc.cycles.use_denoising=False
    sc.render.resolution_x=ART_DIRECTION['portrait']['width'];sc.render.resolution_y=ART_DIRECTION['portrait']['height'];sc.render.resolution_percentage=100
    sc.render.image_settings.file_format='PNG';sc.render.image_settings.color_mode='RGBA';sc.render.film_transparent=ART_DIRECTION['portrait']['transparent']
    sc.world.color=(.25,.25,.25);sc.view_settings.view_transform='AgX'
    for name,loc,power,size in [('Key',(-2,-3,5),190,4),('Fill',(3,-1,2),70,3),('Rim',(0,3,4),220,3)]:
        bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.name=name;light.data.energy=power;light.data.shape='DISK';light.data.size=size
        light.rotation_euler=(Vector((0,0,.15))-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=(.42,-.76,.46));camera=bpy.context.object
    camera.rotation_euler=(Vector((0,0,.15))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=ART_DIRECTION['portrait']['orthographicScale']
    sc.camera=camera

manifest=[]
ids=['arthur','guinevere','lancelot','sheriff','sage','outlaw','golem','fae','dragon']
if '--' in sys.argv:
    selected=sys.argv[sys.argv.index('--')+1:]
    if selected: ids=[i for i in ids if i in selected]
for ident in ids:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    parts=[];root=bpy.data.objects.new('Champion',None);bpy.context.collection.objects.link(root)
    if ident in ['arthur','lancelot']:knight(ident)
    elif ident=='guinevere':queen()
    elif ident=='fae':queen(True)
    elif ident in ['sheriff','sage','outlaw']:cowboy(ident)
    elif ident=='golem':golem()
    elif ident=='dragon':dragon()
    bpy.context.view_layer.update()
    root.scale=(ART_DIRECTION['model']['rootScale'],)*3
    # Export only model nodes (no camera, no lights); no texture dependencies.
    bpy.ops.object.select_all(action='DESELECT')
    for o in list(bpy.context.scene.objects):
        if o.type in ['MESH','EMPTY']:o.select_set(True)
    filename=os.path.join(MODELS,ident+'.glb')
    bpy.ops.export_scene.gltf(filepath=filename,export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_animations=False)
    setup_render();bpy.context.scene.render.filepath=os.path.join(PORTRAITS,ident+'.png');bpy.ops.render.render(write_still=True)
    vertices=sum(len(o.data.vertices) for o in parts)
    manifest.append({'id':ident,'model':'assets/models/'+ident+'.glb','portrait':'assets/portraits/'+ident+'.png','source':'scripts/generate-models.py','meters':True,'verticesBeforeModifiers':vertices,'animatedNodes':[o.name for o in bpy.context.scene.objects if o.type=='EMPTY' and o.name!='Champion']})
    print('FINISHED',ident,vertices,flush=True)
if len(ids)==9:
    with open(os.path.join(MODELS,'manifest.json'),'w') as f:json.dump({'version':1,'artDirection':'assets/art-direction.json','format':'glTF 2.0 binary','upAxis':'Y','forwardAxis':'+Z','art':'Original procedural low-poly miniatures','models':manifest},f,indent=2)
