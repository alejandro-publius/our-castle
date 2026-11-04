import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createWeatherClient, WEATHER_TTL_MS } from '../../src/app/local-weather.js';
import { createApp } from '../../server/app.mjs';
import { loadConfig } from '../../server/config.mjs';
import { openDatabase } from '../../server/db.mjs';
import { createClock } from '../../server/household.mjs';
import { FIXED_NOW } from '../helpers/setup.mjs';
const CITY={id:'2650225',label:'Edinburgh, Scotland, United Kingdom',latitude:55.95,longitude:-3.2,timeZone:'Europe/London'};
const START=Date.parse('2026-11-04T12:00:00Z');
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const conditions=(clock,code=61,extra={})=>({timezone:'Europe/London',current:{time:Math.floor(clock/1000),weather_code:code,is_day:1,cloud_cover:80,temperature_2m:8,...extra}});

test('weather is opt-in: construction is quiet; city search is anonymous and returns only valid city-level choices',async()=>{
 const calls=[];const client=createWeatherClient({fetchImpl:async(url,options)=>{
  calls.push({url,options});return json({results:[
   {id:1,name:'Edinburgh',admin1:'Scotland',country:'United Kingdom',latitude:55.953251,longitude:-3.188267,timezone:'Europe/London'},
   {id:2,name:'Invalid',latitude:200,longitude:0,timezone:'Europe/London'},
   {id:3,name:'No zone',latitude:1,longitude:1,timezone:'Not/AZone'},
  ]});
 }});
 assert.equal(calls.length,0);
 await assert.rejects(client.searchPlaces(' '),/at least two/);assert.equal(calls.length,0);
 const choices=await client.searchPlaces('Edinburgh, Scotland');
 assert.equal(choices.length,1);assert.equal(choices[0].label,'Edinburgh, Scotland, United Kingdom');
 assert.equal(choices[0].latitude,55.95);assert.equal(choices[0].longitude,-3.19);
 const url=new URL(calls[0].url);assert.equal(url.origin,'https://geocoding-api.open-meteo.com');
 assert.equal(url.searchParams.get('name'),'Edinburgh, Scotland');
 assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'omit');
 assert.equal(calls[0].options.referrerPolicy,'no-referrer');
});

test('current conditions map to rain and cache for 15 minutes without another request',async()=>{
 let clock=START,calls=0;const client=createWeatherClient({now:()=>clock,fetchImpl:async(url,options)=>{
  calls++;const u=new URL(url);assert.equal(u.origin,'https://api.open-meteo.com');
  assert.equal(u.searchParams.get('timezone'),'auto');assert.equal(u.searchParams.get('timeformat'),'unixtime');
  assert.equal(options.credentials,'omit');return json(conditions(clock));
 }});
 const first=await client.loadWeather(CITY);assert.equal(first.kind,'rain');assert.equal(first.rain,true);
 assert.equal(first.isDay,true);assert.equal(first.observedAt,'2026-11-04T12:00:00.000Z');
 assert.equal(first.expiresAt,START+WEATHER_TTL_MS);assert.equal(first.cached,false);
 clock+=WEATHER_TTL_MS-1;assert.equal((await client.loadWeather(CITY)).cached,true);assert.equal(calls,1);
 clock+=2;assert.equal((await client.loadWeather(CITY)).cached,false);assert.equal(calls,2);
});

test('snow, fog and thunderstorms are distinguished; snow never becomes a claim of rain',async()=>{
 for(const [code,kind]of[[71,'snow'],[85,'snow'],[45,'fog'],[0,'clear'],[2,'cloudy'],[97,'rain']]){
  const client=createWeatherClient({now:()=>START,fetchImpl:async()=>json(conditions(START,code,{precipitation:3,is_day:0,temperature_2m:0}))});
  const value=await client.loadWeather(CITY);assert.equal(value.kind,kind);
  assert.equal(value.rain,kind==='rain');assert.equal(value.isDay,false);assert.equal(value.temperatureC,0);
 }
});

test('caller abort and disconnect cannot leave an old weather result in the cache',async()=>{
 const controller=new AbortController();
 const client=createWeatherClient({fetchImpl:(_url,options)=>new Promise((_ok,fail)=>{
  options.signal.addEventListener('abort',()=>fail(new DOMException('Canceled','AbortError')),{once:true});
 })});
 const pending=client.loadWeather(CITY,{signal:controller.signal});controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
 let release,calls=0;
 const disconnected=createWeatherClient({now:()=>START,fetchImpl:async()=>{
  calls++;if(calls===1)return new Promise(ok=>{release=ok;});return json(conditions(START,0));
 }});
 const old=disconnected.loadWeather(CITY);disconnected.clear();release(json(conditions(START,61)));
 await assert.rejects(old,{name:'AbortError'});
 assert.equal((await disconnected.loadWeather(CITY)).kind,'clear');assert.equal(calls,2);
});

test('invalid locations, malformed and stale reports fail clearly without guessing conditions',async()=>{
 let calls=0;const client=createWeatherClient({fetchImpl:async()=>{calls++;return json({});}});
 await assert.rejects(client.loadWeather({...CITY,longitude:1000}),/Choose a city/);assert.equal(calls,0);
 for(const response of [{current:null},conditions(START,999),conditions(START-3*60*60*1000)]){
  const invalid=createWeatherClient({now:()=>START,fetchImpl:async()=>json(response)});
  await assert.rejects(invalid.loadWeather(CITY),/report is (incomplete|out of date)/);
 }
});

test('HTTP rate limits and timeouts are bounded and leave manual modes available',async()=>{
 const limited=createWeatherClient({fetchImpl:async()=>json({},429)});
 await assert.rejects(limited.loadWeather(CITY),/service is busy/);
 let calls=0;
 const slow=createWeatherClient({timeoutMs:20,fetchImpl:(_url,options)=>{calls++;return new Promise((_ok,fail)=>{
  options.signal.addEventListener('abort',()=>fail(new DOMException('Canceled','AbortError')),{once:true});
 });}});
 await assert.rejects(slow.loadWeather(CITY),/took too long/);assert.equal(calls,1);
});

test('the app allows the two weather data origins only for connections, not scripts or frames',async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),db=openDatabase(':memory:');
 const app=createApp({config:loadConfig({},{root}),db,clock:createClock(FIXED_NOW),paypal:null,aiProvider:null,root});
 const server=http.createServer(app.handler);await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 try{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/');
  assert.equal(response.status,200);
  const policy=response.headers.get('content-security-policy'),parts=policy.split(';').map(s=>s.trim());
  const connect=parts.find(s=>s.startsWith('connect-src '));
  for(const host of['https://api.open-meteo.com','https://geocoding-api.open-meteo.com']){
   assert.ok(connect.split(' ').includes(host));
   assert.equal(parts.find(s=>s.startsWith('script-src ')).includes(host),false);
   assert.equal(parts.find(s=>s.startsWith('frame-src')).includes(host),false);
  }
  assert.ok(parts.includes("default-src 'self'"));assert.ok(parts.includes("object-src 'none'"));
 }finally{await new Promise(ok=>server.close(ok));db.close();}
});
