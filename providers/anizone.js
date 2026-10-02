/**
 * anizone - Built from src/anizone/
 * Optimized for parallel mapping/server resolution
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj,key,value) => key in obj ? __defProp(obj,key,{enumerable:true,configurable:true,writable:true,value}) : obj[key] = value;
var __spreadValues = (a,b) => {
  for(var prop in b || (b = {}))
    if(__hasOwnProp.call(b,prop))
      __defNormalProp(a,prop,b[prop]);
  if(__getOwnPropSymbols)
    for(var prop of __getOwnPropSymbols(b))
      if(__propIsEnum.call(b,prop))
        __defNormalProp(a,prop,b[prop]);
  return a;
};
var __spreadProps = (a,b) => __defProps(a,__getOwnPropDescs(b));
var __copyProps = (to,from,except,desc) => {
  if(from && typeof from === "object" || typeof from === "function")
    for(let key of __getOwnPropNames(from))
      if(!__hasOwnProp.call(to,key) && key !== except)
        __defProp(to,key,{get:()=>from[key],enumerable:!(desc=__getOwnPropDesc(from,key)) || desc.enumerable});
  return to;
};
var __toESM = (mod,isNodeMode,target) => (target=mod != null ? __create(__getProtoOf(mod)) : {},__copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target,"default",{value:mod,enumerable:true}) : target,
  mod
));
var __async = (__this,__arguments,generator) => new Promise((resolve,reject) => {
  var fulfilled = value => {
    try { step(generator.next(value)); } catch(e) { reject(e); }
  };
  var rejected = value => {
    try { step(generator.throw(value)); } catch(e) { reject(e); }
  };
  var step = x => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled,rejected);
  step((generator=generator.apply(__this,__arguments)).next());
});

var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));

var MAIN_URL = "https://anizone.to";
var HEADERS = {
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Referer":"https://anizone.to/"
};
var TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";

var HEX_ESCAPE = /\\x([0-9a-fA-F]{2})/g;
var INVALID_BACKSLASH = /\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g;

function sanitizeJson(raw) {
  if(!raw) return "";
  return raw.replace(/\\u0022/g,'"').replace(/\\u0026/g,"&").replace(/\\'/g,"'").replace(/\\\//g,"/").replace(/\\\\/g,"\\").replace(/\\&/g,"&").replace(/\\'/g,"'").replace(/\\0/g,"\\u0000").replace(HEX_ESCAPE,(_,hex)=>"\\u00"+hex).replace(INVALID_BACKSLASH,"");
}

function parseXDataJson(rawArg) {
  return JSON.parse(sanitizeJson(rawArg));
}

function fetchWithTimeout(_0) {
  return __async(this,arguments,function* (url,options={},timeoutMs=8e3) {
    var mergedHeaders = __spreadValues({
      "User-Agent":HEADERS["User-Agent"],
      "Referer":HEADERS["Referer"]
    },options.headers || {});
    var fetchOptions = __spreadProps(__spreadValues({
      skipSizeCheck:true
    },options),{headers:mergedHeaders});
    if(typeof setTimeout !== "function") return fetch(url,fetchOptions);
    let timer = null;
    var timeoutPromise = new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error("Timeout")),timeoutMs);
    });
    try {
      var res = yield Promise.race([fetch(url,fetchOptions),timeoutPromise]);
      clearTimeout(timer);
      return res;
    } catch(e) {
      clearTimeout(timer);
      throw e;
    }
  });
}

function fetchText(_0) {
  return __async(this,arguments,function* (url,options={}) {
    var finalUrl = url.startsWith("http") ? url : `${MAIN_URL}${url}`;
    try {
      var response = yield fetchWithTimeout(finalUrl,options,1e4);
      if(!response.ok) return "";
      return yield response.text();
    } catch(e) {
      return "";
    }
  });
}

function fetchWithCookies(_0) {
  return __async(this,arguments,function* (url,options={}) {
    var _a,_b;
    var finalUrl = url.startsWith("http") ? url : `${MAIN_URL}${url}`;
    try {
      var response = yield fetchWithTimeout(finalUrl,options,1e4);
      if(!response.ok) return {text:"",cookies:"",ok:false};
      var text = yield response.text();
      let cookies = "";
      try {
        if(typeof ((_a=response.headers)==null?void 0:_a.getSetCookie) === "function")
          cookies=response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
        else if((_b=response.headers)==null?void 0:_b.get)
          cookies=response.headers.get("set-cookie") || "";
      } catch(_) {}
      return {text,cookies,ok:true};
    } catch(e) {
      return {text:"",cookies:"",ok:false};
    }
  });
}

function getImdbId(tmdbId,mediaType) {
  return __async(this,null,function* () {
    try {
      var url=`https://api.themoviedb.org/3/${mediaType==="tv"?"tv":"movie"}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
      var res=yield fetchWithTimeout(url,{},5e3);
      var data=yield res.json();
      return data.imdb_id || null;
    } catch(_) {
      return null;
    }
  });
}

function isDateMatch(d1,d2) {
  if(!d1 || !d2) return false;
  var s1=d1.split("T")[0],s2=d2.split("T")[0];
  var date1=new Date(s1+"T00:00:00Z"),date2=new Date(s2+"T00:00:00Z");
  var diff=Math.abs(date1.getTime()-date2.getTime());
  return Math.ceil(diff/(1e3*60*60*24))<=2;
}

function resolveMapping(imdbId,season,episode,tmdbId) {
  return __async(this,null,function* () {
    var _a,_b,_c,_d;
    var seasonNum=parseInt(season,10);
    var episodeNum=parseInt(episode,10);
    var mapId=`${imdbId}:s${season}:e${episode}`;
    var metaData=null;

    var metaUrls=[
      `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`,
      `https://cinemeta-live.strem.io/meta/series/${imdbId}.json`
    ];

    var metaResults=yield Promise.all(metaUrls.map(url=>__async(this,null,function* () {
      try {
        var r=yield fetchWithTimeout(url,{},5e3);
        if(!r.ok) return null;
        var j=JSON.parse(yield r.text());
        return j&&j.meta&&j.meta.videos ? j.meta : null;
      } catch(_) {
        return null;
      }
    })));

    metaData=metaResults.find(Boolean) || null;

    if((!metaData || !metaData.videos) && tmdbId) {
      try {
        var tmdbEpUrl=`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}?api_key=${TMDB_API_KEY}`;
        var tmdbRes=yield fetchWithTimeout(tmdbEpUrl,{},5e3);
        if(tmdbRes.ok) {
          var epData=JSON.parse(yield tmdbRes.text());
          if(epData&&epData.air_date) {
            var tvUrl=`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`;
            var tvRes=yield fetchWithTimeout(tvUrl,{},5e3);
            var tvData=tvRes.ok ? JSON.parse(yield tvRes.text()) : {};
            metaData={
              name:tvData.name || tvData.original_name,
              moviedb_id:tmdbId,
              videos:[{
                season:seasonNum,
                episode:episodeNum,
                released:epData.air_date
              }]
            };
          }
        }
      } catch(_) {}
    }

    if(!metaData || !metaData.videos) return null;

    var video=metaData.videos.find(v=>v.season===seasonNum && v.episode===episodeNum);
    if(!(video&&video.released)) return null;

    var airDate=video.released.split("T")[0];
    var showTitle=metaData.name;

    var dayIndex=metaData.videos.filter(v=>{
      if(!v.released) return false;
      return v.released.split("T")[0]===airDate &&
        (v.season<seasonNum || v.season===seasonNum && v.episode<episodeNum);
    }).length;

    var tId=tmdbId || metaData.moviedb_id || metaData.themoviedb_id;
    var tvdbId=metaData.tvdb_id;

    var armUrls=[
      `https://arm.haglund.dev/api/v2/imdb?id=${imdbId}`,
      tId ? `https://arm.haglund.dev/api/v2/themoviedb?id=${tId}` : null,
      tvdbId ? `https://arm.haglund.dev/api/v2/thetvdb?id=${tvdbId}` : null
    ].filter(Boolean);

    var armResults=yield Promise.all(armUrls.map(url=>__async(this,null,function* () {
      try {
        var res=yield fetchWithTimeout(url,{},5e3);
        if(!res.ok) return [];
        var data=JSON.parse(yield res.text());
        return Array.isArray(data) ? data : [];
      } catch(_) {
        return [];
      }
    })));

    var malIds=[];
    for(var arr of armResults)
      for(var e of arr)
        if(e&&e.myanimelist) malIds.push(e.myanimelist);

    try {
      var aniIdUrl=tId
        ? `https://api.ani.zip/mappings?themoviedb_id=${tId}`
        : `https://api.ani.zip/mappings?imdb_id=${imdbId}`;
      var aniRes=yield fetchWithTimeout(aniIdUrl,{},5e3);
      if(aniRes.ok) {
        var aniData=JSON.parse(yield aniRes.text());
        if((_a=aniData==null?void 0:aniData.mappings)==null?void 0:_a.mal_id)
          malIds.push(aniData.mappings.mal_id);
      }
    } catch(_) {}

    malIds=[...new Set(malIds)].filter(Boolean).sort((a,b)=>b-a);
    if(!malIds.length) return null;

    // Query all candidate mappings concurrently.
    var mappingResults=yield Promise.all(malIds.map(malId=>__async(this,null,function* () {
      var aniData=null;
      try {
        var aniRes=yield fetchWithTimeout(`https://api.ani.zip/mappings?mal_id=${malId}`,{},5e3);
        if(aniRes.ok) aniData=JSON.parse(yield aniRes.text());
      } catch(_) {}

      if(aniData&&aniData.episodes) {
        var aniEpisodes=Object.values(aniData.episodes).map(ep=>({
          mal_episode_number:parseInt(ep.episode,10),
          air_date:ep.airDateUtc || ep.airDate || ep.airdate
        })).filter(ep=>!isNaN(ep.mal_episode_number));

        var aniDateMatches=aniEpisodes.filter(ep=>isDateMatch(ep.air_date,airDate)).sort((a,b)=>a.mal_episode_number-b.mal_episode_number);

        if(aniDateMatches[dayIndex]) {
          var match=aniDateMatches[dayIndex];
          return {
            id:mapId,
            imdb_id:imdbId,
            season:seasonNum,
            episode:episodeNum,
            mal_id:malId,
            mal_episode:match.mal_episode_number,
            anime_title:showTitle,
            titles:aniData.titles ? Object.values(aniData.titles).filter(Boolean) : [],
            air_date:airDate
          };
        }
      }

      // Only use Jikan as fallback when Ani.zip did not produce a match.
      try {
        var jRes=yield fetchWithTimeout(`https://api.jikan.moe/v4/anime/${malId}`,{},5e3);
        if(jRes.ok) {
          var jData=JSON.parse(yield jRes.text());
          var aired=(_d=(_c=(_b=jData==null?void 0:jData.data)==null?void 0:_c.aired)==null?void 0:_d.from);
          if(aired&&isDateMatch(aired,airDate)) {
            return {
              id:mapId,
              imdb_id:imdbId,
              season:seasonNum,
              episode:episodeNum,
              mal_id:malId,
              mal_episode:dayIndex+1,
              anime_title:showTitle,
              titles:[jData.data.title,jData.data.title_english,jData.data.title_japanese].filter(Boolean),
              air_date:airDate
            };
          }
        }
      } catch(_) {}

      return null;
    })));

    var finalResult=mappingResults.find(Boolean) || null;

    if(!finalResult&&malIds.length===1&&seasonNum===1) {
      finalResult={
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

    return finalResult;
  });
}

function getMalTitle(malId) {
  return __async(this,null,function* () {
    if(!malId) return null;
    try {
      var res=yield fetchWithTimeout(`https://api.jikan.moe/v4/anime/${malId}`,{},5e3);
      if(res.ok) {
        var data=yield res.json();
        return data.data&&data.data.title || data.data&&data.data.title_english || null;
      }
    } catch(_) {}
    return null;
  });
}

function getTmdbInfo(tmdbId,mediaType,season=1) {
  return __async(this,null,function* () {
    try {
      var url=`https://api.themoviedb.org/3/${mediaType==="tv"?"tv":"movie"}/${tmdbId}?api_key=${TMDB_API_KEY}`;
      var res=yield fetchWithTimeout(url,{},6e3);
      if(!res.ok) return null;
      var data=yield res.json();
      var info={
        title:data.name || data.title || data.original_name || data.original_title || "",
        originalTitle:data.original_name || data.original_title || "",
        seasonName:""
      };
      if(mediaType==="tv"&&season) {
        try {
          var sUrl=`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`;
          var sRes=yield fetchWithTimeout(sUrl,{},6e3);
          if(sRes.ok) {
            var sData=yield sRes.json();
            info.seasonName=sData.name || "";
          }
        } catch(e) {}
      }
      return info;
    } catch(e) {
      return null;
    }
  });
}

function normalize(str) {
  if(!str) return "";
  return str.toLowerCase().replace(/[^a-z0-9]/g,"").trim();
}

function parseCards(html,$) {
  var cards=[];
  var itemsMatch=html.match(/items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
  if(itemsMatch) {
    try {
      var parsed=parseXDataJson(itemsMatch[1]);
      if(Array.isArray(parsed))
        for(var item of parsed) {
          if(!item||!item.slug) continue;
          var titles=new Set();
          if(item.main_title) titles.add(item.main_title);
          if(item.title_list&&typeof item.title_list==="object")
            Object.values(item.title_list).forEach(t=>{if(t) titles.add(t);});
          cards.push({
            slug:item.slug,
            url:item.url || `/anime/${item.slug}`,
            titles:Array.from(titles)
          });
        }
    } catch(e) {}
  }

  if(cards.length===0) {
    $('[x-data*="anmTitles"]').each((i,el)=>{
      var href=$(el).find('a[href*="/anime/"]').first().attr("href");
      if(!href) return;
      var parts=href.split("/");
      var slug=parts[parts.length-1] || parts[parts.length-2];
      var titles=new Set();
      var xData=$(el).attr("x-data") || "";
      var jsonMatch=xData.match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/);
      if(jsonMatch) {
        try {
          var parsed=parseXDataJson(jsonMatch[1]);
          Object.values(parsed).forEach(t=>{if(t) titles.add(t);});
        } catch(e) {}
      }
      cards.push({slug,titles:Array.from(titles)});
    });
  }

  return cards;
}

function getSeasonRegexes(season) {
  if(season===1) {
    return {
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

  var patterns=[];
  if(season===2)
    patterns.push(/season\s*2/i,/saison\s*2/i,/2nd\s*season/i,/[\s\-]ii\b/i,/\b2\b/);
  else if(season===3)
    patterns.push(/season\s*3/i,/saison\s*3/i,/3rd\s*season/i,/[\s\-]iii\b/i,/\b3\b/);
  else if(season===4)
    patterns.push(/season\s*4/i,/saison\s*4/i,/4th\s*season/i,/[\s\-]iv\b/i,/\b4\b/,/final\s*season/i);
  else
    patterns.push(new RegExp(`(?:season|saison)\\s*${season}`,"i"),new RegExp(`\\b${season}\\b`));

  return {must:patterns};
}

function matchCard(cards,targetTitles,baseTitle,season=1,seasonName="") {
  var normalizedTargets=targetTitles.map(normalize).filter(Boolean);
  var normalizedBase=normalize(baseTitle);
  var normalizedSeasonName=normalize(seasonName);

  if(normalizedSeasonName&&normalizedSeasonName!=="season"+season)
    for(var card of cards)
      for(var title of card.titles)
        if(normalize(title).includes(normalizedSeasonName))
          return card.slug;

  for(var target of normalizedTargets)
    for(var card of cards)
      for(var title of card.titles)
        if(normalize(title)===target)
          return card.slug;

  var seasonRules=getSeasonRegexes(season);

  for(var card of cards) {
    var matchesBase=false;
    for(var title of card.titles) {
      var norm=normalize(title);
      if(norm.includes(normalizedBase)||normalizedBase.includes(norm)) {
        matchesBase=true;
        break;
      }
    }
    if(!matchesBase) continue;

    var seasonMatches=false;

    if(season===1) {
      var hasOtherSeason=false;
      for(var title of card.titles)
        if(seasonRules.mustNot.some(regex=>regex.test(title))) {
          hasOtherSeason=true;
          break;
        }
      if(!hasOtherSeason) seasonMatches=true;
    } else {
      for(var title of card.titles)
        if(seasonRules.must.some(regex=>regex.test(title))) {
          seasonMatches=true;
          break;
        }
    }

    if(seasonMatches) return card.slug;
  }

  return cards[0] ? cards[0].slug : null;
}

function matchMovieCard(cards,targetTitles) {
  var normalizedTargets=targetTitles.map(normalize).filter(Boolean);

  for(var card of cards)
    for(var title of card.titles) {
      var norm=normalize(title);
      if(normalizedTargets.some(t=>t===norm))
        return card.slug;
    }

  for(var card of cards)
    for(var title of card.titles) {
      var norm=normalize(title);
      if(normalizedTargets.some(t=>norm.includes(t)||t.includes(norm)))
        return card.slug;
    }

  return cards[0] ? cards[0].slug : null;
}

function parseVidstackFromHtml(html,$) {
  var vidMatch=html.match(/vidstackPlayer\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/);

  if(vidMatch) {
    try {
      var data=parseXDataJson(vidMatch[1]);
      var masterUrl2=data.src ? data.src.replace(/\\/g,"") : null;
      var subtitles2=(data.subtitles||[]).map(s=>({
        url:s.file ? s.file.replace(/\\/g,"") : "",
        name:s.title || s.language || "English",
        language:s.language || "en"
      })).filter(s=>s.url);

      if(masterUrl2)
        return {masterUrl:masterUrl2,subtitles:subtitles2};
    } catch(e) {}
  }

  var masterUrl=$("media-player").attr("src");

  if(!masterUrl) {
    var urlMatch=html.match(/https:\/\/[^"']+\/master\.m3u8/);
    if(urlMatch) masterUrl=urlMatch[0];
  }

  var subtitles=[];

  $("track").each((i,el)=>{
    var src=$(el).attr("src");
    var kind=$(el).attr("kind");

    if(src&&(kind==="subtitles"||kind==="captions"||src.endsWith(".ass")||src.endsWith(".vtt")))
      subtitles.push({
        url:src,
        name:$(el).attr("label") || "English",
        language:$(el).attr("srclang") || "en"
      });
  });

  return {masterUrl,subtitles};
}

function parseAudioFormat(btnText) {
  var lower=btnText.toLowerCase();
  var hasJap=lower.includes("japanese")||lower.includes("jpn")||lower.includes(" ja ");
  var hasEng=lower.includes("english")||lower.includes("eng")||lower.includes(" en ");

  if(hasEng&&hasJap) return "Dual Audio";
  if(hasEng) return "Dub";
  if(hasJap) return "Sub";
  if(lower.includes("multi")) return "Multi-Audio";

  return "Sub";
}

function searchCards(query) {
  return __async(this,null,function* () {
    if(!query) return [];

    var searchUrl=`/anime?search=${encodeURIComponent(query)}&sort=title-asc`;
    var searchHtml=yield fetchText(searchUrl);

    if(!searchHtml) return [];

    var $search=import_cheerio_without_node_native.default.load(searchHtml);
    return parseCards(searchHtml,$search);
  });
}

function onSettings() {
  return [
    {type:"header",label:"Preferences"},
    {type:"toggle",key:"enableDub",label:"Enable Dub",defaultValue:true}
  ];
}

function isDubEnabled() {
  var settings=typeof globalThis!=="undefined"&&globalThis.SCRAPER_SETTINGS ? globalThis.SCRAPER_SETTINGS : {};
  return settings.enableDub!==false;
}

function isDubFormat(format) {
  return format==="Dub"||format==="Dual Audio";
}

function getStreams(tmdbId,mediaType="tv",season=1,episode=1) {
  return __async(this,null,function* () {
    var _a,_b,_c;

    try {
      console.log(`[AniZone] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}, S${season}E${episode}`);

      var animeTitle="";
      var altTitles=[];
      var mappedEp=episode;
      var seasonName="";
      var targetTitles=[];

      if(mediaType==="tv") {
        var imdbId=yield getImdbId(tmdbId,"tv");

        if(imdbId) {
          var mapping=yield resolveMapping(imdbId,season,episode,tmdbId);

          if(mapping) {
            mappedEp=mapping.mal_episode || episode;
            animeTitle=mapping.anime_title || "";

            if(mapping.titles&&Array.isArray(mapping.titles))
              targetTitles.push(...mapping.titles);

            // Don't make an extra Jikan request here.
            // resolveMapping already has the useful titles.
            if(mapping.titles&&mapping.titles.length&&!animeTitle)
              animeTitle=mapping.titles[0];

            console.log(`[AniZone] AnimeSync mapped: "${animeTitle}", mappedEp=${mappedEp}`);
          }
        }

        if(!animeTitle) {
          var tmdbInfo=yield getTmdbInfo(tmdbId,mediaType,season);

          if(tmdbInfo) {
            animeTitle=tmdbInfo.title;
            if(tmdbInfo.originalTitle) altTitles.push(tmdbInfo.originalTitle);
            seasonName=tmdbInfo.seasonName || "";
          }
        }
      } else {
        var movieInfo=yield getTmdbInfo(tmdbId,"movie");

        if(movieInfo) {
          animeTitle=movieInfo.title;
          if(movieInfo.originalTitle) altTitles.push(movieInfo.originalTitle);
        }

        mappedEp=1;
      }

      if(!animeTitle&&targetTitles.length===0) return [];

      if(!animeTitle&&targetTitles.length>0)
        animeTitle=targetTitles[0];

      var specificTargetTitles=season===1||mediaType==="movie"
        ? [...targetTitles,animeTitle,...altTitles]
        : [...targetTitles];

      var baseCleanQuery=animeTitle.split(":")[0]
        .replace(/season.*|\d+nd season|\d+rd season|\d+th season|saison.*/gi,"")
        .trim();

      var cards=yield searchCards(baseCleanQuery);

      if(cards.length===0&&animeTitle!==baseCleanQuery)
        cards=yield searchCards(animeTitle.split(":")[0].trim());

      if(cards.length===0) {
        for(var t of altTitles) {
          var altClean=t.split(":")[0].trim();
          cards=yield searchCards(altClean);
          if(cards.length>0) break;
        }
      }

      if(cards.length===0) return [];

      var animeSlug=mediaType==="tv"
        ? matchCard(cards,specificTargetTitles,baseCleanQuery,season,seasonName)
        : matchMovieCard(cards,specificTargetTitles);

      if(!animeSlug) {
        console.log(`[AniZone] No matching slug found for "${animeTitle}"`);
        return [];
      }

      console.log(`[AniZone] Selected slug: "${animeSlug}", mappedEp=${mappedEp}`);

      var episodeUrl=`/anime/${animeSlug}/${mappedEp}`;
      var epResponse=yield fetchWithCookies(episodeUrl);

      if(!epResponse.ok||!epResponse.text) {
        console.log(`[AniZone] Failed to load episode page: ${episodeUrl}`);
        return [];
      }

      var epHtml=epResponse.text;
      var $ep=import_cheerio_without_node_native.default.load(epHtml);
      var streams=[];
      var seenUrls=new Set();

      var defaultStream=parseVidstackFromHtml(epHtml,$ep);
      var serverButtons=$ep('button[wire\\:click*="setVideo"],[wire\\:click*="setVideo"]');

      console.log(`[AniZone] Server buttons found: ${serverButtons.length}`);

      var defaultFormat="Sub";
      var defaultServerName="AniZone";

      if(serverButtons.length>0) {
        var firstBtn=serverButtons.first();
        var btnText=firstBtn.text().replace(/\s+/g," ").trim();
        defaultFormat=parseAudioFormat(btnText);
        var nameMatch=btnText.match(/^([A-Za-z0-9_-]+)/);
        if(nameMatch) defaultServerName=nameMatch[1];
      }

      var addStream=(stream,serverName,format,source="default")=>{
        if(!stream||!stream.masterUrl) {
          console.log(`[AniZone] ${serverName} - ${format}: no stream URL`);
          return;
        }

        if(!isDubEnabled()&&isDubFormat(format)) {
          console.log(`[AniZone] ${serverName} - ${format}: skipped (Dub disabled)`);
          return;
        }

        if(seenUrls.has(stream.masterUrl)) {
          console.log(`[AniZone] ${serverName} - ${format}: duplicate skipped`);
          return;
        }

        seenUrls.add(stream.masterUrl);

        streams.push({
          name:"AniZone",
          title:`${animeTitle} - Episode ${mappedEp} [${serverName} - ${format}]`,
          url:stream.masterUrl,
          quality:"Multi",
          headers:HEADERS,
          subtitles:stream.subtitles||[]
        });

        console.log(`[AniZone] ${serverName} - ${format}: resolved (${source})`);
      };

      if(defaultStream.masterUrl)
        addStream(defaultStream,defaultServerName,defaultFormat,"initial");

      if(serverButtons.length>0) {
        var csrfToken=$ep("script[data-csrf]").attr("data-csrf");
        var snapshotEl=$ep("main > div[wire\\:snapshot], main > ul[wire\\:snapshot], [wire\\:snapshot]");
        var snapshot=snapshotEl.attr("wire:snapshot");

        if(!csrfToken||!snapshot||!epResponse.cookies) {
          console.log(`[AniZone] Livewire data unavailable; only initial stream can be used`);
        } else {
          // Resolve every server concurrently.
          var serverTasks=[];

          for(let i=0;i<serverButtons.length;i++) {
            var btn=serverButtons.eq(i);
            var clickAttr=btn.attr("wire:click") || "";
            var vMatch=clickAttr.match(/setVideo\((\d+)\)/);
            var btnText=btn.text().replace(/\s+/g," ").trim();
            var sFormat=parseAudioFormat(btnText);
            var nameMatch=btnText.match(/^([A-Za-z0-9_-]+)/);
            var sName=nameMatch ? nameMatch[1] : `Server ${i+1}`;

            console.log(`[AniZone] Server ${i+1}/${serverButtons.length}: ${sName} - ${sFormat}`);

            if(!vMatch) {
              console.log(`[AniZone] ${sName} - ${sFormat}: no setVideo ID`);
              continue;
            }

            if(!isDubEnabled()&&isDubFormat(sFormat)) {
              console.log(`[AniZone] ${sName} - ${sFormat}: skipped (Dub disabled)`);
              continue;
            }

            var videoId=parseInt(vMatch[1],10);

            serverTasks.push((async()=>{
              try {
                var payload={
                  _token:csrfToken,
                  components:[{
                    snapshot,
                    updates:{},
                    calls:[{path:"",method:"setVideo",params:[videoId]}]
                  }]
                };

                var postRes=await fetchWithTimeout(`${MAIN_URL}/livewire/update`,{
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
                },8e3);

                if(!postRes.ok) {
                  console.log(`[AniZone] ${sName} - ${sFormat}: Livewire HTTP ${postRes.status}`);
                  return;
                }

                var postData=await postRes.json();
                var liveHtml=postData&&postData.components&&postData.components[0]&&postData.components[0].effects&&postData.components[0].effects.html;

                if(!liveHtml) {
                  console.log(`[AniZone] ${sName} - ${sFormat}: no Livewire HTML`);
                  return;
                }

                var $live=import_cheerio_without_node_native.default.load(liveHtml);
                var extraStream=parseVidstackFromHtml(liveHtml,$live);

                addStream({
                  masterUrl:extraStream.masterUrl,
                  subtitles:extraStream.subtitles&&extraStream.subtitles.length>0
                    ? extraStream.subtitles
                    : defaultStream.subtitles
                },sName,sFormat,`server ${i+1}`);
              } catch(e) {
                console.log(`[AniZone] ${sName} - ${sFormat}: failed - ${e&&e.message||e}`);
              }
            })());
          }

          yield Promise.allSettled(serverTasks);
        }
      }

      console.log(`[AniZone] Total unique streams found: ${streams.length}`);
      return streams;
    } catch(error) {
      console.log(`[AniZone] Error: ${error&&error.message||error}`);
      return [];
    }
  });
}

module.exports={getStreams,onSettings};
