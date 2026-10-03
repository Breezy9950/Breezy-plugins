const{getStore}=require("@netlify/blobs");

const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_cache_index";
const MAX_CACHE_BYTES=5*1024*1024;
const MAX_EPISODES=50;
const MAX_BODY_BYTES=100000;

function json(statusCode,body){
  return{
    statusCode,
    headers:{
      "Content-Type":"application/json",
      "Cache-Control":"no-store",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type"
    },
    body:JSON.stringify(body)
  };
}

function validKey(key){
  return typeof key==="string"&&/^[A-Za-z0-9_-]+:s\d+$/.test(key)&&key.length<=100;
}

function cleanString(value,max=500){
  if(typeof value!=="string")return"";
  return value.slice(0,max);
}

function cleanEpisode(value){
  if(!value||typeof value!=="object")return null;

  const episode=parseInt(value.episode,10);
  const malEpisode=parseInt(value.mal_episode,10);
  const season=parseInt(value.season,10);

  if(!Number.isFinite(episode)||!Number.isFinite(malEpisode)||!Number.isFinite(season))return null;
  if(episode<1||malEpisode<1||season<1)return null;

  return{
    id:cleanString(value.id,150),
    imdb_id:cleanString(value.imdb_id,30),
    season,
    episode,
    mal_id:cleanString(String(value.mal_id||""),30),
    mal_episode:malEpisode,
    anime_title:cleanString(value.anime_title,500),
    titles:Array.isArray(value.titles)
      ?value.titles.filter(v=>typeof v==="string").slice(0,30).map(v=>v.slice(0,300))
      :[],
    air_date:cleanString(value.air_date,30)
  };
}

function cleanValue(value){
  if(!value||typeof value!=="object")return null;

  const animeSlug=cleanString(value.animeSlug,300);
  const season=parseInt(value.season,10);

  if(!animeSlug||!Number.isFinite(season)||season<1)return null;

  const sourceEpisodes=value.episodes;

  if(!sourceEpisodes||typeof sourceEpisodes!=="object")return null;

  const episodes={};

  for(const[key,raw]of Object.entries(sourceEpisodes)){
    if(Object.keys(episodes).length>=MAX_EPISODES)break;

    const episode=cleanEpisode(raw);

    if(!episode)continue;

    const epNum=parseInt(key,10);

    if(!Number.isFinite(epNum)||epNum!==episode.episode)continue;

    episodes[String(epNum)]=episode;
  }

  if(!Object.keys(episodes).length)return null;

  return{
    version:1,
    animeSlug,
    season,
    episodes
  };
}

function byteSize(value){
  return Buffer.byteLength(JSON.stringify(value),"utf8");
}

async function getIndex(store){
  try{
    const index=await store.get(INDEX_KEY,{type:"json"});

    if(index&&typeof index==="object"&&index.entries&&typeof index.entries==="object"){
      return{
        totalBytes:Number(index.totalBytes)||0,
        entries:index.entries
      };
    }
  }catch(_){}

  return{
    totalBytes:0,
    entries:{}
  };
}

async function saveIndex(store,index){
  await store.setJSON(INDEX_KEY,index);
}

async function removeUntilFits(store,index,key,newSize){
  while(index.totalBytes+newSize>MAX_CACHE_BYTES){
    const candidates=Object.keys(index.entries).filter(k=>k!==key);

    if(!candidates.length)return false;

    candidates.sort((a,b)=>{
      const aTime=Number(index.entries[a]&&index.entries[a].lastUsed)||0;
      const bTime=Number(index.entries[b]&&index.entries[b].lastUsed)||0;
      return aTime-bTime;
    });

    const oldest=candidates[0];
    const oldSize=Number(index.entries[oldest]&&index.entries[oldest].size)||0;

    try{
      await store.delete(oldest);
    }catch(_){}

    delete index.entries[oldest];
    index.totalBytes=Math.max(0,index.totalBytes-oldSize);
  }

  return true;
}

exports.handler=async event=>{
  try{
    const method=(event.httpMethod||"GET").toUpperCase();

    if(method==="OPTIONS"){
      return{
        statusCode:204,
        headers:{
          "Access-Control-Allow-Origin":"*",
          "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
          "Access-Control-Allow-Headers":"Content-Type"
        },
        body:""
      };
    }

    const store=getStore({
      name:STORE_NAME
    });

    if(method==="GET"){
      const key=event.queryStringParameters&&event.queryStringParameters.key;

      if(!validKey(key)){
        return json(400,{
          error:"Invalid cache key"
        });
      }

      const cached=await store.get(key,{type:"json"});

      if(!cached){
        return json(404,{
          hit:false
        });
      }

      const index=await getIndex(store);

      if(index.entries[key]){
        index.entries[key].lastUsed=Date.now();
        saveIndex(store,index).catch(()=>{});
      }

      return json(200,{
        hit:true,
        data:cached
      });
    }

    if(method==="POST"){
      const rawBody=event.body||"";

      if(Buffer.byteLength(rawBody,"utf8")>MAX_BODY_BYTES){
        return json(413,{
          error:"Payload too large"
        });
      }

      let body;

      try{
        body=JSON.parse(rawBody);
      }catch(_){
        return json(400,{
          error:"Invalid JSON"
        });
      }

      const key=body&&body.key;
      const value=cleanValue(body&&body.data);

      if(!validKey(key)){
        return json(400,{
          error:"Invalid cache key"
        });
      }

      if(!value){
        return json(400,{
          error:"Invalid cache data"
        });
      }

      const size=byteSize(value);

      if(size>MAX_CACHE_BYTES){
        return json(413,{
          error:"Cache entry exceeds 5 MB cache limit"
        });
      }

      const index=await getIndex(store);
      const previous=index.entries[key];

      if(previous){
        index.totalBytes=Math.max(
          0,
          index.totalBytes-(Number(previous.size)||0)
        );
        delete index.entries[key];
      }

      const fits=await removeUntilFits(
        store,
        index,
        key,
        size
      );

      if(!fits){
        return json(507,{
          error:"Cache capacity reached"
        });
      }

      await store.setJSON(key,value);

      index.entries[key]={
        size,
        createdAt:previous
          ?Number(previous.createdAt)||Date.now()
          :Date.now(),
        lastUsed:Date.now()
      };

      index.totalBytes+=size;

      await saveIndex(store,index);

      return json(200,{
        ok:true,
        key,
        size,
        totalBytes:index.totalBytes,
        maxBytes:MAX_CACHE_BYTES
      });
    }

    return json(405,{
      error:"Method not allowed"
    });
  }catch(error){
    console.error("[ANIME CACHE]",error);

    return json(500,{
      error:"Cache service error"
    });
  }
};
