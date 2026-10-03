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
var __async=(__this,__arguments,generator)=>new Promise((resolve,reject)=>{var fulfilled=value=>{try{step(generator.next(value));}catch(e){reject(e);}},rejected=e=>{try{step(generator.throw(e));}},step=x=>x.done?resolve(x.value):Promise.resolve(x.value).then(fulfilled, rejected);step((generator=generator.apply(__this,__arguments)).next());});

var import_cheerio_without_node_native=__toESM(require("cheerio-without-node-native"));

console.log("[AniZone] PROVIDER FILE LOADED");

var MAIN_URL="https://anizone.to";
var HEADERS={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Referer":"https://anizone.to/"
};
var TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
var ANIME_MAPPING_URL="https://breezy-plugins.netlify.app/api/anime-mapping";

var HEX_ESCAPE=/\\x([0-9a-fA-F]{2})/g;
var INVALID_BACKSLASH=/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g;

var MAPPING_MEMORY_CACHE=new Map;
var SEARCH_CACHE=new Map;
var SLUG_CACHE=new Map;
var IMDB_CACHE=new Map;
var SEASON_RESOLUTION_CACHE=new Map;
var WEB_ANI_CACHE=new Map;

var MAX_CACHE=300;
var MAX_MAPPING_CACHE=300;
var MAX_SEASON_CACHE=200;
var MAX_WEB_ANI_CACHE=200;
var MAPPING_TIMEOUT=6000;
var SEASON_CACHE_TTL=6*60*60*1000;
var WEB_CACHE_TTL=24*60*60*1000;

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
    if(cached)return cached;
    try{
      const type=mediaType==="tv"?"tv":"movie";
      const url=`https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
      const res=yield fetchWithTimeout(url,{},5000);
      if(!res.ok)return null;
      const data=yield res.json();
      const id=data&&data.imdb_id||null;
      if(id)cacheSet(IMDB_CACHE,key,id);
      return id;
    }catch(_){
      return null;
    }
  });
}

/* =========================================================
   ANIBRIDGE PRIMARY MAPPING
   ========================================================= */

function getAniBridgeMapping(tmdbId,season,episode){
  return __async(this,null,function*(){
    const key=`${tmdbId}:s${season}:e${episode}`;
    const cached=cacheGet(MAPPING_MEMORY_CACHE,key);
    if(cached)return cached;
    try{
      const url=`${ANIME_MAPPING_URL}?tmdbId=${encodeURIComponent(tmdbId)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
      console.log(`[AniZone] AniBridge lookup request TMDB=${tmdbId} S${season}E${episode}`);
      const res=yield fetchWithTimeout(url,{
        headers:{"Accept":"application/json"}
      },MAPPING_TIMEOUT);
      console.log(`[AniZone] AniBridge lookup HTTP ${res.status}`);
      if(!res.ok)return null;
      const body=yield res.json();
      console.log(`[AniZone] AniBridge lookup result ok=${!!(body&&body.ok)} mapped=${!!(body&&body.mapping)}`);
      if(!body||!body.ok||!body.mapping)return null;
      cacheSet(MAPPING_MEMORY_CACHE,key,body.mapping,MAX_MAPPING_CACHE);
      return body.mapping;
    }catch(e){
      console.log(`[AniZone] AniBridge lookup failed: ${e.message}`);
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
      const query=`query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native}synonyms format episodes season seasonYear startDate{year month day}status}}`;
      const res=yield fetchWithTimeout("https://graphql.anilist.co",{
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          query,
          variables:{id}
        })
      },5000);
      if(!res.ok)return null;
      const body=yield res.json();
      const data=body&&body.data&&body.data.Media;
      if(!data)return null;
      return{
        id:data.id,
        title:data.title&&(data.title.english||data.title.romaji||data.title.native||""),
        titles:[
          data.title&&data.title.romaji,
          data.title&&data.title.english,
          data.title&&data.title.native,
          ...(Array.isArray(data.synonyms)?data.synonyms:[])
        ].filter(Boolean),
        format:data.format||"",
        episodes:data.episodes||null,
        season:data.season||null,
        seasonYear:data.seasonYear||null,
        startDate:data.startDate||null,
        status:data.status||null
      };
    }catch(_){
      return null;
    }
  });
}

function searchAniListByTitle(title,year){
  return __async(this,null,function*(){
    if(!title)return[];
    const clean=title.replace(/\s+/g," ").trim();
    if(!clean)return[];
    const key=`${clean.toLowerCase()}:${year||""}`;
    const cached=cacheGet(WEB_ANI_CACHE,key,WEB_CACHE_TTL);
    if(cached)return cached;
    try{
      const query=`query($search:String,$seasonYear:Int){Page(perPage:10){media(search:$search,type:ANIME,seasonYear:$seasonYear){id title{romaji english native}synonyms format episodes season seasonYear startDate{year month day}}}}`;
      const variables={search:clean};
      if(Number.isInteger(Number(year)))variables.seasonYear=Number(year);
      const res=yield fetchWithTimeout("https://graphql.anilist.co",{
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          query,
          variables
        })
      },7000);
      if(!res.ok)return[];
      const body=yield res.json();
      const list=body&&body.data&&body.data.Page&&body.data.Page.media;
      if(!Array.isArray(list))return[];
      cacheSet(WEB_ANI_CACHE,key,list,MAX_WEB_ANI_CACHE);
      return list;
    }catch(_){
      return[];
    }
  });
}

/* =========================================================
   TITLE / SEASON RESOLUTION FALLBACK
   ========================================================= */

function normalizeTitle(value){
  return String(value||"")
    .toLowerCase()
    .replace(/&/g," and ")
    .replace(/[’'`]/g,"")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function titleTokens(value){
  return normalizeTitle(value)
    .split(" ")
    .filter(v=>v.length>1);
}

function titleSimilarity(a,b){
  const na=normalizeTitle(a);
  const nb=normalizeTitle(b);
  if(!na||!nb)return 0;
  if(na===nb)return 1;
  if(na.includes(nb)||nb.includes(na))return .92;
  const aa=new Set(titleTokens(na));
  const bb=new Set(titleTokens(nb));
  if(!aa.size||!bb.size)return 0;
  let same=0;
  aa.forEach(v=>{if(bb.has(v))same++;});
  return same/Math.max(aa.size,bb.size);
}

function getTmdbSeasonInfo(tmdbId,season){
  return __async(this,null,function*(){
    const key=`tmdb:${tmdbId}:season:${season}`;
    const cached=cacheGet(SEASON_RESOLUTION_CACHE,key,SEASON_CACHE_TTL);
    if(cached&&cached.tmdb)return cached.tmdb;
    try{
      const url=`https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}/season/${encodeURIComponent(season)}?api_key=${TMDB_API_KEY}`;
      const res=yield fetchWithTimeout(url,{},6000);
      if(!res.ok)return null;
      const data=yield res.json();
      if(!data||!data.id)return null;
      return data;
    }catch(_){
      return null;
    }
  });
}

function getTmdbShowInfo(tmdbId){
  return __async(this,null,function*(){
    const key=`tmdb:${tmdbId}:show`;
    const cached=cacheGet(SEASON_RESOLUTION_CACHE,key,SEASON_CACHE_TTL);
    if(cached&&cached.show)return cached.show;
    try{
      const url=`https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}?api_key=${TMDB_API_KEY}`;
      const res=yield fetchWithTimeout(url,{},6000);
      if(!res.ok)return null;
      const data=yield res.json();
      return data||null;
    }catch(_){
      return null;
    }
  });
}

function searchWebForAniList(title,year,tmdbId,season){
  return __async(this,null,function*(){
    const key=`${tmdbId}:s${season}`;
    const cached=cacheGet(WEB_ANI_CACHE,key,WEB_CACHE_TTL);
    if(cached)return cached;

    const queries=[
      `"${title}" AniList`,
      `"${title}" season ${season} AniList`,
      `"${title}" ${year||""} AniList anime`
    ];

    for(const query of queries){
      try{
        const url=`https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;
        const res=yield fetchWithTimeout(url,{
          headers:{
            "Accept":"text/html,application/xhtml+xml",
            "Accept-Language":"en-US,en;q=0.9"
          }
        },7000);
        if(!res.ok)continue;
        const html=yield res.text();
        const ids=[];
        const patterns=[
          /anilist\.co\/anime\/(\d+)/gi,
          /anilist\.co\/anime\/(\d+)[^"'<\s]*/gi
        ];
        for(const pattern of patterns){
          let match;
          while((match=pattern.exec(html))){
            const id=Number(match[1]);
            if(Number.isInteger(id)&&id>0&&!ids.includes(id))ids.push(id);
          }
        }
        if(!ids.length)continue;

        const results=[];
        for(const id of ids.slice(0,8)){
          const meta=yield getAniListMetadata(id);
          if(meta)results.push(meta);
        }

        if(results.length){
          cacheSet(WEB_ANI_CACHE,key,results,MAX_WEB_ANI_CACHE);
          return results;
        }
      }catch(_){}
    }

    const direct=yield searchAniListByTitle(title,year);
    if(direct.length){
      cacheSet(WEB_ANI_CACHE,key,direct,MAX_WEB_ANI_CACHE);
      return direct;
    }

    return[];
  });
}

function chooseAniListSeason(results,tmdbSeason,tmdbShow,season){
  if(!Array.isArray(results)||!results.length)return null;

  const tmdbTitle=
    tmdbSeason&&(
      tmdbSeason.name||
      tmdbSeason.english_name||
      tmdbSeason.original_name
    )||
    "";

  const showTitle=
    tmdbShow&&(
      tmdbShow.name||
      tmdbShow.original_name
    )||
    "";

  const wantedYear=
    Number(
      (tmdbSeason&&tmdbSeason.air_date&&tmdbSeason.air_date.slice(0,4))||
      (tmdbShow&&tmdbShow.first_air_date&&tmdbShow.first_air_date.slice(0,4))||
      0
    );

  let best=null;
  let bestScore=-1;

  for(const item of results){
    if(!item||!item.id)continue;

    let score=0;

    const titles=[
      item.title&&item.title.romaji,
      item.title&&item.title.english,
      item.title&&item.title.native,
      ...(Array.isArray(item.synonyms)?item.synonyms:[])
    ].filter(Boolean);

    let sim=0;
    for(const t of titles){
      sim=Math.max(
        sim,
        titleSimilarity(tmdbTitle,t),
        titleSimilarity(showTitle,t)
      );
    }

    score+=sim*70;

    if(
      wantedYear&&
      item.seasonYear&&
      Math.abs(Number(item.seasonYear)-wantedYear)<=1
    )
      score+=15;

    if(
      item.season&&
      season>1
    ){
      const expected=["WINTER","SPRING","SUMMER","FALL"];
      if(expected.includes(item.season))score+=2;
    }

    if(item.format==="TV")score+=5;
    if(item.episodes)score+=2;

    if(score>bestScore){
      bestScore=score;
      best={
        item,
        score
      };
    }
  }

  if(!best||best.score<35)return null;

  return best.item;
}

function resolveWebSeason(imdbId,tmdbId,season,episode){
  return __async(this,null,function*(){
    const cacheKey=`${tmdbId}:s${season}`;
    const cached=cacheGet(
      SEASON_RESOLUTION_CACHE,
      cacheKey,
      SEASON_CACHE_TTL
    );

    if(cached&&cached.anilist_id){
      const mappedEpisode=
        cached.episodeMap&&
        cached.episodeMap[String(episode)]||
        episode;

      return{
        id:`${imdbId||tmdbId}:s${season}:e${episode}`,
        imdb_id:imdbId||"",
        season:Number(season),
        episode:Number(episode),
        mal_id:cached.mal_id||"",
        anilist_id:String(cached.anilist_id),
        mal_episode:Number(mappedEpisode),
        anime_title:cached.anilist_title||cached.title||"",
        anilist_season_title:cached.anilist_season_title||"",
        titles:Array.isArray(cached.titles)?cached.titles:[],
        air_date:cached.air_date||"",
        source:"web"
      };
    }

    const tmdbSeason=yield getTmdbSeasonInfo(tmdbId,season);
    const tmdbShow=yield getTmdbShowInfo(tmdbId);

    if(!tmdbSeason&&!tmdbShow)return null;

    const seasonTitle=
      tmdbSeason&&(
        tmdbSeason.name||
        tmdbSeason.english_name||
        tmdbSeason.original_name
      )||
      (tmdbShow&&(tmdbShow.name||tmdbShow.original_name))||
      "";

    const seasonYear=
      tmdbSeason&&tmdbSeason.air_date?
        Number(tmdbSeason.air_date.slice(0,4)):
        tmdbShow&&tmdbShow.first_air_date?
          Number(tmdbShow.first_air_date.slice(0,4)):
          null;

    if(!seasonTitle)return null;

    console.log(
      `[AniZone] Web season resolver `+
      `TMDB=${tmdbId} S${season} title="${seasonTitle}" `+
      `year=${seasonYear||"unknown"}`
    );

    const results=yield searchWebForAniList(
      seasonTitle,
      seasonYear,
      tmdbId,
      season
    );

    const selected=chooseAniListSeason(
      results,
      tmdbSeason,
      tmdbShow,
      season
    );

    if(!selected){
      console.log(
        `[AniZone] Web season resolver failed `+
        `TMDB=${tmdbId} S${season}`
      );
      return null;
    }

    const anilistMeta=
      selected.id?
      yield getAniListMetadata(selected.id):
      selected;

    if(!anilistMeta)return null;

    let malId="";

    try{
      const query=`query($id:Int){Media(id:$id,type:ANIME){id idMal}}`;
      const res=yield fetchWithTimeout("https://graphql.anilist.co",{
        method:"POST",
        headers:{
          "Accept":"application/json",
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          query,
          variables:{id:Number(selected.id)}
        })
      },5000);

      if(res.ok){
        const body=yield res.json();
        malId=body&&body.data&&body.data.Media&&body.data.Media.idMal?
          String(body.data.Media.idMal):
          "";
      }
    }catch(_){}

    const anilistTitle=
      anilistMeta.title||
      selected.title&&(
        selected.title.english||
        selected.title.romaji||
        selected.title.native
      )||
      "";

    const titles=[
      ...(anilistMeta.titles||[]),
      ...(selected.synonyms||[]),
      seasonTitle
    ].filter(Boolean);

    const tmdbEpisodes=
      tmdbSeason&&
      Array.isArray(tmdbSeason.episodes)?
      tmdbSeason.episodes:
      [];

    const episodeMap={};

    if(tmdbEpisodes.length&&anilistMeta.episodes){
      if(tmdbEpisodes.length===Number(anilistMeta.episodes)){
        tmdbEpisodes.forEach((ep,i)=>{
          if(ep&&ep.episode_number)
            episodeMap[String(ep.episode_number)]=i+1;
        });
      }
    }

    const resolvedEpisode=
      episodeMap[String(episode)]||
      Number(episode);

    const result={
      id:`${imdbId||tmdbId}:s${season}:e${episode}`,
      imdb_id:imdbId||"",
      season:Number(season),
      episode:Number(episode),
      mal_id:malId,
      anilist_id:String(selected.id),
      mal_episode:resolvedEpisode,
      anime_title:anilistTitle,
      anilist_season_title:anilistTitle,
      titles:[...new Set(titles)],
      air_date:
        tmdbSeason&&tmdbSeason.air_date||
        "",
      source:"web"
    };

    cacheSet(
      SEASON_RESOLUTION_CACHE,
      cacheKey,
      {
        tmdb:tmdbSeason,
        show:tmdbShow,
        anilist_id:result.anilist_id,
        mal_id:result.mal_id,
        anilist_title:result.anime_title,
        anilist_season_title:result.anilist_season_title,
        title:seasonTitle,
        titles:result.titles,
        air_date:result.air_date,
        episodeMap
      },
      MAX_SEASON_CACHE
    );

    console.log(
      `[AniZone] Web mapped `+
      `TMDB=${tmdbId} S${season}E${episode} -> `+
      `AniList=${result.anilist_id} `+
      `"${result.anilist_season_title}" E${resolvedEpisode}`
    );

    return result;
  });
}

/* =========================================================
   MAL METADATA
   ========================================================= */

function getMalMetadata(malId){
  return __async(this,null,function*(){
    if(!malId)return null;
    try{
      const id=Number(malId);
      if(!Number.isInteger(id)||id<1)return null;
      const res=yield fetchWithTimeout(`https://api.jikan.moe/v4/anime/${id}`,{},5000);
      if(!res.ok)return null;
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
    }catch(_){
      return null;
    }
  });
}

function getMalTitle(malId){
  return __async(this,null,function*(){
    const metadata=yield getMalMetadata(malId);
    return metadata&&metadata.title||null;
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

    const mapping=normalizeAniBridgeMapping(
      raw,
      tmdbId,
      season,
      episode,
      imdbId
    );

    if(!mapping)return null;

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
        mapping.anilist_season_title=metadata.title||"";
      }
    }

    if(!mapping.anime_title&&mapping.titles.length)
      mapping.anime_title=mapping.titles[0];

    if(!mapping.anime_title)return null;

    console.log(
      `[AniZone] AniBridge mapped "${mapping.anime_title}" `+
      `S${season}E${episode} -> E${mapping.mal_episode}`
    );

    return mapping;
  });
}

/* =========================================================
   LEGACY MAPPING - FALLBACK ONLY
   ========================================================= */

function isDateMatch(d1,d2){
  if(!d1||!d2)return false;
  const s1=d1.split("T")[0];
  const s2=d2.split("T")[0];
  const date1=new Date(s1+"T00:00:00Z");
  const date2=new Date(s2+"T00:00:00Z");
  const diff=Math.abs(date1.getTime()-date2.getTime());
  return Math.ceil(diff/(1000*60*60*24))<=2;
}

function resolveLegacyMapping(imdbId,season,episode,tmdbId){
  return __async(this,null,function*(){
    var _a,_b;
    const seasonNum=parseInt(season,10);
    const episodeNum=parseInt(episode,10);
    const mapId=`${imdbId}:s${season}:e${episode}`;
    let metaData=null;

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
            break;
          }
        }
      }catch(_){}
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
        }
      }catch(_){}
    }

    if(!metaData||!metaData.videos)return null;

    const video=metaData.videos.find(
      v=>v.season===seasonNum&&v.episode===episodeNum
    );

    if(!video||!video.released)return null;

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
      }catch(_){}
    }

    try{
      const aniIdUrl=tId?
        `https://api.ani.zip/mappings?themoviedb_id=${tId}`:
        `https://api.ani.zip/mappings?imdb_id=${imdbId}`;

      const aniRes=yield fetchWithTimeout(
        aniIdUrl,
        {},
        5000
      );

      if(aniRes.ok){
        const aniData=yield aniRes.json();

        if(
          (_b=aniData==null?void 0:aniData.mappings)==null?
          void 0:
          _b.mal_id
        )
          malIds.push(aniData.mappings.mal_id);
      }
    }catch(_){}

    malIds=[
      ...new Set(malIds)
    ].filter(Boolean).sort((a,b)=>b-a);

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
                air_date:
                  ep.airDateUtc||
                  ep.airDate||
                  ep.airdate
              }))
              .filter(ep=>!isNaN(ep.mal_episode_number));

            const matches=aniEpisodes
              .filter(ep=>isDateMatch(ep.air_date,airDate))
              .sort(
                (a,b)=>
                  a.mal_episode_number-
                  b.mal_episode_number
              );

            if(matches[dayIndex]){
              const match=matches[dayIndex];

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
      }catch(_){}

      try{
        const jRes=yield fetchWithTimeout(
          `https://api.jikan.moe/v4/anime/${malId}`,
          {},
          5000
        );

        if(jRes.ok){
          const jData=yield jRes.json();
          const aired=jData&&
            jData.data&&
            jData.data.aired;

          if(
            aired&&
            aired.from&&
            isDateMatch(aired.from,airDate)
          ){
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
      }catch(_){}
    }

    if(malIds.length===1&&seasonNum===1){
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

    console.log(
      `[AniZone] AniBridge miss for `+
      `${tmdbId}:S${season}E${episode}; `+
      `trying season title/AniList resolver`
    );

    const web=yield resolveWebSeason(
      imdbId,
      tmdbId,
      season,
      episode
    );

    if(web)return web;

    if(!imdbId){
      console.log(
        `[AniZone] AniBridge and web resolver unavailable for `+
        `${tmdbId}:S${season}E${episode}; `+
        `legacy fallback skipped because IMDb ID is unavailable`
      );
      return null;
    }

    console.log(
      `[AniZone] AniBridge and web resolver unavailable for `+
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
   TMDB
   ========================================================= */

function getTmdbInfo(tmdbId,season,episode){
  return __async(this,null,function*(){
    try{
      const url=
        `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}`+
        `?api_key=${TMDB_API_KEY}`;
      const res=yield fetchWithTimeout(url,{},5000);
      if(!res.ok)return null;
      return yield res.json();
    }catch(_){
      return null;
    }
  });
}

function normalize(value){
  return String(value||"")
    .toLowerCase()
    .replace(/&/g,"and")
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function parseCards(html){
  const $=import_cheerio_without_node_native.load(html);
  const cards=[];

  $("a[href]").each((_,el)=>{
    const href=$(el).attr("href")||"";
    const text=$(el).text().replace(/\s+/g," ").trim();
    if(!href||!text)return;
    if(!/\/anime\//i.test(href))return;

    const absolute=
      href.startsWith("http")?
      href:
      `${MAIN_URL}${href.startsWith("/")?"":"/"}${href}`;

    cards.push({
      href:absolute,
      title:text
    });
  });

  return cards;
}

function searchCards(query){
  return __async(this,null,function*(){
    const key=normalize(query);
    const cached=cacheGet(SEARCH_CACHE,key,30*60*1000);
    if(cached)return cached;

    const urls=[
      `/anime?search=${encodeURIComponent(query)}&sort=title-asc`,
      `/anime?search=${encodeURIComponent(query)}`
    ];

    for(const url of urls){
      const html=yield fetchText(url);
      if(!html)continue;
      const cards=parseCards(html);
      if(cards.length){
        cacheSet(SEARCH_CACHE,key,cards);
        return cards;
      }
    }

    return[];
  });
}

function getSeasonRegexes(season){
  const n=String(season);
  return[
    new RegExp(`(?:^|\\s)season\\s*${n}(?:\\s|$)`,`i`),
    new RegExp(`(?:^|\\s)s${n}(?:\\s|$)`,`i`),
    new RegExp(`(?:^|\\s)${n}(?:nd|rd|th|st)\\s+season(?:\\s|$)`,`i`)
  ];
}

function matchCard(card,titles,season){
  const cardTitle=normalize(card.title);
  if(!cardTitle)return false;

  const titleList=titles
    .filter(Boolean)
    .map(normalize)
    .filter(Boolean);

  let titleMatch=false;

  for(const title of titleList){
    if(cardTitle===title||cardTitle.includes(title)||title.includes(cardTitle)){
      titleMatch=true;
      break;
    }
  }

  if(!titleMatch)return false;

  if(season>1){
    const regexes=getSeasonRegexes(season);
    if(regexes.some(r=>r.test(card.title)))return true;
  }

  return season===1;
}

function searchAnimeSlug(titles,season){
  return __async(this,null,function*(){
    const key=`${titles.join("|")}:s${season}`;
    const cached=cacheGet(SLUG_CACHE,key,6*60*60*1000);
    if(cached)return cached;

    const seen=new Set;

    for(const title of titles.filter(Boolean)){
      const cards=yield searchCards(title);

      for(const card of cards){
        if(seen.has(card.href))continue;
        seen.add(card.href);

        if(matchCard(card,titles,season)){
          cacheSet(SLUG_CACHE,key,card.href);
          return card.href;
        }
      }
    }

    return null;
  });
}

function parseVidstackFromHtml(html){
  const streams=[];
  const subtitles=[];

  const patterns=[
    /<media-provider[^>]*src=["']([^"']+)["'][^>]*>/gi,
    /<source[^>]*src=["']([^"']+)["'][^>]*>/gi,
    /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi
  ];

  for(const pattern of patterns){
    let m;
    while((m=pattern.exec(html))){
      const url=m[1];
      if(url&&!streams.includes(url))
        streams.push(url);
    }
  }

  const trackPattern=/<track[^>]*(?:src|srcLang)=["']([^"']+)["'][^>]*>/gi;
  let t;
  while((t=trackPattern.exec(html))){
    if(t[1]&&!subtitles.includes(t[1]))
      subtitles.push(t[1]);
  }

  return{streams,subtitles};
}

function parseAudioFormat(value){
  const text=String(value||"").toLowerCase();
  if(/dub|english/.test(text))return"Dub";
  if(/sub|japanese/.test(text))return"Sub";
  return"";
}

function fetchEpisodePage(_0){
  return __async(this,arguments,function* (url,options={}){
    const result=yield fetchWithCookies(url,options);
    return result;
  });
}

function getStreamsFromEpisodePage(_0){
  return __async(this,arguments,function* (url,season,episode){
    const page=yield fetchEpisodePage(url);
    if(!page.ok||!page.text)return[];

    const html=page.text;
    const result=parseVidstackFromHtml(html);

    const streams=[];

    for(const stream of result.streams){
      streams.push({
        name:"AniZone",
        title:`S${season}E${episode}`,
        url:stream,
        type:"m3u8",
        behaviorHints:{
          bingeGroup:"anizone"
        }
      });
    }

    const $=import_cheerio_without_node_native.load(html);

    const buttons=[];
    $("button[wire\\:click]").each((_,el)=>{
      const click=$(el).attr("wire:click")||"";
      if(/setVideo/i.test(click))
        buttons.push(click);
    });

    if(buttons.length){
      for(const button of buttons){
        const match=button.match(/setVideo\((.*?)\)/i);
        if(!match)continue;

        try{
          const raw=match[1];
          const data=JSON.parse(`[${raw}]`);
          const video=data[0];

          if(video&&typeof video==="string"&&/^https?:\/\//.test(video)){
            if(!streams.some(s=>s.url===video)){
              streams.push({
                name:"AniZone",
                title:`S${season}E${episode}`,
                url:video,
                type:"m3u8",
                behaviorHints:{
                  bingeGroup:"anizone"
                }
              });
            }
          }
        }catch(_){}
      }
    }

    return streams;
  });
}

function getStreams(_0){
  return __async(this,arguments,function*(){
    const args=arguments[1]||{};
    const tmdbId=
      args.tmdbId||
      args.tmdb_id||
      args.id||
      "";

    const season=
      parseInt(
        args.season||
        args.seasonNumber||
        args.season_number||
        1,
        10
      );

    const episode=
      parseInt(
        args.episode||
        args.episodeNumber||
        args.episode_number||
        1,
        10
      );

    console.log(
      `[AniZone] Querying streams for TMDB: ${tmdbId} `+
      `S${season}E${episode}`
    );

    if(!tmdbId)return[];

    const imdbId=yield getImdbId(tmdbId,"tv");

    const mapping=yield resolveMapping(
      imdbId,
      season,
      episode,
      tmdbId
    );

    if(!mapping){
      console.log(
        `[AniZone] No mapping found for `+
        `TMDB=${tmdbId} S${season}E${episode}`
      );
      return[];
    }

    const titles=[
      mapping.anilist_season_title,
      mapping.anime_title,
      ...(Array.isArray(mapping.titles)?mapping.titles:[])
    ].filter(Boolean);

    const uniqueTitles=[
      ...new Set(titles)
    ];

    console.log(
      `[AniZone] Resolved titles: `+
      uniqueTitles.join(" | ")
    );

    const slug=yield searchAnimeSlug(
      uniqueTitles,
      season
    );

    if(!slug){
      console.log(
        `[AniZone] AniZone slug not found for `+
        `TMDB=${tmdbId} S${season} `+
        `titles=${uniqueTitles.join(" | ")}`
      );
      return[];
    }

    const mappedEpisode=
      parseInt(
        mapping.mal_episode||
        mapping.target_episode||
        episode,
        10
      );

    const episodeUrl=
      `${slug.replace(/\/$/,"")}/episode/${mappedEpisode}`;

    console.log(
      `[AniZone] Fetching episode `+
      `AniList=${mapping.anilist_id||"none"} `+
      `"${mapping.anilist_season_title||mapping.anime_title}" `+
      `mapped E${mappedEpisode} -> ${episodeUrl}`
    );

    let streams=yield getStreamsFromEpisodePage(
      episodeUrl,
      season,
      mappedEpisode
    );

    if(!streams.length&&uniqueTitles.length>1){
      for(const title of uniqueTitles.slice(1)){
        const alternateSlug=yield searchAnimeSlug(
          [title],
          season
        );

        if(!alternateSlug||alternateSlug===slug)continue;

        const alternateUrl=
          `${alternateSlug.replace(/\/$/,"")}/episode/${mappedEpisode}`;

        streams=yield getStreamsFromEpisodePage(
          alternateUrl,
          season,
          mappedEpisode
        );

        if(streams.length)break;
      }
    }

    console.log(
      `[AniZone] Streams found: ${streams.length}`
    );

    return streams;
  });
}

module.exports={
  getStreams
};
