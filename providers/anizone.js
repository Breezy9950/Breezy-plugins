var __create=Object.create;
var __defProp=Object.defineProperty;
var __defProps=Object.defineProperties;
var __getOwnPropDesc=Object.getOwnPropertyDescriptor;
var __getOwnPropDescs=Object.getOwnPropertyDescriptors;
var __getOwnPropNames=Object.getOwnPropertyNames;
var __getOwnPropSymbols=Object.getOwnPropertySymbols;
var __getProtoOf=Object.getPrototypeOf;
var __hasOwnProp=Object.prototype.hasOwnProperty;
var __propIsEnum=Object.prototype.propertyIsEnumerable;
var __defNormalProp=(obj,key,value)=>key in obj?__defProp(obj,key,{enumerable:true,configurable:true,writable:true,value}):obj[key]=value;
var __spreadValues=(a,b)=>{for(var prop in b||{})if(__hasOwnProp.call(b,prop))__defNormalProp(a,prop,b[prop]);if(__getOwnPropSymbols)for(var prop of __getOwnPropSymbols(b)){if(__propIsEnum.call(b,prop))__defNormalProp(a,prop,b[prop]);}return a;};
var __copyProps=(to,from,except,desc)=>{if(from&&typeof from==="object"||typeof from==="function"){for(let key of __getOwnPropNames(from))if(!__hasOwnProp.call(to,key)&&key!==except)__defProp(to,key,{get:()=>from[key],enumerable:!(desc=__getOwnPropDesc(from,key))||desc.enumerable});}return to;};
var __toESM=(mod,isNodeMode,target)=>(target=mod!=null?__create(__getProtoOf(mod)):{},__copyProps(isNodeMode||!mod||!mod.__esModule?__defProp(target,"default",{value:mod,enumerable:true}):target,mod));
var __async=(__this,__arguments,generator)=>new Promise((resolve,reject)=>{var fulfilled=value=>{try{step(generator.next(value));}catch(e){reject(e);}},rejected=value=>{try{step(generator.throw(value));}catch(e){reject(e);}},step=x=>x.done?resolve(x.value):Promise.resolve(x.value).then(fulfilled,rejected),step=(generator=generator.apply(__this,__arguments)).next();});

var import_cheerio_without_node_native=__toESM(require("cheerio-without-node-native"));

var MAIN_URL="https://anizone.to";
var HEADERS={
"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
"Referer":"https://anizone.to/"
};
var TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
var ANIME_MAPPING_URL="https://breezy-plugins.netlify.app/.netlify/functions/anime-mapping";
var MAPPING_CACHE=new Map;

function fetchWithTimeout(_0){
return __async(this,arguments,function*(url,options={},timeoutMs=10000){
var timer=null;
var timeout=new Promise((_,reject)=>{
timer=setTimeout(()=>reject(new Error("Timeout")),timeoutMs);
});
try{
return yield Promise.race([fetch(url,options),timeout]);
}catch(e){
throw e;
}finally{
if(timer)clearTimeout(timer);
}
});
}

function fetchText(url,options={}){
return __async(this,null,function*(){
try{
var finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
var res=yield fetchWithTimeout(finalUrl,{
...options,
headers:{
...HEADERS,
...(options.headers||{})
}
},10000);
if(!res.ok)return null;
return yield res.text();
}catch(e){
console.log(`[AniZone] Request failed: ${e.message}`);
return null;
}
});
}

function parseXData(raw){
if(!raw)return null;
try{
var cleaned=raw.replace(/\\u0022/g,'"');
return JSON.parse(cleaned);
}catch(e){
console.log(`[AniZone] JSON parse failed: ${e.message}`);
return null;
}
}

function getShinkroMapping(tmdbId,season,episode){
return __async(this,null,function*(){
var key=`${tmdbId}:s${season}:e${episode}`;
if(MAPPING_CACHE.has(key))return MAPPING_CACHE.get(key);
try{
var url=`${ANIME_MAPPING_URL}?tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
console.log(`[AniZone] Shinkro lookup TMDB=${tmdbId} S${season}E${episode}`);
var res=yield fetchWithTimeout(url,{headers:{"Accept":"application/json"}},6000);
console.log(`[AniZone] Shinkro HTTP ${res.status}`);
if(!res.ok)return null;
var body=yield res.json();
if(!body||!body.ok||!body.mapping)return null;
var mapping=body.mapping;
if(!mapping.mal_id||!mapping.mal_episode)return null;
MAPPING_CACHE.set(key,mapping);
if(MAPPING_CACHE.size>300)MAPPING_CACHE.delete(MAPPING_CACHE.keys().next().value);
console.log(`[AniZone] Shinkro mapped "${mapping.anime_title||""}" -> MAL E${mapping.mal_episode}`);
return mapping;
}catch(e){
console.log(`[AniZone] Shinkro lookup failed: ${e.message}`);
return null;
}
});
}

function getTmdbInfo(tmdbId,season){
return __async(this,null,function*(){
try{
var res=yield fetchWithTimeout(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`,{},6000);
if(!res.ok)return null;
var data=yield res.json();
var seasonName="";
if(season){
try{
var sr=yield fetchWithTimeout(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`,{},6000);
if(sr.ok){
var sd=yield sr.json();
seasonName=sd.name||"";
}
}catch(_){}
}
return{
title:data.name||data.original_name||"",
originalTitle:data.original_name||"",
seasonName
};
}catch(e){
console.log(`[AniZone] TMDB lookup failed: ${e.message}`);
return null;
}
});
}

function normalizeTitle(value){
return String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");
}

function searchAniZone(query){
return __async(this,null,function*(){
var url=`${MAIN_URL}/anime?search=${encodeURIComponent(query)}`;
console.log(`[AniZone] Searching "${query}"`);
var html=yield fetchText(url);
if(!html)return[];
var $=import_cheerio_without_node_native.default.load(html);
var data=$("main").children().eq(1);
var divData=data.attr("x-data")||"";
var match=/JSON\.parse\('(.+?)'\)/s.exec(divData);
if(!match){
console.log("[AniZone] Couldn't find anime data while searching");
return[];
}
var parsed=parseXData(match[1]);
if(!Array.isArray(parsed))return[];
var results=[];
for(var item of parsed){
if(!item)continue;
var title=item.main_title;
var img=item.cover;
var href=item.url;
if(!href||!title)continue;
results.push({
name:title,
alias:String(href).replace(/\\/g,""),
imageUrl:img||"",
slug:item.slug||""
});
}
console.log(`[AniZone] Search returned ${results.length} results`);
return results;
});
}

function selectAniZoneResult(results,animeTitle,titles,seasonName){
if(!results.length)return null;

var wanted=[animeTitle,...titles,seasonName].filter(Boolean);

for(var target of wanted){
var nt=normalizeTitle(target);
for(var item of results){
if(normalizeTitle(item.name)===nt)return item;
}
}

var base=normalizeTitle(String(animeTitle||"")
.replace(/\s+(season|saison)\s*\d+.*/i,"")
.replace(/\s+\d+(st|nd|rd|th)\s+season.*/i,""));

var candidates=results.filter(item=>{
var n=normalizeTitle(item.name);
return n.includes(base)||base.includes(n);
});

if(seasonName){
var sn=normalizeTitle(seasonName);
for(var item of candidates){
if(normalizeTitle(item.name).includes(sn))return item;
}
}

return candidates[0]||null;
}

function getAnimeEpisodeLink(aliasId){
return __async(this,null,function*(){
var url=aliasId;
var html=yield fetchText(url);
if(!html)return[];

var $=import_cheerio_without_node_native.default.load(html);
var dataDiv=$("main").children().first();

if(!dataDiv.length){
console.log("[AniZone] Couldn't find the data div for episodes");
return[];
}

var divData=dataDiv.attr("x-data")||"";
var match=/items:\s*JSON\.parse\('(.+?)'\)/s.exec(divData);

if(!match||!match[1]){
console.log("[AniZone] Couldn't find episodes data");
return[];
}

var list=parseXData(match[1]);

if(!Array.isArray(list))return[];

var epList=[];
var i=1;

for(var item of list){
if(!item)continue;

var title=item.title_list&&item.title_list["1"];
var epLink=item.url;

if(!epLink){
console.log(`[AniZone] No episode link for episode ${i}`);
continue;
}

var epImg=item.snapshot?String(item.snapshot).replace(/\\/g,""):null;
var isFiller=String(item.type||"").toLowerCase()==="filler";

epList.push({
episodeLink:String(epLink).replace(/\\/g,""),
episodeNumber:i,
thumbnail:epImg,
episodeTitle:title||"",
isFiller,
hasDub:false
});

i++;
}

console.log(`[AniZone] Episode list: ${epList.length} episodes`);
return epList;
});
}

function getStreamsFromEpisode(episodeId){
return __async(this,null,function*(){
var url=episodeId;
var html=yield fetchText(url);
if(!html)return null;

var $=import_cheerio_without_node_native.default.load(html);
var dataDiv=$("div.mb-8").children().first();
var datas=dataDiv.attr("x-data");

if(!datas){
console.log("[AniZone] Couldn't find data for the stream");
return null;
}

var match=/JSON\.parse\('(.+?)'\)/s.exec(datas);

if(!match||!match[1]){
console.log("[AniZone] Couldn't find anime data");
return null;
}

var streamData=parseXData(match[1]);

if(!streamData)return null;

var src=streamData.src?String(streamData.src).replace(/\\/g,""):null;

if(!src){
console.log("[AniZone] Stream source is empty");
return null;
}

var subtitleList=Array.isArray(streamData.subtitles)?streamData.subtitles:[];

var subs=subtitleList.filter(it=>it&&it.language==="en"&&it.default===true);

var firstSub=subs.length?subs[0]:null;
var firstSubUrl=firstSub&&firstSub.file?String(firstSub.file).replace(/\\/g,""):"";
var subtitleFormat=firstSub&&firstSub.format||"";

var srcName=$("button.flex.gap-2.relative").first().text().trim()||"Default";

return{
url:src,
server:srcName,
subtitles:subtitleList.map(s=>({
url:s&&s.file?String(s.file).replace(/\\/g,""):"",
name:s&&s.title||s&&s.language||"English",
language:s&&s.language||"en",
format:s&&s.format||"",
default:s&&s.default===true
})).filter(s=>s.url),
subtitle:firstSubUrl,
subtitleFormat
};
});
}

function getStreams(tmdbId,mediaType="tv",season=1,episode=1){
return __async(this,null,function*(){
try{
season=parseInt(season,10)||1;
episode=parseInt(episode,10)||1;

console.log(`[AniZone] Querying streams TMDB=${tmdbId} Type=${mediaType} S${season}E${episode}`);

var animeTitle="";
var titles=[];
var mappedEpisode=episode;
var seasonName="";

if(mediaType==="tv"){
var mapping=yield getShinkroMapping(tmdbId,season,episode);

if(mapping){
mappedEpisode=parseInt(mapping.mal_episode,10)||episode;
animeTitle=mapping.anime_title||"";
if(Array.isArray(mapping.titles))titles.push(...mapping.titles);
}

var tmdbInfo=yield getTmdbInfo(tmdbId,season);

if(!animeTitle&&tmdbInfo)animeTitle=tmdbInfo.title;
if(tmdbInfo){
if(tmdbInfo.originalTitle)titles.push(tmdbInfo.originalTitle);
seasonName=tmdbInfo.seasonName||"";
}
}else{
try{
var movieRes=yield fetchWithTimeout(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`,{},6000);
if(movieRes.ok){
var movie=yield movieRes.json();
animeTitle=movie.title||movie.original_title||"";
if(movie.original_title)titles.push(movie.original_title);
}
}catch(_){}
mappedEpisode=1;
}

if(!animeTitle){
console.log("[AniZone] No anime title available");
return[];
}

titles=[...new Set(titles.filter(Boolean))];

var results=yield searchAniZone(animeTitle);

if(!results.length&&titles.length){
for(var title of titles){
if(title===animeTitle)continue;
results=yield searchAniZone(title);
if(results.length)break;
}
}

if(!results.length){
console.log(`[AniZone] No search results for "${animeTitle}"`);
return[];
}

var selected=selectAniZoneResult(results,animeTitle,titles,seasonName);

if(!selected){
console.log(`[AniZone] No matching AniZone result for "${animeTitle}"`);
return[];
}

var alias=selected.alias;

console.log(`[AniZone] Matched "${animeTitle}" -> ${alias}`);

var episodes=yield getAnimeEpisodeLink(alias);

if(!episodes.length){
console.log(`[AniZone] No episodes found for "${animeTitle}"`);
return[];
}

var selectedEpisode=episodes[mappedEpisode-1];

if(!selectedEpisode||!selectedEpisode.episodeLink){
console.log(`[AniZone] Episode E${mappedEpisode} not found; AniZone has ${episodes.length} episodes`);
return[];
}

console.log(`[AniZone] Selected E${mappedEpisode}: ${selectedEpisode.episodeLink}`);

var stream=yield getStreamsFromEpisode(selectedEpisode.episodeLink);

if(!stream||!stream.url){
console.log(`[AniZone] No stream found for E${mappedEpisode}`);
return[];
}

var result={
name:"AniZone",
title:`${animeTitle} - Episode ${mappedEpisode} [${stream.server||"Default"}]`,
url:stream.url,
quality:"multi-quality",
headers:HEADERS,
subtitles:stream.subtitles||[],
subtitle:stream.subtitle||"",
subtitleFormat:stream.subtitleFormat||"",
backup:false
};

console.log("[AniZone] Total streams found: 1");

return[result];

}catch(error){
console.log(`[AniZone] Error: ${error&&error.message||error}`);
return[];
}
});
}

module.exports={getStreams};
