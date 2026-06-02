/**
 * Torrentio Anime - Sora Module
 * Source: https://torrentio.strem.fun
 * 
 * Matches Aniyomi TorrentioAnime extension behavior:
 * - Search via AniList GraphQL API
 * - Details from AniList GraphQL (id-based query)
 * - Episodes from api.ani.zip/mappings (kitsu ID mapping)
 * - Streams from torrentio.strem.fun/stream/{type}/kitsu:{id}:{ep}.json
 * - Each stream = magnet link with infoHash + fileIdx
 */

const BASE_URL = "https://torrentio.strem.fun";
const ANILIST_API = "https://graphql.anilist.co";
const ANIZIP_API = "https://api.ani.zip/mappings";

// Anime trackers (same as Aniyomi extension)
const ANIME_TRACKERS = [
    "http://nyaa.tracker.wf:7777/announce",
    "http://anidex.moe:6969/announce",
    "http://tracker.anirena.com:80/announce",
    "udp://tracker.uw0.xyz:6969/announce",
    "http://share.camoe.cn:8080/announce",
    "http://t.nyaatracker.com:80/announce",
    "udp://47.ip-51-68-199.eu:6969/announce",
    "udp://9.rarbg.me:2940",
    "udp://9.rarbg.to:2820",
    "udp://exodus.desync.com:6969/announce",
    "udp://explodie.org:6969/announce",
    "udp://ipv4.tracker.harry.lu:80/announce",
    "udp://open.stealth.si:80/announce",
    "udp://opentor.org:2710/announce",
    "udp://opentracker.i2p.rocks:6969/announce",
    "udp://retracker.lanta-net.ru:2710/announce",
    "udp://tracker.cyberia.is:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://tracker.ds.is:6969/announce",
    "udp://tracker.internetwarriors.net:1337",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://valakas.rollo.dnsabr.com:2710/announce",
    "udp://www.torrent.eu.org:451/announce"
];

// ─── SEARCH ────────────────────────────────────────────────────────────────────
// Uses AniList GraphQL API

const SEARCH_QUERY = `
query($page: Int, $perPage: Int, $sort: [MediaSort], $search: String) {
    Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(type: ANIME, sort: $sort, search: $search, isAdult: false) {
            id
            title { romaji english native }
            coverImage { extraLarge large }
            description
            status
            episodes
            format
            genres
            studios { nodes { name } }
        }
    }
}
`;

async function searchResults(keyword) {
    const results = [];
    try {
        const variables = JSON.stringify({
            page: 1,
            perPage: 30,
            sort: ["TRENDING_DESC"],
            search: keyword
        });

        const body = `query=${encodeURIComponent(SEARCH_QUERY)}&variables=${encodeURIComponent(variables)}`;
        const response = await soraFetch(ANILIST_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json"
            },
            body: body
        });

        const json = await response.json();
        const mediaList = json?.data?.Page?.media || [];

        for (const media of mediaList) {
            const title = media.title?.romaji || media.title?.english || media.title?.native || "Unknown";
            const image = media.coverImage?.extraLarge || media.coverImage?.large || "";
            const anilistId = media.id;

            results.push({
                title: title,
                image: image,
                href: `anilist:${anilistId}`,
                description: cleanHtml(media.description || ""),
                status: media.status || "",
                episodes: media.episodes || 0,
                format: media.format || "",
                genres: (media.genres || []).join(", ")
            });
        }

        return JSON.stringify(results);
    } catch (err) {
        console.error("Search error:", err);
        return JSON.stringify([]);
    }
}

// ─── DETAILS ───────────────────────────────────────────────────────────────────
// Uses AniList GraphQL detail query

const DETAILS_QUERY = `
query media($id: Int) {
    Media(id: $id, isAdult: false) {
        id
        title { romaji english native }
        coverImage { extraLarge large medium }
        description
        season
        seasonYear
        format
        status
        genres
        episodes
        tags { name }
        studios { nodes { id name } }
    }
}
`;

async function extractDetails(url) {
    try {
        // Extract anilist ID from href
        const idMatch = url.match(/anilist:(\d+)/);
        if (!idMatch) {
            return JSON.stringify([{ description: "Invalid URL", aliases: "N/A", airdate: "N/A" }]);
        }
        const anilistId = idMatch[1];

        const variables = JSON.stringify({ id: parseInt(anilistId) });
        const body = `query=${encodeURIComponent(DETAILS_QUERY)}&variables=${encodeURIComponent(variables)}`;
        const response = await soraFetch(ANILIST_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json"
            },
            body: body
        });

        const json = await response.json();
        const media = json?.data?.Media;

        if (!media) {
            return JSON.stringify([{ description: "Not found", aliases: "N/A", airdate: "N/A" }]);
        }

        const title = media.title?.romaji || media.title?.english || "";
        const description = cleanHtml(media.description || "No description");
        const season = media.season || "";
        const seasonYear = media.seasonYear || "";
        const format = media.format || "";
        const episodeCount = media.episodes || 0;
        const genres = (media.genres || []).join(", ");
        const tags = (media.tags || []).map(t => t.name).join(", ");
        const studios = (media.studios?.nodes || []).map(s => s.name).join(", ");

        const fullDescription = `${description}\n\nRelease: ${season} ${seasonYear}\nType: ${format}\nTotal Episodes: ${episodeCount}\nStudios: ${studios}\nGenres: ${genres}\nTags: ${tags}`;

        return JSON.stringify([{
            description: fullDescription,
            aliases: title,
            airdate: `${season} ${seasonYear}`,
            image: media.coverImage?.extraLarge || ""
        }]);
    } catch (err) {
        console.error("Details error:", err);
        return JSON.stringify([{
            description: "Error: " + err.message,
            aliases: "N/A",
            airdate: "N/A"
        }]);
    }
}

// ─── EPISODES ──────────────────────────────────────────────────────────────────
// Uses api.ani.zip/mappings?anilist_id={id}
// Gets kitsuId + episode list, then builds torrentio stream URLs

async function extractEpisodes(url) {
    try {
        const idMatch = url.match(/anilist:(\d+)/);
        if (!idMatch) {
            return JSON.stringify([{ href: url, number: 1 }]);
        }
        const anilistId = idMatch[1];

        // Fetch from ani.zip to get kitsu ID and episode mapping
        const anizipUrl = `${ANIZIP_API}?anilist_id=${anilistId}`;
        const response = await soraFetch(anizipUrl);
        const json = await response.json();

        const mappings = json.mappings || {};
        const kitsuId = mappings.kitsu_id;
        const mediaType = mappings.type || "TV";

        if (!kitsuId) {
            return JSON.stringify([{ href: url, number: 1 }]);
        }

        const episodes = json.episodes || {};

        if (mediaType === "MOVIE") {
            // Movie: single stream URL (full URL like other Sora modules)
            const movieStreamUrl = `${BASE_URL}/providers=nyaasi,tokyotosho,anidex,horriblesubs|language=japanese|qualityfilter=720p,480p,other,scr,cam,unknown|sort=quality/stream/movie/kitsu:${kitsuId}.json`;
            return JSON.stringify([{
                href: movieStreamUrl,
                number: 1,
                name: "Movie"
            }]);
        }

        // TV/ONA/OVA: build episode list
        const episodeList = [];
        for (const [key, ep] of Object.entries(episodes)) {
            if (!ep || !ep.episode) continue;

            const episodeNum = parseFloat(ep.episode);
            if (isNaN(episodeNum)) continue;

            const title = ep.title?.en || null;
            const epName = title ? `Episode ${ep.episode}: ${title}` : `Episode ${ep.episode}`;
            const epNumInt = Math.round(episodeNum);

            // Use FULL URL (like other Sora modules) so Sora passes it correctly
            const fullStreamUrl = `${BASE_URL}/providers=nyaasi,tokyotosho,anidex,horriblesubs|language=japanese|qualityfilter=720p,480p,other,scr,cam,unknown|sort=quality/stream/series/kitsu:${kitsuId}:${epNumInt}.json`;

            episodeList.push({
                href: fullStreamUrl,
                number: episodeNum,
                name: epName,
                date: ep.airDate || ""
            });
        }

        if (episodeList.length === 0) {
            return JSON.stringify([{ href: url, number: 1 }]);
        }

        return JSON.stringify(episodeList);
    } catch (err) {
        console.error("Episodes error:", err);
        return JSON.stringify([{ href: "Error", number: 1 }]);
    }
}

// ─── STREAM URL ────────────────────────────────────────────────────────────────
// Fetches from torrentio.strem.fun/stream/...
// Returns list of magnet links with infoHash + fileIdx

async function extractStreamUrl(url) {
    try {
        let streamUrl;

        if (url.startsWith("http") && url.includes("/stream/")) {
            // Full URL from extractEpisodes (already has providers config)
            streamUrl = url;
        } else if (url.startsWith("/stream/")) {
            // Legacy relative path - build full torrentio URL with providers
            streamUrl = `${BASE_URL}/providers=nyaasi,tokyotosho,anidex,horriblesubs|language=japanese|qualityfilter=720p,480p,other,scr,cam,unknown|sort=quality${url}`;
        } else if (url.startsWith("http")) {
            // Some other full URL
            streamUrl = url;
        } else {
            return JSON.stringify({ streams: [], subtitle: "" });
        }

        const response = await soraFetch(streamUrl);
        const json = await response.json();
        const streams = json.streams || [];

        // Build tracker string for magnet links
        const trackerList = ANIME_TRACKERS.map(t => t.trim()).filter(t => t).join("&tr=");

        const streamResults = streams.map(stream => {
            const infoHash = stream.infoHash || "";
            const fileIdx = stream.fileIdx != null ? stream.fileIdx : 0;
            const name = (stream.name || "").replace("Torrentio\n", "");
            const title = stream.title || "";

            // Build magnet link
            const magnetUrl = `magnet:?xt=urn:btih:${infoHash}&dn=${infoHash}&tr=${trackerList}&index=${fileIdx}`;

            return {
                title: `${name} ${title}`.trim(),
                streamUrl: magnetUrl,
                headers: {}
            };
        });

        // Sort: prefer 1080p, then seeders (same logic as Aniyomi's sort)
        streamResults.sort((a, b) => {
            const a1080 = a.title.includes("1080p") ? 0 : 1;
            const b1080 = b.title.includes("1080p") ? 0 : 1;
            return a1080 - b1080;
        });

        // Get infoHash from first stream
        const firstHash = streams.length > 0 ? (streams[0].infoHash || "") : "";

        return JSON.stringify({
            streams: streamResults,
            subtitle: "",
            infoHash: firstHash
        });
    } catch (err) {
        console.error("Stream extraction error:", err);
        return JSON.stringify({ streams: [], subtitle: "" });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function cleanHtml(text) {
    if (!text) return "";
    return text
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<br>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#[0-9]+;/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

async function soraFetch(url, options = {}) {
    try {
        const headers = options.headers || {};
        const method = options.method || "GET";
        const body = options.body || null;
        return await fetchv2(url, headers, method, body);
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            console.error("Fetch failed:", error);
            return null;
        }
    }
}
