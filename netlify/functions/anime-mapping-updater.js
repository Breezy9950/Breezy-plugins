import{getStore}from"@netlify/blobs";

const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_anibridge_index";
const SOURCE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const MAX_SOURCE_BYTES=50*1024*1024;
const MAX_INDEX_BYTES=5*1024*1024;

export const config={schedule:"@daily"};

function parseRange(value,allowMultiple=true){
  if(typeof value!=="string")return null;
  const raw=value.trim();
  if(!raw)return null;
  const parts=raw.split("|");
  if(parts.length>2)return null;
  const rangePart=parts[0].trim();
  const ratioPart=parts.length===2?parts[1].trim():"";
  let ratio=1;
  if(ratioPart){
    ratio=Number(ratioPart);
    if(!Number.isFinite(ratio)||ratio===0)return null;
  }
  const pieces=rangePart.split(",").map(v=>v.trim()).filter(Boolean);
  if(!pieces.length)return null;
  if(!allowMultiple&&pieces.length!==1)return null;
  const ranges=[];
  for(const piece of pieces){
    const match=piece.match(/^(\d+)(?:-(\d*))?$/);
    if(!match)return null;
    const start=Number(match[1]);
    const end=match[2]===undefined?start:match[2]===""?Infinity:Number(match[2]);
    if(!Number.isInteger(start)||start<1)return null;
    if(end!==Infinity&&(!Number.isInteger(end)||end<start))return null;
    ranges.push({start,end});
  }
  return{ranges,ratio};
}

function parseDescriptor(value){
  if(typeof value!=="string")return null;
  const match=value.match(/^([a-z_]+):([^:]+)(?::(s\d+))?$/);
  if(!match)return null;
  const provider=match[1];
  const id=match[2];
  const season=match[3]?Number(match[3].slice(1)):null;
  if(!id)return null;
  if(season!==null&&(!Number.isInteger(season)||season<0))return null;
  return{provider,id,season};
}

function cleanMappingRanges(ranges){
  if(!ranges||typeof ranges!=="object"||Array.isArray(ranges))return[];
  const output=[];
  for(const[sourceRange,targetRange]of Object.entries(ranges)){
    const source=parseRange(sourceRange,false);
    const target=parseRange(targetRange,true);
    if(!source||!target)continue;
    if(source.ranges.length!==1)continue;
    output.push({
      source:sourceRange,
      target:targetRange
    });
  }
  return output;
}

function buildIndex(data){
  const index={
    version:2,
    source:"anibridge",
    updatedAt:Date.now(),
    entries:{}
  };
  if(!data||typeof data!=="object"||Array.isArray(data))return index;
  for(const[sourceDescriptor,targets]of Object.entries(data)){
    const source=parseDescriptor(sourceDescriptor);
    if(!source)continue;
    if(source.provider!=="tmdb_show")continue;
    if(source.season===null)continue;
    if(!targets||typeof targets!=="object"||Array.isArray(targets))continue;
    const mappings={};
    for(const[targetDescriptor,ranges]of Object.entries(targets)){
      const target=parseDescriptor(targetDescriptor);
      if(!target)continue;
      if(target.provider!=="anilist"&&target.provider!=="mal")continue;
      if(target.season!==null)continue;
      const cleaned=cleanMappingRanges(ranges);
      if(cleaned.length)mappings[targetDescriptor]=cleaned;
    }
    if(Object.keys(mappings).length){
      index.entries[sourceDescriptor]={
        tmdbId:source.id,
        season:source.season,
        mappings
      };
    }
  }
  return index;
}

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

export default async()=>{
  const started=Date.now();
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
    const contentLength=response.headers.get("content-length");
    if(contentLength&&Number.isFinite(Number(contentLength))&&Number(contentLength)>MAX_SOURCE_BYTES){
      throw new Error(`AniBridge dataset exceeds ${MAX_SOURCE_BYTES} byte safety limit`);
    }
    const text=await response.text();
    const sourceBytes=Buffer.byteLength(text,"utf8");
    if(sourceBytes>MAX_SOURCE_BYTES){
      throw new Error(`AniBridge dataset exceeds ${MAX_SOURCE_BYTES} byte safety limit`);
    }
    let data;
    try{
      data=JSON.parse(text);
    }catch(error){
      throw new Error(`Invalid AniBridge JSON: ${error.message}`);
    }
    if(!data||typeof data!=="object"||Array.isArray(data)){
      throw new Error("Invalid AniBridge dataset");
    }
    const index=buildIndex(data);
    const entryCount=Object.keys(index.entries).length;
    const indexBytes=Buffer.byteLength(JSON.stringify(index),"utf8");
    if(!entryCount){
      throw new Error("AniBridge dataset produced an empty TMDB season index");
    }
    if(indexBytes>MAX_INDEX_BYTES){
      throw new Error(`Generated AniBridge index exceeds ${MAX_INDEX_BYTES} byte safety limit`);
    }
    const store=getStore({
      name:STORE_NAME
    });
    await store.setJSON(INDEX_KEY,index);
    const elapsedMs=Date.now()-started;
    console.log(
      `[ANIBRIDGE] Updated ${entryCount} TMDB season mappings `+
      `source=${sourceBytes}B index=${indexBytes}B `+
      `time=${elapsedMs}ms`
    );
    return json(200,{
      ok:true,
      source:"anibridge",
      entries:entryCount,
      sourceBytes,
      indexBytes,
      updatedAt:index.updatedAt,
      elapsedMs
    });
  }catch(error){
    console.error("[ANIBRIDGE]",error);
    return json(500,{
      ok:false,
      error:error&&error.message
        ?error.message
        :"Unknown AniBridge updater error"
    });
  }
};
