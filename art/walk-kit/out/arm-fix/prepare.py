import hashlib,json,shutil
from pathlib import Path
root=Path.cwd()
d=root/'out/arm-fix'
(d/'before/frames').mkdir(parents=True,exist_ok=True)
(d/'frames').mkdir(exist_ok=True)
(d/'attempts').mkdir(exist_ok=True)
hashes={}
for i in range(16):
 f=f'W{i:02d}'
 p=root/('out/3-inbetweens' if i%2 else 'out/2-keys')/(f+'.png')
 dest=d/'before/frames'/(f+'.png')
 assert not dest.exists(), 'Do not overwrite a repair backup'
 shutil.copy2(p,dest)
 hashes[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
for folder in ['out/2-keys','out/3-inbetweens']:
 for p in (root/folder).glob('*'):
  if p.is_file() and p.suffix in ['.json','.jsonl','.md','.py','.gif'] or p.name=='contact-sheet.png':
   dest=d/'before'/folder/p.name
   dest.parent.mkdir(parents=True,exist_ok=True)
   shutil.copy2(p,dest)
for folder in ['refs','guides','tools','processed']:
 for p in (root/folder).rglob('*'):
  if p.is_file():
   hashes[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
(d/'before/hashes.json').write_text(json.dumps(hashes,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'backed_up_frames':16,'protected_paths':len(hashes)}))
