// Cineby source module - Based on cineby.sc (uses videasy.net backend)
// All 10 servers matching the site exactly
// Thanks ibro for the TMDB search!

const API_BASE = "https://api.videasy.net";
const TMDB_BASE = "https://db.videasy.net";
const PROXY_URL = "https://passthrough-worker.simplepostrequest.workers.dev";
const REFERER = "https%3A%2F%2Fwww.cineby.sc%2F";
const SOURCE_NAME = "Cineby";

// All servers from cineby.sc â€” audioLang is what the user cares about
const SERVERS = [
    { name: "Neon",    path: "/mb-flix/sources-with-title",      flag: "ðŸ‡ºðŸ‡¸", audioLang: "English" },
    { name: "Yoru",    path: "/cdn/sources-with-title",          flag: "ðŸ‡ºðŸ‡¸", audioLang: "English" },
    { name: "Cypher",  path: "/downloader2/sources-with-title",  flag: "ðŸ‡ºðŸ‡¸", audioLang: "English" },
    { name: "Sage",    path: "/1movies/sources-with-title",      flag: "ðŸ‡ºðŸ‡¸", audioLang: "English" },
    { name: "Breach",  path: "/m4uhd/sources-with-title",        flag: "ðŸ‡ºðŸ‡¸", audioLang: "English" },
    { name: "Vyse",    path: "/hdmovie/sources-with-title",      flag: "ðŸ‡ºðŸ‡¸", audioLang: "English", qualityFilter: "English" },
    { name: "Killjoy", path: "/meine/sources-with-title",        flag: "ðŸ‡©ðŸ‡ª", audioLang: "German",  extraParams: { language: "german" } },
    { name: "Fade",    path: "/hdmovie/sources-with-title",      flag: "ðŸ‡®ðŸ‡³", audioLang: "Hindi",   qualityFilter: "Hindi" },
    { name: "Omen",    path: "/lamovie/sources-with-title",      flag: "ðŸ‡²ðŸ‡½", audioLang: "Spanish" },
    { name: "Raze",    path: "/superflix/sources-with-title",    flag: "ðŸ‡§ðŸ‡·", audioLang: "Portuguese" },
];

async function searchResults(keyword) {
    try {
        let transformedResults = [];

        const keywordGroups = {
            trending: ["!trending", "!hot", "!tr", "!!"],
            topRatedMovie: ["!top-rated-movie", "!topmovie", "!tm", "??"],
            topRatedTV: ["!top-rated-tv", "!toptv", "!tt", "::"],
            popularMovie: ["!popular-movie", "!popmovie", "!pm", ";;"],
            popularTV: ["!popular-tv", "!poptv", "!pt", "++"],
        };

        const skipTitleFilter = Object.values(keywordGroups).flat();
        const shouldFilter = !matchesKeyword(keyword, skipTitleFilter);

        const encodedKeyword = encodeURIComponent(keyword);
        let baseUrlTemplate = null;

        if (matchesKeyword(keyword, keywordGroups.trending)) {
            baseUrlTemplate = (page) => `${TMDB_BASE}/3/trending/all/week?language=en&page=${page}`;
        } else if (matchesKeyword(keyword, keywordGroups.topRatedMovie)) {
            baseUrlTemplate = (page) => `${TMDB_BASE}/3/movie/top_rated?language=en&page=${page}`;
        } else if (matchesKeyword(keyword, keywordGroups.topRatedTV)) {
            baseUrlTemplate = (page) => `${TMDB_BASE}/3/tv/top_rated?language=en&page=${page}`;
        } else if (matchesKeyword(keyword, keywordGroups.popularMovie)) {
            baseUrlTemplate = (page) => `${TMDB_BASE}/3/movie/popular?language=en&page=${page}`;
        } else if (matchesKeyword(keyword, keywordGroups.popularTV)) {
            baseUrlTemplate = (page) => `${TMDB_BASE}/3/tv/popular?language=en&page=${page}`;
        } else {
            baseUrlTemplate = (page) => `${TMDB_BASE}/3/search/multi?language=en&page=${page}&query=${encodedKeyword}`;
        }

        let dataResults = [];

        if (baseUrlTemplate) {
            const pagePromises = Array.from({ length: 5 }, (_, i) =>
                soraFetch(baseUrlTemplate(i + 1)).then(r => r.json())
            );
            const pages = await Promise.all(pagePromises);
            dataResults = pages.flatMap(p => p.results || []);
        }

        if (dataResults.length > 0) {
            transformedResults = transformedResults.concat(
                dataResults
                    .map(result => {
                        if (result.media_type === "movie" || result.title) {
                            return {
                                title: result.title || result.name || result.original_title || result.original_name || "Untitled",
                                image: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : "",
                                href: `movie/${result.id}`,
                            };
                        } else if (result.media_type === "tv" || result.name) {
                            return {
                                title: result.name || result.title || result.original_name || result.original_title || "Untitled",
                                image: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : "",
                                href: `tv/${result.id}/1/1`,
                            };
                        }
                    })
                    .filter(Boolean)
                    .filter(result => result.title !== "Overflow")
                    .filter(result => result.title !== "My Marriage Partner Is My Student, a Cocky Troublemaker")
                    .filter(r => !shouldFilter || r.title.toLowerCase().includes(keyword.toLowerCase()))
            );
        }

        console.log("Transformed Results: " + JSON.stringify(transformedResults));
        return JSON.stringify(transformedResults);
    } catch (error) {
        console.log("Fetch error in searchResults: " + error);
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

function matchesKeyword(keyword, commands) {
    const lower = keyword.toLowerCase();
    return commands.some(cmd => lower.startsWith(cmd.toLowerCase()));
}

async function extractDetails(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/movie\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];
            const responseText = await soraFetch(`${TMDB_BASE}/3/movie/${movieId}?append_to_response=external_ids&language=en`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.runtime ? data.runtime + " minutes" : 'Unknown'}`,
                airdate: `Released: ${data.release_date ? data.release_date : 'Unknown'}`
            }];

            return JSON.stringify(transformedResults);
        } else if (url.includes('tv')) {
            const match = url.match(/tv\/([^\/]+)/);
            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];
            const responseText = await soraFetch(`${TMDB_BASE}/3/tv/${showId}?append_to_response=external_ids&language=en`);
            const data = await responseText.json();

            const transformedResults = [{
                description: data.overview || 'No description available',
                aliases: `Duration: ${data.episode_run_time && data.episode_run_time.length ? data.episode_run_time.join(', ') + " minutes" : 'Unknown'}`,
                airdate: `Aired: ${data.first_air_date ? data.first_air_date : 'Unknown'}`
            }];

            console.log(JSON.stringify(transformedResults));
            return JSON.stringify(transformedResults);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Details error: ' + error);
        return JSON.stringify([{
            description: 'Error loading description',
            aliases: 'Duration: Unknown',
            airdate: 'Aired/Released: Unknown'
        }]);
    }
}

async function extractEpisodes(url) {
    try {
        if (url.includes('movie')) {
            const match = url.match(/movie\/([^\/]+)/);

            if (!match) throw new Error("Invalid URL format");

            const movieId = match[1];

            const movie = [
                { href: `/movie/${movieId}`, number: 1, title: "Full Movie" }
            ];

            console.log(movie);
            return JSON.stringify(movie);
        } else if (url.includes('tv')) {
            const match = url.match(/tv\/([^\/]+)\/([^\/]+)\/([^\/]+)/);

            if (!match) throw new Error("Invalid URL format");

            const showId = match[1];

            const showResponseText = await soraFetch(`${TMDB_BASE}/3/tv/${showId}?language=en`);
            const showData = await showResponseText.json();

            let allEpisodes = [];
            for (const season of showData.seasons) {
                const seasonNumber = season.season_number;

                if (seasonNumber === 0) continue;

                const seasonResponseText = await soraFetch(`${TMDB_BASE}/3/tv/${showId}/season/${seasonNumber}?language=en`);
                const seasonData = await seasonResponseText.json();

                if (seasonData.episodes && seasonData.episodes.length) {
                    const episodes = seasonData.episodes.map(episode => ({
                        href: `/tv/${showId}/${seasonNumber}/${episode.episode_number}`,
                        number: episode.episode_number,
                        title: episode.name || ""
                    }));
                    allEpisodes = allEpisodes.concat(episodes);
                }
            }

            console.log(allEpisodes);
            return JSON.stringify(allEpisodes);
        } else {
            throw new Error("Invalid URL format");
        }
    } catch (error) {
        console.log('Fetch error in extractEpisodes: ' + error);
        return JSON.stringify([]);
    }
}

async function fetchServerSources(server, params) {
    try {
        // Build query params â€” server-specific extras like language=german for Killjoy
        let queryParams = `title=${params.title}&mediaType=${params.mediaType}&year=${params.year}&episodeId=${params.episodeId}&seasonId=${params.seasonId}&tmdbId=${params.tmdbId}&imdbId=${params.imdbId}&totalSeasons=${params.totalSeasons || 1}`;
        if (server.extraParams) {
            for (const [key, val] of Object.entries(server.extraParams)) {
                queryParams += `&${key}=${encodeURIComponent(val)}`;
            }
        }
        const url = `${API_BASE}${server.path}?${queryParams}`;
        
        const responseText = await soraFetch(url);
        if (!responseText) return null;
        
        const encrypted = await responseText.text();
        if (!encrypted || encrypted.startsWith('{')) return null;

        const headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
        };

        const postData = JSON.stringify({
            text: encrypted,
            id: String(params.tmdbId).split('-')[0]
        });

        const decryptedResponse = await fetchv2("https://enc-dec.app/api/dec-videasy", headers, "POST", postData);
        if (!decryptedResponse) return null;
        
        const decryptedData = await decryptedResponse.json();
        if (!decryptedData || !decryptedData.result) return null;

        const result = decryptedData.result;
        let sources = result.sources || [];
        const subtitles = result.subtitles || [];

        // Apply server-specific quality filter (Fade=Hindi, Vyse=English)
        if (server.qualityFilter) {
            sources = sources.filter(s => s.quality === server.qualityFilter);
        }

        // Filter out HDR sources
        sources = sources.filter(s => !s.quality.includes("HDR"));

        if (sources.length === 0) return null;

        // Build streams â€” audio language + flag + quality + server name for uniqueness
        const streamObjects = sources.map(src => ({
            title: `${SOURCE_NAME} ${server.audioLang} - ${src.quality} (${server.name})`,
            streamUrl: src.url,
            headers: {
                "Origin": "https://www.cineby.sc",
                "Referer": "https://www.cineby.sc/"
            }
        }));

        // Build subtitles â€” return whatever the API gives
        const langCount = {};
        const subtitleObjects = subtitles.map(sub => {
            const lang = sub.language || sub.lang || "Unknown";
            const url = sub.url || "";
            if (!url) return null;

            langCount[lang] = (langCount[lang] || 0) + 1;
            const count = langCount[lang];
            const label = count > 1 ? `${lang} (${count})` : lang;

            const proxiedUrl = `${PROXY_URL}/?url=${encodeURIComponent(url)}&type=vtt&referer=${REFERER}`;
            return {
                lang: label,
                url: proxiedUrl
            };
        }).filter(Boolean);

        console.log(`Server ${server.name}: ${streamObjects.length} streams, ${subtitleObjects.length} subs`);

        return {
            streams: streamObjects,
            subtitles: subtitleObjects
        };
    } catch (e) {
        console.log(`Server ${server.name} failed: ${e}`);
        return null;
    }
}

async function extractStreamUrl(ID) {
    let params;
    
    if (ID.includes('movie')) {
        const tmdbID = ID.replace('movie/', '').replace('/movie/', '');
        const response = await soraFetch(`${TMDB_BASE}/3/movie/${tmdbID}?append_to_response=external_ids&language=en`);
        const data = await response.json();

        params = {
            title: encodeURIComponent(data.title),
            mediaType: "movie",
            year: new Date(data.release_date).getFullYear(),
            episodeId: 1,
            seasonId: 1,
            tmdbId: data.id,
            imdbId: data.external_ids?.imdb_id || '',
            totalSeasons: 1
        };
    } else if (ID.includes('tv')) {
        const parts = ID.split('/').filter(Boolean);
        const tmdbID = parts[1];
        const seasonNumber = parts[2];
        const episodeNumber = parts[3];

        const response = await soraFetch(`${TMDB_BASE}/3/tv/${tmdbID}?append_to_response=external_ids&language=en`);
        const data = await response.json();

        params = {
            title: encodeURIComponent(data.name),
            mediaType: "tv",
            year: new Date(data.first_air_date).getFullYear(),
            episodeId: episodeNumber,
            seasonId: seasonNumber,
            tmdbId: data.id,
            imdbId: data.external_ids?.imdb_id || '',
            totalSeasons: data.number_of_seasons || 1
        };
    } else {
        return JSON.stringify({ streams: [], subtitles: [] });
    }

    console.log('Stream params: ' + JSON.stringify(params));

    // Fetch from all 10 servers in parallel
    const serverPromises = SERVERS.map(server => fetchServerSources(server, params));
    const serverResults = await Promise.all(serverPromises);

    // Merge all results
    let allStreams = [];
    let allSubtitles = [];

    for (const result of serverResults) {
        if (!result) continue;
        allStreams = allStreams.concat(result.streams);
        allSubtitles = allSubtitles.concat(result.subtitles);
    }

    // Deduplicate subtitles by lang+url
    const seenSubs = new Set();
    allSubtitles = allSubtitles.filter(sub => {
        const key = sub.lang + '|' + sub.url;
        if (seenSubs.has(key)) return false;
        seenSubs.add(key);
        return true;
    });

    console.log(`Total: ${allStreams.length} streams from ${serverResults.filter(Boolean).length} servers, ${allSubtitles.length} subtitles`);

    return JSON.stringify({
        streams: allStreams,
        subtitles: allSubtitles
    });
}

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
    try {
        return await fetchv2(
            url,
            options.headers ?? {},
            options.method ?? 'GET',
            options.body ?? null,
            true,
            options.encoding ?? 'utf-8'
        );
    } catch (e) {
        try {
            return await fetch(url, options);
        } catch (error) {
            return null;
        }
    }
}
