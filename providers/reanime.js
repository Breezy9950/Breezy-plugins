const CryptoJS = require("crypto-js");

// =========================================================
// CONFIG
// =========================================================

const REANIME_DOMAINS = [
  "https://reanime.wtf",
  "https://reanime.to",
  "https://reanime.cz"
];

const FLIXCLOUD_BASE = "https://flixcloud.cc";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const FRIBB_URL =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};

const FLIX_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "*/*",
  "Origin": FLIXCLOUD_BASE,
  "Referer": `${FLIXCLOUD_BASE}/`
};

let activeBaseUrl = REANIME_DOMAINS[0];
let fribbCache = null;

// =========================================================
// LOGGING
// =========================================================

const log = (...args) =>
  console.log("[Reanime-Fribb]", ...args);

const err = (...args) =>
  console.error("[Reanime-Fribb]", ...args);

function section(name) {
  log("========================================");
  log(name);
  log("========================================");
}

// =========================================================
// HTTP
// =========================================================

function absolutize(path, base = activeBaseUrl) {
  if (!path) return "";

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function fetchText(url, options = {}) {
  const absolute = /^https?:\/\//i.test(url);

  const urls = absolute
    ? [url]
    : REANIME_DOMAINS.map(
        domain =>
          `${domain}${url.startsWith("/") ? "" : "/"}${url}`
      );

  let lastError = null;

  for (const currentUrl of urls) {
    try {
      log("HTTP REQUEST", currentUrl);

      const response = await fetch(currentUrl, {
        ...options,
        headers: {
          ...DEFAULT_HEADERS,
          ...(options.headers || {})
        }
      });

      log(
        "HTTP RESPONSE",
        response.status,
        currentUrl
      );

      if (response.ok) {
        if (!absolute) {
          try {
            activeBaseUrl =
              new URL(currentUrl).origin;

            log(
              "ACTIVE REANIME DOMAIN",
              activeBaseUrl
            );
          } catch {}
        }

        return await response.text();
      }

      lastError =
        new Error(
          `HTTP ${response.status}`
        );

      log(
        "HTTP FAILED",
        response.status,
        currentUrl
      );
    } catch (e) {
      lastError = e;

      log(
        "HTTP EXCEPTION",
        currentUrl,
        e?.message || String(e)
      );
    }
  }

  throw (
    lastError ||
    new Error(`Request failed: ${url}`)
  );
}

async function fetchJson(url, options = {}) {
  const text =
    await fetchText(url, {
      ...options,
      headers: {
        "Accept":
          "application/json, text/plain, */*",
        ...(options.headers || {})
      }
    });

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Invalid JSON from ${url}: ${
        e?.message || e
      }`
    );
  }
}

// =========================================================
// TMDB
// =========================================================

function tmdbBase(type) {
  return `https://api.themoviedb.org/3/${
    type === "movie"
      ? "movie"
      : "tv"
  }`;
}

async function getTmdbInfo(
  tmdbId,
  mediaType
) {
  const type =
    mediaType === "movie"
      ? "movie"
      : "tv";

  log(
    "TMDB LOOKUP START",
    `ID=${tmdbId}`,
    `TYPE=${type}`
  );

  try {
    const url =
      `${tmdbBase(type)}/` +
      `${encodeURIComponent(tmdbId)}` +
      `?api_key=${TMDB_API_KEY}` +
      `&append_to_response=external_ids`;

    const data =
      await fetchJson(url);

    const imdbId =
      data?.external_ids?.imdb_id ||
      data?.imdb_id ||
      null;

    const title =
      data?.name ||
      data?.title ||
      data?.original_name ||
      data?.original_title ||
      "Anime";

    const year = (
      data?.first_air_date ||
      data?.release_date ||
      ""
    ).slice(0, 4);

    log("TMDB LOOKUP SUCCESS");
    log(
      "TMDB ID",
      data?.id ?? tmdbId
    );
    log(
      "TMDB TITLE",
      title
    );
    log(
      "TMDB ORIGINAL",
      data?.original_name ||
        data?.original_title ||
        "N/A"
    );
    log(
      "TMDB YEAR",
      year || "N/A"
    );
    log(
      "TMDB IMDb",
      imdbId || "NOT FOUND"
    );

    if (!imdbId) {
      log(
        "TMDB IMDb MISSING",
        "Trying fallback ARM lookup"
      );

      try {
        const armUrl =
          `https://arm.haglund.dev/api/v2/themoviedb` +
          `?id=${encodeURIComponent(tmdbId)}`;

        const arm =
          await fetchJson(armUrl);

        if (
          Array.isArray(arm) &&
          arm.length
        ) {
          const armImdb =
            arm[0]?.imdb || null;

          if (armImdb) {
            log(
              "ARM IMDb FOUND",
              armImdb
            );

            return {
              title,
              year,
              imdbId: armImdb
            };
          }
        }

        log(
          "ARM IMDb NOT FOUND"
        );
      } catch (e) {
        log(
          "ARM LOOKUP FAILED",
          e?.message ||
            String(e)
        );
      }
    }

    return {
      title,
      year,
      imdbId
    };
  } catch (e) {
    err(
      "TMDB LOOKUP FAILED",
      e?.stack ||
        e?.message ||
        e
    );

    return null;
  }
}

// =========================================================
// FRIBB MAPPING
// =========================================================

async function loadFribb() {
  if (
    Array.isArray(fribbCache) &&
    fribbCache.length
  ) {
    log(
      "FRIBB CACHE HIT",
      `entries=${fribbCache.length}`
    );

    return fribbCache;
  }

  section(
    "FRIBB DATABASE LOAD"
  );

  log(
    "FRIBB URL",
    FRIBB_URL
  );

  log(
    "Downloading Fribb mapping database..."
  );

  try {
    const response =
      await fetch(
        FRIBB_URL,
        {
          headers: {
            "User-Agent":
              "Reanime-Nuvio/1.0",
            "Accept":
              "application/json"
          }
        }
      );

    log(
      "FRIBB HTTP",
      response.status
    );

    if (!response.ok) {
      throw new Error(
        `Fribb HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    if (!Array.isArray(data)) {
      throw new Error(
        "Fribb response is not an array"
      );
    }

    fribbCache = data;

    log(
      "FRIBB DATABASE LOADED",
      `entries=${fribbCache.length}`
    );

    return fribbCache;
  } catch (e) {
    err(
      "FRIBB DATABASE LOAD FAILED",
      e?.stack ||
        e?.message ||
        e
    );

    return null;
  }
}

function idMatches(
  value,
  target
) {
  if (
    value === undefined ||
    value === null
  ) {
    return false;
  }

  const wanted =
    String(target);

  if (Array.isArray(value)) {
    return value.some(
      item =>
        String(item) === wanted
    );
  }

  return (
    String(value) === wanted
  );
}

function getFribbSeason(
  entry
) {
  const value =
    entry?.season?.tmdb;

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function getFribbEpisodeOffset(
  entry
) {
  const raw =
    entry?.episode_offset?.tmdb;

  if (
    raw === undefined ||
    raw === null ||
    raw === ""
  ) {
    return 0;
  }

  const offset =
    Number(raw);

  return Number.isFinite(offset)
    ? offset
    : 0;
}

async function resolveFribbMapping({
  tmdbId,
  mediaType,
  season = 1,
  episode = 1
}) {
  section(
    "FRIBB MAPPING"
  );

  log(
    "FRIBB INPUT",
    `TMDB=${tmdbId}`,
    `TYPE=${mediaType}`,
    `S${season}E${episode}`
  );

  const rows =
    await loadFribb();

  if (!rows) {
    err(
      "FRIBB STOP: database unavailable"
    );

    return null;
  }

  log(
    "FRIBB ROW COUNT",
    rows.length
  );

  const targetTmdbId =
    String(tmdbId);

  const isMovie =
    mediaType === "movie";

  const targetSeason =
    Number(season) || 1;

  const targetEpisode =
    Number(episode) || 1;

  log(
    "FRIBB SEARCH TARGET",
    JSON.stringify({
      tmdbId: targetTmdbId,
      mediaType,
      season: targetSeason,
      episode: targetEpisode
    })
  );

  // =======================================================
  // DIAGNOSTIC: FIND EVERY RAW TMDB MATCH
  // =======================================================

  const rawMatches = [];

  for (const entry of rows) {
    if (
      !entry ||
      typeof entry !== "object"
    ) {
      continue;
    }

    const tmdbIds =
      entry?.themoviedb_id;

    if (
      !tmdbIds ||
      typeof tmdbIds !== "object"
    ) {
      continue;
    }

    const movieMatch =
      idMatches(
        tmdbIds.movie,
        targetTmdbId
      );

    const tvMatch =
      idMatches(
        tmdbIds.tv,
        targetTmdbId
      );

    if (
      (isMovie && movieMatch) ||
      (!isMovie && tvMatch)
    ) {
      rawMatches.push(entry);
    }
  }

  log(
    "FRIBB RAW TMDB MATCH COUNT",
    rawMatches.length
  );

  // Print every raw match so we can see exactly
  // what Fribb contains for this TMDB ID.
  for (
    let i = 0;
    i < rawMatches.length;
    i++
  ) {
    const candidate =
      rawMatches[i];

    log(
      `FRIBB RAW CANDIDATE ${i + 1}`,
      JSON.stringify({
        type:
          candidate?.type ??
          null,

        anidb_id:
          candidate?.anidb_id ??
          null,

        anilist_id:
          candidate?.anilist_id ??
          null,

        mal_id:
          candidate?.mal_id ??
          null,

        imdb_id:
          candidate?.imdb_id ??
          null,

        themoviedb_id:
          candidate?.themoviedb_id ??
          null,

        season:
          candidate?.season ??
          null,

        episode_offset:
          candidate?.episode_offset ??
          null
      })
    );
  }

  // =======================================================
  // NO RAW MATCH
  // =======================================================

  if (!rawMatches.length) {
    log(
      "FRIBB NO RAW TMDB MATCH",
      JSON.stringify({
        tmdbId:
          targetTmdbId,
        mediaType,
        requestedSeason:
          targetSeason,
        requestedEpisode:
          targetEpisode
      })
    );

    // Diagnostic: find entries containing the same
    // numeric ID anywhere in their TMDB object.
    const looseMatches = [];

    for (const entry of rows) {
      const ids =
        entry?.themoviedb_id;

      if (
        !ids ||
        typeof ids !== "object"
      ) {
        continue;
      }

      const serialized =
        JSON.stringify(ids);

      if (
        serialized.includes(
          targetTmdbId
        )
      ) {
        looseMatches.push(
          entry
        );
      }
    }

    log(
      "FRIBB LOOSE TMDB MATCH COUNT",
      looseMatches.length
    );

    for (
      let i = 0;
      i < Math.min(
        looseMatches.length,
        10
      );
      i++
    ) {
      const candidate =
        looseMatches[i];

      log(
        `FRIBB LOOSE CANDIDATE ${i + 1}`,
        JSON.stringify({
          type:
            candidate?.type ??
            null,

          anidb_id:
            candidate?.anidb_id ??
            null,

          anilist_id:
            candidate?.anilist_id ??
            null,

          themoviedb_id:
            candidate?.themoviedb_id ??
            null,

          season:
            candidate?.season ??
            null
        })
      );
    }

    return null;
  }

  // =======================================================
  // MOVIE
  // =======================================================

  if (isMovie) {
    const movieCandidates =
      rawMatches.filter(
        entry =>
          entry?.anilist_id !==
            undefined &&
          entry?.anilist_id !==
            null &&
          entry?.anilist_id !==
            ""
      );

    log(
      "FRIBB MOVIE VALID CANDIDATES",
      movieCandidates.length
    );

    for (
      let i = 0;
      i < movieCandidates.length;
      i++
    ) {
      const candidate =
        movieCandidates[i];

      log(
        `FRIBB MOVIE CANDIDATE ${i + 1}`,
        JSON.stringify({
          anilist_id:
            candidate?.anilist_id ??
            null,

          anidb_id:
            candidate?.anidb_id ??
            null,

          type:
            candidate?.type ??
            null,

          imdb_id:
            candidate?.imdb_id ??
            null,

          tmdb:
            candidate?.themoviedb_id ??
            null
        })
      );
    }

    if (
      movieCandidates.length
    ) {
      const entry =
        movieCandidates[0];

      const anilistId =
        String(
          entry.anilist_id
        );

      log(
        "FRIBB MOVIE MAPPING SUCCESS",
        `AniList=${anilistId}`
      );

      return {
        anilistId,
        episode: 1,
        source: "fribb"
      };
    }

    log(
      "FRIBB MOVIE MATCHES EXIST BUT NONE HAVE ANILIST ID"
    );

    return null;
  }

  // =======================================================
  // TV
  // =======================================================

  const withAniList =
    rawMatches.filter(
      entry =>
        entry?.anilist_id !==
          undefined &&
        entry?.anilist_id !==
          null &&
        entry?.anilist_id !==
          ""
    );

  log(
    "FRIBB TV CANDIDATES WITH ANILIST",
    withAniList.length
  );

  // =======================================================
  // EXACT SEASON MATCHES
  // =======================================================

  const exactSeasonMatches =
    withAniList.filter(
      entry => {
        const fribbSeason =
          getFribbSeason(
            entry
          );

        return (
          fribbSeason !== null &&
          fribbSeason ===
            targetSeason
        );
      }
    );

  log(
    "FRIBB EXACT SEASON MATCH COUNT",
    exactSeasonMatches.length
  );

  for (
    let i = 0;
    i < exactSeasonMatches.length;
    i++
  ) {
    const candidate =
      exactSeasonMatches[i];

    log(
      `FRIBB EXACT SEASON CANDIDATE ${i + 1}`,
      JSON.stringify({
        anilist_id:
          candidate?.anilist_id ??
          null,

        type:
          candidate?.type ??
          null,

        season:
          candidate?.season ??
          null,

        episode_offset:
          candidate?.episode_offset ??
          null,

        tmdb:
          candidate?.themoviedb_id ??
          null,

        imdb:
          candidate?.imdb_id ??
          null
      })
    );
  }

  // =======================================================
  // EXACT SEASON RESULT
  // =======================================================

  if (
    exactSeasonMatches.length
  ) {
    const entry =
      exactSeasonMatches[0];

    const offset =
      getFribbEpisodeOffset(
        entry
      );

    const mappedEpisode =
      targetEpisode +
      offset;

    const anilistId =
      String(
        entry.anilist_id
      );

    log(
      "FRIBB EXACT SEASON SUCCESS"
    );

    log(
      "FRIBB AniList ID",
      anilistId
    );

    log(
      "FRIBB SEASON",
      targetSeason
    );

    log(
      "FRIBB EPISODE OFFSET",
      offset
    );

    log(
      "FRIBB OUTPUT EPISODE",
      mappedEpisode
    );

    return {
      anilistId,
      episode:
        mappedEpisode,
      source:
        "fribb"
    };
  }

  // =======================================================
  // NO EXACT SEASON
  // =======================================================

  log(
    "FRIBB NO EXACT SEASON MATCH"
  );

  log(
    "FRIBB ALL TV CANDIDATES",
    withAniList.length
  );

  for (
    let i = 0;
    i < withAniList.length;
    i++
  ) {
    const candidate =
      withAniList[i];

    log(
      `FRIBB TV FALLBACK CANDIDATE ${i + 1}`,
      JSON.stringify({
        anilist_id:
          candidate?.anilist_id ??
          null,

        type:
          candidate?.type ??
          null,

        season:
          candidate?.season ??
          null,

        episode_offset:
          candidate?.episode_offset ??
          null,

        tmdb:
          candidate?.themoviedb_id ??
          null,

        imdb:
          candidate?.imdb_id ??
          null
      })
    );
  }

  return null;
}

// =========================================================
// REANIME FLIX
// =========================================================

function filterServers(
  servers,
  language
) {
  if (
    !Array.isArray(servers)
  ) {
    return [];
  }

  return servers.filter(
    server =>
      server?.dataType
        ?.toLowerCase() ===
      String(language)
        .toLowerCase()
  );
}

async function getFlixEmbeds(
  slug,
  episodeNumber,
  language,
  anilistId
) {
  section(
    `REANIME FLIX ${String(
      language
    ).toUpperCase()}`
  );

  const watchPath =
    `/watch/${
      slug || "anime"
    }?ep=${episodeNumber}`;

  log(
    "FLIX INPUT",
    `AniList=${anilistId}`,
    `Episode=${episodeNumber}`,
    `Language=${language}`,
    `Slug=${slug || "NONE"}`
  );

  if (!anilistId) {
    log(
      "FLIX STOP: Missing AniList ID"
    );

    return {
      watchUrl:
        absolutize(watchPath),
      servers: [],
      embeds: []
    };
  }

  try {
    const url =
      `/api/flix/${anilistId}/${episodeNumber}`;

    log(
      "FLIX PRIMARY REQUEST",
      absolutize(url)
    );

    const data =
      await fetchJson(
        url,
        {
          headers: {
            Referer:
              absolutize(
                watchPath
              )
          }
        }
      );

    log(
      "FLIX PRIMARY RESPONSE",
      JSON.stringify({
        success:
          data?.success,
        serverCount:
          Array.isArray(
            data?.servers
          )
            ? data.servers.length
            : 0
      })
    );

    if (
      data?.success &&
      Array.isArray(
        data.servers
      )
    ) {
      const servers =
        filterServers(
          data.servers,
          language
        );

      log(
        "FLIX PRIMARY MATCHING SERVERS",
        servers.length
      );

      if (servers.length) {
        const embeds =
          servers
            .map(
              server =>
                server?.dataLink
            )
            .filter(Boolean);

        log(
          "FLIX EMBEDS",
          embeds.length
        );

        return {
          watchUrl:
            absolutize(
              watchPath
            ),
          servers,
          embeds
        };
      }
    }
  } catch (e) {
    log(
      "FLIX PRIMARY FAILED",
      e?.message ||
        String(e)
    );
  }

  // -----------------------------------------------------
  // Slug fallback
  // -----------------------------------------------------

  if (slug) {
    try {
      log(
        "FLIX SLUG API FALLBACK",
        slug
      );

      const anime =
        await fetchJson(
          `/api/v1/anime/${slug}`
        );

      const fallbackAniList =
        anime?.anilist_id;

      log(
        "FLIX SLUG API AniList",
        fallbackAniList ||
          "NOT FOUND"
      );

      if (fallbackAniList) {
        const data =
          await fetchJson(
            `/api/flix/${fallbackAniList}/${episodeNumber}`,
            {
              headers: {
                Referer:
                  absolutize(
                    watchPath
                  )
              }
            }
          );

        log(
          "FLIX SLUG RESPONSE",
          JSON.stringify({
            success:
              data?.success,
            serverCount:
              Array.isArray(
                data?.servers
              )
                ? data.servers.length
                : 0
          })
        );

        if (
          data?.success &&
          Array.isArray(
            data.servers
          )
        ) {
          const servers =
            filterServers(
              data.servers,
              language
            );

          log(
            "FLIX SLUG MATCHING SERVERS",
            servers.length
          );

          if (servers.length) {
            return {
              watchUrl:
                absolutize(
                  watchPath
                ),
              servers,
              embeds:
                servers
                  .map(
                    server =>
                      server?.dataLink
                  )
                  .filter(Boolean)
            };
          }
        }
      }
    } catch (e) {
      log(
        "FLIX SLUG API FAILED",
        e?.message ||
          String(e)
      );
    }

    // -----------------------------------------------------
    // HTML fallback
    // -----------------------------------------------------

    try {
      log(
        "FLIX HTML FALLBACK",
        slug
      );

      const html =
        await fetchText(
          `/anime/${slug}?_ep=${episodeNumber}`
        );

      log(
        "FLIX HTML LENGTH",
        html.length
      );

      const match =
        html.match(
          /anilist_id:\s*(\d+)/
        );

      const htmlAniList =
        match?.[1] || null;

      log(
        "FLIX HTML AniList",
        htmlAniList ||
          "NOT FOUND"
      );

      if (htmlAniList) {
        const data =
          await fetchJson(
            `/api/flix/${htmlAniList}/${episodeNumber}`,
            {
              headers: {
                Referer:
                  absolutize(
                    watchPath
                  )
              }
            }
          );

        if (
          data?.success &&
          Array.isArray(
            data.servers
          )
        ) {
          const servers =
            filterServers(
              data.servers,
              language
            );

          log(
            "FLIX HTML MATCHING SERVERS",
            servers.length
          );

          if (servers.length) {
            return {
              watchUrl:
                absolutize(
                  watchPath
                ),
              servers,
              embeds:
                servers
                  .map(
                    server =>
                      server?.dataLink
                  )
                  .filter(Boolean)
            };
          }
        }
      }
    } catch (e) {
      log(
        "FLIX HTML FALLBACK FAILED",
        e?.message ||
          String(e)
      );
    }
  }

  log(
    "FLIX COMPLETE FAILURE",
    `AniList=${anilistId}`,
    `Episode=${episodeNumber}`,
    `Language=${language}`
  );

  return {
    watchUrl:
      absolutize(watchPath),
    servers: [],
    embeds: []
  };
}

// =========================================================
// FLIXCLOUD CRYPTO
// =========================================================

function sha256hex(value) {
  return CryptoJS.SHA256(
    CryptoJS.enc.Utf8.parse(
      String(value)
    )
  ).toString(
    CryptoJS.enc.Hex
  );
}

function fromBase64(value) {
  return Uint8Array.from(
    atob(String(value)),
    char =>
      char.charCodeAt(0)
  );
}

function uint8ToWordArray(
  bytes
) {
  const words = [];

  for (
    let i = 0;
    i < bytes.length;
    i++
  ) {
    words[i >>> 2] =
      (words[i >>> 2] || 0) |
      (
        bytes[i] <<
        (
          24 -
          (i % 4) * 8
        )
      );
  }

  return CryptoJS.lib.WordArray.create(
    words,
    bytes.length
  );
}

function wordArrayToUint8(
  wordArray
) {
  const output =
    new Uint8Array(
      wordArray.sigBytes
    );

  for (
    let i = 0;
    i < wordArray.sigBytes;
    i++
  ) {
    output[i] =
      (
        wordArray.words[
          i >>> 2
        ] >>>
        (
          24 -
          (i % 4) * 8
        )
      ) & 255;
  }

  return output;
}

function generateFields(
  seed
) {
  let e = seed;
  let l;

  for (
    let i = 0;
    i < 3;
    i++
  ) {
    e =
      sha256hex(
        e + i
      );
  }

  l = e;

  for (
    let i = 0;
    i < 3;
    i++
  ) {
    l =
      sha256hex(
        l + i
      );
  }

  return {
    keyField:
      "kf_" +
      e.substring(
        8,
        16
      ),

    ivField:
      "ivf_" +
      e.substring(
        16,
        24
      ),

    containerName:
      "cd_" +
      e.substring(
        24,
        32
      ),

    arrayName:
      "ad_" +
      e.substring(
        32,
        40
      ),

    objectName:
      "od_" +
      e.substring(
        40,
        48
      ),

    tokenField:
      e.substring(
        48,
        64
      ) +
      "_" +
      e.substring(
        56,
        64
      ),

    keyFrag2Field:
      l.substring(
        0,
        16
      ) +
      "_" +
      l.substring(
        16,
        24
      )
  };
}

async function runWasm(
  wasmBase64,
  frag1,
  keyFrag2,
  tBytes,
  seedInt
) {
  log(
    "WASM START"
  );

  try {
    const {
      instance
    } =
      await WebAssembly.instantiate(
        fromBase64(
          wasmBase64
        )
      );

    const {
      _s,
      _r,
      memory
    } =
      instance.exports;

    if (
      typeof _s !==
        "function" ||
      typeof _r !==
        "function" ||
      !memory
    ) {
      throw new Error(
        "Invalid FlixCloud WASM exports"
      );
    }

    const heap =
      new Uint8Array(
        memory.buffer
      );

    const length =
      frag1.length;

    const y = 1000;
    const v =
      y + length;
    const t =
      v + length;
    const output =
      t + length;

    heap.set(
      frag1,
      y
    );

    heap.set(
      keyFrag2,
      v
    );

    heap.set(
      tBytes,
      t
    );

    log(
      "WASM MEMORY",
      `length=${length}`,
      `seedInt=${seedInt}`
    );

    _s(seedInt);

    _r(
      y,
      v,
      t,
      output,
      length
    );

    log(
      "WASM SUCCESS"
    );

    return heap.slice(
      output,
      output + length
    );
  } catch (e) {
    err(
      "WASM FAILED",
      e?.stack ||
        e?.message ||
        e
    );

    throw e;
  }
}

function extractSsrObject(
  html
) {
  const marker =
    html.match(
      /\{type:"data",data:(\{)/
    );

  if (!marker) {
    throw new Error(
      "SSR data block not found"
    );
  }

  const start =
    html.indexOf(
      "{",
      marker.index +
        marker[0].length -
        1
    );

  let depth = 0;

  for (
    let i = start;
    i < html.length;
    i++
  ) {
    if (
      html[i] === "{"
    ) {
      depth++;
    } else if (
      html[i] === "}" &&
      !--depth
    ) {
      return html.slice(
        start,
        i + 1
      );
    }
  }

  throw new Error(
    "SSR brace matching failed"
  );
}

function parseSsrData(
  html
) {
  return Function(
    `"use strict";return(${extractSsrObject(
      html
    )});`
  )();
}

async function resolveFlixCloud(
  embedUrl
) {
  section(
    "FLIXCLOUD HLS"
  );

  log(
    "FLIXCLOUD EMBED",
    embedUrl
  );

  const match =
    String(
      embedUrl
    ).match(
      /\/e\/([^?#\s]+)(?:\?v=(\d+))?/i
    );

  if (!match) {
    throw new Error(
      "Invalid FlixCloud embed URL"
    );
  }

  const accessId =
    match[1];

  const version =
    Number(match[2]) || 2;

  log(
    "FLIXCLOUD ACCESS ID",
    accessId
  );

  log(
    "FLIXCLOUD VERSION",
    version
  );

  const embedUrlFull =
    `${FLIXCLOUD_BASE}/e/${accessId}?v=${version}`;

  log(
    "FLIXCLOUD EMBED REQUEST",
    embedUrlFull
  );

  const response =
    await fetch(
      embedUrlFull,
      {
        headers: {
          "User-Agent":
            USER_AGENT,
          "Accept":
            "*/*",
          "Referer":
            "https://reanime.wtf/"
        }
      }
    );

  log(
    "FLIXCLOUD EMBED HTTP",
    response.status
  );

  if (!response.ok) {
    throw new Error(
      `FlixCloud HTTP ${response.status}`
    );
  }

  const html =
    await response.text();

  log(
    "FLIXCLOUD EMBED HTML",
    `length=${html.length}`
  );

  const data =
    parseSsrData(html);

  const seed =
    data?.obfuscation_seed;

  if (!seed) {
    throw new Error(
      "Missing FlixCloud obfuscation seed"
    );
  }

  log(
    "FLIXCLOUD SEED FOUND",
    `length=${seed.length}`
  );

  const fields =
    generateFields(seed);

  log(
    "FLIXCLOUD FIELDS GENERATED"
  );

  const cryptoData =
    data?.obfuscated_crypto_data;

  if (!cryptoData) {
    throw new Error(
      "Missing obfuscated crypto data"
    );
  }

  const container =
    cryptoData[
      fields.containerName
    ];

  const array =
    container?.[
      fields.arrayName
    ];

  const object =
    array?.[0]?.[
      fields.objectName
    ];

  if (!object) {
    throw new Error(
      "Missing FlixCloud crypto object"
    );
  }

  const frag1 =
    fromBase64(
      object[
        fields.keyField
      ]
    );

  const iv =
    fromBase64(
      object[
        fields.ivField
      ]
    );

  const keyFrag2 =
    fromBase64(
      data[
        fields.keyFrag2Field
      ]
    );

  const token =
    data[
      fields.tokenField
    ];

  if (!token) {
    throw new Error(
      "Missing FlixCloud token"
    );
  }

  log(
    "FLIXCLOUD CRYPTO DATA FOUND",
    `frag1=${frag1.length}`,
    `iv=${iv.length}`,
    `keyFrag2=${keyFrag2.length}`
  );

  log(
    "FLIXCLOUD TOKEN FOUND"
  );

  const tokenUrl =
    `${FLIXCLOUD_BASE}/api/m3u8/${token}`;

  log(
    "FLIXCLOUD M3U8 REQUEST",
    tokenUrl
  );

  const tokenResponse =
    await fetch(
      tokenUrl,
      {
        headers:
          FLIX_HEADERS
      }
    );

  log(
    "FLIXCLOUD M3U8 HTTP",
    tokenResponse.status
  );

  if (
    !tokenResponse.ok
  ) {
    throw new Error(
      `FlixCloud M3U8 HTTP ${tokenResponse.status}`
    );
  }

  const tokenData =
    await tokenResponse.json();

  const videoKey =
    sha256hex(
      token + "vid"
    ).substring(
      0,
      10
    );

  const encryptionKey =
    sha256hex(
      token + "key"
    ).substring(
      0,
      10
    );

  log(
    "FLIXCLOUD TOKEN FIELDS",
    `videoField=${videoKey}`,
    `keyField=${encryptionKey}`
  );

  const videoBytes =
    fromBase64(
      tokenData[
        videoKey
      ]
    );

  const tBytes =
    fromBase64(
      tokenData[
        encryptionKey
      ]
    );

  if (
    !videoBytes.length ||
    !tBytes.length
  ) {
    throw new Error(
      "Encrypted FlixCloud fields missing"
    );
  }

  log(
    "FLIXCLOUD ENCRYPTED DATA",
    `video=${videoBytes.length}`,
    `key=${tBytes.length}`
  );

  const seedInt =
    parseInt(
      seed.substring(
        0,
        8
      ),
      16
    );

  const wasmOutput =
    await runWasm(
      data.w_payload,
      frag1,
      keyFrag2,
      tBytes,
      seedInt
    );

  log(
    "FLIXCLOUD PBKDF2 START"
  );

  const derived =
    CryptoJS.PBKDF2(
      uint8ToWordArray(
        wasmOutput
      ),
      CryptoJS.enc.Utf8.parse(
        seed
      ),
      {
        keySize: 8,
        iterations: 1000,
        hasher:
          CryptoJS.algo.SHA256
      }
    );

  const keyBytes =
    wordArrayToUint8(
      derived
    );

  for (
    let i = 0;
    i < 32;
    i++
  ) {
    keyBytes[i] ^=
      seed.charCodeAt(
        i % seed.length
      );
  }

  log(
    "FLIXCLOUD AES DECRYPT START"
  );

  const decrypted =
    CryptoJS.AES.decrypt(
      {
        ciphertext:
          uint8ToWordArray(
            videoBytes
          )
      },
      CryptoJS.SHA256(
        uint8ToWordArray(
          keyBytes
        )
      ),
      {
        iv:
          uint8ToWordArray(
            iv
          ),
        mode:
          CryptoJS.mode.CBC,
        padding:
          CryptoJS.pad.Pkcs7
      }
    );

  const streamUrl =
    CryptoJS.enc.Utf8
      .stringify(
        decrypted
      )
      .trim();

  if (
    !/^https?:\/\//i.test(
      streamUrl
    )
  ) {
    throw new Error(
      "Invalid decrypted stream URL"
    );
  }

  log(
    "FLIXCLOUD HLS SUCCESS"
  );

  return {
    url:
      streamUrl,
    subtitles:
      data.subtitles ||
      [],
    thumbnailsVtt:
      data.thumbnails_vtt ||
      null,
    videoTitle:
      data.video_title ||
      null,
    introChapter:
      data.intro_chapter ||
      null,
    outroChapter:
      data.outro_chapter ||
      null,
    videoId:
      data.video_id ||
      null,
    version
  };
}

// =========================================================
// DIRECT MKV
// =========================================================

async function extractFlixCloudDownload(
  embedUrl
) {
  section(
    "FLIXCLOUD DIRECT MKV"
  );

  try {
    log(
      "DIRECT MKV EMBED",
      embedUrl
    );

    const accessId =
      String(
        embedUrl
      ).match(
        /\/e\/([a-z0-9]+)/i
      )?.[1];

    if (!accessId) {
      log(
        "DIRECT MKV INVALID ACCESS ID"
      );

      return null;
    }

    log(
      "DIRECT MKV ACCESS ID",
      accessId
    );

    const headers = {
      Accept: "*/*",
      Referer:
        `${FLIXCLOUD_BASE}/`,
      "User-Agent":
        USER_AGENT
    };

    const url =
      `${FLIXCLOUD_BASE}/d/${accessId}/__data.json`;

    log(
      "DIRECT MKV REQUEST",
      url
    );

    const response =
      await fetch(
        url,
        {
          headers
        }
      );

    log(
      "DIRECT MKV HTTP",
      response.status
    );

    if (!response.ok) {
      log(
        "DIRECT MKV UNAVAILABLE",
        response.status
      );

      return null;
    }

    const body =
      await response.text();

    log(
      "DIRECT MKV DATA LENGTH",
      body.length
    );

    const fileId =
      body.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      )?.[0];

    const token =
      body.match(
        /eyJ[\w-]+\.[\w-]+\.[\w-]+/
      )?.[0];

    const base =
      body.match(
        /https:\/\/[a-z0-9-]+\.flixcloud\.cc/i
      )?.[0] ||
      FLIXCLOUD_BASE;

    const quality =
      body.match(
        /(\d{3,4}p)/
      )?.[1] ||
      "1080p";

    const size =
      body.match(
        /"(\d+(?:\.\d+)?\s*[KMG]B)"/i
      )?.[1] ||
      "Unknown";

    log(
      "DIRECT MKV PARSED",
      `fileId=${fileId ? "YES" : "NO"}`,
      `token=${token ? "YES" : "NO"}`,
      `quality=${quality}`,
      `size=${size}`,
      `base=${base}`
    );

    if (
      !fileId ||
      !token
    ) {
      log(
        "DIRECT MKV INCOMPLETE DATA"
      );

      return null;
    }

    let ready = false;

    try {
      const progressUrl =
        `${base}/download/${fileId}/progress` +
        `?token=${token}`;

      log(
        "DIRECT MKV PROGRESS REQUEST"
      );

      const progress =
        await fetch(
          progressUrl,
          {
            headers
          }
        );

      log(
        "DIRECT MKV PROGRESS HTTP",
        progress.status
      );

      if (progress.ok) {
        const progressText =
          await progress.text();

        ready =
          progressText.includes(
            '"status":"ready"'
          ) ||
          progressText.includes(
            '"ready"'
          );

        log(
          "DIRECT MKV READY",
          ready
        );
      }
    } catch (e) {
      log(
        "DIRECT MKV PROGRESS FAILED",
        e?.message ||
          String(e)
      );
    }

    const downloadUrl =
      `${base}/download/${fileId}?token=${token}`;

    log(
      "DIRECT MKV SUCCESS",
      `quality=${quality}`,
      `size=${size}`,
      `ready=${ready}`
    );

    return {
      url:
        downloadUrl,
      quality,
      size,
      type:
        "mkv",
      headers,
      ready
    };
  } catch (e) {
    log(
      "DIRECT MKV EXCEPTION",
      e?.stack ||
        e?.message ||
        e
    );

    return null;
  }
}

// =========================================================
// MAIN STREAM FUNCTION
// =========================================================

async function getStreams(
  tmdbId,
  mediaType = "tv",
  season = 1,
  episode = 1
) {
  section(
    "REANIME START"
  );

  log(
    "INPUT",
    `TMDB=${tmdbId}`,
    `TYPE=${mediaType}`,
    `S${season}E${episode}`
  );

  try {
    if (
      mediaType !== "tv" &&
      mediaType !== "movie"
    ) {
      log(
        "STOP: UNSUPPORTED MEDIA TYPE",
        mediaType
      );

      return [];
    }

    const isMovie =
      mediaType === "movie";

    const seasonNumber =
      Number(season) || 1;

    const originalEpisode =
      isMovie
        ? 1
        : Number(episode) || 1;

    // -----------------------------------------------------
    // TMDB
    // -----------------------------------------------------

    const tmdb =
      await getTmdbInfo(
        tmdbId,
        mediaType
      );

    if (!tmdb) {
      log(
        "STOP: TMDB LOOKUP FAILED"
      );

      return [];
    }

    if (!tmdb.imdbId) {
      log(
        "STOP: NO IMDb ID",
        `TMDB=${tmdbId}`,
        `TITLE=${tmdb.title}`
      );

      return [];
    }

    log(
      "IMDb RESOLVED",
      tmdb.imdbId
    );

    // -----------------------------------------------------
    // FRIBB
    // -----------------------------------------------------

    const mapping =
      await resolveFribbMapping({
        tmdbId,
        mediaType:
          isMovie
            ? "movie"
            : "tv",
        season:
          seasonNumber,
        episode:
          originalEpisode
      });

    if (
      !mapping?.anilistId
    ) {
      log(
        "STOP: NO FRIBB AniList MAPPING"
      );

      return [];
    }

    const mappedEpisode =
      Number(
        mapping.episode
      ) ||
      originalEpisode;

    log(
      "MAPPING COMPLETE",
      `TMDB=${tmdbId}`,
      `IMDb=${tmdb.imdbId}`,
      `AniList=${mapping.anilistId}`,
      `InputEpisode=${originalEpisode}`,
      `MappedEpisode=${mappedEpisode}`
    );

    // -----------------------------------------------------
    // REANIME
    //
    // Cinemeta is intentionally NOT required here.
    // Fribb already gave us the AniList ID needed by
    // /api/flix/{anilistId}/{episode}.
    // -----------------------------------------------------

    log(
      "CINEMETA",
      "SKIPPED - AniList mapping already available"
    );

    const slug =
      null;

    // -----------------------------------------------------
    // SETTINGS
    // -----------------------------------------------------

    const settings =
      globalThis.SCRAPER_SETTINGS ||
      {};

    const languages = [];

    if (
      settings.reanime_sub !==
      false
    ) {
      languages.push(
        "sub"
      );
    }

    if (
      settings.reanime_dub !==
      false
    ) {
      languages.push(
        "dub"
      );
    }

    log(
      "LANGUAGE SETTINGS",
      JSON.stringify(
        settings
      )
    );

    log(
      "LANGUAGES",
      languages.join(",") ||
        "NONE"
    );

    if (
      !languages.length
    ) {
      log(
        "STOP: NO LANGUAGES ENABLED"
      );

      return [];
    }

    // -----------------------------------------------------
    // REANIME SERVER DISCOVERY
    // -----------------------------------------------------

    section(
      "REANIME SERVER DISCOVERY"
    );

    log(
      "ACTIVE DOMAIN BEFORE DISCOVERY",
      activeBaseUrl
    );

    const serversByLanguage =
      Object.create(null);

    for (
      const language of languages
    ) {
      try {
        const result =
          await getFlixEmbeds(
            slug,
            mappedEpisode,
            language,
            mapping.anilistId
          );

        if (
          result?.servers?.length
        ) {
          serversByLanguage[
            language
          ] =
            result.servers;

          log(
            "SERVERS STORED",
            language,
            result.servers.length
          );
        } else {
          log(
            "NO SERVERS",
            language
          );
        }
      } catch (e) {
        log(
          "SERVER DISCOVERY FAILED",
          language,
          e?.message ||
            String(e)
        );
      }
    }

    const languagesWithServers =
      Object.keys(
        serversByLanguage
      );

    if (
      !languagesWithServers.length
    ) {
      log(
        "STOP: NO REANIME SERVERS"
      );

      log(
        "REANIME DOMAINS TESTED",
        REANIME_DOMAINS.join(
          ", "
        )
      );

      log(
        "ACTIVE REANIME DOMAIN",
        activeBaseUrl
      );

      return [];
    }

    log(
      "SERVER SUMMARY",
      languagesWithServers
        .map(
          language =>
            `${language}=${serversByLanguage[language].length}`
        )
        .join(" ")
    );

    log(
      "REANIME DOMAIN SUCCESS",
      activeBaseUrl
    );

    // -----------------------------------------------------
    // STREAM RESOLUTION
    // -----------------------------------------------------

    const tasks = [];

    for (
      const language of languages
    ) {
      const servers =
        serversByLanguage[
          language
        ] || [];

      for (
        let index = 0;
        index < servers.length;
        index++
      ) {
        const server =
          servers[index];

        const dataLink =
          server?.dataLink;

        if (!dataLink) {
          log(
            "SERVER SKIPPED: NO DATALINK",
            language,
            index + 1
          );

          continue;
        }

        const serverName =
          server.serverName ||
          `HD-${index + 1}`;

        const languageUpper =
          language.toUpperCase();

        const title =
          isMovie
            ? `${tmdb.title} (${languageUpper})`
            : `${tmdb.title} - Episode ${originalEpisode} (${languageUpper})`;

        log(
          "QUEUE SERVER",
          `language=${language}`,
          `server=${serverName}`,
          `dataLink=${dataLink}`
        );

        tasks.push(
          (async () => {
            // ------------------------------------------------
            // DIRECT MKV
            // ------------------------------------------------

            try {
              const direct =
                await extractFlixCloudDownload(
                  dataLink
                );

              if (
                direct?.url
              ) {
                log(
                  "STREAM SUCCESS: DIRECT MKV",
                  serverName,
                  direct.quality
                );

                return {
                  name:
                    `Reanime [${languageUpper}] ` +
                    `${serverName} ` +
                    `(${direct.quality})`,
                  title,
                  url:
                    direct.url,
                  quality:
                    direct.quality,
                  size:
                    direct.size,
                  headers:
                    direct.headers,
                  provider:
                    "reanime",
                  type:
                    "mkv"
                };
              }

              log(
                "DIRECT MKV NOT AVAILABLE",
                serverName
              );
            } catch (e) {
              log(
                "DIRECT MKV EXCEPTION",
                serverName,
                e?.message ||
                  String(e)
              );
            }

            // ------------------------------------------------
            // HLS
            // ------------------------------------------------

            try {
              const resolved =
                await resolveFlixCloud(
                  dataLink
                );

              if (
                resolved?.url
              ) {
                log(
                  "STREAM SUCCESS: HLS",
                  serverName
                );

                return {
                  name:
                    `Reanime [${languageUpper}] ` +
                    `${serverName} (Auto)`,
                  title,
                  url:
                    resolved.url,
                  quality:
                    "Auto",
                  provider:
                    "reanime",
                  type:
                    "m3u8",
                  subtitles:
                    resolved.subtitles ||
                    []
                };
              }

              log(
                "HLS RESOLVER RETURNED NO URL",
                serverName
              );
            } catch (e) {
              log(
                "HLS EXCEPTION",
                serverName,
                e?.stack ||
                  e?.message ||
                  e
              );
            }

            log(
              "SERVER FAILED COMPLETELY",
              serverName,
              language
            );

            return null;
          })()
        );
      }
    }

    log(
      "STREAM TASK COUNT",
      tasks.length
    );

    if (!tasks.length) {
      log(
        "STOP: NO STREAM TASKS"
      );

      return [];
    }

    const results =
      await Promise.all(
        tasks
      );

    const streams = [];
    const seen =
      new Set();

    for (
      const result of results
    ) {
      if (
        !result?.url
      ) {
        continue;
      }

      if (
        seen.has(
          result.name
        )
      ) {
        log(
          "DUPLICATE STREAM SKIPPED",
          result.name
        );

        continue;
      }

      seen.add(
        result.name
      );

      streams.push(
        result
      );
    }

    // -----------------------------------------------------
    // QUALITY SORT
    // -----------------------------------------------------

    const qualityRank = {
      auto: 4000,
      adaptive: 4000,
      "2160p": 2160,
      "4k": 2160,
      "1080p": 1080,
      "720p": 720,
      "480p": 480,
      "360p": 360,
      unknown: 0
    };

    streams.sort(
      (a, b) => {
        const aQuality =
          String(
            a?.quality ||
              "unknown"
          ).toLowerCase();

        const bQuality =
          String(
            b?.quality ||
              "unknown"
          ).toLowerCase();

        return (
          (
            qualityRank[
              bQuality
            ] || 0
          ) -
          (
            qualityRank[
              aQuality
            ] || 0
          )
        );
      }
    );

    // -----------------------------------------------------
    // FINAL LOGGING
    // -----------------------------------------------------

    section(
      "REANIME FINAL RESULT"
    );

    log(
      "STREAM COUNT",
      streams.length
    );

    for (
      let i = 0;
      i < streams.length;
      i++
    ) {
      const stream =
        streams[i];

      log(
        `STREAM ${i + 1}`,
        JSON.stringify({
          name:
            stream.name,
          quality:
            stream.quality,
          type:
            stream.type,
          provider:
            stream.provider,
          size:
            stream.size ||
            null
        })
      );
    }

    log(
      "FINAL ID CHAIN",
      `TMDB=${tmdbId}`,
      `IMDb=${tmdb.imdbId}`,
      `AniList=${mapping.anilistId}`,
      `Episode=${mappedEpisode}`
    );

    log(
      "ACTIVE REANIME DOMAIN",
      activeBaseUrl
    );

    log(
      "DONE",
      `${streams.length} stream(s)`
    );

    log(
      "========================================"
    );

    return streams;
  } catch (e) {
    err(
      "FATAL GETSTREAMS ERROR",
      e?.stack ||
        e?.message ||
        e
    );

    return [];
  }
}

// =========================================================
// SETTINGS
// =========================================================

async function onSettings() {
  return [
    {
      type: "header",
      label: "Reanime"
    },
    {
      type: "toggle",
      key: "reanime_sub",
      label: "Subtitles",
      defaultValue: true
    },
    {
      type: "toggle",
      key: "reanime_dub",
      label: "Dub",
      defaultValue: true
    }
  ];
}

module.exports = {
  getStreams,
  onSettings
};
