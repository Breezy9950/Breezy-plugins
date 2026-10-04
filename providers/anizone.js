var __async=(__this,__arguments,generator)=>new Promise((resolve,reject)=>{var fulfilled=value=>{try{step(generator.next(value));}catch(e){reject(e);}},rejected=value=>{try{step(generator.throw(value));}catch(e){reject(e);}},step=x=>x.done?resolve(x.value):Promise.resolve(x.value).then(fulfilled,rejected),step=(generator=generator.apply(__this,__arguments)).next();});
var cheerio=require("cheerio-without-node-native");
var MAIN_URL="https://anizone.to";
var HEADERS={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36","Referer":"https://anizone.to/"};
var ANIME_MAPPING_URL="https://breezy-plugins.netlify.app/.netlify/functions/anime-mapping";
var TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
var MAPPING_CACHE=new Map;

function fetchWithTimeout(_0){
return __async(this,arguments,function*(url,options={},timeoutMs=10000){
let timer=null;
const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Timeout"),timeoutMs);});
try{const res=yield Promise.race([fetch(url,options),timeout]);clearTimeout(timer);return res;}catch(e){clearTimeout(timer);throw e;}
});
}
function fetchWithCookies(url,timeoutMs=10000){
return __async(this,null,function*(){
const finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
try{
const res=yield fetchWithTimeout(finalUrl,{headers:HEADERS},timeoutMs);
if(!res.ok)return{html:"",cookies:"",ok:false};
let cookies="";
try{
if(typeof res.headers?.getSetCookie==="function")cookies=res.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
else cookies=res.headers?.get("set-cookie")||"";
}catch(e){}
return{html:yield res.text(),cookies,ok:true};
}catch(e){return{html:"",cookies:"",ok:false};}
});
}
function fetchPage(url,timeoutMs=10000){
return __async(this,null,function*(){
const finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
const res=yield fetchWithTimeout(finalUrl,{headers:HEADERS},timeoutMs);
if(!res.ok)throw new Error(`HTTP ${res.status}`);
return{url:finalUrl,html:yield res.text()};
});
}
function parseJsonString(raw){
return JSON.parse(String(raw||"").replace(/\\u0022/g,'"').replace(/\\u0026/g,"&").replace(/\\'/g,"'").replace(/\\\//g,"/").replace(/\\\\/g,"\\").replace(/\\&/g,"&"));
}
function getMapping(tmdbId,season,episode){
return __async(this,null,function*(){
const key=`${tmdbId}:s${season}:e${episode}`;
if(MAPPING_CACHE.has(key))return MAPPING_CACHE.get(key);
try{
const url=`${ANIME_MAPPING_URL}?tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
console.log(`[AniZone] Mapper lookup TMDB=${tmdbId} S${season}E${episode}`);
const res=yield fetchWithTimeout(url,{headers:{"Accept":"application/json"}},6000);
if(!res.ok){console.log(`[AniZone] Mapper HTTP ${res.status}`);return null;}
const body=yield res.json();
if(!body||!body.ok||!body.mapping){console.log("[AniZone] Mapper returned no mapping");return null;}
const mapping=body.mapping;
if(!mapping.mal_id||!mapping.mal_episode){console.log("[AniZone] Mapper returned incomplete mapping");return null;}
MAPPING_CACHE.set(key,mapping);
console.log(`[AniZone] Mapper hit: ${mapping.anime_title||"unknown"} -> MAL ${mapping.mal_id} E${mapping.mal_episode}`);
return mapping;
}catch(e){console.log(`[AniZone] Mapper failed: ${e.message}`);return null;}
});
}
function normalizeTitle(str){return String(str||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function parseSearchData(html){
const $=cheerio.load(html);
const data=$("main").children().eq(1);
const divData=data.attr("x-data")||"";
const match=/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/s.exec(divData);
if(!match)throw new Error("Couldn't find anime data while searching");
const parsed=parseJsonString(match[1]);
const results=[];
for(const item of Array.isArray(parsed)?parsed:[]){
const title=item?.main_title,img=item?.cover,href=item?.url;
if(!title||!href)continue;
results.push({name:String(title),alias:String(href).replace(/\\/g,""),imageUrl:img||""});
}
return results;
}
function search(query){
return __async(this,null,function*(){
if(!query)return[];
try{
const page=yield fetchPage(`/anime?search=${encodeURIComponent(query)}`);
return parseSearchData(page.html);
}catch(e){console.log(`[AniZone] Search failed "${query}": ${e.message}`);return[];}
});
}
function findAnimePrimary(results,mapping,tmdbTitle,season){
if(!results.length)return null;
const wanted=[mapping?.anime_title,...Array.isArray(mapping?.titles)?mapping.titles:[],tmdbTitle].filter(Boolean).map(normalizeTitle);
for(const item of results){
const n=normalizeTitle(item.name);
if(wanted.includes(n))return item;
}
for(const item of results){
const n=normalizeTitle(item.name);
if(wanted.some(t=>t&&(n.includes(t)||t.includes(n))))return item;
}
if(season===1){
const bad=[/season\s*[2-9]/i,/saison\s*[2-9]/i,/[\s\-][iI]{2,}/,/\s+[2-9](?:nd|rd|th)/i,/\s+ii\b/i,/\s+iii\b/i,/\s+iv\b/i,/\s+v\b/i,/movie/i,/gekijouban/i,/the movie/i];
for(const item of results)if(!bad.some(r=>r.test(item.name)))return item;
}
const patterns=[new RegExp(`season\\s*${season}`,"i"),new RegExp(`saison\\s*${season}`,"i"),new RegExp(`${season}(?:st|nd|rd|th)\\s*season`,"i"),new RegExp(`\\b${season}\\b`,"i")];
for(const item of results)if(patterns.some(r=>r.test(item.name)))return item;
return results[0]||null;
}
function searchAnimePrimary(query,mapping,tmdbTitle,season){
return __async(this,null,function*(){
const queries=[];
const add=q=>{if(q&&!queries.includes(q))queries.push(q);};
add(query);add(mapping?.anime_title);
for(const t of Array.isArray(mapping?.titles)?mapping.titles:[])add(t);
add(tmdbTitle);
for(const q of queries){
const results=yield search(q);
const found=findAnimePrimary(results,mapping,tmdbTitle,season);
if(found)return found;
}
return null;
});
}
function parseEpisodeList(html){
const $=cheerio.load(html);
const dataDiv=$("main").children().first();
const divData=dataDiv.attr("x-data")||"";
const match=/items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/s.exec(divData);
if(!match||!match[1])throw new Error("Couldn't find episodes data");
const list=parseJsonString(match[1]);
const episodes=[];
let i=1;
for(const item of Array.isArray(list)?list:[]){
const epLink=item?.url;
if(!epLink)continue;
episodes.push({episodeLink:String(epLink).replace(/\\/g,""),episodeNumber:i,thumbnail:item?.snapshot?String(item.snapshot).replace(/\\/g,""):null,episodeTitle:item?.title_list?.["1"],isFiller:String(item?.type||"").toLowerCase()==="filler",hasDub:false});
i++;
}
return episodes;
}
function fetchAnimeEpisodeList(alias){
return __async(this,null,function*(){return parseEpisodeList((yield fetchPage(alias)).html);});
}
function parseAniStreamStream(html){
const $=cheerio.load(html);
const dataDiv=$("div.mb-8").children().first();
const datas=dataDiv.attr("x-data");
if(!datas)throw new Error("Couldnt find the data div for the stream");
const match=/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/s.exec(datas);
if(!match||!match[1])throw new Error("Couldn't find anime data");
const streamData=parseJsonString(match[1]);
const src=streamData?.src?String(streamData.src).replace(/\\/g,""):"";
if(!src)throw new Error("No stream source");
const subtitles=Array.isArray(streamData.subtitles)?streamData.subtitles:[];
const subs=subtitles.filter(it=>it&&it.language==="en"&&it.default===true);
const firstSub=subs[0];
return{src,subtitles,firstSubUrl:firstSub?.file?String(firstSub.file).replace(/\\/g,""):"",subtitleFormat:firstSub?.format||"",srcName:$("button.flex.gap-2.relative").first().text().trim()||"Default"};
}
function parseFallbackDefaultStream(html,$){
let masterUrl=null;
let subtitles=[];
const vidMatch=html.match(/vidstackPlayer\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/);
if(vidMatch){
try{
const data=parseJsonString(vidMatch[1]);
if(data?.src)masterUrl=String(data.src).replace(/\\/g,"");
if(Array.isArray(data?.subtitles))subtitles=data.subtitles.map(s=>({url:s?.file?String(s.file).replace(/\\/g,""):"",name:s?.title||s?.language||"English",language:s?.language||"en",format:s?.format||"",default:s?.default===true})).filter(s=>s.url);
}catch(e){}
}
if(!masterUrl){
const mediaSrc=$("media-player").attr("src");
if(mediaSrc)masterUrl=String(mediaSrc).replace(/\\/g,"");
}
if(!masterUrl){
const urlMatch=html.match(/https:\/\/[^"']+\/master\.m3u8/);
if(urlMatch)masterUrl=urlMatch[0];
}
$("track").each((i,el)=>{
const src=$(el).attr("src");
const kind=$(el).attr("kind");
if(src&&(kind==="subtitles"||kind==="captions"||src.endsWith(".ass")||src.endsWith(".vtt")))subtitles.push({url:src,name:$(el).attr("label")||"English",language:$(el).attr("srclang")||"en",format:src.endsWith(".ass")?"ass":src.endsWith(".vtt")?"vtt":"",default:false});
});
return{masterUrl,subtitles};
}
function makeStream(title,episode,data,backup){
return{name:"AniZone",title:`${title} - Episode ${episode} [${data.srcName||"Default"}${backup?" - Fallback":""}]`,url:data.src||data.masterUrl,quality:"multi-quality",headers:HEADERS,subtitles:(data.subtitles||[]).map(s=>({url:s?.file?String(s.file).replace(/\\/g,""):s?.url||"",name:s?.title||s?.name||s?.language||"English",language:s?.language||"en",format:s?.format||"",default:s?.default===true})).filter(s=>s.url),subtitle:data.firstSubUrl||null,subtitleFormat:data.subtitleFormat||null,backup:!!backup};
}
function getTmdbTitle(tmdbId){
return __async(this,null,function*(){
try{
const res=yield fetchWithTimeout(`https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(TMDB_API_KEY)}`,{"headers":{"Accept":"application/json"}},5000);
if(!res.ok)return"";
const data=yield res.json();
return data?.name||data?.original_name||"";
}catch(e){return"";}
});
}
function primaryStreams(tmdbId,season,episode,mapping,tmdbTitle){
return __async(this,null,function*(){
const animeTitle=mapping?.anime_title||tmdbTitle||"";
if(!animeTitle)throw new Error("No anime title available");
let query=animeTitle;
const colonIndex=query.indexOf(":");
if(colonIndex>0)query=query.substring(0,colonIndex).trim();
const anime=yield searchAnimePrimary(query,mapping,tmdbTitle,season);
if(!anime)throw new Error(`AniZone anime not found for "${animeTitle}"`);
console.log(`[AniZone] Primary match: ${anime.name} -> ${anime.alias}`);
const episodes=yield fetchAnimeEpisodeList(anime.alias);
const mappedEpisode=parseInt(mapping?.mal_episode,10)||episode;
const selected=episodes[mappedEpisode-1];
if(!selected)throw new Error(`AniZone primary episode E${mappedEpisode} not found (${episodes.length} episodes)`);
console.log(`[AniZone] Primary selected E${mappedEpisode}: ${selected.episodeLink}`);
const data=parseAniStreamStream((yield fetchPage(selected.episodeLink)).html);
if(!data?.src)throw new Error("AniStream primary returned no source");
return[makeStream(animeTitle,mappedEpisode,data,false)];
});
}
function parseCardsFallback(html){
const $=cheerio.load(html);
const cards=[];
const itemsMatch=html.match(/items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
if(itemsMatch){
try{
const parsed=parseJsonString(itemsMatch[1]);
if(Array.isArray(parsed))for(const item of parsed){
if(!item?.slug)continue;
const titles=new Set;
if(item.main_title)titles.add(item.main_title);
if(item.title_list&&typeof item.title_list==="object")Object.values(item.title_list).forEach(t=>{if(t)titles.add(t);});
cards.push({slug:item.slug,url:item.url||`/anime/${item.slug}`,titles:[...titles]});
}
}catch(e){}
}
if(!cards.length){
$('[x-data*="anmTitles"]').each((i,el)=>{
const href=$(el).find('a[href*="/anime/"]').first().attr("href");
if(!href)return;
const parts=href.split("/");
const slug=parts[parts.length-1]||parts[parts.length-2];
const titles=new Set;
const xData=$(el).attr("x-data")||"";
const m=xData.match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
if(m)try{const parsed=parseJsonString(m[1]);Object.values(parsed).forEach(t=>{if(t)titles.add(t);});}catch(e){}
cards.push({slug,titles:[...titles]});
});
}
return cards;
}
function getSeasonRegexes(season){
if(season===1)return{mustNot:[/season\s*[2-9]/i,/saison\s*[2-9]/i,/[\s\-][iI]{2,}/,/\s+[2-9]nd/i,/\s+[2-9]rd/i,/\s+[2-9]th/i,/\s+ii\b/i,/\s+iii\b/i,/\s+iv\b/i,/\s+v\b/i,/movie/i,/gekijouban/i,/the movie/i]};
const patterns=[];
if(season===2)patterns.push(/season\s*2/i,/saison\s*2/i,/2nd\s*season/i,/[\s\-]ii\b/i,/\b2\b/);
else if(season===3)patterns.push(/season\s*3/i,/saison\s*3/i,/3rd\s*season/i,/[\s\-]iii\b/i,/\b3\b/);
else if(season===4)patterns.push(/season\s*4/i,/saison\s*4/i,/4th\s*season/i,/[\s\-]iv\b/i,/\b4\b/,/final\s*season/i);
else patterns.push(new RegExp(`(?:season|saison)\\s*${season}`,"i"),new RegExp(`\\b${season}\\b`));
return{must:patterns};
}
function matchCardFallback(cards,targetTitles,baseTitle,season,seasonName=""){
const normalizedTargets=targetTitles.map(normalizeTitle).filter(Boolean);
const normalizedBase=normalizeTitle(baseTitle);
const normalizedSeasonName=normalizeTitle(seasonName);
if(normalizedSeasonName&&normalizedSeasonName!=="season"+season){
for(const card of cards)for(const title of card.titles)if(normalizeTitle(title).includes(normalizedSeasonName))return card.slug;
}
for(const target of normalizedTargets)for(const card of cards)for(const title of card.titles)if(normalizeTitle(title)===target)return card.slug;
const rules=getSeasonRegexes(season);
for(const card of cards){
let matchesBase=false;
for(const title of card.titles){
const norm=normalizeTitle(title);
if(norm.includes(normalizedBase)||normalizedBase.includes(norm)){matchesBase=true;break;}
}
if(!matchesBase)continue;
let seasonMatches=false;
if(season===1)seasonMatches=!card.titles.some(title=>rules.mustNot.some(regex=>regex.test(title)));
else seasonMatches=card.titles.some(title=>rules.must.some(regex=>regex.test(title)));
if(seasonMatches)return card.slug;
}
return cards[0]?.slug||null;
}
function parseAudioFormat(btnText){
const lower=String(btnText||"").toLowerCase();
const hasJap=lower.includes("japanese")||lower.includes("jpn")||lower.includes("ja");
const hasEng=lower.includes("english")||lower.includes("eng")||lower.includes("en");
if(hasEng&&hasJap)return"Dual Audio";
if(hasEng)return"Dub";
if(hasJap)return"Sub";
if(lower.includes("multi"))return"Multi-Audio";
return"Sub";
}
function searchCardsFallback(query){
return __async(this,null,function*(){
if(!query)return[];
try{
const page=yield fetchPage(`/anime?search=${encodeURIComponent(query)}`);
return parseCardsFallback(page.html);
}catch(e){console.log(`[AniZone] Fallback search failed "${query}": ${e.message}`);return[];}
});
}
function fallbackFindAnime(tmdbTitle,mapping,season){
return __async(this,null,function*(){
const animeTitle=mapping?.anime_title||tmdbTitle||"";
const titles=[...Array.isArray(mapping?.titles)?mapping.titles:[],animeTitle,tmdbTitle].filter(Boolean);
const queries=[];
for(const t of titles){
let q=String(t).split(":")[0].trim();
if(q&&!queries.includes(q))queries.push(q);
}
for(const q of queries){
const cards=yield searchCardsFallback(q);
const slug=matchCardFallback(cards,titles,animeTitle,season);
if(slug)return{slug,query:q,cards};
}
return null;
});
}
function fallbackFetchEpisodePage(episodeUrl){
return __async(this,null,function*(){
const page=yield fetchWithCookies(episodeUrl,10000);
if(!page.ok||!page.html)throw new Error("Couldn't fetch fallback episode page");
return{html:page.html,$:cheerio.load(page.html),cookies:page.cookies||""};
});
}
function fallbackExtractStreams(animeTitle,mappedEpisode,episodeUrl){
return __async(this,null,function*(){
const ep=yield fallbackFetchEpisodePage(episodeUrl);
const $ep=ep.$;
const defaultStream=parseFallbackDefaultStream(ep.html,$ep);
const streams=[];
const serverButtons=$ep('button[wire\\:click*="setVideo"]');
let defaultFormat="Sub",defaultServerName="AniZone";
if(serverButtons.length>0){
const firstBtn=serverButtons.first();
const btnText=firstBtn.text().replace(/\s+/g," ").trim();
defaultFormat=parseAudioFormat(btnText);
const nameMatch=btnText.match(/^([A-Za-z0-9_-]+)/);
if(nameMatch)defaultServerName=nameMatch[1];
}
if(defaultStream.masterUrl){
streams.push(makeStream(animeTitle,mappedEpisode,{masterUrl:defaultStream.masterUrl,subtitles:defaultStream.subtitles,srcName:defaultServerName},true));
}
if(serverButtons.length>1){
const csrfToken=$ep("script[data-csrf]").attr("data-csrf");
const snapshotEl=$ep("main > div[wire\\:snapshot], main > ul[wire\\:snapshot], [wire\\:snapshot]");
const snapshot=snapshotEl.attr("wire:snapshot");
if(csrfToken&&snapshot){
for(let i=1;i<serverButtons.length;i++){
const btn=serverButtons.eq(i);
const clickAttr=btn.attr("wire:click")||"";
const vMatch=clickAttr.match(/setVideo\((\d+)\)/);
if(!vMatch)continue;
const videoId=parseInt(vMatch[1],10);
const btnText=btn.text().replace(/\s+/g," ").trim();
const sFormat=parseAudioFormat(btnText);
const nameMatch=btnText.match(/^([A-Za-z0-9_-]+)/);
const sName=nameMatch?nameMatch[1]:`Server ${i+1}`;
try{
const payload={_token:csrfToken,components:[{snapshot,updates:{},calls:[{path:"",method:"setVideo",params:[videoId]}]}]};
const postRes=yield fetchWithTimeout(`${MAIN_URL}/livewire/update`,{method:"POST",headers:{"Accept":"*/*","Content-Type":"application/json","X-Livewire":"","X-CSRF-TOKEN":csrfToken,"Origin":MAIN_URL,"Referer":`${MAIN_URL}${episodeUrl}`,"Cookie":ep.cookies},body:JSON.stringify(payload)},8000);
if(!postRes.ok)continue;
const postData=yield postRes.json();
const liveHtml=postData?.components?.[0]?.effects?.html;
if(!liveHtml)continue;
const extra=parseFallbackDefaultStream(liveHtml,cheerio.load(liveHtml));
if(extra?.masterUrl&&extra.masterUrl!==defaultStream.masterUrl){
streams.push(makeStream(animeTitle,mappedEpisode,{masterUrl:extra.masterUrl,subtitles:extra.subtitles?.length?extra.subtitles:defaultStream.subtitles,srcName:sName},true));
}
}catch(e){console.log(`[AniZone] Fallback server ${sName} failed: ${e.message}`);}
}
}
}
return streams;
});
}
function fallbackStreams(tmdbId,season,episode,mapping,tmdbTitle){
return __async(this,null,function*(){
console.log("[AniZone] Entering Livewire fallback");
const found=yield fallbackFindAnime(tmdbTitle,mapping,season);
if(!found){console.log("[AniZone] Fallback anime not found");return[];}
console.log(`[AniZone] Fallback matched slug: ${found.slug}`);
const animeTitle=mapping?.anime_title||tmdbTitle||found.query;
const alias=`${MAIN_URL}/anime/${found.slug}`;
let episodes;
try{episodes=yield fetchAnimeEpisodeList(alias);}catch(e){console.log(`[AniZone] Fallback episode list failed: ${e.message}`);return[];}
const mappedEpisode=parseInt(mapping?.mal_episode,10)||episode;
const selected=episodes[mappedEpisode-1];
if(!selected){console.log(`[AniZone] Fallback episode E${mappedEpisode} not found; AniZone has ${episodes.length}`);return[];}
console.log(`[AniZone] Fallback selected E${mappedEpisode}: ${selected.episodeLink}`);
return yield fallbackExtractStreams(animeTitle,mappedEpisode,selected.episodeLink);
});
}
function getStreams(tmdbId,mediaType="tv",season=1,episode=1){
return __async(this,null,function*(){
season=parseInt(season,10)||1;
episode=parseInt(episode,10)||1;
console.log(`[AniZone] Querying TMDB=${tmdbId} S${season}E${episode}`);
if(mediaType!=="tv"){console.log("[AniZone] AniZone provider supports TV anime only");return[];}
const mapping=yield getMapping(tmdbId,season,episode);
const tmdbTitle=yield getTmdbTitle(tmdbId);
try{
const primary=yield primaryStreams(tmdbId,season,episode,mapping,tmdbTitle);
if(Array.isArray(primary)&&primary.some(s=>s&&s.url)){
console.log(`[AniZone] Primary returned ${primary.length} usable stream(s); NOT running fallback`);
return primary;
}
console.log("[AniZone] Primary returned no usable streams; running fallback");
}catch(e){console.log(`[AniZone] Primary failed: ${e.message}; running fallback`);}
try{
const fallback=yield fallbackStreams(tmdbId,season,episode,mapping,tmdbTitle);
if(Array.isArray(fallback)&&fallback.some(s=>s&&s.url)){console.log(`[AniZone] Fallback returned ${fallback.length} usable stream(s)`);return fallback;}
console.log("[AniZone] Fallback returned no usable streams");
return[];
}catch(e){console.log(`[AniZone] Fallback failed: ${e.message}`);return[];}
});
}
module.exports={getStreams};
