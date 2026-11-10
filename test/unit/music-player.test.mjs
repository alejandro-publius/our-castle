import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicPlayer } from '../../src/app/music-player.js';

const tracks = ['village','forest','night','market'].map(id=>({id,url:`/${id}.mp3`,type:'audio/mpeg',volume:.16}));
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  let hidden=false,playlist=tracks,created=0;
  const errors=[],heard=[],pending=[];
  const audio = new class extends EventTarget {
    currentTime=0;duration=100;ended=false;paused=true;error=null;src='';
    canPlayType(type){return type==='audio/mpeg'?'probably':'';}
    load(){this.currentTime=0;this.ended=false;this.error=null;}
    play(){this.paused=false;return this.defer?new Promise((resolve,reject)=>pending.push({resolve,reject})):Promise.resolve();}
    pause(){this.paused=true;}
    end(){this.currentTime=this.duration;this.ended=true;this.dispatchEvent(new Event('ended'));}
    at(time){this.currentTime=time;this.dispatchEvent(new Event('timeupdate'));}
  }();
  const player=createMusicPlayer({getTracks:()=>playlist,createAudio:()=>{created++;return audio;},isHidden:()=>hidden,onError:e=>errors.push(e),onTrack:t=>heard.push(t.id)});
  return {player,audio,errors,heard,pending,created:()=>created,setHidden:v=>{hidden=v;},setTracks:v=>{playlist=v;}};
}

test('no media before opt-in, natural endings rotate every track on a single element',async()=>{
  const h=harness();assert.equal(h.created(),0);assert.equal(h.audio.src,'');
  h.player.resume();await flush();
  for(let i=0;i<4;i++){h.audio.end();await flush();}
  assert.deepEqual(h.heard,['village','forest','night','market','village']);
  assert.equal(h.created(),1);assert.equal(h.audio.loop,false);assert.deepEqual(h.errors,[]);
});

test('realm changes wait for the recording to finish and unsupported formats are skipped',async()=>{
  const h=harness();h.player.resume();await flush();h.audio.at(28);
  h.setTracks([{id:'unsupported',url:'/x.ogg',type:'audio/ogg'},tracks[2],tracks[3]]);
  assert.equal(h.player.current().id,'village');assert.equal(h.audio.currentTime,28);
  h.audio.end();await flush();assert.equal(h.player.current().id,'night');
  h.audio.end();await flush();assert.equal(h.player.current().id,'market');
  h.audio.end();await flush();assert.equal(h.player.current().id,'night');
});

test('recordings fade at their edges and keep their quiet level in the middle',()=>{
  const h=harness();h.player.resume();assert.equal(h.audio.volume,0);
  h.audio.at(.4);assert.ok(h.audio.volume>0&&h.audio.volume<.16);
  h.audio.at(10);assert.equal(h.audio.volume,.16);
  h.audio.at(99.6);assert.ok(h.audio.volume>0&&h.audio.volume<.16);
});

test('off and hidden pages cannot advance or become audible from a late play',async()=>{
  const h=harness();h.audio.defer=true;h.player.resume();h.player.pause();
  h.pending.shift().resolve();await flush();assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,true);
  h.audio.end();assert.equal(h.player.current().id,'village');
  h.setHidden(true);h.player.resume();assert.equal(h.pending.length,0);
  h.audio.end();assert.equal(h.player.current().id,'village');
});

test('an old rejection cannot turn off a newer deliberate resume',async()=>{
  const h=harness();h.audio.defer=true;h.player.resume();h.player.pause();h.player.resume();
  h.pending[0].reject(new Error('older request'));h.pending[1].resolve();await flush();
  assert.equal(h.audio.muted,false);assert.equal(h.audio.paused,false);assert.deepEqual(h.errors,[]);
});

test('a failed load stops and retries the same recording without another element',async()=>{
  const h=harness();h.player.resume();await flush();h.audio.error={code:2};h.audio.dispatchEvent(new Event('error'));
  assert.equal(h.errors.length,1);assert.equal(h.audio.paused,true);assert.equal(h.audio.muted,true);
  h.player.resume();await flush();assert.equal(h.player.current().id,'village');assert.equal(h.audio.paused,false);assert.equal(h.created(),1);
});

test('a refused play and a browser with no supported tracks fail closed',async()=>{
  const h=harness();h.audio.defer=true;h.player.resume();h.pending[0].reject(new Error('gesture required'));await flush();
  assert.equal(h.audio.muted,true);assert.equal(h.errors.length,1);
  const none=harness();none.setTracks([{id:'x',type:'unsupported',url:'/x'}]);none.player.resume();await flush();
  assert.equal(none.audio.src,'');assert.equal(none.errors.length,1);assert.equal(none.audio.muted,true);
});
