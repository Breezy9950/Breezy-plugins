const { getStore } = require("@netlify/blobs");

const STORE_NAME = "anime-resolution-cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_EPISODES = 50;
const MAX_BODY_BYTES = 100000;

function json(statusCode,body){
  return{
    statusCode,
    headers:{
      "Content-Type":"application/json",
      "Cache-Control":"no-store"
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

  const animeSlug=cleanString(value.animeSlug,200);

  if(!animeSlug||!/^[A-Za-z0-9._~%-]+$/.test(animeSlug))return null;

  const season=parseInt(value.season,10);

  if(!Number.isFinite(season)||season<1)return null;

  const sourceEpisodes=value.episodes;
  if(!sourceEpisodes||typeof sourceEpisodes!=="object")return null;

  const episodes={};
  let count=0;

  for(const [key,raw] of Object.entries(sourceEpisodes)){
    if(count>=MAX_EPISODES)break;

    const episode=cleanEpisode(raw);
    if(!episode)continue;

    const epNum=parseInt(key,10);
    if(!Number.isFinite(epNum)||epNum!==episode.episode)continue;

    episodes[String(epNum)]=episode;
    count++;
  }

  if(!Object.keys(episodes).length)return null;

  return{
    version:1,
    animeSlug,
    season,
    episodes,
    createdAt:Date.now()
  };
}

function getSecret(event){
  const headers=event&&event.headers||{};
  return headers["x-anime-cache-secret"]||
    headers["X-Anime-Cache-Secret"]||
    "";
}

function authorized(event){
  const secret=process.env.ANIME_CACHE_SECRET;

  if(!secret)return false;

  return getSecret(event)===secret;
}

exports.handler=async(event)=>{
  try{
    const method=(event.httpMethod||"GET").toUpperCase();

    if(method==="OPTIONS"){
      return{
        statusCode:204,
        headers:{
          "Access-Control-Allow-Origin":"*",
          "Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS",
          "Access-Control-Allow-Headers":"Content-Type,X-Anime-Cache-Secret"
        },
        body:""
      };
    }

    const store=getStore({
      name:STORE_NAME
    });

    if(method==="GET"){
      const key=event.queryStringParameters&&event.queryStringParameters.key;

      if(!validKey(key))return json(400,{error:"Invalid cache key"});

      const cached=await store.get(key,{type:"json"});

      if(!cached){
        return json(404,{
          hit:false
        });
      }

      if(!cached.createdAt||Date.now()-cached.createdAt>=CACHE_TTL_MS){
        try{
          await store.delete(key);
        }catch(_){}

        return json(404,{
          hit:false,
          expired:true
        });
      }

      return json(200,{
        hit:true,
        data:cached
      });
    }

    if(method==="POST"){
      if(!authorized(event)){
        return json(401,{
          error:"Unauthorized"
        });
      }

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

      await store.setJSON(key,value,{
        expiration:Math.floor((Date.now()+CACHE_TTL_MS)/1000)
      });

      return json(200,{
        ok:true,
        key,
        expiresIn:CACHE_TTL_MS
      });
    }

    if(method==="DELETE"){
      if(!authorized(event)){
        return json(401,{
          error:"Unauthorized"
        });
      }

      const key=event.queryStringParameters&&event.queryStringParameters.key;

      if(!validKey(key)){
        return json(400,{
          error:"Invalid cache key"
        });
      }

      await store.delete(key);

      return json(200,{
        ok:true,
        deleted:key
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
