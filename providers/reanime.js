const CryptoJS=require("crypto-js");
const REANIME_DOMAINS=["https://reanime.wtf","https://reanime.to","https://reanime.cz"];
const FLIXCLOUD_BASE="https://flixcloud.cc";
const TMDB_API_KEY="439c478a771f35c05022f9feabcca01c";
const FRIBB_URL="https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_HEADERS={"User-Agent":USER_AGENT,"Accept":"application/json, text/plain, */*","Accept-Language":"en-US,en;q=0.9"};
const FLIX_HEADERS={"User-Agent":USER_AGENT,"Accept":"*/*","Origin":FLIXCLOUD_BASE,"Referer":`${FLIXCLOUD_BASE}/`};
let activeBaseUrl=REANIME_DOMAINS[0],fribbCache=null;
const log=(...a)=>console.log("[Reanime-Fribb]",...a);
const err=(...a)=>console.error("[Reanime-Fribb]",...a);
function section(n){log("========================================");log(n);log("========================================")}
function absolutize(p,b=activeBaseUrl){if(!p)return"";if(/^https?:\/\//i.test(p))return p;return`${b}${p.startsWith("/")?"":"/"}${p}`}
async function fetchText(url,options={}){
 const absolute=/^https?:\/\//i.test(url),urls=absolute?[url]:REANIME_DOMAINS.map(d=>`${d}${url.startsWith("/")?"":"/"}${url}`);
 let last=null;
 for(const u of urls)try{
  log("HTTP REQUEST",u);
  const r=await fetch(u,{...options,headers:{...DEFAULT_HEADERS,...(options.headers||{})}});
  log("HTTP RESPONSE",r.status,u);
  if(r.ok){
   if(!absolute)try{activeBaseUrl=new URL(u).origin;log("ACTIVE REANIME DOMAIN",activeBaseUrl)}catch{}
   return await r.text();
  }
  last=new Error(`HTTP ${r.status}`);
  log("HTTP FAILED",r.status,u);
 }catch(e){
  last=e;
  log("HTTP EXCEPTION",u,e?.message||String(e));
 }
 throw last||new Error(`Request failed: ${url}`);
}
async function fetchJson(url,options={}){
 const t=await fetchText(url,{...options,headers:{"Accept":"application/json, text/plain, */*",...(options.headers||{})}});
 try{return JSON.parse(t)}catch(e){throw new Error(`Invalid JSON from ${url}: ${e?.message||e}`)}
}
function tmdbBase(t){return`https://api.themoviedb.org/3/${t==="movie"?"movie":"tv"}`}
async function getTmdbInfo(id,type){
 const t=type==="movie"?"movie":"tv";
 log("TMDB LOOKUP START",`ID=${id}`,`TYPE=${t}`);
 try{
  const d=await fetchJson(`${tmdbBase(t)}/${encodeURIComponent(id)}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`);
  const imdbId=d?.external_ids?.imdb_id||d?.imdb_id||null,title=d?.name||d?.title||d?.original_name||d?.original_title||"Anime",year=(d?.first_air_date||d?.release_date||"").slice(0,4);
  log("TMDB LOOKUP SUCCESS");
  log("TMDB ID",d?.id??id);
  log("TMDB TITLE",title);
  log("TMDB ORIGINAL",d?.original_name||d?.original_title||"N/A");
  log("TMDB YEAR",year||"N/A");
  log("TMDB IMDb",imdbId||"NOT FOUND");
  if(!imdbId)try{
   const arm=await fetchJson(`https://arm.haglund.dev/api/v2/themoviedb?id=${encodeURIComponent(id)}`);
   const ai=Array.isArray(arm)&&arm.length?arm[0]?.imdb:null;
   if(ai){log("ARM IMDb FOUND",ai);return{title,year,imdbId:ai}}
  }catch(e){log("ARM LOOKUP FAILED",e?.message||String(e))}
  return{title,year,imdbId};
 }catch(e){
  err("TMDB LOOKUP FAILED",e?.stack||e?.message||e);
  return null;
 }
}
async function loadFribb(){
 if(Array.isArray(fribbCache)&&fribbCache.length){
  log("FRIBB CACHE HIT",`entries=${fribbCache.length}`);
  return fribbCache;
 }
 section("FRIBB DATABASE LOAD");
 log("FRIBB URL",FRIBB_URL);
 try{
  const r=await fetch(FRIBB_URL,{headers:{"User-Agent":"Reanime-Nuvio/1.0","Accept":"application/json"}});
  log("FRIBB HTTP",r.status);
  if(!r.ok)throw new Error(`Fribb HTTP ${r.status}`);
  const d=await r.json();
  if(!Array.isArray(d))throw new Error("Fribb response is not an array");
  fribbCache=d;
  log("FRIBB DATABASE LOADED",`entries=${d.length}`);
  return d;
 }catch(e){
  err("FRIBB DATABASE LOAD FAILED",e?.stack||e?.message||e);
  return null;
 }
}
function idMatches(v,t){
 if(v===undefined||v===null)return false;
 const w=String(t);
 return Array.isArray(v)?v.some(x=>String(x)===w):String(v)===w;
}
function getFribbSeason(e){
 const v=e?.season?.tmdb;
 if(v===undefined||v===null||v==="")return null;
 const n=Number(v);
 return Number.isFinite(n)?n:null;
}
function getFribbEpisodeOffset(e){
 const v=e?.episode_offset?.tmdb;
 if(v===undefined||v===null||v==="")return 0;
 const n=Number(v);
 return Number.isFinite(n)?n:0;
}
async function resolveFribbMapping({tmdbId,mediaType,season=1,episode=1}){
 section("FRIBB DIAGNOSTIC");
 const rows=await loadFribb();
 if(!rows)throw new Error("FRIBB DIAGNOSTIC FAILED: database unavailable");
 const targetTmdbId=String(tmdbId);
 const isMovie=mediaType==="movie";
 const targetSeason=Number(season)||1;
 const targetEpisode=Number(episode)||1;
 const rawMatches=[];
 for(const e of rows){
  if(!e||typeof e!=="object")continue;
  const ids=e?.themoviedb_id;
  if(!ids||typeof ids!=="object")continue;
  const movieMatch=idMatches(ids.movie,targetTmdbId);
  const tvMatch=idMatches(ids.tv,targetTmdbId);
  if((isMovie&&movieMatch)||(!isMovie&&tvMatch))rawMatches.push(e);
 }
 const candidates=rawMatches.map((e,i)=>({
  index:i+1,
  type:e?.type??null,
  anilist_id:e?.anilist_id??null,
  anidb_id:e?.anidb_id??null,
  mal_id:e?.mal_id??null,
  imdb_id:e?.imdb_id??null,
  themoviedb_id:e?.themoviedb_id??null,
  season:e?.season??null,
  episode_offset:e?.episode_offset??null
 }));
 const exactSeason=rawMatches
  .filter(e=>e?.anilist_id!==undefined&&e?.anilist_id!==null&&e?.anilist_id!=="")
  .filter(e=>getFribbSeason(e)===targetSeason)
  .map((e,i)=>({
   index:i+1,
   anilist_id:e?.anilist_id??null,
   type:e?.type??null,
   season:e?.season??null,
   episode_offset:e?.episode_offset??null,
   themoviedb_id:e?.themoviedb_id??null,
   imdb_id:e?.imdb_id??null
  }));
 throw new Error(`FRIBB_DIAGNOSTIC ${JSON.stringify({
  tmdbId:targetTmdbId,
  mediaType,
  season:targetSeason,
  episode:targetEpisode,
  rows:rows.length,
  rawMatchCount:rawMatches.length,
  exactSeasonMatchCount:exactSeason.length,
  candidates,
  exactSeason
 })}`);
}
function filterServers(s,l){
 return Array.isArray(s)?s.filter(x=>x?.dataType?.toLowerCase()===String(l).toLowerCase()):[];
}
async function getFlixEmbeds(slug,ep,language,anilistId){
 section(`REANIME FLIX ${String(language).toUpperCase()}`);
 const watchUrl=absolutize(`/watch/${slug||"anime"}?ep=${ep}`);
 if(!anilistId)return{watchUrl,servers:[],embeds:[]};
 try{
  const d=await fetchJson(`/api/flix/${anilistId}/${ep}`,{headers:{Referer:watchUrl}});
  if(d?.success&&Array.isArray(d.servers)){
   const s=filterServers(d.servers,language);
   if(s.length)return{watchUrl,servers:s,embeds:s.map(x=>x?.dataLink).filter(Boolean)};
  }
 }catch(e){log("FLIX PRIMARY FAILED",e?.message||String(e))}
 if(slug)try{
  const a=await fetchJson(`/api/v1/anime/${slug}`);
  const aid=a?.anilist_id;
  if(aid){
   const d=await fetchJson(`/api/flix/${aid}/${ep}`,{headers:{Referer:watchUrl}});
   if(d?.success&&Array.isArray(d.servers)){
    const s=filterServers(d.servers,language);
    if(s.length)return{watchUrl,servers:s,embeds:s.map(x=>x?.dataLink).filter(Boolean)};
   }
  }
 }catch(e){log("FLIX SLUG API FAILED",e?.message||String(e))}
 if(slug)try{
  const h=await fetchText(`/anime/${slug}?_ep=${ep}`);
  const aid=h.match(/anilist_id:\s*(\d+)/)?.[1]||null;
  if(aid){
   const d=await fetchJson(`/api/flix/${aid}/${ep}`,{headers:{Referer:watchUrl}});
   if(d?.success&&Array.isArray(d.servers)){
    const s=filterServers(d.servers,language);
    if(s.length)return{watchUrl,servers:s,embeds:s.map(x=>x?.dataLink).filter(Boolean)};
   }
  }
 }catch(e){log("FLIX HTML FALLBACK FAILED",e?.message||String(e))}
 return{watchUrl,servers:[],embeds:[]};
}
function sha256hex(v){return CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(String(v))).toString(CryptoJS.enc.Hex)}
function fromBase64(v){return Uint8Array.from(atob(String(v)),c=>c.charCodeAt(0))}
function uint8ToWordArray(b){
 const w=[];
 for(let i=0;i<b.length;i++)w[i>>>2]=(w[i>>>2]||0)|(b[i]<<(24-(i%4)*8));
 return CryptoJS.lib.WordArray.create(w,b.length);
}
function wordArrayToUint8(w){
 const o=new Uint8Array(w.sigBytes);
 for(let i=0;i<w.sigBytes;i++)o[i]=(w.words[i>>>2]>>>(24-(i%4)*8))&255;
 return o;
}
function generateFields(seed){
 let e=seed,l;
 for(let i=0;i<3;i++)e=sha256hex(e+i);
 l=e;
 for(let i=0;i<3;i++)l=sha256hex(l+i);
 return{
  keyField:"kf_"+e.substring(8,16),
  ivField:"ivf_"+e.substring(16,24),
  containerName:"cd_"+e.substring(24,32),
  arrayName:"ad_"+e.substring(32,40),
  objectName:"od_"+e.substring(40,48),
  tokenField:e.substring(48,64)+"_"+e.substring(56,64),
  keyFrag2Field:l.substring(0,16)+"_"+l.substring(16,24)
 };
}
async function runWasm(wasmBase64,frag1,keyFrag2,tBytes,seedInt){
 try{
  const{instance}=await WebAssembly.instantiate(fromBase64(wasmBase64));
  const{_s,_r,memory}=instance.exports;
  if(typeof _s!=="function"||typeof _r!=="function"||!memory)throw new Error("Invalid FlixCloud WASM exports");
  const heap=new Uint8Array(memory.buffer);
  const len=frag1.length,y=1000,v=y+len,t=v+len,out=t+len;
  heap.set(frag1,y);
  heap.set(keyFrag2,v);
  heap.set(tBytes,t);
  _s(seedInt);
  _r(y,v,t,out,len);
  return heap.slice(out,out+len);
 }catch(e){
  err("WASM FAILED",e?.stack||e?.message||e);
  throw e;
 }
}
function extractSsrObject(html){
 const m=html.match(/\{type:"data",data:(\{)/);
 if(!m)throw new Error("SSR data block not found");
 const start=html.indexOf("{",m.index+m[0].length-1);
 let depth=0;
 for(let i=start;i<html.length;i++){
  if(html[i]==="{")depth++;
  else if(html[i]==="}"&&! --depth)return html.slice(start,i+1);
 }
 throw new Error("SSR brace matching failed");
}
function parseSsrData(html){
 return Function(`"use strict";return(${extractSsrObject(html)});`)();
}
async function resolveFlixCloud(embedUrl){
 const m=String(embedUrl).match(/\/e\/([^?#\s]+)(?:\?v=(\d+))?/i);
 if(!m)throw new Error("Invalid FlixCloud embed URL");
 const accessId=m[1],version=Number(m[2])||2;
 const r=await fetch(`${FLIXCLOUD_BASE}/e/${accessId}?v=${version}`,{
  headers:{
   "User-Agent":USER_AGENT,
   "Accept":"*/*",
   "Referer":"https://reanime.wtf/"
  }
 });
 if(!r.ok)throw new Error(`FlixCloud HTTP ${r.status}`);
 const d=parseSsrData(await r.text());
 const seed=d?.obfuscation_seed;
 if(!seed)throw new Error("Missing FlixCloud obfuscation seed");
 const f=generateFields(seed);
 const cd=d?.obfuscated_crypto_data;
 if(!cd)throw new Error("Missing obfuscated crypto data");
 const obj=cd[f.containerName]?.[f.arrayName]?.[0]?.[f.objectName];
 if(!obj)throw new Error("Missing FlixCloud crypto object");
 const frag1=fromBase64(obj[f.keyField]);
 const iv=fromBase64(obj[f.ivField]);
 const keyFrag2=fromBase64(d[f.keyFrag2Field]);
 const token=d[f.tokenField];
 if(!token)throw new Error("Missing FlixCloud token");
 const tr=await fetch(`${FLIXCLOUD_BASE}/api/m3u8/${token}`,{headers:FLIX_HEADERS});
 if(!tr.ok)throw new Error(`FlixCloud M3U8 HTTP ${tr.status}`);
 const td=await tr.json();
 const videoBytes=fromBase64(td[sha256hex(token+"vid").substring(0,10)]);
 const tBytes=fromBase64(td[sha256hex(token+"key").substring(0,10)]);
 if(!videoBytes.length||!tBytes.length)throw new Error("Encrypted FlixCloud fields missing");
 const wasm=await runWasm(d.w_payload,frag1,keyFrag2,tBytes,parseInt(seed.substring(0,8),16));
 const derived=CryptoJS.PBKDF2(
  uint8ToWordArray(wasm),
  CryptoJS.enc.Utf8.parse(seed),
  {keySize:8,iterations:1000,hasher:CryptoJS.algo.SHA256}
 );
 const key=wordArrayToUint8(derived);
 for(let i=0;i<32;i++)key[i]^=seed.charCodeAt(i%seed.length);
 const dec=CryptoJS.AES.decrypt(
  {ciphertext:uint8ToWordArray(videoBytes)},
  CryptoJS.SHA256(uint8ToWordArray(key)),
  {iv:uint8ToWordArray(iv),mode:CryptoJS.mode.CBC,padding:CryptoJS.pad.Pkcs7}
 );
 const url=CryptoJS.enc.Utf8.stringify(dec).trim();
 if(!/^https?:\/\//i.test(url))throw new Error("Invalid decrypted stream URL");
 return{
  url,
  subtitles:d.subtitles||[],
  thumbnailsVtt:d.thumbnails_vtt||null,
  videoTitle:d.video_title||null,
  introChapter:d.intro_chapter||null,
  outroChapter:d.outro_chapter||null,
  videoId:d.video_id||null,
  version
 };
}
async function extractFlixCloudDownload(embedUrl){
 try{
  const id=String(embedUrl).match(/\/e\/([a-z0-9]+)/i)?.[1];
  if(!id)return null;
  const headers={Accept:"*/*",Referer:`${FLIXCLOUD_BASE}/`,"User-Agent":USER_AGENT};
  const r=await fetch(`${FLIXCLOUD_BASE}/d/${id}/__data.json`,{headers});
  if(!r.ok)return null;
  const b=await r.text();
  const fileId=b.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  const token=b.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0];
  const base=b.match(/https:\/\/[a-z0-9-]+\.flixcloud\.cc/i)?.[0]||FLIXCLOUD_BASE;
  const quality=b.match(/(\d{3,4}p)/)?.[1]||"1080p";
  const size=b.match(/"(\d+(?:\.\d+)?\s*[KMG]B)"/i)?.[1]||"Unknown";
  if(!fileId||!token)return null;
  let ready=false;
  try{
   const p=await fetch(`${base}/download/${fileId}/progress?token=${token}`,{headers});
   if(p.ok){
    const t=await p.text();
    ready=t.includes('"status":"ready"')||t.includes('"ready"');
   }
  }catch{}
  return{
   url:`${base}/download/${fileId}?token=${token}`,
   quality,
   size,
   type:"mkv",
   headers,
   ready
  };
 }catch(e){
  log("DIRECT MKV EXCEPTION",e?.stack||e?.message||e);
  return null;
 }
}
async function getStreams(tmdbId,mediaType="tv",season=1,episode=1){
 section("REANIME START");
 log("INPUT",`TMDB=${tmdbId}`,`TYPE=${mediaType}`,`S${season}E${episode}`);
 try{
  if(mediaType!=="tv"&&mediaType!=="movie")return[];
  const isMovie=mediaType==="movie";
  const seasonNumber=Number(season)||1;
  const originalEpisode=isMovie?1:Number(episode)||1;
  const tmdb=await getTmdbInfo(tmdbId,mediaType);
  if(!tmdb)return[];
  if(!tmdb.imdbId){
   log("STOP: NO IMDb ID",`TMDB=${tmdbId}`,`TITLE=${tmdb.title}`);
   return[];
  }
  const mapping=await resolveFribbMapping({
   tmdbId,
   mediaType:isMovie?"movie":"tv",
   season:seasonNumber,
   episode:originalEpisode
  });
  if(!mapping?.anilistId)return[];
  const mappedEpisode=Number(mapping.episode)||originalEpisode;
  const slug=null;
  const settings=globalThis.SCRAPER_SETTINGS||{};
  const languages=[];
  if(settings.reanime_sub!==false)languages.push("sub");
  if(settings.reanime_dub!==false)languages.push("dub");
  if(!languages.length)return[];
  const serversByLanguage=Object.create(null);
  for(const language of languages)try{
   const result=await getFlixEmbeds(slug,mappedEpisode,language,mapping.anilistId);
   if(result?.servers?.length)serversByLanguage[language]=result.servers;
  }catch(e){
   log("SERVER DISCOVERY FAILED",language,e?.message||String(e));
  }
  if(!Object.keys(serversByLanguage).length)return[];
  const tasks=[];
  for(const language of languages)for(let i=0;i<(serversByLanguage[language]||[]).length;i++){
   const server=serversByLanguage[language][i];
   const dataLink=server?.dataLink;
   if(!dataLink)continue;
   const serverName=server.serverName||`HD-${i+1}`;
   const lang=language.toUpperCase();
   const title=isMovie?`${tmdb.title} (${lang})`:`${tmdb.title} - Episode ${originalEpisode} (${lang})`;
   tasks.push((async()=>{
    try{
     const direct=await extractFlixCloudDownload(dataLink);
     if(direct?.url)return{
      name:`Reanime [${lang}] ${serverName} (${direct.quality})`,
      title,
      url:direct.url,
      quality:direct.quality,
      size:direct.size,
      headers:direct.headers,
      provider:"reanime",
      type:"mkv"
     };
    }catch(e){log("DIRECT MKV EXCEPTION",serverName,e?.message||String(e))}
    try{
     const resolved=await resolveFlixCloud(dataLink);
     if(resolved?.url)return{
      name:`Reanime [${lang}] ${serverName} (Auto)`,
      title,
      url:resolved.url,
      quality:"Auto",
      provider:"reanime",
      type:"m3u8",
      subtitles:resolved.subtitles||[]
     };
    }catch(e){log("HLS EXCEPTION",serverName,e?.message||String(e))}
    return null;
   })());
  }
  if(!tasks.length)return[];
  const results=await Promise.all(tasks);
  const streams=[];
  const seen=new Set();
  for(const r of results){
   if(r?.url&&!seen.has(r.name)){
    seen.add(r.name);
    streams.push(r);
   }
  }
  const rank={
   auto:4000,
   adaptive:4000,
   "2160p":2160,
   "4k":2160,
   "1080p":1080,
   "720p":720,
   "480p":480,
   "360p":360,
   unknown:0
  };
  streams.sort((a,b)=>
   (rank[String(b?.quality||"unknown").toLowerCase()]||0)-
   (rank[String(a?.quality||"unknown").toLowerCase()]||0)
  );
  return streams;
 }catch(e){
  err("FATAL GETSTREAMS ERROR",e?.stack||e?.message||e);
  if(String(e?.message||e).startsWith("FRIBB_DIAGNOSTIC"))throw e;
  return[];
 }
}
async function onSettings(){
 return[
  {type:"header",label:"Reanime"},
  {type:"toggle",key:"reanime_sub",label:"Subtitles",defaultValue:true},
  {type:"toggle",key:"reanime_dub",label:"Dub",defaultValue:true}
 ];
}
module.exports={getStreams,onSettings};
