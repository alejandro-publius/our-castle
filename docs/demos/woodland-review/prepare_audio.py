#!/usr/bin/env python3
"""Offline macOS narration. No service/API calls; say writes only local audio files."""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('timeline',type=Path)
p.add_argument('output',type=Path)
a=p.parse_args()
timeline=json.loads(a.timeline.read_text())
out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
ffmpeg=shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
ffprobe=shutil.which('ffprobe') or '/opt/homebrew/bin/ffprobe'
voice=timeline['render']['voice'];rate=timeline['render']['speech_rate']
def duration(f):
    return float(subprocess.check_output([ffprobe,'-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(f)]))
def run(cmd):subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
clock=0; cues=[]; report=[]; overruns=[]
for scene in timeline['scenes']:
    phrases=[];at=.10
    for i,text in enumerate(scene['narration']):
        textpath=out/f'{scene["id"]}-{i:02}.txt';textpath.write_text(text)
        speech=out/f'{scene["id"]}-{i:02}.aiff'
        run(['/usr/bin/say','-v',voice,'-r',str(rate),'-f',str(textpath),'-o',str(speech)])
        n=duration(speech)
        phrases.append((speech,n))
        cues.append({'scene':scene['id'],'start':round(clock+at,6),'end':round(clock+at+n,6),'local_start':round(at,6),'local_end':round(at+n,6),'text':text})
        at+=n+.12
    used=at-.12
    if used>scene['duration']-.04:
        overruns.append(f'{scene["id"]}: narration {used:.3f}s exceeds {scene["duration"]:.3f}s')
        report.append({'id':scene['id'],'duration':scene['duration'],'speech_end':used})
        clock+=scene['duration']
        continue
    # Exact scene duration. Explicit silence between phrases and after speech.
    args=[ffmpeg,'-y','-v','error']
    for f,n in phrases:args+=['-i',str(f)]
    labels=[];filters=['anullsrc=r=24000:cl=mono,atrim=duration=0.10[lead]'];labels.append('[lead]')
    for i,(_,n) in enumerate(phrases):
        filters.append(f'[{i}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono[a{i}]');labels.append(f'[a{i}]')
        if i<len(phrases)-1:
            filters.append(f'anullsrc=r=24000:cl=mono,atrim=duration=0.12[g{i}]');labels.append(f'[g{i}]')
    filters.append(''.join(labels)+f'concat=n={len(labels)}:v=0:a=1,apad,atrim=duration={scene["duration"]},asetpts=PTS-STARTPTS[out]')
    target=out/f'{scene["id"]}.wav'
    run(args+['-filter_complex',';'.join(filters),'-map','[out]','-c:a','pcm_s16le',str(target)])
    report.append({'id':scene['id'],'start':clock,'duration':scene['duration'],'speech_end':round(used,6),'silence_after':round(scene['duration']-used,6)})
    clock+=scene['duration']
if overruns:
    raise RuntimeError('Edit copy/rate; no final audio written: '+ '; '.join(overruns))
concat=out/'audio-concat.txt'
concat.write_text(''.join("file '"+str(out/f'{s["id"]}.wav')+"'\n" for s in timeline['scenes']))
final=out/'narration.m4a'
run([ffmpeg,'-y','-v','error','-f','concat','-safe','0','-i',str(concat),'-c:a','aac','-b:a','80k','-movflags','+faststart',str(final)])
data={'voice':voice,'rate':rate,'method':'Offline macOS say; one phrase per audio file; captions use measured phrase durations','duration':clock,'audio_duration':duration(final),'audio_sha256':hashlib.sha256(final.read_bytes()).hexdigest(),'scenes':report,'cues':cues}
(out/'speech-timing.json').write_text(json.dumps(data,indent=2))
print(json.dumps({k:v for k,v in data.items() if k not in ['cues']},indent=2))
