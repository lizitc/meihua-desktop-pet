"""Render staged corrected artwork into review assets; source PNGs are read-only."""
import json,runpy
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw,ImageFont,ImageSequence

DIRECTORY=Path(__file__).resolve().parent
ROOT=DIRECTORY.parents[1]
FRAMES=[f"W{i:02d}" for i in range(16)]


def save_gif(frames,path,duration):
    training=Image.new("RGB",(128*len(frames),128),"white")
    for i,frame in enumerate(frames):
        training.paste(frame.resize((128,128),Image.Resampling.LANCZOS),(i*128,0))
    trained=training.quantize(colors=255,method=Image.Quantize.MEDIANCUT)
    palette=Image.new("P",(1,1));palette.putpalette([255,255,255]+trained.getpalette()[:255*3])
    indexed=[]
    for frame in frames:
        q=frame.quantize(palette=palette,dither=Image.Dither.NONE)
        diff=ImageChops.difference(frame,Image.new("RGB",frame.size,"white"))
        r,g,b=diff.split()
        white=ImageChops.lighter(ImageChops.lighter(r,g),b).point(lambda v:255 if v==0 else 0)
        q.paste(0,mask=white);indexed.append(q)
    indexed[0].save(path,save_all=True,append_images=indexed[1:],duration=duration,loop=0,disposal=2,optimize=False)
    with Image.open(path) as image:
        assert image.n_frames==len(frames) and image.info["loop"]==0
        expected=[duration]*len(frames) if isinstance(duration,int) else duration
        assert [f.info["duration"] for f in ImageSequence.Iterator(image)]==expected


def main():
    namespace=runpy.run_path(str(ROOT/"out/3-inbetweens/make_review.py"))
    renderer=namespace["main"]
    renderer.__globals__.update(DIRECTORY=DIRECTORY,ROOT=ROOT,source_path=lambda i:DIRECTORY/"frames"/f"W{i:02d}.png")
    renderer()
    white=namespace["white_preview"]
    new=[white(Image.open(DIRECTORY/"frames"/f"{f}.png")) for f in FRAMES]
    old=[white(Image.open(DIRECTORY/"before/frames"/f"{f}.png")) for f in FRAMES]
    font=ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf",22)
    sheet=Image.new("RGB",(4*360,4*350),"white");draw=ImageDraw.Draw(sheet)
    slow=[];comparison=[]
    for i,f in enumerate(FRAMES):
        crop=new[i].crop((260,480,800,960))
        x=i%4*360;y=i//4*350
        draw.text((x+15,y+4),f,fill="#333333",font=font)
        sheet.paste(crop.resize((350,310),Image.Resampling.LANCZOS),(x,y+35))
        panel=Image.new("RGB",(540,512),"white");d=ImageDraw.Draw(panel)
        d.text((15,4),f,fill="#333333",font=font);panel.paste(crop,(0,32));slow.append(panel)
        compare=Image.new("RGB",(1080,512),"white");d=ImageDraw.Draw(compare)
        d.text((15,4),f+" BEFORE",fill="#333333",font=font)
        d.text((555,4),f+" AFTER",fill="#333333",font=font)
        compare.paste(old[i].crop((260,480,800,960)),(0,32));compare.paste(crop,(540,32))
        comparison.append(compare)
    sheet.save(DIRECTORY/"arms-contact-sheet.png")
    save_gif(slow,DIRECTORY/"arms-preview-4fps.gif",250)
    save_gif(comparison,DIRECTORY/"before-after-4fps.gif",250)
    print(json.dumps({"full_review_frames":16,"arms_review_frames":16,"old_frames_preserved":True}))


if __name__=="__main__":
    main()
