#!/usr/bin/env python3
"""Render an explicitly labeled private review cut from real footage and cited reports.

Requires Python/Pillow and ffmpeg/ffprobe. No network, application API or financial calls.
Run from this edit kit: python3 render.py --kit .
"""
import argparse, csv, hashlib, json, math, shutil, subprocess, textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

P=argparse.ArgumentParser();P.add_argument('--kit',type=Path,default=Path(__file__).parent)
A=P.parse_args();ROOT=A.kit.resolve();T=json.loads((ROOT/'timeline.json').read_text())
FF=shutil.which('ffmpeg');FP=shutil.which('ffprobe')
if not FF or not FP:raise SystemExit('ffmpeg and ffprobe are required.')
W,H=1920,1080;FPS=25
FONTS=ROOT/'fonts';BUILD=ROOT/'render-work';BUILD.mkdir(exist_ok=True)
BG='#101c22';TEAL='#142c34';IVORY='#f6eddb';MUTED='#b9bda9';GOLD='#e3ba72';RULE='#304642';RED='#9d3e46'
def font(size,bold=False,display=False):
    f='UncialAntiqua-400.ttf' if display else ('AlegreyaSans-700.ttf' if bold else 'AlegreyaSans-400.ttf')
    return ImageFont.truetype(str(FONTS/f),size)
def wrap(draw,text,f,width):
    lines=[];line=''
    for word in text.split():
        candidate=(line+' '+word).strip()
        if line and draw.textlength(candidate,font=f)>width:lines.append(line);line=word
        else:line=candidate
    if line:lines.append(line)
    return lines
def write(draw,text,x,y,size=34,width=1740,color=IVORY,bold=False,display=False,leading=None):
    f=font(size,bold,display);leading=leading or round(size*1.17)
    for line in wrap(draw,text,f,width):
        draw.text((x,y),line,font=f,fill=color);y+=leading
    return y
def base(scene):
    world=scene['kind'] in ('world','app')
    im=Image.new('RGBA',(W,H),(0,0,0,0) if scene['kind']=='world' else BG);d=ImageDraw.Draw(im)
    if world:
        d.rectangle((0,0,W,132),fill=BG)
        d.rectangle((0,914,W,H),fill=BG)
    d.line((64,139,1856,139),fill=GOLD,width=2)
    d.text((64,20),'Our Castle',font=font(43,display=True),fill=IVORY)
    label='PRIVATE REVIEW CUT  /  NOT SUBMITTED'
    f=font(23,bold=True);d.text((1856-d.textlength(label,font=f),30),label,font=f,fill=MUTED)
    badge=scene['label'];f=font(25,bold=True)
    d.text((64,89),badge,font=f,fill=GOLD if scene['kind']!='insert' else '#ffb4ba')
    if world:
        write(d,scene['title'],64,923,size=37,width=1780,bold=True)
    else:
        ui=scene['kind']=='ui';width=1080 if ui else 1770
        y=write(d,scene.get('eyebrow',''),64,177,size=23,width=width,color=GOLD,bold=True)
        y=write(d,scene['title'],64,y+24,size=49,width=width,display=True,leading=63)+30
        if scene.get('metric'):
            y=write(d,scene['metric'],64,y+6,size=61,width=width,color=GOLD,bold=True)+24
        if ui:
            for bullet in scene.get('bullets',[]):
                d.rectangle((68,y+13,76,y+21),fill=GOLD)
                y=write(d,bullet,100,y,size=35,width=1000)+20
            d.rectangle((1252,176,1836,904),outline=GOLD,width=2)
        elif scene['kind']=='evidence':
            for quote in scene.get('quotes',[]):
                # These are excerpts, never a generated app/terminal/PayPal screen.
                y=write(d,quote,90,y,size=34,width=1680,color=IVORY if not quote.startswith('SKIPPED') else GOLD)+14
            if y>824:raise ValueError(f'{scene["id"]}: evidence text would overlap source note ({y})')
        elif scene['kind']=='insert':
            d.rectangle((64,y,1856,y+68),fill=RED)
            write(d,'UNFILMED  —  THIS RESULT IS STILL UNVERIFIED',88,y+14,size=32,bold=True)
            y+=105
            for bullet in scene['bullets']:
                y=write(d,bullet,90,y,size=39,width=1660)+26
        if scene.get('source_note'):
            write(d,scene['source_note'],64,842,size=25,width=1780,color=MUTED)
    d.line((64,914,1856,914),fill=GOLD,width=2)
    # State/provenance is always visible independently of the spoken captions.
    caption=scene['caption'];f=font(25)
    lines=wrap(d,caption,f,1780)
    if len(lines)>1:raise ValueError(f'{scene["id"]}: static scope caption must fit one line')
    d.text((64,967),caption,font=f,fill=MUTED)
    return im
def caption_image(text):
    im=Image.new('RGBA',(W,86),(0,0,0,0));d=ImageDraw.Draw(im);f=font(35)
    lines=wrap(d,text,f,1760)
    if len(lines)>2:raise ValueError('A spoken caption exceeds two lines: '+text)
    for i,line in enumerate(lines):
        x=(W-d.textlength(line,font=f))/2
        d.text((x,2+i*40),line,font=f,fill=IVORY)
    return im
def call(args):
    r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if r.returncode:raise RuntimeError(r.stderr.decode(errors='replace')[-9000:])
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def stamp(t,sep=','):
    ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02}{sep}{ms:03}'

speech=json.loads((ROOT/'speech-timing.json').read_text());CUES=speech['cues']
source_manifest=json.loads((ROOT/'sources/manifest.json').read_text())
for f,meta in source_manifest['kit_files'].items():
    if digest(ROOT/f)!=meta['sha256']:raise RuntimeError('Source hash mismatch: '+f)
if digest(ROOT/'narration.m4a')!=speech['audio_sha256']:raise RuntimeError('Narration hash mismatch')
timeline_rows=[];clock=0
for scene in T['scenes']:
    sid=scene['id'];duration=scene['duration'];still=BUILD/f'{sid}-base.png';base(scene).save(still)
    args=[FF,'-y','-v','error','-threads','2'];filters=[]
    if scene['kind']=='world':
        media=ROOT/T['sources'][scene['source']]['file']
        args+=['-ss',str(scene['in']),'-i',str(media),'-loop','1','-framerate',str(FPS),'-i',str(still)]
        filters=[f'[0:v]fps={FPS},setpts=PTS-STARTPTS,scale={W}:{H},tpad=stop_mode=clone:stop_duration=5[v]', '[v][1:v]overlay=0:0:shortest=1[stage]'];idx=2
    elif scene['kind']=='app':
        media=ROOT/T['sources'][scene['source']]['file']
        args+=['-ss',str(scene['in']),'-i',str(media),'-loop','1','-framerate',str(FPS),'-i',str(still)]
        filters=[f'[0:v]fps={FPS},setpts=PTS-STARTPTS,scale=1760:760:flags=neighbor,tpad=stop_mode=clone:stop_duration=5[v]', '[1:v][v]overlay=80:148:shortest=1[stage]'];idx=2
    elif scene['kind']=='ui':
        args+=['-loop','1','-framerate',str(FPS),'-i',str(still),'-i',str(ROOT/scene['media'])]
        filters=['[1:v]fps=25,setpts=PTS-STARTPTS,scale=576:720:flags=lanczos[ui]','[0:v][ui]overlay=1256:180:shortest=1[stage]'];idx=2
    else:
        args+=['-loop','1','-framerate',str(FPS),'-i',str(still)];filters=['[0:v]null[stage]'];idx=1
    prev='stage'
    for n,cue in enumerate(c for c in CUES if c['scene']==sid):
        cp=BUILD/f'{sid}-caption-{n}.png';caption_image(cue['text']).save(cp)
        args+=['-loop','1','-framerate',str(FPS),'-i',str(cp)]
        dest=f'c{n}';filters.append(f'[{prev}][{idx}:v]overlay=0:994:enable=\'between(t,{cue["local_start"]},{cue["local_end"]})\'[{dest}]');prev=dest;idx+=1
    target=BUILD/f'{sid}.mp4'
    call(args+['-filter_complex_threads','1','-filter_complex',';'.join(filters),'-map',f'[{prev}]','-an','-t',str(duration),'-r',str(FPS),'-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-threads','2','-g','50','-movflags','+faststart',str(target)])
    timeline_rows.append({'id':sid,'start':round(clock,3),'end':round(clock+duration,3),'duration':duration,'kind':scene['kind'],'source':scene.get('media',T['sources'].get(scene.get('source'),{}).get('file','report/slate')),'original_in':scene.get('in',''),'provenance_label':scene['label']})
    print(f'Rendered {sid} ({duration:.2f}s)',flush=True);clock+=duration
concat=BUILD/'video-concat.txt';concat.write_text(''.join("file '"+str(BUILD/f'{s["id"]}.mp4')+"'\n" for s in T['scenes']))
video=ROOT/'our-castle-family-woodland-review-draft.mp4'
call([FF,'-y','-v','error','-f','concat','-safe','0','-i',str(concat),'-i',str(ROOT/'narration.m4a'),'-map','0:v:0','-map','1:a:0','-c','copy','-t',str(clock),'-movflags','+faststart','-metadata','title=Our Castle — family journey and woodland review draft','-metadata','comment=Recorded example-mode family journey and woodland; historical AI and sandbox evidence; owner insert remains unverified.',str(video)])
with (ROOT/'timeline.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(timeline_rows[0]));w.writeheader();w.writerows(timeline_rows)
srt=[];vtt=['WEBVTT','']
for n,c in enumerate(CUES,1):
    srt.extend([str(n),stamp(c['start'])+' --> '+stamp(c['end']),c['text'],''])
    vtt.extend([stamp(c['start'],'.')+' --> '+stamp(c['end'],'.'),c['text'],''])
(ROOT/'captions.srt').write_text('\n'.join(srt));(ROOT/'captions.vtt').write_text('\n'.join(vtt))
md=['# Editable narration','',f'Synthetic offline macOS {speech["voice"]} voice, {speech["rate"]} words/minute. Not the owner’s voice.','']
for scene,row in zip(T['scenes'],timeline_rows):md.extend([f'## {stamp(row["start"],".")} — {scene["title"]}', '',scene['label'],'',' '.join(scene['narration']),''])
(ROOT/'narration.md').write_text('\n'.join(md))
report={'status':T['status'],'duration':clock,'frames_expected':round(clock*FPS),'scenes':timeline_rows,'video':{'file':video.name,'bytes':video.stat().st_size,'sha256':digest(video)},'audio_sha256':digest(ROOT/'narration.m4a'),'source_manifest_sha256':digest(ROOT/'sources/manifest.json'),'caption_cues':len(CUES),'voice':'Synthetic, offline macOS '+speech['voice'],'new_ai_or_payment_calls':0}
(ROOT/'render-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report['video'],indent=2));print(f'Duration {clock:.3f}s; {len(CUES)} measured phrase captions.')
