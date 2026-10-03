const cheerio=require("cheerio-without-node-native");
const MAIN_URL="https://anizone.to";
const TMDB_API_KEY="68e094699525b18a70bab2f86b1fa706";
const HEADERS={
  "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
  "Referer":"https://anizone.to/"
};
// Existing provider is the ONLY fallback.
// It is called only after the fast path returns null.
const FALLBACK=require("./anizone.js");
const SEARCH_CACHE=new Map();
const ANIME_CACHE=new Map();
const STREAM_CACHE=new Map();
const FAST_MAPPING_CACHE=new Map();
const SEARCH_TTL=5*60*1000;
const ANIME_TTL=5*60*1000;
const STREAM_TTL=60*60*1000;
const MAPPING_TTL=24*60*60*1000;
const MAX_CACHE=300;
function cacheGet(cache,key,ttl){
  const item=cache.get(key);
  if(!item)return null;
  if(Date.now()-item.time>=ttl){
    cache.delete(key);
    return null;
  }
  return item.value;
}
function cacheSet(cache,key,value){
  if(cache.size>=MAX_CACHE){
    const first=cache.keys().next().value;
    if(first!==undefined)cache.delete(first);
  }
  cache.set(key,{time:Date.now(),value});
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
    .replace(/\\0/g,"\\u0000")
    .replace(/\\x([0-9a-fA-F]{2})/g,(_,h)=>"\\u00"+h)
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g,"");
}
function parseXDataJson(raw){
  try{
    return JSON.parse(sanitizeJson(raw));
  }catch(e){
    return null;
  }
}
async function fetchWithTimeout(url,options={},timeoutMs=8000){
  const mergedHeaders={
    ...HEADERS,
    ...(options.headers||{})
  };
  const fetchOptions={
    skipSizeCheck:true,
    ...options,
    headers:mergedHeaders
  };
  let timer;
  try{
    const request=fetch(url,fetchOptions);
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error("Timeout")),timeoutMs);
    });
    const response=await Promise.race([request,timeout]);
    clearTimeout(timer);
    return response;
  }catch(e){
    clearTimeout(timer);
    throw e;
  }
}
async function fetchText(url,options={},timeoutMs=8000){
  const finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
  try{
    const response=await fetchWithTimeout(
      finalUrl,
      options,
      timeoutMs
    );
    if(!response.ok)return"";
    return await response.text();
  }catch(e){
    return"";
  }
}
async function fetchWithCookies(url,options={},timeoutMs=8000){
  const finalUrl=url.startsWith("http")?url:`${MAIN_URL}${url}`;
  try{
    const response=await fetchWithTimeout(
      finalUrl,
      options,
      timeoutMs
    );
    if(!response.ok){
      return{
        text:"",
        cookies:"",
        ok:false
      };
    }
    const text=await response.text();
    let cookies="";
    try{
      if(typeof response.headers?.getSetCookie==="function"){
        cookies=response.headers
          .getSetCookie()
          .map(c=>c.split(";")[0])
          .join("; ");
      }else if(response.headers?.get){
        cookies=response.headers.get("set-cookie")||"";
      }
    }catch(e){}
    return{
      text,
      cookies,
      ok:true
    };
  }catch(e){
    return{
      text:"",
      cookies:"",
      ok:false
    };
  }
}
function normalize(value){
  if(!value)return"";
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g,"")
    .trim();
}
function cleanTitle(title){
  if(!title)return"";
  return String(title)
    .replace(/\s*:\s*season\s*\d+.*$/i,"")
    .replace(/\s*season\s*\d+.*$/i,"")
    .replace(/\s*s\d+\s*$/i,"")
    .trim();
}
async function getTmdbInfo(tmdbId,mediaType="tv",season=1){
  const type=mediaType==="tv"?"tv":"movie";
  try{
    const mainUrl=
      `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    if(type==="movie"){
      const response=await fetchWithTimeout(
        mainUrl,
        {},
        5000
      );
      if(!response.ok)return null;
      const data=await response.json();
      return{
        title:
          data.name||
          data.title||
          data.original_name||
          data.original_title||
          "",
        originalTitle:
          data.original_name||
          data.original_title||
          "",
        seasonName:""
      };
    }
    // These are independent requests, so unlike the old resolver
    // they are intentionally performed together.
    const seasonUrl=
      `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`;
    const [mainResult,seasonResult]=await Promise.allSettled([
      fetchWithTimeout(mainUrl,{},5000),
      fetchWithTimeout(seasonUrl,{},5000)
    ]);
    if(
      mainResult.status!=="fulfilled"||
      !mainResult.value?.ok
    ){
      return null;
    }
    const data=await mainResult.value.json();
    let seasonName="";
    if(
      seasonResult.status==="fulfilled"&&
      seasonResult.value?.ok
    ){
      try{
        const seasonData=await seasonResult.value.json();
        seasonName=seasonData.name||"";
      }catch(e){}
    }
    return{
      title:
        data.name||
        data.title||
        data.original_name||
        data.original_title||
        "",
      originalTitle:
        data.original_name||
        data.original_title||
        "",
      seasonName
    };
  }catch(e){
    return null;
  }
}
function parseCards(html){
  const $=cheerio.load(html);
  const cards=[];
  const itemsMatch=html.match(
    /items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/
  );
  if(itemsMatch){
    const parsed=parseXDataJson(itemsMatch[1]);
    if(Array.isArray(parsed)){
      for(const item of parsed){
        if(!item||!item.slug)continue;
        const titles=new Set();
        if(item.main_title){
          titles.add(item.main_title);
        }
        if(
          item.title_list&&
          typeof item.title_list==="object"
        ){
          for(const title of Object.values(item.title_list)){
            if(title)titles.add(title);
          }
        }
        if(item.title){
          titles.add(item.title);
        }
        cards.push({
          slug:item.slug,
          url:item.url||`/anime/${item.slug}`,
          titles:[...titles]
        });
      }
    }
  }
  if(cards.length)return cards;
  $('[x-data*="anmTitles"]').each((i,el)=>{
    const href=$(el)
      .find('a[href*="/anime/"]')
      .first()
      .attr("href");
    if(!href)return;
    const parts=href.split("/");
    const slug=
      parts[parts.length-1]||
      parts[parts.length-2];
    if(!slug)return;
    const titles=new Set();
    const xData=$(el).attr("x-data")||"";
    const match=xData.match(
      /JSON\.parse\('((?:[^'\\]|\\.)*)'\)/
    );
    if(match){
      const data=parseXDataJson(match[1]);
      if(data&&typeof data==="object"){
        for(const title of Object.values(data)){
          if(title)titles.add(title);
        }
      }
    }
    cards.push({
      slug,
      url:
        href.startsWith("http")?
          href:
          `${MAIN_URL}${href}`,
      titles:[...titles]
    });
  });
  return cards;
}
async function searchAniZone(query){
  if(!query)return[];
  const key=query.toLowerCase().trim();
  const cached=cacheGet(
    SEARCH_CACHE,
    key,
    SEARCH_TTL
  );
  if(cached){
    console.log(
      `[AniZone-AS] Search cache hit: "${query}"`
    );
    return cached;
  }
  const html=await fetchText(
    `/anime?search=${encodeURIComponent(query)}`,
    {},
    8000
  );
  if(!html)return[];
  const cards=parseCards(html);
  cacheSet(
    SEARCH_CACHE,
    key,
    cards
  );
  console.log(
    `[AniZone-AS] Search "${query}" -> ${cards.length}`
  );
  return cards;
}
/*
 * IMPORTANT:
 *
 * This is deliberately stricter than the original provider.
 *
 * We are NOT allowed to pick cards[0] when the season is
 * ambiguous. That is exactly how a TMDB/AniZone season
 * grouping mismatch could silently return the wrong anime.
 */
function getSeasonTokens(season){
  const n=parseInt(season,10)||1;
  const tokens=[
    `season ${n}`,
    `season${n}`,
    `${n} season`,
    `${n}nd season`,
    `${n}rd season`,
    `${n}th season`,
    `s${n}`
  ];
  const roman={
    2:"ii",
    3:"iii",
    4:"iv",
    5:"v",
    6:"vi",
    7:"vii",
    8:"viii",
    9:"ix",
    10:"x"
  };
  if(roman[n]){
    tokens.push(
      roman[n],
      `season ${roman[n]}`
    );
  }
  return tokens.map(normalize);
}
function hasExplicitDifferentSeason(title,season){
  const n=parseInt(season,10)||1;
  const text=String(title||"");
  if(
    /movie|gekijouban|the movie/i.test(text)
  ){
    return true;
  }
  const match=text.match(
    /(?:season|saison)\s*(\d+)/i
  );
  if(match){
    return parseInt(match[1],10)!==n;
  }
  const sMatch=text.match(
    /\bs(\d+)\b/i
  );
  if(sMatch){
    return parseInt(sMatch[1],10)!==n;
  }
  return false;
}
function explicitSeasonMatch(title,season,seasonName){
  const raw=String(title||"");
  const normalized=normalize(raw);
  const n=parseInt(season,10)||1;
  if(
    seasonName&&
    normalize(seasonName)!=="season"+n
  ){
    const sn=normalize(seasonName);
    if(
      normalized===sn||
      normalized.includes(sn)||
      sn.includes(normalized)
    ){
      return true;
    }
  }
  const tokens=getSeasonTokens(n);
  if(
    tokens.some(token=>normalized.includes(token))
  ){
    return true;
  }
  if(n===4&&/final\s*season/i.test(raw)){
    return true;
  }
  return false;
}
function selectFastSeasonCard(
  cards,
  baseTitle,
  season,
  seasonName,
  originalTitle
){
  const base=normalize(baseTitle);
  const original=normalize(originalTitle);
  const candidates=[];
  for(const card of cards){
    let titleMatch=false;
    let explicitSeason=false;
    let wrongSeason=false;
    for(const title of card.titles){
      const n=normalize(title);
      if(
        n===base||
        (base&&n.includes(base))||
        (base&&base.includes(n))||
        (original&&n===original)||
        (original&&n.includes(original))||
        (original&&original.includes(n))
      ){
        titleMatch=true;
      }
      if(
        hasExplicitDifferentSeason(
          title,
          season
        )
      ){
        wrongSeason=true;
      }
      if(
        explicitSeasonMatch(
          title,
          season,
          seasonName
        )
      ){
        explicitSeason=true;
      }
    }
    if(!titleMatch||wrongSeason)continue;
    candidates.push({
      card,
      explicitSeason
    });
  }
  if(!candidates.length){
    return null;
  }
  /*
   * Season 1 can safely use a title that has no explicit
   * later-season marker.
   */
  if((parseInt(season,10)||1)===1){
    const clean=candidates.filter(
      x=>!x.card.titles.some(title=>
        hasExplicitDifferentSeason(title,1)
      )
    );
    if(clean.length===1){
      return clean[0].card;
    }
    if(clean.length>1){
      const exact=clean.filter(x=>
        x.card.titles.some(title=>{
          const n=normalize(title);
          return n===base||n===original;
        })
      );
      if(exact.length===1){
        return exact[0].card;
      }
    }
    return null;
  }
  /*
   * For S2+, NEVER guess.
   *
   * We require an explicit indication that the AniZone
   * result represents the same season requested by TMDB.
   */
  const explicit=candidates.filter(
    x=>x.explicitSeason
  );
  if(explicit.length===1){
    return explicit[0].card;
  }
  /*
   * Multiple candidates or no explicit season =
   * uncertain grouping. Force the proven fallback.
   */
  return null;
}
async function getAnimePage(animeUrl){
  const cached=cacheGet(
    ANIME_CACHE,
    animeUrl,
    ANIME_TTL
  );
  if(cached){
    console.log(
      `[AniZone-AS] Anime page cache hit`
    );
    return cached;
  }
  const html=await fetchText(
    animeUrl,
    {},
    8000
  );
  if(!html)return null;
  const $=cheerio.load(html);
  const dataDiv=
    $("main").children().first();
  const xData=
    dataDiv.attr("x-data")||"";
  const match=xData.match(
    /items:\s*JSON\.parse\('((?:[^'\\]|\\.)*)'\)/
  );
  if(
    !match||
    !match[1]
  ){
    return null;
  }
  const list=parseXDataJson(match[1]);
  if(!Array.isArray(list)){
    return null;
  }
  const episodes=[];
  let number=1;
  for(const item of list){
    if(!item||!item.url)continue;
    episodes.push({
      episodeNumber:number++,
      episodeLink:String(item.url).replace(/\\/g,""),
      episodeTitle:
        item.title_list?.["1"]||
        item.title||
        `Episode ${number-1}`,
      thumbnail:
        item.snapshot?
          String(item.snapshot).replace(/\\/g,""):
          null,
      isFiller:
        String(item.type||"").toLowerCase()==="filler"
    });
  }
  const result={
    html,
    episodes
  };
  cacheSet(
    ANIME_CACHE,
    animeUrl,
    result
  );
  return result;
}
function parseSubtitleTracks(data){
  if(
    !data||
    !Array.isArray(data.subtitles)
  ){
    return[];
  }
  return data.subtitles
    .map(s=>({
      url:
        s?.file?
          String(s.file).replace(/\\/g,""):
          "",
      name:
        s?.title||
        s?.language||
        "English",
      language:
        s?.language||
        "en"
    }))
    .filter(s=>s.url);
}
function parseVidstackFromHtml(html,$){
  const vidMatch=html.match(
    /vidstackPlayer\(JSON\.parse\('((?:[^'\\]|\\.)*)'\)\)/
  );
  if(vidMatch){
    try{
      const data=parseXDataJson(
        vidMatch[1]
      );
      const master=data?.src?
        String(data.src).replace(/\\/g,""):
        null;
      if(master){
        return{
          masterUrl:master,
          subtitles:parseSubtitleTracks(data)
        };
      }
    }catch(e){}
  }
  let masterUrl=
    $("media-player").attr("src")||
    "";
  if(!masterUrl){
    const match=html.match(
      /https:\/\/[^"']+\/master\.m3u8/
    );
    if(match){
      masterUrl=match[0];
    }
  }
  const subtitles=[];
  $("track").each((i,el)=>{
    const src=$(el).attr("src");
    const kind=$(el).attr("kind");
    if(
      src&&
      (
        kind==="subtitles"||
        kind==="captions"||
        src.endsWith(".ass")||
        src.endsWith(".vtt")
      )
    ){
      subtitles.push({
        url:src,
        name:
          $(el).attr("label")||
          "English",
        language:
          $(el).attr("srclang")||
          "en"
      });
    }
  });
  return{
    masterUrl:masterUrl||null,
    subtitles
  };
}
function parseAudioFormat(text){
  const lower=String(text||"").toLowerCase();
  const hasJap=
    lower.includes("japanese")||
    lower.includes("jpn")||
    lower.includes(" ja ");
  const hasEng=
    lower.includes("english")||
    lower.includes("eng")||
    lower.includes(" en ");
  if(hasEng&&hasJap)return"Dual Audio";
  if(hasEng)return"Dub";
  if(hasJap)return"Sub";
  if(lower.includes("multi"))return"Multi-Audio";
  return"Sub";
}
function isDubFormat(format){
  return(
    format==="Dub"||
    format==="Dual Audio"
  );
}
function isDubEnabled(){
  const settings=
    typeof globalThis!=="undefined"&&
    globalThis.SCRAPER_SETTINGS?
      globalThis.SCRAPER_SETTINGS:
      {};
  return settings.enableDub!==false;
}
async function getEpisodeStream(
  episodeUrl,
  animeTitle,
  mappedEp
){
  const cached=cacheGet(
    STREAM_CACHE,
    episodeUrl,
    STREAM_TTL
  );
  if(cached){
    console.log(
      `[AniZone-AS] Episode stream cache hit`
    );
    return cached;
  }
  const epResponse=await fetchWithCookies(
    episodeUrl,
    {},
    8000
  );
  if(
    !epResponse.ok||
    !epResponse.text
  ){
    return null;
  }
  const epHtml=epResponse.text;
  const $ep=cheerio.load(epHtml);
  const streams=[];
  const seen=new Set();
  const defaultStream=
    parseVidstackFromHtml(
      epHtml,
      $ep
    );
  const serverButtons=$ep(
    'button[wire\\:click*="setVideo"],[wire\\:click*="setVideo"]'
  );
  let defaultFormat="Sub";
  let defaultServerName="AniZone";
  if(serverButtons.length){
    const first=serverButtons.first();
    const text=
      first.text()
        .replace(/\s+/g," ")
        .trim();
    defaultFormat=parseAudioFormat(text);
    const match=text.match(
      /^([A-Za-z0-9_-]+)/
    );
    if(match){
      defaultServerName=match[1];
    }
  }
  const addStream=(
    stream,
    name,
    format
  )=>{
    if(
      !stream||
      !stream.masterUrl
    ){
      return;
    }
    if(
      !isDubEnabled()&&
      isDubFormat(format)
    ){
      return;
    }
    if(
      seen.has(stream.masterUrl)
    ){
      return;
    }
    seen.add(stream.masterUrl);
    streams.push({
      name:"AniZone AnimeStream",
      title:
        `${animeTitle} - Episode ${mappedEp} [${name} - ${format}]`,
      url:stream.masterUrl,
      quality:"Multi",
      headers:HEADERS,
      subtitles:
        stream.subtitles||[]
    });
  };
  // AnimeStream's main/default stream.
  addStream(
    defaultStream,
    defaultServerName,
    defaultFormat
  );
  /*
   * Keep the existing provider's multi-server behavior.
   * These are parallel ONLY after the fast episode has
   * already been resolved. They are NOT fallback requests.
   */
  if(
    serverButtons.length>1&&
    epResponse.cookies
  ){
    const csrfToken=
      $ep("script[data-csrf]")
        .attr("data-csrf");
    const snapshotEl=$ep(
      "main > div[wire\\:snapshot],main > ul[wire\\:snapshot],[wire\\:snapshot]"
    );
    const snapshot=
      snapshotEl.attr("wire:snapshot");
    if(csrfToken&&snapshot){
      const tasks=[];
      for(
        let i=1;
        i<serverButtons.length;
        i++
      ){
        const btn=
          serverButtons.eq(i);
        const click=
          btn.attr("wire:click")||
          "";
        const match=
          click.match(
            /setVideo\((\d+)\)/
          );
        if(!match)continue;
        const text=
          btn.text()
            .replace(/\s+/g," ")
            .trim();
        const format=
          parseAudioFormat(text);
        const nameMatch=
          text.match(
            /^([A-Za-z0-9_-]+)/
          );
        const name=
          nameMatch?
            nameMatch[1]:
            `Server ${i+1}`;
        if(
          !isDubEnabled()&&
          isDubFormat(format)
        ){
          continue;
        }
        const videoId=
          parseInt(match[1],10);
        tasks.push(
          (async()=>{
            try{
              const payload={
                _token:csrfToken,
                components:[
                  {
                    snapshot,
                    updates:{},
                    calls:[
                      {
                        path:"",
                        method:"setVideo",
                        params:[videoId]
                      }
                    ]
                  }
                ]
              };
              const response=
                await fetchWithTimeout(
                  `${MAIN_URL}/livewire/update`,
                  {
                    method:"POST",
                    headers:{
                      "Accept":"*/*",
                      "Content-Type":"application/json",
                      "X-Livewire":"",
                      "X-CSRF-TOKEN":csrfToken,
                      "Origin":MAIN_URL,
                      "Referer":episodeUrl,
                      "Cookie":epResponse.cookies
                    },
                    body:JSON.stringify(payload)
                  },
                  5000
                );
              if(!response.ok)return;
              const data=
                await response.json();
              const html=
                data?.components?.[0]
                  ?.effects?.html;
              if(!html)return;
              const $live=
                cheerio.load(html);
              const stream=
                parseVidstackFromHtml(
                  html,
                  $live
                );
              addStream(
                {
                  masterUrl:
                    stream.masterUrl,
                  subtitles:
                    stream.subtitles?.length?
                      stream.subtitles:
                      defaultStream?.subtitles||[]
                },
                name,
                format
              );
            }catch(e){}
          })()
        );
      }
      await Promise.allSettled(tasks);
    }
  }
  const result={
    streams,
    cookies:epResponse.cookies
  };
  cacheSet(
    STREAM_CACHE,
    episodeUrl,
    result
  );
  return result;
}
/*
 * =========================================================
 * FAST PATH
 * =========================================================
 *
 * This deliberately refuses to guess when TMDB and AniZone
 * season structures are ambiguous.
 *
 * Returning null means:
 *
 * "I don't have enough confidence."
 *
 * It does NOT mean "no streams exist."
 *
 * getStreams() then calls the original provider sequentially.
 */
async function fastPath(
  tmdbId,
  mediaType,
  season,
  episode
){
  const seasonNum=parseInt(season,10)||1;
  const episodeNum=parseInt(episode,10)||1;
  const mappingKey=
    `${tmdbId}:${mediaType}:s${seasonNum}:e${episodeNum}`;
  const cachedMapping=
    cacheGet(
      FAST_MAPPING_CACHE,
      mappingKey,
      MAPPING_TTL
    );
  if(cachedMapping){
    console.log(
      `[AniZone-AS] Fast mapping cache hit`
    );
    const streamResult=
      await getEpisodeStream(
        cachedMapping.episodeUrl,
        cachedMapping.title,
        cachedMapping.episode
      );
    if(
      streamResult?.streams?.length
    ){
      return streamResult.streams;
    }
    /*
     * Do not immediately call the fallback here.
     * Return null so the single fallback decision happens
     * in getStreams().
     */
    return null;
  }
  const info=
    await getTmdbInfo(
      tmdbId,
      mediaType,
      seasonNum
    );
  if(!info)return null;
  const title=
    info.title||
    info.originalTitle||
    "";
  if(!title)return null;
  /*
   * Movies don't have the season-grouping problem.
   */
  if(mediaType==="movie"){
    const queries=[
      title,
      info.originalTitle
    ].filter(Boolean);
    const unique=[
      ...new Set(
        queries.map(x=>x.trim())
      )
    ];
    let cards=[];
    if(unique.length===1){
      cards=
        await searchAniZone(unique[0]);
    }else{
      const results=
        await Promise.all(
          unique.map(q=>
            searchAniZone(q)
          )
        );
      for(const result of results){
        cards.push(...result);
      }
    }
    const base=
      cleanTitle(title);
    const target=
      normalize(base);
    const candidates=
      cards.filter(card=>
        card.titles.some(t=>{
          const n=normalize(t);
          return(
            n===target||
            n.includes(target)||
            target.includes(n)
          );
        })
      );
    /*
     * Don't guess between multiple movies.
     */
    if(candidates.length!==1){
      return null;
    }
    const card=candidates[0];
    const page=
      await getAnimePage(
        card.url.startsWith("http")?
          card.url:
          `${MAIN_URL}${card.url}`
      );
    if(
      !page||
      !page.episodes.length
    ){
      return null;
    }
    const ep=
      page.episodes[0];
    if(!ep)return null;
    const episodeUrl=
      ep.episodeLink.startsWith("http")?
        ep.episodeLink:
        `${MAIN_URL}${ep.episodeLink}`;
    const streamResult=
      await getEpisodeStream(
        episodeUrl,
        title,
        1
      );
    if(
      !streamResult?.streams?.length
    ){
      return null;
    }
    cacheSet(
      FAST_MAPPING_CACHE,
      mappingKey,
      {
        title,
        episode:1,
        episodeUrl
      }
    );
    return streamResult.streams;
  }
  /*
   * TV / anime.
   *
   * Search using the same title-first philosophy as
   * AnimeStream.
   */
  const baseTitle=
    cleanTitle(title);
  const queries=[
    baseTitle,
    info.originalTitle&&
    normalize(info.originalTitle)!==
    normalize(baseTitle)?
      cleanTitle(info.originalTitle):
      null
  ].filter(Boolean);
  const unique=[
    ...new Set(queries)
  ];
  let cards=[];
  if(unique.length===1){
    cards=
      await searchAniZone(
        unique[0]
      );
  }else{
    const results=
      await Promise.all(
        unique.map(q=>
          searchAniZone(q)
        )
      );
    const seen=new Set();
    for(const result of results){
      for(const card of result){
        if(seen.has(card.slug))continue;
        seen.add(card.slug);
        cards.push(card);
      }
    }
  }
  if(!cards.length){
    console.log(
      `[AniZone-AS] Fast search returned no results`
    );
    return null;
  }
  /*
   * CRITICAL:
   *
   * For S2+, explicit season identification is required.
   * If AniZone and TMDB group seasons differently, this
   * deliberately returns null and invokes the original
   * resolver.
   */
  const card=
    selectFastSeasonCard(
      cards,
      baseTitle,
      seasonNum,
      info.seasonName,
      info.originalTitle
    );
  if(!card){
    console.log(
      `[AniZone-AS] Fast season match uncertain; using fallback`
    );
    return null;
  }
  const animeUrl=
    card.url.startsWith("http")?
      card.url:
      `${MAIN_URL}${card.url}`;
  console.log(
    `[AniZone-AS] Fast selected: ${animeUrl}`
  );
  const page=
    await getAnimePage(
      animeUrl
    );
  if(
    !page||
    !page.episodes.length
  ){
    return null;
  }
  /*
   * AniZone's episode list is already ordered the same way
   * AnimeStream consumes it.
   *
   * Since the season identity itself was strictly matched
   * above, episode N is safe here.
   */
  const ep=
    page.episodes[episodeNum-1];
  if(!ep){
    console.log(
      `[AniZone-AS] Fast path episode ${episodeNum} does not exist`
    );
    return null;
  }
  const episodeUrl=
    ep.episodeLink.startsWith("http")?
      ep.episodeLink:
      `${MAIN_URL}${ep.episodeLink}`;
  const streamResult=
    await getEpisodeStream(
      episodeUrl,
      title,
      episodeNum
    );
  if(
    !streamResult?.streams?.length
  ){
    return null;
  }
  cacheSet(
    FAST_MAPPING_CACHE,
    mappingKey,
    {
      title,
      episode:episodeNum,
      episodeUrl
    }
  );
  return streamResult.streams;
}
/*
 * =========================================================
 * PUBLIC PROVIDER
 * =========================================================
 */
async function getStreams(
  tmdbId,
  mediaType="tv",
  season=1,
  episode=1
){
  console.log(
    `[AniZone-AS] Query: TMDB=${tmdbId} ${mediaType} S${season}E${episode}`
  );
  /*
   * IMPORTANT:
   *
   * There is exactly ONE await here before fallback.
   *
   * The original resolver is NOT started alongside fastPath.
   */
  try{
    const fastResult=
      await fastPath(
        tmdbId,
        mediaType,
        season,
        episode
      );
    if(
      Array.isArray(fastResult)&&
      fastResult.length
    ){
      console.log(
        `[AniZone-AS] FAST PATH SUCCESS: ${fastResult.length} streams`
      );
      return fastResult;
    }
  }catch(error){
    console.log(
      `[AniZone-AS] Fast path error: ${error?.message||error}`
    );
  }
  /*
   * =======================================================
   * FALLBACK
   * =======================================================
   *
   * This is the original provider.
   *
   * It is called ONLY NOW.
   *
   * Nothing above is running anymore.
   */
  console.log(
    `[AniZone-AS] FAST PATH FAILED/UNCERTAIN -> ORIGINAL FALLBACK`
  );
  try{
    const fallbackResult=
      await FALLBACK.getStreams(
        tmdbId,
        mediaType,
        season,
        episode
      );
    if(
      Array.isArray(fallbackResult)&&
      fallbackResult.length
    ){
      console.log(
        `[AniZone-AS] ORIGINAL FALLBACK SUCCESS: ${fallbackResult.length} streams`
      );
    }else{
      console.log(
        `[AniZone-AS] ORIGINAL FALLBACK returned no streams`
      );
    }
    return fallbackResult||[];
  }catch(error){
    console.log(
      `[AniZone-AS] ORIGINAL FALLBACK ERROR: ${error?.message||error}`
    );
    return[];
  }
}
function onSettings(){
  return[
    {
      type:"header",
      label:"Preferences"
    },
    {
      type:"toggle",
      key:"enableDub",
      label:"Enable Dub",
      defaultValue:true
    }
  ];
}
module.exports={
  getStreams,
  onSettings
};
