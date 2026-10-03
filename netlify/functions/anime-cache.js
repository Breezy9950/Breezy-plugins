const{getStore}=require("@netlify/blobs");

const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_cache_index";
const TMDB_INDEX_KEY="_tmdb_cache_index";
const MAX_CACHE_BYTES=20*1024*1024;
const MAX_SEASONS=5;
const MAX_EPISODES=300;
const MAX_BODY_BYTES=200000;
const VERSION=3;

function store(){
  return getStore({
    name:STORE_NAME,
    siteID:process.env.NETLIFY_SITE_ID,
    token:process.env.NETLIFY_AUTH_TOKEN
  });
}

function json(status,data){
  return{
    statusCode:status,
    headers:{
      "Content-Type":"application/json",
      "Cache-Control":"no-store"
    },
    body:JSON.stringify(data)
  };
}

function cleanString(v,max=500){
  return typeof v==="string"?v.slice(0,max):"";
}

function cleanNumber(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

function cleanTitles(v){
  if(!Array.isArray(v))return[];
  return v.filter(x=>typeof x==="string").map(x=>x.slice(0,300)).slice(0,30);
}

function now(){
  return Date.now();
}

function titleKey(malId){
  return"mal:"+String(malId);
}

function tmdbKey(tmdbId,season,episode){
  return"tmdb:"+String(tmdbId)+":"+String(season)+":"+String(episode);
}

function emptyIndex(){
  return{version:1,updatedAt:now(),items:{}};
}

function emptyTmdbIndex(){
  return{version:1,updatedAt:now(),items:{}};
}

async function readJson(st,key,fallback){
  try{
    const v=await st.get(key,{type:"json"});
    return v||fallback;
  }catch(e){
    console.log(`[ANIME CACHE] read failed ${key}: ${e.message}`);
    return fallback;
  }
}

async function writeJson(st,key,value){
  await st.setJSON(key,value);
}

function normalizeEpisode(ep,season,malId){
  if(!ep||typeof ep!=="object")return null;
  const episode=cleanNumber(ep.episode);
  const episodeLink=cleanString(ep.episodeLink,2000);
  if(!episode||episode<1||episode>100000||!episodeLink)return null;
  return{
    tmdbEpisode:cleanNumber(ep.tmdbEpisode)||episode,
    malEpisode:cleanNumber(ep.malEpisode)||episode,
    anizoneEpisode:cleanNumber(ep.anizoneEpisode)||episode,
    episodeLink,
    id:cleanString(ep.id,500),
    imdb_id:cleanString(ep.imdb_id,100),
    season:cleanNumber(ep.season)||season,
    episode,
    mal_id:cleanString(ep.mal_id||malId,100),
    anime_title:cleanString(ep.anime_title,500),
    titles:cleanTitles(ep.titles),
    episodeTitle:cleanString(ep.episodeTitle,500),
    thumbnail:cleanString(ep.thumbnail,2000),
    isFiller:!!ep.isFiller,
    hasDub:!!ep.hasDub
  };
}

function normalizeSeason(seasonData,season,malId){
  if(!seasonData||typeof seasonData!=="object")return null;
  const episodes={};
  const source=seasonData.episodes&&typeof seasonData.episodes==="object"?seasonData.episodes:{};
  for(const k of Object.keys(source)){
    const ep=normalizeEpisode(source[k],season,malId);
    if(ep)episodes[String(ep.tmdbEpisode||ep.episode)]=ep;
    if(Object.keys(episodes).length>=MAX_EPISODES)break;
  }
  return{
    season,
    tmdbSeason:cleanNumber(seasonData.tmdbSeason)||season,
    malSeason:cleanNumber(seasonData.malSeason)||season,
    animeSlug:cleanString(seasonData.animeSlug,500),
    animeUrl:cleanString(seasonData.animeUrl,2000),
    episodeCount:cleanNumber(seasonData.episodeCount)||Object.keys(episodes).length,
    episodes,
    createdAt:cleanNumber(seasonData.createdAt)||now(),
    lastUsed:cleanNumber(seasonData.lastUsed)||now(),
    updatedAt:now()
  };
}

function normalizeRecord(input){
  const malId=cleanString(input.malId,100);
  if(!malId)return null;
  const seasons={};
  const source=input.seasons&&typeof input.seasons==="object"?input.seasons:{};
  for(const k of Object.keys(source)){
    const season=Number(k);
    if(!Number.isInteger(season)||season<0||season>1000)continue;
    const s=normalizeSeason(source[k],season,malId);
    if(s)seasons[String(season)]=s;
  }
  return{
    version:VERSION,
    malId,
    title:cleanString(input.title,500),
    titles:cleanTitles(input.titles),
    tmdbId:cleanString(input.tmdbId,100),
    tvdbId:cleanString(input.tvdbId,100),
    tmdbIds:Array.isArray(input.tmdbIds)?input.tmdbIds.map(x=>cleanString(x,100)).filter(Boolean).slice(0,30):[],
    tvdbIds:Array.isArray(input.tvdbIds)?input.tvdbIds.map(x=>cleanString(x,100)).filter(Boolean).slice(0,30):[],
    seasons,
    createdAt:cleanNumber(input.createdAt)||now(),
    updatedAt:now(),
    lastUsed:now()
  };
}

function touchSeason(record,season){
  const s=record.seasons&&record.seasons[String(season)];
  if(s){
    s.lastUsed=now();
    s.updatedAt=now();
  }
  record.lastUsed=now();
  record.updatedAt=now();
}

function enforceSeasonLimit(record){
  const keys=Object.keys(record.seasons||{});
  if(keys.length<=MAX_SEASONS)return;
  keys.sort((a,b)=>{
    const aa=Number(record.seasons[a].lastUsed||record.seasons[a].updatedAt||0);
    const bb=Number(record.seasons[b].lastUsed||record.seasons[b].updatedAt||0);
    return bb-aa;
  });
  const keep=keys.slice(0,MAX_SEASONS);
  const allowed=new Set(keep);
  for(const k of Object.keys(record.seasons)){
    if(!allowed.has(k))delete record.seasons[k];
  }
}

function mergeRecord(oldRecord,newRecord){
  if(!oldRecord)return newRecord;
  const merged={
    ...oldRecord,
    ...newRecord,
    version:VERSION,
    malId:newRecord.malId||oldRecord.malId,
    title:newRecord.title||oldRecord.title,
    titles:newRecord.titles?.length?newRecord.titles:oldRecord.titles||[],
    tmdbId:newRecord.tmdbId||oldRecord.tmdbId||"",
    tvdbId:newRecord.tvdbId||oldRecord.tvdbId||"",
    tmdbIds:[...(oldRecord.tmdbIds||[]),...(newRecord.tmdbIds||[])],
    tvdbIds:[...(oldRecord.tvdbIds||[]),...(newRecord.tvdbIds||[])],
    seasons:{...(oldRecord.seasons||{})},
    createdAt:oldRecord.createdAt||now(),
    updatedAt:now(),
    lastUsed:now()
  };
  merged.tmdbIds=[...new Set(merged.tmdbIds.filter(Boolean))].slice(0,30);
  merged.tvdbIds=[...new Set(merged.tvdbIds.filter(Boolean))].slice(0,30);
  for(const k of Object.keys(newRecord.seasons||{})){
    const oldSeason=merged.seasons[k];
    const newSeason=newRecord.seasons[k];
    if(!oldSeason){
      merged.seasons[k]=newSeason;
    }else{
      merged.seasons[k]={
        ...oldSeason,
        ...newSeason,
        episodes:{
          ...(oldSeason.episodes||{}),
          ...(newSeason.episodes||{})
        },
        lastUsed:now(),
        updatedAt:now()
      };
    }
  }
  enforceSeasonLimit(merged);
  return merged;
}

async function recordSize(st,key,record){
  try{
    const raw=JSON.stringify(record);
    return Buffer.byteLength(raw,"utf8");
  }catch(e){
    return 0;
  }
}

async function deleteRecord(st,index,tmdbIndex,malId){
  const key=titleKey(malId);
  const record=index.items[key];
  if(!record)return;
  delete index.items[key];
  await st.delete(key);
  for(const k of Object.keys(tmdbIndex.items||{})){
    if(tmdbIndex.items[k]===malId)delete tmdbIndex.items[k];
  }
}

async function deleteOldestTitles(st,index,tmdbIndex,requiredBytes){
  while(true){
    const entries=Object.entries(index.items||{});
    if(!entries.length)break;

    let total=0;
    for(const[,meta]of entries)total+=Number(meta.size||0);

    if(total+requiredBytes<=MAX_CACHE_BYTES)break;

    entries.sort((a,b)=>{
      const aa=Number(a[1].lastUsed||0);
      const bb=Number(b[1].lastUsed||0);
      return aa-bb;
    });

    const victims=entries.slice(0,2);

    for(const[key]of victims){
      const malId=key.startsWith("mal:")?key.slice(4):key;
      console.log(`[ANIME CACHE] evicting title MAL=${malId}`);
      await deleteRecord(st,index,tmdbIndex,malId);
    }
  }
}

function buildTmdbMappings(record){
  const result=[];
  const baseTmdbIds=[];
  if(record.tmdbId)baseTmdbIds.push(record.tmdbId);
  for(const x of record.tmdbIds||[])if(x&&!baseTmdbIds.includes(x))baseTmdbIds.push(x);

  for(const tmdbId of baseTmdbIds){
    for(const seasonKey of Object.keys(record.seasons||{})){
      const season=record.seasons[seasonKey];
      for(const epKey of Object.keys(season.episodes||{})){
        const ep=season.episodes[epKey];
        const tmdbEpisode=Number(ep.tmdbEpisode||ep.episode);
        if(!Number.isInteger(tmdbEpisode)||tmdbEpisode<1)continue;
        result.push({
          key:tmdbKey(tmdbId,Number(season.tmdbSeason||seasonKey),tmdbEpisode),
          malId:record.malId
        });
      }
    }
  }
  return result;
}

async function saveRecord(st,record,index,tmdbIndex){
  enforceSeasonLimit(record);

  const key=titleKey(record.malId);
  const bytes=await recordSize(st,key,record);

  if(bytes>MAX_CACHE_BYTES){
    console.log(`[ANIME CACHE] record too large MAL=${record.malId} bytes=${bytes}`);
    return false;
  }

  await deleteOldestTitles(st,index,tmdbIndex,bytes);

  await st.setJSON(key,record);

  index.items[key]={
    malId:record.malId,
    size:bytes,
    lastUsed:record.lastUsed||now(),
    updatedAt:record.updatedAt||now()
  };

  for(const mapping of buildTmdbMappings(record)){
    tmdbIndex.items[mapping.key]=mapping.malId;
  }

  index.updatedAt=now();
  tmdbIndex.updatedAt=now();

  await writeJson(st,INDEX_KEY,index);
  await writeJson(st,TMDB_INDEX_KEY,tmdbIndex);

  console.log(`[ANIME CACHE] saved MAL=${record.malId} bytes=${bytes} seasons=${Object.keys(record.seasons||{}).join(",")}`);

  return true;
}

async function getByMal(st,index,malId){
  const key=titleKey(malId);
  const record=await readJson(st,key,null);
  if(!record)return null;

  if(index.items[key]){
    index.items[key].lastUsed=now();
    index.updatedAt=now();
    await writeJson(st,INDEX_KEY,index).catch(()=>{});
  }

  record.lastUsed=now();
  return record;
}

async function getByTmdb(st,index,tmdbIndex,tmdbId,season,episode){
  const key=tmdbKey(tmdbId,season,episode);
  const malId=tmdbIndex.items&&tmdbIndex.items[key];
  if(!malId)return null;

  const record=await getByMal(st,index,malId);
  if(!record)return null;

  const seasonData=record.seasons&&record.seasons[String(season)];
  if(!seasonData)return null;

  const cachedEpisode=
    seasonData.episodes&&(
      seasonData.episodes[String(episode)]||
      Object.values(seasonData.episodes).find(x=>Number(x.tmdbEpisode)===Number(episode))
    );

  if(!cachedEpisode)return null;

  touchSeason(record,season);

  return{
    record,
    season:seasonData,
    episode:cachedEpisode
  };
}

function validateRequest(body){
  if(!body||typeof body!=="object")return"Invalid body";
  if(!body.malId&&!body.tmdbId)return"malId or tmdbId required";
  return null;
}

exports.handler=async(event)=>{
  try{
    const st=store();
    const index=await readJson(st,INDEX_KEY,emptyIndex());
    const tmdbIndex=await readJson(st,TMDB_INDEX_KEY,emptyTmdbIndex());

    if(event.httpMethod==="GET"){
      const q=event.queryStringParameters||{};
      const malId=cleanString(q.mal_id||q.malId,100);
      const tmdbId=cleanString(q.tmdb_id||q.tmdbId,100);
      const season=cleanNumber(q.season);
      const episode=cleanNumber(q.episode);

      if(malId){
        const record=await getByMal(st,index,malId);
        if(!record)return json(200,{hit:false});
        return json(200,{hit:true,type:"mal",data:record});
      }

      if(tmdbId&&season!=null&&episode!=null){
        const result=await getByTmdb(st,index,tmdbIndex,tmdbId,season,episode);
        if(!result)return json(200,{hit:false});
        return json(200,{
          hit:true,
          type:"tmdb",
          data:{
            malId:result.record.malId,
            mal_id:result.record.malId,
            tmdbId,
            tmdb_id:tmdbId,
            tmdbSeason:season,
            tmdbEpisode:episode,
            tvdbId:result.record.tvdbId||"",
            malEpisode:result.episode.malEpisode,
            anizoneEpisode:result.episode.anizoneEpisode,
            episodeLink:result.episode.episodeLink,
            animeTitle:result.record.title,
            titles:result.record.titles||[],
            season:result.season
          }
        });
      }

      return json(400,{error:"mal_id or tmdb_id+season+episode required"});
    }

    if(event.httpMethod!=="POST"){
      return json(405,{error:"Method not allowed"});
    }

    if(!event.body)return json(400,{error:"Missing body"});

    if(Buffer.byteLength(event.body,"utf8")>MAX_BODY_BYTES){
      return json(413,{error:"Request too large"});
    }

    let body;
    try{
      body=JSON.parse(event.body);
    }catch(e){
      return json(400,{error:"Invalid JSON"});
    }

    const validation=validateRequest(body);
    if(validation)return json(400,{error:validation});

    const malId=cleanString(body.malId||body.mal_id,100);
    if(!malId)return json(400,{error:"malId required for saving"});

    const key=titleKey(malId);
    const existing=await readJson(st,key,null);

    const incoming=normalizeRecord({
      ...body,
      malId
    });

    if(!incoming)return json(400,{error:"Invalid MAL ID"});

    const record=mergeRecord(existing,incoming);

    const saved=await saveRecord(st,record,index,tmdbIndex);

    if(!saved){
      return json(507,{saved:false,error:"Record exceeds cache capacity"});
    }

    return json(200,{
      saved:true,
      malId:record.malId,
      seasons:Object.keys(record.seasons||{}).map(Number).sort((a,b)=>a-b),
      seasonCount:Object.keys(record.seasons||{}).length
    });
  }catch(e){
    console.error(`[ANIME CACHE] fatal: ${e.stack||e.message}`);
    return json(500,{error:"Internal cache error"});
  }
};
