const CryptoJS=require("crypto-js");

const REANIME_DOMAINS=["https://reanime.to","https://reanime.cz","https://reanime.wtf"];
const FLIXCLOUD_BASE="https://flixcloud.cc";
const TMDB_API_KEY="439c478a771f35c05022f9feabcca01c";
const ANIBRIDGE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const CINEMETA_URL="https://v3-cinemeta.strem.io/meta";
const ARM_BASE="https://arm.haglund.dev/api/v2";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS={"User-Agent":UA,"Accept":"application/json, text/plain, */*","Accept-Language":"en-US,en;q=0.9"};
const FLIX_HEADERS={"User-Agent":UA,"Accept":"*/*","Origin":FLIXCLOUD_BASE,"Referer":`${FLIXCLOUD_BASE}/`};

let activeBaseUrl=REANIME_DOMAINS[0],mappingCache=null;
const MAPPING_TTL=24*60*60*1000;

const log=(...a)=>console.log("[Reanime]",...a);
const err=(...a)=>console.error("[Reanime]",...a);

function absolutize(path,base=activeBaseUrl){
  if(!path)return"";
  if(/^https?:\/\//i.test(path))return path;
  return`${base}${path.startsWith("/")?"":"/"}${path}`;
}

async function fetchText(url,options={}){
  const absolute=/^https?:\/\//i.test(url);
  const urls=absolute?[url]:REANIME_DOMAINS.map(d=>absolutize(url,d));
  let lastError;

  for(const u of urls){
    try{
      const r=await fetch(u,{...options,headers:{...HEADERS,...(options.headers||{})}});
      log("HTTP",r.status,u);
      if(r.ok){
        if(!absolute){
          const m=u.match(/^(https?:\/\/[^/]+)/);
          if(m)activeBaseUrl=m[1];
        }
        return await r.text();
      }
      lastError=new Error(`HTTP ${r.status}`);
    }catch(e){
      lastError=e;
      log("HTTP error",u,e?.message);
    }
  }

  throw lastError||new Error(`Failed: ${url}`);
}

async function fetchJson(url,options={}){
  return JSON.parse(await fetchText(url,{
    ...options,
    headers:{"Accept":"application/json, text/plain, */*",...(options.headers||{})}
  }));
}

// =========================================================
// TMDB
// =========================================================

function TMDB_BASE(type){
  return`https://api.themoviedb.org/3/${type}`;
}

async function getTmdbInfo(tmdbId,mediaType){
  const type=mediaType==="movie"?"movie":"tv";
  log("TMDB lookup",tmdbId,type);

  try{
    const data=await fetchJson(
      `${TMDB_BASE(type)}/${encodeURIComponent(tmdbId)}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`
    );

    let imdbId=data?.external_ids?.imdb_id||data?.imdb_id||null;

    if(!imdbId){
      log("TMDB has no IMDb ID, trying ARM");
      try{
        const arm=await fetchJson(`${ARM_BASE}/themoviedb?id=${encodeURIComponent(tmdbId)}`);
        if(Array.isArray(arm)&&arm.length)imdbId=arm[0]?.imdb||null;
      }catch(e){
        log("ARM lookup failed",e?.message);
      }
    }

    log("TMDB result","IMDb:",imdbId);

    return{
      title:data?.name||data?.title||data?.original_name||data?.original_title||"Anime",
      year:(data?.first_air_date||data?.release_date||"").slice(0,4),
      imdbId
    };
  }catch(e){
    err("TMDB lookup failed",e?.message);
    return null;
  }
}

// =========================================================
// ANIBRIDGE
// =========================================================

function parseDescriptor(v){
  const m=String(v||"").match(/^([^:]+):([^:]+)(?::s(\d+))?$/);
  return m?{provider:m[1],id:m[2],season:m[3]===undefined?null:Number(m[3])}:null;
}

function parseRange(v){
  const m=String(v||"").trim().match(/^(\d+)(?:-(\d*))?$/);
  return m?{start:Number(m[1]),end:m[2]===undefined||m[2]===""?Infinity:Number(m[2])}:null;
}

function parseTargetRanges(v){
  let text=String(v||"").trim(),ratio=1;
  const m=text.match(/\|(-?\d+(?:\.\d+)?)$/);
  if(m){ratio=Number(m[1]);text=text.slice(0,m.index);}
  return{ratio,ranges:text.split(",").map(parseRange).filter(Boolean)};
}

function buildEpisodeMapping(sourceRange,targetRange){
  const source=parseRange(sourceRange),target=parseTargetRanges(targetRange);
  return!source||!target.ranges.length?null:{
    sourceStart:source.start,sourceEnd:source.end,
    ratio:target.ratio,targets:target.ranges
  };
}

function buildIndex(raw){
  const movies=Object.create(null),shows=Object.create(null);

  for(const[sourceDescriptor,targets]of Object.entries(raw||{})){
    const source=parseDescriptor(sourceDescriptor);
    if(!source||!targets||typeof targets!=="object")continue;

    if(source.provider==="imdb_movie"){
      for(const td of Object.keys(targets)){
        const target=parseDescriptor(td);
        if(target?.provider==="anilist"){
          movies[source.id]=String(target.id);
          break;
        }
      }
      continue;
    }

    if(source.provider!=="imdb_show"||source.season===null)continue;

    const entries=[];

    for(const[td,ranges]of Object.entries(targets)){
      const target=parseDescriptor(td);
      if(!target||target.provider!=="anilist")continue;

      const mappings=[];

      if(ranges&&typeof ranges==="object"){
        for(const[sr,tr]of Object.entries(ranges)){
          const mapping=buildEpisodeMapping(sr,tr);
          if(mapping)mappings.push(mapping);
        }
      }

      entries.push({anilistId:String(target.id),ranges:mappings});
    }

    if(entries.length)shows[`${source.id}|${source.season}`]=entries;
  }

  return{movies,shows};
}

function findTargetEpisode(mapping,episode){
  const ep=Number(episode);
  if(!Number.isFinite(ep)||ep<1)return null;
  if(!mapping.ranges.length)return ep;

  for(const range of mapping.ranges){
    if(ep<range.sourceStart)continue;
    if(Number.isFinite(range.sourceEnd)&&ep>range.sourceEnd)continue;

    const offset=ep-range.sourceStart;
    const targetOffset=range.ratio===1
      ?offset
      :range.ratio>0
        ?Math.floor(offset*range.ratio)
        :Math.floor(offset/Math.abs(range.ratio));

    let remaining=targetOffset;

    for(const target of range.targets){
      const length=Number.isFinite(target.end)?target.end-target.start+1:Infinity;
      if(remaining<length)return target.start+remaining;
      remaining-=length;
    }

    return null;
  }

  return null;
}

async function loadMapping(){
  if(mappingCache&&Date.now()-mappingCache.updatedAt<MAPPING_TTL){
    log("Using cached AniBridge mapping");
    return mappingCache.index;
  }

  log("Downloading AniBridge mapping");

  try{
    const r=await fetch(ANIBRIDGE_URL,{
      headers:{Accept:"application/json","User-Agent":"Reanime-Nuvio/1.0"}
    });

    log("AniBridge HTTP",r.status);

    if(!r.ok)throw new Error(`AniBridge HTTP ${r.status}`);

    const raw=await r.json();
    log("AniBridge JSON loaded");

    const index=buildIndex(raw);
    const movieCount=Object.keys(index.movies).length;
    const showCount=Object.keys(index.shows).length;

    log("AniBridge index",`movies=${movieCount}`,`shows=${showCount}`);

    if(!movieCount&&!showCount)
      throw new Error("AniBridge index empty");

    mappingCache={updatedAt:Date.now(),index};
    return index;
  }catch(e){
    err("AniBridge load failed",e?.message);
    return mappingCache?.index||null;
  }
}

async function resolveImdbToAnilist({imdbId,type,season=1,episode=1}){
  log("Mapping IMDb → AniList",imdbId,type,`S${season}E${episode}`);

  if(!imdbId||!/^tt\d+$/i.test(String(imdbId)))return null;

  const index=await loadMapping();
  if(!index)return null;

  const id=String(imdbId).trim();

  if(type==="movie"){
    const anilistId=index.movies?.[id];
    log("Movie AniList ID",anilistId||"NOT FOUND");
    return anilistId?{anilistId:String(anilistId),episode:1,source:"anibridge"}:null;
  }

  const s=Number(season),ep=Number(episode);
  if(!Number.isFinite(s)||!Number.isFinite(ep))return null;

  const candidates=index.shows?.[`${id}|${s}`];

  log("Show mapping candidates",candidates?.length||0);

  if(!Array.isArray(candidates))return null;

  for(const candidate of candidates){
    const targetEpisode=findTargetEpisode(candidate,ep);

    if(targetEpisode!==null){
      log("Mapped","AniList:",candidate.anilistId,"Episode:",targetEpisode);
      return{
        anilistId:String(candidate.anilistId),
        episode:targetEpisode,
        source:"anibridge"
      };
    }
  }

  log("Episode mapping not found");
  return null;
}

// =========================================================
// REANIME
// =========================================================

function slugify(v){
  return String(v||"")
    .toLowerCase()
    .replace(/['’]/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

async function getReanimeSlug(tmdbId,mediaType){
  log("Cinemeta slug lookup",tmdbId);

  try{
    const type=mediaType==="movie"?"movie":"tv";
    const data=await fetchJson(
      `${CINEMETA_URL}/${type}/tmdb:${encodeURIComponent(tmdbId)}.json`
    );

    const slug=data?.meta?.slug||slugify(data?.meta?.name||data?.meta?.title);
    log("Cinemeta slug",slug||"NOT FOUND");
    return slug;
  }catch(e){
    log("Cinemeta lookup failed",e?.message);
    return null;
  }
}

function filterServers(servers,language){
  return Array.isArray(servers)
    ?servers.filter(s=>s?.dataType?.toLowerCase()===language.toLowerCase())
    :[];
}

async function getFlixEmbeds(slug,episodeNumber,language,anilistId){
  const watchPath=`/watch/${slug||"anime"}?ep=${episodeNumber}`;

  log("Flix lookup",`AniList=${anilistId}`,`E=${episodeNumber}`,language);

  if(anilistId){
    try{
      const json=await fetchJson(`/api/flix/${anilistId}/${episodeNumber}`,{
        headers:{Referer:absolutize(watchPath)}
      });

      if(json?.success&&Array.isArray(json.servers)){
        const servers=filterServers(json.servers,language);

        log("Primary Flix servers",servers.length);

        if(servers.length)
          return{
            watchUrl:absolutize(watchPath),
            servers,
            embeds:servers.map(s=>s.dataLink).filter(Boolean)
          };
      }
    }catch(e){
      log("Primary Flix failed",e?.message);
    }
  }

  if(slug){
    try{
      log("Trying ReAnime slug API");

      const anime=await fetchJson(`/api/v1/anime/${slug}`);
      const alId=anime?.anilist_id;

      if(alId){
        log("Slug AniList ID",alId);

        const json=await fetchJson(`/api/flix/${alId}/${episodeNumber}`,{
          headers:{Referer:absolutize(watchPath)}
        });

        if(json?.success&&Array.isArray(json.servers)){
          const servers=filterServers(json.servers,language);
          log("Slug Flix servers",servers.length);

          if(servers.length)
            return{
              watchUrl:absolutize(watchPath),
              servers,
              embeds:servers.map(s=>s.dataLink).filter(Boolean)
            };
        }
      }
    }catch(e){
      log("Slug API failed",e?.message);
    }

    try{
      log("Trying ReAnime HTML fallback");

      const html=await fetchText(`/anime/${slug}?_ep=${episodeNumber}`);
      const m=html.match(/anilist_id:\s*(\d+)/);

      if(m){
        log("HTML AniList ID",m[1]);

        const json=await fetchJson(`/api/flix/${m[1]}/${episodeNumber}`,{
          headers:{Referer:absolutize(watchPath)}
        });

        if(json?.success&&Array.isArray(json.servers)){
          const servers=filterServers(json.servers,language);
          log("HTML Flix servers",servers.length);

          if(servers.length)
            return{
              watchUrl:absolutize(watchPath),
              servers,
              embeds:servers.map(s=>s.dataLink).filter(Boolean)
            };
        }
      }
    }catch(e){
      log("HTML fallback failed",e?.message);
    }
  }

  return{watchUrl:absolutize(watchPath),servers:[],embeds:[]};
}

// =========================================================
// FLIXCLOUD
// =========================================================

function sha256hex(v){
  return CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(String(v))).toString(CryptoJS.enc.Hex);
}

function fromBase64(v){
  return Uint8Array.from(atob(String(v)),c=>c.charCodeAt(0));
}

function uint8ToWordArray(bytes){
  const words=[];
  for(let i=0;i<bytes.length;i++)
    words[i>>>2]=(words[i>>>2]||0)|(bytes[i]<<(24-(i%4)*8));
  return CryptoJS.lib.WordArray.create(words,bytes.length);
}

function wordArrayToUint8(w){
  const out=new Uint8Array(w.sigBytes);
  for(let i=0;i<w.sigBytes;i++)
    out[i]=(w.words[i>>>2]>>>(24-(i%4)*8))&255;
  return out;
}

function generateFields(seed){
  let e=seed,l;

  for(let i=0;i<3;i++)e=sha256hex(e+i);
  l=e;
  for(let i=0;i<3;i++)l=sha256hex(l+i);

  return{
    keyField:"kf_"+e.substring(8,16),
    ivField:"ivf_"+e.substring(16,24),
    containerName:"cd_"+e.substring(24,32),
    arrayName:"ad_"+e.substring(32,40),
    objectName:"od_"+e.substring(40,48),
    tokenField:e.substring(48,64)+"_"+e.substring(56,64),
    keyFrag2Field:l.substring(0,16)+"_"+l.substring(16,24)
  };
}

async function runWasm(wasmB64,frag1,kf2,TBytes,seedInt){
  log("Starting FlixCloud WASM");

  const{instance}=await WebAssembly.instantiate(fromBase64(wasmB64));
  const{_s,_r,memory}=instance.exports;

  if(typeof _s!=="function"||typeof _r!=="function"||!memory)
    throw new Error("Invalid FlixCloud WASM exports");

  const heap=new Uint8Array(memory.buffer);
  const len=frag1.length,y=1000,v=y+len,T=y+2*len,out=y+3*len;

  heap.set(frag1,y);
  heap.set(kf2,v);
  heap.set(TBytes,T);

  _s(seedInt);
  _r(y,v,T,out,len);

  log("FlixCloud WASM complete");
  return heap.slice(out,out+len);
}

function extractSsrObject(html){
  const marker=html.match(/\{type:"data",data:(\{)/);
  if(!marker)throw new Error("SSR data block not found");

  const start=html.indexOf("{",marker.index+marker[0].length-1);
  let depth=0;

  for(let i=start;i<html.length;i++){
    if(html[i]==="{")depth++;
    else if(html[i]==="}"&&!--depth)return html.slice(start,i+1);
  }

  throw new Error("SSR brace matching failed");
}

function parseSsrData(html){
  return Function(`"use strict";return(${extractSsrObject(html)});`)();
}

async function resolveFlixCloud(embedUrl){
  log("Resolving FlixCloud",embedUrl);

  const match=String(embedUrl).match(/\/e\/([^?#\s]+)(?:\?v=(\d+))?/i);
  if(!match)throw new Error("Invalid FlixCloud embed URL");

  const accessId=match[1],version=Number(match[2])||2;

  const response=await fetch(
    `${FLIXCLOUD_BASE}/e/${accessId}?v=${version}`,
    {
      headers:{
        "User-Agent":UA,
        Accept:"*/*",
        Referer:"https://reanime.to/"
      }
    }
  );

  log("FlixCloud embed HTTP",response.status);

  if(!response.ok)
    throw new Error(`FlixCloud HTTP ${response.status}`);

  const data=parseSsrData(await response.text());
  const seed=data.obfuscation_seed;

  if(!seed)throw new Error("Missing obfuscation seed");

  const fields=generateFields(seed);
  const cryptoData=data.obfuscated_crypto_data;
  if(!cryptoData)throw new Error("Missing crypto data");

  const container=cryptoData[fields.containerName];
  const array=container?.[fields.arrayName];
  const object=array?.[0]?.[fields.objectName];

  if(!object)throw new Error("Missing crypto object");

  const frag1=fromBase64(object[fields.keyField]);
  const iv=fromBase64(object[fields.ivField]);
  const kf2=fromBase64(data[fields.keyFrag2Field]);
  const token=data[fields.tokenField];

  if(!token)throw new Error("Missing FlixCloud token");

  log("FlixCloud token obtained");

  const tokenResponse=await fetch(
    `${FLIXCLOUD_BASE}/api/m3u8/${token}`,
    {headers:FLIX_HEADERS}
  );

  log("FlixCloud M3U8 API HTTP",tokenResponse.status);

  if(!tokenResponse.ok)
    throw new Error(`FlixCloud API HTTP ${tokenResponse.status}`);

  const tokenData=await tokenResponse.json();
  const videoBytes=fromBase64(tokenData[sha256hex(token+"vid").substring(0,10)]);
  const TBytes=fromBase64(tokenData[sha256hex(token+"key").substring(0,10)]);

  if(!videoBytes.length||!TBytes.length)
    throw new Error("Encrypted FlixCloud fields missing");

  const wasmOutput=await runWasm(
    data.w_payload,
    frag1,
    kf2,
    TBytes,
    parseInt(seed.substring(0,8),16)
  );

  const pbk=CryptoJS.PBKDF2(
    uint8ToWordArray(wasmOutput),
    CryptoJS.enc.Utf8.parse(seed),
    {
      keySize:8,
      iterations:1000,
      hasher:CryptoJS.algo.SHA256
    }
  );

  const r=wordArrayToUint8(pbk);

  for(let i=0;i<32;i++)
    r[i]^=seed.charCodeAt(i%seed.length);

  const decrypted=CryptoJS.AES.decrypt(
    {ciphertext:uint8ToWordArray(videoBytes)},
    CryptoJS.SHA256(uint8ToWordArray(r)),
    {
      iv:uint8ToWordArray(iv),
      mode:CryptoJS.mode.CBC,
      padding:CryptoJS.pad.Pkcs7
    }
  );

  const streamUrl=CryptoJS.enc.Utf8.stringify(decrypted).trim();

  if(!/^https?:\/\//i.test(streamUrl))
    throw new Error("Invalid decrypted stream URL");

  log("FlixCloud HLS resolved");

  return{
    url:streamUrl,
    subtitles:data.subtitles||[],
    thumbnailsVtt:data.thumbnails_vtt||null,
    videoTitle:data.video_title||null,
    introChapter:data.intro_chapter||null,
    outroChapter:data.outro_chapter||null,
    videoId:data.video_id||null,
    version
  };
}

// =========================================================
// DIRECT MKV
// =========================================================

async function extractFlixCloudDownload(embedUrl){
  try{
    const aid=String(embedUrl).match(/\/e\/([a-z0-9]+)/i)?.[1];
    if(!aid)return null;

    log("Checking direct MKV",aid);

    const headers={
      Accept:"*/*",
      Referer:`${FLIXCLOUD_BASE}/`,
      "User-Agent":UA
    };

    const res=await fetch(
      `${FLIXCLOUD_BASE}/d/${aid}/__data.json`,
      {headers}
    );

    log("Direct MKV HTTP",res.status);

    if(!res.ok)return null;

    const body=await res.text();
    const fileId=body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    const token=body.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0];
    const base=body.match(/https:\/\/[a-z0-9-]+\.flixcloud\.cc/i)?.[0]||FLIXCLOUD_BASE;
    const quality=body.match(/(\d{3,4}p)/)?.[1]||"1080p";
    const size=body.match(/"(\d+(?:\.\d+)?\s*[KMG]B)"/i)?.[1]||"Unknown";

    if(!fileId||!token){
      log("Direct MKV data incomplete");
      return null;
    }

    let ready=false;

    try{
      const progress=await fetch(
        `${base}/download/${fileId}/progress?token=${token}`,
        {headers}
      );

      if(progress.ok){
        const text=await progress.text();
        ready=text.includes('"status":"ready"')||text.includes('"ready"');
      }
    }catch{}

    log("Direct MKV found",quality,size,`ready=${ready}`);

    return{
      url:`${base}/download/${fileId}?token=${token}`,
      quality,size,type:"mkv",headers,ready
    };
  }catch(e){
    log("Direct MKV failed",e?.message);
    return null;
  }
}

// =========================================================
// MAIN
// =========================================================

async function getStreams(tmdbId,mediaType="tv",season=1,episode=1){
  log("========================================");
  log("START",`TMDB=${tmdbId}`,`type=${mediaType}`,`S${season}E${episode}`);

  try{
    if(mediaType!=="tv"&&mediaType!=="movie"){
      log("Unsupported media type");
      return[];
    }

    const movie=mediaType==="movie";
    const seasonNumber=Number(season)||1;
    const originalEpisode=movie?1:Number(episode)||1;

    const tmdb=await getTmdbInfo(tmdbId,mediaType);

    if(!tmdb?.imdbId){
      log("STOP: No IMDb ID");
      return[];
    }

    log("IMDb resolved",tmdb.imdbId);

    const mapping=await resolveImdbToAnilist({
      imdbId:tmdb.imdbId,
      type:movie?"movie":"show",
      season:seasonNumber,
      episode:originalEpisode
    });

    if(!mapping?.anilistId){
      log("STOP: No AniList mapping");
      return[];
    }

    const mappedEpisode=Number(mapping.episode)||originalEpisode;

    log(
      "Mapping complete",
      `AniList=${mapping.anilistId}`,
      `episode=${mappedEpisode}`
    );

    const slug=await getReanimeSlug(tmdbId,mediaType);
    const settings=globalThis.SCRAPER_SETTINGS||{};
    const languages=[];

    if(settings.reanime_sub!==false)languages.push("sub");
    if(settings.reanime_dub!==false)languages.push("dub");

    log("Languages",languages.join(","));

    const serversByLang={};

    for(const language of languages){
      try{
        const result=await getFlixEmbeds(
          slug,
          mappedEpisode,
          language,
          mapping.anilistId
        );

        if(result.servers?.length)
          serversByLang[language]=result.servers;
      }catch(e){
        log("Language failed",language,e?.message);
      }
    }

    if(!Object.keys(serversByLang).length){
      log("STOP: No servers");
      return[];
    }

    log(
      "Servers found",
      Object.entries(serversByLang)
        .map(([k,v])=>`${k}=${v.length}`)
        .join(" ")
    );

    const tasks=[];
    const streams=[];
    const seen=new Set();

    for(const language of languages){
      const servers=serversByLang[language]||[];

      for(let i=0;i<servers.length;i++){
        const server=servers[i];
        const dataLink=server?.dataLink;
        if(!dataLink)continue;

        const serverName=server.serverName||`HD-${i+1}`;
        const langUpper=language.toUpperCase();
        const title=movie
          ?`${tmdb.title} (${langUpper})`
          :`${tmdb.title} - Episode ${originalEpisode} (${langUpper})`;

        tasks.push((async()=>{
          try{
            const direct=await extractFlixCloudDownload(dataLink);

            if(direct?.url)
              return{
                name:`Reanime [${langUpper}] ${serverName} (${direct.quality})`,
                title,url:direct.url,
                quality:direct.quality,
                size:direct.size,
                headers:direct.headers,
                provider:"reanime",
                type:"mkv"
              };
          }catch(e){
            log("MKV exception",e?.message);
          }

          try{
            const resolved=await resolveFlixCloud(dataLink);

            if(resolved?.url)
              return{
                name:`Reanime [${langUpper}] ${serverName} (Auto)`,
                title,url:resolved.url,
                quality:"Auto",
                provider:"reanime",
                type:"m3u8",
                subtitles:resolved.subtitles||[]
              };
          }catch(e){
            log("HLS exception",e?.message);
          }

          return null;
        })());
      }
    }

    log("Resolving",tasks.length,"stream(s)");

    const results=await Promise.all(tasks);

    for(const result of results){
      if(result?.url&&!seen.has(result.name)){
        seen.add(result.name);
        streams.push(result);
      }
    }

    const rank={
      auto:4000,
      adaptive:4000,
      "2160p":2160,
      "4k":2160,
      "1080p":1080,
      "720p":720,
      "480p":480,
      "360p":360,
      unknown:0
    };

    streams.sort((a,b)=>
      (rank[String(b.quality||"").toLowerCase()]||0)-
      (rank[String(a.quality||"").toLowerCase()]||0)
    );

    log("DONE",`${streams.length} stream(s)`);
    log("========================================");

    return streams;
  }catch(e){
    err("FATAL",e?.stack||e?.message||e);
    return[];
  }
}

// =========================================================
// SETTINGS
// =========================================================

async function onSettings(){
  return[
    {type:"header",label:"Reanime"},
    {type:"toggle",key:"reanime_sub",label:"Subtitles",defaultValue:true},
    {type:"toggle",key:"reanime_dub",label:"Dub",defaultValue:true}
  ];
}

module.exports={getStreams,onSettings};
