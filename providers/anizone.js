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
var __spreadProps=(a,b)=>__defProps(a,__getOwnPropDescs(b));
var __copyProps=(to,from,except,desc)=>{if(from&&typeof from==="object"||typeof from==="function"){for(let key of __getOwnPropNames(from))if(!__hasOwnProp.call(to,key)&&key!==except)__defProp(to,key,{get:()=>from[key],enumerable:!(desc=__getOwnPropDesc(from,key))||desc.enumerable});}return to;};
var __toESM=(mod,isNodeMode,target)=>(target=mod!=null?__create(__getProtoOf(mod)):{},__copyProps(isNodeMode||!mod||!mod.__esModule?__defProp(target,"default",{value:mod,enumerable:true}):target,mod));
var __async=(__this,__arguments,generator)=>new Promise((resolve,reject)=>{var fulfilled=value=>{try{step(generator.next(value));}catch(e){reject(e);}},rejected=value=>{try{step(generator.throw(value));}},step=x=>x.done?resolve(x.value):Promise.resolve(x.value).then(fulfilled).catch(rejected),step=(generator=generator.apply(__this,__arguments)).next();});

var import_cheerio_without_node_native=__toESM(require("cheerio-without-node-native"));

var MAIN_URL="https://anizone.to";
var HEADERS={
"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
"Referer":"https://anizone.to/"
};
var TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
var ANIME_MAPPING_URL="https://breezy-plugins.netlify.app/.netlify/functions/anime-mapping";
var MAPPING_CACHE=new Map;
var MAPPING_TIMEOUT=6000;

function fetchWithTimeout(_0){
return __async(this,arguments,function* (url,options={},timeoutMs=10000){
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

function fetchAniZone(_0){
return __async(this,arguments,function* (url,options={},timeoutMs=10000){
var finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
try{
var res=yield fetchWithTimeout(finalUrl,{
...options,
headers:{
...HEADERS,
...(options.headers||{})
}
},timeoutMs);
if(!res.ok)return null;
var text=yield res.text();
return{text,cookies:res.headers&&res.headers.get?res.headers.get("set-cookie")||"":""};
}catch(e){
console.log(`[AniZone] Request failed ${finalUrl}: ${e.message}`);
return null;
}
});
}

function sanitizeJson(raw){
if(!raw)return"";
return raw
.replace(/\\u0022/g,'"')
.replace(/\\u0026/g,"&")
.replace(/\\'/g,"'")
.replace(/\\\//g,"/")
.replace(/\\\\/g,"\\")
.replace(/\\&/g,"&")
.replace(/\\0/g,"\\u0000");
}

function getShinkroMapping(tmdbId,season,episode){
return __async(this,null,function*(){
var key=`${tmdbId}:s${season}:e${episode}`;
if(MAPPING_CACHE.has(key))return MAPPING_CACHE.get(key);
try{
var url=`${ANIME_MAPPING_URL}?tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
console.log(`[AniZone] Shinkro lookup TMDB=${tmdbId} S${season}E${episode}`);
var res=yield fetchWithTimeout(url,{headers:{"Accept":"application/json"}},MAPPING_TIMEOUT);
if(!res||!res.ok){
console.log(`[AniZone] Shinkro lookup HTTP ${res&&res.status||"failed"}`);
return null;
}
var body=yield res.json();
if(!body||!body.ok||!body.mapping)return null;
var mapping=body.mapping;
if(!mapping.mal_id||!mapping.mal_episode)return null;
MAPPING_CACHE.set(key,mapping);
if(MAPPING_CACHE.size>300)MAPPING_CACHE.delete(MAPPING_CACHE.keys().next().value);
console.log(`[AniZone] Shinkro mapped "${mapping.anime_title||"?"}" -> MAL=${mapping.mal_id} E${mapping.mal_episode}`);
return mapping;
}catch(e){
console.log(`[AniZone] Shinkro lookup failed: ${e.message}`);
return null;
}
});
}

function getTmdbInfo(tmdbId,mediaType,season=1){
return __async(this,null,function*(){
try{
var type=mediaType==="tv"?"tv":"movie";
var url=`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`;
var res=yield fetchWithTimeout(url,{},6000);
if(!res.ok)return null;
var data=yield res.json();
var info={
title:data.name||data.title||data.original_name||data.original_title||"",
originalTitle:data.original_name||data.original_title||"",
seasonName:""
};
if(mediaType==="tv"&&season){
try{
var sRes=yield fetchWithTimeout(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`,{},6000);
if(sRes.ok){
var sData=yield sRes.json();
info.seasonName=sData.name||"";
}
}catch(_){}
}
return info;
}catch(e){
console.log(`[AniZone] TMDB lookup failed: ${e.message}`);
return null;
}
});
}

function parseSearchResults(html){
var $=import_cheerio_without_node_native.default.load(html);
var data=$("main").children().eq(1);
var divData=data.attr("x-data")||"";
var match=/JSON\.parse\('(.+?)'\)/s.exec(divData);
if(!match){
console.log("[AniZone] Couldn't find anime search data");
return[];
}
try{
var parsed=JSON.parse(sanitizeJson(match[1]));
if(!Array.isArray(parsed))return[];
var results=[];
for(var item of parsed){
if(!item)continue;
var title=item.main_title;
var img=item.cover;
var href=item.url;
if(!href||!title)continue;
var titles=new Set;
titles.add(title);
if(item.title_list&&typeof item.title_list==="object"){
Object.values(item.title_list).forEach(t=>{if(t)titles.add(t);});
}
results.push({
slug:item.slug||String(href).split("/").filter(Boolean).pop(),
url:String(href).replace(/\\/g,""),
title,
titles:[...titles],
imageUrl:img||""
});
}
return results;
}catch(e){
console.log(`[AniZone] Search data parse failed: ${e.message}`);
return[];
}
}

function normalize(value){
return String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");
}

function findAniZoneResult(results,animeTitle,titles,season,seasonName){
if(!results.length)return null;

var targets=[animeTitle,...titles,seasonName]
.filter(Boolean)
.map(normalize);

for(var target of targets){
for(var item of results){
for(var title of item.titles||[item.title]){
if(normalize(title)===target)return item;
}
}
}

var base=normalize(
String(animeTitle||"")
.replace(/\s+(season|saison)\s+\d+.*/i,"")
.replace(/\s+\d+(st|nd|rd|th)\s+season.*/i,"")
.trim()
);

var candidates=results.filter(item=>{
return(item.titles||[item.title]).some(title=>{
var n=normalize(title);
return n.includes(base)||base.includes(n);
});
});

if(season>1){
var seasonPattern=season===2?/season\s*2|saison\s*2|2nd\s*season|\bii\b/i:
season===3?/season\s*3|saison\s*3|3rd\s*season|\biii\b/i:
season===4?/season\s*4|saison\s*4|4th\s*season|\biv\b|final\s*season/i:
new RegExp(`season\\s*${season}|saison\\s*${season}`,"i");

for(var candidate of candidates){
if((candidate.titles||[candidate.title]).some(t=>seasonPattern.test(t)))return candidate;
}
}

if(seasonName){
var sn=normalize(seasonName);
for(var candidate of candidates){
if((candidate.titles||[candidate.title]).some(t=>normalize(t).includes(sn)))return candidate;
}
}

return candidates[0]||results[0]||null;
}

function searchAniZone(animeTitle,titles,season,seasonName){
return __async(this,null,function*(){
var query=String(animeTitle||"").trim();
if(!query)return null;

var url=`${MAIN_URL}/anime?search=${encodeURIComponent(query)}`;
console.log(`[AniZone] Searching "${query}"`);

var response=yield fetchAniZone(url,{},10000);
if(!response)return null;

var results=parseSearchResults(response.text);
console.log(`[AniZone] Search returned ${results.length} results`);

return findAniZoneResult(results,animeTitle,titles,season,seasonName);
});
}

function getEpisodeList(alias){
return __async(this,null,function*(){
var response=yield fetchAniZone(alias,{},10000);
if(!response)return[];

try{
var $=import_cheerio_without_node_native.default.load(response.text);
var dataDiv=$("main").children().first();

if(!dataDiv.length){
console.log("[AniZone] Couldn't find episode data div");
return[];
}

var divData=dataDiv.attr("x-data")||"";
var match=/items:\s*JSON\.parse\('(.+?)'\)/s.exec(divData);

if(!match||!match[1]){
console.log("[AniZone] Couldn't find episodes data");
return[];
}

var list=JSON.parse(sanitizeJson(match[1]));
if(!Array.isArray(list))return[];

var epList=[];
var i=1;

for(var item of list){
if(!item)continue;

var epLink=item.url;

if(!epLink){
console.log(`[AniZone] Episode ${i} has no episode URL`);
continue;
}

var title=item.title_list&&item.title_list["1"]||"";
var epImg=item.snapshot?String(item.snapshot).replace(/\\/g,""):null;
var isFiller=String(item.type||"").toLowerCase()==="filler";

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

console.log(`[AniZone] Episode list found ${epList.length} episodes`);
return epList;
}catch(e){
console.log(`[AniZone] Episode list parse failed: ${e.message}`);
return[];
}
});
}

function parseStreamPage(html){
var $=import_cheerio_without_node_native.default.load(html);
var dataDiv=$("div.mb-8").first().children().first();
var datas=dataDiv.attr("x-data");

if(!datas){
console.log("[AniZone] Couldn't find data for the stream");
return null;
}

var match=/JSON\.parse\('(.+?)'\)/s.exec(datas);

if(!match||!match[1]){
console.log("[AniZone] Couldn't find anime stream data");
return null;
}

try{
var streamData=JSON.parse(sanitizeJson(match[1]));
var src=streamData&&streamData.src?String(streamData.src).replace(/\\/g,""):null;

if(!src)return null;

var subtitleList=Array.isArray(streamData.subtitles)?streamData.subtitles:[];

var subs=subtitleList
.filter(it=>it&&it.language==="en"&&it.default===true);

var firstSub=subs.length?subs[0]:null;
var firstSubUrl=firstSub&&firstSub.file?String(firstSub.file).replace(/\\/g,""):"";
var subtitleFormat=firstSub&&firstSub.format||"";

var srcName=$("button.flex.gap-2.relative").first().text().trim()||"Default";

return{
masterUrl:src,
subtitles:subtitleList.map(s=>({
url:s&&s.file?String(s.file).replace(/\\/g,""):"",
name:s&&s.title||s&&s.language||"English",
language:s&&s.language||"en",
format:s&&s.format||"",
default:s&&s.default===true
})).filter(s=>s.url),
defaultSubtitle:firstSubUrl,
subtitleFormat,
serverName:srcName
};
}catch(e){
console.log(`[AniZone] Stream extraction failed: ${e.message}`);
return null;
}
}

function getEpisodeStream(episodeLink){
return __async(this,null,function*(){
var response=yield fetchAniZone(episodeLink,{},10000);
if(!response)return null;
var parsed=parseStreamPage(response.text);
if(!parsed)return null;
return parsed;
});
}

function getStreamsFromParsed(animeTitle,mappedEp,parsed){
if(!parsed||!parsed.masterUrl)return[];

return[{
name:"AniZone",
title:`${animeTitle} - Episode ${mappedEp} [${parsed.serverName||"Default"}]`,
url:parsed.masterUrl,
quality:"multi-quality",
headers:HEADERS,
subtitles:parsed.subtitles||[],
subtitle:parsed.defaultSubtitle||"",
subtitleFormat:parsed.subtitleFormat||"",
backup:false
}];
}

function resolveMapping(tmdbId,season,episode){
return __async(this,null,function*(){
var mapping=yield getShinkroMapping(tmdbId,season,episode);
if(mapping)return mapping;

console.log(`[AniZone] Shinkro mapping unavailable for TMDB=${tmdbId} S${season}E${episode}; legacy fallback`);

return null;
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
var seasonName="";
var mappedEp=episode;

if(mediaType==="tv"){
var mapping=yield resolveMapping(tmdbId,season,episode);

if(mapping){
mappedEp=parseInt(mapping.mal_episode,10)||episode;
animeTitle=mapping.anime_title||"";
if(Array.isArray(mapping.titles))titles.push(...mapping.titles);
console.log(`[AniZone] Mapping resolved "${animeTitle}" S${season}E${episode} -> E${mappedEp}`);
}

if(!animeTitle){
var tmdbInfo=yield getTmdbInfo(tmdbId,"tv",season);
if(tmdbInfo){
animeTitle=tmdbInfo.title||tmdbInfo.originalTitle||"";
if(tmdbInfo.originalTitle)titles.push(tmdbInfo.originalTitle);
seasonName=tmdbInfo.seasonName||"";
}
}

}else{
var movieInfo=yield getTmdbInfo(tmdbId,"movie");
if(movieInfo){
animeTitle=movieInfo.title||movieInfo.originalTitle||"";
if(movieInfo.originalTitle)titles.push(movieInfo.originalTitle);
}
mappedEp=1;
}

titles=[...new Set([animeTitle,...titles].filter(Boolean))];

if(!animeTitle){
console.log("[AniZone] No anime title available");
return[];
}

var card=yield searchAniZone(animeTitle,titles,season,seasonName);

if(!card){
console.log(`[AniZone] No AniZone result found for "${animeTitle}"`);
return[];
}

var alias=card.url||`${MAIN_URL}/anime/${card.slug}`;

console.log(`[AniZone] Matched "${animeTitle}" -> ${alias}`);

var episodes=yield getEpisodeList(alias);

if(!episodes.length){
console.log(`[AniZone] No episodes found for "${animeTitle}"`);
return[];
}

var selected=episodes[mappedEp-1];

if(!selected||!selected.episodeLink){
console.log(`[AniZone] Episode E${mappedEp} not found; AniZone has ${episodes.length} episodes`);
return[];
}

console.log(`[AniZone] Selected episode E${mappedEp}: ${selected.episodeLink}`);

var parsed=yield getEpisodeStream(selected.episodeLink);

if(!parsed||!parsed.masterUrl){
console.log(`[AniZone] No stream found for E${mappedEp}`);
return[];
}

var streams=getStreamsFromParsed(animeTitle,mappedEp,parsed);

console.log(`[AniZone] Total streams found: ${streams.length}`);

return streams;

}catch(error){
console.log(`[AniZone] Error: ${error&&error.message||error}`);
return[];
}
});
}

module.exports={getStreams};
