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
var __async=(__this,__arguments,generator)=>new Promise((resolve,reject)=>{var fulfilled=value=>{try{step(generator.next(value));}catch(e){reject(e);}},rejected=value=>{try{step(generator.throw(value));}catch(e){reject(e);}},step=x=>x.done?resolve(x.value):Promise.resolve(x.value).then(fulfilled,rejected);step((generator=generator.apply(__this,__arguments)).next());});

var import_cheerio_without_node_native=__toESM(require("cheerio-without-node-native"));

var MAIN_URL="https://anizone.to";
var HEADERS={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Referer":"https://anizone.to/"
};
var TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
var ANIME_CACHE_URL="https://breezy-plugins.netlify.app/api/anime-cache";
var ANIME_MAPPING_URL="https://breezy-plugins.netlify.app/api/anime-mapping";

var HEX_ESCAPE=/\\x([0-9a-fA-F]{2})/g;
var INVALID_BACKSLASH=/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g;

var MAPPING_MEMORY_CACHE=new Map;
var SEARCH_CACHE=new Map;
var SLUG_CACHE=new Map;
var IMDB_CACHE=new Map;

var MAX_CACHE=300;
var MAX_MAPPING_CACHE=300;
var CACHE_TIMEOUT=5000;
var MAPPING_TIMEOUT=6000;

function log(message){
  console.log(`[AniZone] ${message}`);
}

function sanitizeJson(raw){
  if(!raw)return"";
  return raw.replace(/\\u0022/g,'"').replace(/\\u0026/g,"&").replace(/\\'/g,"'").replace(/\\\//g,"/").replace(/\\\\/g,"\\").replace(/\\&/g,"&").replace(/\\'/g,"'").replace(/\\0/g,"\\u0000").replace(HEX_ESCAPE,(_,hex)=>"\\u00"+hex).replace(INVALID_BACKSLASH,"");
}

function parseXDataJson(raw){
  return JSON.parse(sanitizeJson(raw));
}

function fetchWithTimeout(_0){
  return __async(this,arguments,function* (url,options={},timeoutMs=8000){
    const mergedHeaders=__spreadValues({
      "User-Agent":HEADERS["User-Agent"],
      "Referer":HEADERS["Referer"]
    },options.headers||{});
    const fetchOptions=__spreadProps(__spreadValues({
      skipSizeCheck:true
    },options),{headers:mergedHeaders});
    if(typeof setTimeout!=="function")return fetch(url,fetchOptions);
    let timer=null;
    const timeoutPromise=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Timeout")),timeoutMs);});
    try{
      const res=yield Promise.race([fetch(url,fetchOptions),timeoutPromise]);
      clearTimeout(timer);
      return res;
    }catch(e){
      clearTimeout(timer);
      throw e;
    }
  });
}

function fetchText(_0){
  return __async(this,arguments,function* (url,options={}){
    const finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
    try{
      const response=yield fetchWithTimeout(finalUrl,options,10000);
      if(!response.ok)return"";
      return yield response.text();
    }catch(_){
      return"";
    }
  });
}

function fetchWithCookies(_0){
  return __async(this,arguments,function* (url,options={}){
    var _a,_b;
    const finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
    try{
      const response=yield fetchWithTimeout(finalUrl,options,10000);
      if(!response.ok)return{text:"",cookies:"",ok:false};
      const text=yield response.text();
      let cookies="";
      try{
        if(typeof((_a=response.headers)==null?void 0:_a.getSetCookie)==="function"){
          cookies=response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
        }else if((_b=response.headers)==null?void 0:_b.get){
          cookies=response.headers.get("set-cookie")||"";
        }
      }catch(_){}
      return{text,cookies,ok:true};
    }catch(_){
      return{text:"",cookies:"",ok:false};
    }
  });
}

function cacheSet(map,key,value,max=MAX_CACHE){
  if(map.has(key)){
    map.set(key,{value,time:Date.now()});
    return;
  }
  if(map.size>=max){
    const first=map.keys().next().value;
    if(first!==undefined)map.delete(first);
  }
  map.set(key,{value,time:Date.now()});
}

function cacheGet(map,key,ttl=0){
  const entry=map.get(key);
  if(!entry)return null;
  if(ttl>0&&Date.now()-entry.time>ttl){
    map.delete(key);
    return null;
  }
  return entry.value;
}

function getImdbId(tmdbId,mediaType){
  return __async(this,null,function*(){
    const key=`${mediaType}:${tmdbId}`;
    const cached=cacheGet(IMDB_CACHE,key);
    if(cached){
      log(`IMDb memory cache hit ${key} -> ${cached}`);
      return cached;
    }
    try{
      const type=mediaType==="tv"?"tv":"movie";
      const url=`https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
      log(`IMDb lookup TMDB=${tmdbId} type=${type}`);
      const res=yield fetchWithTimeout(url,{},5000);
      if(!res.ok){
        log(`IMDb lookup failed HTTP ${res.status}`);
        return null;
      }
      const data=yield res.json();
      const id=data&&data.imdb_id||null;
      if(id){
        cacheSet(IMDB_CACHE,key,id);
        log(`IMDb resolved ${tmdbId} -> ${id}`);
      }else{
        log(`IMDb ID missing for TMDB ${tmdbId}`);
      }
      return id;
    }catch(e){
      log(`IMDb lookup error: ${e&&e.message||e}`);
      return null;
    }
  });
}

function getPersistentSeasonCache(imdbId,season){
  return __async(this,null,function*(){
    if(!imdbId)return null;
    const key=`${imdbId}:s${season}`;
    try{
      log(`Persistent cache GET ${key}`);
      const url=`${ANIME_CACHE_URL}?key=${encodeURIComponent(key)}`;
      const res=yield fetchWithTimeout(url,{
        headers:{"Accept":"application/json"}
      },CACHE_TIMEOUT);
      if(!res.ok){
        log(`Persistent cache MISS ${key} HTTP ${res.status}`);
        return null;
      }
      const body=yield res.json();
      if(!body||!body.hit||!body.data){
        log(`Persistent cache MISS ${key} empty response`);
        return null;
      }
      const count=body.data.episodes&&typeof body.data.episodes==="object"?Object.keys(body.data.episodes).length:0;
      log(`Persistent cache HIT ${key} slug=${body.data.animeSlug||"?"} episodes=${count}`);
      return body.data;
    }catch(e){
      log(`Persistent cache read failed ${key}: ${e&&e.message||e}`);
      return null;
    }
  });
}

function savePersistentSeasonCache(imdbId,season,data){
  return __async(this,null,function*(){
    if(!imdbId||!data)return false;
    const key=`${imdbId}:s${season}`;
    try{
      const count=data.episodes&&typeof data.episodes==="object"?Object.keys(data.episodes).length:0;
      log(`Persistent cache POST ${key} slug=${data.animeSlug||"?"} episodes=${count}`);
      const res=yield fetchWithTimeout(ANIME_CACHE_URL,{
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json"
        },
        body:JSON.stringify({key,data})
      },CACHE_TIMEOUT);
      if(res.ok){
        log(`Persistent cache write OK ${key}`);
        return true;
      }
      log(`Persistent cache write failed ${key} HTTP ${res.status}`);
      return false;
    }catch(e){
      log(`Persistent cache write failed ${key}: ${e&&e.message||e}`);
      return false;
    }
  });
}

function cleanEpisode(ep){
  if(!ep||typeof ep!=="object")return null;
  const episode=parseInt(ep.episode,10);
  const malEpisode=parseInt(ep.mal_episode,10);
  const season=parseInt(ep.season,10);
  if(!Number.isFinite(episode)||!Number.isFinite(malEpisode)||!Number.isFinite(season))return null;
  if(episode<1||malEpisode<1||season<1)return null;
  return{
    id:typeof ep.id==="string"?ep.id:"",
    imdb_id:typeof ep.imdb_id==="string"?ep.imdb_id:"",
    season,
    episode,
    mal_id:ep.mal_id!=null?String(ep.mal_id):"",
    mal_episode:malEpisode,
    anime_title:typeof ep.anime_title==="string"?ep.anime_title:"",
    titles:Array.isArray(ep.titles)?ep.titles.filter(v=>typeof v==="string").slice(0,30):[],
    air_date:typeof ep.air_date==="string"?ep.air_date:""
  };
}

function buildPersistentSeasonData(animeSlug,season,episodes){
  const output={};
  for(const ep of episodes||[]){
    if(Object.keys(output).length>=50)break;
    const clean=cleanEpisode(ep);
    if(clean)output[String(clean.episode)]=clean;
  }
  if(!animeSlug||!Object.keys(output).length)return null;
  return{
    version:1,
    animeSlug,
    season:parseInt(season,10),
    episodes:output
  };
}

function addCachedEpisode(seasonData,mapping){
  if(!seasonData||!mapping)return seasonData;
  const clean=cleanEpisode(mapping);
  if(!clean)return seasonData;
  const episodes=__spreadValues({},seasonData.episodes||{});
  episodes[String(clean.episode)]=clean;
  const keys=Object.keys(episodes).sort((a,b)=>Number(a)-Number(b)).slice(0,50);
  const limited={};
  for(const key of keys)limited[key]=episodes[key];
  return{
    version:1,
    animeSlug:seasonData.animeSlug,
    season:seasonData.season,
    episodes:limited
  };
}

function isDateMatch(d1,d2){
  if(!d1||!d2)return false;
  const s1=d1.split("T")[0];
  const s2=d2.split("T")[0];
  const date1=new Date(s1+"T00:00:00Z");
  const date2=new Date(s2+"T00:00:00Z");
  const diff=Math.abs(date1.getTime()-date2.getTime());
  return Math.ceil(diff/(1000*60*60*24))<=2;
}

/* =========================================================
   ANIBRIDGE PRIMARY MAPPING
   ========================================================= */

function getAniBridgeMapping(tmdbId,season,episode){
  return __async(this,null,function*(){
    const key=`${tmdbId}:s${season}:e${episode}`;
    const cached=cacheGet(MAPPING_MEMORY_CACHE,key);
    if(cached){
      log(`AniBridge memory cache HIT ${key}`);
      return cached;
    }
    try{
      const url=`${ANIME_MAPPING_URL}?tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
      log(`AniBridge lookup ${key}`);
      const res=yield fetchWithTimeout(url,{
        headers:{"Accept":"application/json"}
      },MAPPING_TIMEOUT);
      if(!res.ok){
        log(`AniBridge lookup HTTP ${res.status} ${key}`);
        return null;
      }
      const body=yield res.json();
      if(!body||!body.ok||!body.mapping){
        log(`AniBridge lookup returned no mapping ${key}`);
        return null;
      }
      cacheSet(MAPPING_MEMORY_CACHE,key,body.mapping,MAX_MAPPING_CACHE);
      log(`AniBridge lookup HIT ${key}`);
      return body.mapping;
    }catch(e){
      log(`AniBridge lookup failed ${key}: ${e&&e.message||e}`);
      return null;
    }
  });
}

function getAniListMetadata(anilistId){
  return __async(this,null,function*(){
    if(!anilistId)return null;
    try{
      const id=Number(anilistId);
      if(!Number.isInteger(id)||id<1)return null;
      log(`AniList metadata lookup ${id}`);
      const query=`query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native} synonyms}}`;
      const res=yield fetchWithTimeout("https://graphql.anilist.co",{
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json"
        },
        body:JSON.stringify({query,variables:{id}})
      },5000);
      if(!res.ok){
        log(`AniList metadata HTTP ${res.status} id=${id}`);
        return null;
      }
      const body=yield res.json();
      const data=body&&body.data&&body.data.Media;
      if(!data)return null;
      return{
        id:data.id,
        title:data.title&&(
          data.title.english||
          data.title.romaji||
          data.title.native||
          ""
        ),
        titles:[
          data.title&&data.title.romaji,
          data.title&&data.title.english,
          data.title&&data.title.native,
          ...(Array.isArray(data.synonyms)?data.synonyms:[])
        ].filter(Boolean)
      };
    }catch(e){
      log(`AniList metadata error: ${e&&e.message||e}`);
      return null;
    }
  });
}

function getMalMetadata(malId){
  return __async(this,null,function*(){
    if(!malId)return null;
    try{
      const id=Number(malId);
      if(!Number.isInteger(id)||id<1)return null;
      log(`MAL metadata lookup ${id}`);
      const res=yield fetchWithTimeout(`https://api.jikan.moe/v4/anime/${id}`,{},5000);
      if(!res.ok){
        log(`MAL metadata HTTP ${res.status} id=${id}`);
        return null;
      }
      const body=yield res.json();
      const d=body&&body.data;
      if(!d)return null;
      return{
        id:d.mal_id,
        title:d.title_english||d.title||d.title_japanese||"",
        titles:[
          d.title,
          d.title_english,
          d.title_japanese,
          ...(Array.isArray(d.title_synonyms)?d.title_synonyms:[])
        ].filter(Boolean)
      };
    }catch(e){
      log(`MAL metadata error: ${e&&e.message||e}`);
      return null;
    }
  });
}

function normalizeAniBridgeMapping(mapping,tmdbId,season,episode,imdbId){
  if(!mapping||typeof mapping!=="object")return null;

  const malId=mapping.mal_id||mapping.malId||null;
  const anilistId=mapping.anilist_id||mapping.anilistId||null;

  const mappedEpisode=parseInt(
    mapping.mal_episode||
    mapping.target_episode||
    mapping.episode||
    mapping.mapped_episode||
    episode,
    10
  );

  if(!Number.isFinite(mappedEpisode)||mappedEpisode<1)return null;

  return{
    id:`${imdbId||tmdbId}:s${season}:e${episode}`,
    imdb_id:imdbId||"",
    season:parseInt(season,10),
    episode:parseInt(episode,10),
    mal_id:malId!=null?String(malId):"",
    anilist_id:anilistId!=null?String(anilistId):"",
    mal_episode:mappedEpisode,
    anime_title:typeof mapping.anime_title==="string"?mapping.anime_title:"",
    titles:Array.isArray(mapping.titles)?mapping.titles.filter(v=>typeof v==="string"):[],
    air_date:typeof mapping.air_date==="string"?mapping.air_date:"",
    source:mapping.source||"anibridge"
  };
}

function resolveAniBridge(imdbId,tmdbId,season,episode){
  return __async(this,null,function*(){
    const raw=yield getAniBridgeMapping(tmdbId,season,episode);
    if(!raw)return null;

    const mapping=normalizeAniBridgeMapping(raw,tmdbId,season,episode,imdbId);
    if(!mapping){
      log(`AniBridge mapping normalization failed TMDB=${tmdbId} S${season}E${episode}`);
      return null;
    }

    if(!mapping.anime_title&&!mapping.titles.length){
      let metadata=null;
      if(mapping.anilist_id)
        metadata=yield getAniListMetadata(mapping.anilist_id);
      if(!metadata&&mapping.mal_id)
        metadata=yield getMalMetadata(mapping.mal_id);

      if(metadata){
        mapping.anime_title=metadata.title||"";
        mapping.titles=[
          ...new Set([
            ...(mapping.titles||[]),
            ...(metadata.titles||[])
          ].filter(Boolean))
        ];
      }
    }

    if(!mapping.anime_title&&mapping.titles.length)
      mapping.anime_title=mapping.titles[0];

    if(!mapping.anime_title){
      log(`AniBridge mapping has no usable title TMDB=${tmdbId} S${season}E${episode}`);
      return null;
    }

    log(
      `AniBridge mapped "${mapping.anime_title}" `+
      `S${season}E${episode} -> E${mapping.mal_episode}`
    );

    return mapping;
  });
}

/* =========================================================
   LEGACY MAPPING - FALLBACK ONLY
   ========================================================= */

function resolveLegacyMapping(imdbId,season,episode,tmdbId){
  return __async(this,null,function*(){
    var _a,_b;
    const seasonNum=parseInt(season,10);
    const episodeNum=parseInt(episode,10);
    const mapId=`${imdbId}:s${season}:e${episode}`;
    let metaData=null;

    log(`Legacy mapping START ${imdbId}:S${seasonNum}E${episodeNum}`);

    const metaUrls=[
      `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`,
      `https://cinemeta-live.strem.io/meta/series/${imdbId}.json`
    ];

    for(const url of metaUrls){
      try{
        const mRes=yield fetchWithTimeout(url,{},5000);
        if(mRes.ok){
          const json=yield mRes.json();
          if((_a=json==null?void 0:json.meta)==null?void 0:_a.videos){
            metaData=json.meta;
            log(`Legacy mapping Cinemeta metadata HIT`);
            break;
          }
        }
      }catch(e){
        log(`Legacy Cinemeta error: ${e&&e.message||e}`);
      }
    }

    let tmdbEpisode=null;

    if(!metaData&&tmdbId){
      try{
        const epUrl=`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}?api_key=${TMDB_API_KEY}`;
        const epRes=yield fetchWithTimeout(epUrl,{},5000);

        if(epRes.ok)
          tmdbEpisode=yield epRes.json();

        if(tmdbEpisode&&tmdbEpisode.air_date){
          const tvUrl=`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
          const tvRes=yield fetchWithTimeout(tvUrl,{},5000);
          const tvData=tvRes.ok?yield tvRes.json():{};

          metaData={
            name:tvData.name||tvData.original_name,
            moviedb_id:tmdbId,
            videos:[{
              season:seasonNum,
              episode:episodeNum,
              released:tmdbEpisode.air_date
            }]
          };
          log(`Legacy mapping built from TMDB metadata`);
        }
      }catch(e){
        log(`Legacy TMDB metadata error: ${e&&e.message||e}`);
      }
    }

    if(!metaData||!metaData.videos){
      log(`Legacy mapping failed: no episode metadata`);
      return null;
    }

    const video=metaData.videos.find(v=>v.season===seasonNum&&v.episode===episodeNum);

    if(!video||!video.released){
      log(`Legacy mapping failed: requested episode has no release date`);
      return null;
    }

    const airDate=video.released.split("T")[0];
    const showTitle=metaData.name||"";

    const dayIndex=metaData.videos.filter(v=>{
      if(!v.released)return false;
      return v.released.split("T")[0]===airDate&&(
        v.season<seasonNum||
        v.season===seasonNum&&v.episode<episodeNum
      );
    }).length;

    let malIds=[];
    const tId=tmdbId||metaData.moviedb_id||metaData.themoviedb_id;
    const tvdbId=metaData.tvdb_id;

    const armUrls=[
      `https://arm.haglund.dev/api/v2/imdb?id=${imdbId}`,
      tId?`https://arm.haglund.dev/api/v2/themoviedb?id=${tId}`:null,
      tvdbId?`https://arm.haglund.dev/api/v2/thetvdb?id=${tvdbId}`:null
    ].filter(Boolean);

    for(const url of armUrls){
      try{
        const res=yield fetchWithTimeout(url,{},5000);
        if(res.ok){
          const data=yield res.json();
          if(Array.isArray(data)){
            data.forEach(e=>{
              if(e.myanimelist)
                malIds.push(e.myanimelist);
            });
          }
        }
      }catch(e){
        log(`Legacy ARM error: ${e&&e.message||e}`);
      }
    }

    try{
      const aniIdUrl=tId?
        `https://api.ani.zip/mappings?themoviedb_id=${tId}`:
        `https://api.ani.zip/mappings?imdb_id=${imdbId}`;

      const aniRes=yield fetchWithTimeout(aniIdUrl,{},5000);

      if(aniRes.ok){
        const aniData=yield aniRes.json();
        if(
          (_b=aniData==null?void 0:aniData.mappings)==null?
          void 0:
          _b.mal_id
        )
          malIds.push(aniData.mappings.mal_id);
      }
    }catch(e){
      log(`Legacy AniZip ID error: ${e&&e.message||e}`);
    }

    malIds=[
      ...new Set(malIds)
    ].filter(Boolean).sort((a,b)=>b-a);

    log(`Legacy mapping candidate MAL IDs: ${malIds.join(",")||"none"}`);

    for(const malId of malIds){
      try{
        const aniRes=yield fetchWithTimeout(
          `https://api.ani.zip/mappings?mal_id=${malId}`,
          {},
          5000
        );

        if(aniRes.ok){
          const aniData=yield aniRes.json();

          const extraTitles=
            aniData&&aniData.titles?
            Object.values(aniData.titles).filter(Boolean):
            [];

          if(aniData&&aniData.episodes){
            const aniEpisodes=Object.values(aniData.episodes)
              .map(ep=>({
                mal_episode_number:parseInt(ep.episode,10),
                air_date:ep.airDateUtc||ep.airDate||ep.airdate
              }))
              .filter(ep=>!isNaN(ep.mal_episode_number));

            const matches=aniEpisodes
              .filter(ep=>isDateMatch(ep.air_date,airDate))
              .sort((a,b)=>a.mal_episode_number-b.mal_episode_number);

            if(matches[dayIndex]){
              const match=matches[dayIndex];
              log(`Legacy AniZip mapped MAL=${malId} S${seasonNum}E${episodeNum} -> E${match.mal_episode_number}`);
              return{
                id:mapId,
                imdb_id:imdbId,
                season:seasonNum,
                episode:episodeNum,
                mal_id:malId,
                mal_episode:match.mal_episode_number,
                anime_title:showTitle,
                titles:extraTitles,
                air_date:airDate,
                source:"legacy"
              };
            }
          }
        }
      }catch(e){
        log(`Legacy AniZip episode error MAL=${malId}: ${e&&e.message||e}`);
      }

      try{
        const jRes=yield fetchWithTimeout(
          `https://api.jikan.moe/v4/anime/${malId}`,
          {},
          5000
        );

        if(jRes.ok){
          const jData=yield jRes.json();
          const aired=jData&&jData.data&&jData.data.aired;

          if(aired&&aired.from&&isDateMatch(aired.from,airDate)){
            log(`Legacy Jikan mapped MAL=${malId} S${seasonNum}E${episodeNum} -> E${dayIndex+1}`);
            return{
              id:mapId,
              imdb_id:imdbId,
              season:seasonNum,
              episode:episodeNum,
              mal_id:malId,
              mal_episode:dayIndex+1,
              anime_title:showTitle,
              titles:[
                jData.data.title,
                jData.data.title_english,
                jData.data.title_japanese
              ].filter(Boolean),
              air_date:airDate,
              source:"legacy"
            };
          }
        }
      }catch(e){
        log(`Legacy Jikan error MAL=${malId}: ${e&&e.message||e}`);
      }
    }

    if(malIds.length===1&&seasonNum===1){
      log(`Legacy mapping using single-MAL-ID S1 fallback MAL=${malIds[0]}`);
      return{
        id:mapId,
        imdb_id:imdbId,
        season:seasonNum,
        episode:episodeNum,
        mal_id:malIds[0],
        mal_episode:episodeNum,
        anime_title:showTitle,
        titles:[],
        air_date:airDate,
        source:"legacy"
      };
    }

    log(`Legacy mapping FAILED ${imdbId}:S${seasonNum}E${episodeNum}`);
    return null;
  });
}

function resolveMapping(imdbId,season,episode,tmdbId){
  return __async(this,null,function*(){
    const primary=yield resolveAniBridge(
      imdbId,
      tmdbId,
      season,
      episode
    );

    if(primary)return primary;

    log(
      `AniBridge unavailable/missing for `+
      `${tmdbId}:S${season}E${episode}; `+
      `using legacy fallback`
    );

    return yield resolveLegacyMapping(
      imdbId,
      season,
      episode,
      tmdbId
    );
  });
}

/* =========================================================
   TMDB / TITLES
   ========================================================= */

function getTmdbInfo(tmdbId,mediaType,season=1){
  return __async(this,null,function*(){
    try{
      const type=mediaType==="tv"?"tv":"movie";
      const url=`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`;
      log(`TMDB metadata GET ${type}/${tmdbId}`);
      const res=yield fetchWithTimeout(url,{},6000);

      if(!res.ok){
        log(`TMDB metadata HTTP ${res.status}`);
        return null;
      }

      const data=yield res.json();

      const info={
        title:data.name||data.title||data.original_name||data.original_title||"",
        originalTitle:data.original_name||data.original_title||"",
        seasonName:""
      };

      if(mediaType==="tv"&&season){
        try{
          const sUrl=`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`;
          const sRes=yield fetchWithTimeout(sUrl,{},6000);

          if(sRes.ok){
            const sData=yield sRes.json();
            info.seasonName=sData.name||"";
          }
        }catch(_){}
      }

      log(
        `TMDB metadata "${info.title}" `+
        `original="${info.originalTitle}" `+
        `season="${info.seasonName}"`
      );

      return info;
    }catch(e){
      log(`TMDB metadata error: ${e&&e.message||e}`);
      return null;
    }
  });
}

/* =========================================================
   ANIZONE SEARCH
   ========================================================= */

function normalize(str){
  if(typeof str!=="string")return"";
  return str.toLowerCase().replace(/[^a-z0-9]/g,"").trim();
}

function parseCards(html,$){
  const cards=[];
  const itemsMatch=html.match(
    /items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/
  );

  if(itemsMatch){
    try{
      const parsed=parseXDataJson(itemsMatch[1]);

      if(Array.isArray(parsed)){
        for(const item of parsed){
          if(!item||!item.slug)continue;

          const titles=new Set;

          if(typeof item.main_title==="string"&&item.main_title)
            titles.add(item.main_title);

          if(item.title_list&&typeof item.title_list==="object"){
            Object.values(item.title_list).forEach(t=>{
              if(typeof t==="string"&&t)
                titles.add(t);
            });
          }

          cards.push({
            slug:item.slug,
            url:item.url||`/anime/${item.slug}`,
            titles:Array.from(titles)
          });
        }
      }
    }catch(e){
      log(`AniZone card JSON parse failed: ${e&&e.message||e}`);
    }
  }

  if(cards.length===0){
    $('[x-data*="anmTitles"]').each((i,el)=>{
      const href=$(
        el
      ).find('a[href*="/anime/"]').first().attr("href");

      if(!href)return;

      const parts=href.split("/");
      const slug=
        parts[parts.length-1]||
        parts[parts.length-2];

      const titles=new Set;
      const xData=$(el).attr("x-data")||"";
      const jsonMatch=xData.match(
        /JSON\.parse\('((?:[^'\\]|\\.)*)'\)/
      );

      if(jsonMatch){
        try{
          const parsed=parseXDataJson(jsonMatch[1]);
          Object.values(parsed).forEach(t=>{
            if(typeof t==="string"&&t)
              titles.add(t);
          });
        }catch(_){}
      }

      cards.push({
        slug,
        titles:Array.from(titles)
      });
    });
  }

  return cards;
}

function searchCards(query){
  return __async(this,null,function*(){
    if(!query)return[];

    const cached=cacheGet(
      SEARCH_CACHE,
      query,
      10*60*1000
    );

    if(cached){
      log(`AniZone search memory HIT "${query}" cards=${cached.length}`);
      return cached;
    }

    log(`AniZone search "${query}"`);

    const searchUrl=
      `/anime?search=${encodeURIComponent(query)}&sort=title-asc`;

    const searchHtml=yield fetchText(searchUrl);

    if(!searchHtml){
      log(`AniZone search failed/empty "${query}"`);
      return[];
    }

    const $search=
      import_cheerio_without_node_native.default.load(
        searchHtml
      );

    const cards=parseCards(searchHtml,$search);

    cacheSet(SEARCH_CACHE,query,cards);

    log(`AniZone search result "${query}" cards=${cards.length}`);

    return cards;
  });
}

function getSeasonRegexes(season){
  if(season===1){
    return{
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
  }

  const patterns=[];

  if(season===2){
    patterns.push(
      /season\s*2/i,
      /saison\s*2/i,
      /2nd\s*season/i,
      /[\s\-]ii\b/i,
      /\b2\b/
    );
  }else if(season===3){
    patterns.push(
      /season\s*3/i,
      /saison\s*3/i,
      /3rd\s*season/i,
      /[\s\-]iii\b/i,
      /\b3\b/
    );
  }else if(season===4){
    patterns.push(
      /season\s*4/i,
      /saison\s*4/i,
      /4th\s*season/i,
      /[\s\-]iv\b/i,
      /\b4\b/,
      /final\s*season/i
    );
  }else{
    patterns.push(
      new RegExp(`(?:season|saison)\\s*${season}`,"i"),
      new RegExp(`\\b${season}\\b`)
    );
  }

  return{must:patterns};
}

function cardMatchesSeason(card,season,seasonRules){
  if(season===1){
    for(const title of card.titles){
      if(
        seasonRules.mustNot.some(
          regex=>regex.test(title)
        )
      )
        return false;
    }
    return true;
  }

  for(const title of card.titles){
    if(
      seasonRules.must.some(
        regex=>regex.test(title)
      )
    )
      return true;
  }

  return false;
}

function cardMatchesBase(card,normalizedBase){
  if(!normalizedBase)return false;

  for(const title of card.titles){
    const norm=normalize(title);

    if(
      norm.includes(normalizedBase)||
      normalizedBase.includes(norm)
    )
      return true;
  }

  return false;
}

function matchCard(
  cards,
  targetTitles,
  baseTitle,
  season=1,
  seasonName=""
){
  const normalizedTargets=
    targetTitles.map(normalize).filter(Boolean);

  const normalizedBase=normalize(baseTitle);
  const normalizedSeasonName=normalize(seasonName);
  const seasonRules=getSeasonRegexes(season);

  /*
   * CRITICAL:
   * Exact title matches take priority over season heuristics.
   * AniZone does not consistently put "Season 2", "II", etc.
   * in every valid season's searchable title.
   */
  for(const target of normalizedTargets){
    for(const card of cards){
      for(const title of card.titles){
        if(normalize(title)===target){
          log(`Exact title match "${target}" -> ${card.slug}`);
          return card.slug;
        }
      }
    }
  }

  /*
   * Season name is useful when exact title matching failed.
   */
  if(
    normalizedSeasonName&&
    normalizedSeasonName!=="season"+season
  ){
    for(const card of cards){
      if(!cardMatchesSeason(card,season,seasonRules))
        continue;

      for(const title of card.titles){
        if(
          normalize(title).includes(
            normalizedSeasonName
          )
        ){
          log(`Season-name match "${seasonName}" -> ${card.slug}`);
          return card.slug;
        }
      }
    }
  }

  /*
   * Only use season heuristics for non-exact/base matches.
   */
  for(const card of cards){
    if(!cardMatchesBase(card,normalizedBase))
      continue;

    if(cardMatchesSeason(card,season,seasonRules)){
      log(`Base+season match -> ${card.slug}`);
      return card.slug;
    }
  }

  /*
   * Last-resort base match. This preserves the behavior that
   * allowed AniZone titles without explicit season markers to work.
   */
  for(const card of cards){
    if(cardMatchesBase(card,normalizedBase)){
      log(`Base fallback match -> ${card.slug}`);
      return card.slug;
    }
  }

  return null;
}

function matchMovieCard(cards,targetTitles){
  const normalizedTargets=
    targetTitles.map(normalize).filter(Boolean);

  for(const card of cards){
    for(const title of card.titles){
      const norm=normalize(title);

      if(normalizedTargets.some(t=>t===norm)){
        log(`Movie exact title match -> ${card.slug}`);
        return card.slug;
      }
    }
  }

  for(const card of cards){
    for(const title of card.titles){
      const norm=normalize(title);

      if(
        normalizedTargets.some(
          t=>norm.includes(t)||t.includes(norm)
        )
      ){
        log(`Movie partial title match -> ${card.slug}`);
        return card.slug;
      }
    }
  }

  return null;
}

function searchAnimeSlug(
  query,
  targetTitles,
  baseTitle,
  season=1,
  seasonName="",
  bypassCache=false,
  isMovie=false
){
  return __async(this,null,function*(){
    const safeTargets=
      targetTitles.filter(
        v=>typeof v==="string"&&v.trim()
      );

    const cacheKey=
      `${query}|${season}|${safeTargets.join("|")}`;

    if(!bypassCache){
      const cached=cacheGet(
        SLUG_CACHE,
        cacheKey,
        10*60*1000
      );

      if(cached){
        log(`Slug cache HIT "${query}" -> ${cached}`);
        return cached;
      }
    }else{
      log(`Fresh slug search forced for "${query}"`);
    }

    let cards=yield searchCards(query);
    let slug=null;

    if(cards.length){
      slug=isMovie?
        matchMovieCard(cards,safeTargets):
        matchCard(
          cards,
          safeTargets,
          baseTitle||query,
          season,
          seasonName
        );
    }

    /*
     * Alternate titles are only attempted when the normal search
     * produced no usable match.
     */
    if(!slug){
      for(const title of safeTargets){
        const clean=title.split(":")[0].trim();

        if(
          !clean||
          normalize(clean)===normalize(query)
        )
          continue;

        const altCards=yield searchCards(clean);

        if(!altCards.length)
          continue;

        slug=isMovie?
          matchMovieCard(altCards,safeTargets):
          matchCard(
            altCards,
            safeTargets,
            clean,
            season,
            seasonName
          );

        if(slug){
          log(`Alternate title resolved "${clean}" -> ${slug}`);
          break;
        }
      }
    }

    if(!slug){
      log(`No AniZone slug match for "${query}" S${season}`);
      return null;
    }

    cacheSet(
      SLUG_CACHE,
      cacheKey,
      slug
    );

    log(
      `${bypassCache?"Fresh":"Normal"} slug resolved `+
      `"${query}" -> ${slug}`
    );

    return slug;
  });
}

/* =========================================================
   STREAM EXTRACTION
   ========================================================= */

function parseVidstackFromHtml(html,$){
  const vidMatch=html.match(
    /vidstackPlayer\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/
  );

  if(vidMatch){
    try{
      const data=parseXDataJson(vidMatch[1]);

      const masterUrl=
        data.src?
        data.src.replace(/\\/g,""):
        null;

      const subtitles=(data.subtitles||[])
        .map(s=>({
          url:s.file?
            s.file.replace(/\\/g,""):
            "",
          name:s.title||s.language||"English",
          language:s.language||"en"
        }))
        .filter(s=>s.url);

      if(masterUrl)
        return{
          masterUrl,
          subtitles
        };
    }catch(_){}
  }

  let masterUrl=$("media-player").attr("src");

  if(!masterUrl){
    const urlMatch=
      html.match(
        /https:\/\/[^"']+\/master\.m3u8/
      );

    if(urlMatch)
      masterUrl=urlMatch[0];
  }

  const subtitles=[];

  $("track").each((i,el)=>{
    const src=$(el).attr("src");
    const kind=$(el).attr("kind");

    if(
      src&&(
        kind==="subtitles"||
        kind==="captions"||
        src.endsWith(".ass")||
        src.endsWith(".vtt")
      )
    ){
      subtitles.push({
        url:src,
        name:$(el).attr("label")||"English",
        language:$(el).attr("srclang")||"en"
      });
    }
  });

  return{
    masterUrl,
    subtitles
  };
}

function parseAudioFormat(btnText){
  const lower=btnText.toLowerCase();

  const hasJap=
    lower.includes("japanese")||
    lower.includes("jpn")||
    lower.includes(" ja");

  const hasEng=
    lower.includes("english")||
    lower.includes("eng")||
    lower.includes(" en");

  if(hasEng&&hasJap)return"Dual Audio";
  if(hasEng)return"Dub";
  if(hasJap)return"Sub";
  if(lower.includes("multi"))return"Multi-Audio";

  return"Sub";
}

function fetchEpisodePage(slug,episode){
  return __async(this,null,function*(){
    const episodeUrl=`/anime/${slug}/${episode}`;

    log(`Episode GET ${episodeUrl}`);

    const response=yield fetchWithCookies(episodeUrl);

    if(!response.ok||!response.text){
      log(`Episode GET failed ${episodeUrl}`);
      return null;
    }

    const $=
      import_cheerio_without_node_native.default.load(
        response.text
      );

    const parsed=
      parseVidstackFromHtml(
        response.text,
        $
      );

    log(
      `Episode loaded ${episodeUrl} `+
      `master=${parsed&&parsed.masterUrl?"YES":"NO"} `+
      `cookies=${response.cookies?"YES":"NO"}`
    );

    return{
      url:episodeUrl,
      response,
      html:response.text,
      $,
      parsed
    };
  });
}

function getStreamsFromEpisodePage(
  animeTitle,
  mappedEp,
  episodeData
){
  return __async(this,null,function*(){
    if(!episodeData)return[];

    const{
      url:episodeUrl,
      response:epResponse,
      $:ep$,
      parsed:defaultStream
    }=episodeData;

    const streams=[];

    const serverButtons=
      ep$('button[wire\\:click*="setVideo"]');

    log(
      `Stream extraction E${mappedEp} `+
      `servers=${serverButtons.length} `+
      `default=${defaultStream&&defaultStream.masterUrl?"YES":"NO"}`
    );

    let defaultFormat="Sub";
    let defaultServerName="AniZone";

    if(serverButtons.length>0){
      const firstBtn=serverButtons.first();

      const btnText=
        firstBtn.text()
          .replace(/\s+/g," ")
          .trim();

      defaultFormat=parseAudioFormat(btnText);

      const nameMatch=
        btnText.match(/^([A-Za-z0-9_-]+)/);

      if(nameMatch)
        defaultServerName=nameMatch[1];

      log(
        `Default server "${defaultServerName}" `+
        `format=${defaultFormat}`
      );
    }

    if(defaultStream&&defaultStream.masterUrl){
      streams.push({
        name:"AniZone",
        title:
          `${animeTitle} - Episode ${mappedEp} `+
          `[${defaultServerName} - ${defaultFormat}]`,
        url:defaultStream.masterUrl,
        quality:"Multi",
        headers:HEADERS,
        subtitles:defaultStream.subtitles
      });

      log(`Default stream extracted`);
    }

    if(serverButtons.length>1){
      const csrfToken=
        ep$('script[data-csrf]').attr("data-csrf");

      const snapshotEl=
        ep$('main > div[wire\\:snapshot], main > ul[wire\\:snapshot], [wire\\:snapshot]');

      const snapshot=
        snapshotEl.attr("wire:snapshot");

      log(
        `Livewire state csrf=${csrfToken?"YES":"NO"} `+
        `snapshot=${snapshot?"YES":"NO"} `+
        `cookies=${epResponse.cookies?"YES":"NO"}`
      );

      if(csrfToken&&snapshot&&epResponse.cookies){
        for(let i=1;i<serverButtons.length;i++){
          const btn=serverButtons.eq(i);
          const clickAttr=btn.attr("wire:click")||"";
          const vMatch=clickAttr.match(/setVideo\((\d+)\)/);

          if(!vMatch){
            log(`Server ${i+1}: no setVideo ID`);
            continue;
          }

          const videoId=parseInt(vMatch[1],10);

          const btnText=
            btn.text()
              .replace(/\s+/g," ")
              .trim();

          const sFormat=parseAudioFormat(btnText);
          const nameMatch=btnText.match(/^([A-Za-z0-9_-]+)/);
          const sName=nameMatch?nameMatch[1]:`Server ${i+1}`;

          log(
            `Server ${i+1} "${sName}" `+
            `videoId=${videoId} format=${sFormat}`
          );

          try{
            const payload={
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

            const postRes=
              yield fetchWithTimeout(
                `${MAIN_URL}/livewire/update`,
                {
                  method:"POST",
                  headers:{
                    "Accept":"*/*",
                    "Content-Type":"application/json",
                    "X-Livewire":"",
                    "X-CSRF-TOKEN":csrfToken,
                    "Origin":MAIN_URL,
                    "Referer":`${MAIN_URL}${episodeUrl}`,
                    "Cookie":epResponse.cookies
                  },
                  body:JSON.stringify(payload)
                },
                8000
              );

            if(!postRes.ok){
              log(
                `Server ${i+1} Livewire HTTP ${postRes.status}`
              );
              continue;
            }

            const postData=yield postRes.json();

            const liveHtml=
              postData&&
              postData.components&&
              postData.components[0]&&
              postData.components[0].effects&&
              postData.components[0].effects.html;

            if(!liveHtml){
              log(`Server ${i+1} Livewire returned no HTML`);
              continue;
            }

            const $live=
              import_cheerio_without_node_native.default.load(
                liveHtml
              );

            const extraStream=
              parseVidstackFromHtml(
                liveHtml,
                $live
              );

            if(
              extraStream&&
              extraStream.masterUrl&&
              (!defaultStream||
                extraStream.masterUrl!==defaultStream.masterUrl)
            ){
              streams.push({
                name:"AniZone",
                title:
                  `${animeTitle} - Episode ${mappedEp} `+
                  `[${sName} - ${sFormat}]`,
                url:extraStream.masterUrl,
                quality:"Multi",
                headers:HEADERS,
                subtitles:
                  extraStream.subtitles.length>0?
                  extraStream.subtitles:
                  defaultStream?
                  defaultStream.subtitles:
                  []
              });

              log(`Server ${i+1} stream extracted`);
            }else{
              log(`Server ${i+1} returned no unique stream`);
            }
          }catch(e){
            log(
              `Server ${i+1} extraction error: `+
              `${e&&e.message||e}`
            );
          }
        }
      }
    }

    log(`Stream extraction complete: ${streams.length} streams`);

    return streams;
  });
}

/* =========================================================
   MAIN
   ========================================================= */

function getStreams(
  tmdbId,
  mediaType="tv",
  season=1,
  episode=1
){
  return __async(this,null,function*(){
    try{
      season=parseInt(season,10)||1;
      episode=parseInt(episode,10)||1;

      log(
        `START TMDB=${tmdbId} `+
        `type=${mediaType} S${season}E${episode}`
      );

      let animeTitle="";
      let altTitles=[];
      let targetTitles=[];
      let mappedEp=episode;
      let seasonName="";
      let imdbId=null;
      let persistentSeason=null;
      let mapping=null;
      let animeSlug=null;
      let cacheDirty=false;

      if(mediaType==="tv"){
        imdbId=yield getImdbId(tmdbId,"tv");

        if(!imdbId){
          log(`No IMDb ID; cannot use persistent/mapping cache`);
        }

        if(imdbId){
          persistentSeason=
            yield getPersistentSeasonCache(
              imdbId,
              season
            );

          if(
            persistentSeason&&
            persistentSeason.animeSlug&&
            persistentSeason.episodes&&
            persistentSeason.episodes[String(episode)]
          ){
            const cachedEpisode=
              persistentSeason.episodes[String(episode)];

            animeSlug=persistentSeason.animeSlug;
            mapping=cachedEpisode;
            mappedEp=
              parseInt(cachedEpisode.mal_episode,10)||episode;
            animeTitle=cachedEpisode.anime_title||"";

            targetTitles=
              Array.isArray(cachedEpisode.titles)?
              [...cachedEpisode.titles]:
              [];

            log(
              `PERSISTENT CACHE HIT `+
              `${imdbId}:S${season}E${episode} `+
              `slug=${animeSlug} `+
              `mapped=E${mappedEp} `+
              `title="${animeTitle}"`
            );
          }else{
            log(
              `PERSISTENT CACHE has no episode `+
              `${imdbId}:S${season}E${episode}`
            );
          }

          if(!mapping){
            mapping=
              yield resolveMapping(
                imdbId,
                season,
                episode,
                tmdbId
              );

            if(mapping){
              mappedEp=
                parseInt(mapping.mal_episode,10)||episode;
              animeTitle=mapping.anime_title||"";

              if(Array.isArray(mapping.titles))
                targetTitles.push(...mapping.titles);

              targetTitles=[
                ...new Set(
                  targetTitles.filter(Boolean)
                )
              ];

              log(
                `Mapping resolved `+
                `"${animeTitle}" `+
                `E${episode}->E${mappedEp} `+
                `source=${mapping.source||"unknown"}`
              );
            }else{
              log(`No mapping available for TMDB=${tmdbId} S${season}E${episode}`);
            }
          }
        }

        if(
          !animeSlug||
          !animeTitle
        ){
          const tmdbInfo=
            yield getTmdbInfo(
              tmdbId,
              "tv",
              season
            );

          if(tmdbInfo){
            if(!animeTitle)
              animeTitle=tmdbInfo.title;

            if(tmdbInfo.originalTitle)
              altTitles.push(
                tmdbInfo.originalTitle
              );

            seasonName=
              tmdbInfo.seasonName||"";

            if(
              !targetTitles.length&&
              tmdbInfo.originalTitle
            )
              targetTitles.push(
                tmdbInfo.originalTitle
              );
          }
        }

        targetTitles=[
          ...new Set(
            targetTitles.concat(
              animeTitle?[animeTitle]:[],
              altTitles
            ).filter(Boolean)
          )
        ];
      }else{
        const tmdbInfo=
          yield getTmdbInfo(
            tmdbId,
            "movie"
          );

        if(tmdbInfo){
          animeTitle=tmdbInfo.title;

          if(tmdbInfo.originalTitle)
            altTitles.push(
              tmdbInfo.originalTitle
            );
        }

        targetTitles=[
          ...new Set([
            animeTitle,
            ...altTitles
          ].filter(Boolean))
        ];

        mappedEp=1;
      }

      if(!animeTitle&&targetTitles.length)
        animeTitle=targetTitles[0];

      if(!animeTitle&&targetTitles.length===0){
        log(`ABORT: no usable title`);
        return[];
      }

      const cleanedBase=
        animeTitle
          .split(":")[0]
          .replace(
            /season.*|\d+nd season|\d+rd season|\d+th season|saison.*/gi,
            ""
          )
          .trim();

      const baseCleanQuery=
        cleanedBase||animeTitle.trim();

      const specificTargetTitles=
        season===1||mediaType==="movie"?
        [...new Set([
          ...targetTitles,
          animeTitle,
          ...altTitles
        ])]:
        [...new Set([
          ...targetTitles,
          animeTitle
        ])];

      log(
        `Identity title="${animeTitle}" `+
        `base="${baseCleanQuery}" `+
        `targets=${specificTargetTitles.length} `+
        `mappedEpisode=${mappedEp} `+
        `slug=${animeSlug||"none"}`
      );

      if(!animeSlug){
        animeSlug=
          yield searchAnimeSlug(
            baseCleanQuery,
            specificTargetTitles,
            baseCleanQuery,
            season,
            seasonName,
            false,
            mediaType==="movie"
          );
      }else{
        log(`Using persistent-cache slug "${animeSlug}" without search`);
      }

      let episodeData=null;

      if(animeSlug){
        episodeData=
          yield fetchEpisodePage(
            animeSlug,
            mappedEp
          );

        if(
          !episodeData||
          !episodeData.parsed||
          !episodeData.parsed.masterUrl
        ){
          log(
            `Selected slug FAILED `+
            `"${animeSlug}" E${mappedEp}; `+
            `forcing fresh AniZone search`
          );

          animeSlug=null;
          episodeData=null;

          const freshQueries=[
            baseCleanQuery,
            animeTitle.split(":")[0].trim(),
            ...altTitles.map(
              t=>t.split(":")[0].trim()
            ),
            ...targetTitles.map(
              t=>t.split(":")[0].trim()
            )
          ].filter(Boolean);

          for(
            const query of [...new Set(freshQueries)]
          ){
            log(`Fresh recovery query "${query}"`);

            const freshSlug=
              yield searchAnimeSlug(
                query,
                specificTargetTitles,
                query,
                season,
                seasonName,
                true,
                mediaType==="movie"
              );

            if(!freshSlug)
              continue;

            const freshEpisodeData=
              yield fetchEpisodePage(
                freshSlug,
                mappedEp
              );

            if(
              freshEpisodeData&&
              freshEpisodeData.parsed&&
              freshEpisodeData.parsed.masterUrl
            ){
              animeSlug=freshSlug;
              episodeData=freshEpisodeData;

              const originalSlugCacheKey=
                `${baseCleanQuery}|${season}|${specificTargetTitles.join("|")}`;

              cacheSet(
                SLUG_CACHE,
                originalSlugCacheKey,
                freshSlug
              );

              log(
                `Fresh recovery SUCCESS `+
                `slug=${freshSlug} query="${query}"`
              );

              break;
            }

            log(
              `Fresh recovery slug "${freshSlug}" `+
              `still failed E${mappedEp}`
            );
          }
        }
      }

      if(!animeSlug||!episodeData){
        log(
          `FAIL: no usable AniZone episode `+
          `"${animeTitle}" E${mappedEp}`
        );
        return[];
      }

      const streams=
        yield getStreamsFromEpisodePage(
          animeTitle,
          mappedEp,
          episodeData
        );

      if(
        mediaType==="tv"&&
        imdbId&&
        mapping&&
        animeSlug&&
        streams.length>0
      ){
        const cacheEpisode=
          __spreadProps(
            __spreadValues({},mapping),
            {
              imdb_id:imdbId,
              season,
              episode,
              mal_episode:mappedEp,
              anime_title:animeTitle,
              titles:[
                ...new Set([
                  ...(mapping.titles||[]),
                  ...targetTitles
                ].filter(Boolean))
              ]
            }
          );

        if(persistentSeason){
          persistentSeason=
            __spreadProps(
              __spreadValues({},persistentSeason),
              {animeSlug}
            );

          persistentSeason=
            addCachedEpisode(
              persistentSeason,
              cacheEpisode
            );
        }else{
          persistentSeason=
            buildPersistentSeasonData(
              animeSlug,
              season,
              [cacheEpisode]
            );
        }

        cacheDirty=!!persistentSeason;

        log(
          `Persistent cache prepared `+
          `${imdbId}:s${season} `+
          `episode=${episode} `+
          `slug=${animeSlug}`
        );
      }else if(
        mediaType==="tv"&&
        mapping&&
        streams.length===0
      ){
        log(
          `Persistent cache NOT updated because `+
          `stream count=0`
        );
      }

      if(cacheDirty&&persistentSeason){
        savePersistentSeasonCache(
          imdbId,
          season,
          persistentSeason
        ).then(ok=>{
          if(ok){
            log(
              `Persistent season cache updated `+
              `${imdbId}:s${season}`
            );
          }
        }).catch(e=>{
          log(
            `Async persistent cache write error: `+
            `${e&&e.message||e}`
          );
        });
      }

      log(
        `DONE TMDB=${tmdbId} `+
        `S${season}E${episode} `+
        `AniZoneE${mappedEp} `+
        `slug=${animeSlug} `+
        `streams=${streams.length}`
      );

      return streams;
    }catch(error){
      log(
        `FATAL ERROR TMDB=${tmdbId} `+
        `S${season}E${episode}: `+
        `${error&&error.message||error}`
      );
      return[];
    }
  });
}

module.exports={getStreams};
