const{getStore}=require("@netlify/blobs");

const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_anibridge_index";
const SOURCE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const MAX_BYTES=25*1024*1024;

export const config={schedule:"@daily"};

function json(statusCode,body){
  return{
    statusCode,
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
    body:JSON.stringify(body)
  };
}

function parseRange(value){
  if(typeof value!=="string")return null;
  const clean=value.split("|")[0];
  const parts=clean.split(",");
  const ranges=[];
  for(const part of parts){
    const m=part.trim().match(/^(\d+)(?:-(\d*))?$/);
    if(!m)continue;
    const start=parseInt(m[1],10);
    let end=m[2]===""?Infinity:m[2]?parseInt(m[2],10):start;
    if(!Number.isFinite(start)||start<1)continue;
    if(end!==Infinity&&(end<start||end<1))continue;
    ranges.push([start,end]);
  }
  return ranges.length?ranges:null;
}

function mapEpisode(sourceEpisode,sourceRange,targetRange){
  const source=parseRange(sourceRange);
  const target=parseRange(targetRange);
  if(!source||!target)return null;

  for(const[sStart,sEnd]of source){
    if(sourceEpisode<sStart||sourceEpisode>sEnd)continue;

    const offset=sourceEpisode-sStart;
    let targetEpisode;

    if(target.length===1){
      const[tStart,tEnd]=target[0];
      if(tEnd===Infinity){
        targetEpisode=tStart+offset;
      }else{
        const count=tEnd-tStart+1;
        targetEpisode=tStart+Math.min(offset,count-1);
      }
    }else{
      let remaining=offset;
      for(const[tStart,tEnd]of target){
        const length=tEnd===Infinity?Infinity:tEnd-tStart+1;
        if(remaining<length){
          targetEpisode=tStart+remaining;
          break;
        }
        remaining-=length;
      }
    }

    if(Number.isFinite(targetEpisode))return targetEpisode;
  }

  return null;
}

function descriptorInfo(descriptor){
  if(typeof descriptor!=="string")return null;
  const m=descriptor.match(/^(anilist|mal|tmdb_show|imdb_show|tvdb_show):([^:]+)(?::(s\d+))?$/);
  if(!m)return null;
  return{
    provider:m[1],
    id:m[2],
    season:m[3]?parseInt(m[3].slice(1),10):null
  };
}

function buildIndex(data){
  const index={version:1,updatedAt:Date.now(),entries:{}};

  for(const[sourceDescriptor,targets]of Object.entries(data||{})){
    if(!sourceDescriptor.startsWith("tmdb_show:"))continue;

    const sourceInfo=descriptorInfo(sourceDescriptor);
    if(!sourceInfo||sourceInfo.season===null)continue;
    if(!targets||typeof targets!=="object")continue;

    const entry={
      tmdbId:sourceInfo.id,
      season:sourceInfo.season,
      mappings:{}
    };

    for(const[targetDescriptor,ranges]of Object.entries(targets)){
      const targetInfo=descriptorInfo(targetDescriptor);
      if(!targetInfo)continue;
      if(targetInfo.provider!=="anilist"&&targetInfo.provider!=="mal")continue;
      if(!ranges||typeof ranges!=="object")continue;

      const mapped=[];

      for(const[sourceRange,targetRange]of Object.entries(ranges)){
        const parsedSource=parseRange(sourceRange);
        if(!parsedSource)continue;

        let start=parsedSource[0][0];
        let end=parsedSource[0][1];

        if(end===Infinity)end=start+10000;

        for(let episode=start;episode<=end;episode++){
          const targetEpisode=mapEpisode(episode,sourceRange,targetRange);
          if(!targetEpisode)continue;

          mapped.push({
            from:episode,
            to:targetEpisode
          });
        }
      }

      if(mapped.length){
        entry.mappings[targetDescriptor]=mapped;
      }
    }

    if(Object.keys(entry.mappings).length){
      index.entries[sourceDescriptor]=entry;
    }
  }

  return index;
}

export default async()=>{
  try{
    const response=await fetch(SOURCE_URL,{
     headers:{
        "User-Agent":"Breezy-Plugins-AniZone/1.0",
        "Accept":"application/json"
      }
    });

    if(!response.ok){
      throw new Error(`AniBridge download failed: HTTP ${response.status}`);
    }

    const text=await response.text();

    if(Buffer.byteLength(text,"utf8")>MAX_BYTES){
      throw new Error("AniBridge mapping file exceeds safety limit");
    }

    const data=JSON.parse(text);
    const index=buildIndex(data);

    const store=getStore({name:STORE_NAME});

    await store.setJSON(INDEX_KEY,index);

    console.log(
      `[ANIBRIDGE] Updated ${Object.keys(index.entries).length} TMDB season mappings`
    );

    return json(200,{
      ok:true,
      entries:Object.keys(index.entries).length,
      updatedAt:index.updatedAt
    });
  }catch(error){
    console.error("[ANIBRIDGE]",error);
    return json(500,{
      ok:false,
      error:error.message
    });
  }
};
