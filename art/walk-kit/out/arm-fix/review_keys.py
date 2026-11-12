import json,runpy
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path.cwd();d=root/'out/arm-fix'
white=runpy.run_path(str(root/'out/3-inbetweens/make_review.py'))['white_preview']
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',22)
sheet=Image.new('RGB',(4*360,2*340),'white');draw=ImageDraw.Draw(sheet)
for j,i in enumerate(range(0,16,2)):
 f=f'W{i:02d}';x=j%4*360;y=j//4*340
 draw.text((x+15,y+5),f,fill='#333333',font=font)
 im=white(Image.open(d/'frames'/f'{f}.png')).crop((260,480,800,960))
 sheet.paste(im.resize((350,305),Image.Resampling.LANCZOS),(x,y+35))
sheet.save(d/'keys-arms.png')
print('8 key arms cropped for review')
