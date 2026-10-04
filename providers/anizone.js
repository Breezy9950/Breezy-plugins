var __async=(__this,__arguments,generator)=>new Promise((resolve,reject)=>{var fulfilled=value=>{try{step(generator.next(value));}catch(e){reject(e);}},rejected=value=>{try{step(generator.throw(value));}catch(e){reject(e);}},step=x=>x.done?resolve(x.value):Promise.resolve(x.value).then(fulfilled,rejected),step=(generator=generator.apply(__this,__arguments)).next();});
var import_cheerio_without_node_native=require("cheerio-without-node-native");

var MAIN_URL="https://anizone.to";
var HEADERS={
"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
"Referer":"https://anizone.to/"
};
var ANIME_MAPPING_URL="https://breezy-plugins.netlify.app/.netlify/functions/anime-mapping";
var TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
var MAPPING_CACHE=new Map;

function fetchWithTimeout(_0){
return __async(this,arguments,function*(url,options={},timeoutMs=10000){
let timer=null;
const timeout=new Promise((_,reject)=>{
timer=setTimeout(()=>reject(new Error("Timeout")),timeoutMs);
});
try{
const res=yield Promise.race([fetch(url,options),timeout]);
clearTimeout(timer);
return res;
}catch(e){
clearTimeout(timer);
throw e;
}
});
}

function fetchText(_0){
return __async(this,arguments,function*(url){
const finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
try{
const res=yield fetchWithTimeout(finalUrl,{headers:HEADERS},10000);
if(!res.ok)return"";
return yield res.text();
}catch(e){
return"";
}
});
}

/* ONLY ADDITION: TMDB -> Netlify Shinkro mapper */
function getMapping(tmdbId,season,episode){
return __async(this,null,function*(){
const key=`${tmdbId}:s${season}:e${episode}`;
if(MAPPING_CACHE.has(key))return MAPPING_CACHE.get(key);
try{
const url=`${ANIME_MAPPING_URL}?tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
console.log(`[AniZone] Mapper lookup TMDB=${tmdbId} S${season}E${episode}`);
const res=yield fetchWithTimeout(url,{headers:{"Accept":"application/json"}},6000);
if(!res.ok){
console.log(`[AniZone] Mapper HTTP ${res.status}`);
return null;
}
const body=yield res.json();
if(!body||!body.ok||!body.mapping){
console.log(`[AniZone] Mapper returned no mapping`);
return null;
}
const mapping=body.mapping;
if(!mapping.mal_id||!mapping.mal_episode){
console.log(`[AniZone] Mapper returned incomplete mapping`);
return null;
}
MAPPING_CACHE.set(key,mapping);
console.log(`[AniZone] Mapper hit: ${mapping.anime_title||"unknown"} -> MAL ${mapping.mal_id} E${mapping.mal_episode}`);
return mapping;
}catch(e){
console.log(`[AniZone] Mapper failed: ${e.message}`);
return null;
}
});
}

function parseSearchData($){
const data=$("main").children().eq(1);
const divData=data.attr("x-data")||"";
const matchRegEx=/JSON\.parse\('(.+?)'\)/s;
const match=matchRegEx.exec(divData);
if(!match)throw new Error("Couldn't find anime data while searching");
const parsedJson=JSON.parse(match[1].replace(/\\u0022/g,'"'));
const results=[];
for(const item of parsedJson){
const title=item.main_title;
const img=item.cover;
const href=item.url;
if(!img||!href||!title)continue;
results.push({
name:title,
alias:String(href).replace(/\\/g,""),
imageUrl:img
});
}
return results;
}

function search(_0){
return __async(this,arguments,function*(query){
const url=`${MAIN_URL}/anime?search=${encodeURIComponent(query)}`;
const html=yield fetchText(url);
if(!html)return[];
try{
const $=import_cheerio_without_node_native.load(html);
return parseSearchData($);
}catch(e){
console.log(`[AniZone] Search parse failed: ${e.message}`);
return[];
}
});
}

function normalizeTitle(str){
return String(str||"").toLowerCase().replace(/[^a-z0-9]/g,"");
}

function findAnime(results,mapping,tmdbTitle,season){
if(!results.length)return null;

const mappedTitle=String(mapping?.anime_title||"");
const titles=Array.isArray(mapping?.titles)?mapping.titles:[];
const wanted=[mappedTitle,...titles,tmdbTitle].filter(Boolean).map(normalizeTitle);

for(const item of results){
const n=normalizeTitle(item.name);
if(wanted.includes(n))return item;
}

for(const item of results){
const n=normalizeTitle(item.name);
if(wanted.some(t=>t&&((n.includes(t)||t.includes(n)))))return item;
}

if(season===1){
const bad=[
/season\s*[2-9]/i,
/saison\s*[2-9]/i,
/2nd\s*season/i,
/3rd\s*season/i,
/4th\s*season/i,
/final\s*season/i,
/movie/i,
/gekijouban/i
];
for(const item of results){
if(!bad.some(r=>r.test(item.name)))return item;
}
}

const seasonPatterns=[
new RegExp(`season\\s*${season}`,"i"),
new RegExp(`saison\\s*${season}`,"i"),
new RegExp(`${season}(?:st|nd|rd|th)\\s*season`,"i"),
new RegExp(`\\b${season}\\b`,"i")
];

for(const item of results){
if(seasonPatterns.some(r=>r.test(item.name)))return item;
}

return results[0]||null;
}

function searchAnime(query,mapping,tmdbTitle,season){
return __async(this,arguments,function*(){
let results=yield search(query);
let found=findAnime(results,mapping,tmdbTitle,season);
if(found)return found;

if(mapping?.anime_title&&mapping.anime_title!==query){
results=yield search(mapping.anime_title);
found=findAnime(results,mapping,tmdbTitle,season);
if(found)return found;
}

for(const title of Array.isArray(mapping?.titles)?mapping.titles:[]){
if(!title)continue;
results=yield search(title);
found=findAnime(results,mapping,tmdbTitle,season);
if(found)return found;
}

return null;
});
}

function fetchAnimeEpisodeList(alias){
return __async(this,null,function*(){
const url=alias;
const res=yield fetchWithTimeout(url,{headers:HEADERS},10000);
if(!res.ok)throw new Error("Couldn't fetch anime page");
const html=yield res.text();
const $=import_cheerio_without_node_native.load(html);
const dataDiv=$("main").children().first();
if(!dataDiv.length)throw new Error("Coudlnt find the data div for episodes.");
const divData=dataDiv.attr("x-data")||"";
const matchRegEx=/items:\s*JSON\.parse\('(.+?)'\)/s;
const match=matchRegEx.exec(divData);
if(!match||!match[1])throw new Error("Couldn't find episodes data");
const matchedStr=match[1].replace(/\\u0022/g,'"');
const list=JSON.parse(matchedStr);
const epList=[];
let i=1;
for(const item of list){
const title=item.title_list?.["1"];
const epLink=item.url;
if(!epLink){
console.log("[AniZone] No epLink for episode");
continue;
}
const epImg=item.snapshot?.replace(/\\/g,"");
const isFiller=String(item.type||"").toLowerCase()==="filler";
epList.push({
episodeLink:String(epLink).replace(/\\/g,""),
episodeNumber:i,
thumbnail:epImg,
episodeTitle:title,
isFiller,
hasDub:false
});
i++;
}
return epList;
});
}

function fetchEpisodePage(episodeId){
return __async(this,null,function*(){
const url=episodeId;
const res=yield fetchWithTimeout(url,{headers:HEADERS},10000);
if(!res.ok)throw new Error("Couldn't fetch episode page");
const html=yield res.text();
const $=import_cheerio_without_node_native.load(html);
const dataDiv=$("div.mb-8").children().first();
const datas=dataDiv.attr("x-data");
if(!datas)throw new Error("Couldnt find data for the stream");
const matchRegEx=/JSON\.parse\('(.+?)'\)/s;
const match=matchRegEx.exec(datas);
if(!match||!match[1])throw new Error("Couldn't find anime data");
const streamData=JSON.parse(match[1].replace(/\\u0022/g,'"'));
const src=streamData.src?.replace(/\\/g,"");
if(!src)throw new Error("No stream source");
const subtitles=Array.isArray(streamData.subtitles)?streamData.subtitles:[];
const subs=subtitles.filter(it=>it.language==="en"&&it.default===true);
const firstSub=subs[0];
const firstSubUrl=firstSub?.file?.replace(/\\/g,"")||"";
const srcName=$("button.flex.gap-2.relative").first().text().trim()||"Default";
return{
src,
subtitles,
firstSubUrl,
subtitleFormat:firstSub?.format||"",
srcName
};
});
}

function getTmdbTitle(tmdbId){
return __async(this,null,function*(){
try{
const url=`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
const res=yield fetchWithTimeout(url,{},5000);
if(!res.ok)return"";
const data=yield res.json();
return data.name||data.original_name||"";
}catch(e){
return"";
}
});
}

function getStreams(tmdbId,mediaType="tv",season=1,episode=1){
return __async(this,null,function*(){
try{
season=parseInt(season,10)||1;
episode=parseInt(episode,10)||1;

console.log(`[AniZone] Querying TMDB=${tmdbId} S${season}E${episode}`);

if(mediaType!=="tv"){
console.log("[AniZone] AniStream AniZone provider expects TV anime");
return[];
}

/* Mapper is the ONLY non-AniStream addition */
const mapping=yield getMapping(tmdbId,season,episode);

let mappedEpisode=episode;
let animeTitle="";
let targetTitles=[];

if(mapping){
mappedEpisode=parseInt(mapping.mal_episode,10)||episode;
animeTitle=mapping.anime_title||"";
if(Array.isArray(mapping.titles))targetTitles.push(...mapping.titles);
}

const tmdbTitle=yield getTmdbTitle(tmdbId);

if(!animeTitle)animeTitle=tmdbTitle;
if(tmdbTitle)targetTitles.push(tmdbTitle);
if(animeTitle)targetTitles.push(animeTitle);

targetTitles=[...new Set(targetTitles.filter(Boolean))];

if(!animeTitle){
console.log("[AniZone] No anime title available");
return[];
}

console.log(`[AniZone] Searching AniZone for "${animeTitle}"`);

let query=animeTitle;
const colonIndex=query.indexOf(":");
if(colonIndex>0)query=query.substring(0,colonIndex).trim();

let anime=yield searchAnime(query,mapping,tmdbTitle,season);

if(!anime&&query!==animeTitle){
anime=yield searchAnime(animeTitle,mapping,tmdbTitle,season);
}

if(!anime){
for(const title of targetTitles){
if(!title)continue;
anime=yield searchAnime(title,mapping,tmdbTitle,season);
if(anime)break;
}
}

if(!anime){
console.log(`[AniZone] Couldn't find AniZone anime for "${animeTitle}"`);
return[];
}

console.log(`[AniZone] AniZone match: ${anime.name} -> ${anime.alias}`);

const episodeList=yield fetchAnimeEpisodeList(anime.alias);

if(!episodeList.length){
console.log("[AniZone] No episodes found");
return[];
}

const selectedEpisode=episodeList[mappedEpisode-1];

if(!selectedEpisode){
console.log(`[AniZone] Episode E${mappedEpisode} not found; AniZone has ${episodeList.length} episodes`);
return[];
}

console.log(`[AniZone] Selected AniZone E${mappedEpisode}: ${selectedEpisode.episodeLink}`);

const streamData=yield fetchEpisodePage(selectedEpisode.episodeLink);

if(!streamData?.src){
console.log("[AniZone] No stream source found");
return[];
}

const streams=[{
name:"AniZone",
title:`${animeTitle} - Episode ${mappedEpisode} [${streamData.srcName}]`,
url:streamData.src,
quality:"multi-quality",
headers:HEADERS,
subtitles:streamData.subtitles.map(s=>({
url:s.file?.replace(/\\/g,"")||"",
name:s.title||s.language||"English",
language:s.language||"en",
format:s.format||"",
default:s.default===true
})).filter(s=>s.url),
subtitle:streamData.firstSubUrl,
subtitleFormat:streamData.subtitleFormat,
backup:false
}];

console.log(`[AniZone] Total streams found: ${streams.length}`);
return streams;

}catch(error){
console.log(`[AniZone] Error: ${error?.message||error}`);
return[];
}
});
}

module.exports={getStreams};
