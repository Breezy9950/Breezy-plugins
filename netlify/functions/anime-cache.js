const{getStore}=require("@netlify/blobs");

const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_cache_index";
const MAX_CACHE_BYTES=20*1024*1024;
const MAX_SEASONS=5;
const MAX_EPISODES=200;
const MAX_BODY_BYTES=150000;

function log(message){console.log(`[ANIME CACHE] ${message}`);}

function json(statusCode,body){
return{
statusCode,
headers:{
"Content-Type":"application/json",
"Cache-Control":"no-store",
"Access-Control-Allow-Origin":"*",
"Access-Control-Allow-Methods":"GET,POST,OPTIONS",
"Access-Control-Allow-Headers":"Content-Type"
},
body:JSON.stringify(body)
};
}

function cleanString(value,max=500){
if(typeof value!=="string")return"";
return value.trim().slice(0,max);
}

function validKey(key){
return typeof key==="string"&&/^mal:\d+$/.test(key)&&key.length<=50;
}

function parseMalId(value){
const n=Number(value);
return Number.isInteger(n)&&n>0&&n<=1000000000?String(n):null;
}

function parseSeason(value){
const n=Number(value);
return Number.isInteger(n)&&n>0&&n<=1000?n:null;
}

function parseEpisode(value){
const n=Number(value);
return Number.isInteger(n)&&n>0&&n<=100000?n:null;
}

function cleanTitles(value){
if(!Array.isArray(value))return[];
return value.filter(v=>typeof v==="string").slice(0,50).map(v=>v.slice(0,300));
}

function cleanEpisode(value){
if(!value||typeof value!=="object")return null;
const episode=parseEpisode(value.episode);
const malEpisode=parseEpisode(value.mal_episode);
if(!episode||!malEpisode)return null;
return{
id:cleanString(value.id,300),
episodeLink:cleanString(value.episodeLink,1000),
imdb_id:cleanString(value.imdb_id,50),
season:parseSeason(value.season)||1,
episode,
mal_id:cleanString(String(value.mal_id||""),30),
mal_episode:malEpisode,
anime_title:cleanString(value.anime_title,500),
titles:cleanTitles(value.titles),
episodeTitle:cleanString(value.episodeTitle,500),
thumbnail:cleanString(value.thumbnail,1000),
isFiller:value.isFiller===true,
hasDub:value.hasDub===true
};
}

function cleanSeason(value){
if(!value||typeof value!=="object")return null;
const season=parseSeason(value.season);
const animeSlug=cleanString(value.animeSlug,500);
if(!season||!animeSlug)return null;
const sourceEpisodes=value.episodes;
if(!sourceEpisodes||typeof sourceEpisodes!=="object")return null;
const episodes={};
for(const[key,raw]of Object.entries(sourceEpisodes)){
if(Object.keys(episodes).length>=MAX_EPISODES)break;
const ep=cleanEpisode(raw);
if(!ep)continue;
const epNum=parseEpisode(key);
if(!epNum||epNum!==ep.episode)continue;
episodes[String(epNum)]=ep;
}
if(!Object.keys(episodes).length)return null;
return{
season,
animeSlug,
animeUrl:cleanString(value.animeUrl,1000),
episodeCount:Object.keys(episodes).length,
episodes,
updatedAt:Number(value.updatedAt)||Date.now()
};
}

function cleanValue(value){
if(!value||typeof value!=="object")return null;
const malId=parseMalId(value.malId||value.mal_id);
if(!malId)return null;
const sourceSeasons=value.seasons;
if(!sourceSeasons||typeof sourceSeasons!=="object")return null;
const seasons={};
const seasonEntries=Object.entries(sourceSeasons).sort((a,b)=>Number(a[0])-Number(b[0])).slice(0,MAX_SEASONS);
for(const[key,raw]of seasonEntries){
const season=cleanSeason(raw);
if(!season)continue;
seasons[String(season.season)]=season;
}
if(!Object.keys(seasons).length)return null;
return{
version:2,
malId,
title:cleanString(value.title,500),
titles:cleanTitles(value.titles),
tmdbId:cleanString(String(value.tmdbId||value.tmdb_id||""),50),
tvdbId:cleanString(String(value.tvdbId||value.tvdb_id||""),50),
seasons,
updatedAt:Number(value.updatedAt)||Date.now()
};
}

function byteSize(value){
return Buffer.byteLength(JSON.stringify(value),"utf8");
}

async function getIndex(store){
try{
const index=await store.get(INDEX_KEY,{type:"json",consistency:"strong"});
if(index&&typeof index==="object"&&index.entries&&typeof index.entries==="object"){
return{
totalBytes:Number(index.totalBytes)||0,
entries:index.entries
};
}
log("Cache index missing/invalid; creating empty index");
}catch(error){
log(`Cache index read failed: ${error&&error.message||error}`);
}
return{totalBytes:0,entries:{}};
}

async function saveIndex(store,index){
await store.setJSON(INDEX_KEY,index);
}

async function deleteOldestTitles(store,index,requiredBytes){
let deleted=0;
while(index.totalBytes+requiredBytes>MAX_CACHE_BYTES){
const candidates=Object.keys(index.entries);
if(candidates.length<1){
log("Cache cannot fit entry; no titles available for deletion");
return false;
}
candidates.sort((a,b)=>{
const aTime=Number(index.entries[a]&&index.entries[a].lastUsed)||0;
const bTime=Number(index.entries[b]&&index.entries[b].lastUsed)||0;
return aTime-bTime;
});
const targets=candidates.slice(0,Math.min(2,candidates.length));
for(const oldest of targets){
const oldSize=Number(index.entries[oldest]&&index.entries[oldest].size)||0;
log(`Deleting cached anime "${oldest}" size=${oldSize}B`);
try{
await store.delete(oldest);
log(`Deleted Blob "${oldest}"`);
}catch(error){
log(`Blob delete failed "${oldest}": ${error&&error.message||error}`);
}
delete index.entries[oldest];
index.totalBytes=Math.max(0,index.totalBytes-oldSize);
deleted++;
}
}
if(deleted)log(`Cache cleanup deleted ${deleted} anime title(s), usage=${index.totalBytes}B`);
return true;
}

exports.handler=async event=>{
const started=Date.now();
try{
const method=(event.httpMethod||"GET").toUpperCase();
log(`REQUEST ${method} path=${event.path||"unknown"}`);

if(method==="OPTIONS"){
return{
statusCode:204,
headers:{
"Access-Control-Allow-Origin":"*",
"Access-Control-Allow-Methods":"GET,POST,OPTIONS",
"Access-Control-Allow-Headers":"Content-Type"
},
body:""
};
}

if(method!=="GET"&&method!=="POST")return json(405,{error:"Method not allowed"});

const store=getStore({
name:STORE_NAME,
siteID:process.env.NETLIFY_SITE_ID,
token:process.env.NETLIFY_AUTH_TOKEN
});

log(`Blob store ready "${STORE_NAME}"`);

if(method==="GET"){
const params=event.queryStringParameters||{};
const key=params.key;
log(`GET key="${key||"missing"}"`);

if(!validKey(key))return json(400,{error:"Invalid cache key"});

const cached=await store.get(key,{type:"json",consistency:"strong"});

if(!cached){
log(`CACHE MISS "${key}" time=${Date.now()-started}ms`);
return json(404,{hit:false});
}

const seasonCount=cached.seasons&&typeof cached.seasons==="object"?Object.keys(cached.seasons).length:0;

log(`CACHE HIT "${key}" seasons=${seasonCount}`);

const index=await getIndex(store);

if(index.entries[key]){
index.entries[key].lastUsed=Date.now();
saveIndex(store,index).then(()=>{
log(`LRU lastUsed updated "${key}"`);
}).catch(error=>{
log(`LRU update failed "${key}": ${error&&error.message||error}`);
});
}

return json(200,{
hit:true,
data:cached
});
}

const rawBody=event.body||"";
const rawBytes=Buffer.byteLength(rawBody,"utf8");

log(`POST body size=${rawBytes}B`);

if(rawBytes>MAX_BODY_BYTES)return json(413,{error:"Payload too large"});

let body;

try{
body=JSON.parse(rawBody);
}catch(error){
return json(400,{error:"Invalid JSON"});
}

const key=body&&body.key;
const value=cleanValue(body&&body.data);

log(`POST key="${key||"missing"}"`);

if(!validKey(key))return json(400,{error:"Invalid cache key"});
if(!value)return json(400,{error:"Invalid cache data"});

const seasonCount=Object.keys(value.seasons).length;
const size=byteSize(value);

log(`POST cleaned "${key}" mal=${value.malId} seasons=${seasonCount} size=${size}B`);

if(size>MAX_CACHE_BYTES){
return json(413,{
error:"Cache entry exceeds 20 MB cache limit"
});
}

const index=await getIndex(store);
const previous=index.entries[key];

if(previous){
const previousSize=Number(previous.size)||0;
index.totalBytes=Math.max(0,index.totalBytes-previousSize);
delete index.entries[key];
log(`Replacing existing entry "${key}" oldSize=${previousSize}B newSize=${size}B`);
}else{
log(`Creating new cache entry "${key}"`);
}

const fits=await deleteOldestTitles(store,index,size);

if(!fits)return json(507,{error:"Cache capacity reached"});

await store.setJSON(key,value);

log(`Blob write SUCCESS "${key}"`);

index.entries[key]={
size,
createdAt:previous?Number(previous.createdAt)||Date.now():Date.now(),
lastUsed:Date.now()
};

index.totalBytes+=size;

await saveIndex(store,index);

log(`POST SUCCESS "${key}" size=${size}B total=${index.totalBytes}B time=${Date.now()-started}ms`);

return json(200,{
ok:true,
key,
size,
totalBytes:index.totalBytes,
maxBytes:MAX_CACHE_BYTES,
seasons:seasonCount
});

}catch(error){
const elapsedMs=Date.now()-started;
console.error("[ANIME CACHE] FATAL",error);
log(`FATAL ERROR after ${elapsedMs}ms: ${error&&error.message?error.message:"Unknown cache service error"}`);
return json(500,{error:"Cache service error"});
}
};
