const{getStore}=require("@netlify/blobs");

const STORE_NAME="anime-resolution-cache";
const INDEX_KEY="_anibridge_index";
const MAX_ID_LENGTH=50;
const MAX_EPISODE=100000;

function log(message){
  console.log(`[ANIME MAPPING] ${message}`);
}

function json(statusCode,body){
  return{
    statusCode,
    headers:{
      "Content-Type":"application/json",
      "Cache-Control":"no-store",
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"GET,OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type"
    },
    body:JSON.stringify(body)
  };
}

function parsePositiveInt(value){
  const n=Number(value);
  if(!Number.isInteger(n)||n<1||n>MAX_EPISODE)return null;
  return n;
}

function parseDescriptor(value){
  if(typeof value!=="string")return null;

  const match=value.match(/^([a-z_]+):([^:]+)(?::(s\d+))?$/);

  if(!match)return null;

  const provider=match[1];
  const id=match[2];
  const season=match[3]?Number(match[3].slice(1)):null;

  if(!id||id.length>MAX_ID_LENGTH)return null;

  if(
    season!==null&&
    (!Number.isInteger(season)||season<0)
  )
    return null;

  return{
    provider,
    id,
    season
  };
}

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

    if(
      !Number.isFinite(ratio)||
      ratio===0||
      !Number.isInteger(ratio)
    )
      return null;
  }

  const pieces=
    rangePart
      .split(",")
      .map(v=>v.trim())
      .filter(Boolean);

  if(!pieces.length)return null;

  if(!allowMultiple&&pieces.length!==1)
    return null;

  const ranges=[];

  for(const piece of pieces){
    const match=
      piece.match(/^(\d+)(?:-(\d*))?$/);

    if(!match)return null;

    const start=Number(match[1]);

    const end=
      match[2]===undefined
        ?start
        :match[2]===""
          ?Infinity
          :Number(match[2]);

    if(!Number.isInteger(start)||start<1)
      return null;

    if(
      end!==Infinity&&
      (!Number.isInteger(end)||end<start)
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

function targetEpisodeAtOrdinal(ranges,ordinal){
  if(
    !Number.isInteger(ordinal)||
    ordinal<0
  )
    return null;

  let remaining=ordinal;

  for(const range of ranges){
    if(range.end===Infinity)
      return range.start+remaining;

    const length=
      range.end-range.start+1;

    if(remaining<length)
      return range.start+remaining;

    remaining-=length;
  }

  return null;
}

function resolveTargetEpisode(
  sourceEpisode,
  sourceRange,
  targetRange
){
  if(!sourceRange||!targetRange)
    return null;

  const sourceStart=
    sourceRange.ranges[0].start;

  const sourceEnd=
    sourceRange.ranges[0].end;

  if(sourceEpisode<sourceStart)
    return null;

  if(
    sourceEnd!==Infinity&&
    sourceEpisode>sourceEnd
  )
    return null;

  const offset=
    sourceEpisode-sourceStart;

  const ratio=
    targetRange.ratio||1;

  let ordinal;

  if(ratio>0){
    ordinal=offset*ratio;
  }else{
    ordinal=
      Math.floor(
        offset/Math.abs(ratio)
      );
  }

  return targetEpisodeAtOrdinal(
    targetRange.ranges,
    ordinal
  );
}

function findMapping(
  index,
  tmdbId,
  season,
  episode
){
  const sourceKey=
    `tmdb_show:${tmdbId}:s${season}`;

  const entry=
    index&&
    index.entries&&
    index.entries[sourceKey];

  if(!entry)
    return null;

  if(
    String(entry.tmdbId)!==
    String(tmdbId)
  )
    return null;

  if(Number(entry.season)!==season)
    return null;

  const targets=entry.mappings;

  if(
    !targets||
    typeof targets!=="object"
  )
    return null;

  const candidates=[];

  for(
    const[
      targetDescriptor,
      ranges
    ] of Object.entries(targets)
  ){
    const target=
      parseDescriptor(targetDescriptor);

    if(!target)
      continue;

    if(
      target.provider!=="anilist"&&
      target.provider!=="mal"
    )
      continue;

    if(target.season!==null)
      continue;

    if(
      !ranges||
      typeof ranges!=="object"||
      Array.isArray(ranges)
    )
      continue;

    for(
      const[
        sourceRangeText,
        targetRangeText
      ] of Object.entries(ranges)
    ){
      const sourceRange=
        parseRange(
          sourceRangeText,
          false
        );

      const targetRange=
        parseRange(
          targetRangeText,
          true
        );

      if(!sourceRange||!targetRange)
        continue;

      const targetEpisode=
        resolveTargetEpisode(
          episode,
          sourceRange,
          targetRange
        );

      if(!targetEpisode)
        continue;

      candidates.push({
        target,
        targetEpisode,
        sourceRange:sourceRangeText,
        targetRange:targetRangeText
      });
    }
  }

  if(!candidates.length)
    return null;

  candidates.sort((a,b)=>{
    if(
      a.target.provider!==
      b.target.provider
    ){
      return a.target.provider==="anilist"
        ?-1
        :1;
    }

    return 0;
  });

  const selected=candidates[0];

  return{
    anilist_id:
      selected.target.provider==="anilist"
        ?selected.target.id
        :"",
    mal_id:
      selected.target.provider==="mal"
        ?selected.target.id
        :"",
    mal_episode:
      selected.targetEpisode,
    target_episode:
      selected.targetEpisode,
    source_descriptor:
      sourceKey,
    target_descriptor:
      `${selected.target.provider}:${selected.target.id}`,
    source_range:
      selected.sourceRange,
    target_range:
      selected.targetRange,
    source:"anibridge"
  };
}

exports.handler=async event=>{
  const started=Date.now();

  try{
    const method=
      (event.httpMethod||"GET")
        .toUpperCase();

    log(
      `REQUEST ${method} `+
      `path=${event.path||"unknown"}`
    );

    if(method==="OPTIONS"){
      return json(204,{});
    }

    if(method!=="GET"){
      return json(405,{
        ok:false,
        error:"Method not allowed"
      });
    }

    const params=
      event.queryStringParameters||{};

    const tmdbId=
      String(params.tmdbId||"").trim();

    const season=
      parsePositiveInt(params.season);

    const episode=
      parsePositiveInt(params.episode);

    if(
      !/^\d+$/.test(tmdbId)||
      tmdbId.length>MAX_ID_LENGTH||
      !season||
      !episode
    ){
      log(
        `INVALID QUERY `+
        `tmdbId=${tmdbId||"missing"} `+
        `season=${params.season||"missing"} `+
        `episode=${params.episode||"missing"}`
      );

      return json(400,{
        ok:false,
        error:
          "tmdbId, season and episode are required"
      });
    }

    const store=
      getStore({
        name:STORE_NAME
      });

    log(
      `Reading ${INDEX_KEY} `+
      `for TMDB=${tmdbId} `+
      `S${season}E${episode}`
    );

    const index=
      await store.get(
        INDEX_KEY,
        {
          type:"json",
          consistency:"strong"
        }
      );

    if(!index){
      log(
        `INDEX MISS ${INDEX_KEY}`
      );

      return json(503,{
        ok:false,
        error:
          "AniBridge mapping index is not available"
      });
    }

    if(
      !index.entries||
      typeof index.entries!=="object"
    ){
      log(`INDEX INVALID`);

      return json(503,{
        ok:false,
        error:
          "AniBridge mapping index is invalid"
      });
    }

    const mapping=
      findMapping(
        index,
        tmdbId,
        season,
        episode
      );

    if(!mapping){
      log(
        `MAPPING MISS `+
        `TMDB=${tmdbId} `+
        `S${season}E${episode}`
      );

      return json(404,{
        ok:false,
        mapping:null,
        error:"Mapping not found"
      });
    }

    const elapsedMs=
      Date.now()-started;

    log(
      `MAPPING HIT `+
      `TMDB=${tmdbId} `+
      `S${season}E${episode} `+
      `target=${mapping.target_descriptor} `+
      `E${mapping.target_episode} `+
      `range=${mapping.source_range}`+
      `->${mapping.target_range} `+
      `time=${elapsedMs}ms`
    );

    return json(200,{
      ok:true,
      source:"anibridge",
      updatedAt:
        index.updatedAt||null,
      mapping
    });
  }catch(error){
    const elapsedMs=
      Date.now()-started;

    console.error(
      `[ANIME MAPPING] FATAL after `+
      `${elapsedMs}ms`,
      error
    );

    return json(500,{
      ok:false,
      error:
        error&&error.message
          ?error.message
          :"Mapping service error"
    });
  }
};
