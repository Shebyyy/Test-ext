// AniStream Sora Module
// Author: Sheby
// Powered by animex API (graphql.animex.one + pp.animex.one)

const GRAPHQL_URL = "https://graphql.animex.one/graphql";
const REST_URL = "https://pp.animex.one/rest/api";
const HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
};

// ─── Helper: Custom fetch with fetchv2 fallback ───
async function soraFetch(url, options = {}) {
    try {
        const method = options.method || "GET";
        const headers = options.headers || {};
        const body = options.body || null;
        const res = await fetchv2(url, headers, method, body);
        return res;
    } catch (e) {
        try {
            const res = await fetch(url, {
                method: options.method || "GET",
                headers: options.headers || {},
                body: options.body || undefined
            });
            return res;
        } catch (err) {
            return null;
        }
    }
}

// ─── Helper: GraphQL query ───
async function graphqlQuery(query) {
    const res = await soraFetch(GRAPHQL_URL, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ query: query, variables: {} })
    });
    if (!res) return null;
    try {
        const data = await res.json();
        return data.data;
    } catch (e) {
        return null;
    }
}

// ─── Helper: REST API GET ───
async function restGet(endpoint) {
    const res = await soraFetch(REST_URL + endpoint, { headers: HEADERS });
    if (!res) return null;
    try {
        return await res.json();
    } catch (e) {
        return null;
    }
}

// ─── Helper: Ensure Referer ends with / ───
function fixReferer(referer) {
    if (!referer) return "";
    if (referer.endsWith("/") || referer.endsWith('"')) return referer;
    return referer + "/";
}

// ─── 1. Search Results ───
async function searchResults(keyword) {
    try {
        const query = `{ searchAnime(query: "${keyword.replace(/"/g, '\\"')}", limit: 24) { items { anilistId titleRomaji titleEnglish coverImage } } }`;
        const data = await graphqlQuery(query);

        const searchResult = data.searchAnime;
        if (!searchResult || !searchResult.items || !Array.isArray(searchResult.items)) {
            return JSON.stringify([{ title: "No results found", image: "Error", href: "Error" }]);
        }

        const results = [];
        for (const anime of searchResult.items) {
            const title = anime.titleEnglish || anime.titleRomaji || "Unknown";
            const cover = anime.coverImage;
            const image = (cover && cover.extraLarge) ? cover.extraLarge : ((cover && cover.large) ? cover.large : "Error");
            const anilistId = anime.anilistId || anime.id;
            results.push({
                title: title,
                image: image,
                href: String(anilistId)
            });
        }

        if (results.length === 0) {
            return JSON.stringify([{ title: "No results found", image: "Error", href: "Error" }]);
        }

        return JSON.stringify(results);
    } catch (err) {
        return JSON.stringify([{ title: "Error", image: "Error", href: "Error" }]);
    }
}

// ─── 2. Extract Details ───
async function extractDetails(url) {
    try {
        const anilistId = url.trim();
        const query = `{ anime(anilistId: ${anilistId}) { titleRomaji titleEnglish description status format episodeCount seasonYear season averageScore genres synonyms } }`;
        const data = await graphqlQuery(query);

        if (!data || !data.anime) {
            return JSON.stringify([{ description: "Error", aliases: "Error", airdate: "Error" }]);
        }

        const anime = data.anime;
        const desc = anime.description || "No description available.";
        const aliases = (anime.synonyms && anime.synonyms.length > 0)
            ? anime.synonyms.join(", ")
            : (anime.titleRomaji || "");
        const airdate = (anime.seasonYear && anime.season)
            ? `${anime.season.charAt(0).toUpperCase() + anime.season.slice(1)} ${anime.seasonYear}`
            : (anime.seasonYear || anime.status || "Unknown");

        return JSON.stringify([{
            description: desc,
            aliases: aliases,
            airdate: airdate
        }]);
    } catch (err) {
        return JSON.stringify([{ description: "Error", aliases: "Error", airdate: "Error" }]);
    }
}

// ─── 3. Extract Episodes ───
async function extractEpisodes(url) {
    try {
        const anilistId = url.trim();

        const query = `{ anime(anilistId: ${anilistId}) { id anilistId } }`;
        const data = await graphqlQuery(query);

        if (!data || !data.anime || !data.anime.id) {
            return JSON.stringify([{ href: "Error", number: "Error" }]);
        }

        const catalogId = data.anime.id;

        const episodes = await restGet(`/episodes?id=${encodeURIComponent(catalogId)}`);

        if (!episodes || !Array.isArray(episodes)) {
            return JSON.stringify([{ href: "Error", number: "Error" }]);
        }

        const results = [];
        for (const ep of episodes) {
            results.push({
                number: ep.number || 0,
                href: `${catalogId}|${ep.number}`
            });
        }

        if (results.length === 0) {
            return JSON.stringify([{ href: "Error", number: "Error" }]);
        }

        // Reverse so newest episode appears first (like other Sora modules)
        results.reverse();

        return JSON.stringify(results);
    } catch (err) {
        return JSON.stringify([{ href: "Error", number: "Error" }]);
    }
}

// ─── 4. Extract Stream URL ───
async function extractStreamUrl(url) {
    try {
        const parts = url.trim().split("|");
        if (parts.length < 2) {
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const catalogId = parts[0];
        const epNum = parts[1];

        const servers = await restGet(`/servers?id=${encodeURIComponent(catalogId)}&epNum=${epNum}`);

        if (!servers || !servers.subProviders) {
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const streams = [];
        let subtitleUrl = "";
        let subtitleHeaders = {};
        const subProviders = servers.subProviders || [];
        const dubProviders = servers.dubProviders || [];

        // Process providers and collect all sources + subtitles
        for (const provider of subProviders) {
            try {
                const sources = await restGet(
                    `/sources?id=${encodeURIComponent(catalogId)}&epNum=${epNum}&type=sub&providerId=${provider.id}`
                );

                // Skip if API returned an error
                if (!sources || sources.error || !sources.sources || !Array.isArray(sources.sources) || sources.sources.length === 0) continue;

                // Fix Referer: ensure trailing slash
                const rawReferer = (sources.headers && sources.headers.Referer) ? sources.headers.Referer : "";
                const referer = fixReferer(rawReferer);
                const streamHeaders = referer ? { "Referer": referer } : {};

                // Also copy any other useful headers (Origin, User-Agent)
                if (sources.headers && sources.headers.Origin) streamHeaders["Origin"] = sources.headers.Origin;

                for (const src of sources.sources) {
                    var quality = src.quality || "default";
                    streams.push({
                        title: "SUB - " + capitalize(provider.id) + " - " + quality,
                        streamUrl: src.url,
                        headers: streamHeaders
                    });
                }

                // Extract subtitles: only kind=captions, prefer English default
                if (sources.tracks && Array.isArray(sources.tracks)) {
                    var captionTracks = sources.tracks.filter(function(t) {
                        return t.kind === "captions" && t.url;
                    });
                    if (captionTracks.length > 0) {
                        // Prefer English default track
                        var engDefault = captionTracks.find(function(t) {
                            return t.default && (t.lang || t.label || "").toLowerCase().indexOf("english") !== -1;
                        });
                        var anyDefault = captionTracks.find(function(t) { return t.default; });
                        var engTrack = captionTracks.find(function(t) {
                            return (t.lang || t.label || "").toLowerCase().indexOf("english") !== -1;
                        });
                        var bestTrack = engDefault || anyDefault || engTrack || captionTracks[0];
                        if (bestTrack && bestTrack.url) {
                            subtitleUrl = bestTrack.url;
                            subtitleHeaders = streamHeaders;
                        }
                    }
                }
            } catch (e) {
                // Skip failed providers silently
            }
        }

        // Process dub providers
        for (const provider of dubProviders) {
            try {
                const sources = await restGet(
                    `/sources?id=${encodeURIComponent(catalogId)}&epNum=${epNum}&type=dub&providerId=${provider.id}`
                );

                if (!sources || sources.error || !sources.sources || !Array.isArray(sources.sources) || sources.sources.length === 0) continue;

                const rawReferer = (sources.headers && sources.headers.Referer) ? sources.headers.Referer : "";
                const referer = fixReferer(rawReferer);
                const streamHeaders = referer ? { "Referer": referer } : {};

                if (sources.headers && sources.headers.Origin) streamHeaders["Origin"] = sources.headers.Origin;

                for (const src of sources.sources) {
                    var quality = src.quality || "default";
                    streams.push({
                        title: "DUB - " + capitalize(provider.id) + " - " + quality,
                        streamUrl: src.url,
                        headers: streamHeaders
                    });
                }

                // Also grab subtitles from dub providers
                if (!subtitleUrl && sources.tracks && Array.isArray(sources.tracks)) {
                    var captionTracks = sources.tracks.filter(function(t) {
                        return t.kind === "captions" && t.url;
                    });
                    if (captionTracks.length > 0) {
                        var anyDefault = captionTracks.find(function(t) { return t.default; });
                        var bestTrack = anyDefault || captionTracks[0];
                        if (bestTrack && bestTrack.url) {
                            subtitleUrl = bestTrack.url;
                            subtitleHeaders = streamHeaders;
                        }
                    }
                }
            } catch (e) {
                // Skip failed providers silently
            }
        }

        if (streams.length === 0) {
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        return JSON.stringify({
            streams: streams,
            subtitle: subtitleUrl || ""
        });
    } catch (err) {
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

// ─── Utility ───
function capitalize(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}
