"""Repair and embed approved R05 textures so moving its blend cannot break materials."""
import bpy,json,hashlib,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
DATA=Path.home()/'Projects'/'Unwritten-Coast-Data'
MODEL=DATA/'architecture'/'r05-caretaker-flat.blend'
BACKUP=Path.home()/'LocalFiles'/'UnwrittenCoast'/'architecture-backups'/'packed-materials-20260913'
BACKUP.mkdir(parents=True,exist_ok=False)
original=hashlib.sha256(MODEL.read_bytes()).hexdigest()
shutil.copy2(MODEL,BACKUP/MODEL.name)
bpy.ops.wm.open_mainfile(filepath=str(MODEL))
approved={'harbor-limestone.png':ROOT/'art'/'architecture'/'harbor-limestone.png','caretaker-weathered-wood.png':DATA/'approved-art'/'materials'/'caretaker-weathered-wood.png'}
report=[]
for image in bpy.data.images:
 if image.source!='FILE':continue
 name=Path(image.filepath.replace('\\','/')).name
 path=approved.get(name,Path(bpy.path.abspath(image.filepath)))
 if not path.is_file():raise RuntimeError('Missing source texture: '+name)
 image.filepath=str(path);image.reload();image.pack()
 if not image.packed_file:raise RuntimeError('Texture was not embedded: '+name)
 report.append({'name':name,'source':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
if hashlib.sha256(MODEL.read_bytes()).hexdigest()!=original:raise RuntimeError('Model changed concurrently; refusing replacement')
bpy.ops.wm.save_as_mainfile(filepath=str(MODEL))
bpy.ops.wm.open_mainfile(filepath=str(MODEL))
assert all(i.packed_file for i in bpy.data.images if i.source=='FILE')
(BACKUP/'repair.json').write_text(json.dumps({'before':original,'after':hashlib.sha256(MODEL.read_bytes()).hexdigest(),'textures':report,'reopenVerified':True},indent=2),encoding='utf8')
print('R05_PACKED_MATERIALS_VERIFIED '+str(len(report)))
