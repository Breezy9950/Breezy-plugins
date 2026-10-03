const{getStore}=require("@netlify/blobs");
const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_anime_cache_index";
const TMDB_INDEX_KEY="_anime_tmdb_index";
const MAX_CACHE_BYTES=20*1024*1024;
const MAX_SEASONS=5;
const MAX_EPISODES=300;
const MAX_BODY_BYTES=200000;
const MAX_ID_LENGTH=100;

function log(message){console.log(`[ANIME CACHE] ${message}`);}
function json(statusCode,body){return{statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"},body:JSON.stringify(body)};}
function getStoreSafe(){return getStore({name:STORE_NAME,siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});}
function validKey(key){return typeof key==="string"&&/^mal:\d+$/.test(key)&&key.length<=MAX_ID_LENGTH;}
function cleanString(value,max=500){return typeof value==="string"?value.slice(0,max):"";}
function int(value){const n=Number(value);return Number.isInteger(n)?n:null;}

function cleanEpisode(value,key){
if(!value||typeof value!=="object")return null;
const episode=int(value.episode||value.anizoneEpisode||key);
const season=int(value.season||value.tmdbSeason);
if(!episode||episode<1||!season||season<1)return null;
const malEpisode=int(value.malEpisode||value.mal_episode);
const tmdbEpisode=int(value.tmdbEpisode||value.tmdb_episode);
return{
id:cleanString(value.id||value.episodeLink,300),
episode,
anizoneEpisode:episode,
season,
tmdbSeason:int(value.tmdbSeason)||season,
tmdbEpisode:tmdbEpisode&&tmdbEpisode>0?tmdbEpisode:null,
malId:cleanString(value.malId||value.mal_id,50),
malEpisode:malEpisode&&malEpisode>0?malEpisode:null,
episodeLink:cleanString(value.episodeLink||value.id,300),
animeTitle:cleanString(value.animeTitle||value.anime_title,500),
titles:Array.isArray(value.titles)?value.titles.filter(v=>typeof v==="string").slice(0,30).map(v=>v.slice(0,300)):[],
episodeTitle:cleanString(value.episodeTitle,500),
thumbnail:cleanString(value.thumbnail,500),
isFiller:value.isFiller===true,
hasDub:value.hasDub===true,
tvdbId:cleanString(value.tvdbId||value.tvdb_id,50),
updatedAt:Number(value.updatedAt)||Date.now()
};
}

function cleanSeason(value,key){
if(!value||typeof value!=="object")return null;
const season=int(value.season||key);
if(!season||season<1)return null;
const source=value.episodes&&typeof value.episodes==="object"?value.episodes:{};
const episodes={};
for(const[k,v]of Object.entries(source)){
if(Object.keys(episodes).length>=MAX_EPISODES)break;
const ep=cleanEpisode(v,k);
if(!ep||ep.season!==season)continue;
episodes[String(ep.episode)]=ep;
}
if(!Object.keys(episodes).length)return null;
return{
season,
animeSlug:cleanString(value.animeSlug,300),
animeUrl:cleanString(value.animeUrl,500),
episodeCount:Object.keys(episodes).length,
episodes,
lastUsed:Number(value.lastUsed)||Number(value.updatedAt)||Date.now(),
updatedAt:Number(value.updatedAt)||Date.now()
};
}

function cleanMapping(value,key){
if(!value||typeof value!=="object")return null;
const tmdbId=String(value.tmdbId||value.tmdb_id||"");
const season=int(value.tmdbSeason||value.season);
const episode=int(value.tmdbEpisode||value.tmdb_episode);
const malId=String(value.malId||value.mal_id||"");
const malEpisode=int(value.malEpisode||value.mal_episode);
if(!/^\d+$/.test(tmdbId)||!season||season<1||!episode||episode<1||!/^\d+$/.test(malId)||!malEpisode||malEpisode<1)return null;
return{tmdbId,tmdbSeason:season,tmdbEpisode:episode,tvdbId:cleanString(value.tvdbId||value.tvdb_id,50),malId,malEpisode,anizoneEpisode:int(value.anizoneEpisode||value.anizone_episode)||null,episodeLink:cleanString(value.episodeLink,300),animeTitle:cleanString(value.animeTitle||value.anime_title,500),titles:Array.isArray(value.titles)?value.titles.filter(v=>typeof v==="string").slice(0,30).map(v=>v.slice(0,300)):[],updatedAt:Number(value.updatedAt)||Date.now()};
}

function normalizeRecord(data){
if(!data||typeof data!=="object")return null;
const malId=String(data.malId||data.mal_id||"");
if(!/^\d+$/.test(malId))return null;
const sourceSeasons=data.seasons&&typeof data.seasons==="object"?data.seasons:{};
const seasons={};
for(const[k,v]of Object.entries(sourceSeasons)){
const s=cleanSeason(v,k);
if(s)seasons[String(s.season)]=s;
}
const mappings={};
const sourceMappings=data.mappings&&typeof data.mappings==="object"?data.mappings:{};
for(const[k,v]of Object.entries(sourceMappings)){
const m=cleanMapping(v,k);
if(m)mappings[`tmdb:${m.tmdbId}:s${m.tmdbSeason}:e${m.tmdbEpisode}`]=m;
}
return enforceSeasonLimit({
version:4,
malId,
title:cleanString(data.title,500),
titles:Array.isArray(data.titles)?data.titles.filter(v=>typeof v==="string").slice(0,50).map(v=>v.slice(0,300)):[],
tmdbId:cleanString(data.tmdbId,50),
tvdbId:cleanString(data.tvdbId,50),
seasons,
mappings,
updatedAt:Number(data.updatedAt)||Date.now()
});
}

function enforceSeasonLimit(record){
const keys=Object.keys(record.seasons);
if(keys.length<=MAX_SEASONS)return record;
keys.sort((a,b)=>(Number(record.seasons[a].lastUsed)||0)-(Number(record.seasons[b].lastUsed)||0));
for(const k of keys.slice(0,Math.max(0,keys.length-MAX_SEASONS)))delete record.seasons[k];
for(const k of Object.keys(record.mappings)){
const m=record.mappings[k];
if(!record.seasons[String(m.tmdbSeason)])delete record.mappings[k];
}
return record;
}

function byteSize(value){return Buffer.byteLength(JSON.stringify(value),"utf8");}

async function getIndex(store){
try{
const index=await store.get(INDEX_KEY,{type:"json"});
if(index&&index.entries&&typeof index.entries==="object")return{totalBytes:Number(index.totalBytes)||0,entries:index.entries};
}catch(e){log(`Index read failed: ${e.message}`);}
return{totalBytes:0,entries:{}};
}

async function saveIndex(store,index){await store.setJSON(INDEX_KEY,index);}

async function getTmdbIndex(store){
try{
const index=await store.get(TMDB_INDEX_KEY,{type:"json"});
if(index&&typeof index==="object")return index;
}catch(e){log(`TMDB index read failed: ${e.message}`);}
return{};
}

async function saveTmdbIndex(store,index){await store.setJSON(TMDB_INDEX_KEY,index);}

async function rebuildTmdbIndex(store,index){
const tmdbIndex={};
for(const key of Object.keys(index.entries)){
const malKey=key;
try{
const record=await store.get(malKey,{type:"json"});
if(!record||!record.mappings)continue;
for(const m of Object.values(record.mappings)){
if(!m)continue;
const k=`tmdb:${m.tmdbId}:s${m.tmdbSeason}:e${m.tmdbEpisode}`;
tmdbIndex[k]=m;
}
}catch(e){log(`TMDB index rebuild skipped ${malKey}: ${e.message}`);}
}
await saveTmdbIndex(store,tmdbIndex);
return tmdbIndex;
}

async function evictUntilFits(store,index,key,newSize){
let evicted=0;
while(index.totalBytes+newSize>MAX_CACHE_BYTES){
const candidates=Object.keys(index.entries).filter(k=>k!==key);
if(!candidates.length)return false;
candidates.sort((a,b)=>(Number(index.entries[a].lastUsed)||0)-(Number(index.entries[b].lastUsed)||0));
const victims=candidates.slice(0,Math.min(2,candidates.length));
for(const victim of victims){
const size=Number(index.entries[victim].size)||0;
try{await store.delete(victim);}catch(e){log(`Delete failed ${victim}: ${e.message}`);}
delete index.entries[victim];
index.totalBytes=Math.max(0,index.totalBytes-size);
evicted++;
log(`Evicted complete title ${victim} size=${size}B`);
if(index.totalBytes+newSize<=MAX_CACHE_BYTES)break;
}
}
if(evicted)log(`Eviction removed ${evicted} title record(s)`);
return true;
}

async function touch(store,key,season){
const index=await getIndex(store);
if(index.entries[key]){
index.entries[key].lastUsed=Date.now();
await saveIndex(store,index);
}
if(season){
try{
const record=await store.get(key,{type:"json"});
if(record&&record.seasons&&record.seasons[String(season)]){
record.seasons[String(season)].lastUsed=Date.now();
record.updatedAt=Date.now();
await store.setJSON(key,record);
}
}catch(e){log(`Season LRU update failed ${key}: ${e.message}`);}
}
}

exports.handler=async event=>{
const started=Date.now();
try{
const method=(event.httpMethod||"GET").toUpperCase();
if(method==="OPTIONS")return json(204,{});
if(method!=="GET"&&method!=="POST")return json(405,{ok:false,error:"Method not allowed"});
const store=getStoreSafe();

if(method==="GET"){
const q=event.queryStringParameters||{};
const key=q.key?String(q.key):"";
const malId=q.mal_id?String(q.mal_id):"";
const tmdbId=q.tmdb_id?String(q.tmdb_id):"";
const season=int(q.season);
const episode=int(q.episode);

if(key){
if(!validKey(key))return json(400,{ok:false,error:"Invalid cache key"});
const data=await store.get(key,{type:"json"});
if(!data)return json(404,{ok:false,hit:false});
await touch(store,key,null);
return json(200,{ok:true,hit:true,data});
}

if(malId&&/^\d+$/.test(malId)){
const key2=`mal:${malId}`;
const data=await store.get(key2,{type:"json"});
if(!data)return json(404,{ok:false,hit:false});
await touch(store,key2,null);
return json(200,{ok:true,hit:true,data});
}

if(/^\d+$/.test(tmdbId)&&season&&season>0&&episode&&episode>0){
const idx=await getTmdbIndex(store);
const idxKey=`tmdb:${tmdbId}:s${season}:e${episode}`;
let mapping=idx[idxKey]||null;
if(!mapping){
const index=await getIndex(store);
const rebuilt=await rebuildTmdbIndex(store,index);
mapping=rebuilt[idxKey]||null;
}
if(!mapping)return json(404,{ok:false,hit:false});
const record=await store.get(`mal:${mapping.malId}`,{type:"json"});
if(record)await touch(store,`mal:${mapping.malId}`,season);
return json(200,{ok:true,hit:true,mapping,data:record||null});
}

return json(400,{ok:false,error:"Provide key, mal_id, or tmdb_id+season+episode"});
}

const raw=event.body||"";
if(Buffer.byteLength(raw,"utf8")>MAX_BODY_BYTES)return json(413,{ok:false,error:"Payload too large"});

let body;
try{body=JSON.parse(raw);}catch(e){return json(400,{ok:false,error:"Invalid JSON"});}

const key=body&&body.key;
if(!validKey(key))return json(400,{ok:false,error:"Invalid cache key"});

const incoming=normalizeRecord(body&&body.data);
if(!incoming)return json(400,{ok:false,error:"Invalid cache data"});

const old=await store.get(key,{type:"json"});
let record=incoming;

if(old){
const oldClean=normalizeRecord(old);
if(oldClean){
record={
version:4,
malId:incoming.malId,
title:incoming.title||oldClean.title,
titles:[...new Set([...(oldClean.titles||[]),...(incoming.titles||[])])].slice(0,50),
tmdbId:incoming.tmdbId||oldClean.tmdbId,
tvdbId:incoming.tvdbId||oldClean.tvdbId,
seasons:__mergeSeasons(oldClean.seasons,incoming.seasons),
mappings:Object.assign({},oldClean.mappings,incoming.mappings),
updatedAt:Date.now()
};
record=enforceSeasonLimit(record);
}
}

const size=byteSize(record);
if(size>MAX_CACHE_BYTES)return json(413,{ok:false,error:"Cache entry exceeds 20 MB cache limit"});

const index=await getIndex(store);
const previousEntry=index.entries[key];
const oldSize=old?Number(previousEntry&&previousEntry.size)||byteSize(old):0;
const createdAt=previousEntry&&previousEntry.createdAt?Number(previousEntry.createdAt):Date.now();

index.totalBytes=Math.max(0,index.totalBytes-oldSize);
delete index.entries[key];

if(!(await evictUntilFits(store,index,key,size)))return json(507,{ok:false,error:"Cache capacity reached"});

await store.setJSON(key,record);

index.entries[key]={size,createdAt,lastUsed:Date.now()};
index.totalBytes+=size;

await saveIndex(store,index);

const tmdbIndex=await getTmdbIndex(store);

for(const m of Object.values(record.mappings)){
const mk=`tmdb:${m.tmdbId}:s${m.tmdbSeason}:e${m.tmdbEpisode}`;
tmdbIndex[mk]=m;
}

for(const mk of Object.keys(tmdbIndex)){
const m=tmdbIndex[mk];
if(!m||!index.entries[`mal:${m.malId}`])delete tmdbIndex[mk];
}

await saveTmdbIndex(store,tmdbIndex);

log(`POST SUCCESS MAL=${record.malId} seasons=${Object.keys(record.seasons).length} size=${size}B total=${index.totalBytes}B time=${Date.now()-started}ms`);

return json(200,{ok:true,key,size,totalBytes:index.totalBytes,maxBytes:MAX_CACHE_BYTES});
}catch(error){
console.error("[ANIME CACHE] FATAL",error);
return json(500,{ok:false,error:"Cache service error"});
}
};

function __mergeSeasons(oldSeasons,newSeasons){
const out=Object.assign({},oldSeasons||{});
for(const[k,v]of Object.entries(newSeasons||{})){
const old=out[k];
if(!old){
out[k]=v;
continue;
}
out[k]={
season:v.season||old.season,
animeSlug:v.animeSlug||old.animeSlug,
animeUrl:v.animeUrl||old.animeUrl,
episodeCount:0,
episodes:Object.assign({},old.episodes||{},v.episodes||{}),
lastUsed:Math.max(Number(old.lastUsed)||0,Number(v.lastUsed)||0),
updatedAt:Math.max(Number(old.updatedAt)||0,Number(v.updatedAt)||0)
};
out[k].episodeCount=Object.keys(out[k].episodes).length;
}
return out;
}
