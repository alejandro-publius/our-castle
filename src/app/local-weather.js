// Opt-in public weather requests only. No request is made at import/construction.
// API docs: https://open-meteo.com/en/docs and /en/docs/geocoding-api.
// The UI chooses a city; this module never reads geolocation, PayPal, accounts or household state.
export const WEATHER_TTL_MS = 15 * 60 * 1000;
const SEARCH_ORIGIN = 'https://geocoding-api.open-meteo.com';
const FORECAST_ORIGIN = 'https://api.open-meteo.com';
const rainCodes = new Set([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,97,99]);
const snowCodes = new Set([71,73,75,77,85,86]);
const fogCodes = new Set([45,48]);
const knownCodes = new Set([0,1,2,3,...rainCodes,...snowCodes,...fogCodes]);
const abortError = () => new DOMException('Weather request canceled.', 'AbortError');
const text = (value, limit=180) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0,limit) : '';
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
function validZone(zone) {
  if (typeof zone !== 'string' || zone.length > 80) return false;
  try { new Intl.DateTimeFormat('en', {timeZone:zone}); return true; } catch { return false; }
}
function placeValue(place) {
  if (!place || !text(place.label) || !finite(place.latitude) || Math.abs(place.latitude)>90 ||
      !finite(place.longitude) || Math.abs(place.longitude)>180 || !validZone(place.timeZone))
    throw new Error('Choose a city from the search results first.');
  return Object.freeze({
    id: text(String(place.id ?? ''),80) || String(place.latitude)+','+String(place.longitude),
    label:text(place.label), latitude:Math.round(place.latitude*100)/100,
    longitude:Math.round(place.longitude*100)/100, timeZone:place.timeZone,
  });
}
function weatherValue(data, place, clock) {
  const c=data?.current, code=c?.weather_code;
  if (!c || !Number.isInteger(code) || !knownCodes.has(code) || !finite(c.time) ||
      ![0,1].includes(c.is_day) || !finite(c.cloud_cover) || c.cloud_cover<0 || c.cloud_cover>100)
    throw new Error('The weather report is incomplete. Choose a manual weather mode for now.');
  const validAt=c.time*1000;
  if (validAt < clock-2*60*60*1000 || validAt > clock+15*60*1000)
    throw new Error('The weather report is out of date. Choose a manual weather mode for now.');
  const kind=rainCodes.has(code)?'rain':snowCodes.has(code)?'snow':fogCodes.has(code)?'fog':code===0?'clear':'cloudy';
  const label=kind==='rain' ? ([95,96,97,99].includes(code)?'Thunderstorms':code<60?'Drizzle':'Rain')
    :kind==='snow'?'Snow':kind==='fog'?'Fog':kind==='clear'?'Clear sky':code===1?'Mainly clear':code===2?'Partly cloudy':'Overcast';
  return Object.freeze({
    place,kind,label,weatherCode:code,rain:kind==='rain',isDay:c.is_day===1,cloudCover:c.cloud_cover,
    temperatureC:finite(c.temperature_2m)?c.temperature_2m:null,
    // Open-Meteo's model-valid timestamp, not a personal sensor or bill-provider confirmation.
    observedAt:new Date(validAt).toISOString(),fetchedAt:new Date(clock).toISOString(),
    expiresAt:clock+WEATHER_TTL_MS,cached:false,
  });
}
export function createWeatherClient({fetchImpl=globalThis.fetch,now=()=>Date.now(),timeoutMs=8000}={}) {
  if (typeof fetchImpl!=='function') throw new Error('Weather requests are not supported in this browser.');
  const cache=new Map(); let generation=0;
  async function getJson(url,{signal}={}) {
    if(signal?.aborted)throw abortError();
    const controller=new AbortController(); let timedOut=false;
    const cancel=()=>controller.abort();
    signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    try {
      const response=await fetchImpl(url.toString(),{
        method:'GET',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',
        headers:{Accept:'application/json'},signal:controller.signal,
      });
      if(signal?.aborted)throw abortError();
      if(!response.ok)throw new Error(response.status===429
        ?'The weather service is busy. Try later or choose a manual mode.'
        :'The weather service is unavailable. Choose a manual mode for now.');
      const data=await response.json();
      if(signal?.aborted)throw abortError();
      if(!data || typeof data!=='object' || data.error)throw new Error('The weather service returned an incomplete report.');
      return data;
    } catch(error) {
      if(signal?.aborted)throw abortError();
      if(timedOut)throw new Error('The weather service took too long. Choose a manual mode for now.');
      if(error instanceof Error && error.message.startsWith('The weather service'))throw error;
      throw new Error('The weather service could not be reached. Choose a manual mode for now.');
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  return {
    async searchPlaces(query,{signal}={}) {
      const name=text(query,80);
      if(name.length<2)throw new Error('Enter at least two characters of a city name.');
      const url=new URL('/v1/search',SEARCH_ORIGIN);
      url.search=new URLSearchParams({name,count:'5',language:'en',format:'json'}).toString();
      const data=await getJson(url,{signal});
      if(data.results===undefined)return [];
      if(!Array.isArray(data.results))throw new Error('The city search returned an incomplete result.');
      return data.results.slice(0,5).flatMap(row=>{
        if(!row || !text(row.name))return [];
        const label=[...new Set([row.name,row.admin1,row.country].map(x=>text(x)).filter(Boolean))].join(', ');
        try{return [placeValue({id:row.id,label,latitude:row.latitude,longitude:row.longitude,timeZone:row.timezone})];}
        catch{return [];}
      });
    },
    async loadWeather(place,{signal}={}) {
      if(signal?.aborted)throw abortError();
      const city=placeValue(place),key=city.latitude+','+city.longitude,clock=now();
      const found=cache.get(key);
      if(found && found.expiresAt>clock)return Object.freeze({...found,place:city,cached:true});
      const run=generation,url=new URL('/v1/forecast',FORECAST_ORIGIN);
      url.search=new URLSearchParams({
        latitude:String(city.latitude),longitude:String(city.longitude),
        current:'weather_code,is_day,cloud_cover,temperature_2m',timezone:'auto',timeformat:'unixtime',forecast_days:'1',
      }).toString();
      const data=await getJson(url,{signal});
      if(signal?.aborted || run!==generation)throw abortError();
      const result=weatherValue(data,city,now());cache.set(key,result);return result;
    },
    clear(){generation++;cache.clear();},
  };
}
