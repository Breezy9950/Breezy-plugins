function onSettings() {
  return [
    { type: "header", label: "Preferences" },
    { type: "toggle", key: "enableDub", label: "Enable Dub", defaultValue: true }
  ];
}
function isDubEnabled() {
  const settings = typeof globalThis !== "undefined" && globalThis.SCRAPER_SETTINGS ? globalThis.SCRAPER_SETTINGS : {};
  return settings.enableDub !== false;
}
function isDubFormat(format) {
  return format === "Dub" || format === "Dual Audio";
}
function searchCards(query) {
  return __async(this, null, function* () {
    if (!query)
      return [];
    const searchUrl = `/anime?search=${encodeURIComponent(query)}&sort=title-asc`;
    const searchHtml = yield fetchText(searchUrl);
    if (!searchHtml)
      return [];
    const $search = import_cheerio_without_node_native.default.load(searchHtml);
    return parseCards(searchHtml, $search);
  });
}
function getStreams(tmdbId, mediaType = "tv", season = 1, episode = 1) {
  return __async(this, null, function* () {
    var _a, _b, _c;
    try {
      console.log(`[AniZone] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}, S${season}E${episode}`);
      let animeTitle = "";
      let altTitles = [];
      let mappedEp = episode;
      let seasonName = "";
      let targetTitles = [];
      if (mediaType === "tv") {
        const imdbId = yield getImdbId(tmdbId, "tv");
        if (imdbId) {
          const mapping = yield resolveMapping(imdbId, season, episode, tmdbId);
          if (mapping) {
            mappedEp = mapping.mal_episode || episode;
            animeTitle = mapping.anime_title || "";
            if (mapping.titles && Array.isArray(mapping.titles))
              targetTitles.push(...mapping.titles);
            const malTitle = yield getMalTitle(mapping.mal_id);
            if (malTitle) {
              targetTitles.push(malTitle);
              if (!animeTitle)
                animeTitle = malTitle;
            }
            console.log(`[AniZone] AnimeSync mapped: "${animeTitle}", mappedEp=${mappedEp}`);
          }
        }
        if (!animeTitle) {
          const tmdbInfo = yield getTmdbInfo(tmdbId, mediaType, season);
          if (tmdbInfo) {
            animeTitle = tmdbInfo.title;
            if (tmdbInfo.originalTitle)
              altTitles.push(tmdbInfo.originalTitle);
            seasonName = tmdbInfo.seasonName || "";
          }
        }
      } else {
        const tmdbInfo = yield getTmdbInfo(tmdbId, "movie");
        if (tmdbInfo) {
          animeTitle = tmdbInfo.title;
          if (tmdbInfo.originalTitle)
            altTitles.push(tmdbInfo.originalTitle);
        }
        mappedEp = 1;
      }
      if (!animeTitle && targetTitles.length === 0)
        return [];
      if (!animeTitle && targetTitles.length > 0)
        animeTitle = targetTitles[0];
      const specificTargetTitles = season === 1 || mediaType === "movie" ? [...targetTitles, animeTitle, ...altTitles] : [...targetTitles];
      const baseCleanQuery = animeTitle.split(":")[0].replace(/season.*|\d+nd season|\d+rd season|\d+th season|saison.*/gi, "").trim();
      let cards = yield searchCards(baseCleanQuery);
      if (cards.length === 0 && animeTitle !== baseCleanQuery)
        cards = yield searchCards(animeTitle.split(":")[0].trim());
      if (cards.length === 0) {
        for (const t of altTitles) {
          const altClean = t.split(":")[0].trim();
          cards = yield searchCards(altClean);
          if (cards.length > 0)
            break;
        }
      }
      if (cards.length === 0)
        return [];
      let animeSlug = null;
      if (mediaType === "tv")
        animeSlug = matchCard(cards, specificTargetTitles, baseCleanQuery, season, seasonName);
      else
        animeSlug = matchMovieCard(cards, specificTargetTitles);
      if (!animeSlug) {
        console.log(`[AniZone] No matching slug found for "${animeTitle}"`);
        return [];
      }
      console.log(`[AniZone] Selected slug: "${animeSlug}", mappedEp=${mappedEp}`);
      const episodeUrl = `/anime/${animeSlug}/${mappedEp}`;
      const epResponse = yield fetchWithCookies(episodeUrl);
      if (!epResponse.ok || !epResponse.text) {
        console.log(`[AniZone] Failed to load episode page: ${episodeUrl}`);
        return [];
      }
      const epHtml = epResponse.text;
      const $ep = import_cheerio_without_node_native.default.load(epHtml);
      const streams = [];
      const seenUrls = new Set();
      const defaultStream = parseVidstackFromHtml(epHtml, $ep);
      const serverButtons = $ep('button[wire\\:click*="setVideo"],[wire\\:click*="setVideo"]');
      console.log(`[AniZone] Server buttons found: ${serverButtons.length}`);
      let defaultFormat = "Sub";
      let defaultServerName = "AniZone";
      if (serverButtons.length > 0) {
        const firstBtn = serverButtons.first();
        const btnText = firstBtn.text().replace(/\s+/g, " ").trim();
        defaultFormat = parseAudioFormat(btnText);
        const nameMatch = btnText.match(/^([A-Za-z0-9_-]+)/);
        if (nameMatch)
          defaultServerName = nameMatch[1];
      }
      const addStream = (stream, serverName, format, source = "default") => {
        if (!stream || !stream.masterUrl) {
          console.log(`[AniZone] ${serverName} - ${format}: no stream URL`);
          return;
        }
        if (!isDubEnabled() && isDubFormat(format)) {
          console.log(`[AniZone] ${serverName} - ${format}: skipped (Dub disabled)`);
          return;
        }
        if (seenUrls.has(stream.masterUrl)) {
          console.log(`[AniZone] ${serverName} - ${format}: duplicate skipped`);
          return;
        }
        seenUrls.add(stream.masterUrl);
        streams.push({
          name: "AniZone",
          title: `${animeTitle} - Episode ${mappedEp} [${serverName} - ${format}]`,
          url: stream.masterUrl,
          quality: "Multi",
          headers: HEADERS,
          subtitles: stream.subtitles || []
        });
        console.log(`[AniZone] ${serverName} - ${format}: resolved (${source})`);
      };
      if (defaultStream.masterUrl)
        addStream(defaultStream, defaultServerName, defaultFormat, "initial");
      if (serverButtons.length > 0) {
        const csrfToken = $ep("script[data-csrf]").attr("data-csrf");
        const snapshotEl = $ep("main > div[wire\\:snapshot], main > ul[wire\\:snapshot], [wire\\:snapshot]");
        const snapshot = snapshotEl.attr("wire:snapshot");
        if (!csrfToken || !snapshot || !epResponse.cookies) {
          console.log(`[AniZone] Livewire data unavailable; only initial stream can be used`);
        } else {
          for (let i = 0; i < serverButtons.length; i++) {
            const btn = serverButtons.eq(i);
            const clickAttr = btn.attr("wire:click") || "";
            const vMatch = clickAttr.match(/setVideo\((\d+)\)/);
            const btnText = btn.text().replace(/\s+/g, " ").trim();
            const sFormat = parseAudioFormat(btnText);
            const nameMatch = btnText.match(/^([A-Za-z0-9_-]+)/);
            const sName = nameMatch ? nameMatch[1] : `Server ${i + 1}`;
            console.log(`[AniZone] Server ${i + 1}/${serverButtons.length}: ${sName} - ${sFormat}`);
            if (!vMatch) {
              console.log(`[AniZone] ${sName} - ${sFormat}: no setVideo ID`);
              continue;
            }
            if (!isDubEnabled() && isDubFormat(sFormat)) {
              console.log(`[AniZone] ${sName} - ${sFormat}: skipped (Dub disabled)`);
              continue;
            }
            const videoId = parseInt(vMatch[1], 10);
            try {
              const payload = {
                _token: csrfToken,
                components: [{
                  snapshot,
                  updates: {},
                  calls: [{ path: "", method: "setVideo", params: [videoId] }]
                }]
              };
              const postRes = yield fetchWithTimeout(`${MAIN_URL}/livewire/update`, {
                method: "POST",
                headers: {
                  "Accept": "*/*",
                  "Content-Type": "application/json",
                  "X-Livewire": "",
                  "X-CSRF-TOKEN": csrfToken,
                  "Origin": MAIN_URL,
                  "Referer": `${MAIN_URL}${episodeUrl}`,
                  "Cookie": epResponse.cookies
                },
                body: JSON.stringify(payload)
              }, 8e3);
              if (!postRes.ok) {
                console.log(`[AniZone] ${sName} - ${sFormat}: Livewire HTTP ${postRes.status}`);
                continue;
              }
              const postData = yield postRes.json();
              const liveHtml = (_c = (_b = (_a = postData.components) == null ? void 0 : _a[0]) == null ? void 0 : _b.effects) == null ? void 0 : _c.html;
              if (!liveHtml) {
                console.log(`[AniZone] ${sName} - ${sFormat}: no Livewire HTML`);
                continue;
              }
              const $live = import_cheerio_without_node_native.default.load(liveHtml);
              const extraStream = parseVidstackFromHtml(liveHtml, $live);
              addStream({
                masterUrl: extraStream.masterUrl,
                subtitles: extraStream.subtitles.length > 0 ? extraStream.subtitles : defaultStream.subtitles
              }, sName, sFormat, `server ${i + 1}`);
            } catch (e) {
              console.log(`[AniZone] ${sName} - ${sFormat}: failed - ${e.message}`);
            }
          }
        }
      }
      console.log(`[AniZone] Total unique streams found: ${streams.length}`);
      return streams;
    } catch (error) {
      console.log(`[AniZone] Error: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams, onSettings };
