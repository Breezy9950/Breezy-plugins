import{getStore}from"@netlify/blobs";

const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_anibridge_index";
const SOURCE_URL="https://github.com/anibridge/anibridge-mappings/releases/download/v3/mappings.min.json";
const MAX_SOURCE_BYTES=50*1024*1024;
const MAX_INDEX_BYTES=5*1024*1024;

export const config={schedule:"@daily"};

function log(message){
  console.log(`[ANIBRIDGE] ${message}`);
}

function parseRange(value,allowMultiple=true){
  if(typeof value!=="string")return null;

  const raw=value.trim();

  if(!raw)return null;

  const parts=raw.split("|");

  if(parts.length>2)return null;

  const rangePart=parts[0].trim();
  const ratioPart=
    parts.length===2
      ?parts[1].trim()
      :"";

  let ratio=1;

  if(ratioPart){
    ratio=Number(ratioPart);

    if(
      !Number.isFinite(ratio)||
      ratio===0
    )
      return null;
  }

  const pieces=
    rangePart
      .split(",")
      .map(v=>v.trim())
      .filter(Boolean);

  if(!pieces.length)return null;

  if(
    !allowMultiple&&
    pieces.length!==1
  )
    return null;

  const ranges=[];

  for(const piece of pieces){
    const match=
      piece.match(/^(\d+)(?:-(\d*))?$/);

    if(!match)return null;

    const start=
      Number(match[1]);

    const end=
      match[2]===undefined
        ?start
        :match[2]===""
          ?Infinity
          :Number(match[2]);

    if(
      !Number.isInteger(start)||
      start<1
    )
      return null;

    if(
      end!==Infinity&&
      (
        !Number.isInteger(end)||
        end<start
      )
    )
      return null;

    ranges.push({
      start,
      end
    });
  }

  return{
    ranges,
    ratio
  };
}

function parseDescriptor(value){
  if(typeof value!=="string")
    return null;

  const match=
    value.match(
      /^([a-z_]+):([^:]+)(?::(s\d+))?$/
    );

  if(!match)
    return null;

  const provider=match[1];
  const id=match[2];

  const season=
    match[3]
      ?Number(match[3].slice(1))
      :null;

  if(!id)
    return null;

  if(
    season!==null&&
    (
      !Number.isInteger(season)||
      season<0
    )
  )
    return null;

  return{
    provider,
    id,
    season
  };
}

function cleanMappingRanges(ranges){
  if(
    !ranges||
    typeof ranges!=="object"||
    Array.isArray(ranges)
  )
    return[];

  const output=[];

  for(
    const[
      sourceRange,
      targetRange
    ] of Object.entries(ranges)
  ){
    const source=
      parseRange(
        sourceRange,
        false
      );

    const target=
      parseRange(
        targetRange,
        true
      );

    if(!source||!target)
      continue;

    if(
      source.ranges.length!==1
    )
      continue;

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

  if(
    !data||
    typeof data!=="object"||
    Array.isArray(data)
  ){
    log(
      `buildIndex: invalid source dataset`
    );

    return index;
  }

  let sourceCount=0;
  let tmdbSeasonCount=0;
  let targetCount=0;
  let acceptedMappingCount=0;

  for(
    const[
      sourceDescriptor,
      targets
    ] of Object.entries(data)
  ){
    sourceCount++;

    const source=
      parseDescriptor(
        sourceDescriptor
      );

    if(!source)
      continue;

    if(
      source.provider!=="tmdb_show"
    )
      continue;

    if(source.season===null)
      continue;

    tmdbSeasonCount++;

    if(
      !targets||
      typeof targets!=="object"||
      Array.isArray(targets)
    )
      continue;

    const mappings={};

    for(
      const[
        targetDescriptor,
        ranges
      ] of Object.entries(targets)
    ){
      targetCount++;

      const target=
        parseDescriptor(
          targetDescriptor
        );

      if(!target)
        continue;

      if(
        target.provider!=="anilist"&&
        target.provider!=="mal"
      )
        continue;

      if(target.season!==null)
        continue;

      const cleaned=
        cleanMappingRanges(
          ranges
        );

      if(cleaned.length){
        mappings[targetDescriptor]=
          cleaned;

        acceptedMappingCount++;
      }
    }

    if(
      Object.keys(mappings).length
    ){
      index.entries[sourceDescriptor]={
        tmdbId:source.id,
        season:source.season,
        mappings
      };
    }
  }

  log(
    `buildIndex complete `+
    `sourceDescriptors=${sourceCount} `+
    `tmdbSeasonDescriptors=${tmdbSeasonCount} `+
    `targetDescriptors=${targetCount} `+
    `acceptedMappings=${acceptedMappingCount} `+
    `indexEntries=${Object.keys(index.entries).length}`
  );

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

  log(`========================================`);
  log(`Updater START`);
  log(`Source: ${SOURCE_URL}`);
  log(`Store: ${STORE_NAME}`);
  log(`Index key: ${INDEX_KEY}`);

  try{
    log(
      `Downloading AniBridge dataset...`
    );

    const response=
      await fetch(
        SOURCE_URL,
        {
          headers:{
            "User-Agent":
              "Breezy-Plugins-AniZone/1.0",
            "Accept":
              "application/json"
          }
        }
      );

    log(
      `AniBridge response HTTP `+
      `${response.status} `+
      `ok=${response.ok}`
    );

    if(!response.ok){
      throw new Error(
        `AniBridge download failed: `+
        `HTTP ${response.status}`
      );
    }

    const contentLength=
      response.headers.get(
        "content-length"
      );

    log(
      `Source Content-Length: `+
      `${contentLength||"unknown"} bytes`
    );

    if(
      contentLength&&
      Number.isFinite(
        Number(contentLength)
      )&&
      Number(contentLength)>
        MAX_SOURCE_BYTES
    ){
      throw new Error(
        `AniBridge dataset exceeds `+
        `${MAX_SOURCE_BYTES} byte safety limit`
      );
    }

    log(
      `Reading source body...`
    );

    const text=
      await response.text();

    const sourceBytes=
      Buffer.byteLength(
        text,
        "utf8"
      );

    log(
      `Source downloaded successfully `+
      `bytes=${sourceBytes}`
    );

    if(
      sourceBytes>
      MAX_SOURCE_BYTES
    ){
      throw new Error(
        `AniBridge dataset exceeds `+
        `${MAX_SOURCE_BYTES} byte safety limit`
      );
    }

    log(
      `Parsing AniBridge JSON...`
    );

    let data;

    try{
      data=JSON.parse(text);
    }catch(error){
      throw new Error(
        `Invalid AniBridge JSON: `+
        `${error.message}`
      );
    }

    if(
      !data||
      typeof data!=="object"||
      Array.isArray(data)
    ){
      throw new Error(
        "Invalid AniBridge dataset"
      );
    }

    log(
      `JSON parsed successfully `+
      `topLevelEntries=${Object.keys(data).length}`
    );

    log(
      `Building TMDB season index...`
    );

    const index=
      buildIndex(data);

    const entryCount=
      Object.keys(
        index.entries
      ).length;

    const indexJson=
      JSON.stringify(index);

    const indexBytes=
      Buffer.byteLength(
        indexJson,
        "utf8"
      );

    log(
      `Index built `+
      `entries=${entryCount} `+
      `bytes=${indexBytes}`
    );

    if(!entryCount){
      throw new Error(
        "AniBridge dataset produced an empty TMDB season index"
      );
    }

    if(
      indexBytes>
      MAX_INDEX_BYTES
    ){
      throw new Error(
        `Generated AniBridge index exceeds `+
        `${MAX_INDEX_BYTES} byte safety limit`
      );
    }

    log(
      `Opening Netlify Blob store `+
      `"${STORE_NAME}"...`
    );

    const store=
      getStore({
        name:STORE_NAME
      });

    log(
      `Writing ${INDEX_KEY} `+
      `(${indexBytes} bytes)...`
    );

    await store.setJSON(
      INDEX_KEY,
      index
    );

    log(
      `Blob index write SUCCESS`
    );

    const elapsedMs=
      Date.now()-started;

    log(
      `Updater SUCCESS `+
      `entries=${entryCount} `+
      `source=${sourceBytes}B `+
      `index=${indexBytes}B `+
      `time=${elapsedMs}ms`
    );

    log(
      `========================================`
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
    const elapsedMs=
      Date.now()-started;

    console.error(
      `[ANIBRIDGE] Updater FAILED `+
      `after ${elapsedMs}ms`,
      error
    );

    log(
      `ERROR MESSAGE: `+
      `${
        error&&error.message
          ?error.message
          :"Unknown error"
      }`
    );

    log(
      `========================================`
    );

    return json(500,{
      ok:false,
      error:
        error&&error.message
          ?error.message
          :"Unknown AniBridge updater error",
      elapsedMs
    });
  }
};
