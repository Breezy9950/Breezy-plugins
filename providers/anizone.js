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
  var step=x=>x.done?resolve(x.value):Promise.resolve(x.value).then(fulfilled,rejected);
  step((generator=generator.apply(__this,__arguments)).next());
});

var import_cheerio_without_node_native=__toESM(require("cheerio-without-node-native"));

var MAIN_URL="https://anizone.to";
var HEADERS={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Referer":"https://anizone.to/"
};
var TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";

var HEX_ESCAPE=/\\x([0-9a-fA-F]{2})/g;
var INVALID_BACKSLASH=/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g;

var MAPPING_CACHE=new Map;
var SEARCH_CACHE=new Map;
var SLUG_CACHE=new Map;
var IMDB_CACHE=new Map;
var MAX_CACHE=300;

function cacheSet(cache,key,value){
  if(cache.size>=MAX_CACHE){
    var first=cache.keys().next().value;
    if(first!==void 0)cache.delete(first);
  }
  cache.set(key,value);
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
      if(!response.ok)return"";
      return yield response.text();
    }catch(e){return"";}
  });
}

function fetchWithCookies(_0){
  return __async(this,arguments,function*(url,options={}){
    var _a,_b;
    var finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
    try{
      var response=yield fetchWithTimeout(finalUrl,options,8e3);
      if(!response.ok)return{text:"",cookies:"",ok:false};
      var text=yield response.text();
      let cookies="";
      try{
        if(typeof((_a=response.headers)==null?void 0:_a.getSetCookie)==="function")cookies=response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
        else if((_b=response.headers)==null?void 0:_b.get)cookies=response.headers.get("set-cookie")||"";
      }catch(_){}
      return{text,cookies,ok:true};
    }catch(e){return{text:"",cookies:"",ok:false};}
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
      if(!res.ok)return null;
      var data=yield res.json();
      var id=data.imdb_id||null;
      if(id)cacheSet(IMDB_CACHE,key,id);
      return id;
    }catch(_){return null;}
  });
}

function isDateMatch(d1,d2){
  if(!d1||!d2)return false;
  var s1=d1.split("T")[0],s2=d2.split("T")[0];
  var date1=new Date(s1+"T00:00:00Z"),date2=new Date(s2+"T00:00:00Z");
  return Math.ceil(Math.abs(date1.getTime()-date2.getTime())/(1e3*60*60*24))<=2;
}

function resolveMapping(imdbId,season,episode,tmdbId){
  return __async(this,null,function*(){
    var cacheKey=`${imdbId}:s${season}:e${episode}`;
    if(MAPPING_CACHE.has(cacheKey)){
      console.log(`[AniZone] Mapping cache hit: ${cacheKey}`);
      return MAPPING_CACHE.get(cacheKey);
    }

    var seasonNum=parseInt(season,10);
    var episodeNum=parseInt(episode,10);
    var mapId=`${imdbId}:s${season}:e${episode}`;
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
        var epUrl=`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}?api_key=${TMDB_API_KEY}`;
        var epRes=yield fetchWithTimeout(epUrl,{},4e3);
        if(epRes.ok){
          var epData=yield epRes.json();
          if(epData&&epData.air_date){
            var tvUrl=`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
            var tvRes=yield fetchWithTimeout(tvUrl,{},4e3);
            var tvData=tvRes.ok?yield tvRes.json():{};
            metaData={
              name:tvData.name||tvData.original_name,
              moviedb_id:tmdbId,
              videos:[{season:seasonNum,episode:episodeNum,released:epData.air_date}]
            };
          }
        }
      }catch(_){}
    }

    if(!metaData||!metaData.videos)return null;

    var video=metaData.videos.find(v=>v.season===seasonNum&&v.episode===episodeNum);
    if(!video||!video.released)return null;

    var airDate=video.released.split("T")[0];
    var showTitle=metaData.name;
    var dayIndex=metaData.videos.filter(v=>{
      if(!v.released)return false;
      return v.released.split("T")[0]===airDate&&(v.season<seasonNum||v.season===seasonNum&&v.episode<episodeNum);
    }).length;

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
    if(!malIds.length)return null;

    var mappingResults=yield Promise.all(malIds.map(malId=>__async(this,null,function*(){
      try{
        var r=yield fetchWithTimeout(`https://api.ani.zip/mappings?mal_id=${malId}`,{},3e3);
        if(r.ok){
          var d=yield r.json();
          if(d&&d.episodes){
            var eps=Object.values(d.episodes).map(ep=>({
              mal_episode_number:parseInt(ep.episode,10),
              air_date:ep.airDateUtc||ep.airDate||ep.airdate
            })).filter(ep=>!isNaN(ep.mal_episode_number));

            var matches=eps.filter(ep=>isDateMatch(ep.air_date,airDate)).sort((a,b)=>a.mal_episode_number-b.mal_episode_number);

            if(matches[dayIndex]){
              var m=matches[dayIndex];
              return{
                id:mapId,
                imdb_id:imdbId,
                season:seasonNum,
                episode:episodeNum,
                mal_id:malId,
                mal_episode:m.mal_episode_number,
                anime_title:showTitle,
                titles:d.titles?Object.values(d.titles).filter(Boolean):[],
                air_date:airDate
              };
            }
          }
        }
      }catch(_){}

      try{
        var j=yield fetchWithTimeout(`https://api.jikan.moe/v4/anime/${malId}`,{},3e3);
        if(j.ok){
          var jd=yield j.json();
          var aired=jd&&jd.data&&jd.data.aired&&jd.data.aired.from;
          if(aired&&isDateMatch(aired,airDate)){
            return{
              id:mapId,
              imdb_id:imdbId,
              season:seasonNum,
              episode:episodeNum,
              mal_id:malId,
              mal_episode:dayIndex+1,
              anime_title:showTitle,
              titles:[jd.data.title,jd.data.title_english,jd.data.title_japanese].filter(Boolean),
              air_date:airDate
            };
          }
        }
      }catch(_){}

      return null;
    })));

    var result=mappingResults.find(Boolean)||null;

    if(!result&&malIds.length===1&&seasonNum===1){
      result={
        id:mapId,
        imdb_id:imdbId,
        season:seasonNum,
        episode:episodeNum,
        mal_id:malIds[0],
        mal_episode:episodeNum,
        anime_title:showTitle,
        titles:[],
        air_date:airDate
      };
    }

    if(result)cacheSet(MAPPING_CACHE,cacheKey,result);
    return result;
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
  return str.toLowerCase().replace(/[^a-z0-9]/g,"").trim();
}

function parseCards(html,$){
  var cards=[];
  var itemsMatch=html.match(/items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);

  if(itemsMatch){
    try{
      var parsed=parseXDataJson(itemsMatch[1]);
      if(Array.isArray(parsed))for(var item of parsed){
        if(!item||!item.slug)continue;
        var titles=new Set;
        if(item.main_title)titles.add(item.main_title);
        if(item.title_list&&typeof item.title_list==="object")Object.values(item.title_list).forEach(t=>{if(t)titles.add(t);});
        cards.push({slug:item.slug,url:item.url||`/anime/${item.slug}`,titles:Array.from(titles)});
      }
    }catch(_){}
  }

  if(!cards.length){
    $('[x-data*="anmTitles"]').each((i,el)=>{
      var href=$(el).find('a[href*="/anime/"]').first().attr("href");
      if(!href)return;
      var parts=href.split("/");
      var slug=parts[parts.length-1]||parts[parts.length-2];
      var titles=new Set;
      var xData=$(el).attr("x-data")||"";
      var jsonMatch=xData.match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
      if(jsonMatch){
        try{
          var p=parseXDataJson(jsonMatch[1]);
          Object.values(p).forEach(t=>{if(t)titles.add(t);});
        }catch(_){}
      }
      cards.push({slug,titles:Array.from(titles)});
    });
  }

  return cards;
}

function getSeasonRegexes(season){
  if(season===1)return{mustNot:[
    /season\s*[2-9]/i,/saison\s*[2-9]/i,/[\s\-][iI]{2,}/,
    /\s+[2-9]nd/i,/\s+[2-9]rd/i,/\s+[2-9]th/i,
    /\s+ii\b/i,/\s+iii\b/i,/\s+iv\b/i,/\s+v\b/i,
    /movie/i,/gekijouban/i,/the movie/i
  ]};
  var patterns=[];
  if(season===2)patterns.push(/season\s*2/i,/saison\s*2/i,/2nd\s*season/i,/[\s\-]ii\b/i,/\b2\b/);
  else if(season===3)patterns.push(/season\s*3/i,/saison\s*3/i,/3rd\s*season/i,/[\s\-]iii\b/i,/\b3\b/);
  else if(season===4)patterns.push(/season\s*4/i,/saison\s*4/i,/4th\s*season/i,/[\s\-]iv\b/i,/\b4\b/,/final\s*season/i);
  else patterns.push(new RegExp(`(?:season|saison)\\s*${season}`,"i"),new RegExp(`\\b${season}\\b`));
  return{must:patterns};
}

function matchCard(cards,targetTitles,baseTitle,season=1,seasonName=""){
  var targets=targetTitles.map(normalize).filter(Boolean);
  var base=normalize(baseTitle);
  var sn=normalize(seasonName);

  if(sn&&sn!=="season"+season)for(var c of cards)for(var t of c.titles)if(normalize(t).includes(sn))return c.slug;

  for(var target of targets)for(var c of cards)for(var t of c.titles)if(normalize(t)===target)return c.slug;

  var rules=getSeasonRegexes(season);

  for(var c of cards){
    var baseMatch=false;
    for(var t of c.titles){
      var n=normalize(t);
      if(n.includes(base)||base.includes(n)){baseMatch=true;break;}
    }
    if(!baseMatch)continue;

    var seasonMatch=false;

    if(season===1){
      var other=false;
      for(var t of c.titles)if(rules.mustNot.some(r=>r.test(t))){other=true;break;}
      if(!other)seasonMatch=true;
    }else{
      for(var t of c.titles)if(rules.must.some(r=>r.test(t))){seasonMatch=true;break;}
    }

    if(seasonMatch)return c.slug;
  }

  return cards[0]?cards[0].slug:null;
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

  var tracks=[];
  var seen=new Set;

  for(var i=0;i<data.subtitles.length;i++){
    var s=data.subtitles[i];
    if(!s||typeof s!=="object")continue;

    var url=cleanSubtitleUrl(s.file||s.url||s.src);
    if(!url||seen.has(url))continue;

    var lang=normalizeSubtitleLanguage(s.language||s.lang||s.locale);
    var format=String(s.format||"").toLowerCase();
    var title=String(s.title||s.name||s.label||"English").trim();

    if(format&&["vtt","webvtt","srt","ass","ssa"].indexOf(format)<0){
      if(!/\.(vtt|srt|ass|ssa)(?:$|\?)/i.test(url))continue;
    }

    seen.add(url);

    tracks.push({
      id:`anizone-${i}`,
      url:url,
      lang:lang,
      label:title||"English"
    });
  }

  var english=tracks.filter(t=>t.lang==="en");
  var defaults=data.subtitles.filter(s=>s&&s.default===true);
  var defaultEnglish=[];

  for(var d of defaults){
    var du=cleanSubtitleUrl(d.file||d.url||d.src);
    if(du){
      var found=tracks.find(t=>t.url===du&&t.lang==="en");
      if(found)defaultEnglish.push(found);
    }
  }

  if(defaultEnglish.length)return defaultEnglish;
  if(english.length)return english;
  return tracks.slice(0,1);
}

function parseVidstackFromHtml(html,$){
  var vidMatch=html.match(/vidstackPlayer\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/);

  if(vidMatch){
    try{
      var d=parseXDataJson(vidMatch[1]);
      var master=d.src?d.src.replace(/\\/g,""):null;
      var subs=parseSubtitleTracks(d);
      if(master)return{masterUrl:master,subtitles:subs};
    }catch(_){}
  }

  var masterUrl=$("media-player").attr("src");

  if(!masterUrl){
    var m=html.match(/https:\/\/[^"']+\/master\.m3u8/);
    if(m)masterUrl=m[0];
  }

  var subtitles=[];
  $("track").each((i,el)=>{
    var src=cleanSubtitleUrl($(el).attr("src"));
    var kind=$(el).attr("kind");
    if(src&&(kind==="subtitles"||kind==="captions"||/\.(ass|ssa|srt|vtt)(?:$|\?)/i.test(src))){
      var lang=normalizeSubtitleLanguage($(el).attr("srclang")||$(el).attr("lang")||"en");
      subtitles.push({
        id:`anizone-track-${i}`,
        url:src,
        lang:lang,
        label:$(el).attr("label")||"English"
      });
    }
  });

  var english=subtitles.filter(s=>s.lang==="en");

  return{
    masterUrl:masterUrl,
    subtitles:english.length?english:subtitles.slice(0,1)
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

function searchCards(query){
  return __async(this,null,function*(){
    if(!query)return[];
    var key=query.toLowerCase();

    if(SEARCH_CACHE.has(key)){
      console.log(`[AniZone] Search cache hit: "${query}"`);
      return SEARCH_CACHE.get(key);
    }

    var html=yield fetchText(`/anime?search=${encodeURIComponent(query)}&sort=title-asc`);
    if(!html)return[];

    var $=import_cheerio_without_node_native.default.load(html);
    var cards=parseCards(html,$);

    cacheSet(SEARCH_CACHE,key,cards);
    return cards;
  });
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

      if(mediaType==="tv"){
        var imdbId=yield getImdbId(tmdbId,"tv");

        if(imdbId){
          var mapping=yield resolveMapping(imdbId,season,episode,tmdbId);

          if(mapping){
            mappedEp=mapping.mal_episode||episode;
            animeTitle=mapping.anime_title||"";
            if(mapping.titles&&Array.isArray(mapping.titles))targetTitles.push(...mapping.titles);

            if(!animeTitle&&targetTitles.length)animeTitle=targetTitles[0];

            console.log(`[AniZone] AnimeSync mapped: "${animeTitle}", mappedEp=${mappedEp}`);
          }
        }

        if(!animeTitle){
          var tmdbInfo=yield getTmdbInfo(tmdbId,mediaType,season);
          if(tmdbInfo){
            animeTitle=tmdbInfo.title;
            if(tmdbInfo.originalTitle)altTitles.push(tmdbInfo.originalTitle);
            seasonName=tmdbInfo.seasonName||"";
          }
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
        ?[...targetTitles,animeTitle,...altTitles]
        :[...targetTitles];

      var baseQuery=animeTitle.split(":")[0]
        .replace(/season.*|\d+nd season|\d+rd season|\d+th season|saison.*/gi,"")
        .trim();

      var slugCacheKey=`${baseQuery}|${season}|${specificTitles.join("|")}`;
      var animeSlug=SLUG_CACHE.get(slugCacheKey);

      if(animeSlug){
        console.log(`[AniZone] Slug cache hit: "${animeSlug}"`);
      }else{
        var cards=yield searchCards(baseQuery);

        if(!cards.length&&animeTitle!==baseQuery)
          cards=yield searchCards(animeTitle.split(":")[0].trim());

        if(!cards.length){
          var altPromises=altTitles.map(t=>searchCards(t.split(":")[0].trim()));
          var altResults=yield Promise.all(altPromises);
          for(var result of altResults)if(result.length){cards=result;break;}
        }

        if(!cards.length)return[];

        animeSlug=mediaType==="tv"
          ?matchCard(cards,specificTitles,baseQuery,season,seasonName)
          :matchMovieCard(cards,specificTitles);

        if(animeSlug)cacheSet(SLUG_CACHE,slugCacheKey,animeSlug);
      }

      if(!animeSlug)return[];

      console.log(`[AniZone] Selected slug: "${animeSlug}", mappedEp=${mappedEp}`);

      var episodeUrl=`/anime/${animeSlug}/${mappedEp}`;
      var epResponse=yield fetchWithCookies(episodeUrl);

      if(!epResponse.ok||!epResponse.text){
        console.log(`[AniZone] Failed to load episode page: ${episodeUrl}`);
        return[];
      }

      var epHtml=epResponse.text;
      var $ep=import_cheerio_without_node_native.default.load(epHtml);
      var streams=[];
      var seen=new Set;

      var defaultStream=parseVidstackFromHtml(epHtml,$ep);
      var serverButtons=$ep('button[wire\\:click*="setVideo"],[wire\\:click*="setVideo"]');

      console.log(`[AniZone] Server buttons found: ${serverButtons.length}`);

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

      if(serverButtons.length>1&&epResponse.cookies){
        var csrfToken=$ep("script[data-csrf]").attr("data-csrf");
        var snapshotEl=$ep("main > div[wire\\:snapshot],main > ul[wire\\:snapshot],[wire\\:snapshot]");
        var snapshot=snapshotEl.attr("wire:snapshot");

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
                    calls:[{path:"",method:"setVideo",params:[videoId]}]
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
                    "Cookie":epResponse.cookies
                  },
                  body:JSON.stringify(payload)
                },5e3);

                if(!r.ok)return;

                var d=await r.json();
                var html=d&&d.components&&d.components[0]&&d.components[0].effects&&d.components[0].effects.html;
                if(!html)return;

                var $live=import_cheerio_without_node_native.default.load(html);
                var stream=parseVidstackFromHtml(html,$live);

                addStream({
                  masterUrl:stream.masterUrl,
                  subtitles:stream.subtitles&&stream.subtitles.length?stream.subtitles:defaultStream.subtitles
                },name,format);
              }catch(_){}
            })());
          }

          yield Promise.allSettled(tasks);
        }
      }

      console.log(`[AniZone] Total unique streams found: ${streams.length}`);
      return streams;
    }catch(error){
      console.log(`[AniZone] Error: ${error&&error.message||error}`);
      return[];
    }
  });
}

module.exports={getStreams,onSettings};
