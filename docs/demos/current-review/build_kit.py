#!/usr/bin/env python3
"""Prepare an editable review cut from a recorded public example build.

This does not operate a browser, call providers or generate payment/AI outcomes.
The continuous original stays in ignored test-results; each cut records its range.
"""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--capture',type=Path,required=True)
p.add_argument('--merchant-image',type=Path,required=True)
a=p.parse_args();kit=Path(__file__).resolve().parent;repo=kit.parents[2]
sources=kit/'sources';sources.mkdir(exist_ok=True)
report=json.loads((a.capture/'capture-report.json').read_text())
if report['status']!='passed':raise SystemExit('A passing capture report is required.')
raw=Path(report['recording']['path'])
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
if sha(raw)!=report['recording']['sha256']:raise SystemExit('Continuous recording hash mismatch.')
ph={v['id']:v['seconds'] for v in report['phases']}
FF=shutil.which('ffmpeg');FP=shutil.which('ffprobe')
def run(cmd):
 r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if r.returncode:raise RuntimeError(r.stderr.decode(errors='replace')[-3000:])
def duration(f):return float(subprocess.check_output([FP,'-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(f)]))
cuts={
 'intro':('realm-intro',0,9), 'family':('family',0,12),
 'plan':('plan-result',0,7), 'contribution':('contribute',0,6),
 'manor':('deed-manor-gardens',0,10), 'treasury':('treasury',0,8),
 'completed':('completed-realm',0,12), 'night':('night',0,7), 'rain':('rain',0,7),
}
manifest={'continuous_original':report['recording'],'source_commit':report['sourceCommit'],
 'method':'Fresh public clone; actual npm run demo; a new empty headless Chromium development context; reduced motion; America/Los_Angeles device time zone. No owner browser, saved household, key or provider used.',
 'cuts':[], 'historical_sources':[], 'files':{}, 'scope':'Current game footage is simulated example mode. Historical live sources retain their dates and narrower verified scope. The actual in-app popup and same-order get_order insert remains unfilmed.'}
for name,(marker,offset,length) in cuts.items():
 target=sources/(name+'.mp4');start=ph[marker]+offset
 run([FF,'-y','-v','error','-threads','2','-ss',str(start),'-i',str(raw),'-t',str(length),'-vf','fps=25','-an','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-threads','2','-movflags','+faststart',str(target)])
 manifest['cuts'].append({'file':'sources/'+target.name,'marker':marker,'original_in':start,'duration':duration(target),'speed':1,'edits':'trim; silent H.264/25fps derivative; no reconstructed UI or time acceleration'})
shutil.copy2(a.merchant_image,sources/'merchant-recorded.png')
manifest['historical_sources'].append({'file':'sources/merchant-recorded.png','kind':'Actual Channel3 desktop result screenshot; original bytes unchanged',
 'checked_at_utc':'2026-11-05T07:13:36.917Z','date_pst':'November 4, 2026',
 'original':'/Users/alexvintera/projects/our-castle-channel3/test-results/channel3-merchant/live/live-results-desktop.png',
 'summary_sha256':'61fdcf5f1fbbaf8b438aece7dd050f3bb2170663b6c703518ce4b6af3cb615c0',
 'scope':'One actual earlier camping tent search under $250; three results at $62.82, $95.99 and $219.99 USD. Not a current price/stock promise, new API call, live phone check, or recorded goal save.'})
old=repo/'docs/demos/woodland-review/sources'
for name in ['planner-result.mp4','historical-paypal-verification.md']:
 manifest['historical_sources'].append({'file':'../woodland-review/sources/'+name,
  'sha256':sha(old/name),'kind':'Unchanged earlier evidence; see woodland-review/sources/manifest.json for original ranges and hashes'})
(sources/'public-demo-capture.json').write_text(json.dumps(report,indent=2)+'\n')
for f in sorted(sources.iterdir()):
 if f.is_file() and f.name!='manifest.json':manifest['files'][str(f.relative_to(kit))]={'sha256':sha(f),'bytes':f.stat().st_size}
(sources/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

def scene(id,duration,kind,label,narration,**kw):return dict(id=id,duration=duration,kind=kind,label=label,narration=narration,**kw)
scenes=[
 scene('intro',9,'video','Current build · example household',[
  'Our Castle turns a shared family goal into a growing woodland realm. This tour uses example mode.'
 ],media='sources/intro.mp4'),
 scene('family',12,'video','Current build · family and crest',[
  'Choose a family banner and your own pixel characters. One household journal holds the plan, contributions and records, while the world stays in view.'
 ],media='sources/family.mp4'),
 scene('merchant',11,'portrait','Channel3 · real search recorded November 4',[
  'Market Town finds real products within a budget. These are actual earlier Channel3 results. Use as goal creates a draft for the family to confirm.'
 ],media='sources/merchant-recorded.png',crop=[488,110,466,780],still=True),
 scene('plan',8,'video','Current build · built-in example plan',[
  'The family reviews a weekly schedule before accepting it. This fresh example uses built-in rules.'
 ],media='sources/plan.mp4',hold=1),
 scene('live-ai',10,'portrait','Live Claude result · earlier interface · November 3',[
  'This earlier recording shows a real Claude plan: eight thirty-dollar weeks cover the two hundred forty dollar gap. The server checks the arithmetic.'
 ],media='../woodland-review/sources/planner-result.mp4',hold=.04),
 scene('contribution',6,'video','Current build · simulated contribution',[
  'A contribution starts with a chosen amount and explicit adult approval.'
 ],media='sources/contribution.mp4'),
 scene('paypal-history',12,'slide','PayPal sandbox · historical verifier · November 3',[
  'An earlier hosted-link sandbox test captured fifteen dollars and credited it once. Replay and wrong-household checks passed. That test did not record the in-app popup.'
 ],title='Captured once. Checked on the server.',lines=['$15 USD · buyer-approved hosted link','$60 reported → $75 tracked','Replay and household mismatch checks passed'],note='Historical report: docs/LIVE-VERIFICATION.md · subsequently refunded'),
 scene('owner-insert',28,'insert','Recording gap · not a payment demonstration',[
  'This review cut reserves one insert for the actual in-app sandbox checkout, saved receipt and steward verification of that same order. That sequence is not yet recorded.'
 ],title='Checkout recording still needed',lines=['Sandbox popup → receipt → same-order steward'],note='No popup approval or get_order reconciliation is reconstructed here.'),
 scene('manor',10,'video','Current build · simulated $15 unlock',[
  'Here, a simulated fifteen-dollar contribution opens Manor Gardens. The deed carries the family crest and chosen characters. The village remains.'
 ],media='sources/manor.mp4',crop=[560,200,800,680]),
 scene('treasury',14,'video','AG Grid + AG Studio · example records',[
  'The Treasury keeps the next area, searchable records and a receipt together. AG Grid and a custom Studio widget fit the same journal. The read-only steward stays closed until needed.'
 ],media='sources/treasury.mp4',hold=6),
 scene('apimatic',10,'slide','APIMatic · developer integration',[
  'APIMatic’s eight installed context skills guided PayPal integration and recovery checks, without adding any extra step for the family.'
 ],title='PayPal context, behind the scenes.',lines=['8 installed SDK context skills','PayPal Server SDK 2.5.0','Uncertain captures recheck the same order'],note='Actual implementation and checks: docs/APIMATIC-CODEX.md'),
 scene('completed',12,'video','Current build · later simulated progression',[
  'Later milestones extend the same forest into a citadel, a palace and two towers. The earlier homes stay connected by rivers and bridges.'
 ],media='sources/completed.mp4'),
 scene('atmosphere',10,'montage','Current build · manual night and rain',[
  'At night, windows and lanterns glow. Rain changes the atmosphere. These controls change the scenery, never the household ledger.'
 ],parts=[{'media':'sources/night.mp4','in':0,'duration':5},{'media':'sources/rain.mp4','in':0,'duration':5}]),
 scene('close',10,'video','Public source · fresh local game',[
  'Try Our Castle from the public repository. The fresh demo needs no credentials and keeps its example progress separate from any saved household.'
 ],media='sources/intro.mp4',hold=1,end_card=True),
]
timeline={'title':'Our Castle — current build review cut','status':'Review cut, not submitted. One live sandbox popup/same-order steward insert is unfilmed.',
 'source_commit':report['sourceCommit'],'render':{'width':1920,'height':1080,'fps':25,'voice':'Daniel','speech_rate':178},
 'reference_lock':'Actual current app, large world, one journal, bundled Uncial/Alegreya fonts and ivory/brass. Small source labels, measured captions. No reconstructed payment or model response, no repeated product disclaimers, no stock music.',
 'sources_manifest':'sources/manifest.json','scenes':scenes}
assert sum(s['duration'] for s in scenes)==162
(kit/'timeline.json').write_text(json.dumps(timeline,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'source_commit':report['sourceCommit'],'duration':162,'clips':len(cuts),'kit':str(kit)}))
