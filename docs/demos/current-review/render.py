#!/usr/bin/env python3
"""Render only the cited footage/stills and offline narration. No network calls."""
import argparse,csv,hashlib,json,shutil,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
p=argparse.ArgumentParser();p.add_argument('--kit',type=Path,default=Path(__file__).parent);a=p.parse_args()
K=a.kit.resolve();R=K.parents[2];T=json.loads((K/'timeline.json').read_text());speech=json.loads((K/'speech-timing.json').read_text())
W,H,FPS=1920,1080,25;FF=shutil.which('ffmpeg');FP=shutil.which('ffprobe')
B=K/'render-work';B.mkdir(exist_ok=True)
BG='#101c22';IVORY='#f6eddb';GOLD='#e3ba72';MUTED='#b9bda9'
digest=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
def font(n,bold=False,display=False):
 name='UncialAntiqua-400.ttf' if display else 'AlegreyaSans-700.ttf' if bold else 'AlegreyaSans-400.ttf'
 return ImageFont.truetype(str(R/'assets/fonts'/name),n)
def wrap(draw,text,f,width):
 lines=[];line=''
 for word in text.split():
  candidate=(line+' '+word).strip()
  if line and draw.textlength(candidate,font=f)>width:lines.append(line);line=word
  else:line=candidate
 if line:lines.append(line)
 return lines
def text(draw,words,x,y,size=38,width=1700,fill=IVORY,bold=False,display=False):
 f=font(size,bold,display)
 for line in wrap(draw,words,f,width):draw.text((x,y),line,font=f,fill=fill);y+=int(size*1.25)
 return y
def run(cmd):
 r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if r.returncode:raise RuntimeError(r.stderr.decode(errors='replace')[-6000:])
def stamp(v,sep=','):
 ms=round(v*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
 return f'{h:02}:{m:02}:{s:02}{sep}{ms:03}'
manifest=json.loads((K/'sources/manifest.json').read_text())
for f,meta in manifest['files'].items():
 if digest(K/f)!=meta['sha256']:raise RuntimeError('Source hash mismatch: '+f)
for old in manifest['historical_sources']:
 if 'sha256' in old and digest(K/old['file'])!=old['sha256']:raise RuntimeError('Historical source mismatch.')
if digest(K/'narration.m4a')!=speech['audio_sha256']:raise RuntimeError('Narration hash mismatch.')
rows=[];clock=0
for s in T['scenes']:
 sid=s['id'];n=s['duration'];kind=s['kind'];cues=[c for c in speech['cues'] if c['scene']==sid]
 overlay=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(overlay)
 d.rounded_rectangle((22,12,22+min(1700,d.textlength(s['label'],font=font(27,True))+34),56),radius=3,fill=(16,28,34,238))
 d.text((38,18),s['label'],font=font(27,True),fill=GOLD)
 # One unobtrusive provenance label and measured captions; leave the game large.
 if s.get('end_card'):
  d.rectangle((0,850,W,H),fill=(16,28,34,245))
  d.text((68,864),'github.com/alejandro-publius/our-castle',font=font(39,True),fill=IVORY)
  d.text((68,918),'npm ci   →   npm run demo',font=font(32),fill=GOLD)
 overlay_path=B/(sid+'-overlay.png');overlay.save(overlay_path)
 args=[FF,'-y','-v','error','-threads','2'];filters=[];idx=0
 if kind in ['video','montage']:
  parts=s.get('parts',[{'media':s.get('media'),'in':0,'duration':n-s.get('hold',0)}])
  for i,part in enumerate(parts):
   args+=['-ss',str(part.get('in',0)),'-i',str(K/part['media'])]
   crop=s.get('crop');cf=f'crop={crop[2]}:{crop[3]}:{crop[0]}:{crop[1]},' if crop else ''
   size=f'scale={W}:{H}:force_original_aspect_ratio=decrease:flags=neighbor,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x101c22' if crop else f'scale={W}:{H}:flags=neighbor'
   filters.append(f'[{i}:v]trim=duration={part["duration"]},setpts=PTS-STARTPTS,fps={FPS},{cf}{size},setsar=1[p{i}]')
  idx=len(parts)
  if len(parts)>1:filters.append(''.join(f'[p{i}]' for i in range(len(parts)))+f'concat=n={len(parts)}:v=1:a=0[base]')
  else:filters.append(f'[p0]tpad=stop_mode=clone:stop_duration={s.get("hold",0)}[base]')
 elif kind=='portrait':
  bg=B/(sid+'-background.png');Image.new('RGB',(W,H),BG).save(bg)
  args+=['-loop','1','-framerate',str(FPS),'-i',str(bg)]
  if s.get('still'):args+=['-loop','1','-framerate',str(FPS)]
  args+=['-i',str(K/s['media'])];crop=s.get('crop');cf=f'crop={crop[2]}:{crop[3]}:{crop[0]}:{crop[1]},' if crop else ''
  filters.append(f'[1:v]{cf}fps={FPS},setpts=PTS-STARTPTS,scale=-2:914:flags=lanczos,tpad=stop_mode=clone:stop_duration={s.get("hold",0)}[portrait]')
  filters.append('[0:v][portrait]overlay=(W-w)/2:66[base]');idx=2
 else:
  bg=B/(sid+'-background.png');im=Image.new('RGB',(W,H),BG);sd=ImageDraw.Draw(im)
  sd.text((72,170),'Our Castle',font=font(50,display=True),fill=IVORY)
  y=text(sd,s['title'],72,315,size=56,width=1750,display=True)
  sd.line((72,y+32,1848,y+32),fill=GOLD,width=2);y+=92
  for line in s.get('lines',[]):y=text(sd,line,72,y,size=39,width=1720)+25
  text(sd,s.get('note',''),72,876,size=26,width=1760,fill=MUTED)
  im.save(bg);args+=['-loop','1','-framerate',str(FPS),'-i',str(bg)];filters.append('[0:v]null[base]');idx=1
 args+=['-loop','1','-framerate',str(FPS),'-i',str(overlay_path)]
 filters.append(f'[base][{idx}:v]overlay=0:0[stage]');idx+=1;prev='stage'
 for j,cue in enumerate(cues):
  cp=B/f'{sid}-caption-{j}.png';im=Image.new('RGBA',(W,H),(0,0,0,0));cd=ImageDraw.Draw(im);f=font(33,True)
  lines=wrap(cd,cue['text'],f,1750)
  if len(lines)>2:raise ValueError('Caption exceeds two lines: '+cue['text'])
  top=H-(len(lines)*40+22);cd.rectangle((0,top-5,W,H),fill=(16,28,34,245))
  for i,line in enumerate(lines):cd.text(((W-cd.textlength(line,font=f))/2,top+i*40),line,font=f,fill=IVORY)
  im.save(cp);args+=['-loop','1','-framerate',str(FPS),'-i',str(cp)]
  dest=f'c{j}';filters.append(f'[{prev}][{idx}:v]overlay=0:0:enable=\'between(t,{cue["local_start"]},{cue["local_end"]})\'[{dest}]');idx+=1;prev=dest
 target=B/(sid+'.mp4')
 run(args+['-filter_complex_threads','1','-filter_complex',';'.join(filters),'-map',f'[{prev}]','-an','-t',str(n),'-r',str(FPS),'-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-threads','2','-g','50',str(target)])
 rows.append({'id':sid,'start':clock,'end':clock+n,'duration':n,'kind':kind,'media':s.get('media','; '.join(p['media'] for p in s.get('parts',[]))),'label':s['label']})
 clock+=n;print('Rendered',sid,flush=True)
concat=B/'concat.txt';concat.write_text(''.join("file '"+str(B/(s['id']+'.mp4'))+"'\n" for s in T['scenes']))
video=K/'our-castle-current-review-cut.mp4'
run([FF,'-y','-v','error','-f','concat','-safe','0','-i',str(concat),'-i',str(K/'narration.m4a'),'-map','0:v:0','-map','1:a:0','-c','copy','-t',str(clock),'-movflags','+faststart','-metadata','title=Our Castle — current build review cut','-metadata','comment=Current example-mode app; historical live evidence; actual in-app sandbox and same-order get_order insert still unfilmed. Not submitted.',str(video)])
with (K/'timeline.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
srt=[];vtt=['WEBVTT','']
for i,c in enumerate(speech['cues'],1):
 srt += [str(i),stamp(c['start'])+' --> '+stamp(c['end']),c['text'],'']
 vtt += [stamp(c['start'],'.')+' --> '+stamp(c['end'],'.'),c['text'],'']
(K/'captions.srt').write_text('\n'.join(srt));(K/'captions.vtt').write_text('\n'.join(vtt))
md=['# Editable narration','','Offline synthetic macOS Daniel voice; not the owner’s voice.','']
for s,r in zip(T['scenes'],rows):md += [f'## {stamp(r["start"],".")} — {s["id"]}','',' '.join(s['narration']),'']
(K/'narration.md').write_text('\n'.join(md)+'\n')
probe=json.loads(subprocess.check_output([FP,'-v','error','-count_frames','-show_entries','format=duration:stream=codec_type,codec_name,width,height,nb_read_frames,r_frame_rate','-of','json',str(video)]))
duration=float(probe['format']['duration']);assert duration<180 and abs(duration-clock)<.2
frames=next(s for s in probe['streams'] if s['codec_type']=='video')['nb_read_frames'];assert int(frames)==round(clock*FPS)
run([FF,'-v','error','-i',str(video),'-f','null','-'])
result={'status':T['status'],'video':video.name,'duration':duration,'sha256':digest(video),'bytes':video.stat().st_size,'source_commit':T['source_commit'],'frames':int(frames),'probe':probe,'full_decode':'passed','caption_cues':len(speech['cues']),'narration_sha256':digest(K/'narration.m4a'),'manifest_sha256':digest(K/'sources/manifest.json'),'new_provider_calls':0,'scenes':rows}
(K/'render-report.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
