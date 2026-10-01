const CryptoJS=require("crypto-js");

const REANIME_DOMAINS=["https://reanime.to","https://reanime.cz","https://reanime.wtf"];
const FLIXCLOUD_BASE="https://flixcloud.cc";
const TMDB_API_KEY="439c478a771f35c05022f9feabcca01c";
const ANIBRIDGE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const CINEMETA_URL="https://v3-cinemeta.strem.io/meta";
const ARM_BASE="https://arm.haglund.dev/api/v2";
const USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS={"User-Agent":USER_AGENT,"Accept":"application/json, text/plain, */*","Accept-Language":"en-US,en;q=0.9"};
const FLIX_HEADERS={"User-Agent":USER_AGENT,"Accept":"*/*","Origin":FLIXCLOUD_BASE,"Referer":`${FLIXCLOUD_BASE}/`};

let activeBaseUrl=REANIME_DOMAINS[0];
let mappingCache=null;
const MAPPING_TTL=24*60*60*1000;

// =========================================================
// HTTP
// =========================================================

function absolutize(path,base=activeBaseUrl){
  if(!path)return"";
  if(/^https?:\/\//i.test(path))return path;
  return `${base}${path.startsWith("/")?"":"/"}${path}`;
}

async function fetchText(url,options={}){
  const absolute=/^https?:\/\//i.test(url);
  const urls=absolute?[url]:REANIME_DOMAINS.map(d=>absolutize(url,d));
  let lastError=null;
  for(const tryUrl of urls){
    try{
      const response=await fetch(tryUrl,{
        ...options,
        headers:{...HEADERS,...(options.headers||{})}
      });
      if(response.ok){
        if(!absolute){
          const m=tryUrl.match(/^(https?:\/\/[^/]+)/);
          if(m)activeBaseUrl=m[1];
        }
        return await response.text();
      }
      lastError=new Error(`Reanime HTTP ${response.status}: ${tryUrl}`);
    }catch(e){lastError=e;}
  }
  throw lastError||new Error(`Failed to fetch: ${url}`);
}

async function fetchJson(url,options={}){
  const text=await fetchText(url,{
    ...options,
    headers:{"Accept":"application/json, text/plain, */*",...(options.headers||{})}
  });
  return JSON.parse(text);
}

// =========================================================
// TMDB
// =========================================================

async function getTmdbInfo(tmdbId,mediaType){
  const type=mediaType==="movie"?"movie":"tv";
  const url=`${TMDB_BASE(type)}/${encodeURIComponent(tmdbId)}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  try{
    const data=await fetchJson(url);
    let imdbId=data?.external_ids?.imdb_id||data?.imdb_id||null;
    if(!imdbId){
      try{
        const arm=await fetchJson(`${ARM_BASE}/themoviedb?id=${encodeURIComponent(tmdbId)}`);
        if(Array.isArray(arm)&&arm.length)imdbId=arm[0]?.imdb||null;
      }catch{}
    }
    return{
      title:data?.name||data?.title||data?.original_name||data?.original_title||"Anime",
      year:(data?.first_air_date||data?.release_date||"").slice(0,4),
      imdbId
    };
  }catch{return null;}
}

function TMDB_BASE(type){
  return `https://api.themoviedb.org/3/${type}`;
}

// =========================================================
// ANIBRIDGE
// =========================================================

function parseDescriptor(value){
  const m=String(value||"").match(/^([^:]+):([^:]+)(?::s(\d+))?$/);
  if(!m)return null;
  return{provider:m[1],id:m[2],season:m[3]===undefined?null:Number(m[3])};
}

function parseRange(value){
  const m=String(value||"").trim().match(/^(\d+)(?:-(\d*))?$/);
  if(!m)return null;
  return{
    start:Number(m[1]),
    end:m[2]===undefined||m[2]===""?Infinity:Number(m[2])
  };
}

function parseTargetRanges(value){
  let text=String(value||"").trim(),ratio=1;
  const m=text.match(/\|(-?\d+(?:\.\d+)?)$/);
  if(m){
    ratio=Number(m[1]);
    text=text.slice(0,m.index);
  }
  const ranges=text.split(",").map(parseRange).filter(Boolean);
  return{ratio,ranges};
}

function buildEpisodeMapping(sourceRange,targetRange){
  const source=parseRange(sourceRange);
  const target=parseTargetRanges(targetRange);
  if(!source||!target.ranges.length)return null;
  return{
    sourceStart:source.start,
    sourceEnd:source.end,
    ratio:target.ratio,
    targets:target.ranges
  };
}

function buildIndex(raw){
  const movies=Object.create(null);
  const shows=Object.create(null);

  for(const[sourceDescriptor,targets]of Object.entries(raw||{})){
    const source=parseDescriptor(sourceDescriptor);
    if(!source||!targets||typeof targets!=="object")continue;

    if(source.provider==="imdb_movie"){
      for(const targetDescriptor of Object.keys(targets)){
        const target=parseDescriptor(targetDescriptor);
        if(target?.provider==="anilist"){
          movies[source.id]=String(target.id);
          break;
        }
      }
      continue;
    }

    if(source.provider!=="imdb_show"||source.season===null)continue;

    const entries=[];

    for(const[targetDescriptor,ranges]of Object.entries(targets)){
      const target=parseDescriptor(targetDescriptor);
      if(!target||target.provider!=="anilist")continue;

      const mappings=[];

      if(ranges&&typeof ranges==="object"){
        for(const[sourceRange,targetRange]of Object.entries(ranges)){
          const mapping=buildEpisodeMapping(sourceRange,targetRange);
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
  const sourceEpisode=Number(episode);
  if(!Number.isFinite(sourceEpisode)||sourceEpisode<1)return null;
  if(!mapping.ranges.length)return sourceEpisode;

  for(const range of mapping.ranges){
    if(sourceEpisode<range.sourceStart)continue;
    if(Number.isFinite(range.sourceEnd)&&sourceEpisode>range.sourceEnd)continue;

    const offset=sourceEpisode-range.sourceStart;
    let targetOffset;

    if(range.ratio===1)targetOffset=offset;
    else if(range.ratio>0)targetOffset=Math.floor(offset*range.ratio);
    else targetOffset=Math.floor(offset/Math.abs(range.ratio));

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
  if(mappingCache&&Date.now()-mappingCache.updatedAt<MAPPING_TTL)return mappingCache.index;

  try{
    const response=await fetch(ANIBRIDGE_URL,{
      headers:{
        Accept:"application/json",
        "User-Agent":"Reanime-Nuvio/1.0"
      }
    });
    if(!response.ok)throw new Error(`AniBridge HTTP ${response.status}`);

    const raw=await response.json();
    const index=buildIndex(raw);

    if(!Object.keys(index.movies).length&&!Object.keys(index.shows).length)
      throw new Error("AniBridge produced empty index");

    mappingCache={updatedAt:Date.now(),index};
    return index;
  }catch(e){
    return mappingCache?.index||null;
  }
}

async function resolveImdbToAnilist({imdbId,type,season=1,episode=1}){
  if(!imdbId||!/^tt\d+$/i.test(String(imdbId)))return null;

  const index=await loadMapping();
  if(!index)return null;

  const id=String(imdbId).trim();

  if(type==="movie"){
    const anilistId=index.movies?.[id];
    if(!anilistId)return null;
    return{anilistId:String(anilistId),episode:1,source:"anibridge"};
  }

  const seasonNumber=Number(season);
  const episodeNumber=Number(episode);
  if(!Number.isFinite(seasonNumber)||!Number.isFinite(episodeNumber))return null;

  const candidates=index.shows?.[`${id}|${seasonNumber}`];
  if(!Array.isArray(candidates))return null;

  for(const candidate of candidates){
    const targetEpisode=findTargetEpisode(candidate,episodeNumber);
    if(targetEpisode!==null){
      return{
        anilistId:String(candidate.anilistId),
        episode:targetEpisode,
        source:"anibridge"
      };
    }
  }

  return null;
}

// =========================================================
// REANIME SERVER LOOKUP
// =========================================================

function slugify(value){
  return String(value||"")
    .toLowerCase()
    .replace(/['’]/g,"")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

async function getReanimeSlug(tmdbId,mediaType){
  try{
    const type=mediaType==="movie"?"movie":"tv";
    const data=await fetchJson(`${CINEMETA_URL}/${type}/tmdb:${encodeURIComponent(tmdbId)}.json`);
    return data?.meta?.slug||slugify(data?.meta?.name||data?.meta?.title);
  }catch{return null;}
}

function filterServers(servers,language){
  return Array.isArray(servers)
    ?servers.filter(s=>s?.dataType&&s.dataType.toLowerCase()===language.toLowerCase())
    :[];
}

async function getFlixEmbeds(slug,episodeNumber,language,anilistId){
  const watchPath=`/watch/${slug||"anime"}?ep=${episodeNumber}`;

  if(anilistId){
    try{
      const json=await fetchJson(`/api/flix/${anilistId}/${episodeNumber}`,{
        headers:{Referer:absolutize(watchPath)}
      });

      if(json?.success&&Array.isArray(json.servers)&&json.servers.length){
        const servers=filterServers(json.servers,language);
        if(servers.length)return{
          watchUrl:absolutize(watchPath),
          servers,
          embeds:servers.map(s=>s.dataLink).filter(Boolean)
        };
      }
    }catch{}
  }

  if(slug){
    try{
      const anime=await fetchJson(`/api/v1/anime/${slug}`);
      const alId=anime?.anilist_id;

      if(alId){
        const json=await fetchJson(`/api/flix/${alId}/${episodeNumber}`,{
          headers:{Referer:absolutize(watchPath)}
        });

        if(json?.success&&Array.isArray(json.servers)&&json.servers.length){
          const servers=filterServers(json.servers,language);
          if(servers.length)return{
            watchUrl:absolutize(watchPath),
            servers,
            embeds:servers.map(s=>s.dataLink).filter(Boolean)
          };
        }
      }
    }catch{}

    try{
      const html=await fetchText(`/anime/${slug}?_ep=${episodeNumber}`);
      const m=html.match(/anilist_id:\s*(\d+)/);

      if(m){
        const json=await fetchJson(`/api/flix/${m[1]}/${episodeNumber}`,{
          headers:{Referer:absolutize(watchPath)}
        });

        if(json?.success&&Array.isArray(json.servers)&&json.servers.length){
          const servers=filterServers(json.servers,language);
          if(servers.length)return{
            watchUrl:absolutize(watchPath),
            servers,
            embeds:servers.map(s=>s.dataLink).filter(Boolean)
          };
        }
      }
    }catch{}
  }

  return{watchUrl:absolutize(watchPath),servers:[],embeds:[]};
}

// =========================================================
// FLIXCLOUD CRYPTO
// =========================================================

function sha256hex(value){
  return CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(String(value))).toString(CryptoJS.enc.Hex);
}

function fromBase64(value){
  return Uint8Array.from(
    atob(String(value)),
    c=>c.charCodeAt(0)
  );
}

function uint8ToWordArray(bytes){
  const words=[];
  for(let i=0;i<bytes.length;i++)
    words[i>>>2]=(words[i>>>2]||0)|(bytes[i]<<(24-(i%4)*8));
  return CryptoJS.lib.WordArray.create(words,bytes.length);
}

function wordArrayToUint8(wordArray){
  const words=wordArray.words,sigBytes=wordArray.sigBytes,out=new Uint8Array(sigBytes);
  for(let i=0;i<sigBytes;i++)
    out[i]=(words[i>>>2]>>>(24-(i%4)*8))&255;
  return out;
}

function generateFields(seed){
  let e=seed;
  for(let i=0;i<3;i++)e=sha256hex(e+i);
  let l=e;
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
  const wasmBytes=fromBase64(wasmB64);
  const{instance}=await WebAssembly.instantiate(wasmBytes);
  const{_s,_r,memory}=instance.exports;

  if(typeof _s!=="function"||typeof _r!=="function"||!memory)
    throw new Error("Invalid FlixCloud WASM exports");

  const heap=new Uint8Array(memory.buffer);
  const len=frag1.length;
  const y=1000,v=y+len,T=y+2*len,out=y+3*len;

  heap.set(frag1,y);
  heap.set(kf2,v);
  heap.set(TBytes,T);

  _s(seedInt);
  _r(y,v,T,out,len);

  return heap.slice(out,out+len);
}

function extractSsrObject(html){
  const marker=html.match(/\{type:"data",data:(\{)/);
  if(!marker)throw new Error("FlixCloud SSR data block not found");

  const start=html.indexOf("{",marker.index+marker[0].length-1);
  let depth=0;

  for(let i=start;i<html.length;i++){
    if(html[i]==="{")depth++;
    else if(html[i]==="}"){
      depth--;
      if(depth===0)return html.slice(start,i+1);
    }
  }

  throw new Error("FlixCloud SSR brace matching failed");
}

function parseSsrData(html){
  const objectText=extractSsrObject(html);
  return Function(`"use strict"; return (${objectText});`)();
}

async function resolveFlixCloud(embedUrl){
  const match=String(embedUrl).match(/\/e\/([^?#\s]+)(?:\?v=(\d+))?/i);
  if(!match)throw new Error("Invalid FlixCloud embed URL");

  const accessId=match[1];
  const version=Number(match[2])||2;

  const response=await fetch(`${FLIXCLOUD_BASE}/e/${accessId}?v=${version}`,{
    headers:{
      "User-Agent":USER_AGENT,
      Accept:"*/*",
      Referer:"https://reanime.to/"
    }
  });

  if(!response.ok)throw new Error(`FlixCloud embed HTTP ${response.status}`);

  const data=parseSsrData(await response.text());
  const seed=data.obfuscation_seed;
  if(!seed)throw new Error("FlixCloud obfuscation seed missing");

  const fields=generateFields(seed);
  const cryptoData=data.obfuscated_crypto_data;
  if(!cryptoData)throw new Error("FlixCloud crypto data missing");

  const container=cryptoData[fields.containerName];
  if(!container)throw new Error("FlixCloud crypto container missing");

  const array=container[fields.arrayName];
  if(!array||!array[0])throw new Error("FlixCloud crypto array missing");

  const object=array[0][fields.objectName];
  if(!object)throw new Error("FlixCloud crypto object missing");

  const frag1=fromBase64(object[fields.keyField]);
  const iv=fromBase64(object[fields.ivField]);
  const kf2=fromBase64(data[fields.keyFrag2Field]);
  const token=data[fields.tokenField];

  if(!token)throw new Error("FlixCloud token missing");

  const tokenResponse=await fetch(
    `${FLIXCLOUD_BASE}/api/m3u8/${token}`,
    {headers:FLIX_HEADERS}
  );

  if(!tokenResponse.ok)
    throw new Error(`FlixCloud API HTTP ${tokenResponse.status}`);

  const tokenData=await tokenResponse.json();

  const videoField=sha256hex(token+"vid").substring(0,10);
  const keyField=sha256hex(token+"key").substring(0,10);

  const videoBytes=fromBase64(tokenData[videoField]);
  const TBytes=fromBase64(tokenData[keyField]);

  if(!videoBytes.length||!TBytes.length)
    throw new Error("FlixCloud encrypted fields missing");

  const seedInt=parseInt(seed.substring(0,8),16);

  const wasmOutput=await runWasm(
    data.w_payload,
    frag1,
    kf2,
    TBytes,
    seedInt
  );

  const pbk=CryptoJS.PBKDF2(
    uint8ToWordArray(wasmOutput),
    CryptoJS.enc.Utf8.parse(seed),
    {
      keySize:256/32,
      iterations:1000,
      hasher:CryptoJS.algo.SHA256
    }
  );

  const r=wordArrayToUint8(pbk);

  for(let i=0;i<32;i++)
    r[i]^=seed.charCodeAt(i%seed.length);

  const aesKey=CryptoJS.SHA256(uint8ToWordArray(r));

  const decrypted=CryptoJS.AES.decrypt(
    {ciphertext:uint8ToWordArray(videoBytes)},
    aesKey,
    {
      iv:uint8ToWordArray(iv),
      mode:CryptoJS.mode.CBC,
      padding:CryptoJS.pad.Pkcs7
    }
  );

  const streamUrl=CryptoJS.enc.Utf8.stringify(decrypted).trim();

  if(!/^https?:\/\//i.test(streamUrl))
    throw new Error("Invalid decrypted FlixCloud URL");

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
// FLIXCLOUD DIRECT DOWNLOAD
// =========================================================

async function extractFlixCloudDownload(embedUrl){
  try{
    const match=String(embedUrl).match(/\/e\/([a-z0-9]+)/i);
    const aid=match?.[1];
    if(!aid)return null;

    const headers={
      Accept:"*/*",
      Referer:`${FLIXCLOUD_BASE}/`,
      "User-Agent":USER_AGENT
    };

    const res=await fetch(
      `${FLIXCLOUD_BASE}/d/${aid}/__data.json`,
      {headers}
    );

    if(!res.ok)return null;

    const body=await res.text();
    const fileIdMatch=body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const tokenMatch=body.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
    const baseMatch=body.match(/https:\/\/[a-z0-9-]+\.flixcloud\.cc/i);
    const resolutionMatch=body.match(/(\d{3,4}p)/);
    const sizeMatch=body.match(/"(\d+(?:\.\d+)?\s*[KMG]B)"/i);

    const fileId=fileIdMatch?.[0]||null;
    const token=tokenMatch?.[0]||null;
    const base=baseMatch?.[0]||FLIXCLOUD_BASE;
    const resolution=resolutionMatch?.[1]||null;
    const size=sizeMatch?.[1]||"Unknown";

    if(!fileId||!token)return null;

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

    return{
      url:`${base}/download/${fileId}?token=${token}`,
      quality:resolution||"1080p",
      size,
      type:"mkv",
      headers,
      ready
    };
  }catch{return null;}
}

// =========================================================
// MAIN
// =========================================================

async function getStreams(
  tmdbId,
  mediaType="tv",
  season=1,
  episode=1
){
  try{
    if(mediaType!=="tv"&&mediaType!=="movie")return[];

    const movie=mediaType==="movie";
    const seasonNumber=Number(season)||1;
    const originalEpisode=movie?1:Number(episode)||1;

    const tmdb=await getTmdbInfo(tmdbId,mediaType);
    if(!tmdb?.imdbId)return[];

    const mapping=await resolveImdbToAnilist({
      imdbId:tmdb.imdbId,
      type:movie?"movie":"show",
      season:seasonNumber,
      episode:originalEpisode
    });

    if(!mapping?.anilistId)return[];

    const mappedEpisode=Number(mapping.episode)||originalEpisode;
    const slug=await getReanimeSlug(tmdbId,mediaType);
    const settings=globalThis.SCRAPER_SETTINGS||{};

    const languages=[];
    if(settings.reanime_sub!==false)languages.push("sub");
    if(settings.reanime_dub!==false)languages.push("dub");

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
      }catch{}
    }

    if(!Object.keys(serversByLang).length)return[];

    const streams=[];
    const seen=new Set();
    const tasks=[];

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
          // Preserve original addon behavior: direct MKV first.
          try{
            const direct=await extractFlixCloudDownload(dataLink);

            if(direct?.url){
              return{
                name:`Reanime [${langUpper}] ${serverName} (${direct.quality||"1080p"})`,
                title,
                url:direct.url,
                quality:direct.quality||"1080p",
                size:direct.size||"Unknown",
                headers:direct.headers,
                provider:"reanime",
                type:"mkv"
              };
            }
          }catch{}

          // Crypto/HLS fallback.
          try{
            const resolved=await resolveFlixCloud(dataLink);

            if(resolved?.url){
              return{
                name:`Reanime [${langUpper}] ${serverName} (Auto)`,
                title,
                url:resolved.url,
                quality:"Auto",
                provider:"reanime",
                type:"m3u8",
                subtitles:resolved.subtitles||[]
              };
            }
          }catch{}

          return null;
        })());
      }
    }

    const results=await Promise.all(tasks);

    for(const result of results){
      if(result?.url&&!seen.has(result.name)){
        seen.add(result.name);
        streams.push(result);
      }
    }

    const rank={
      "auto":4000,
      "adaptive":4000,
      "2160p":2160,
      "4k":2160,
      "1080p":1080,
      "720p":720,
      "480p":480,
      "360p":360,
      "unknown":0
    };

    streams.sort((a,b)=>
      (rank[String(b.quality||"").toLowerCase()]||0)-
      (rank[String(a.quality||"").toLowerCase()]||0)
    );

    return streams;
  }catch(error){
    console.error(`[Reanime] ${error?.message||error}`);
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
