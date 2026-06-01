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

        // Step 1: Get internal catalog ID from AniList ID via GraphQL
        const query = `{ anime(anilistId: ${anilistId}) { id anilistId } }`;
        const data = await graphqlQuery(query);

        if (!data || !data.anime || !data.anime.id) {
            return JSON.stringify([{ href: "Error", number: "Error" }]);
        }

        const catalogId = data.anime.id;

        // Step 2: Get episode list from REST API
        const episodes = await restGet(`/episodes?id=${encodeURIComponent(catalogId)}`);

        if (!episodes || !Array.isArray(episodes)) {
            return JSON.stringify([{ href: "Error", number: "Error" }]);
        }

        const results = [];
        for (const ep of episodes) {
            const epTitle = (ep.titles && ep.titles.en) ? ` - ${ep.titles.en}` : "";
            results.push({
                number: ep.number || 0,
                href: `${catalogId}|${ep.number}`,
                title: epTitle
            });
        }

        if (results.length === 0) {
            return JSON.stringify([{ href: "Error", number: "Error" }]);
        }

        // Return newest first
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

        // Step 1: Get available servers
        const servers = await restGet(`/servers?id=${encodeURIComponent(catalogId)}&epNum=${epNum}`);

        if (!servers) {
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const streams = [];
        let subtitleUrl = null;

        // Priority order for providers: best quality & features first
        const subProviders = servers.subProviders || [];
        const dubProviders = servers.dubProviders || [];

        // Preferred providers for soft subs (yuki, vee) then hard subs (uwu, kiwi, mochi, mimi)
        const preferredSub = ["yuki", "vee", "uwu", "kiwi", "mochi", "mimi", "beep"];
        const preferredDub = ["yuki", "uwu", "kiwi", "mochi", "mimi"];

        // Function to fetch and add streams for a provider
        async function addProviderStreams(providerId, type, label) {
            try {
                const sources = await restGet(
                    `/sources?id=${encodeURIComponent(catalogId)}&epNum=${epNum}&type=${type}&providerId=${providerId}`
                );

                if (!sources || !sources.sources || sources.sources.length === 0) return;

                const referer = sources.headers && sources.headers.Referer ? sources.headers.Referer : "";

                for (const src of sources.sources) {
                    const quality = src.quality || "auto";
                    const streamHeaders = referer ? { "Referer": referer } : {};

                    streams.push({
                        title: `${label} - ${quality}`,
                        streamUrl: src.url,
                        headers: streamHeaders
                    });
                }

                // Grab subtitle tracks from soft sub providers
                if (type === "sub" && sources.tracks && Array.isArray(sources.tracks) && sources.tracks.length > 0 && !subtitleUrl) {
                    const defaultTrack = sources.tracks.find(t => t.default) || sources.tracks[0];
                    subtitleUrl = defaultTrack.url || null;
                }
            } catch (e) {
                // Silently skip failed providers
            }
        }

        // Fetch streams for top sub providers (limit to 3 to keep it fast)
        const subToFetch = subProviders
            .filter(p => preferredSub.includes(p.id))
            .sort((a, b) => preferredSub.indexOf(a.id) - preferredSub.indexOf(b.id))
            .slice(0, 3);

        // Fetch streams for top dub providers (limit to 2)
        const dubToFetch = dubProviders
            .filter(p => preferredDub.includes(p.id))
            .sort((a, b) => preferredDub.indexOf(a.id) - preferredDub.indexOf(b.id))
            .slice(0, 2);

        // If no preferred providers matched, use defaults
        if (subToFetch.length === 0 && subProviders.length > 0) {
            subToFetch.push(subProviders[0]);
        }
        if (dubToFetch.length === 0 && dubProviders.length > 0) {
            dubToFetch.push(dubProviders[0]);
        }

        // Fetch SUB streams
        for (const provider of subToFetch) {
            await addProviderStreams(provider.id, "sub", `SUB - ${capitalize(provider.id)}`);
        }

        // Fetch DUB streams
        for (const provider of dubToFetch) {
            await addProviderStreams(provider.id, "dub", `DUB - ${capitalize(provider.id)}`);
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

// ─── Utility: Capitalize string ───
function capitalize(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}
