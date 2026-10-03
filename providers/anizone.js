/**
 * anizone - Built from src/anizone/
 * Optimized for fast stream discovery
 */
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
var __spreadValues=(a,b)=>{
  for(var prop in b||(b={}))if(__hasOwnProp.call(b,prop))__defNormalProp(a,prop,b[prop]);
  if(__getOwnPropSymbols)for(var prop of __getOwnPropSymbols(b))if(__propIsEnum.call(b,prop))__defNormalProp(a,prop,b[prop]);
  return a;
};
var __spreadProps=(a,b)=>__defProps(a,__getOwnPropDescs(b));
var __copyProps=(to,from,except,desc)=>{
  if(from&&(typeof from==="object"||typeof from==="function"))for(let key of __getOwnPropNames(from))if(!__hasOwnProp.call(to,key)&&key!==except)__defProp(to,key,{get:()=>from[key],enumerable:!(desc=__getOwnPropDesc(from,key))||desc.enumerable});
  return to;
};
var __toESM=(mod,isNodeMode,target)=>(target=mod!=null?__create(__getProtoOf(mod)):{},__copyProps(isNodeMode||!mod||!mod.__esModule?__defProp(target,"default",{value:mod,enumerable:true}):target,mod));
var __async=(__this,__arguments,generator)=>new Promise((resolve,reject)=>{
  var fulfilled=value=>{try{step(generator.next(value));}catch(e){reject(e);}};
  var rejected=value=>{try{step(generator.throw(value));}catch(e){reject(e);}};
  var step=x=>x.done?resolve(value):Promise.resolve(x.value).then(fulfilled,rejected);
  step((generator=generator.apply(__this,__arguments)).next());
});
var import_cheerio_without_node_native=__toESM(require("cheerio-without-node-native"));

var MAIN_URL="https://anizone.to";
var HEADERS={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Referer":"https://anizone.to/"
};
var TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
var ANIME_CACHE_URL="https://breezy-plugins.netlify.app/api/anime-cache";

var HEX_ESCAPE=/\\x([0-9a-fA-F]{2})/g;
var INVALID_BACKSLASH=/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g;

var MAPPING_CACHE=new Map;
var SEASON_MAPPING_CACHE=new Map;
var SEARCH_CACHE=new Map;
var SLUG_CACHE=new Map;
var IMDB_CACHE=new Map;
var MAX_CACHE=300;
var SEASON_MAPPING_TTL=24*60*60*1000;
var SEASON_MAPPING_MAX_EPISODES=50;

function cacheSet(cache,key,value){
  if(cache.size>=MAX_CACHE){
    var first=cache.keys().next().value;
    if(first!==void 0)cache.delete(first);
  }
  cache.set(key,value);
}

function seasonCacheGet(key){
  var entry=SEASON_MAPPING_CACHE.get(key);
  if(!entry)return null;
  if(Date.now()-entry.createdAt>=SEASON_MAPPING_TTL){
    SEASON_MAPPING_CACHE.delete(key);
    console.log(`[AniZone] Season mapping cache expired: ${key}`);
    return null;
  }
  return entry.value;
}

function seasonCacheSet(key,value){
  if(SEASON_MAPPING_CACHE.size>=MAX_CACHE){
    var first=SEASON_MAPPING_CACHE.keys().next().value;
    if(first!==void 0)SEASON_MAPPING_CACHE.delete(first);
  }
  SEASON_MAPPING_CACHE.set(key,{createdAt:Date.now(),value:value});
}

function getPersistentSeasonCache(imdbId,season){
  return __async(this,null,function*(){
    var key=`${imdbId}:s${parseInt(season,10)}`;

    try{
      var response=yield fetchWithTimeout(`${ANIME_CACHE_URL}?key=${encodeURIComponent(key)}`,{headers:{"Accept":"application/json"}},2500);

      if(!response.ok){
        console.log(`[AniZone] Netlify cache miss/error ${key}: HTTP ${response.status}`);
        return null;
      }

      var data=yield response.json();

      if(!data||data.hit!==true||!data.data)return null;

      var cached=data.data;

      if(!cached.animeSlug||!cached.season||!cached.episodes||typeof cached.episodes!=="object")return null;

      var episodeKeys=Object.keys(cached.episodes);

      if(!episodeKeys.length)return null;

      console.log(`[AniZone] Netlify season cache hit: ${key} (${episodeKeys.length} episodes)`);
      return cached;
    }catch(error){
      console.log(`[AniZone] Netlify cache read failed: ${error&&error.message||error}`);
      return null;
    }
  });
}

function savePersistentSeasonCache(imdbId,season,data){
  return __async(this,null,function*(){
    var key=`${imdbId}:s${parseInt(season,10)}`;

    try{
      if(!data||typeof data!=="object"||!data.animeSlug||!data.episodes)return;

      var response=yield fetchWithTimeout(ANIME_CACHE_URL,{
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json"
        },
        body:JSON.stringify({key,data})
      },5000);

      if(response.ok){
        console.log(`[AniZone] Netlify season cache saved: ${key}`);
      }else{
        console.log(`[AniZone] Netlify cache write failed: HTTP ${response.status}`);
      }
    }catch(error){
      console.log(`[AniZone] Netlify cache write failed: ${error&&error.message||error}`);
    }
  });
}

function buildPersistentSeasonData(imdbId,season,animeSlug,currentMapping,remoteSeason){
  var seasonNum=parseInt(season,10);
  var seasonKey=`${imdbId}:s${seasonNum}`;
  var episodes={};

  if(remoteSeason&&remoteSeason.episodes&&typeof remoteSeason.episodes==="object"){
    for(var key of Object.keys(remoteSeason.episodes)){
      var value=remoteSeason.episodes[key];
      if(value&&typeof value==="object")episodes[key]=value;
    }
  }

  var existing=seasonCacheGet(seasonKey);

  if(existing&&typeof existing==="object"){
    for(var key of Object.keys(existing)){
      var value=existing[key];
      if(value&&typeof value==="object"&&!episodes[key])episodes[key]=value;
    }
  }

  if(currentMapping&&currentMapping.episode){
    episodes[String(currentMapping.episode)]=currentMapping;
  }

  var limited={};
  var keys=Object.keys(episodes).sort((a,b)=>parseInt(a,10)-parseInt(b,10));

  for(var key of keys.slice(0,SEASON_MAPPING_MAX_EPISODES)){
    limited[key]=episodes[key];
  }

  if(currentMapping&&currentMapping.episode&&!limited[String(currentMapping.episode)]){
    var currentEpisodeKey=String(currentMapping.episode);
    var limitedKeys=Object.keys(limited);

    if(limitedKeys.length>=SEASON_MAPPING_MAX_EPISODES){
      delete limited[limitedKeys[limitedKeys.length-1]];
    }

    limited[currentEpisodeKey]=currentMapping;
  }

  return{
    version:1,
    animeSlug,
    season:seasonNum,
    episodes:limited
  };
}

function sanitizeJson(raw){
  if(!raw)return"";
  return raw.replace(/\\u0022/g,'"').replace(/\\u0026/g,"&").replace(/\\'/g,"'").replace(/\\\//g,"/").replace(/\\\\/g,"\\").replace(/\\&/g,"&").replace(/\\'/g,"'").replace(/\\0/g,"\\u0000").replace(HEX_ESCAPE,(_,hex)=>"\\u00"+hex).replace(INVALID_BACKSLASH,"");
}

function parseXDataJson(rawArg){
  return JSON.parse(sanitizeJson(rawArg));
}

function fetchWithTimeout(_0){
  return __async(this,arguments,function*(url,options={},timeoutMs=8e3){
    var mergedHeaders=__spreadValues({"User-Agent":HEADERS["User-Agent"],"Referer":HEADERS["Referer"]},options.headers||{});
    var fetchOptions=__spreadProps(__spreadValues({skipSizeCheck:true},options),{headers:mergedHeaders});

    if(typeof setTimeout!=="function")return fetch(url,fetchOptions);

    let timer=null;
    var timeoutPromise=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Timeout")),timeoutMs);});

    try{
      var res=yield Promise.race([fetch(url,fetchOptions),timeoutPromise]);
      clearTimeout(timer);
      return res;
    }catch(e){
      clearTimeout(timer);
      throw e;
    }
  });
}

function fetchText(_0){
  return __async(this,arguments,function*(url,options={}){
    var finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;

    try{
      var response=yield fetchWithTimeout(finalUrl,options,8e3);

      if(!response.ok){
        console.log(`[AniZone] HTTP ${response.status} for ${finalUrl}`);
        return"";
      }

      var text=yield response.text();

      if(!text){
        console.log(`[AniZone] Empty response for ${finalUrl}`);
        return"";
      }

      return text;
    }catch(e){
      console.log(`[AniZone] Fetch failed ${finalUrl}: ${e&&e.message||e}`);
      return"";
    }
  });
}

function fetchWithCookies(_0){
  return __async(this,arguments,function*(url,options={}){
    var _a,_b;
    var finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;

    try{
      var response=yield fetchWithTimeout(finalUrl,options,8e3);

      if(!response.ok){
        console.log(`[AniZone] HTTP ${response.status} for ${finalUrl}`);
        return{text:"",cookies:"",ok:false};
      }

      var text=yield response.text();

      if(!text){
        console.log(`[AniZone] Empty response for ${finalUrl}`);
        return{text:"",cookies:"",ok:false};
      }

      let cookies="";

      try{
        if(typeof((_a=response.headers)==null?void 0:_a.getSetCookie)==="function"){
          cookies=response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
        }else if((_b=response.headers)==null?void 0:_b.get){
          cookies=response.headers.get("set-cookie")||"";
        }
      }catch(_){}

      return{text,cookies,ok:true};
    }catch(e){
      console.log(`[AniZone] Episode fetch failed ${finalUrl}: ${e&&e.message||e}`);
      return{text:"",cookies:"",ok:false};
    }
  });
}

function getImdbId(tmdbId,mediaType){
  return __async(this,null,function*(){
    var key=`${mediaType}:${tmdbId}`;

    if(IMDB_CACHE.has(key)){
      console.log(`[AniZone] IMDb cache hit: ${key}`);
      return IMDB_CACHE.get(key);
    }

    try{
      var url=`https://api.themoviedb.org/3/${mediaType==="tv"?"tv":"movie"}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
      var res=yield fetchWithTimeout(url,{},4e3);

      if(!res.ok){
        console.log(`[AniZone] IMDb lookup failed: HTTP ${res.status}`);
        return null;
      }

      var data=yield res.json();
      var id=data.imdb_id||null;

      if(id)cacheSet(IMDB_CACHE,key,id);

      return id;
    }catch(error){
      console.log(`[AniZone] IMDb lookup failed: ${error&&error.message||error}`);
      return null;
    }
  });
}

function isDateMatch(d1,d2){
  if(!d1||!d2)return false;

  var s1=d1.split("T")[0],s2=d2.split("T")[0];
  var date1=new Date(s1+"T00:00:00Z"),date2=new Date(s2+"T00:00:00Z");

  return Math.ceil(Math.abs(date1.getTime()-date2.getTime())/(1e3*60*60*24))<=2;
}

function getSeasonEpisodes(metaData,seasonNum,requestedEpisode){
  var videos=Array.isArray(metaData&&metaData.videos)?metaData.videos:[];
  var seasonVideos=videos.filter(v=>v&&parseInt(v.season,10)===seasonNum&&v.released);

  seasonVideos.sort((a,b)=>parseInt(a.episode,10)-parseInt(b.episode,10));

  var limited=seasonVideos.slice(0,SEASON_MAPPING_MAX_EPISODES);

  if(requestedEpisode>SEASON_MAPPING_MAX_EPISODES){
    var requested=seasonVideos.find(v=>parseInt(v.episode,10)===requestedEpisode);

    if(requested&&!limited.some(v=>parseInt(v.episode,10)===requestedEpisode))limited.push(requested);
  }

  return limited;
}

function getEpisodeDayIndex(metaVideos,video,seasonNum,episodeNum){
  if(!video||!video.released)return 0;

  var airDate=video.released.split("T")[0];

  return metaVideos.filter(v=>{
    if(!v||!v.released)return false;

    var vSeason=parseInt(v.season,10);
    var vEpisode=parseInt(v.episode,10);

    return v.released.split("T")[0]===airDate&&(vSeason<seasonNum||vSeason===seasonNum&&vEpisode<episodeNum);
  }).length;
}

function resolveMapping(imdbId,season,episode,tmdbId){
  return __async(this,null,function*(){
    var seasonNum=parseInt(season,10);
    var episodeNum=parseInt(episode,10);
    var seasonCacheKey=`${imdbId}:s${seasonNum}`;

    var cachedSeason=seasonCacheGet(seasonCacheKey);

    if(cachedSeason){
      var cachedMapping=cachedSeason[String(episodeNum)]||null;

      if(cachedMapping){
        console.log(`[AniZone] Season mapping cache hit: ${seasonCacheKey} E${episodeNum}`);
        return cachedMapping;
      }

      console.log(`[AniZone] Season mapping cache hit but E${episodeNum} is not cached: ${seasonCacheKey}`);
    }

    var singleCacheKey=`${imdbId}:s${seasonNum}:e${episodeNum}`;

    if(MAPPING_CACHE.has(singleCacheKey)){
      console.log(`[AniZone] Mapping cache hit: ${singleCacheKey}`);
      return MAPPING_CACHE.get(singleCacheKey);
    }

    var metaData=null;

    try{
      var metaUrls=[
        `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`,
        `https://cinemeta-live.strem.io/meta/series/${imdbId}.json`
      ];

      var metaResults=yield Promise.all(metaUrls.map(url=>__async(this,null,function*(){
        try{
          var r=yield fetchWithTimeout(url,{},4e3);

          if(!r.ok)return null;

          var j=JSON.parse(yield r.text());

          return j&&j.meta&&j.meta.videos?j.meta:null;
        }catch(_){return null;}
      })));

      metaData=metaResults.find(Boolean)||null;
    }catch(_){}

    if(!metaData&&tmdbId){
      try{
        var tvUrl=`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
        var tvRes=yield fetchWithTimeout(tvUrl,{},4e3);
        var tvData=tvRes.ok?yield tvRes.json():{};

        var seasonUrl=`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}?api_key=${TMDB_API_KEY}`;
        var seasonRes=yield fetchWithTimeout(seasonUrl,{},4e3);

        if(seasonRes.ok){
          var seasonData=yield seasonRes.json();

          var videos=(seasonData&&Array.isArray(seasonData.episodes)?seasonData.episodes:[]).map(ep=>({
            season:seasonNum,
            episode:ep.episode_number,
            released:ep.air_date
          })).filter(v=>v.released);

          metaData={
            name:tvData.name||tvData.original_name,
            moviedb_id:tmdbId,
            videos
          };
        }
      }catch(_){}
    }

    if(!metaData||!metaData.videos)return null;

    var allMetaVideos=metaData.videos.filter(v=>v&&v.released);
    var targetVideos=getSeasonEpisodes(metaData,seasonNum,episodeNum);

    if(!targetVideos.length)return null;

    var targetVideo=targetVideos.find(v=>parseInt(v.episode,10)===episodeNum);

    if(!targetVideo)return null;

    var showTitle=metaData.name||"";
    var tId=tmdbId||metaData.moviedb_id||metaData.themoviedb_id;
    var tvdbId=metaData.tvdb_id;

    var armUrls=[
      `https://arm.haglund.dev/api/v2/imdb?id=${imdbId}`,
      tId?`https://arm.haglund.dev/api/v2/themoviedb?id=${tId}`:null,
      tvdbId?`https://arm.haglund.dev/api/v2/thetvdb?id=${tvdbId}`:null
    ].filter(Boolean);

    var armResults=yield Promise.all(armUrls.map(url=>__async(this,null,function*(){
      try{
        var r=yield fetchWithTimeout(url,{},3e3);

        if(!r.ok)return[];

        var d=yield r.json();

        return Array.isArray(d)?d:[];
      }catch(_){return[];}
    })));

    var malIds=[];

    for(var arr of armResults)for(var e of arr)if(e&&e.myanimelist)malIds.push(e.myanimelist);

    try{
      var aniIdUrl=tId?`https://api.ani.zip/mappings?themoviedb_id=${tId}`:`https://api.ani.zip/mappings?imdb_id=${imdbId}`;
      var aniRes=yield fetchWithTimeout(aniIdUrl,{},3e3);

      if(aniRes.ok){
        var aniData=yield aniRes.json();

        if(aniData&&aniData.mappings&&aniData.mappings.mal_id)malIds.push(aniData.mappings.mal_id);
      }
    }catch(_){}

    malIds=[...new Set(malIds)].filter(Boolean).sort((a,b)=>b-a);

    if(!malIds.length){
      console.log(`[AniZone] No MAL IDs found for ${imdbId} S${seasonNum}`);
      return null;
    }

    var mappingByEpisode={};

    yield Promise.all(malIds.map(malId=>__async(this,null,function*(){
      var aniMapping=null;
      var aniTitles=[];

      try{
        var r=yield fetchWithTimeout(`https://api.ani.zip/mappings?mal_id=${malId}`,{},3e3);

        if(r.ok){
          var d=yield r.json();

          if(d&&d.episodes){
            aniMapping=d;
            aniTitles=d.titles?Object.values(d.titles).filter(Boolean):[];
          }
        }
      }catch(_){}

      if(aniMapping&&aniMapping.episodes){
        for(var target of targetVideos){
          var targetEp=parseInt(target.episode,10);
          var airDate=target.released.split("T")[0];
          var dayIndex=getEpisodeDayIndex(allMetaVideos,target,seasonNum,targetEp);

          var eps=Object.values(aniMapping.episodes).map(ep=>({
            mal_episode_number:parseInt(ep.episode,10),
            air_date:ep.airDateUtc||ep.airDate||ep.airdate
          })).filter(ep=>!isNaN(ep.mal_episode_number));

          var matches=eps.filter(ep=>isDateMatch(ep.air_date,airDate)).sort((a,b)=>a.mal_episode_number-b.mal_episode_number);

          if(matches[dayIndex]){
            var m=matches[dayIndex];

            if(!mappingByEpisode[String(targetEp)]){
              mappingByEpisode[String(targetEp)]={
                id:`${imdbId}:s${seasonNum}:e${targetEp}`,
                imdb_id:imdbId,
                season:seasonNum,
                episode:targetEp,
                mal_id:malId,
                mal_episode:m.mal_episode_number,
                anime_title:showTitle,
                titles:aniTitles,
                air_date:airDate
              };
            }
          }
        }
      }

      try{
        if(!aniMapping){
          var j=yield fetchWithTimeout(`https://api.jikan.moe/v4/anime/${malId}`,{},3e3);

          if(j.ok){
            var jd=yield j.json();
            var aired=jd&&jd.data&&jd.data.aired&&jd.data.aired.from;

            if(aired){
              for(var target of targetVideos){
                var targetEp=parseInt(target.episode,10);
                var airDate=target.released.split("T")[0];
                var dayIndex=getEpisodeDayIndex(allMetaVideos,target,seasonNum,targetEp);

                if(isDateMatch(aired,airDate)&&!mappingByEpisode[String(targetEp)]){
                  mappingByEpisode[String(targetEp)]={
                    id:`${imdbId}:s${seasonNum}:e${targetEp}`,
                    imdb_id:imdbId,
                    season:seasonNum,
                    episode:targetEp,
                    mal_id:malId,
                    mal_episode:dayIndex+1,
                    anime_title:showTitle,
                    titles:[jd.data.title,jd.data.title_english,jd.data.title_japanese].filter(Boolean),
                    air_date:airDate
                  };
                }
              }
            }
          }
        }
      }catch(_){}

      return true;
    })));

    var requestedResult=mappingByEpisode[String(episodeNum)]||null;

    if(!requestedResult&&malIds.length===1&&seasonNum===1){
      var fallbackAir=targetVideo.released?targetVideo.released.split("T")[0]:"";

      requestedResult={
        id:`${imdbId}:s${seasonNum}:e${episodeNum}`,
        imdb_id:imdbId,
        season:seasonNum,
        episode:episodeNum,
        mal_id:malIds[0],
        mal_episode:episodeNum,
        anime_title:showTitle,
        titles:[],
        air_date:fallbackAir
      };

      mappingByEpisode[String(episodeNum)]=requestedResult;
    }

    var cacheValue={};
    var cacheTargets=targetVideos.slice(0,SEASON_MAPPING_MAX_EPISODES);

    for(var target of cacheTargets){
      var epNum=parseInt(target.episode,10);
      var mapped=mappingByEpisode[String(epNum)];

      if(mapped)cacheValue[String(epNum)]=mapped;
    }

    if(requestedResult&&requestedResult.episode>SEASON_MAPPING_MAX_EPISODES){
      cacheValue[String(requestedResult.episode)]=requestedResult;
    }

    if(Object.keys(cacheValue).length){
      seasonCacheSet(seasonCacheKey,cacheValue);
      console.log(`[AniZone] Season mapping cached: ${seasonCacheKey} (${Object.keys(cacheValue).length} episodes)`);
    }

    if(requestedResult){
      cacheSet(MAPPING_CACHE,singleCacheKey,requestedResult);
      return requestedResult;
    }

    console.log(`[AniZone] Mapping failed for ${imdbId} S${seasonNum}E${episodeNum}`);
    return null;
  });
}

function getTmdbInfo(tmdbId,mediaType,season=1){
  return __async(this,null,function*(){
    try{
      var url=`https://api.themoviedb.org/3/${mediaType==="tv"?"tv":"movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
      var r=yield fetchWithTimeout(url,{},5e3);

      if(!r.ok)return null;

      var d=yield r.json();

      var info={
        title:d.name||d.title||d.original_name||d.original_title||"",
        originalTitle:d.original_name||d.original_title||"",
        seasonName:""
      };

      if(mediaType==="tv"&&season){
        try{
          var sr=yield fetchWithTimeout(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`,{},5e3);

          if(sr.ok){
            var sd=yield sr.json();
            info.seasonName=sd.name||"";
          }
        }catch(_){}
      }

      return info;
    }catch(_){return null;}
  });
}

function normalize(str){
  if(!str)return"";
  return String(str).toLowerCase().replace(/[^a-z0-9]/g,"").trim();
}

function extractSlug(href){
  if(!href||typeof href!=="string")return"";

  var clean=href.split("?")[0].split("#")[0];
  var parts=clean.split("/").filter(Boolean);
  var index=parts.indexOf("anime");

  if(index<0||!parts[index+1])return"";

  return parts[index+1];
}

function addCard(cards,seen,slug,titles,meta){
  if(!slug||seen.has(slug))return;

  var cleanTitles=[];
  var titleSet=new Set;

  for(var title of titles||[]){
    if(title&&String(title).trim()){
      var value=String(title).replace(/\s+/g," ").trim();

      if(!titleSet.has(value)){
        titleSet.add(value);
        cleanTitles.push(value);
      }
    }
  }

  cards.push({
    slug,
    url:`/anime/${slug}`,
    titles:cleanTitles,
    meta:meta||{}
  });

  seen.add(slug);
}

function parseCards(html,$){
  var cards=[];
  var seen=new Set;

  var itemsMatches=[
    /items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/g,
    /items\s*:\s*JSON\.parse\("((?:[^"\\]|\\.)*)"\)/g
  ];

  for(var re of itemsMatches){
    var match;

    while((match=re.exec(html))){
      try{
        var parsed=parseXDataJson(match[1]);

        if(!Array.isArray(parsed))continue;

        for(var item of parsed){
          if(!item||!item.slug)continue;

          var titles=[];

          if(item.main_title)titles.push(item.main_title);

          if(item.title_list&&typeof item.title_list==="object"){
            Object.values(item.title_list).forEach(t=>{
              if(t)titles.push(t);
            });
          }

          if(item.title)titles.push(item.title);
          if(item.name)titles.push(item.name);
          if(item.original_title)titles.push(item.original_title);

          addCard(cards,seen,item.slug,titles,{
            season:item.season,
            year:item.year,
            status:item.status,
            episodes:item.episodes
          });
        }
      }catch(_){}
    }
  }

  $('a[href*="/anime/"]').each((i,el)=>{
    var href=$(el).attr("href")||"";
    var slug=extractSlug(href);

    if(!slug)return;

    var titles=[];
    var anchorText=$(el).text().replace(/\s+/g," ").trim();

    if(anchorText)titles.push(anchorText);

    var imgAlt=$(el).find("img[alt]").first().attr("alt");

    if(imgAlt)titles.push(imgAlt);

    var parent=$(el).closest('[x-data],[class*="item"],[class*="card"],li,article');

    if(parent&&parent.length){
      var parentText=parent.text().replace(/\s+/g," ").trim();

      if(parentText&&parentText.length<1000)titles.push(parentText);

      var parentImgAlt=parent.find("img[alt]").first().attr("alt");

      if(parentImgAlt)titles.push(parentImgAlt);

      var xData=parent.attr("x-data")||"";
      var jsonMatch=xData.match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);

      if(jsonMatch){
        try{
          var p=parseXDataJson(jsonMatch[1]);

          if(p&&typeof p==="object"){
            Object.values(p).forEach(t=>{
              if(typeof t==="string")titles.push(t);
            });
          }
        }catch(_){}
      }
    }

    addCard(cards,seen,slug,titles,{});
  });

  return cards;
}

function getSeasonRegexes(season){
  if(season===1)return{
    mustNot:[
      /season\s*[2-9]/i,
      /saison\s*[2-9]/i,
      /[\s\-][iI]{2,}/,
      /\s+[2-9]nd/i,
      /\s+[2-9]rd/i,
      /\s+[2-9]th/i,
      /\s+ii\b/i,
      /\s+iii\b/i,
      /\s+iv\b/i,
      /\s+v\b/i,
      /movie/i,
      /gekijouban/i,
      /the movie/i
    ]
  };

  var patterns=[];

  if(season===2)patterns.push(
    /season\s*2/i,
    /saison\s*2/i,
    /2nd\s*season/i,
    /[\s\-]ii\b/i,
    /\b2\b/
  );
  else if(season===3)patterns.push(
    /season\s*3/i,
    /saison\s*3/i,
    /3rd\s*season/i,
    /[\s\-]iii\b/i,
    /\b3\b/
  );
  else if(season===4)patterns.push(
    /season\s*4/i,
    /saison\s*4/i,
    /4th\s*season/i,
    /[\s\-]iv\b/i,
    /\b4\b/,
    /final\s*season/i
  );
  else patterns.push(
    new RegExp(`(?:season|saison)\\s*${season}`,"i"),
    new RegExp(`\\b${season}\\b`)
  );

  return{must:patterns};
}

function seasonRoman(season){
  return["","i","ii","iii","iv","v","vi","vii","viii","ix","x"][season]||"";
}

function scoreSeasonCard(card,targetTitles,baseTitle,season,seasonName){
  var score=0;
  var targets=targetTitles.map(normalize).filter(Boolean);
  var base=normalize(baseTitle);
  var sn=normalize(seasonName);
  var slugText=String(card.slug||"").replace(/[-_]+/g," ");

  for(var t of card.titles){
    var raw=String(t);
    var n=normalize(raw);

    if(!n)continue;

    if(targets.includes(n))score+=120;
    if(base&&(n===base||n.includes(base)||base.includes(n)))score+=35;

    if(sn&&sn!=="season"+season&&n.includes(sn))score+=80;

    if(season>1){
      if(new RegExp(`season\\s*${season}`,"i").test(raw))score+=70;
      if(new RegExp(`saison\\s*${season}`,"i").test(raw))score+=70;
      if(new RegExp(`${season===2?"2nd":season===3?"3rd":season===4?"4th":season+"th"}\\s*season`,"i").test(raw))score+=65;
      if(new RegExp(`\\b${season}\\b`).test(raw))score+=45;
      if(seasonRoman(season)&&new RegExp(`(?:^|[\\s\\-])${seasonRoman(season)}(?:$|[\\s\\-])`,"i").test(raw))score+=35;
    }else{
      if(/season\s*[2-9]|saison\s*[2-9]|\b(?:ii|iii|iv|v)\b|movie|gekijouban/i.test(raw))score-=80;
    }
  }

  if(season>1){
    if(new RegExp(`season[-_ ]?${season}|${season}(?:st|nd|rd|th)?[-_ ]season|${seasonRoman(season)}`,"i").test(slugText))score+=90;
    if(new RegExp(`(?:^|[-_ ])s${season}(?:[-_ ]|$)`,"i").test(slugText))score+=80;
  }else{
    if(/season[-_ ]?[2-9]|[2-9](?:st|nd|rd|th)?[-_ ]season|(?:^|[-_ ])s[2-9](?:[-_ ]|$)/i.test(slugText))score-=90;
  }

  if(card.meta){
    if(parseInt(card.meta.season,10)===season)score+=100;
    if(parseInt(card.meta.episodes,10)>0)score+=1;
  }

  return score;
}

function matchCard(cards,targetTitles,baseTitle,season=1,seasonName=""){
  if(!cards.length)return null;

  var scored=cards.map(card=>({
    card,
    score:scoreSeasonCard(card,targetTitles,baseTitle,season,seasonName)
  })).sort((a,b)=>b.score-a.score);

  if(scored[0]){
    console.log(`[AniZone] Season candidates: ${scored.slice(0,5).map(x=>`${x.card.slug}=${x.score}`).join(", ")}`);
  }

  if(scored[0]&&scored[0].score>0){
    console.log(`[AniZone] Best season match: "${scored[0].card.slug}" score=${scored[0].score}`);
    return scored[0].card.slug;
  }

  if(season===1){
    for(var c of cards){
      var blocked=false;

      for(var t of c.titles){
        if(/season\s*[2-9]|saison\s*[2-9]|movie|gekijouban|the movie/i.test(t)){
          blocked=true;
          break;
        }
      }

      if(!blocked)return c.slug;
    }
  }

  console.log(`[AniZone] No confident S${season} match among ${cards.length} AniZone cards`);
  return null;
}

function matchMovieCard(cards,targetTitles){
  var targets=targetTitles.map(normalize).filter(Boolean);

  for(var c of cards)for(var t of c.titles){
    var n=normalize(t);

    if(targets.some(x=>x===n))return c.slug;
  }

  for(var c of cards)for(var t of c.titles){
    var n=normalize(t);

    if(targets.some(x=>n.includes(x)||x.includes(n)))return c.slug;
  }

  return cards[0]?cards[0].slug:null;
}

function searchCards(query,forceFresh=false){
  return __async(this,null,function*(){
    var key=String(query||"").trim().toLowerCase();

    if(!key)return[];

    if(!forceFresh&&SEARCH_CACHE.has(key)){
      console.log(`[AniZone] Search cache hit: "${query}"`);
      return SEARCH_CACHE.get(key);
    }

    try{
      var url=`${MAIN_URL}/anime?search=${encodeURIComponent(query)}`;
      var html=yield fetchText(url);

      if(!html){
        console.log(`[AniZone] Search returned empty HTML: "${query}"`);
        return[];
      }

      var $=import_cheerio_without_node_native.default.load(html);
      var cards=parseCards(html,$);

      if(cards.length){
        cacheSet(SEARCH_CACHE,key,cards);
      }

      console.log(`[AniZone] Search ${forceFresh?"fresh ":""}"${query}" returned ${cards.length} cards`);

      if(cards.length){
        console.log(`[AniZone] Search candidates: ${cards.map(c=>`${c.slug}[${c.titles.slice(0,3).join(" | ")}]`).join(" || ")}`);
      }

      return cards;
    }catch(error){
      console.log(`[AniZone] Search failed "${query}": ${error&&error.message||error}`);
      return[];
    }
  });
}

function searchAnimeSlug(baseQuery,animeTitle,altTitles,specificTitles,season,seasonName,mediaType,forceFresh){
  return __async(this,null,function*(){
    var slugCacheKey=`${baseQuery}|${season}|${specificTitles.join("|")}`;

    if(!forceFresh){
      var cachedSlug=SLUG_CACHE.get(slugCacheKey);

      if(cachedSlug){
        console.log(`[AniZone] Slug cache hit: "${cachedSlug}"`);
        return cachedSlug;
      }
    }

    var cards=yield searchCards(baseQuery,forceFresh);

    if(!cards.length&&animeTitle!==baseQuery){
      cards=yield searchCards(animeTitle.split(":")[0].trim(),forceFresh);
    }

    if(!cards.length){
      var altPromises=altTitles.map(t=>searchCards(t.split(":")[0].trim(),forceFresh));
      var altResults=yield Promise.all(altPromises);

      for(var result of altResults)if(result.length){
        cards=result;
        break;
      }
    }

    if(!cards.length){
      console.log(`[AniZone] No AniZone search results for "${baseQuery}"`);
      return null;
    }

    var slug=mediaType==="tv"
      ?matchCard(cards,specificTitles,baseQuery,season,seasonName)
      :matchMovieCard(cards,specificTitles);

    if(slug&&!forceFresh){
      cacheSet(SLUG_CACHE,slugCacheKey,slug);
    }

    return slug;
  });
}

function validateEpisodePage(slug,episode){
  return __async(this,null,function*(){
    var url=`/anime/${slug}/${episode}`;
    var response=yield fetchWithCookies(url);

    if(!response.ok||!response.text)return null;

    var html=response.text;

    if(/cf-chl-|challenge-platform|just a moment|checking your browser/i.test(html)){
      console.log(`[AniZone] Episode page appears to be a challenge page: ${url}`);
      return null;
    }

    var $=import_cheerio_without_node_native.default.load(html);
    var heading=$("h1").first().text().replace(/\s+/g," ").trim();

    var hasVideo=!!(
      $("media-player").length||
      $("video").length||
      $("button[wire\\:click*=\"setVideo\"],[wire\\:click*=\"setVideo\"]").length||
      /master\.m3u8/i.test(html)||
      /vidstackPlayer/i.test(html)
    );

    return{
      response,
      heading,
      hasVideo
    };
  });
}

function cleanSubtitleUrl(url){
  if(!url||typeof url!=="string")return"";

  var value=url.replace(/\\/g,"").trim();

  if(!/^https?:\/\//i.test(value))return"";

  return value;
}

function normalizeSubtitleLanguage(value){
  if(!value)return"en";

  var v=String(value).toLowerCase().trim();

  if(v==="en"||v==="eng"||v==="english"||v.startsWith("en-"))return"en";
  if(v==="ja"||v==="jpn"||v==="japanese"||v.startsWith("ja-"))return"ja";

  return v.length<=10?v:"en";
}

function parseSubtitleTracks(data){
  if(!data||!Array.isArray(data.subtitles))return[];

  return data.subtitles.map(s=>({
    url:s&&s.file?cleanSubtitleUrl(s.file):"",
    name:s&&s.title||s&&s.language||"English",
    language:normalizeSubtitleLanguage(s&&s.language)
  })).filter(s=>s.url);
}

function parseVidstackFromHtml(html,$){
  var vidMatches=[
    /vidstackPlayer\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/,
    /vidstackPlayer\(JSON\.parse\("((?:[^"\\]|\\.)*)"\)\)/
  ];

  for(var vm of vidMatches){
    var vidMatch=html.match(vm);

    if(vidMatch){
      try{
        var d=parseXDataJson(vidMatch[1]);
        var master=d.src?d.src.replace(/\\/g,""):null;
        var subs=parseSubtitleTracks(d);

        if(master)return{
          masterUrl:master,
          subtitles:subs
        };
      }catch(_){}
    }
  }

  var masterUrl=$("media-player").attr("src")||$("video").attr("src")||"";

  if(!masterUrl){
    var m=html.match(/https?:\/\/[^"'\\\s]+\/master\.m3u8(?:\?[^"'\\\s]*)?/i);

    if(m)masterUrl=m[0];
  }

  var subtitles=[];

  $("track").each((i,el)=>{
    var src=$(el).attr("src");
    var kind=$(el).attr("kind");

    if(src&&(kind==="subtitles"||kind==="captions"||/\.ass(?:\?|$)/i.test(src)||/\.vtt(?:\?|$)/i.test(src))){
      subtitles.push({
        url:cleanSubtitleUrl(src),
        name:$(el).attr("label")||"English",
        language:normalizeSubtitleLanguage($(el).attr("srclang"))
      });
    }
  });

  return{
    masterUrl:masterUrl,
    subtitles:subtitles
  };
}

function parseAudioFormat(text){
  var lower=text.toLowerCase();

  var hasJap=lower.includes("japanese")||lower.includes("jpn")||lower.includes(" ja ");
  var hasEng=lower.includes("english")||lower.includes("eng")||lower.includes(" en ");

  if(hasEng&&hasJap)return"Dual Audio";
  if(hasEng)return"Dub";
  if(hasJap)return"Sub";
  if(lower.includes("multi"))return"Multi-Audio";

  return"Sub";
}

function onSettings(){
  return[
    {type:"header",label:"Preferences"},
    {type:"toggle",key:"enableDub",label:"Enable Dub",defaultValue:true}
  ];
}

function isDubEnabled(){
  var settings=typeof globalThis!=="undefined"&&globalThis.SCRAPER_SETTINGS?globalThis.SCRAPER_SETTINGS:{};
  return settings.enableDub!==false;
}

function isDubFormat(format){
  return format==="Dub"||format==="Dual Audio";
}

function getStreams(tmdbId,mediaType="tv",season=1,episode=1){
  return __async(this,null,function*(){
    try{
      console.log(`[AniZone] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}, S${season}E${episode}`);

      var animeTitle="";
      var altTitles=[];
      var mappedEp=episode;
      var seasonName="";
      var targetTitles=[];
      var imdbId=null;
      var currentMapping=null;
      var animeSlug=null;
      var cacheCandidate=null;
      var persistentSeason=null;
      var persistentCacheUsed=false;
      var persistentCacheFallback=false;
      var forceFreshSlugSearch=false;

      if(mediaType==="tv"){
        imdbId=yield getImdbId(tmdbId,"tv");

        if(imdbId){
          persistentSeason=yield getPersistentSeasonCache(imdbId,season);

          if(persistentSeason&&persistentSeason.animeSlug&&persistentSeason.episodes){
            var cachedEpisode=persistentSeason.episodes[String(parseInt(episode,10))];

            if(cachedEpisode){
              animeSlug=persistentSeason.animeSlug;
              currentMapping=cachedEpisode;
              mappedEp=cachedEpisode.mal_episode||episode;
              animeTitle=cachedEpisode.anime_title||"";
              persistentCacheUsed=true;

              if(cachedEpisode.titles&&Array.isArray(cachedEpisode.titles)){
                targetTitles.push(...cachedEpisode.titles);
              }

              console.log(`[AniZone] Persistent cache resolved: "${animeSlug}" E${episode}->${mappedEp}`);
            }else{
              console.log(`[AniZone] Persistent season cache exists but E${episode} is not cached: ${imdbId}:s${season}`);
            }
          }

          if(!currentMapping){
            var mapping=yield resolveMapping(imdbId,season,episode,tmdbId);

            if(mapping){
              currentMapping=mapping;
              mappedEp=mapping.mal_episode||episode;
              animeTitle=mapping.anime_title||"";

              if(mapping.titles&&Array.isArray(mapping.titles)){
                targetTitles.push(...mapping.titles);
              }

              if(!animeTitle&&targetTitles.length){
                animeTitle=targetTitles[0];
              }

              console.log(`[AniZone] AnimeSync mapped: "${animeTitle}", mappedEp=${mappedEp}`);
            }
          }
        }

        var tmdbInfo=yield getTmdbInfo(tmdbId,mediaType,season);

        if(tmdbInfo){
          if(!animeTitle)animeTitle=tmdbInfo.title;
          if(tmdbInfo.originalTitle&&!altTitles.includes(tmdbInfo.originalTitle))altTitles.push(tmdbInfo.originalTitle);
          seasonName=tmdbInfo.seasonName||"";
        }
      }else{
        var movieInfo=yield getTmdbInfo(tmdbId,"movie");

        if(movieInfo){
          animeTitle=movieInfo.title;
          if(movieInfo.originalTitle)altTitles.push(movieInfo.originalTitle);
        }

        mappedEp=1;
      }

      if(!animeTitle&&targetTitles.length===0)return[];

      if(!animeTitle&&targetTitles.length)animeTitle=targetTitles[0];

      var specificTitles=season===1||mediaType==="movie"
        ?[...new Set([...targetTitles,animeTitle,...altTitles].filter(Boolean))]
        :[...new Set([...targetTitles,animeTitle,...altTitles].filter(Boolean))];

      var epResponse=null;
      var episodeUrl="";

      while(true){
        if(!animeSlug){
          var baseQuery=animeTitle.split(":")[0]
            .replace(/season.*|\d+nd season|\d+rd season|\d+th season|saison.*/gi,"")
            .trim();

          animeSlug=yield searchAnimeSlug(
            baseQuery,
            animeTitle,
            altTitles,
            specificTitles,
            season,
            seasonName,
            mediaType,
            forceFreshSlugSearch
          );
        }

        if(!animeSlug){
          console.log(`[AniZone] Unable to resolve AniZone slug for "${animeTitle}" S${season}`);
          return[];
        }

        console.log(`[AniZone] Selected slug: "${animeSlug}", mappedEp=${mappedEp}`);

        if(mediaType==="tv"&&imdbId&&currentMapping){
          cacheCandidate=buildPersistentSeasonData(
            imdbId,
            season,
            animeSlug,
            currentMapping,
            persistentSeason
          );
        }

        var validation=yield validateEpisodePage(animeSlug,mappedEp);

        if(validation&&validation.response&&validation.response.ok&&validation.hasVideo){
          epResponse=validation.response;
          break;
        }

        episodeUrl=`/anime/${animeSlug}/${mappedEp}`;

        if(validation&&validation.response&&validation.response.ok){
          console.log(`[AniZone] Episode page loaded but contains no detectable video data: ${episodeUrl}`);
        }else{
          console.log(`[AniZone] Failed to load/validate episode page: ${episodeUrl}`);
        }

        if(!persistentCacheFallback){
          console.log(`[AniZone] Forcing fresh AniZone search after slug validation failure`);

          persistentCacheFallback=true;
          forceFreshSlugSearch=true;
          animeSlug=null;
          cacheCandidate=null;
          continue;
        }

        return[];
      }

      episodeUrl=`/anime/${animeSlug}/${mappedEp}`;

      var epHtml=epResponse.text;
      var $ep=import_cheerio_without_node_native.default.load(epHtml);
      var streams=[];
      var seen=new Set;

      var defaultStream=parseVidstackFromHtml(epHtml,$ep);
      var serverButtons=$ep('button[wire\\:click*="setVideo"],[wire\\:click*="setVideo"]');

      console.log(`[AniZone] Episode page: ${episodeUrl}`);
      console.log(`[AniZone] Server buttons found: ${serverButtons.length}`);
      console.log(`[AniZone] Default master stream: ${defaultStream&&defaultStream.masterUrl?"yes":"no"}`);

      var defaultFormat="Sub";
      var defaultServerName="AniZone";

      if(serverButtons.length){
        var first=serverButtons.first();
        var text=first.text().replace(/\s+/g," ").trim();

        defaultFormat=parseAudioFormat(text);

        var nm=text.match(/^([A-Za-z0-9_-]+)/);

        if(nm)defaultServerName=nm[1];
      }

      var addStream=(stream,name,format)=>{
        if(!stream||!stream.masterUrl)return;
        if(!isDubEnabled()&&isDubFormat(format))return;
        if(seen.has(stream.masterUrl))return;

        seen.add(stream.masterUrl);

        streams.push({
          name:"AniZone",
          title:`${animeTitle} - Episode ${mappedEp} [${name} - ${format}]`,
          url:stream.masterUrl,
          quality:"Multi",
          headers:HEADERS,
          subtitles:stream.subtitles||[]
        });
      };

      addStream(defaultStream,defaultServerName,defaultFormat);

      if(serverButtons.length>1){
        var csrfToken=
          $ep("script[data-csrf]").attr("data-csrf")||
          $ep('meta[name="csrf-token"]').attr("content")||
          $ep('input[name="_token"]').attr("value")||
          "";

        var snapshotEl=$ep('[wire\\:snapshot]').first();
        var snapshot=snapshotEl.attr("wire:snapshot")||"";

        console.log(`[AniZone] Livewire: csrf=${csrfToken?"yes":"no"} snapshot=${snapshot?"yes":"no"} cookies=${epResponse.cookies?"yes":"no"}`);

        if(csrfToken&&snapshot){
          var tasks=[];

          for(let i=1;i<serverButtons.length;i++){
            let btn=serverButtons.eq(i);
            let click=btn.attr("wire:click")||"";
            let match=click.match(/setVideo\((\d+)\)/);

            if(!match)continue;

            let text=btn.text().replace(/\s+/g," ").trim();
            let format=parseAudioFormat(text);
            let nm=text.match(/^([A-Za-z0-9_-]+)/);
            let name=nm?nm[1]:`Server ${i+1}`;

            if(!isDubEnabled()&&isDubFormat(format))continue;

            let videoId=parseInt(match[1],10);

            tasks.push((async()=>{
              try{
                var payload={
                  _token:csrfToken,
                  components:[{
                    snapshot,
                    updates:{},
                    calls:[{
                      path:"",
                      method:"setVideo",
                      params:[videoId]
                    }]
                  }]
                };

                var r=await fetchWithTimeout(`${MAIN_URL}/livewire/update`,{
                  method:"POST",
                  headers:{
                    "Accept":"*/*",
                    "Content-Type":"application/json",
                    "X-Livewire":"",
                    "X-CSRF-TOKEN":csrfToken,
                    "Origin":MAIN_URL,
                    "Referer":`${MAIN_URL}${episodeUrl}`,
                    "Cookie":epResponse.cookies||""
                  },
                  body:JSON.stringify(payload)
                },5e3);

                if(!r.ok){
                  console.log(`[AniZone] Livewire server ${name} failed: HTTP ${r.status}`);
                  return;
                }

                var d=await r.json();

                var html=d&&
                  d.components&&
                  d.components[0]&&
                  d.components[0].effects&&
                  d.components[0].effects.html;

                if(!html){
                  console.log(`[AniZone] Livewire server ${name} returned no HTML`);
                  return;
                }

                var $live=import_cheerio_without_node_native.default.load(html);
                var stream=parseVidstackFromHtml(html,$live);

                addStream({
                  masterUrl:stream.masterUrl,
                  subtitles:stream.subtitles&&stream.subtitles.length
                    ?stream.subtitles
                    :(defaultStream&&defaultStream.subtitles)||[]
                },name,format);
              }catch(error){
                console.log(`[AniZone] Livewire server ${name} failed: ${error&&error.message||error}`);
              }
            })());
          }

          yield Promise.allSettled(tasks);
        }
      }

      console.log(`[AniZone] Total unique streams found: ${streams.length}`);

      if(streams.length&&mediaType==="tv"&&imdbId&&cacheCandidate){
        savePersistentSeasonCache(imdbId,season,cacheCandidate).catch(()=>{});
      }

      return streams;
    }catch(error){
      console.log(`[AniZone] Error: ${error&&error.message||error}`);
      return[];
    }
  });
}

module.exports={getStreams,onSettings};
